import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: Database | null = null;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'bhama_store.sqlite');

export async function getDb(): Promise<Database> {
  if (dbInstance) {
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

  // Enable foreign keys
  dbInstance.run('PRAGMA foreign_keys = ON;');

  // Initialize schema if not exists
  initSchema(dbInstance);
  cleanupMockDataIfPresent(dbInstance);
  migrateDualOwnerIfPresent(dbInstance);
  syncManualSalesFinancialTransactions(dbInstance);
  saveDb(true);

  return dbInstance;
}

let transactionDepth = 0;

export function isInTransaction(): boolean {
  return transactionDepth > 0;
}

export function saveDb(force: boolean = false): void {
  if (!dbInstance) return;
  // If we are currently inside an active database transaction, do NOT export.
  // In sql.js (WebAssembly SQLite), calling db.export() serializes the memory pages
  // and resets/aborts the active SQLite transaction state.
  if (transactionDepth > 0 && !force) {
    return;
  }
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to save sqlite database to disk:', err);
  }
}


function initSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('OWNER', 'CASHIER')),
      phone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      description TEXT,
      attributes_schema TEXT, -- JSON array of category-specific attribute names e.g. ["Fabric", "Occasion", "Pattern"]
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      brand_id TEXT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      brand_id TEXT,
      model_id TEXT,
      name TEXT NOT NULL,
      code TEXT,
      sku TEXT UNIQUE,
      barcode TEXT UNIQUE,
      description TEXT,
      tags TEXT,
      mrp REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      purchase_cost REAL NOT NULL DEFAULT 0,
      festival_discount REAL NOT NULL DEFAULT 0,
      category_attributes TEXT, -- JSON key-value pairs
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sales_channel TEXT NOT NULL DEFAULT 'OFFLINE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      size TEXT,
      color TEXT,
      sku TEXT UNIQUE,
      barcode TEXT UNIQUE,
      mrp REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      purchase_cost REAL NOT NULL DEFAULT 0,
      festival_discount REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      gst_or_pan TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      total_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('PAID', 'PARTIAL', 'UNPAID')),
      payment_method TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      batch_number TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_batches (
      id TEXT PRIMARY KEY,
      purchase_item_id TEXT,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      batch_number TEXT NOT NULL,
      initial_qty INTEGER NOT NULL,
      remaining_qty INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      received_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_ledger (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      batch_id TEXT,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('PURCHASE', 'SALE', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'DAMAGE', 'WRITE_OFF', 'ADJUSTMENT')),
      quantity INTEGER NOT NULL, -- positive for stock in, negative for stock out
      unit_cost REAL,
      reference_type TEXT NOT NULL CHECK(reference_type IN ('PURCHASE', 'SALE', 'RETURN', 'MANUAL_ADJUSTMENT', 'WRITE_OFF')),
      reference_id TEXT,
      reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      total_purchases REAL NOT NULL DEFAULT 0,
      total_dues REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      bill_number TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      total_mrp REAL DEFAULT 0,
      subtotal REAL NOT NULL,
      festival_discount REAL NOT NULL DEFAULT 0,
      special_discount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      discount_type TEXT DEFAULT 'AMOUNT',
      total_amount REAL NOT NULL,
      amount_paid REAL NOT NULL,
      balance_due REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('PAID', 'PARTIAL', 'UNPAID')),
      payment_method TEXT NOT NULL, -- CASH, UPI, CARD, SPLIT, CREDIT
      cash_paid REAL DEFAULT 0,
      upi_paid REAL DEFAULT 0,
      card_paid REAL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'OFFLINE',
      notes TEXT,
      cashier_id TEXT,
      day_closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      product_name TEXT NOT NULL,
      variant_desc TEXT,
      quantity INTEGER NOT NULL,
      mrp REAL NOT NULL,
      unit_price REAL NOT NULL,
      festival_discount REAL NOT NULL DEFAULT 0,
      special_discount REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL,
      cogs REAL NOT NULL DEFAULT 0, -- FIFO calculated cost of goods sold
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customer_dues (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      sale_id TEXT,
      original_due REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'CLEARED')),
      due_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS customer_due_payments (
      id TEXT PRIMARY KEY,
      customer_due_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'UPI', 'BANK')),
      notes TEXT,
      received_by TEXT,
      financial_tx_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_due_id) REFERENCES customer_dues(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      source_account TEXT NOT NULL CHECK(source_account IN ('CASH', 'UPI', 'BANK', 'EXTERNAL')),
      destination_account TEXT NOT NULL CHECK(destination_account IN ('CASH', 'UPI', 'BANK', 'EXTERNAL')),
      transaction_type TEXT NOT NULL CHECK(transaction_type IN (
        'INCOME',
        'OPERATING_EXPENSE',
        'SUPPLIER_PAYMENT',
        'STAFF_PAYMENT',
        'OWNER_CAPITAL',
        'OWNER_WITHDRAWAL',
        'LOAN_RECEIVED',
        'LOAN_REPAYMENT',
        'ASSET_PURCHASE',
        'ASSET_SALE',
        'TRANSFER',
        'CUSTOMER_DUE_COLLECTION',
        'OTHER'
      )),
      person_entity TEXT,
      category TEXT,
      purpose TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      reference_no TEXT,
      notes TEXT,
      is_system_generated INTEGER NOT NULL DEFAULT 0,
      is_reversed INTEGER NOT NULL DEFAULT 0,
      original_tx_id TEXT,
      day_closed INTEGER NOT NULL DEFAULT 0,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS financial_corrections (
      id TEXT PRIMARY KEY,
      original_tx_id TEXT NOT NULL,
      correction_date TEXT NOT NULL,
      difference_amount REAL NOT NULL,
      reason TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (original_tx_id) REFERENCES financial_transactions(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'UPI', 'BANK')),
      paid_to TEXT,
      purpose TEXT NOT NULL,
      reference_no TEXT,
      user_id TEXT,
      financial_tx_id TEXT,
      day_closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      role_title TEXT NOT NULL,
      monthly_salary REAL NOT NULL DEFAULT 0,
      joining_date TEXT NOT NULL,
      address TEXT,
      emergency_contact TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')),
      check_in_time TEXT,
      check_out_time TEXT,
      notes TEXT,
      marked_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(staff_id, date),
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS salary_payments (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      payment_type TEXT NOT NULL CHECK(payment_type IN ('SALARY', 'ADVANCE')),
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'UPI', 'BANK')),
      notes TEXT,
      paid_by TEXT,
      financial_tx_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS daily_closings (
      id TEXT PRIMARY KEY,
      closing_date TEXT UNIQUE NOT NULL,
      opening_cash REAL NOT NULL DEFAULT 0,
      cash_sales REAL NOT NULL DEFAULT 0,
      cash_received_other REAL NOT NULL DEFAULT 0,
      cash_expenses REAL NOT NULL DEFAULT 0,
      cash_paid_other REAL NOT NULL DEFAULT 0,
      expected_closing_cash REAL NOT NULL DEFAULT 0,
      actual_counted_cash REAL NOT NULL DEFAULT 0,
      difference_cash REAL NOT NULL DEFAULT 0,
      upi_sales REAL NOT NULL DEFAULT 0,
      upi_received_other REAL NOT NULL DEFAULT 0,
      upi_payments REAL NOT NULL DEFAULT 0,
      closing_notes TEXT,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED')),
      closed_by_user_id TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      purchase_value REAL NOT NULL,
      funding_source TEXT NOT NULL, -- OWN_FUNDS, LOAN, OTHER
      loan_id TEXT,
      current_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(current_status IN ('ACTIVE', 'SOLD', 'DISPOSED')),
      disposal_date TEXT,
      disposal_value REAL,
      disposal_notes TEXT,
      profit_or_loss REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      lender_name TEXT NOT NULL,
      loan_amount REAL NOT NULL,
      loan_date TEXT NOT NULL,
      interest_info TEXT,
      total_repaid REAL NOT NULL DEFAULT 0,
      outstanding_balance REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CLOSED')),
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_repayments (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      repayment_date TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'UPI', 'BANK')),
      notes TEXT,
      financial_tx_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (loan_id) REFERENCES loans(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_returns (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      bill_number TEXT NOT NULL,
      return_number TEXT UNIQUE NOT NULL,
      refund_amount REAL NOT NULL,
      cogs_reversed REAL NOT NULL DEFAULT 0,
      refund_method TEXT NOT NULL CHECK(refund_method IN ('CASH', 'UPI', 'CREDIT_ADJUSTMENT')),
      reason TEXT NOT NULL,
      returned_by TEXT NOT NULL,
      returned_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS sale_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      sale_item_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      refund_amount REAL NOT NULL,
      cogs_reversed REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS backup_history (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      backup_type TEXT NOT NULL CHECK(backup_type IN ('MANUAL', 'AUTOMATIC', 'PRE_RESTORE')),
      file_size INTEGER NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED')),
      verification_status TEXT NOT NULL CHECK(verification_status IN ('VERIFIED', 'FAILED', 'UNCHECKED')),
      verification_details TEXT,
      table_counts TEXT,
      error_message TEXT,
      created_by TEXT,
      created_by_name TEXT,
      notes TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    -- Create indexes for fast lookup and uniqueness
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);
    CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_ledger_prod ON stock_ledger(product_id);
    CREATE INDEX IF NOT EXISTS idx_financial_tx_date ON financial_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_daily_closing_date ON daily_closings(closing_date);
    CREATE INDEX IF NOT EXISTS idx_returns_sale_id ON sale_returns(sale_id);
    CREATE INDEX IF NOT EXISTS idx_returns_date ON sale_returns(created_at);
    CREATE INDEX IF NOT EXISTS idx_backup_created ON backup_history(created_at);
  `);

  // Safe idempotent migrations for existing databases
  const migrations = [
    'ALTER TABLE products ADD COLUMN festival_discount REAL NOT NULL DEFAULT 0;',
    'ALTER TABLE product_variants ADD COLUMN festival_discount REAL NOT NULL DEFAULT 0;',
    'ALTER TABLE sales ADD COLUMN total_mrp REAL DEFAULT 0;',
    'ALTER TABLE sales ADD COLUMN festival_discount REAL NOT NULL DEFAULT 0;',
    'ALTER TABLE sales ADD COLUMN special_discount REAL NOT NULL DEFAULT 0;',
    'ALTER TABLE sale_items ADD COLUMN festival_discount REAL NOT NULL DEFAULT 0;',
    'ALTER TABLE sale_items ADD COLUMN special_discount REAL NOT NULL DEFAULT 0;',
    "ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED';",
    'ALTER TABLE sales ADD COLUMN cancelled_at TEXT;',
    'ALTER TABLE sales ADD COLUMN cancelled_by TEXT;',
    'ALTER TABLE sales ADD COLUMN cancelled_by_name TEXT;',
    'ALTER TABLE sales ADD COLUMN cancelled_reason TEXT;',
    'ALTER TABLE sales ADD COLUMN card_paid REAL DEFAULT 0;',
  ];

  for (const m of migrations) {
    try {
      db.run(m);
    } catch {
      // Column already added or not needed
    }
  }
}

function cleanupMockDataIfPresent(db: Database) {
  try {
    db.run('PRAGMA foreign_keys = OFF;');
    // 1. Delete mock / test sales and their dependent rows
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

    // 2. Delete test purchases and batches
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

    // 3. Delete test products
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

    // 4. Remove test customers created by verification suites
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

    // If more than 1 owner exists, consolidate to 1 primary Owner while preserving historical transactions and audit trail
    if (owners.length > 1) {
      console.log(`[Data Migration] Found ${owners.length} owner accounts. Consolidating to 1 primary Owner account.`);
      const now = new Date().toISOString();
      for (let i = 1; i < owners.length; i++) {
        const secondary = owners[i];
        // Demote secondary owner to CASHIER role so that all historical foreign keys, bills, and audits are preserved
        db.run("UPDATE users SET role = 'CASHIER', updated_at = ? WHERE id = ?", [now, secondary.id]);
        console.log(`[Data Migration] Converted secondary owner "${secondary.username}" (${secondary.full_name}) to staff account to preserve transaction references.`);
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
            sale.created_at
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
            sale.created_at
          ]);
        }
      }
    }
  } catch (err) {
    console.error('[Data Migration] Error syncing manual sales financial transactions:', err);
  }
}

// Database helper functions to cleanly run parameterized queries
export function dbQueryAll<T = any>(sql: string, params: any[] = []): T[] {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

export function dbQueryOne<T = any>(sql: string, params: any[] = []): T | null {
  const rows = dbQueryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function dbRun(sql: string, params: any[] = []): void {
  if (!dbInstance) throw new Error('Database not initialized');
  dbInstance.run(sql, params);
  saveDb();
}

export function dbTransaction<T>(callback: () => T): T {
  if (!dbInstance) throw new Error('Database not initialized');

  transactionDepth++;
  const isTopLevel = transactionDepth === 1;
  const savepointName = `sp_${transactionDepth}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (isTopLevel) {
    dbInstance.run('BEGIN TRANSACTION;');
  } else {
    dbInstance.run(`SAVEPOINT ${savepointName};`);
  }

  try {
    const result = callback();
    if (result && typeof (result as any).then === 'function') {
      throw new Error('dbTransaction callback must be synchronous; async transactions are not supported by SQLite WASM engine.');
    }

    if (isTopLevel) {
      dbInstance.run('COMMIT;');
      transactionDepth = 0;
      // Persist the entire committed atomic transaction to disk
      saveDb(true);
    } else {
      dbInstance.run(`RELEASE SAVEPOINT ${savepointName};`);
      transactionDepth--;
    }
    return result;
  } catch (error: any) {
    // Attempt rollback cleanly without masking the original underlying error
    try {
      if (isTopLevel) {
        dbInstance.run('ROLLBACK;');
      } else {
        dbInstance.run(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        dbInstance.run(`RELEASE SAVEPOINT ${savepointName};`);
      }
    } catch (rbError: any) {
      // In SQLite, if the transaction was already rolled back due to a fatal error
      // or if no transaction remains active, do NOT let the rollback error overwrite
      // the real root cause exception that triggered the rollback!
      console.warn('[DB Rollback Warning]:', rbError?.message || rbError);
    } finally {
      if (isTopLevel) {
        transactionDepth = 0;
      } else {
        transactionDepth = Math.max(0, transactionDepth - 1);
      }
    }
    throw error;
  }
}


export function exportDatabaseBuffer(): Buffer {
  if (!dbInstance) throw new Error('Database not initialized');
  saveDb();
  const data = dbInstance.export();
  return Buffer.from(data);
}

export async function reloadDatabaseFromBuffer(newBuffer: Buffer): Promise<{ success: boolean; error?: string }> {
  try {
    const SQL = await initSqlJs();
    // 1. Test opening the buffer in an isolated temporary DB
    const testDb = new SQL.Database(newBuffer);
    testDb.run('PRAGMA foreign_keys = ON;');

    // 2. Run integrity check
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

    // 3. Verify required core tables exist
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

    // 4. Atomically write to disk: write to a .restore.tmp file first, then atomic rename
    const tmpFile = DB_FILE + '.restore.tmp';
    fs.writeFileSync(tmpFile, newBuffer);
    fs.renameSync(tmpFile, DB_FILE);

    // 5. Replace current dbInstance
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch {
        // ignore close error
      }
    }

    dbInstance = testDb;
    initSchema(dbInstance);
    migrateDualOwnerIfPresent(dbInstance);
    saveDb();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown database reload error' };
  }
}

export function getDatabaseStats(): Record<string, number> {
  if (!dbInstance) return {};
  const tables = [
    'users',
    'store_settings',
    'categories',
    'brands',
    'models',
    'products',
    'product_variants',
    'suppliers',
    'purchases',
    'purchase_items',
    'purchase_batches',
    'stock_ledger',
    'customers',
    'sales',
    'sale_items',
    'customer_dues',
    'customer_due_payments',
    'financial_transactions',
    'financial_corrections',
    'expenses',
    'staff',
    'attendance',
    'salary_payments',
    'daily_closings',
    'assets',
    'loans',
    'loan_repayments',
    'sale_returns',
    'sale_return_items',
    'audit_logs',
    'backup_history',
  ];

  const stats: Record<string, number> = {};
  for (const tbl of tables) {
    try {
      const row = dbQueryOne<{ count: number }>(`SELECT COUNT(*) as count FROM ${tbl}`);
      stats[tbl] = row?.count ?? 0;
    } catch {
      stats[tbl] = 0;
    }
  }
  return stats;
}
