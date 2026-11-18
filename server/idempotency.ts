import { dbQueryOne, dbRun } from './db.ts';

export async function getIdempotencyRecord<T = any>(scopedKey: string): Promise<T | null> {
  if (!scopedKey) return null;
  try {
    const row = await dbQueryOne<{ response_json: string; expires_at: number }>(
      'SELECT response_json, expires_at FROM idempotency_keys WHERE key = ?',
      [scopedKey]
    );
    if (!row) return null;
    if (Number(row.expires_at) <= Date.now()) {
      await dbRun('DELETE FROM idempotency_keys WHERE key = ?', [scopedKey]);
      return null;
    }
    return JSON.parse(row.response_json) as T;
  } catch {
    return null;
  }
}

export async function insertIdempotencyRecord(
  scopedKey: string,
  scope: string,
  responseObj: any,
  ttlMs: number = 24 * 60 * 60 * 1000
): Promise<void> {
  if (!scopedKey) return;
  const now = Date.now();
  await dbRun(
    'INSERT INTO idempotency_keys (key, scope, response_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [scopedKey, scope, JSON.stringify(responseObj), now + ttlMs, new Date(now).toISOString()]
  );
}

export function isIdempotencyConflictError(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    msg.includes('UNIQUE constraint failed: idempotency_keys.key') ||
    msg.includes('UNIQUE constraint failed') && msg.includes('idempotency_keys')
  );
}
