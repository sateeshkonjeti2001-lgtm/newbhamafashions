import { dbRun } from './db.ts';

export async function logAudit(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, any>
): Promise<void> {
  try {
    const id = 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();
    const detailsStr = details ? JSON.stringify(details) : null;
    await dbRun(
      'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId || 'SYSTEM', action, entityType, entityId, detailsStr, now]
    );
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
