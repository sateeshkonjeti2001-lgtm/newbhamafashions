-- Migration 0003: Atomic daily sequence allocation & database-level customer due overpayment guard
CREATE TABLE IF NOT EXISTS daily_sequences (
  seq_key TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_customer_dues_prevent_overpay
BEFORE UPDATE ON customer_dues
FOR EACH ROW
WHEN NEW.balance_due < 0 OR (OLD.status = 'CLEARED' AND NEW.amount_paid > OLD.amount_paid)
BEGIN
  SELECT RAISE(ABORT, 'OVERPAYMENT_EXCEEDS_BALANCE');
END;
