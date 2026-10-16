import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();

router.use(authMiddleware);

// Get real account balances (Cash, UPI, Bank) computed from real transactions
router.get('/accounts', (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';

    // Sum all movements into and out of CASH, UPI, BANK
    const cashIn = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'CASH'")?.s || 0;
    const cashOut = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'CASH'")?.s || 0;
    const cashBalance = cashIn - cashOut;

    const upiIn = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'UPI'")?.s || 0;
    const upiOut = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'UPI'")?.s || 0;
    const upiBalance = upiIn - upiOut;

    const bankIn = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'BANK'")?.s || 0;
    const bankOut = dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'BANK'")?.s || 0;
    const bankBalance = bankIn - bankOut;

    res.json({
      accounts: {
        cash: cashBalance,
        upi: upiBalance,
        bank: isOwner ? bankBalance : null, // cashier only deals with shop cash / shop upi
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Financial Transactions list
router.get('/transactions', (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { start_date, end_date, type, account, limit = 100 } = req.query;

    let sql = `
      SELECT 
        ft.*,
        u.full_name as user_name
      FROM financial_transactions ft
      LEFT JOIN users u ON ft.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // Cashier can only see basic day transactions, not owner capital/withdrawals/loans
    if (!isOwner) {
      sql += " AND ft.transaction_type IN ('INCOME', 'OPERATING_EXPENSE', 'CUSTOMER_DUE_COLLECTION')";
    }

    if (start_date) {
      sql += ' AND ft.date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      sql += ' AND ft.date <= ?';
      params.push(end_date);
    }
    if (type) {
      sql += ' AND ft.transaction_type = ?';
      params.push(type);
    }
    if (account) {
      sql += ' AND (ft.source_account = ? OR ft.destination_account = ?)';
      params.push(account, account);
    }

    sql += ' ORDER BY ft.date DESC, ft.created_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const transactions = dbQueryAll(sql, params);
    res.json({ transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Manual Financial Entry (Expense, Owner Capital, Withdrawal, Transfer, Other)
router.post('/transactions', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      date,
      amount,
      source_account,
      destination_account,
      transaction_type,
      person_entity,
      category,
      purpose,
      payment_method,
      reference_no,
      notes
    } = req.body;

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    if (!transaction_type || !purpose || !purpose.trim()) {
      res.status(400).json({ error: 'Transaction type and purpose are required' });
      return;
    }

    // Role check: Only OWNER can enter Capital, Withdrawal, Loans, Transfers, Asset entries
    if (
      ['OWNER_CAPITAL', 'OWNER_WITHDRAWAL', 'LOAN_RECEIVED', 'LOAN_REPAYMENT', 'ASSET_PURCHASE', 'ASSET_SALE', 'TRANSFER'].includes(transaction_type) &&
      req.user?.role !== 'OWNER'
    ) {
      res.status(403).json({ error: 'Only store Owner can record capital, withdrawals, loans, or asset movements' });
      return;
    }

    const txDate = date || new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();
    const txId = 'ftx_' + Date.now();

    // Check if the business day is already closed for this date
    const closingRecord = dbQueryOne<any>('SELECT status FROM daily_closings WHERE closing_date = ?', [txDate]);
    if (closingRecord && closingRecord.status === 'CLOSED') {
      res.status(400).json({
        error: `The business day for ${txDate} is already CLOSED. You cannot back-insert entries into a closed day. Please record as today's date or create a formal correction.`
      });
      return;
    }

    dbTransaction(() => {
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no, notes,
          is_system_generated, is_reversed, day_closed, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
      `, [
        txId,
        txDate,
        amt,
        source_account || (transaction_type === 'OPERATING_EXPENSE' ? payment_method || 'CASH' : 'EXTERNAL'),
        destination_account || (transaction_type === 'INCOME' ? payment_method || 'CASH' : 'EXTERNAL'),
        transaction_type,
        person_entity?.trim() || null,
        category?.trim() || transaction_type,
        purpose.trim(),
        payment_method || 'CASH',
        reference_no?.trim() || null,
        notes?.trim() || null,
        req.user?.id || 'STAFF',
        now,
        now
      ]);

      // If it's an operating expense, also mirror in expenses table for easy expense reporting
      if (transaction_type === 'OPERATING_EXPENSE') {
        const expId = 'exp_' + Date.now();
        dbRun(`
          INSERT INTO expenses (
            id, date, category, amount, payment_method, paid_to, purpose, reference_no, user_id, financial_tx_id, day_closed, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `, [
          expId,
          txDate,
          category?.trim() || 'General Expense',
          amt,
          payment_method || 'CASH',
          person_entity?.trim() || null,
          purpose.trim(),
          reference_no?.trim() || null,
          req.user?.id || 'STAFF',
          txId,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'USER', 'CREATE_FINANCIAL_TRANSACTION', 'FINANCIAL', txId, {
      type: transaction_type,
      amount: amt,
      purpose
    });

    res.json({ success: true, id: txId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rule 10: Manual Entry Editing & Correction Rule
// Direct edit only during the same unclosed business day
router.put('/transactions/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, purpose, category, person_entity, payment_method, notes } = req.body;

    const existing = dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    // Automatic/system-generated transaction records must not be directly editable.
    if (existing.is_system_generated) {
      res.status(400).json({
        error: 'Rule 10 Violation: System-generated transaction records (from POS billing, invoice stock-in, etc.) cannot be directly edited.'
      });
      return;
    }

    // Check if day is closed
    const today = new Date().toISOString().split('T')[0];
    const isPastDay = existing.date < today;
    const closingRecord = dbQueryOne<any>('SELECT status FROM daily_closings WHERE closing_date = ?', [existing.date]);
    const isClosed = existing.day_closed || (closingRecord && closingRecord.status === 'CLOSED');

    if (isClosed || isPastDay) {
      res.status(400).json({
        error: 'Rule 10 Violation: Direct editing is not allowed once the day is closed or a next day starts. Please use the Correction / Reversal entry workflow.'
      });
      return;
    }

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    const now = new Date().toISOString();

    dbTransaction(() => {
      dbRun(`
        UPDATE financial_transactions SET
          amount = ?,
          purpose = ?,
          category = ?,
          person_entity = ?,
          payment_method = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `, [
        amt,
        purpose?.trim() || existing.purpose,
        category?.trim() || existing.category,
        person_entity !== undefined ? (person_entity?.trim() || null) : existing.person_entity,
        payment_method || existing.payment_method,
        notes !== undefined ? (notes?.trim() || null) : existing.notes,
        now,
        id
      ]);

      // If mirrored in expenses, update it too
      dbRun(`
        UPDATE expenses SET
          amount = ?,
          purpose = ?,
          category = ?,
          paid_to = ?,
          payment_method = ?
        WHERE financial_tx_id = ?
      `, [
        amt,
        purpose?.trim() || existing.purpose,
        category?.trim() || existing.category,
        person_entity !== undefined ? (person_entity?.trim() || null) : existing.person_entity,
        payment_method || existing.payment_method,
        id
      ]);
    });

    logAudit(req.user?.id || 'USER', 'EDIT_MANUAL_TRANSACTION', 'FINANCIAL', id, {
      old_amount: existing.amount,
      new_amount: amt,
      purpose
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rule 10: Correction / Reversal Entry for past or closed days
router.post('/transactions/:id/correct', requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { new_amount, reason } = req.body;

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'Mandatory reason is required for financial correction.' });
      return;
    }

    const original = dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    if (!original) {
      res.status(404).json({ error: 'Original transaction not found' });
      return;
    }

    const newAmt = Number(new_amount);
    if (isNaN(newAmt) || newAmt < 0) {
      res.status(400).json({ error: 'Valid corrected amount is required' });
      return;
    }

    const difference = newAmt - original.amount;
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const corrId = 'corr_' + Date.now();

    dbTransaction(() => {
      // 1. Record in financial_corrections
      dbRun(`
        INSERT INTO financial_corrections (
          id, original_tx_id, correction_date, difference_amount, reason, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        corrId,
        id,
        today,
        difference,
        reason.trim(),
        req.user?.id || 'OWNER',
        now
      ]);

      // 2. Insert offsetting adjustment transaction on today's date so original history is never destroyed
      if (difference !== 0) {
        const adjTxId = 'ftx_adj_' + Date.now();
        const isIncrease = difference > 0;
        const absDiff = Math.abs(difference);

        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, is_reversed, original_tx_id, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CORRECTION', ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
        `, [
          adjTxId,
          today,
          absDiff,
          isIncrease ? original.source_account : original.destination_account,
          isIncrease ? original.destination_account : original.source_account,
          original.transaction_type,
          original.person_entity,
          `Correction of ${original.purpose} (Diff: ${difference > 0 ? '+' : ''}${difference})`,
          original.payment_method,
          `CORR-${original.id.slice(-6)}`,
          `Reason: ${reason.trim()}`,
          original.id,
          req.user?.id || 'OWNER',
          now,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'OWNER', 'FINANCIAL_CORRECTION', 'FINANCIAL', id, {
      original_amount: original.amount,
      corrected_amount: newAmt,
      difference,
      reason
    });

    res.json({ success: true, correction_id: corrId, difference });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Profit & Loss / COGS Calculation (Strict Accounting logic) - Owner only
router.get('/profit-loss', requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const start = (start_date as string) || today.substring(0, 7) + '-01'; // Default first of current month
    const end = (end_date as string) || today;

    // Real Sales Revenue (Active COMPLETED sales)
    const salesRow = dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as gross_sales,
        COALESCE(SUM(discount_amount), 0) as total_discounts,
        COUNT(*) as total_bills
      FROM sales
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
        AND (status IS NULL OR status = 'COMPLETED')
    `, [start, end]);

    // Returns / Refunds in this period
    const returnsRow = dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(refund_amount), 0) as total_refunds,
        COALESCE(SUM(cogs_reversed), 0) as total_cogs_reversed
      FROM sale_returns
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
    `, [start, end]);

    // Real COGS (from sale_items calculated via FIFO purchase batches on completed sales)
    const cogsRow = dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(si.cogs), 0) as total_cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.created_at) >= ? AND DATE(s.created_at) <= ?
        AND (s.status IS NULL OR s.status = 'COMPLETED')
    `, [start, end]);

    // Operating Expenses ONLY (Excludes inventory purchase, supplier payment, capital, withdrawal, loans)
    const expenseRow = dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_operating_expenses
      FROM financial_transactions
      WHERE transaction_type = 'OPERATING_EXPENSE'
        AND date >= ? AND date <= ?
    `, [start, end]);

    const grossSales = salesRow?.gross_sales || 0;
    const totalRefunds = returnsRow?.total_refunds || 0;
    const netRevenue = Math.max(0, grossSales - totalRefunds);

    const totalCogs = cogsRow?.total_cogs || 0;
    const returnedCogs = returnsRow?.total_cogs_reversed || 0;
    const netCogs = Math.max(0, totalCogs - returnedCogs);

    const grossProfit = netRevenue - netCogs;
    const operatingExpenses = expenseRow?.total_operating_expenses || 0;
    const netProfit = grossProfit - operatingExpenses;

    res.json({
      period: { start, end },
      revenue: netRevenue,
      grossSales,
      totalRefunds,
      cogs: netCogs,
      grossProfit,
      operatingExpenses,
      netProfit,
      totalBills: salesRow?.total_bills || 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
