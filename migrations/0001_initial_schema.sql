-- New Bhama Fashions ERP - Initial Cloudflare D1 / SQLite Schema
-- Preserves all 32 core ERP tables, relationships, and indexes plus D1 rate_limits & backup_snapshots

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
  attributes_schema TEXT,
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
  category_attributes TEXT,
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
  quantity INTEGER NOT NULL,
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
  payment_method TEXT NOT NULL,
  cash_paid REAL DEFAULT 0,
  upi_paid REAL DEFAULT 0,
  card_paid REAL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'OFFLINE',
  notes TEXT,
  cashier_id TEXT,
  day_closed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancelled_by_name TEXT,
  cancelled_reason TEXT,
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
  cogs REAL NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  purchase_value REAL NOT NULL,
  funding_source TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id TEXT PRIMARY KEY,
  sql_dump TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  response_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_exp ON idempotency_keys(expires_at);
