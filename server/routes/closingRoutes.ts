import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { getTodayIST, isValidDateString, sqlEffectiveSaleDate } from '../dateUtil.ts';
import { verifyOwnerPasswordOverride } from '../ownerOverride.ts';

const router = new Router();
router.use(authMiddleware);

async function computeDayClosingMetrics(targetDate: string, explicitOpeningCash?: number) {
  const existing = await dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [targetDate]);

  let openingCash = 0;
  if (explicitOpeningCash !== undefined && explicitOpeningCash !== null && !Number.isNaN(Number(explicitOpeningCash))) {
    openingCash = Math.max(0, Number(explicitOpeningCash));
  } else if (existing && existing.opening_cash !== undefined && existing.opening_cash !== null) {
    openingCash = Number(existing.opening_cash) || 0;
  } else {
    const prevClosing = await dbQueryOne<any>(
      'SELECT COALESCE(cash_left_in_drawer, actual_counted_cash) as carry_cash FROM daily_closings WHERE closing_date < ? ORDER BY closing_date DESC LIMIT 1',
      [targetDate]
    );
    openingCash = prevClosing ? Number(prevClosing.carry_cash) || 0 : 0;
  }

  const cashSalesRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(cash_paid), 0) as total
     FROM sales
     WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')`,
    [targetDate]
  );
  const cashSales = Number(cashSalesRow?.total) || 0;

  const upiSalesRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(upi_paid), 0) as total
     FROM sales
     WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')`,
    [targetDate]
  );
  const upiSales = Number(upiSalesRow?.total) || 0;

  const creditSalesRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(balance_due), 0) as total
     FROM sales
     WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')`,
    [targetDate]
  );
  const dueSales = Number(creditSalesRow?.total) || 0;

  const otherCashInRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM financial_transactions
     WHERE date = ?
       AND is_reversed = 0
       AND destination_account = 'CASH'
       AND transaction_type NOT IN ('INCOME')`,
    [targetDate]
  );
  const cashReceivedOther = Number(otherCashInRow?.total) || 0;

  const cashExpRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM financial_transactions
     WHERE date = ?
       AND is_reversed = 0
       AND source_account = 'CASH'
       AND transaction_type = 'OPERATING_EXPENSE'`,
    [targetDate]
  );
  const cashExpenses = Number(cashExpRow?.total) || 0;

  const otherCashOutRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(ft.amount), 0) as total
     FROM financial_transactions ft
     LEFT JOIN sales s ON ft.reference_no = ('VOID-' || s.bill_number)
     WHERE ft.date = ?
       AND ft.is_reversed = 0
       AND ft.source_account = 'CASH'
       AND ft.transaction_type NOT IN ('OPERATING_EXPENSE')
       AND NOT (ft.category = 'SALE_REVERSAL' AND s.created_at IS NOT NULL AND ${sqlEffectiveSaleDate('s.')} = ?)`,
    [targetDate, targetDate]
  );
  const cashPaidOther = Number(otherCashOutRow?.total) || 0;

  const expectedClosingCash =
    Math.round((openingCash + cashSales + cashReceivedOther - cashExpenses - cashPaidOther) * 100) / 100;

  const otherUpiInRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM financial_transactions
     WHERE date = ?
       AND is_reversed = 0
       AND destination_account = 'UPI'
       AND transaction_type NOT IN ('INCOME')`,
    [targetDate]
  );
  const upiReceivedOther = Number(otherUpiInRow?.total) || 0;

  const upiPaymentsRow = await dbQueryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM financial_transactions
     WHERE date = ?
       AND is_reversed = 0
       AND source_account = 'UPI'`,
    [targetDate]
  );
  const upiPayments = Number(upiPaymentsRow?.total) || 0;

  return {
    existing,
    autoCalculations: {
      openingCash,
      cashSales,
      cashReceivedOther,
      cashExpenses,
      cashPaidOther,
      expectedClosingCash,
      upiSales,
      upiReceivedOther,
      upiPayments,
      dueSales,
    },
  };
}

// Get or calculate Daily Closing figures for a date
router.get('/calculate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = typeof date === 'string' && isValidDateString(date) ? date.trim() : getTodayIST();
    const { existing, autoCalculations } = await computeDayClosingMetrics(targetDate);

    res.json({
      date: targetDate,
      existingRecord: existing || null,
      autoCalculations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit / Finalize Daily Closing
router.post('/submit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      closing_date,
      opening_cash,
      actual_counted_cash,
      actual_upi_counted,
      cash_left_in_drawer,
      cash_taken_home,
      discrepancy_reason,
      closing_notes,
      finalize, // boolean: true = close day and lock records
      owner_password,
      reason,
    } = req.body;

    if (!closing_date || !isValidDateString(closing_date)) {
      res.status(400).json({ error: 'Valid closing date (YYYY-MM-DD) is required' });
      return;
    }

    if (actual_counted_cash === undefined || isNaN(Number(actual_counted_cash))) {
      res.status(400).json({ error: 'Manual physical cash count is required.' });
      return;
    }

    const existing = await dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [closing_date]);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;

    if (existing && existing.status === 'CLOSED') {
      if (req.user?.role !== 'OWNER') {
        res.status(403).json({
          error: 'This business day is already CLOSED. Only the Owner can modify or re-verify a closed day.',
        });
        return;
      }
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${closing_date} is already CLOSED. Owner password verification is required to update a closed day.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      if (!reason || !String(reason).trim()) {
        res.status(400).json({
          error: 'Mandatory reason is required when modifying an already closed business day.',
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const prevClosing = await dbQueryOne<any>(
      'SELECT COALESCE(cash_left_in_drawer, actual_counted_cash) as carry_cash FROM daily_closings WHERE closing_date < ? ORDER BY closing_date DESC LIMIT 1',
      [closing_date]
    );
    const resolvedOpening =
      opening_cash !== undefined && opening_cash !== null && opening_cash !== ''
        ? Math.max(0, Number(opening_cash) || 0)
        : existing?.opening_cash !== undefined
        ? Number(existing.opening_cash)
        : Number(prevClosing?.carry_cash || 0);

    const countedCash = Math.max(0, Number(actual_counted_cash) || 0);
    const countedUpi =
      actual_upi_counted !== undefined && actual_upi_counted !== null && actual_upi_counted !== ''
        ? Math.max(0, Number(actual_upi_counted) || 0)
        : existing?.actual_upi_counted ?? null;
    const drawerCash =
      cash_left_in_drawer !== undefined && cash_left_in_drawer !== null && cash_left_in_drawer !== ''
        ? Math.max(0, Number(cash_left_in_drawer) || 0)
        : countedCash;
    const takenHomeCash =
      cash_taken_home !== undefined && cash_taken_home !== null && cash_taken_home !== ''
        ? Math.max(0, Number(cash_taken_home) || 0)
        : Math.max(0, Math.round((countedCash - drawerCash) * 100) / 100);

    const { autoCalculations } = await computeDayClosingMetrics(closing_date, resolvedOpening);
    const {
      cashSales,
      cashReceivedOther,
      cashExpenses,
      cashPaidOther,
      expectedClosingCash,
      upiSales,
      upiReceivedOther,
      upiPayments,
    } = autoCalculations;

    const difference = Math.round((countedCash - expectedClosingCash) * 100) / 100;
    const status = finalize || existing?.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
    const now = new Date().toISOString();
    const closingId = existing?.id || 'close_' + closing_date.replace(/-/g, '');
    const isPostCloseEdit = Boolean(existing && existing.status === 'CLOSED');
    const modSummary = isPostCloseEdit
      ? `Closed day updated by Owner (${overrideOwner?.full_name}): ${String(reason).trim()}`
      : existing?.last_modification_summary || null;

    await dbTransaction(async () => {
      await dbRun(`
        INSERT INTO daily_closings (
          id, closing_date, opening_cash, cash_sales, cash_received_other, cash_expenses,
          cash_paid_other, expected_closing_cash, actual_counted_cash, difference_cash,
          upi_sales, upi_received_other, upi_payments, closing_notes, status,
          closed_by_user_id, closed_at,
          actual_upi_counted, cash_left_in_drawer, cash_taken_home, discrepancy_reason,
          modified_after_close, last_modified_at, last_modified_by, last_modification_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          closed_by_user_id = COALESCE(daily_closings.closed_by_user_id, excluded.closed_by_user_id),
          closed_at = COALESCE(daily_closings.closed_at, excluded.closed_at),
          actual_upi_counted = excluded.actual_upi_counted,
          cash_left_in_drawer = excluded.cash_left_in_drawer,
          cash_taken_home = excluded.cash_taken_home,
          discrepancy_reason = excluded.discrepancy_reason,
          modified_after_close = excluded.modified_after_close,
          last_modified_at = excluded.last_modified_at,
          last_modified_by = excluded.last_modified_by,
          last_modification_summary = excluded.last_modification_summary
      `, [
        closingId,
        closing_date,
        resolvedOpening,
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
        existing?.closed_by_user_id || req.user?.id || 'USER',
        existing?.closed_at || now,
        countedUpi,
        drawerCash,
        takenHomeCash,
        discrepancy_reason?.trim() || existing?.discrepancy_reason || null,
        isPostCloseEdit ? 1 : Number(existing?.modified_after_close || 0),
        isPostCloseEdit ? now : existing?.last_modified_at || null,
        isPostCloseEdit ? overrideOwner?.full_name || req.user?.full_name || 'Owner' : existing?.last_modified_by || null,
        modSummary,
      ]);

      if (status === 'CLOSED') {
        await dbRun(`UPDATE sales SET day_closed = 1 WHERE ${sqlEffectiveSaleDate()} = ?`, [closing_date]);
        await dbRun('UPDATE financial_transactions SET day_closed = 1 WHERE date = ?', [closing_date]);
        await dbRun('UPDATE expenses SET day_closed = 1 WHERE date = ?', [closing_date]);
      }
    });

    saveDb(true);

    await logAudit(
      req.user?.id || 'USER',
      isPostCloseEdit ? 'OWNER_OVERRIDE_EDIT_CLOSED_DAY' : finalize ? 'CLOSE_BUSINESS_DAY' : 'UPDATE_DAILY_CLOSING',
      'DAILY_CLOSING',
      closingId,
      {
        date: closing_date,
        reason: reason?.trim() || null,
        override_authorized_by: overrideOwner?.full_name || null,
        before: existing || null,
        after: {
          opening_cash: resolvedOpening,
          expected_closing_cash: expectedClosingCash,
          actual_counted_cash: countedCash,
          difference_cash: difference,
          actual_upi_counted: countedUpi,
          cash_left_in_drawer: drawerCash,
          cash_taken_home: takenHomeCash,
          status,
        },
      }
    );

    res.json({
      success: true,
      status,
      closing: {
        id: closingId,
        closing_date,
        expected_closing_cash: expectedClosingCash,
        actual_counted_cash: countedCash,
        difference_cash: difference,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Owner Reconcile / Re-verify a Closed Day (recalculates system totals from live DB + optionally updates notes/discrepancy reason)
router.post('/:date/reconcile', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date } = req.params;
    const {
      owner_password,
      reason,
      actual_counted_cash,
      actual_upi_counted,
      cash_left_in_drawer,
      cash_taken_home,
      discrepancy_reason,
      closing_notes,
    } = req.body;

    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Valid closing date (YYYY-MM-DD) is required.' });
      return;
    }

    const existing = await dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [date]);
    if (!existing) {
      res.status(404).json({ error: `No daily closing record found for ${date}.` });
      return;
    }

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reconcile or update a closed day.' });
      return;
    }

    const override = await verifyOwnerPasswordOverride(
      owner_password,
      `Owner password verification is required to reconcile or update closed day ${date}.`
    );
    if (!override.ok) {
      res.status(override.status).json({
        error: override.error,
        code: override.code,
        requires_owner_password: true,
      });
      return;
    }

    const countedCash =
      actual_counted_cash !== undefined && actual_counted_cash !== null && actual_counted_cash !== ''
        ? Math.max(0, Number(actual_counted_cash) || 0)
        : Number(existing.actual_counted_cash || 0);
    const countedUpi =
      actual_upi_counted !== undefined && actual_upi_counted !== null && actual_upi_counted !== ''
        ? Math.max(0, Number(actual_upi_counted) || 0)
        : existing.actual_upi_counted ?? null;
    const drawerCash =
      cash_left_in_drawer !== undefined && cash_left_in_drawer !== null && cash_left_in_drawer !== ''
        ? Math.max(0, Number(cash_left_in_drawer) || 0)
        : existing.cash_left_in_drawer ?? countedCash;
    const takenHome =
      cash_taken_home !== undefined && cash_taken_home !== null && cash_taken_home !== ''
        ? Math.max(0, Number(cash_taken_home) || 0)
        : existing.cash_taken_home ?? Math.max(0, Math.round((countedCash - drawerCash) * 100) / 100);

    const { autoCalculations } = await computeDayClosingMetrics(date, Number(existing.opening_cash || 0));
    const differenceCash = Math.round((countedCash - autoCalculations.expectedClosingCash) * 100) / 100;
    const now = new Date().toISOString();
    const summary = `Owner reconciliation (${override.owner.full_name}): ${String(reason).trim()}`;

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE daily_closings SET
          cash_sales = ?,
          cash_received_other = ?,
          cash_expenses = ?,
          cash_paid_other = ?,
          expected_closing_cash = ?,
          actual_counted_cash = ?,
          difference_cash = ?,
          upi_sales = ?,
          upi_received_other = ?,
          upi_payments = ?,
          actual_upi_counted = ?,
          cash_left_in_drawer = ?,
          cash_taken_home = ?,
          discrepancy_reason = ?,
          closing_notes = ?,
          modified_after_close = 1,
          last_modified_at = ?,
          last_modified_by = ?,
          last_modification_summary = ?
         WHERE closing_date = ?`,
        [
          autoCalculations.cashSales,
          autoCalculations.cashReceivedOther,
          autoCalculations.cashExpenses,
          autoCalculations.cashPaidOther,
          autoCalculations.expectedClosingCash,
          countedCash,
          differenceCash,
          autoCalculations.upiSales,
          autoCalculations.upiReceivedOther,
          autoCalculations.upiPayments,
          countedUpi,
          drawerCash,
          takenHome,
          discrepancy_reason !== undefined ? discrepancy_reason?.trim() || null : existing.discrepancy_reason,
          closing_notes !== undefined ? closing_notes?.trim() || null : existing.closing_notes,
          now,
          override.owner.full_name,
          summary,
          date,
        ]
      );
    });

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'RECONCILE_CLOSED_DAY', 'DAILY_CLOSING', existing.id, {
      closing_date: date,
      reason: String(reason).trim(),
      override_authorized_by: override.owner.full_name,
      before: {
        expected_closing_cash: existing.expected_closing_cash,
        actual_counted_cash: existing.actual_counted_cash,
        difference_cash: existing.difference_cash,
      },
      after: {
        expected_closing_cash: autoCalculations.expectedClosingCash,
        actual_counted_cash: countedCash,
        difference_cash: differenceCash,
      },
    });

    res.json({ success: true, message: `Closed day ${date} reconciled successfully.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List historical daily closings
router.get('/history', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await dbQueryAll(`
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
