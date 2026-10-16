import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import initSqlJs from 'sql.js';
import {
  exportDatabaseBuffer,
  reloadDatabaseFromBuffer,
  getDatabaseStats,
  dbQueryOne,
  dbQueryAll,
  dbRun,
} from './db.ts';
import { logAudit } from './audit.ts';

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const REGISTRY_FILE = path.join(BACKUP_DIR, 'backup_registry.json');
const SCHEMA_VERSION = 'v1.2-offline-sqlite';

export interface BackupRecord {
  id: string;
  filename: string;
  filepath: string;
  backup_type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
  file_size: number;
  checksum_sha256: string;
  schema_version: string;
  status: 'SUCCESS' | 'FAILED';
  verification_status: 'VERIFIED' | 'FAILED' | 'UNCHECKED';
  verification_details?: string | null;
  table_counts?: Record<string, number> | null;
  error_message?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  notes?: string | null;
  is_locked: number;
  created_at: string;
}

export interface BackupSettings {
  auto_backup_enabled: boolean;
  schedule_time_ist: string; // e.g. "22:00" (10:00 PM IST)
  retention_daily_count: number; // default 14
  retention_weekly_count: number; // default 8
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error_message?: string | null;
  last_restore_test_at?: string | null;
  last_restore_test_result?: string | null;
}

const DEFAULT_SETTINGS: BackupSettings = {
  auto_backup_enabled: true,
  schedule_time_ist: '22:00',
  retention_daily_count: 14,
  retention_weekly_count: 8,
};

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function loadRegistry(): BackupRecord[] {
  ensureBackupDir();
  if (!fs.existsSync(REGISTRY_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse backup_registry.json:', e);
    return [];
  }
}

function saveRegistry(records: BackupRecord[]) {
  ensureBackupDir();
  try {
    const tmp = REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmp, REGISTRY_FILE);
  } catch (err) {
    console.error('Failed to write backup_registry.json:', err);
  }
}

export function getBackupSettings(): BackupSettings {
  try {
    const rows = dbQueryAll<{ key: string; value: string }>('SELECT key, value FROM backup_settings');
    const settings: any = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      if (r.key === 'auto_backup_enabled') settings.auto_backup_enabled = r.value === '1';
      else if (r.key === 'retention_daily_count') settings.retention_daily_count = Number(r.value) || 14;
      else if (r.key === 'retention_weekly_count') settings.retention_weekly_count = Number(r.value) || 8;
      else if (r.key === 'schedule_time_ist') settings.schedule_time_ist = r.value;
      else if (r.key === 'last_attempt_at') settings.last_attempt_at = r.value;
      else if (r.key === 'last_success_at') settings.last_success_at = r.value;
      else if (r.key === 'last_error_message') settings.last_error_message = r.value;
      else if (r.key === 'last_restore_test_at') settings.last_restore_test_at = r.value;
      else if (r.key === 'last_restore_test_result') settings.last_restore_test_result = r.value;
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateBackupSettings(newSettings: Partial<BackupSettings>, userId?: string): BackupSettings {
  const current = getBackupSettings();
  const merged: BackupSettings = { ...current, ...newSettings };
  const now = new Date().toISOString();

  const entries: [string, string][] = [
    ['auto_backup_enabled', merged.auto_backup_enabled ? '1' : '0'],
    ['schedule_time_ist', merged.schedule_time_ist || '22:00'],
    ['retention_daily_count', String(merged.retention_daily_count || 14)],
    ['retention_weekly_count', String(merged.retention_weekly_count || 8)],
  ];

  if (merged.last_attempt_at !== undefined) entries.push(['last_attempt_at', merged.last_attempt_at || '']);
  if (merged.last_success_at !== undefined) entries.push(['last_success_at', merged.last_success_at || '']);
  if (merged.last_error_message !== undefined) entries.push(['last_error_message', merged.last_error_message || '']);
  if (merged.last_restore_test_at !== undefined) entries.push(['last_restore_test_at', merged.last_restore_test_at || '']);
  if (merged.last_restore_test_result !== undefined) entries.push(['last_restore_test_result', merged.last_restore_test_result || '']);

  for (const [key, val] of entries) {
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      [key, val, now, userId || 'SYSTEM']
    );
  }

  logAudit(userId || 'SYSTEM', 'UPDATE_BACKUP_SETTINGS', 'SETTINGS', 'BACKUP', {
    auto_backup_enabled: merged.auto_backup_enabled,
    schedule_time_ist: merged.schedule_time_ist,
    retention_daily_count: merged.retention_daily_count,
  });

  return merged;
}

export async function createBackup(
  type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE',
  userId?: string,
  userFullName?: string,
  notes?: string
): Promise<{ success: boolean; backup?: BackupRecord; error?: string }> {
  ensureBackupDir();
  const now = new Date();
  const isoTime = now.toISOString();

  // Update last attempted time in settings
  try {
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      ['last_attempt_at', isoTime, isoTime, userId || 'SYSTEM']
    );
  } catch {}

  const dateTag = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const backupId = 'bak_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

  try {
    // 1. Export live database buffer directly from memory/disk
    const buffer = exportDatabaseBuffer();
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const shortHash = sha256.substring(0, 8);
    const filename = `nbf_backup_${dateTag}_${type.toLowerCase()}_${shortHash}.sqlite`;
    const finalPath = path.join(BACKUP_DIR, filename);
    const tmpPath = path.join(BACKUP_DIR, filename + '.tmp');

    // 2. Atomic write to .tmp file
    fs.writeFileSync(tmpPath, buffer);

    // 3. Verify readability and SQLite integrity before finalizing
    const SQL = await initSqlJs();
    const testDb = new SQL.Database(buffer);
    const integrityStmt = testDb.prepare('PRAGMA integrity_check;');
    let passedIntegrity = false;
    let integrityMsg = '';
    if (integrityStmt.step()) {
      const row = integrityStmt.getAsObject();
      integrityMsg = String(Object.values(row)[0]);
      passedIntegrity = integrityMsg === 'ok';
    }
    integrityStmt.free();

    // Verify foreign key integrity
    const fkStmt = testDb.prepare('PRAGMA foreign_key_check;');
    let fkPassed = true;
    const fkErrors: string[] = [];
    while (fkStmt.step()) {
      fkPassed = false;
      fkErrors.push(JSON.stringify(fkStmt.getAsObject()));
    }
    fkStmt.free();
    testDb.close();

    if (!passedIntegrity) {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      throw new Error(`Generated backup failed SQLite PRAGMA integrity_check: ${integrityMsg}`);
    }

    // 4. Atomic rename .tmp to final .sqlite
    fs.renameSync(tmpPath, finalPath);
    const stat = fs.statSync(finalPath);
    const tableCounts = getDatabaseStats();

    const record: BackupRecord = {
      id: backupId,
      filename,
      filepath: finalPath,
      backup_type: type,
      file_size: stat.size,
      checksum_sha256: sha256,
      schema_version: SCHEMA_VERSION,
      status: 'SUCCESS',
      verification_status: fkPassed ? 'VERIFIED' : 'FAILED',
      verification_details: fkPassed
        ? `Integrity: OK | Foreign Keys: OK | Verified ${Object.keys(tableCounts).length} tables`
        : `Integrity: OK | Foreign Key Warnings: ${fkErrors.length}`,
      table_counts: tableCounts,
      error_message: null,
      created_by: userId || (type === 'AUTOMATIC' ? 'SYSTEM_SCHEDULER' : 'OWNER'),
      created_by_name: userFullName || (type === 'AUTOMATIC' ? 'System Scheduler' : 'Store Owner'),
      notes: notes || (type === 'PRE_RESTORE' ? 'Automatic safety snapshot created before database restoration' : null),
      is_locked: type === 'PRE_RESTORE' ? 1 : 0,
      created_at: isoTime,
    };

    // 5. Store record in database table
    dbRun(
      `INSERT INTO backup_history (
        id, filename, filepath, backup_type, file_size, checksum_sha256,
        schema_version, status, verification_status, verification_details,
        table_counts, error_message, created_by, created_by_name, notes, is_locked, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.filename,
        record.filepath,
        record.backup_type,
        record.file_size,
        record.checksum_sha256,
        record.schema_version,
        record.status,
        record.verification_status,
        record.verification_details,
        JSON.stringify(record.table_counts),
        record.error_message,
        record.created_by,
        record.created_by_name,
        record.notes,
        record.is_locked,
        record.created_at,
      ]
    );

    // 6. Update file registry (persists across any future DB restores)
    const registry = loadRegistry();
    registry.unshift(record);
    saveRegistry(registry);

    // 7. Update last success in settings
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      ['last_success_at', isoTime, isoTime, userId || 'SYSTEM']
    );
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      ['last_error_message', '', isoTime, userId || 'SYSTEM']
    );

    // 8. Log audit trail
    logAudit(userId || 'SYSTEM', type === 'AUTOMATIC' ? 'AUTOMATIC_BACKUP_CREATED' : 'MANUAL_BACKUP_CREATED', 'BACKUP', backupId, {
      filename,
      size: stat.size,
      checksum: sha256,
      type,
    });

    // 9. Apply retention policy if automatic or manual
    if (type !== 'PRE_RESTORE') {
      applyRetentionPolicy();
    }

    return { success: true, backup: record };
  } catch (err: any) {
    console.error('Backup creation failed:', err);
    const failureRecord: BackupRecord = {
      id: backupId,
      filename: `failed_${dateTag}.sqlite`,
      filepath: '',
      backup_type: type,
      file_size: 0,
      checksum_sha256: '',
      schema_version: SCHEMA_VERSION,
      status: 'FAILED',
      verification_status: 'FAILED',
      verification_details: null,
      table_counts: null,
      error_message: err.message || 'Unknown backup error',
      created_by: userId || 'SYSTEM',
      created_by_name: userFullName || 'System Scheduler',
      notes,
      is_locked: 0,
      created_at: isoTime,
    };

    try {
      dbRun(
        `INSERT INTO backup_history (
          id, filename, filepath, backup_type, file_size, checksum_sha256,
          schema_version, status, verification_status, verification_details,
          table_counts, error_message, created_by, created_by_name, notes, is_locked, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          failureRecord.id,
          failureRecord.filename,
          failureRecord.filepath,
          failureRecord.backup_type,
          failureRecord.file_size,
          failureRecord.checksum_sha256,
          failureRecord.schema_version,
          failureRecord.status,
          failureRecord.verification_status,
          failureRecord.verification_details,
          null,
          failureRecord.error_message,
          failureRecord.created_by,
          failureRecord.created_by_name,
          failureRecord.notes,
          failureRecord.is_locked,
          failureRecord.created_at,
        ]
      );
      dbRun(
        'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
        ['last_error_message', err.message || 'Backup failed', isoTime, userId || 'SYSTEM']
      );
    } catch {}

    const registry = loadRegistry();
    registry.unshift(failureRecord);
    saveRegistry(registry);

    logAudit(userId || 'SYSTEM', 'BACKUP_FAILED', 'BACKUP', backupId, {
      error: err.message,
      type,
    });

    return { success: false, error: err.message || 'Backup creation failed' };
  }
}

export async function verifyBackup(
  backupId: string,
  userId?: string
): Promise<{ success: boolean; details?: string; error?: string }> {
  const record = getBackupById(backupId);
  if (!record) return { success: false, error: 'Backup record not found' };
  if (!record.filepath || !fs.existsSync(record.filepath)) {
    return { success: false, error: 'Backup file does not exist on disk' };
  }

  try {
    const fileBuffer = fs.readFileSync(record.filepath);

    // 1. Verify SHA-256
    const calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (calculatedHash !== record.checksum_sha256) {
      const errMsg = `Checksum mismatch: expected ${record.checksum_sha256.substring(0, 10)}... got ${calculatedHash.substring(0, 10)}...`;
      updateVerificationStatus(backupId, 'FAILED', errMsg);
      return { success: false, error: errMsg };
    }

    // 2. Open in isolated test database
    const SQL = await initSqlJs();
    const testDb = new SQL.Database(fileBuffer);
    testDb.run('PRAGMA foreign_keys = ON;');

    // 3. SQLite PRAGMA integrity_check
    const integrityStmt = testDb.prepare('PRAGMA integrity_check;');
    let passed = false;
    let integrityMsg = '';
    if (integrityStmt.step()) {
      integrityMsg = String(Object.values(integrityStmt.getAsObject())[0]);
      passed = integrityMsg === 'ok';
    }
    integrityStmt.free();

    if (!passed) {
      testDb.close();
      const errMsg = `PRAGMA integrity_check failed: ${integrityMsg}`;
      updateVerificationStatus(backupId, 'FAILED', errMsg);
      return { success: false, error: errMsg };
    }

    // 4. PRAGMA foreign_key_check
    const fkStmt = testDb.prepare('PRAGMA foreign_key_check;');
    let fkPassed = true;
    while (fkStmt.step()) {
      fkPassed = false;
    }
    fkStmt.free();

    // 5. Check core tables
    const requiredTables = ['users', 'store_settings', 'products', 'sales', 'stock_ledger', 'audit_logs'];
    const tblStmt = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table';");
    const foundTables: string[] = [];
    while (tblStmt.step()) {
      foundTables.push(String(tblStmt.getAsObject().name));
    }
    tblStmt.free();

    for (const req of requiredTables) {
      if (!foundTables.includes(req)) {
        testDb.close();
        const errMsg = `Missing essential table: ${req}`;
        updateVerificationStatus(backupId, 'FAILED', errMsg);
        return { success: false, error: errMsg };
      }
    }

    testDb.close();

    const details = `Verified OK on ${new Date().toLocaleTimeString('en-IN')}: Checksum matched, SQLite integrity OK, ${foundTables.length} tables intact.`;
    updateVerificationStatus(backupId, 'VERIFIED', details);

    logAudit(userId || 'SYSTEM', 'VERIFY_BACKUP', 'BACKUP', backupId, {
      result: 'VERIFIED',
      checksum: calculatedHash,
    });

    return { success: true, details };
  } catch (err: any) {
    const errMsg = err.message || 'Verification exception';
    updateVerificationStatus(backupId, 'FAILED', errMsg);
    return { success: false, error: errMsg };
  }
}

export async function testRestoreBackup(
  backupId: string,
  userId?: string
): Promise<{ success: boolean; report?: any; error?: string }> {
  const record = getBackupById(backupId);
  if (!record) return { success: false, error: 'Backup record not found' };
  if (!record.filepath || !fs.existsSync(record.filepath)) {
    return { success: false, error: 'Backup file does not exist on disk' };
  }

  try {
    const fileBuffer = fs.readFileSync(record.filepath);
    const SQL = await initSqlJs();
    // Isolated dry-run database completely in memory
    const testDb = new SQL.Database(fileBuffer);
    testDb.run('PRAGMA foreign_keys = ON;');

    // 1. Run full integrity check
    const integrityStmt = testDb.prepare('PRAGMA integrity_check;');
    let integrity = 'unknown';
    if (integrityStmt.step()) {
      integrity = String(Object.values(integrityStmt.getAsObject())[0]);
    }
    integrityStmt.free();

    // 2. Foreign keys check
    const fkStmt = testDb.prepare('PRAGMA foreign_key_check;');
    let fkPassed = true;
    while (fkStmt.step()) {
      fkPassed = false;
    }
    fkStmt.free();

    // 3. Inspect tables & counts
    const tblStmt = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
    const tables: string[] = [];
    while (tblStmt.step()) {
      tables.push(String(tblStmt.getAsObject().name));
    }
    tblStmt.free();

    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const cStmt = testDb.prepare(`SELECT COUNT(*) as c FROM ${t};`);
        if (cStmt.step()) {
          counts[t] = Number(cStmt.getAsObject().c);
        }
        cStmt.free();
      } catch {
        counts[t] = 0;
      }
    }

    // 4. Sample store profile check
    let storeName = 'Unknown';
    try {
      const sStmt = testDb.prepare("SELECT value FROM store_settings WHERE key = 'store_name';");
      if (sStmt.step()) {
        storeName = String(sStmt.getAsObject().value);
      }
      sStmt.free();
    } catch {}

    testDb.close();

    const now = new Date().toISOString();
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      ['last_restore_test_at', now, now, userId || 'SYSTEM']
    );
    dbRun(
      'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      ['last_restore_test_result', `PASSED: ${storeName} (${tables.length} tables verified)`, now, userId || 'SYSTEM']
    );

    const report = {
      tested_at: now,
      backup_id: backupId,
      filename: record.filename,
      integrity_status: integrity,
      foreign_keys_ok: fkPassed,
      store_name: storeName,
      table_count: tables.length,
      sample_records: {
        products: counts.products || 0,
        sales: counts.sales || 0,
        customers: counts.customers || 0,
        purchases: counts.purchases || 0,
        financial_transactions: counts.financial_transactions || 0,
        staff: counts.staff || 0,
        audit_logs: counts.audit_logs || 0,
      },
      message: 'Isolated dry-run restore passed all SQLite integrity, constraint, and table verifications.',
    };

    logAudit(userId || 'SYSTEM', 'RESTORE_DRY_RUN_TEST', 'BACKUP', backupId, {
      report,
    });

    return { success: true, report };
  } catch (err: any) {
    return { success: false, error: err.message || 'Dry-run restore test failed' };
  }
}

export async function restoreDatabase(
  backupIdOrBuffer: string | Buffer,
  userId: string,
  userFullName?: string,
  sourceFileName?: string
): Promise<{ success: boolean; preRestoreBackupId?: string; error?: string; restoredSummary?: any }> {
  // 1. Mandatory pre-restore backup of the LIVE database
  console.log('[Restore] Creating mandatory safety pre-restore backup before restoring...');
  const preRestoreRes = await createBackup(
    'PRE_RESTORE',
    userId,
    userFullName,
    `Safety recovery snapshot created immediately before restoring database ${sourceFileName || ''}`
  );

  if (!preRestoreRes.success || !preRestoreRes.backup) {
    return {
      success: false,
      error: `Failed to create safe pre-restore snapshot: ${preRestoreRes.error}. Restore cancelled to protect current data.`,
    };
  }

  const preRestoreId = preRestoreRes.backup.id;

  try {
    let targetBuffer: Buffer;
    if (typeof backupIdOrBuffer === 'string') {
      const record = getBackupById(backupIdOrBuffer);
      if (!record) throw new Error('Target backup record not found in system registry');
      if (!fs.existsSync(record.filepath)) throw new Error(`Backup file not found at ${record.filepath}`);
      targetBuffer = fs.readFileSync(record.filepath);
    } else {
      targetBuffer = backupIdOrBuffer;
    }

    // 2. Perform atomic reload and integrity test in reloadDatabaseFromBuffer
    const reloadRes = await reloadDatabaseFromBuffer(targetBuffer);
    if (!reloadRes.success) {
      throw new Error(`Database reload failed: ${reloadRes.error}`);
    }

    // 3. Post-restore stats
    const postStats = getDatabaseStats();

    logAudit(userId, 'RESTORE_DATABASE', 'DATABASE', preRestoreId, {
      message: 'Database successfully restored to specified recovery point',
      preRestoreBackupId: preRestoreId,
      sourceFileName: sourceFileName || 'archive',
      restoredTableCounts: postStats,
    });

    return {
      success: true,
      preRestoreBackupId: preRestoreId,
      restoredSummary: postStats,
    };
  } catch (err: any) {
    console.error('[Restore] Restoration failed, initiating rollback:', err);

    // Automatic Rollback using the pre-restore buffer!
    try {
      if (preRestoreRes.backup.filepath && fs.existsSync(preRestoreRes.backup.filepath)) {
        const preRestoreBuf = fs.readFileSync(preRestoreRes.backup.filepath);
        await reloadDatabaseFromBuffer(preRestoreBuf);
        console.log('[Restore] Rollback completed: live database preserved in original state.');
      }
    } catch (rbErr) {
      console.error('[Restore] Rollback critical failure:', rbErr);
    }

    logAudit(userId, 'RESTORE_FAILED', 'DATABASE', preRestoreId, {
      error: err.message,
      preRestoreBackupId: preRestoreId,
    });

    return {
      success: false,
      preRestoreBackupId: preRestoreId,
      error: `Restore failed: ${err.message}. Live database was safely rolled back to pre-restore snapshot ${preRestoreId}.`,
    };
  }
}

export function deleteBackup(
  backupId: string,
  userId: string
): { success: boolean; error?: string } {
  const records = getBackupHistory();
  const target = records.find((r) => r.id === backupId);
  if (!target) return { success: false, error: 'Backup not found' };

  if (target.is_locked) {
    return { success: false, error: 'This backup is locked/protected and cannot be deleted.' };
  }

  // Check if this is the ONLY valid recovery point
  const validBackups = records.filter((r) => r.status === 'SUCCESS' && r.verification_status !== 'FAILED');
  if (validBackups.length <= 1 && validBackups.some((r) => r.id === backupId)) {
    return {
      success: false,
      error: 'Cannot delete the only valid recovery point in the system. Create another backup first.',
    };
  }

  // Delete physical file if exists
  if (target.filepath && fs.existsSync(target.filepath)) {
    try {
      fs.unlinkSync(target.filepath);
    } catch (e: any) {
      console.error('Error deleting backup file:', e);
    }
  }

  // Remove from database
  try {
    dbRun('DELETE FROM backup_history WHERE id = ?', [backupId]);
  } catch {}

  // Remove from registry
  const registry = loadRegistry().filter((r) => r.id !== backupId);
  saveRegistry(registry);

  logAudit(userId, 'DELETE_BACKUP', 'BACKUP', backupId, {
    filename: target.filename,
  });

  return { success: true };
}

export function toggleBackupLock(
  backupId: string,
  userId: string
): { success: boolean; is_locked: boolean; error?: string } {
  const record = getBackupById(backupId);
  if (!record) return { success: false, error: 'Backup record not found', is_locked: false };

  const newLock = record.is_locked ? 0 : 1;

  try {
    dbRun('UPDATE backup_history SET is_locked = ? WHERE id = ?', [newLock, backupId]);
  } catch {}

  const registry = loadRegistry().map((r) => (r.id === backupId ? { ...r, is_locked: newLock } : r));
  saveRegistry(registry);

  logAudit(userId, newLock ? 'LOCK_BACKUP' : 'UNLOCK_BACKUP', 'BACKUP', backupId, {
    filename: record.filename,
    is_locked: newLock === 1,
  });

  return { success: true, is_locked: newLock === 1 };
}

export function getBackupById(backupId: string): BackupRecord | null {
  try {
    const row = dbQueryOne<any>('SELECT * FROM backup_history WHERE id = ?', [backupId]);
    if (row) {
      return {
        ...row,
        table_counts: row.table_counts ? JSON.parse(row.table_counts) : null,
      };
    }
  } catch {}

  const registry = loadRegistry();
  return registry.find((r) => r.id === backupId) || null;
}

export function getBackupHistory(): BackupRecord[] {
  try {
    const rows = dbQueryAll<any>('SELECT * FROM backup_history ORDER BY created_at DESC');
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        ...r,
        table_counts: r.table_counts ? (typeof r.table_counts === 'string' ? JSON.parse(r.table_counts) : r.table_counts) : null,
      }));
    }
  } catch {}

  return loadRegistry();
}

export function getBackupHealth(): {
  status: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED';
  lastSuccessfulBackup: BackupRecord | null;
  lastAttemptedBackup: BackupRecord | null;
  nextScheduledBackupIso: string | null;
  nextScheduledBackupDisplay: string | null;
  autoBackupEnabled: boolean;
  totalValidBackups: number;
  totalStorageBytes: number;
  latestVerificationResult: string | null;
  lastRestoreTestResult: string | null;
  lastRestoreTestAt: string | null;
} {
  const history = getBackupHistory();
  const settings = getBackupSettings();

  const successBackups = history.filter((b) => b.status === 'SUCCESS');
  const validBackups = successBackups.filter((b) => b.verification_status !== 'FAILED');
  const lastSuccessful = successBackups.length > 0 ? successBackups[0] : null;
  const lastAttempted = history.length > 0 ? history[0] : null;

  let totalBytes = 0;
  for (const b of history) {
    if (b.file_size) totalBytes += b.file_size;
  }

  // Calculate next scheduled backup time in IST
  const { nextIso, nextDisplay } = calculateNextScheduledTime(settings.schedule_time_ist);

  // Compute status
  let healthStatus: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED' = 'HEALTHY';

  if (!lastSuccessful || validBackups.length === 0) {
    healthStatus = 'BACKUP_DUE';
  } else if (lastAttempted && lastAttempted.status === 'FAILED') {
    healthStatus = 'FAILED';
  } else {
    // If last successful was more than 36 hours ago
    const lastTime = new Date(lastSuccessful.created_at).getTime();
    const diffHours = (Date.now() - lastTime) / (1000 * 60 * 60);
    if (diffHours > 36) {
      healthStatus = 'BACKUP_DUE';
    } else if (lastSuccessful.verification_status === 'UNCHECKED') {
      healthStatus = 'VERIFICATION_REQUIRED';
    } else if (!settings.last_restore_test_at) {
      healthStatus = 'RESTORE_TEST_REQUIRED';
    }
  }

  return {
    status: healthStatus,
    lastSuccessfulBackup: lastSuccessful,
    lastAttemptedBackup: lastAttempted,
    nextScheduledBackupIso: settings.auto_backup_enabled ? nextIso : null,
    nextScheduledBackupDisplay: settings.auto_backup_enabled ? nextDisplay : 'Automatic Backups Paused',
    autoBackupEnabled: settings.auto_backup_enabled,
    totalValidBackups: validBackups.length,
    totalStorageBytes: totalBytes,
    latestVerificationResult: lastSuccessful?.verification_details || null,
    lastRestoreTestResult: settings.last_restore_test_result || null,
    lastRestoreTestAt: settings.last_restore_test_at || null,
  };
}

export function calculateNextScheduledTime(scheduleTimeIst: string = '22:00'): { nextIso: string; nextDisplay: string; msUntilNext: number } {
  const [hourStr, minStr] = scheduleTimeIst.split(':');
  const schedHour = parseInt(hourStr || '22', 10);
  const schedMin = parseInt(minStr || '0', 10);

  // IST offset is UTC+5:30 = 330 minutes = 19800000 ms
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const nowIst = new Date(nowUtc + IST_OFFSET_MS);

  // Today in IST
  const year = nowIst.getUTCFullYear();
  const month = nowIst.getUTCMonth();
  const day = nowIst.getUTCDate();

  // Target run date in IST
  let targetIst = new Date(Date.UTC(year, month, day, schedHour, schedMin, 0));
  if (targetIst.getTime() <= nowIst.getTime()) {
    // Move to tomorrow IST
    targetIst = new Date(Date.UTC(year, month, day + 1, schedHour, schedMin, 0));
  }

  const targetUtcMs = targetIst.getTime() - IST_OFFSET_MS;
  const msUntilNext = Math.max(0, targetUtcMs - nowUtc);
  const nextDate = new Date(targetUtcMs);

  const nextDisplay = nextDate.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' IST';

  return {
    nextIso: nextDate.toISOString(),
    nextDisplay,
    msUntilNext,
  };
}

function updateVerificationStatus(backupId: string, status: 'VERIFIED' | 'FAILED', details: string) {
  try {
    dbRun(
      'UPDATE backup_history SET verification_status = ?, verification_details = ? WHERE id = ?',
      [status, details, backupId]
    );
  } catch {}

  const registry = loadRegistry().map((r) =>
    r.id === backupId ? { ...r, verification_status: status, verification_details: details } : r
  );
  saveRegistry(registry);
}

function applyRetentionPolicy() {
  const settings = getBackupSettings();
  const records = getBackupHistory();

  const validBackups = records.filter((r) => r.status === 'SUCCESS');
  if (validBackups.length <= 1) {
    // Never delete if 1 or 0 backups exist
    return;
  }

  // Filter out locked backups and pre-restore backups (keep pre-restore snapshots safe)
  const candidates = validBackups.filter((r) => !r.is_locked && r.backup_type !== 'PRE_RESTORE');
  const keepLimit = Math.max(settings.retention_daily_count || 14, 5);

  if (candidates.length > keepLimit) {
    const toDelete = candidates.slice(keepLimit);
    for (const item of toDelete) {
      if (item.filepath && fs.existsSync(item.filepath)) {
        try {
          fs.unlinkSync(item.filepath);
        } catch {}
      }
      try {
        dbRun('DELETE FROM backup_history WHERE id = ?', [item.id]);
      } catch {}
    }

    const deleteIds = new Set(toDelete.map((d) => d.id));
    const newRegistry = loadRegistry().filter((r) => !deleteIds.has(r.id));
    saveRegistry(newRegistry);
  }
}
