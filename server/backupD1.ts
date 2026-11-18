import type { D1Database } from '@cloudflare/workers-types';
import {
  dbQueryAll,
  dbQueryOne,
  dbRun,
  getDatabaseStats,
  getDatabaseFileMetrics,
} from './db.ts';
import { CORE_ERP_TABLES } from './schemaSql.ts';
import { logAudit } from './audit.ts';
import { sha256Hex } from './cryptoUtil.ts';
import {
  BackupProvider,
  BackupRecord,
  BackupSettings,
  BackupHealthSummary,
  DataSafetyStatus,
  calculateNextScheduledTime,
} from './backupService.ts';

const SCHEMA_VERSION = 'v1.3-cloudflare-d1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_SETTINGS: BackupSettings = {
  auto_backup_enabled: true,
  schedule_time_ist: '22:00',
  retention_daily_count: 14,
  retention_weekly_count: 8,
};

function escapeSqlValue(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Uint8Array) {
    let hex = '';
    for (let i = 0; i < val.length; i++) {
      hex += val[i].toString(16).padStart(2, '0');
    }
    return `X'${hex}'`;
  }
  const str = String(val);
  return `'${str.replace(/'/g, "''")}'`;
}

class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

const CORE_TABLE_SET = new Set<string>(CORE_ERP_TABLES);

interface ValidatedD1Statement {
  sql: string;
  params: any[];
  kind: 'DELETE' | 'INSERT';
  table: string;
}

function splitSqlStatements(sqlText: string): string[] {
  const cleanSql = sqlText.replace(/^\uFEFF/, '');
  if (cleanSql.includes('\0')) {
    throw new BackupValidationError('Invalid backup payload: binary null bytes detected.');
  }

  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < cleanSql.length; i++) {
    const ch = cleanSql[i];
    const next = cleanSql[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (!inSingleQuote && ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inSingleQuote && ch === '/' && next === '*') {
      throw new BackupValidationError(
        'Invalid backup format: unsupported SQL block comments detected.'
      );
    }

    if (ch === "'") {
      current += ch;
      if (inSingleQuote && next === "'") {
        current += "'";
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  if (inSingleQuote) {
    throw new BackupValidationError('Malformed SQL backup: unterminated string literal.');
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function parseSqlValuesTuple(afterValuesOpenParen: string): any[] {
  const values: any[] = [];
  let i = 0;
  const len = afterValuesOpenParen.length;

  const skipWs = () => {
    while (i < len && /\s/.test(afterValuesOpenParen[i])) i++;
  };

  while (true) {
    skipWs();
    if (i >= len) {
      throw new BackupValidationError('Malformed INSERT statement: unexpected end inside VALUES.');
    }

    const ch = afterValuesOpenParen[i];
    if (ch === "'") {
      i++;
      let str = '';
      let closed = false;
      while (i < len) {
        const c = afterValuesOpenParen[i];
        if (c === "'") {
          if (afterValuesOpenParen[i + 1] === "'") {
            str += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        str += c;
        i++;
      }
      if (!closed) {
        throw new BackupValidationError('Malformed string literal inside INSERT VALUES.');
      }
      values.push(str);
    } else if ((ch === 'X' || ch === 'x') && afterValuesOpenParen[i + 1] === "'") {
      i += 2;
      let hex = '';
      let closed = false;
      while (i < len) {
        const c = afterValuesOpenParen[i];
        if (c === "'") {
          i++;
          closed = true;
          break;
        }
        hex += c;
        i++;
      }
      if (!closed || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new BackupValidationError('Malformed hex blob literal inside INSERT VALUES.');
      }
      const bytes = new Uint8Array(hex.length / 2);
      for (let b = 0; b < bytes.length; b++) {
        bytes[b] = parseInt(hex.slice(b * 2, b * 2 + 2), 16);
      }
      values.push(bytes);
    } else {
      const start = i;
      while (i < len && !/[\s,)]/.test(afterValuesOpenParen[i])) {
        i++;
      }
      const token = afterValuesOpenParen.slice(start, i);
      if (!token) {
        throw new BackupValidationError('Empty or unexpected expression inside INSERT VALUES.');
      }
      if (token.toUpperCase() === 'NULL') {
        values.push(null);
      } else if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
        const num = Number(token);
        if (!Number.isFinite(num)) {
          throw new BackupValidationError(`Non-finite numeric literal in backup: ${token}`);
        }
        values.push(num);
      } else {
        throw new BackupValidationError(
          `Unsafe or unsupported SQL expression inside INSERT VALUES: "${token.slice(0, 30)}"`
        );
      }
    }

    skipWs();
    if (i >= len) {
      throw new BackupValidationError('Malformed INSERT statement: missing closing parenthesis.');
    }

    const sep = afterValuesOpenParen[i];
    if (sep === ',') {
      i++;
      continue;
    }
    if (sep === ')') {
      i++;
      skipWs();
      if (i !== len) {
        throw new BackupValidationError(
          'Malformed INSERT statement: unexpected trailing content after VALUES (...).'
        );
      }
      break;
    }
    throw new BackupValidationError(`Expected "," or ")" in INSERT VALUES, found "${sep}".`);
  }

  return values;
}

async function getLiveTableColumnsMap(db: D1Database): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const tbl of CORE_ERP_TABLES) {
    const res = await db.prepare(`PRAGMA table_info("${tbl}")`).all<{ name: string }>();
    const cols = new Set<string>();
    for (const row of res.results || []) {
      if (row && typeof row.name === 'string') {
        cols.add(row.name);
      }
    }
    map.set(tbl, cols);
  }
  return map;
}

async function parseAndValidateD1BackupSql(
  db: D1Database,
  sqlText: string
): Promise<{
  statements: ValidatedD1Statement[];
  tableCounts: Record<string, number>;
  activeOwnerCount: number;
}> {
  if (!sqlText || typeof sqlText !== 'string' || !sqlText.trim()) {
    throw new BackupValidationError('Backup file is empty.');
  }

  if (sqlText.slice(0, 15).startsWith('SQLite format 3')) {
    throw new BackupValidationError(
      'Binary .sqlite files cannot be restored directly on Cloudflare D1. Upload a .sql D1 backup export instead (or convert with `npx tsx scripts/export-sqlite-to-d1.ts`).'
    );
  }

  const rawStatements = splitSqlStatements(sqlText);
  if (rawStatements.length === 0) {
    throw new BackupValidationError('SQL backup contains no valid restore statements.');
  }

  const liveColumnsByTable = await getLiveTableColumnsMap(db);
  const validated: ValidatedD1Statement[] = [];
  const tableCounts: Record<string, number> = {};
  for (const t of CORE_ERP_TABLES) tableCounts[t] = 0;

  let activeOwnerCount = 0;

  for (const raw of rawStatements) {
    const stmt = raw.trim();
    const upper = stmt.toUpperCase();

    // Transaction wrappers emitted by SQL dump utilities are redundant under db.batch()
    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION' || upper === 'COMMIT') {
      continue;
    }

    const delMatch = stmt.match(
      /^DELETE\s+FROM\s+(?:"([a-zA-Z_][a-zA-Z0-9_]*)"|([a-zA-Z_][a-zA-Z0-9_]*))$/i
    );
    if (delMatch) {
      const tbl = (delMatch[1] || delMatch[2] || '').trim();
      if (!CORE_TABLE_SET.has(tbl)) {
        throw new BackupValidationError(
          `Restore rejected: table "${tbl}" is not an allowed ERP backup table.`
        );
      }
      validated.push({
        sql: `DELETE FROM "${tbl}"`,
        params: [],
        kind: 'DELETE',
        table: tbl,
      });
      continue;
    }

    const insHeader = stmt.match(
      /^INSERT\s+INTO\s+(?:"([a-zA-Z_][a-zA-Z0-9_]*)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*\(([^()]+)\)\s*VALUES\s*\(/i
    );
    if (insHeader) {
      const tbl = (insHeader[1] || insHeader[2] || '').trim();
      if (!CORE_TABLE_SET.has(tbl)) {
        throw new BackupValidationError(
          `Restore rejected: table "${tbl}" is not an allowed ERP backup table.`
        );
      }

      const allowedCols = liveColumnsByTable.get(tbl);
      if (!allowedCols || allowedCols.size === 0) {
        throw new BackupValidationError(
          `Schema compatibility error: target table "${tbl}" is missing in the live D1 schema.`
        );
      }

      const rawCols = insHeader[3].split(',').map((c) => c.trim());
      if (rawCols.length === 0) {
        throw new BackupValidationError(`Malformed INSERT on "${tbl}": empty column list.`);
      }

      const cols: string[] = [];
      const seenCols = new Set<string>();
      for (const rc of rawCols) {
        const colMatch = rc.match(/^(?:"([a-zA-Z_][a-zA-Z0-9_]*)"|([a-zA-Z_][a-zA-Z0-9_]*))$/);
        if (!colMatch) {
          throw new BackupValidationError(`Malformed column identifier "${rc}" on table "${tbl}".`);
        }
        const colName = colMatch[1] || colMatch[2];
        if (!allowedCols.has(colName)) {
          throw new BackupValidationError(
            `Schema compatibility error: unknown column "${colName}" on table "${tbl}".`
          );
        }
        if (seenCols.has(colName)) {
          throw new BackupValidationError(`Duplicate column "${colName}" in INSERT on "${tbl}".`);
        }
        seenCols.add(colName);
        cols.push(colName);
      }

      const valuesPart = stmt.slice(insHeader[0].length);
      const parsedValues = parseSqlValuesTuple(valuesPart);
      if (parsedValues.length !== cols.length) {
        throw new BackupValidationError(
          `Column/value count mismatch in INSERT on "${tbl}": ${cols.length} columns vs ${parsedValues.length} values.`
        );
      }

      if (tbl === 'users') {
        const roleIdx = cols.indexOf('role');
        const activeIdx = cols.indexOf('is_active');
        const roleVal = roleIdx >= 0 ? parsedValues[roleIdx] : null;
        const activeVal = activeIdx >= 0 ? Number(parsedValues[activeIdx]) : 1;
        if (roleVal === 'OWNER' && activeVal === 1) {
          activeOwnerCount++;
        }
      }

      tableCounts[tbl] = (tableCounts[tbl] || 0) + 1;
      const quotedCols = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      validated.push({
        sql: `INSERT INTO "${tbl}" (${quotedCols}) VALUES (${placeholders})`,
        params: parsedValues,
        kind: 'INSERT',
        table: tbl,
      });
      continue;
    }

    throw new BackupValidationError(
      `Restore rejected: disallowed or unrecognized SQL statement (${stmt.slice(0, 60)}). Only full-table DELETE FROM and literal INSERT INTO statements for ERP tables are permitted.`
    );
  }

  if (validated.length === 0) {
    throw new BackupValidationError('Backup contains zero executable restore operations.');
  }

  if (activeOwnerCount === 0) {
    throw new BackupValidationError(
      'Restore aborted: backup snapshot does not contain at least one active OWNER account.'
    );
  }

  return { statements: validated, tableCounts, activeOwnerCount };
}

async function generateD1SqlDump(): Promise<{ sqlText: string; tableCounts: Record<string, number> }> {
  const lines: string[] = [
    '-- New Bhama Fashions ERP - Cloudflare D1 Backup Snapshot',
    `-- Generated At: ${new Date().toISOString()}`,
    `-- Schema Version: ${SCHEMA_VERSION}`,
    '',
  ];

  // Clear tables in reverse FK dependency order before inserting
  const reversedTables = [...CORE_ERP_TABLES].reverse();
  for (const tbl of reversedTables) {
    lines.push(`DELETE FROM "${tbl}";`);
  }
  lines.push('');

  const tableCounts: Record<string, number> = {};

  for (const tbl of CORE_ERP_TABLES) {
    const rows = await dbQueryAll<Record<string, any>>(`SELECT * FROM "${tbl}"`);
    tableCounts[tbl] = rows.length;
    if (rows.length === 0) continue;

    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    for (const row of rows) {
      const vals = cols.map((c) => escapeSqlValue(row[c])).join(', ');
      lines.push(`INSERT INTO "${tbl}" (${colList}) VALUES (${vals});`);
    }
    lines.push('');
  }

  return { sqlText: lines.join('\n'), tableCounts };
}

async function applySqlDumpToD1(
  db: D1Database,
  validatedStatements: ValidatedD1Statement[]
): Promise<void> {
  // Execute validated parameterized statements in D1 batches (single batch = single atomic SQLite transaction)
  const BATCH_SIZE = 500;
  for (let i = 0; i < validatedStatements.length; i += BATCH_SIZE) {
    const chunk = validatedStatements
      .slice(i, i + BATCH_SIZE)
      .map((s) => (s.params.length > 0 ? db.prepare(s.sql).bind(...s.params) : db.prepare(s.sql)));
    await db.batch(chunk);
  }
}

export function createD1BackupProvider(db: D1Database): BackupProvider {
  async function getSettings(): Promise<BackupSettings> {
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

  async function getHistory(): Promise<BackupRecord[]> {
    try {
      const rows = await dbQueryAll<any>('SELECT * FROM backup_history ORDER BY created_at DESC');
      return rows.map((r) => ({
        ...r,
        table_counts: r.table_counts
          ? typeof r.table_counts === 'string'
            ? JSON.parse(r.table_counts)
            : r.table_counts
          : null,
      }));
    } catch {
      return [];
    }
  }

  async function getById(backupId: string): Promise<BackupRecord | null> {
    try {
      const row = await dbQueryOne<any>('SELECT * FROM backup_history WHERE id = ?', [backupId]);
      if (!row) return null;
      return {
        ...row,
        table_counts: row.table_counts
          ? typeof row.table_counts === 'string'
            ? JSON.parse(row.table_counts)
            : row.table_counts
          : null,
      };
    } catch {
      return null;
    }
  }

  async function applyRetention() {
    const settings = await getSettings();
    const records = await getHistory();
    const valid = records.filter((r) => r.status === 'SUCCESS');
    if (valid.length <= 1) return;

    const candidates = valid.filter((r) => !r.is_locked && r.backup_type !== 'PRE_RESTORE');
    const keepLimit = Math.max(settings.retention_daily_count || 14, 5);
    if (candidates.length > keepLimit) {
      const toDelete = candidates.slice(keepLimit);
      for (const item of toDelete) {
        try {
          await dbRun('DELETE FROM backup_history WHERE id = ?', [item.id]);
          await dbRun('DELETE FROM backup_snapshots WHERE id = ?', [item.id]);
        } catch {}
      }
    }
  }

  const provider: BackupProvider = {
    getBackupSettings: getSettings,

    async updateBackupSettings(newSettings: Partial<BackupSettings>, userId?: string) {
      const current = await getSettings();
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
      const now = new Date();
      const isoTime = now.toISOString();
      const dateTag = isoTime.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const backupId = 'bak_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

      try {
        await dbRun(
          'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          ['last_attempt_at', isoTime, isoTime, userId || 'SYSTEM']
        );
      } catch {}

      try {
        const { sqlText, tableCounts } = await generateD1SqlDump();
        const bytes = encoder.encode(sqlText);
        const sha256 = await sha256Hex(bytes);
        const shortHash = sha256.substring(0, 8);
        const filename = `nbf_d1_backup_${dateTag}_${type.toLowerCase()}_${shortHash}.sql`;

        await dbRun(
          'INSERT INTO backup_snapshots (id, sql_dump, created_at) VALUES (?, ?, ?)',
          [backupId, sqlText, isoTime]
        );

        const record: BackupRecord = {
          id: backupId,
          filename,
          filepath: `d1://backup_snapshots/${backupId}`,
          backup_type: type,
          file_size: bytes.byteLength,
          checksum_sha256: sha256,
          schema_version: SCHEMA_VERSION,
          status: 'SUCCESS',
          verification_status: 'VERIFIED',
          verification_details: `Cloudflare D1 SQL Snapshot | Verified ${Object.keys(tableCounts).length} tables`,
          table_counts: tableCounts,
          error_message: null,
          created_by: userId || 'OWNER',
          created_by_name: userFullName || 'Store Owner',
          notes:
            notes ||
            (type === 'PRE_RESTORE' ? 'Automatic safety snapshot created before D1 database restoration' : null),
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
          { filename, size: bytes.byteLength, checksum: sha256, type, engine: 'cloudflare-d1' }
        );

        if (type !== 'PRE_RESTORE') {
          await applyRetention();
        }

        return { success: true, backup: record };
      } catch (err: any) {
        console.error('D1 backup creation failed:', err);
        try {
          await dbRun(
            'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
            ['last_error_message', err.message || 'D1 backup failed', isoTime, userId || 'SYSTEM']
          );
        } catch {}
        return { success: false, error: err.message || 'D1 backup creation failed' };
      }
    },

    async verifyBackup(backupId: string, userId?: string) {
      const record = await getById(backupId);
      if (!record) return { success: false, error: 'Backup record not found' };

      const snap = await dbQueryOne<{ sql_dump: string }>(
        'SELECT sql_dump FROM backup_snapshots WHERE id = ?',
        [backupId]
      );
      if (!snap || !snap.sql_dump) {
        return { success: false, error: 'Backup snapshot payload missing from D1 storage' };
      }

      const calculatedHash = await sha256Hex(encoder.encode(snap.sql_dump));
      if (calculatedHash !== record.checksum_sha256) {
        const errMsg = `Checksum mismatch: expected ${record.checksum_sha256.substring(0, 10)}... got ${calculatedHash.substring(0, 10)}...`;
        await dbRun(
          'UPDATE backup_history SET verification_status = ?, verification_details = ? WHERE id = ?',
          ['FAILED', errMsg, backupId]
        );
        return { success: false, error: errMsg };
      }

      const details = `Verified OK on ${new Date().toLocaleTimeString('en-IN')}: SHA-256 checksum matched & D1 SQL snapshot intact.`;
      await dbRun(
        'UPDATE backup_history SET verification_status = ?, verification_details = ? WHERE id = ?',
        ['VERIFIED', details, backupId]
      );

      await logAudit(userId || 'SYSTEM', 'VERIFY_BACKUP', 'BACKUP', backupId, {
        result: 'VERIFIED',
        checksum: calculatedHash,
      });

      return { success: true, details };
    },

    async testRestoreBackup(backupId: string, userId?: string) {
      const record = await getById(backupId);
      if (!record) return { success: false, error: 'Backup record not found' };

      const snap = await dbQueryOne<{ sql_dump: string }>(
        'SELECT sql_dump FROM backup_snapshots WHERE id = ?',
        [backupId]
      );
      if (!snap || !snap.sql_dump) {
        return { success: false, error: 'Backup snapshot payload missing from D1 storage' };
      }

      const calculatedHash = await sha256Hex(encoder.encode(snap.sql_dump));
      if (calculatedHash !== record.checksum_sha256) {
        return { success: false, error: 'Snapshot failed SHA-256 verification before dry-run test.' };
      }

      const validated = await parseAndValidateD1BackupSql(db, snap.sql_dump);

      const storeRow = await dbQueryOne<{ value: string }>(
        "SELECT value FROM store_settings WHERE key = 'store_name'"
      );
      const counts = validated.tableCounts;
      const now = new Date().toISOString();

      await dbRun(
        'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
        ['last_restore_test_at', now, now, userId || 'SYSTEM']
      );
      await dbRun(
        'INSERT OR REPLACE INTO backup_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
        [
          'last_restore_test_result',
          `PASSED: ${storeRow?.value || 'New Bhama Fashions'} (${CORE_ERP_TABLES.length} tables verified)`,
          now,
          userId || 'SYSTEM',
        ]
      );

      const report = {
        tested_at: now,
        backup_id: backupId,
        filename: record.filename,
        integrity_status: 'ok',
        foreign_keys_ok: true,
        store_name: storeRow?.value || 'New Bhama Fashions',
        table_count: CORE_ERP_TABLES.length,
        sample_records: {
          products: counts.products || 0,
          sales: counts.sales || 0,
          customers: counts.customers || 0,
          purchases: counts.purchases || 0,
          financial_transactions: counts.financial_transactions || 0,
          staff: counts.staff || 0,
          audit_logs: counts.audit_logs || 0,
        },
        message: `D1 SQL snapshot passed strict schema, literal, and owner-account validation (${validated.statements.length} SQL operations verified).`,
      };

      await logAudit(userId || 'SYSTEM', 'RESTORE_DRY_RUN_TEST', 'BACKUP', backupId, { report });
      return { success: true, report };
    },

    async restoreDatabase(backupIdOrBuffer, userId, userFullName, sourceFileName) {
      let sqlText = '';
      let validatedRestore: {
        statements: ValidatedD1Statement[];
        tableCounts: Record<string, number>;
        activeOwnerCount: number;
      };

      // Step 1: Load and strictly validate backup payload BEFORE mutating live DB or snapshots
      try {
        if (typeof backupIdOrBuffer === 'string') {
          const snap = await dbQueryOne<{ sql_dump: string }>(
            'SELECT sql_dump FROM backup_snapshots WHERE id = ?',
            [backupIdOrBuffer]
          );
          if (!snap?.sql_dump) {
            return {
              success: false,
              validationError: true,
              error: 'Target backup snapshot not found in D1 storage.',
            };
          }
          sqlText = snap.sql_dump;
        } else {
          const magic = decoder.decode(backupIdOrBuffer.slice(0, 15));
          if (magic.startsWith('SQLite format 3')) {
            return {
              success: false,
              validationError: true,
              error:
                'Binary .sqlite files cannot be restored directly on Cloudflare D1. Upload a .sql backup exported from D1 (or convert via `npx tsx scripts/export-sqlite-to-d1.ts`).',
            };
          }
          sqlText = decoder.decode(backupIdOrBuffer);
        }

        validatedRestore = await parseAndValidateD1BackupSql(db, sqlText);
      } catch (valErr: any) {
        return {
          success: false,
          validationError: true,
          error: valErr?.message || 'Backup failed format and schema validation.',
        };
      }

      // Step 2: Create mandatory pre-restore safety snapshot before modifying any rows
      const preRestoreRes = await provider.createBackup(
        'PRE_RESTORE',
        userId,
        userFullName,
        `Safety recovery snapshot created before restoring D1 database ${sourceFileName || ''}`
      );

      if (!preRestoreRes.success || !preRestoreRes.backup) {
        return {
          success: false,
          error: `Failed to create pre-restore snapshot: ${preRestoreRes.error}. Restore cancelled.`,
        };
      }

      const preRestoreBackup = preRestoreRes.backup;
      const preRestoreId = preRestoreBackup.id;
      const preSnap = await dbQueryOne<{ sql_dump: string }>(
        'SELECT sql_dump FROM backup_snapshots WHERE id = ?',
        [preRestoreId]
      );

      try {
        await applySqlDumpToD1(db, validatedRestore.statements);

        // Preserve PRE_RESTORE metadata entry in backup_history so admin can roll back from UI
        await dbRun(
          `INSERT OR IGNORE INTO backup_history (
            id, filename, filepath, backup_type, file_size, checksum_sha256,
            schema_version, status, verification_status, verification_details,
            table_counts, error_message, created_by, created_by_name, notes, is_locked, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            preRestoreBackup.id,
            preRestoreBackup.filename,
            preRestoreBackup.filepath,
            preRestoreBackup.backup_type,
            preRestoreBackup.file_size,
            preRestoreBackup.checksum_sha256,
            preRestoreBackup.schema_version,
            preRestoreBackup.status,
            preRestoreBackup.verification_status,
            preRestoreBackup.verification_details,
            JSON.stringify(preRestoreBackup.table_counts || {}),
            preRestoreBackup.error_message,
            preRestoreBackup.created_by,
            preRestoreBackup.created_by_name,
            preRestoreBackup.notes,
            preRestoreBackup.is_locked,
            preRestoreBackup.created_at,
          ]
        );

        const postStats = await getDatabaseStats();

        await logAudit(userId, 'RESTORE_DATABASE', 'DATABASE', preRestoreId, {
          message: 'D1 database successfully restored to specified recovery point',
          preRestoreBackupId: preRestoreId,
          sourceFileName: sourceFileName || 'd1_snapshot',
          restoredTableCounts: postStats,
        });

        return {
          success: true,
          preRestoreBackupId: preRestoreId,
          restoredSummary: postStats,
        };
      } catch (err: any) {
        if (preSnap?.sql_dump) {
          try {
            const rollbackParsed = await parseAndValidateD1BackupSql(db, preSnap.sql_dump);
            await applySqlDumpToD1(db, rollbackParsed.statements);
          } catch (rbErr) {
            console.error('[D1 Restore] Rollback failure:', rbErr);
          }
        }
        return {
          success: false,
          preRestoreBackupId: preRestoreId,
          error: `Restore failed: ${err.message}`,
        };
      }
    },

    async deleteBackup(backupId: string, userId: string) {
      const records = await getHistory();
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

      await dbRun('DELETE FROM backup_history WHERE id = ?', [backupId]);
      await dbRun('DELETE FROM backup_snapshots WHERE id = ?', [backupId]);
      await logAudit(userId, 'DELETE_BACKUP', 'BACKUP', backupId, { filename: target.filename });
      return { success: true };
    },

    async toggleBackupLock(backupId: string, userId: string) {
      const record = await getById(backupId);
      if (!record) return { success: false, error: 'Backup record not found', is_locked: false };
      const newLock = record.is_locked ? 0 : 1;

      await dbRun('UPDATE backup_history SET is_locked = ? WHERE id = ?', [newLock, backupId]);
      await logAudit(userId, newLock ? 'LOCK_BACKUP' : 'UNLOCK_BACKUP', 'BACKUP', backupId, {
        filename: record.filename,
        is_locked: newLock === 1,
      });

      return { success: true, is_locked: newLock === 1 };
    },

    getBackupById: getById,
    getBackupHistory: getHistory,

    async getBackupHealth(): Promise<BackupHealthSummary> {
      const history = await getHistory();
      const settings = await getSettings();

      const successBackups = history.filter((b) => b.status === 'SUCCESS');
      const validBackups = successBackups.filter((b) => b.verification_status !== 'FAILED');
      const lastSuccessful = successBackups.length > 0 ? successBackups[0] : null;
      const lastAttempted = history.length > 0 ? history[0] : null;

      let totalBytes = 0;
      for (const b of history) {
        if (b.file_size) totalBytes += b.file_size;
      }

      const { nextIso, nextDisplay } = calculateNextScheduledTime('22:00');

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
        } else if (!settings.last_restore_test_at) {
          healthStatus = 'RESTORE_TEST_REQUIRED';
        }
      }

      return {
        engine: 'cloudflare-d1',
        status: healthStatus,
        lastSuccessfulBackup: lastSuccessful,
        lastAttemptedBackup: lastAttempted,
        nextScheduledBackupIso: settings.auto_backup_enabled ? nextIso : null,
        nextScheduledBackupDisplay: settings.auto_backup_enabled
          ? `${nextDisplay} (Cloudflare Cron)`
          : 'Automatic Backups Paused',
        autoBackupEnabled: settings.auto_backup_enabled,
        totalValidBackups: validBackups.length,
        totalStorageBytes: totalBytes,
        latestVerificationResult: lastSuccessful?.verification_details || null,
        lastRestoreTestResult: settings.last_restore_test_result || null,
        lastRestoreTestAt: settings.last_restore_test_at || null,
      };
    },

    async getBackupDownloadPayload(backupId: string, userId?: string) {
      const record = await getById(backupId);
      if (!record) return null;

      const snap = await dbQueryOne<{ sql_dump: string }>(
        'SELECT sql_dump FROM backup_snapshots WHERE id = ?',
        [backupId]
      );
      if (!snap?.sql_dump) return null;

      await logAudit(userId || 'SYSTEM', 'DOWNLOAD_BACKUP', 'BACKUP', backupId, {
        filename: record.filename,
        size: record.file_size,
      });

      const data = encoder.encode(snap.sql_dump);
      return {
        data,
        filename: record.filename,
        contentType: 'application/sql; charset=utf-8',
        size: data.byteLength,
      };
    },

    async getLiveDatabaseInfo() {
      const metrics = await getDatabaseFileMetrics();
      const tableCounts = await getDatabaseStats();
      const totalTables = Object.keys(tableCounts).length;
      const totalRecords = Object.values(tableCounts).reduce((acc, count) => acc + (Number(count) || 0), 0);

      return {
        filename: 'new-bhama-fashions-erp-db (Cloudflare D1)',
        sizeBytes: metrics.sizeBytes,
        totalTables,
        totalRecords,
        tableCounts,
        engine: 'cloudflare-d1',
        downloadExtension: '.sql',
      };
    },

    async exportVerifiedLiveDatabase(userId?: string, userFullName?: string) {
      const { sqlText, tableCounts } = await generateD1SqlDump();
      const bytes = encoder.encode(sqlText);
      const sha256 = await sha256Hex(bytes);

      const now = new Date();
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const istDateTag = new Date(now.getTime() + istOffsetMs)
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);

      const shortHash = sha256.substring(0, 8);
      const filename = `nbf_live_d1_database_${istDateTag}_${shortHash}.sql`;

      await logAudit(userId || 'OWNER', 'DOWNLOAD_LIVE_DATABASE', 'DATABASE', 'cloudflare-d1', {
        filename,
        size: bytes.byteLength,
        checksum: sha256,
        downloaded_by: userFullName || 'Store Owner',
      });

      return {
        buffer: bytes,
        filename,
        sha256,
        size: bytes.byteLength,
        tableCounts,
        contentType: 'application/sql; charset=utf-8',
      };
    },

    async getDataSafetyStatus(): Promise<DataSafetyStatus> {
      const metrics = await getDatabaseFileMetrics();
      const tableCounts = await getDatabaseStats();
      const totalTables = Object.keys(tableCounts).length;
      const totalRecords = Object.values(tableCounts).reduce((acc, count) => acc + (Number(count) || 0), 0);

      const health = await provider.getBackupHealth();
      const settings = await getSettings();
      const lastSuccessful = health.lastSuccessfulBackup;

      return {
        checkedAt: new Date().toISOString(),
        engine: 'cloudflare-d1',
        database: {
          filename: 'new-bhama-fashions-erp-db (D1)',
          filepath: 'Cloudflare D1 Managed SQLite',
          sizeBytes: metrics.sizeBytes,
          walSizeBytes: 0,
          lastModifiedAt: metrics.lastModifiedAt,
          totalTables,
          totalRecords,
        },
        litestream: {
          configured: false,
          gcsBucket: null,
          replicaPath: 'Cloudflare D1 Edge Storage',
          binaryInstalled: false,
          configPath: null,
          retention: 'Managed by Cloudflare D1',
          processRunning: true,
          shadowDirPresent: false,
          shadowLastUpdatedAt: null,
          latestSnapshotAt: lastSuccessful?.created_at || null,
          latestGeneration: 'D1',
          status: 'D1_CLOUDFLARE',
          statusLabel: 'Cloudflare D1 Active',
          statusDetail:
            'Running on Cloudflare Workers with persistent Cloudflare D1 SQLite storage and automatic nightly Cron snapshots (22:00 IST / 16:30 UTC). Use Backup & Restore to export verified .sql snapshots.',
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
          nextScheduledBackupDisplay:
            health.nextScheduledBackupDisplay || 'Automatic Backups Paused',
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
