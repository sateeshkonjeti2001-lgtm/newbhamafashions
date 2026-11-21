-- New Bhama Fashions ERP — Fresh Start Cleanup for Live Launch (November 21, 2026)
-- Non-destructive row reset: NO DROP TABLE, NO TRUNCATE, preserves schema & d1_migrations.
-- Preserved: active OWNER user(s), store_settings, backup_settings, schema/indexes/triggers.
-- Note: Explicit BEGIN/COMMIT omitted for Cloudflare D1 remote `--file` compatibility.

-- 1. Auth & request cache tables
DELETE FROM idempotency_keys;
DELETE FROM rate_limits;
DELETE FROM revoked_tokens;

-- 2. Sales, returns & customer due ledgers (children before parents)
DELETE FROM sale_return_items;
DELETE FROM sale_returns;
DELETE FROM sale_items;
DELETE FROM customer_due_payments;
DELETE FROM customer_dues;
DELETE FROM sales;

-- 3. Money manager & expenses
DELETE FROM financial_corrections;
DELETE FROM expenses;
DELETE FROM financial_transactions;

-- 4. Purchases & stock ledgers
DELETE FROM purchase_batches;
DELETE FROM purchase_items;
DELETE FROM purchases;
DELETE FROM stock_ledger;

-- 5. Catalog, suppliers & customers
DELETE FROM product_variants;
DELETE FROM products;
DELETE FROM models;
DELETE FROM categories;
DELETE FROM brands;
DELETE FROM suppliers;
DELETE FROM customers;

-- 6. Staff attendance & payroll
DELETE FROM attendance;
DELETE FROM salary_payments;
DELETE FROM staff;

-- 7. Assets & loans
DELETE FROM loan_repayments;
DELETE FROM assets;
DELETE FROM loans;

-- 8. Daily closings, bill number sequences & old backup snapshots
DELETE FROM daily_closings;
DELETE FROM daily_sequences;
DELETE FROM backup_snapshots;
DELETE FROM backup_history;

-- 9. Clear pre-launch audit trail and remove non-owner / inactive accounts
DELETE FROM audit_logs;
DELETE FROM users WHERE role != 'OWNER' OR is_active != 1;

-- 10. Record verified Fresh Start marker in audit_logs
INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, created_at)
VALUES (
  'audit_fresh_start_2026_11_21',
  COALESCE((SELECT id FROM users WHERE role = 'OWNER' AND is_active = 1 ORDER BY created_at ASC LIMIT 1), 'SYSTEM'),
  'FRESH_START_2026_11_21',
  'SYSTEM',
  'new-bhama-fashions-erp-db',
  '{"purpose":"Production Fresh Start for 2026-11-21 live store launch","preserved":["users(active OWNER)","store_settings","backup_settings","d1_migrations"],"cleared":"All pre-launch sales, stock, purchases, dues, money, expenses, staff, closing, and test logs"}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
