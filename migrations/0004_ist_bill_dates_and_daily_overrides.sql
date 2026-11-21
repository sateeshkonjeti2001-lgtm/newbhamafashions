-- Migration 0004: IST business bill dates, post-close audit flags, and reversible operational ledgers (non-destructive)

ALTER TABLE sales ADD COLUMN bill_date TEXT;
UPDATE sales SET bill_date = DATE(created_at, '+330 minutes') WHERE bill_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_bill_date ON sales(bill_date);

ALTER TABLE daily_closings ADD COLUMN actual_upi_counted REAL;
ALTER TABLE daily_closings ADD COLUMN cash_left_in_drawer REAL;
ALTER TABLE daily_closings ADD COLUMN cash_taken_home REAL;
ALTER TABLE daily_closings ADD COLUMN discrepancy_reason TEXT;
ALTER TABLE daily_closings ADD COLUMN modified_after_close INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_closings ADD COLUMN last_modified_at TEXT;
ALTER TABLE daily_closings ADD COLUMN last_modified_by TEXT;
ALTER TABLE daily_closings ADD COLUMN last_modification_summary TEXT;

ALTER TABLE customer_due_payments ADD COLUMN is_reversed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_due_payments ADD COLUMN reversed_reason TEXT;
ALTER TABLE customer_due_payments ADD COLUMN reversed_at TEXT;
ALTER TABLE customer_due_payments ADD COLUMN reversed_by TEXT;

ALTER TABLE salary_payments ADD COLUMN is_reversed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN reversed_reason TEXT;
ALTER TABLE salary_payments ADD COLUMN reversed_at TEXT;
ALTER TABLE salary_payments ADD COLUMN reversed_by TEXT;

ALTER TABLE purchases ADD COLUMN is_reversed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN reversed_reason TEXT;
ALTER TABLE purchases ADD COLUMN reversed_at TEXT;
ALTER TABLE purchases ADD COLUMN reversed_by TEXT;
