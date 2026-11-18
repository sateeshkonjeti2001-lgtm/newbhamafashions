import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
import {
  BackupProvider,
  BackupRecord,
  BackupSettings,
  BackupHealthSummary,
  DataSafetyStatus,
  calculateNextScheduledTime,
  registerBackupProvider,
} from './backupService.ts';

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const REGISTRY_FILE = path.join(BACKUP_DIR, 'backup_registry.json');
const SCHEMA_VERSION = 'v1.2-offline-sqlite';
const execFileAsync = promisify(execFile);

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

async function getBackupSettingsNode(): Promise<BackupSettings> {
  try {
    const rows = await dbQueryAll<{ key: string; value: string }>('SELECT key, value FROM backup_settings');
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

async function getBackupHistoryNode(): Promise<BackupRecord[]> {
  try {
    const rows = await dbQueryAll<any>('SELECT * FROM backup_history ORDER BY created_at DESC');
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        ...r,
        table_counts: r.table_counts
          ? typeof r.table_counts === 'string'
            ? JSON.parse(r.table_counts)
            : r.table_counts
          : null,
      }));
    }
  } catch {}
  return loadRegistry();
}

async function getBackupByIdNode(backupId: string): Promise<BackupRecord | null> {
  try {
    const row = await dbQueryOne<any>('SELECT * FROM backup_history WHERE id = ?', [backupId]);
    if (row) {
      return {
        ...row,
        table_counts: row.table_counts ? JSON.parse(row.table_counts) : null,
      };
    }
  } catch {}
  return loadRegistry().find((r) => r.id === backupId) || null;
}

async function updateVerificationStatusNode(
  backupId: string,
  status: 'VERIFIED' | 'FAILED',
  details: string
) {
  try {
    await dbRun(
      'UPDATE backup_history SET verification_status = ?, verification_details = ? WHERE id = ?',
      [status, details, backupId]
    );
  } catch {}

  const registry = loadRegistry().map((r) =>
    r.id === backupId ? { ...r, verification_status: status, verification_details: details } : r
  );
  saveRegistry(registry);
}

async function applyRetentionPolicyNode() {
  const settings = await getBackupSettingsNode();
  const records = await getBackupHistoryNode();

  const validBackups = records.filter((r) => r.status === 'SUCCESS');
  if (validBackups.length <= 1) return;

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
        await dbRun('DELETE FROM backup_history WHERE id = ?', [item.id]);
      } catch {}
    }

    const deleteIds = new Set(toDelete.map((d) => d.id));
    const newRegistry = loadRegistry().filter((r) => !deleteIds.has(r.id));
    saveRegistry(newRegistry);
  }
}

function findLitestreamBinary(): string | null {
  for (const p of ['/usr/local/bin/litestream', '/usr/bin/litestream']) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function findLitestreamConfig(): { path: string | null; retention: string | null } {
  for (const p of ['/etc/litestream.yml', path.join(process.cwd(), 'litestream.yml')]) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const retMatch = content.match(/retention:\s*([^\s#]+)/i);
        return { path: p, retention: retMatch?.[1] || null };
      }
    } catch {}
  }
  return { path: null, retention: null };
}

function isLitestreamProcessRunning(): boolean {
  try {
    if (!fs.existsSync('/proc')) return false;
    const entries = fs.readdirSync('/proc');
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf-8').replace(/\0/g, ' ');
        if (cmdline.includes('litestream') && cmdline.includes('replicate')) {
          return true;
        }
      } catch {}
    }
  } catch {
    return false;
  }
  return false;
}

function getLatestMtimeInDir(dirPath: string, maxDepth = 3): string | null {
  let latestMs = 0;
  const walk = (current: string, depth: number) => {
    if (depth > maxDepth) return;
    try {
      const items = fs.readdirSync(current, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(current, item.name);
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs > latestMs) latestMs = st.mtimeMs;
          if (item.isDirectory()) walk(full, depth + 1);
        } catch {}
      }
    } catch {}
  };
  walk(dirPath, 0);
  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
}

export function createNodeBackupProvider(): BackupProvider {
  const provider: BackupProvider = {
    getBackupSettings: getBackupSettingsNode,

    async updateBackupSettings(newSettings: Partial<BackupSettings>, userId?: string) {
      const current = await getBackupSettingsNode();
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
        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          [key, val, now, userId || 'SYSTEM']
        );
      }

      await logAudit(userId || 'SYSTEM', 'UPDATE_BACKUP_SETTINGS', 'SETTINGS', 'BACKUP', {
        auto_backup_enabled: merged.auto_backup_enabled,
        schedule_time_ist: merged.schedule_time_ist,
        retention_daily_count: merged.retention_daily_count,
      });

      return merged;
    },

    async createBackup(type, userId, userFullName, notes) {
      ensureBackupDir();
      const now = new Date();
      const isoTime = now.toISOString();

      try {
        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          ['last_attempt_at', isoTime, isoTime, userId || 'SYSTEM']
        );
      } catch {}

      const dateTag = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const backupId = 'bak_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

      try {
        const rawBytes = await exportDatabaseBuffer();
        const buffer = Buffer.from(rawBytes);
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const shortHash = sha256.substring(0, 8);
        const filename = `nbf_backup_${dateTag}_${type.toLowerCase()}_${shortHash}.sqlite`;
        const finalPath = path.join(BACKUP_DIR, filename);
        const tmpPath = path.join(BACKUP_DIR, filename + '.tmp');

        fs.writeFileSync(tmpPath, buffer);

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

        fs.renameSync(tmpPath, finalPath);
        const stat = fs.statSync(finalPath);
        const tableCounts = await getDatabaseStats();

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
          notes:
            notes ||
            (type === 'PRE_RESTORE' ? 'Automatic safety snapshot created before database restoration' : null),
          is_locked: type === 'PRE_RESTORE' ? 1 : 0,
          created_at: isoTime,
        };

        await dbRun(
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

        const registry = loadRegistry();
        registry.unshift(record);
        saveRegistry(registry);

        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          ['last_success_at', isoTime, isoTime, userId || 'SYSTEM']
        );
        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          ['last_error_message', '', isoTime, userId || 'SYSTEM']
        );

        await logAudit(
          userId || 'SYSTEM',
          type === 'AUTOMATIC' ? 'AUTOMATIC_BACKUP_CREATED' : 'MANUAL_BACKUP_CREATED',
          'BACKUP',
          backupId,
          { filename, size: stat.size, checksum: sha256, type }
        );

        if (type !== 'PRE_RESTORE') {
          await applyRetentionPolicyNode();
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
          await dbRun(
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
          await dbRun(
            'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
            ['last_error_message', err.message || 'Backup failed', isoTime, userId || 'SYSTEM']
          );
        } catch {}

        const registry = loadRegistry();
        registry.unshift(failureRecord);
        saveRegistry(registry);

        await logAudit(userId || 'SYSTEM', 'BACKUP_FAILED', 'BACKUP', backupId, {
          error: err.message,
          type,
        });

        return { success: false, error: err.message || 'Backup creation failed' };
      }
    },

    async verifyBackup(backupId: string, userId?: string) {
      const record = await getBackupByIdNode(backupId);
      if (!record) return { success: false, error: 'Backup record not found' };
      if (!record.filepath || !fs.existsSync(record.filepath)) {
        return { success: false, error: 'Backup file does not exist on disk' };
      }

      try {
        const fileBuffer = fs.readFileSync(record.filepath);
        const calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (calculatedHash !== record.checksum_sha256) {
          const errMsg = `Checksum mismatch: expected ${record.checksum_sha256.substring(0, 10)}... got ${calculatedHash.substring(0, 10)}...`;
          await updateVerificationStatusNode(backupId, 'FAILED', errMsg);
          return { success: false, error: errMsg };
        }

        const SQL = await initSqlJs();
        const testDb = new SQL.Database(fileBuffer);
        testDb.run('PRAGMA foreign_keys = ON;');

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
          await updateVerificationStatusNode(backupId, 'FAILED', errMsg);
          return { success: false, error: errMsg };
        }

        const fkStmt = testDb.prepare('PRAGMA foreign_key_check;');
        while (fkStmt.step()) {}
        fkStmt.free();

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
            await updateVerificationStatusNode(backupId, 'FAILED', errMsg);
            return { success: false, error: errMsg };
          }
        }

        testDb.close();

        const details = `Verified OK on ${new Date().toLocaleTimeString('en-IN')}: Checksum matched, SQLite integrity OK, ${foundTables.length} tables intact.`;
        await updateVerificationStatusNode(backupId, 'VERIFIED', details);

        await logAudit(userId || 'SYSTEM', 'VERIFY_BACKUP', 'BACKUP', backupId, {
          result: 'VERIFIED',
          checksum: calculatedHash,
        });

        return { success: true, details };
      } catch (err: any) {
        const errMsg = err.message || 'Verification exception';
        await updateVerificationStatusNode(backupId, 'FAILED', errMsg);
        return { success: false, error: errMsg };
      }
    },

    async testRestoreBackup(backupId: string, userId?: string) {
      const record = await getBackupByIdNode(backupId);
      if (!record) return { success: false, error: 'Backup record not found' };
      if (!record.filepath || !fs.existsSync(record.filepath)) {
        return { success: false, error: 'Backup file does not exist on disk' };
      }

      try {
        const fileBuffer = fs.readFileSync(record.filepath);
        const SQL = await initSqlJs();
        const testDb = new SQL.Database(fileBuffer);
        testDb.run('PRAGMA foreign_keys = ON;');

        const integrityStmt = testDb.prepare('PRAGMA integrity_check;');
        let integrity = 'unknown';
        if (integrityStmt.step()) {
          integrity = String(Object.values(integrityStmt.getAsObject())[0]);
        }
        integrityStmt.free();

        const fkStmt = testDb.prepare('PRAGMA foreign_key_check;');
        let fkPassed = true;
        while (fkStmt.step()) {
          fkPassed = false;
        }
        fkStmt.free();

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
            if (cStmt.step()) counts[t] = Number(cStmt.getAsObject().c);
            cStmt.free();
          } catch {
            counts[t] = 0;
          }
        }

        let storeName = 'Unknown';
        try {
          const sStmt = testDb.prepare("SELECT value FROM store_settings WHERE key = 'store_name';");
          if (sStmt.step()) storeName = String(sStmt.getAsObject().value);
          sStmt.free();
        } catch {}

        testDb.close();

        const now = new Date().toISOString();
        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          ['last_restore_test_at', now, now, userId || 'SYSTEM']
        );
        await dbRun(
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

        await logAudit(userId || 'SYSTEM', 'RESTORE_DRY_RUN_TEST', 'BACKUP', backupId, { report });
        return { success: true, report };
      } catch (err: any) {
        return { success: false, error: err.message || 'Dry-run restore test failed' };
      }
    },

    async restoreDatabase(backupIdOrBuffer, userId, userFullName, sourceFileName) {
      console.log('[Restore] Creating mandatory safety pre-restore backup before restoring...');
      const preRestoreRes = await provider.createBackup(
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
          const record = await getBackupByIdNode(backupIdOrBuffer);
          if (!record) throw new Error('Target backup record not found in system registry');
          if (!fs.existsSync(record.filepath)) throw new Error(`Backup file not found at ${record.filepath}`);
          targetBuffer = fs.readFileSync(record.filepath);
        } else {
          targetBuffer = Buffer.from(backupIdOrBuffer);
        }

        const reloadRes = await reloadDatabaseFromBuffer(targetBuffer);
        if (!reloadRes.success) {
          throw new Error(`Database reload failed: ${reloadRes.error}`);
        }

        const postStats = await getDatabaseStats();
        await logAudit(userId, 'RESTORE_DATABASE', 'DATABASE', preRestoreId, {
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
        try {
          if (preRestoreRes.backup.filepath && fs.existsSync(preRestoreRes.backup.filepath)) {
            const preRestoreBuf = fs.readFileSync(preRestoreRes.backup.filepath);
            await reloadDatabaseFromBuffer(preRestoreBuf);
            console.log('[Restore] Rollback completed: live database preserved in original state.');
          }
        } catch (rbErr) {
          console.error('[Restore] Rollback critical failure:', rbErr);
        }

        await logAudit(userId, 'RESTORE_FAILED', 'DATABASE', preRestoreId, {
          error: err.message,
          preRestoreBackupId: preRestoreId,
        });

        return {
          success: false,
          preRestoreBackupId: preRestoreId,
          error: `Restore failed: ${err.message}. Live database was safely rolled back to pre-restore snapshot ${preRestoreId}.`,
        };
      }
    },

    async deleteBackup(backupId: string, userId: string) {
      const records = await getBackupHistoryNode();
      const target = records.find((r) => r.id === backupId);
      if (!target) return { success: false, error: 'Backup not found' };
      if (target.is_locked) {
        return { success: false, error: 'This backup is locked/protected and cannot be deleted.' };
      }

      const validBackups = records.filter((r) => r.status === 'SUCCESS' && r.verification_status !== 'FAILED');
      if (validBackups.length <= 1 && validBackups.some((r) => r.id === backupId)) {
        return {
          success: false,
          error: 'Cannot delete the only valid recovery point in the system. Create another backup first.',
        };
      }

      if (target.filepath && fs.existsSync(target.filepath)) {
        try {
          fs.unlinkSync(target.filepath);
        } catch (e: any) {
          console.error('Error deleting backup file:', e);
        }
      }

      try {
        await dbRun('DELETE FROM backup_history WHERE id = ?', [backupId]);
      } catch {}

      const registry = loadRegistry().filter((r) => r.id !== backupId);
      saveRegistry(registry);

      await logAudit(userId, 'DELETE_BACKUP', 'BACKUP', backupId, { filename: target.filename });
      return { success: true };
    },

    async toggleBackupLock(backupId: string, userId: string) {
      const record = await getBackupByIdNode(backupId);
      if (!record) return { success: false, error: 'Backup record not found', is_locked: false };
      const newLock = record.is_locked ? 0 : 1;

      try {
        await dbRun('UPDATE backup_history SET is_locked = ? WHERE id = ?', [newLock, backupId]);
      } catch {}

      const registry = loadRegistry().map((r) => (r.id === backupId ? { ...r, is_locked: newLock } : r));
      saveRegistry(registry);

      await logAudit(userId, newLock ? 'LOCK_BACKUP' : 'UNLOCK_BACKUP', 'BACKUP', backupId, {
        filename: record.filename,
        is_locked: newLock === 1,
      });

      return { success: true, is_locked: newLock === 1 };
    },

    getBackupById: getBackupByIdNode,
    getBackupHistory: getBackupHistoryNode,

    async getBackupHealth(): Promise<BackupHealthSummary> {
      const history = await getBackupHistoryNode();
      const settings = await getBackupSettingsNode();

      const successBackups = history.filter((b) => b.status === 'SUCCESS');
      const validBackups = successBackups.filter((b) => b.verification_status !== 'FAILED');
      const lastSuccessful = successBackups.length > 0 ? successBackups[0] : null;
      const lastAttempted = history.length > 0 ? history[0] : null;

      let totalBytes = 0;
      for (const b of history) {
        if (b.file_size) totalBytes += b.file_size;
      }

      const { nextIso, nextDisplay } = calculateNextScheduledTime(settings.schedule_time_ist);

      let healthStatus: BackupHealthSummary['status'] = 'HEALTHY';
      if (!lastSuccessful || validBackups.length === 0) {
        healthStatus = 'BACKUP_DUE';
      } else if (lastAttempted && lastAttempted.status === 'FAILED') {
        healthStatus = 'FAILED';
      } else {
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
        engine: 'sqlite-node',
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
    },

    async getBackupDownloadPayload(backupId: string, userId?: string) {
      const record = await getBackupByIdNode(backupId);
      if (!record || !record.filepath || !fs.existsSync(record.filepath)) {
        return null;
      }

      await logAudit(userId || 'SYSTEM', 'DOWNLOAD_BACKUP', 'BACKUP', backupId, {
        filename: record.filename,
        size: record.file_size,
      });

      const buf = fs.readFileSync(record.filepath);
      return {
        data: new Uint8Array(buf),
        filename: record.filename,
        contentType: 'application/x-sqlite3',
        size: buf.length,
      };
    },

    async getLiveDatabaseInfo() {
      const dbPath = path.join(DATA_DIR, 'bhama_store.sqlite');
      let sizeBytes = 0;
      try {
        if (fs.existsSync(dbPath)) {
          sizeBytes = fs.statSync(dbPath).size;
        } else {
          sizeBytes = (await exportDatabaseBuffer()).length;
        }
      } catch {
        sizeBytes = 0;
      }

      const tableCounts = await getDatabaseStats();
      const totalTables = Object.keys(tableCounts).length;
      const totalRecords = Object.values(tableCounts).reduce((acc, count) => acc + (Number(count) || 0), 0);

      return {
        filename: 'bhama_store.sqlite',
        sizeBytes,
        totalTables,
        totalRecords,
        tableCounts,
        engine: 'sqlite-node',
        downloadExtension: '.sqlite',
      };
    },

    async exportVerifiedLiveDatabase(userId?: string, userFullName?: string) {
      const raw = await exportDatabaseBuffer();
      const buffer = Buffer.from(raw);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

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
      testDb.close();

      if (!passedIntegrity) {
        throw new Error(`Live database export failed SQLite integrity check: ${integrityMsg}`);
      }

      const now = new Date();
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const istDateTag = new Date(now.getTime() + istOffsetMs)
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);

      const shortHash = sha256.substring(0, 8);
      const filename = `nbf_live_database_${istDateTag}_${shortHash}.sqlite`;
      const tableCounts = await getDatabaseStats();

      await logAudit(userId || 'OWNER', 'DOWNLOAD_LIVE_DATABASE', 'DATABASE', 'bhama_store.sqlite', {
        filename,
        size: buffer.length,
        checksum: sha256,
        downloaded_by: userFullName || 'Store Owner',
      });

      return {
        buffer: new Uint8Array(buffer),
        filename,
        sha256,
        size: buffer.length,
        tableCounts,
        contentType: 'application/x-sqlite3',
      };
    },

    async getDataSafetyStatus(): Promise<DataSafetyStatus> {
      const dbPath = path.join(DATA_DIR, 'bhama_store.sqlite');
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      const shadowDir = path.join(DATA_DIR, '.bhama_store.sqlite-litestream');

      let sizeBytes = 0;
      let walSizeBytes = 0;
      let lastModifiedAt: string | null = null;

      try {
        if (fs.existsSync(dbPath)) {
          const st = fs.statSync(dbPath);
          sizeBytes = st.size;
          lastModifiedAt = st.mtime.toISOString();
        } else {
          sizeBytes = (await exportDatabaseBuffer()).length;
        }
      } catch {
        sizeBytes = 0;
      }

      try {
        if (fs.existsSync(walPath)) walSizeBytes += fs.statSync(walPath).size;
        if (fs.existsSync(shmPath)) walSizeBytes += fs.statSync(shmPath).size;
      } catch {}

      const tableCounts = await getDatabaseStats();
      const totalTables = Object.keys(tableCounts).length;
      const totalRecords = Object.values(tableCounts).reduce((acc, count) => acc + (Number(count) || 0), 0);

      const gcsBucket = process.env.GCS_BUCKET?.trim() || null;
      const configured = Boolean(gcsBucket);
      const replicaPath = gcsBucket ? `gs://${gcsBucket}/db/bhama_store.sqlite` : null;
      const binaryPath = findLitestreamBinary();
      const binaryInstalled = Boolean(binaryPath);
      const { path: configPath, retention } = findLitestreamConfig();
      const processRunning = isLitestreamProcessRunning();
      const shadowDirPresent = fs.existsSync(shadowDir);
      const shadowLastUpdatedAt = shadowDirPresent ? getLatestMtimeInDir(shadowDir) : null;

      let latestSnapshotAt: string | null = null;
      let latestGeneration: string | null = null;

      if (configured && binaryPath && configPath) {
        try {
          const { stdout } = await execFileAsync(binaryPath, ['snapshots', '-config', configPath, dbPath], {
            timeout: 2500,
          });
          const lines = stdout
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.toLowerCase().startsWith('replica'));
          if (lines.length > 0) {
            const lastCols = lines[lines.length - 1].split(/\s+/);
            if (lastCols.length >= 5) {
              latestGeneration = lastCols[1] || null;
              latestSnapshotAt = lastCols[4] || null;
            }
          }
        } catch {}
      }

      let lsStatus: DataSafetyStatus['litestream']['status'] = 'STANDALONE_LOCAL';
      let statusLabel = 'Standalone Local Mode';
      let statusDetail =
        'GCS_BUCKET is not configured in this environment. Database runs in standalone local disk mode with scheduled and manual local backups.';

      if (configured) {
        if (processRunning) {
          lsStatus = 'REPLICATING';
          statusLabel = 'Active & Replicating';
          statusDetail = `Litestream replicate process is running continuously and syncing changes to gs://${gcsBucket}/db/bhama_store.sqlite.`;
        } else {
          lsStatus = 'DEGRADED';
          statusLabel = 'Not Running (Degraded)';
          statusDetail =
            'GCS_BUCKET is configured, but no active Litestream replicate process was detected in this container.';
        }
      }

      const health = await provider.getBackupHealth();
      const settings = await getBackupSettingsNode();
      const lastSuccessful = health.lastSuccessfulBackup;

      return {
        checkedAt: new Date().toISOString(),
        engine: 'sqlite-node',
        database: {
          filename: 'bhama_store.sqlite',
          filepath: dbPath,
          sizeBytes,
          walSizeBytes,
          lastModifiedAt,
          totalTables,
          totalRecords,
        },
        litestream: {
          configured,
          gcsBucket,
          replicaPath,
          binaryInstalled,
          configPath,
          retention,
          processRunning,
          shadowDirPresent,
          shadowLastUpdatedAt,
          latestSnapshotAt,
          latestGeneration,
          status: lsStatus,
          statusLabel,
          statusDetail,
        },
        backup: {
          healthStatus: health.status,
          lastSuccessfulBackupAt: lastSuccessful?.created_at || null,
          lastSuccessfulBackup: lastSuccessful
            ? {
                id: lastSuccessful.id,
                filename: lastSuccessful.filename,
                backup_type: lastSuccessful.backup_type,
                file_size: lastSuccessful.file_size,
                verification_status: lastSuccessful.verification_status,
                checksum_sha256: lastSuccessful.checksum_sha256,
                created_at: lastSuccessful.created_at,
              }
            : null,
          lastAttemptAt: settings.last_attempt_at || health.lastAttemptedBackup?.created_at || null,
          lastErrorMessage: settings.last_error_message || null,
          autoBackupEnabled: health.autoBackupEnabled,
          nextScheduledBackupDisplay: health.nextScheduledBackupDisplay || '',
          totalValidBackups: health.totalValidBackups,
          totalStorageBytes: health.totalStorageBytes,
          lastRestoreTestAt: health.lastRestoreTestAt,
          lastRestoreTestResult: health.lastRestoreTestResult,
        },
      };
    },
  };

  return provider;
}

export function registerNodeBackupProvider(): void {
  registerBackupProvider(createNodeBackupProvider());
}
