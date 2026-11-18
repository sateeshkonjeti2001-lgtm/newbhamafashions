import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import {
  SCHEMA_TABLES_SQL,
  SCHEMA_INDEXES_SQL,
  SCHEMA_TRIGGERS_SQL,
  SCHEMA_MIGRATIONS_SQL,
  CORE_ERP_TABLES,
} from './schemaSql.ts';
import { DbProvider, registerDbProvider } from './db.ts';

let dbInstance: Database | null = null;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'bhama_store.sqlite');

let transactionDepth = 0;
let txMutex: Promise<void> = Promise.resolve();

function normalizeParams(params: any[] = []): any[] {
  return params.map((p) => (p === undefined ? null : p));
}

function saveDbSync(force: boolean = false): void {
  if (!dbInstance) return;
  if (transactionDepth > 0 && !force) {
    return;
  }
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, buffer);
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Failed to save sqlite database to disk:', err);
  }
}

function initSchema(db: Database) {
  for (const stmt of SCHEMA_TABLES_SQL) {
    db.run(stmt);
  }
  for (const idx of SCHEMA_INDEXES_SQL) {
    db.run(idx);
  }
  for (const trg of SCHEMA_TRIGGERS_SQL) {
    db.run(trg);
  }
  for (const m of SCHEMA_MIGRATIONS_SQL) {
    try {
      db.run(m);
    } catch {
      // Column already exists
    }
  }
}

function cleanupMockDataIfPresent(db: Database) {
  try {
    db.run('PRAGMA foreign_keys = OFF;');
    db.run(`
      DELETE FROM sale_return_items WHERE sale_id IN (
        SELECT id FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%'
      );
    `);
    db.run(`
      DELETE FROM sale_items WHERE sale_id IN (
        SELECT id FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%'
      );
    `);
    db.run(`
      DELETE FROM customer_due_payments WHERE customer_due_id IN (
        SELECT id FROM customer_dues WHERE sale_id IN (
          SELECT id FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%'
        )
      );
    `);
    db.run(`
      DELETE FROM customer_dues WHERE sale_id IN (
        SELECT id FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%'
      );
    `);
    db.run(`
      DELETE FROM financial_transactions WHERE reference_no IN (
        SELECT bill_number FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%'
      ) OR id LIKE 'ftx_manual_%test%' OR reference_no LIKE 'INV-VERIF-%';
    `);
    db.run(`
      DELETE FROM sales WHERE id LIKE 'sale_hist_%' OR bill_number LIKE 'HW-TEST%' OR id LIKE '%test%' OR bill_number LIKE '%TEST%' OR bill_number LIKE 'HW-%';
    `);

    db.run(`
      DELETE FROM purchase_items WHERE purchase_id IN (
        SELECT id FROM purchases WHERE invoice_number LIKE 'INV-VERIF-%' OR notes LIKE '%test%'
      );
    `);
    db.run(`
      DELETE FROM purchase_batches WHERE purchase_item_id IN (
        SELECT id FROM purchase_items WHERE purchase_id IN (
          SELECT id FROM purchases WHERE invoice_number LIKE 'INV-VERIF-%' OR notes LIKE '%test%'
        )
      );
    `);
    db.run(`
      DELETE FROM purchases WHERE invoice_number LIKE 'INV-VERIF-%' OR notes LIKE '%test%';
    `);

    db.run(`
      DELETE FROM stock_ledger WHERE product_id IN (
        SELECT id FROM products WHERE barcode LIKE 'VERIF-%' OR name LIKE 'Verification Silk Saree%' OR sku LIKE 'SKU-IDEM%' OR sku LIKE 'SKU-T1-%'
      );
    `);
    db.run(`
      DELETE FROM purchase_batches WHERE product_id IN (
        SELECT id FROM products WHERE barcode LIKE 'VERIF-%' OR name LIKE 'Verification Silk Saree%' OR sku LIKE 'SKU-IDEM%' OR sku LIKE 'SKU-T1-%'
      );
    `);
    db.run(`
      DELETE FROM product_variants WHERE product_id IN (
        SELECT id FROM products WHERE barcode LIKE 'VERIF-%' OR name LIKE 'Verification Silk Saree%' OR sku LIKE 'SKU-IDEM%' OR sku LIKE 'SKU-T1-%'
      );
    `);
    db.run(`
      DELETE FROM products WHERE barcode LIKE 'VERIF-%' OR name LIKE 'Verification Silk Saree%' OR sku LIKE 'SKU-IDEM%' OR sku LIKE 'SKU-T1-%';
    `);

    db.run(`
      DELETE FROM customers WHERE name LIKE 'K. Ramesh Rao 1792%' OR (notes = 'Added via manual bill entry' AND total_purchases = 0 AND total_dues = 0);
    `);

    db.run('PRAGMA foreign_keys = ON;');
  } catch (err) {
    console.error('[Mock Cleanup] Error:', err);
    try { db.run('PRAGMA foreign_keys = ON;'); } catch {}
  }
}

function migrateDualOwnerIfPresent(db: Database) {
  try {
    const stmt = db.prepare("SELECT id, username, full_name, phone, created_at FROM users WHERE role = 'OWNER' ORDER BY created_at ASC");
    const owners: any[] = [];
    while (stmt.step()) {
      owners.push(stmt.getAsObject());
    }
    stmt.free();

    if (owners.length > 1) {
      const now = new Date().toISOString();
      for (let i = 1; i < owners.length; i++) {
        const secondary = owners[i];
        db.run("UPDATE users SET role = 'CASHIER', updated_at = ? WHERE id = ?", [now, secondary.id]);
      }
    }
  } catch (err) {
    console.error('[Data Migration] Error checking dual owner configuration:', err);
  }
}

function syncManualSalesFinancialTransactions(db: Database) {
  try {
    const stmt = db.prepare(`
      SELECT s.id, s.bill_number, s.customer_name, s.cash_paid, s.upi_paid, s.created_at, s.cashier_id
      FROM sales s
      WHERE s.channel = 'MANUAL'
        AND (s.status IS NULL OR s.status = 'COMPLETED')
        AND (s.cash_paid > 0 OR s.upi_paid > 0)
    `);
    const manualSales: any[] = [];
    while (stmt.step()) {
      manualSales.push(stmt.getAsObject());
    }
    stmt.free();

    for (const sale of manualSales) {
      const dateStr = (sale.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0];
      const customerName = sale.customer_name || 'Walk-in Customer';

      if (sale.cash_paid > 0) {
        const checkStmt = db.prepare("SELECT id FROM financial_transactions WHERE reference_no = ? AND destination_account = 'CASH' LIMIT 1");
        checkStmt.bind([sale.bill_number]);
        const exists = checkStmt.step();
        checkStmt.free();

        if (!exists) {
          const txId = 'ftx_manual_cash_' + sale.id;
          db.run(`
            INSERT INTO financial_transactions (
              id, date, amount, source_account, destination_account, transaction_type,
              person_entity, category, purpose, payment_method, reference_no,
              is_system_generated, user_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'EXTERNAL', 'CASH', 'INCOME', ?, 'SALES', ?, 'CASH', ?, 1, ?, ?, ?)
          `, [
            txId,
            dateStr,
            sale.cash_paid,
            customerName,
            `Manual Bill #${sale.bill_number}`,
            sale.bill_number,
            sale.cashier_id || 'CASHIER',
            sale.created_at,
            sale.created_at,
          ]);
        }
      }

      if (sale.upi_paid > 0) {
        const checkStmt = db.prepare("SELECT id FROM financial_transactions WHERE reference_no = ? AND destination_account = 'UPI' LIMIT 1");
        checkStmt.bind([sale.bill_number]);
        const exists = checkStmt.step();
        checkStmt.free();

        if (!exists) {
          const txId = 'ftx_manual_upi_' + sale.id;
          db.run(`
            INSERT INTO financial_transactions (
              id, date, amount, source_account, destination_account, transaction_type,
              person_entity, category, purpose, payment_method, reference_no,
              is_system_generated, user_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'EXTERNAL', 'UPI', 'INCOME', ?, 'SALES', ?, 'UPI', ?, 1, ?, ?, ?)
          `, [
            txId,
            dateStr,
            sale.upi_paid,
            customerName,
            `Manual Bill #${sale.bill_number}`,
            sale.bill_number,
            sale.cashier_id || 'CASHIER',
            sale.created_at,
            sale.created_at,
          ]);
        }
      }
    }
  } catch (err) {
    console.error('[Data Migration] Error syncing manual sales financial transactions:', err);
  }
}

function queryAllSync<T = any>(sql: string, params: any[] = []): T[] {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sql);
  stmt.bind(normalizeParams(params));
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

export const nodeDbProvider: DbProvider = {
  engine: 'sqlite-node',

  async queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return queryAllSync<T>(sql, params);
  },

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = queryAllSync<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  },

  async run(sql: string, params: any[] = []): Promise<void> {
    if (!dbInstance) throw new Error('Database not initialized');
    dbInstance.run(sql, normalizeParams(params));
    saveDbSync();
  },

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    // Re-entrant nested transaction inside same async chain
    if (transactionDepth > 0) {
      transactionDepth++;
      const savepointName = `sp_${transactionDepth}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      dbInstance!.run(`SAVEPOINT ${savepointName};`);
      try {
        const result = await callback();
        dbInstance!.run(`RELEASE SAVEPOINT ${savepointName};`);
        transactionDepth--;
        return result;
      } catch (error) {
        try {
          dbInstance!.run(`ROLLBACK TO SAVEPOINT ${savepointName};`);
          dbInstance!.run(`RELEASE SAVEPOINT ${savepointName};`);
        } catch {}
        transactionDepth = Math.max(0, transactionDepth - 1);
        throw error;
      }
    }

    // Serialize top-level transactions via mutex
    let release!: () => void;
    const prev = txMutex;
    txMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;

    if (!dbInstance) {
      release();
      throw new Error('Database not initialized');
    }

    transactionDepth = 1;
    dbInstance.run('BEGIN TRANSACTION;');
    try {
      const result = await callback();
      dbInstance.run('COMMIT;');
      transactionDepth = 0;
      saveDbSync(true);
      return result;
    } catch (error) {
      try {
        dbInstance.run('ROLLBACK;');
      } catch (rbErr) {
        console.warn('[DB Rollback Warning]:', rbErr);
      } finally {
        transactionDepth = 0;
      }
      throw error;
    } finally {
      release();
    }
  },

  save(force: boolean = false) {
    saveDbSync(force);
  },

  async exportBuffer(): Promise<Uint8Array> {
    if (!dbInstance) throw new Error('Database not initialized');
    saveDbSync();
    return Buffer.from(dbInstance.export());
  },

  async reloadFromBuffer(newBuffer: Uint8Array): Promise<{ success: boolean; error?: string }> {
    try {
      const SQL = await initSqlJs();
      const testDb = new SQL.Database(newBuffer);
      testDb.run('PRAGMA foreign_keys = ON;');

      const integrityStmt = testDb.prepare('PRAGMA integrity_check;');
      let integrityPassed = false;
      if (integrityStmt.step()) {
        const res = integrityStmt.getAsObject();
        integrityPassed = Object.values(res)[0] === 'ok';
      }
      integrityStmt.free();

      if (!integrityPassed) {
        testDb.close();
        return { success: false, error: 'Database buffer failed SQLite integrity check' };
      }

      const requiredTables = [
        'users',
        'store_settings',
        'products',
        'sales',
        'sale_items',
        'purchases',
        'stock_ledger',
        'audit_logs',
      ];
      const tablesStmt = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table';");
      const existingTables: string[] = [];
      while (tablesStmt.step()) {
        existingTables.push(String(tablesStmt.getAsObject().name));
      }
      tablesStmt.free();

      for (const reqTable of requiredTables) {
        if (!existingTables.includes(reqTable)) {
          testDb.close();
          return { success: false, error: `Backup is missing required table: ${reqTable}` };
        }
      }

      const tmpFile = DB_FILE + '.restore.tmp';
      fs.writeFileSync(tmpFile, Buffer.from(newBuffer));
      fs.renameSync(tmpFile, DB_FILE);

      if (dbInstance) {
        try {
          dbInstance.close();
        } catch {}
      }

      dbInstance = testDb;
      initSchema(dbInstance);
      migrateDualOwnerIfPresent(dbInstance);
      saveDbSync();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown database reload error' };
    }
  },

  async getStats(): Promise<Record<string, number>> {
    if (!dbInstance) return {};
    const stats: Record<string, number> = {};
    for (const tbl of CORE_ERP_TABLES) {
      try {
        const rows = queryAllSync<{ count: number }>(`SELECT COUNT(*) as count FROM ${tbl}`);
        stats[tbl] = rows[0]?.count ?? 0;
      } catch {
        stats[tbl] = 0;
      }
    }
    return stats;
  },

  async getDatabaseFileSize() {
    let sizeBytes = 0;
    let walSizeBytes = 0;
    let lastModifiedAt: string | null = null;
    try {
      if (fs.existsSync(DB_FILE)) {
        const st = fs.statSync(DB_FILE);
        sizeBytes = st.size;
        lastModifiedAt = st.mtime.toISOString();
      } else if (dbInstance) {
        sizeBytes = dbInstance.export().length;
      }
    } catch {}
    try {
      const walPath = `${DB_FILE}-wal`;
      const shmPath = `${DB_FILE}-shm`;
      if (fs.existsSync(walPath)) walSizeBytes += fs.statSync(walPath).size;
      if (fs.existsSync(shmPath)) walSizeBytes += fs.statSync(shmPath).size;
    } catch {}
    return { sizeBytes, walSizeBytes, lastModifiedAt };
  },
};

export async function initNodeDatabase(): Promise<Database> {
  if (dbInstance) {
    registerDbProvider(nodeDbProvider);
    return dbInstance;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.run('PRAGMA foreign_keys = ON;');
  initSchema(dbInstance);
  cleanupMockDataIfPresent(dbInstance);
  migrateDualOwnerIfPresent(dbInstance);
  syncManualSalesFinancialTransactions(dbInstance);
  saveDbSync(true);

  registerDbProvider(nodeDbProvider);
  return dbInstance;
}
