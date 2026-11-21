import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { randomHex } from '../cryptoUtil.ts';
import {
  getIdempotencyRecord,
  insertIdempotencyRecord,
  isIdempotencyConflictError,
} from '../idempotency.ts';
import { getTodayIST, isValidDateString, toISTDateString } from '../dateUtil.ts';
import { verifyOwnerPasswordOverride } from '../ownerOverride.ts';
import { isBusinessDayClosed, reconcileAffectedDayClosings } from '../closingSync.ts';

const router = new Router();
router.use(authMiddleware);

const SYNC_CUSTOMER_DUES_SQL =
  "UPDATE customers SET total_dues = COALESCE((SELECT SUM(balance_due) FROM customer_dues WHERE customer_id = ? AND status = 'PENDING'), 0) WHERE id = ?";

// Synchronize customers.total_dues with the sum of active pending customer_dues
export async function syncCustomerBalance(customerId: string): Promise<number> {
  if (!customerId) return 0;
  const sumRow = await dbQueryOne<any>(
    "SELECT COALESCE(SUM(balance_due), 0) as pending FROM customer_dues WHERE customer_id = ? AND status = 'PENDING'",
    [customerId]
  );
  const pending = Number(sumRow?.pending) || 0;
  await dbRun('UPDATE customers SET total_dues = ? WHERE id = ?', [pending, customerId]);
  return pending;
}

// Get all customers with pending or total dues
router.get('/customers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, pending_only } = req.query;
    let sql = `
      SELECT 
        c.id,
        c.name,
        c.phone,
        c.address,
        c.notes,
        c.total_purchases,
        COALESCE(SUM(CASE WHEN cd.status = 'PENDING' THEN cd.balance_due ELSE 0 END), 0) as total_dues,
        COUNT(cd.id) as total_due_records,
        COALESCE(SUM(CASE WHEN cd.status = 'PENDING' THEN cd.balance_due ELSE 0 END), 0) as current_pending_dues,
        c.created_at
      FROM customers c
      LEFT JOIN customer_dues cd ON c.id = cd.customer_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search && typeof search === 'string' && search.trim()) {
      sql += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    sql += ' GROUP BY c.id';

    if (pending_only === 'true') {
      sql += ' HAVING current_pending_dues > 0';
    }

    sql += ' ORDER BY current_pending_dues DESC, c.name ASC';

    const customers = await dbQueryAll(sql, params);
    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get individual dues ledger for customer or all dues
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customer_id, status } = req.query;
    let sql = `
      SELECT 
        cd.*,
        c.name as customer_name,
        c.phone as customer_phone,
        s.bill_number,
        s.created_at as sale_date
      FROM customer_dues cd
      JOIN customers c ON cd.customer_id = c.id
      LEFT JOIN sales s ON cd.sale_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (customer_id) {
      sql += ' AND cd.customer_id = ?';
      params.push(customer_id);
    }

    if (status) {
      sql += ' AND cd.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY cd.created_at DESC';

    const dues = await dbQueryAll(sql, params);
    res.json({ dues });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single due detail with sale items and payment history
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const due = await dbQueryOne<any>(`
      SELECT 
        cd.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.address as customer_address,
        s.bill_number,
        s.total_amount as sale_total,
        s.created_at as sale_date
      FROM customer_dues cd
      JOIN customers c ON cd.customer_id = c.id
      LEFT JOIN sales s ON cd.sale_id = s.id
      WHERE cd.id = ?
    `, [id]);

    if (!due) {
      res.status(404).json({ error: 'Due record not found' });
      return;
    }

    let items: any[] = [];
    if (due.sale_id) {
      items = await dbQueryAll('SELECT * FROM sale_items WHERE sale_id = ?', [due.sale_id]);
    }

    const payments = await dbQueryAll(`
      SELECT 
        cdp.*,
        u.full_name as received_by_name
      FROM customer_due_payments cdp
      LEFT JOIN users u ON cdp.received_by = u.id
      WHERE cdp.customer_due_id = ?
      ORDER BY cdp.created_at DESC
    `, [id]);

    res.json({ due: { ...due, items, payments } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Collect Customer Due Payment
router.post('/:id/pay', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, payment_method = 'CASH', notes, idempotency_key, owner_password } = req.body;

    const rawClientKey =
      req.headers['x-idempotency-key'] || (typeof idempotency_key === 'string' ? idempotency_key.trim() : '');
    const clientKey = typeof rawClientKey === 'string' && rawClientKey.trim() ? rawClientKey.trim() : null;
    const scopedIdempotencyKey = clientKey ? `due_pay:${id}:${clientKey}` : null;

    if (scopedIdempotencyKey) {
      const cached = await getIdempotencyRecord(scopedIdempotencyKey);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    const due = await dbQueryOne<any>(`
      SELECT cd.*, c.name as customer_name, s.bill_number
      FROM customer_dues cd
      JOIN customers c ON cd.customer_id = c.id
      LEFT JOIN sales s ON cd.sale_id = s.id
      WHERE cd.id = ?
    `, [id]);

    if (!due) {
      res.status(404).json({ error: 'Due record not found' });
      return;
    }

    const payNum = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(payNum) || payNum <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    if (!['CASH', 'UPI', 'BANK'].includes(payment_method)) {
      res.status(400).json({ error: 'Invalid payment method. Must be CASH, UPI, or BANK.' });
      return;
    }

    const currentBalanceSnapshot = Math.round(Number(due.balance_due) * 100) / 100;
    if (due.status === 'CLEARED' || payNum > currentBalanceSnapshot) {
      res.status(400).json({
        error: `Payment amount ₹${payNum} cannot exceed current outstanding balance ₹${currentBalanceSnapshot}`,
      });
      return;
    }

    const now = new Date().toISOString();
    const today = getTodayIST();

    const todayClosing = await isBusinessDayClosed(today);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (todayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${today} is CLOSED. Owner password verification is required to record a customer due collection on a closed day.`
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

    const paymentId = 'cdp_' + Date.now() + '_' + randomHex(4);
    const ftxId = 'ftx_due_' + Date.now() + '_' + randomHex(4);

    let updatedBalance = Math.max(0, Math.round((currentBalanceSnapshot - payNum) * 100) / 100);
    let updatedStatus: 'PENDING' | 'CLEARED' = updatedBalance <= 0 ? 'CLEARED' : 'PENDING';

    try {
      await dbTransaction(async () => {
        if (scopedIdempotencyKey) {
          // Insert PK first so duplicate-key retries fail cleanly before modifying customer_dues;
          // response_json is updated atomically in the same batch right after customer_dues is updated.
          await insertIdempotencyRecord(scopedIdempotencyKey, 'DUE_PAY', {
            success: true,
            balance_due: updatedBalance,
            status: updatedStatus,
            payment_id: paymentId,
          });
        }

        // Atomic SQL-side arithmetic prevents lost-update races; trigger trg_customer_dues_prevent_overpay
        // aborts the entire batch/transaction if concurrent payments exceed remaining balance_due.
        await dbRun(`
          UPDATE customer_dues SET
            amount_paid = ROUND(amount_paid + ?, 2),
            balance_due = ROUND(balance_due - ?, 2),
            status = CASE WHEN ROUND(balance_due - ?, 2) <= 0 THEN 'CLEARED' ELSE 'PENDING' END,
            updated_at = ?
          WHERE id = ?
        `, [payNum, payNum, payNum, now, id]);

        await dbRun(SYNC_CUSTOMER_DUES_SQL, [due.customer_id, due.customer_id]);

        if (scopedIdempotencyKey) {
          await dbRun(`
            UPDATE idempotency_keys
            SET response_json = (
              SELECT json_object(
                'success', json('true'),
                'balance_due', cd.balance_due,
                'status', cd.status,
                'payment_id', ?
              )
              FROM customer_dues cd
              WHERE cd.id = ?
            )
            WHERE key = ?
          `, [paymentId, id, scopedIdempotencyKey]);
        }

        await dbRun(`
          INSERT INTO customer_due_payments (
            id, customer_due_id, customer_id, amount, payment_method, notes, received_by, financial_tx_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          paymentId,
          id,
          due.customer_id,
          payNum,
          payment_method,
          notes?.trim() || null,
          req.user?.id || 'STAFF',
          ftxId,
          now,
        ]);

        await dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, day_closed, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', ?, 'CUSTOMER_DUE_COLLECTION', ?, 'CUSTOMER_DUES', ?, ?, ?, 1, ?, ?, ?, ?)
        `, [
          ftxId,
          today,
          payNum,
          payment_method,
          due.customer_name,
          `Customer Due Collected: ${due.customer_name} (Bill #${due.bill_number || id})`,
          payment_method,
          `DUE-${id.slice(-6)}`,
          todayClosing.isClosed ? 1 : 0,
          req.user?.id || 'STAFF',
          now,
          now,
        ]);
      });
    } catch (txErr: any) {
      if (scopedIdempotencyKey && isIdempotencyConflictError(txErr)) {
        const existingResp = await getIdempotencyRecord(scopedIdempotencyKey);
        if (existingResp) {
          res.json(existingResp);
          return;
        }
      }
      if (String(txErr?.message || '').includes('OVERPAYMENT_EXCEEDS_BALANCE')) {
        const freshDue = await dbQueryOne<{ balance_due: number }>(
          'SELECT balance_due FROM customer_dues WHERE id = ?',
          [id]
        );
        const remainingBal = freshDue ? Math.round(Number(freshDue.balance_due) * 100) / 100 : 0;
        res.status(400).json({
          error: `Payment amount ₹${payNum} cannot exceed current outstanding balance ₹${remainingBal}`,
        });
        return;
      }
      throw txErr;
    }

    if (scopedIdempotencyKey) {
      const committedResp = await getIdempotencyRecord<{
        success: boolean;
        balance_due: number;
        status: 'PENDING' | 'CLEARED';
        payment_id: string;
      }>(scopedIdempotencyKey);
      if (committedResp) {
        updatedBalance = Number(committedResp.balance_due);
        updatedStatus = committedResp.status;
      }
    } else {
      const freshDue = await dbQueryOne<{ balance_due: number; status: 'PENDING' | 'CLEARED' }>(
        'SELECT balance_due, status FROM customer_dues WHERE id = ?',
        [id]
      );
      if (freshDue) {
        updatedBalance = Number(freshDue.balance_due);
        updatedStatus = freshDue.status;
      }
    }

    const payResponse = {
      success: true,
      balance_due: updatedBalance,
      status: updatedStatus,
      payment_id: paymentId,
    };

    if (todayClosing.isClosed) {
      await reconcileAffectedDayClosings(
        [today],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Collected ₹${payNum} (${payment_method}) from ${due.customer_name} on closed day`,
        now
      );
    }

    saveDb(true);

    await logAudit(req.user?.id || 'USER', 'COLLECT_CUSTOMER_DUE', 'CUSTOMER_DUE', id, {
      customer: due.customer_name,
      amount: payNum,
      balance_remaining: updatedBalance,
      method: payment_method,
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json(payResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive Customer Ledger
router.get('/customers/:id/ledger', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customer = await dbQueryOne<any>('SELECT * FROM customers WHERE id = ?', [id]);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const dues = await dbQueryAll<any>(`
      SELECT 
        cd.*,
        s.bill_number,
        s.created_at as sale_date,
        s.total_amount as sale_total,
        s.amount_paid as sale_paid,
        s.payment_method
      FROM customer_dues cd
      LEFT JOIN sales s ON cd.sale_id = s.id
      WHERE cd.customer_id = ?
      ORDER BY cd.created_at ASC
    `, [id]);

    const payments = await dbQueryAll<any>(`
      SELECT 
        cdp.*,
        s.bill_number,
        u.full_name as received_by_name
      FROM customer_due_payments cdp
      LEFT JOIN customer_dues cd ON cdp.customer_due_id = cd.id
      LEFT JOIN sales s ON cd.sale_id = s.id
      LEFT JOIN users u ON cdp.received_by = u.id
      WHERE cdp.customer_id = ?
      ORDER BY cdp.created_at ASC
    `, [id]);

    interface LedgerEntry {
      id: string;
      date: string;
      type: 'CREDIT_BILL' | 'PAYMENT' | 'RETURN_ADJUSTMENT' | 'CANCELLATION';
      reference: string;
      debit: number;
      credit: number;
      balance: number;
      notes?: string;
    }

    const rawEvents: Array<{
      id: string;
      date: string;
      type: 'CREDIT_BILL' | 'PAYMENT' | 'RETURN_ADJUSTMENT' | 'CANCELLATION';
      reference: string;
      debit: number;
      credit: number;
      notes?: string;
    }> = [];

    dues.forEach((d) => {
      rawEvents.push({
        id: `due_${d.id}`,
        date: d.created_at,
        type: 'CREDIT_BILL',
        reference: d.bill_number ? `Bill #${d.bill_number}` : `Due #${d.id.slice(-6)}`,
        debit: d.original_due,
        credit: 0,
        notes: d.notes || undefined,
      });

      if (d.status === 'CLEARED' && d.notes && d.notes.includes('[CANCELLED with Bill')) {
        rawEvents.push({
          id: `cancel_${d.id}`,
          date: d.updated_at,
          type: 'CANCELLATION',
          reference: `Void #${d.bill_number || ''}`,
          debit: 0,
          credit: d.original_due - (d.amount_paid || 0),
          notes: 'Credit cancelled with voided bill',
        });
      }
    });

    payments.forEach((p) => {
      if (p.is_reversed) return;
      rawEvents.push({
        id: `pay_${p.id}`,
        date: p.created_at,
        type: 'PAYMENT',
        reference: p.financial_tx_id || `Rcpt #${p.id.slice(-6)}`,
        debit: 0,
        credit: p.amount,
        notes: p.notes ? `${p.notes} (${p.payment_method})` : p.payment_method,
      });
    });

    const returnAdjustments = await dbQueryAll<any>(`
      SELECT 
        sr.id, sr.return_number, sr.bill_number, sr.refund_amount, sr.refund_method, sr.reason, sr.created_at
      FROM sale_returns sr
      JOIN sales s ON sr.sale_id = s.id
      WHERE s.customer_id = ?
        AND sr.refund_method IN ('CREDIT_ADJUSTMENT', 'ADJUST_CUSTOMER_DUE')
      ORDER BY sr.created_at ASC
    `, [id]);

    returnAdjustments.forEach((r) => {
      rawEvents.push({
        id: `ret_${r.id}`,
        date: r.created_at,
        type: 'RETURN_ADJUSTMENT',
        reference: r.return_number ? `Return #${r.return_number}` : `Return #${r.id.slice(-6)}`,
        debit: 0,
        credit: r.refund_amount,
        notes: `Credit adjusted on return (Bill #${r.bill_number || ''}): ${r.reason || ''}`,
      });
    });

    rawEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    const timeline: LedgerEntry[] = rawEvents.map((evt) => {
      runningBalance = Math.max(0, runningBalance + evt.debit - evt.credit);
      return {
        ...evt,
        balance: runningBalance,
      };
    });

    const currentCalculatedDue = dues
      .filter((d) => d.status === 'PENDING')
      .reduce((sum, d) => sum + d.balance_due, 0);

    res.json({
      customer: {
        ...customer,
        total_dues: currentCalculatedDue,
      },
      dues,
      payments,
      timeline,
      total_pending: currentCalculatedDue,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create manual customer profile
router.post('/customers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, address, notes } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }

    const id = 'cust_' + Date.now();
    const now = new Date().toISOString();

    await dbRun(`
      INSERT INTO customers (id, name, phone, address, notes, total_purchases, total_dues, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?)
    `, [id, name.trim(), phone?.trim() || null, address?.trim() || null, notes?.trim() || null, now]);

    saveDb(true);
    await logAudit(req.user?.id || 'USER', 'CREATE_CUSTOMER', 'CUSTOMER', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Owner Edit Customer Due (original_due / due_date / notes) with Closed-Day Protection
router.put('/:id', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { original_due, due_date, notes, reason, owner_password } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to edit a customer due record.' });
      return;
    }

    const due = await dbQueryOne<any>(
      `SELECT cd.*, c.name as customer_name, s.bill_number, COALESCE(s.bill_date, '') as sale_bill_date, s.created_at as sale_created_at
       FROM customer_dues cd
       JOIN customers c ON cd.customer_id = c.id
       LEFT JOIN sales s ON cd.sale_id = s.id
       WHERE cd.id = ?`,
      [id]
    );
    if (!due) {
      res.status(404).json({ error: 'Due record not found.' });
      return;
    }

    const newOriginalDue =
      original_due !== undefined ? Math.round(Number(original_due) * 100) / 100 : Number(due.original_due);
    if (!Number.isFinite(newOriginalDue) || newOriginalDue < 0) {
      res.status(400).json({ error: 'Original due amount must be a valid non-negative number.' });
      return;
    }
    const alreadyPaid = Math.round(Number(due.amount_paid || 0) * 100) / 100;
    if (newOriginalDue < alreadyPaid) {
      res.status(400).json({
        error: `Original due (₹${newOriginalDue}) cannot be less than already collected payments (₹${alreadyPaid}). Reverse a payment first if needed.`,
      });
      return;
    }

    const cleanDueDate =
      due_date === null || due_date === ''
        ? null
        : typeof due_date === 'string' && isValidDateString(due_date)
          ? due_date.trim()
          : due.due_date || null;

    const affectedDate = due.sale_bill_date || (due.sale_created_at ? toISTDateString(due.sale_created_at) : toISTDateString(due.created_at));
    const dayClosing = await isBusinessDayClosed(affectedDate);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (dayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Due record belongs to CLOSED business day (${affectedDate}). Owner password verification is required.`
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

    const newBalanceDue = Math.max(0, Math.round((newOriginalDue - alreadyPaid) * 100) / 100);
    const newStatus: 'PENDING' | 'CLEARED' = newBalanceDue <= 0 ? 'CLEARED' : 'PENDING';
    const now = new Date().toISOString();
    const cleanReason = String(reason).trim();

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE customer_dues SET
          original_due = ?,
          balance_due = ?,
          due_date = ?,
          status = ?,
          notes = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          newOriginalDue,
          newBalanceDue,
          cleanDueDate,
          newStatus,
          notes !== undefined ? notes?.trim() || null : due.notes,
          now,
          id,
        ]
      );
      await dbRun(SYNC_CUSTOMER_DUES_SQL, [due.customer_id, due.customer_id]);
    });

    if (dayClosing.isClosed) {
      await reconcileAffectedDayClosings(
        [affectedDate],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Customer due edited for ${due.customer_name} (₹${due.original_due} -> ₹${newOriginalDue}): ${cleanReason}`,
        now
      );
    }

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'EDIT_CUSTOMER_DUE', 'CUSTOMER_DUE', id, {
      customer: due.customer_name,
      reason: cleanReason,
      override_authorized_by: overrideOwner?.full_name || null,
      before: {
        original_due: due.original_due,
        balance_due: due.balance_due,
        due_date: due.due_date,
        status: due.status,
      },
      after: {
        original_due: newOriginalDue,
        balance_due: newBalanceDue,
        due_date: cleanDueDate,
        status: newStatus,
      },
    });

    res.json({ success: true, balance_due: newBalanceDue, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Owner Safe Reversal of a Customer Due Repayment
router.post('/payments/:paymentId/reverse', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paymentId } = req.params;
    const { reason, owner_password } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reverse a customer due repayment.' });
      return;
    }

    const payment = await dbQueryOne<any>(
      `SELECT cdp.*, c.name as customer_name, cd.original_due, cd.amount_paid, cd.balance_due, cd.status as due_status
       FROM customer_due_payments cdp
       JOIN customer_dues cd ON cdp.customer_due_id = cd.id
       JOIN customers c ON cdp.customer_id = c.id
       WHERE cdp.id = ?`,
      [paymentId]
    );
    if (!payment) {
      res.status(404).json({ error: 'Repayment record not found.' });
      return;
    }

    if (payment.is_reversed) {
      res.status(400).json({ error: 'This repayment has already been reversed.' });
      return;
    }

    const ftx = payment.financial_tx_id
      ? await dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [payment.financial_tx_id])
      : null;

    const payDate = ftx?.date || toISTDateString(payment.created_at);
    const dayClosing = await isBusinessDayClosed(payDate);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (dayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Repayment was recorded on a CLOSED business day (${payDate}). Owner password verification is required to reverse it.`
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

    const payAmt = Math.round(Number(payment.amount || 0) * 100) / 100;
    const now = new Date().toISOString();
    const cleanReason = String(reason).trim();

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE customer_due_payments SET
          is_reversed = 1,
          reversed_reason = ?,
          reversed_at = ?,
          reversed_by = ?
         WHERE id = ?`,
        [cleanReason, now, req.user?.id || 'OWNER', paymentId]
      );

      await dbRun(
        `UPDATE customer_dues SET
          amount_paid = ROUND(MAX(0, amount_paid - ?), 2),
          balance_due = ROUND(balance_due + ?, 2),
          status = CASE WHEN ROUND(balance_due + ?, 2) > 0 THEN 'PENDING' ELSE 'CLEARED' END,
          updated_at = ?
         WHERE id = ?`,
        [payAmt, payAmt, payAmt, now, payment.customer_due_id]
      );

      await dbRun(SYNC_CUSTOMER_DUES_SQL, [payment.customer_id, payment.customer_id]);

      if (payment.financial_tx_id) {
        await dbRun(
          `UPDATE financial_transactions SET
            is_reversed = 1,
            notes = COALESCE(notes || ' | ', '') || ?,
            updated_at = ?
           WHERE id = ?`,
          [`[REVERSED Due Receipt: ${cleanReason}]`, now, payment.financial_tx_id]
        );
      }
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      [payDate],
      overrideOwner?.full_name || req.user?.full_name || 'Owner',
      `Reversed customer repayment ₹${payAmt} (${payment.payment_method}) for ${payment.customer_name}: ${cleanReason}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'REVERSE_CUSTOMER_DUE_PAYMENT', 'CUSTOMER_DUE_PAYMENT', paymentId, {
      customer_due_id: payment.customer_due_id,
      customer: payment.customer_name,
      amount: payAmt,
      payment_method: payment.payment_method,
      reason: cleanReason,
      override_authorized_by: overrideOwner?.full_name || null,
      modified_closed_dates: modifiedClosedDates,
    });

    res.json({ success: true, modified_closed_dates: modifiedClosedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
