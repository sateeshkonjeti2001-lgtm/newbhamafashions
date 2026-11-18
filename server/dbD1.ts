import { AsyncLocalStorage } from 'node:async_hooks';
import type { D1Database } from '@cloudflare/workers-types';
import {
  SCHEMA_TABLES_SQL,
  SCHEMA_INDEXES_SQL,
  SCHEMA_TRIGGERS_SQL,
  CORE_ERP_TABLES,
} from './schemaSql.ts';
import { DbProvider } from './db.ts';

interface BufferedWriteOp {
  sql: string;
  params: any[];
}

interface D1TxContext {
  db: D1Database;
  ops: BufferedWriteOp[];
}

const txContextStorage = new AsyncLocalStorage<D1TxContext>();

let schemaInitializedForDb: WeakSet<object> = new WeakSet();
let schemaInitPromise: Promise<void> | null = null;

function normalizeParams(params: any[] = []): any[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

async function ensureD1Schema(db: D1Database): Promise<void> {
  if (schemaInitializedForDb.has(db)) {
    return;
  }
  if (schemaInitPromise) {
    await schemaInitPromise;
    return;
  }

  schemaInitPromise = (async () => {
    try {
      const probe = await db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('users', 'rate_limits', 'backup_snapshots', 'revoked_tokens', 'idempotency_keys', 'daily_sequences')) as tbl_cnt, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='trg_customer_dues_prevent_overpay') as trg_cnt"
        )
        .first<{ tbl_cnt: number; trg_cnt: number }>();

      if (!probe || Number(probe.tbl_cnt) < 6 || Number(probe.trg_cnt) < 1) {
        const statements = [
          ...SCHEMA_TABLES_SQL.map((sql) => db.prepare(sql)),
          ...SCHEMA_INDEXES_SQL.map((sql) => db.prepare(sql)),
          ...SCHEMA_TRIGGERS_SQL.map((sql) => db.prepare(sql)),
        ];
        await db.batch(statements);
      }

      schemaInitializedForDb.add(db);
    } finally {
      schemaInitPromise = null;
    }
  })();

  await schemaInitPromise;
}

function assertNoReadAfterWrite(db: D1Database): void {
  const ctx = txContextStorage.getStore();
  if (ctx && ctx.db === db && ctx.ops.length > 0) {
    throw new Error(
      'Atomic transaction safety guard: read-after-write is not allowed inside a D1 batch transaction. Move reads before dbTransaction().'
    );
  }
}

export function createD1DbProvider(db: D1Database): DbProvider {
  return {
    engine: 'cloudflare-d1',

    async queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      await ensureD1Schema(db);
      assertNoReadAfterWrite(db);
      const stmt = db.prepare(sql).bind(...normalizeParams(params));
      const res = await stmt.all<T>();
      return (res.results || []) as T[];
    },

    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      await ensureD1Schema(db);
      assertNoReadAfterWrite(db);
      const stmt = db.prepare(sql).bind(...normalizeParams(params));
      const row = await stmt.first<T>();
      return row ?? null;
    },

    async run(sql: string, params: any[] = []): Promise<void> {
      await ensureD1Schema(db);
      const ctx = txContextStorage.getStore();
      if (ctx && ctx.db === db) {
        ctx.ops.push({ sql, params: normalizeParams(params) });
        return;
      }
      await db.prepare(sql).bind(...normalizeParams(params)).run();
    },

    async transaction<T>(callback: () => Promise<T>): Promise<T> {
      await ensureD1Schema(db);
      const existing = txContextStorage.getStore();
      if (existing && existing.db === db) {
        // Nested transaction call joins the outer atomic batch buffer
        return await callback();
      }

      const txCtx: D1TxContext = { db, ops: [] };
      const result = await txContextStorage.run(txCtx, callback);

      if (txCtx.ops.length > 0) {
        const statements = txCtx.ops.map((op) => db.prepare(op.sql).bind(...op.params));
        await db.batch(statements);
      }

      return result;
    },

    async getStats(): Promise<Record<string, number>> {
      await ensureD1Schema(db);
      const stmts = CORE_ERP_TABLES.map((tbl) => db.prepare(`SELECT COUNT(*) as count FROM ${tbl}`));
      const results = await db.batch<{ count: number }>(stmts);
      const stats: Record<string, number> = {};
      CORE_ERP_TABLES.forEach((tbl, idx) => {
        const rows = results[idx]?.results || [];
        stats[tbl] = Number(rows[0]?.count ?? 0);
      });
      return stats;
    },

    async getDatabaseFileSize() {
      await ensureD1Schema(db);
      let sizeBytes = 0;
      try {
        const [pageCountRow, pageSizeRow] = await db.batch<{ page_count?: number; page_size?: number }>([
          db.prepare('PRAGMA page_count'),
          db.prepare('PRAGMA page_size'),
        ]);
        const count = Number((pageCountRow?.results?.[0] as any)?.page_count || 0);
        const pageSize = Number((pageSizeRow?.results?.[0] as any)?.page_size || 4096);
        sizeBytes = count * pageSize;
      } catch {
        sizeBytes = 0;
      }

      let lastModifiedAt: string | null = null;
      try {
        const latestRow = await db
          .prepare('SELECT MAX(created_at) as latest FROM audit_logs')
          .first<{ latest: string | null }>();
        lastModifiedAt = latestRow?.latest || null;
      } catch {}

      return {
        sizeBytes,
        walSizeBytes: 0,
        lastModifiedAt,
      };
    },
  };
}
