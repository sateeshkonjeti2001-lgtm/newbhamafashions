import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { getTodayIST, isValidDateString, sqlEffectiveSaleDate, sqlISTDate } from '../dateUtil.ts';
import { verifyOwnerPasswordOverride } from '../ownerOverride.ts';
import { isBusinessDayClosed, reconcileAffectedDayClosings } from '../closingSync.ts';

const router = new Router();

router.use(authMiddleware);

// Get real account balances (Cash, UPI, Bank) computed from real non-reversed transactions
router.get('/accounts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';

    // Sum all active movements into and out of CASH, UPI, BANK
    const cashIn = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'CASH' AND is_reversed = 0"))?.s || 0;
    const cashOut = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'CASH' AND is_reversed = 0"))?.s || 0;
    const cashBalance = cashIn - cashOut;

    const upiIn = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'UPI' AND is_reversed = 0"))?.s || 0;
    const upiOut = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'UPI' AND is_reversed = 0"))?.s || 0;
    const upiBalance = upiIn - upiOut;

    const bankIn = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE destination_account = 'BANK' AND is_reversed = 0"))?.s || 0;
    const bankOut = (await dbQueryOne<any>("SELECT COALESCE(SUM(amount), 0) as s FROM financial_transactions WHERE source_account = 'BANK' AND is_reversed = 0"))?.s || 0;
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
router.get('/transactions', async (req: AuthenticatedRequest, res: Response) => {
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

    const transactions = await dbQueryAll(sql, params);
    res.json({ transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Manual Financial Entry (Expense, Owner Capital, Withdrawal, Transfer, Other)
router.post('/transactions', async (req: AuthenticatedRequest, res: Response) => {
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
      notes,
      owner_password,
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

    const txDate = typeof date === 'string' && isValidDateString(date) ? date.trim() : getTodayIST();
    const now = new Date().toISOString();
    const txId = 'ftx_' + Date.now();

    // Check if the business day is already closed for this date
    const closingInfo = await isBusinessDayClosed(txDate);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (closingInfo.isClosed) {
      if (req.user?.role !== 'OWNER') {
        res.status(403).json({
          error: `The business day for ${txDate} is already CLOSED. Only Owner password authorization can add an entry into a closed day.`,
        });
        return;
      }
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${txDate} is CLOSED. Owner password verification is required to record this transaction.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const dayClosedFlag = closingInfo.isClosed ? 1 : 0;

    await dbTransaction(async () => {
      await dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no, notes,
          is_system_generated, is_reversed, day_closed, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
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
        dayClosedFlag,
        req.user?.id || 'STAFF',
        now,
        now
      ]);

      // If it's an operating expense, also mirror in expenses table for easy expense reporting
      if (transaction_type === 'OPERATING_EXPENSE') {
        const expId = 'exp_' + Date.now();
        await dbRun(`
          INSERT INTO expenses (
            id, date, category, amount, payment_method, paid_to, purpose, reference_no, user_id, financial_tx_id, day_closed, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          dayClosedFlag,
          now
        ]);
      }
    });

    if (closingInfo.isClosed) {
      await reconcileAffectedDayClosings(
        [txDate],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Added ${transaction_type} (₹${amt}: ${purpose.trim()}) on closed day ${txDate}`,
        now
      );
    }

    saveDb(true);

    await logAudit(req.user?.id || 'USER', 'CREATE_FINANCIAL_TRANSACTION', 'FINANCIAL', txId, {
      date: txDate,
      type: transaction_type,
      amount: amt,
      purpose,
      post_day_closing: closingInfo.isClosed,
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json({ success: true, id: txId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rule 10 + Phase 3: Manual Entry Editing (Cashier same unclosed IST day; Owner anytime with reason & Owner password on closed day)
router.put('/transactions/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      date,
      amount,
      purpose,
      category,
      person_entity,
      payment_method,
      source_account,
      destination_account,
      notes,
      edit_reason,
      reason,
      owner_password,
    } = req.body;

    const existing = await dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (existing.is_reversed) {
      res.status(400).json({ error: 'Reversed transactions cannot be edited.' });
      return;
    }

    // Automatic/system-generated transaction records must not be directly editable from cashbook.
    if (existing.is_system_generated) {
      res.status(400).json({
        error: 'System-generated transaction records (POS billing, purchases, customer dues, salary) must be edited or reversed from their source module.'
      });
      return;
    }

    const isOwner = req.user?.role === 'OWNER';
    const today = getTodayIST();
    const oldDate = existing.date;
    let newDate = oldDate;
    if (date !== undefined && date !== null && String(date).trim() !== '') {
      if (!isValidDateString(date)) {
        res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
        return;
      }
      newDate = date.trim();
    }

    const oldClosing = await isBusinessDayClosed(oldDate);
    const newClosing = newDate !== oldDate ? await isBusinessDayClosed(newDate) : oldClosing;
    const isPastDay = oldDate < today || newDate < today;
    const isClosed = Number(existing.day_closed) === 1 || oldClosing.isClosed || newClosing.isClosed;

    if (!isOwner && (isClosed || isPastDay || newDate !== oldDate)) {
      res.status(403).json({
        error: 'Cashier direct editing is restricted to the same unclosed IST business day. Contact the Store Owner for past or closed day corrections.'
      });
      return;
    }

    const cleanReason = (edit_reason || reason || '').toString().trim() || null;
    if ((isPastDay || isClosed) && !cleanReason) {
      res.status(400).json({
        error: 'Mandatory reason is required when editing a past-date or closed-day entry.',
        requires_owner_password: isClosed,
      });
      return;
    }

    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day is CLOSED (${oldClosing.isClosed ? oldDate : newDate}). Owner password verification is required.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    const finalMethod = payment_method || existing.payment_method;
    let finalSource = source_account || existing.source_account;
    let finalDest = destination_account || existing.destination_account;

    if (!source_account && !destination_account && payment_method && payment_method !== existing.payment_method) {
      if (['OPERATING_EXPENSE', 'OWNER_WITHDRAWAL', 'SUPPLIER_PAYMENT', 'STAFF_PAYMENT', 'LOAN_REPAYMENT', 'ASSET_PURCHASE'].includes(existing.transaction_type)) {
        finalSource = finalMethod;
      } else if (['INCOME', 'OWNER_CAPITAL', 'LOAN_RECEIVED', 'ASSET_SALE', 'CUSTOMER_DUE_COLLECTION'].includes(existing.transaction_type)) {
        finalDest = finalMethod;
      }
    }

    const now = new Date().toISOString();
    const newPurpose = purpose?.trim() || existing.purpose;
    const newCategory = category?.trim() || existing.category;
    const newPerson = person_entity !== undefined ? (person_entity?.trim() || null) : existing.person_entity;
    const newNotes = notes !== undefined ? (notes?.trim() || null) : existing.notes;
    const newDayClosedFlag = newClosing.isClosed ? 1 : 0;

    await dbTransaction(async () => {
      await dbRun(`
        UPDATE financial_transactions SET
          date = ?,
          amount = ?,
          source_account = ?,
          destination_account = ?,
          purpose = ?,
          category = ?,
          person_entity = ?,
          payment_method = ?,
          notes = ?,
          day_closed = ?,
          updated_at = ?
        WHERE id = ?
      `, [
        newDate,
        amt,
        finalSource,
        finalDest,
        newPurpose,
        newCategory,
        newPerson,
        finalMethod,
        newNotes,
        newDayClosedFlag,
        now,
        id
      ]);

      // If mirrored in expenses, update it too
      await dbRun(`
        UPDATE expenses SET
          date = ?,
          amount = ?,
          purpose = ?,
          category = ?,
          paid_to = ?,
          payment_method = ?,
          day_closed = ?
        WHERE financial_tx_id = ?
      `, [
        newDate,
        amt,
        newPurpose,
        newCategory,
        newPerson,
        finalMethod,
        newDayClosedFlag,
        id
      ]);
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      [oldDate, newDate],
      overrideOwner?.full_name || req.user?.full_name || 'Owner',
      `Edited ${existing.transaction_type} "${newPurpose}" (₹${existing.amount} -> ₹${amt})${cleanReason ? ` - ${cleanReason}` : ''}`,
      now
    );

    saveDb(true);

    await logAudit(
      req.user?.id || 'USER',
      overrideOwner ? 'OWNER_OVERRIDE_EDIT_TRANSACTION' : 'EDIT_MANUAL_TRANSACTION',
      'FINANCIAL',
      id,
      {
        reason: cleanReason,
        override_authorized_by: overrideOwner?.full_name || null,
        modified_closed_dates: modifiedClosedDates,
        before: {
          date: existing.date,
          amount: existing.amount,
          purpose: existing.purpose,
          category: existing.category,
          person_entity: existing.person_entity,
          payment_method: existing.payment_method,
          source_account: existing.source_account,
          destination_account: existing.destination_account,
        },
        after: {
          date: newDate,
          amount: amt,
          purpose: newPurpose,
          category: newCategory,
          person_entity: newPerson,
          payment_method: finalMethod,
          source_account: finalSource,
          destination_account: finalDest,
        },
      }
    );

    res.json({ success: true, modified_closed_dates: modifiedClosedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Safe Reversal of a Manual Financial Transaction / Expense (Owner-only, prevents duplicates)
router.post('/transactions/:id/reverse', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, owner_password } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reverse a financial transaction.' });
      return;
    }

    const original = await dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    if (!original) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (original.is_reversed) {
      res.status(400).json({ error: 'This transaction has already been reversed.' });
      return;
    }

    if (original.is_system_generated) {
      res.status(400).json({
        error: 'System-generated transactions must be reversed from their originating module (Bills, Purchases, Customer Dues, or Staff Salary).',
      });
      return;
    }

    const closingInfo = await isBusinessDayClosed(original.date);
    const isClosed = Number(original.day_closed) === 1 || closingInfo.isClosed;
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${original.date} is CLOSED. Owner password verification is required to reverse this entry.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const now = new Date().toISOString();
    const cleanReason = String(reason).trim();
    const actorName = overrideOwner?.full_name || req.user?.full_name || 'Owner';

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE financial_transactions SET
          is_reversed = 1,
          notes = COALESCE(notes || ' | ', '') || ?,
          updated_at = ?
         WHERE id = ?`,
        [`[REVERSED by ${actorName}: ${cleanReason}]`, now, id]
      );

      // Zero mirrored expense row so expense summaries do not double-count reversed items
      await dbRun(
        `UPDATE expenses SET
          amount = 0,
          purpose = '[REVERSED] ' || purpose
         WHERE financial_tx_id = ?`,
        [id]
      );
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      [original.date],
      actorName,
      `Reversed ${original.transaction_type} "${original.purpose}" (₹${original.amount}): ${cleanReason}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'REVERSE_FINANCIAL_TRANSACTION', 'FINANCIAL', id, {
      date: original.date,
      transaction_type: original.transaction_type,
      amount: original.amount,
      purpose: original.purpose,
      reason: cleanReason,
      override_authorized_by: overrideOwner?.full_name || null,
      modified_closed_dates: modifiedClosedDates,
    });

    res.json({ success: true, modified_closed_dates: modifiedClosedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rule 10: Correction / Reversal Entry for past or closed days (net adjustment entry)
router.post('/transactions/:id/correct', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { new_amount, corrected_amount, reason, owner_password } = req.body;

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'Mandatory reason is required for financial correction.' });
      return;
    }

    const original = await dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    if (!original) {
      res.status(404).json({ error: 'Original transaction not found' });
      return;
    }

    if (original.is_reversed) {
      res.status(400).json({ error: 'Reversed transactions cannot be corrected.' });
      return;
    }

    const resolvedAmountInput = new_amount !== undefined ? new_amount : corrected_amount;
    const newAmt = Number(resolvedAmountInput);
    if (isNaN(newAmt) || newAmt < 0) {
      res.status(400).json({ error: 'Valid corrected amount is required' });
      return;
    }

    const now = new Date().toISOString();
    const today = getTodayIST();
    const origClosing = await isBusinessDayClosed(original.date);
    const todayClosing = today !== original.date ? await isBusinessDayClosed(today) : origClosing;
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (origClosing.isClosed || todayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        'Owner password verification is required for corrections involving a closed business day.'
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const difference = newAmt - original.amount;
    const corrId = 'corr_' + Date.now();

    await dbTransaction(async () => {
      await dbRun(`
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

      if (difference !== 0) {
        const adjTxId = 'ftx_adj_' + Date.now();
        const isIncrease = difference > 0;
        const absDiff = Math.abs(difference);

        await dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, is_reversed, original_tx_id, day_closed, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CORRECTION', ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)
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
          todayClosing.isClosed ? 1 : 0,
          req.user?.id || 'OWNER',
          now,
          now
        ]);
      }
    });

    await reconcileAffectedDayClosings(
      [today],
      overrideOwner?.full_name || req.user?.full_name || 'Owner',
      `Financial adjustment of ${difference > 0 ? '+' : ''}₹${difference} for "${original.purpose}": ${reason.trim()}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'FINANCIAL_CORRECTION', 'FINANCIAL', id, {
      original_amount: original.amount,
      corrected_amount: newAmt,
      difference,
      reason: reason.trim(),
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json({ success: true, correction_id: corrId, difference });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Profit & Loss / COGS Calculation (Strict Accounting logic) - Owner only
router.get('/profit-loss', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    const today = getTodayIST();
    const start = (start_date as string) || today.substring(0, 7) + '-01'; // Default first of current month
    const end = (end_date as string) || today;

    // Real Sales Revenue (Active COMPLETED sales)
    const salesRow = await dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as gross_sales,
        COALESCE(SUM(discount_amount), 0) as total_discounts,
        COUNT(*) as total_bills
      FROM sales
      WHERE ${sqlEffectiveSaleDate()} >= ? AND ${sqlEffectiveSaleDate()} <= ?
        AND (status IS NULL OR status = 'COMPLETED')
    `, [start, end]);

    // Returns / Refunds in this period
    const returnsRow = await dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(refund_amount), 0) as total_refunds,
        COALESCE(SUM(cogs_reversed), 0) as total_cogs_reversed
      FROM sale_returns
      WHERE ${sqlISTDate('created_at')} >= ? AND ${sqlISTDate('created_at')} <= ?
    `, [start, end]);

    // Real COGS (from sale_items calculated via FIFO purchase batches on completed sales)
    const cogsRow = await dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(si.cogs), 0) as total_cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE ${sqlEffectiveSaleDate('s.')} >= ? AND ${sqlEffectiveSaleDate('s.')} <= ?
        AND (s.status IS NULL OR s.status = 'COMPLETED')
    `, [start, end]);

    // Operating Expenses ONLY (Active, non-reversed)
    const expenseRow = await dbQueryOne<any>(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_operating_expenses
      FROM financial_transactions
      WHERE transaction_type = 'OPERATING_EXPENSE'
        AND is_reversed = 0
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
