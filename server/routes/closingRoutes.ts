import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();
router.use(authMiddleware);

// Get or calculate Daily Closing figures for a date
router.get('/calculate', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = (date as string) || new Date().toISOString().split('T')[0];

    // Check if closing already saved
    const existing = dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [targetDate]);

    // 1. Opening Cash:
    // If not existing or opening_cash not set, look up previous day's actual counted cash
    let openingCash = 0;
    if (existing && existing.opening_cash !== undefined) {
      openingCash = existing.opening_cash;
    } else {
      const prevClosing = dbQueryOne<any>(
        'SELECT actual_counted_cash FROM daily_closings WHERE closing_date < ? ORDER BY closing_date DESC LIMIT 1',
        [targetDate]
      );
      openingCash = prevClosing ? prevClosing.actual_counted_cash : 0;
    }

    // 2. Automatically calculated transactions for targetDate:
    // Cash Sales (only active/completed sales)
    const cashSalesRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(cash_paid), 0) as total
      FROM sales
      WHERE DATE(created_at) = ? AND (status IS NULL OR status = 'COMPLETED')
    `, [targetDate]);
    const cashSales = cashSalesRow?.total || 0;

    // UPI Sales (only active/completed sales)
    const upiSalesRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(upi_paid), 0) as total
      FROM sales
      WHERE DATE(created_at) = ? AND (status IS NULL OR status = 'COMPLETED')
    `, [targetDate]);
    const upiSales = upiSalesRow?.total || 0;

    // Other Cash In (Customer Dues collected in cash, Owner capital in cash, Loans received in cash, Transfers into cash)
    const otherCashInRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM financial_transactions
      WHERE date = ? 
        AND destination_account = 'CASH'
        AND transaction_type NOT IN ('INCOME') -- avoid double counting sales income
    `, [targetDate]);
    const cashReceivedOther = otherCashInRow?.total || 0;

    // Cash Operating Expenses
    const cashExpRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM financial_transactions
      WHERE date = ? 
        AND source_account = 'CASH'
        AND transaction_type = 'OPERATING_EXPENSE'
    `, [targetDate]);
    const cashExpenses = cashExpRow?.total || 0;

    // Other Cash Paid (Supplier payments, Staff payments, Owner withdrawals, Loan repayments, Transfers out, Returns)
    // Note: Exclude same-day void reversals since cashSales already omitted the cancelled sale.
    const otherCashOutRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(ft.amount), 0) as total
      FROM financial_transactions ft
      LEFT JOIN sales s ON ft.reference_no = ('VOID-' || s.bill_number)
      WHERE ft.date = ? 
        AND ft.source_account = 'CASH'
        AND ft.transaction_type NOT IN ('OPERATING_EXPENSE')
        AND NOT (ft.category = 'SALE_REVERSAL' AND s.created_at IS NOT NULL AND DATE(s.created_at) = ?)
    `, [targetDate, targetDate]);
    const cashPaidOther = otherCashOutRow?.total || 0;

    // Expected Closing Cash
    const expectedClosingCash = Math.round((openingCash + cashSales + cashReceivedOther - cashExpenses - cashPaidOther) * 100) / 100;

    // UPI movements for the day
    const otherUpiInRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM financial_transactions
      WHERE date = ? 
        AND destination_account = 'UPI'
        AND transaction_type NOT IN ('INCOME')
    `, [targetDate]);
    const upiReceivedOther = otherUpiInRow?.total || 0;

    const upiPaymentsRow = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM financial_transactions
      WHERE date = ? 
        AND source_account = 'UPI'
    `, [targetDate]);
    const upiPayments = upiPaymentsRow?.total || 0;

    res.json({
      date: targetDate,
      existingRecord: existing || null,
      autoCalculations: {
        openingCash,
        cashSales,
        cashReceivedOther,
        cashExpenses,
        cashPaidOther,
        expectedClosingCash,
        upiSales,
        upiReceivedOther,
        upiPayments
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit / Finalize Daily Closing
router.post('/submit', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      closing_date,
      opening_cash,
      actual_counted_cash,
      closing_notes,
      finalize // boolean: true = close day and lock records
    } = req.body;

    if (!closing_date) {
      res.status(400).json({ error: 'Closing date is required' });
      return;
    }

    if (actual_counted_cash === undefined || isNaN(Number(actual_counted_cash))) {
      res.status(400).json({ error: 'Manual physical cash count is required.' });
      return;
    }

    const openCash = Math.max(0, Number(opening_cash) || 0);
    const countedCash = Math.max(0, Number(actual_counted_cash) || 0);

    // Compute automatic sums for closing_date
    const cashSales = dbQueryOne<any>('SELECT COALESCE(SUM(cash_paid), 0) as t FROM sales WHERE DATE(created_at) = ? AND (status IS NULL OR status = \'COMPLETED\')', [closing_date])?.t || 0;
    const upiSales = dbQueryOne<any>('SELECT COALESCE(SUM(upi_paid), 0) as t FROM sales WHERE DATE(created_at) = ? AND (status IS NULL OR status = \'COMPLETED\')', [closing_date])?.t || 0;

    const cashReceivedOther = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions 
      WHERE date = ? AND destination_account = 'CASH' AND transaction_type NOT IN ('INCOME')
    `, [closing_date])?.t || 0;

    const cashExpenses = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions 
      WHERE date = ? AND source_account = 'CASH' AND transaction_type = 'OPERATING_EXPENSE'
    `, [closing_date])?.t || 0;

    const cashPaidOther = dbQueryOne<any>(`
      SELECT COALESCE(SUM(ft.amount), 0) as t
      FROM financial_transactions ft
      LEFT JOIN sales s ON ft.reference_no = ('VOID-' || s.bill_number)
      WHERE ft.date = ? 
        AND ft.source_account = 'CASH' 
        AND ft.transaction_type NOT IN ('OPERATING_EXPENSE')
        AND NOT (ft.category = 'SALE_REVERSAL' AND s.created_at IS NOT NULL AND DATE(s.created_at) = ?)
    `, [closing_date, closing_date])?.t || 0;

    const expectedClosingCash = Math.round((openCash + cashSales + cashReceivedOther - cashExpenses - cashPaidOther) * 100) / 100;
    const difference = Math.round((countedCash - expectedClosingCash) * 100) / 100;

    const upiReceivedOther = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions 
      WHERE date = ? AND destination_account = 'UPI' AND transaction_type NOT IN ('INCOME')
    `, [closing_date])?.t || 0;

    const upiPayments = dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions 
      WHERE date = ? AND source_account = 'UPI'
    `, [closing_date])?.t || 0;

    const status = finalize ? 'CLOSED' : 'OPEN';
    const now = new Date().toISOString();
    const closingId = 'close_' + closing_date.replace(/-/g, '');

    dbTransaction(() => {
      dbRun(`
        INSERT INTO daily_closings (
          id, closing_date, opening_cash, cash_sales, cash_received_other, cash_expenses,
          cash_paid_other, expected_closing_cash, actual_counted_cash, difference_cash,
          upi_sales, upi_received_other, upi_payments, closing_notes, status,
          closed_by_user_id, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(closing_date) DO UPDATE SET
          opening_cash = excluded.opening_cash,
          cash_sales = excluded.cash_sales,
          cash_received_other = excluded.cash_received_other,
          cash_expenses = excluded.cash_expenses,
          cash_paid_other = excluded.cash_paid_other,
          expected_closing_cash = excluded.expected_closing_cash,
          actual_counted_cash = excluded.actual_counted_cash,
          difference_cash = excluded.difference_cash,
          upi_sales = excluded.upi_sales,
          upi_received_other = excluded.upi_received_other,
          upi_payments = excluded.upi_payments,
          closing_notes = excluded.closing_notes,
          status = excluded.status,
          closed_by_user_id = excluded.closed_by_user_id,
          closed_at = excluded.closed_at
      `, [
        closingId,
        closing_date,
        openCash,
        cashSales,
        cashReceivedOther,
        cashExpenses,
        cashPaidOther,
        expectedClosingCash,
        countedCash,
        difference,
        upiSales,
        upiReceivedOther,
        upiPayments,
        closing_notes?.trim() || null,
        status,
        req.user?.id || 'USER',
        now
      ]);

      // If finalized, lock all sales and manual transactions on that date
      if (finalize) {
        dbRun('UPDATE sales SET day_closed = 1 WHERE DATE(created_at) = ?', [closing_date]);
        dbRun('UPDATE financial_transactions SET day_closed = 1 WHERE date = ?', [closing_date]);
        dbRun('UPDATE expenses SET day_closed = 1 WHERE date = ?', [closing_date]);
      }
    });

    logAudit(req.user?.id || 'USER', finalize ? 'CLOSE_BUSINESS_DAY' : 'UPDATE_DAILY_CLOSING', 'DAILY_CLOSING', closingId, {
      date: closing_date,
      expected: expectedClosingCash,
      actual: countedCash,
      difference,
      status
    });

    res.json({
      success: true,
      status,
      closing: {
        id: closingId,
        closing_date,
        expected_closing_cash: expectedClosingCash,
        actual_counted_cash: countedCash,
        difference_cash: difference
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List historical daily closings
router.get('/history', (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = dbQueryAll(`
      SELECT 
        dc.*,
        u.full_name as closed_by_name
      FROM daily_closings dc
      LEFT JOIN users u ON dc.closed_by_user_id = u.id
      ORDER BY dc.closing_date DESC
      LIMIT 60
    `);
    res.json({ closings: history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
