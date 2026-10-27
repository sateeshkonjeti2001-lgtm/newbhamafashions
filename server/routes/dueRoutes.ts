import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();
router.use(authMiddleware);

// Synchronize customers.total_dues with the sum of active pending customer_dues
export function syncCustomerBalance(customerId: string): number {
  if (!customerId) return 0;
  const sumRow = dbQueryOne<any>(
    "SELECT COALESCE(SUM(balance_due), 0) as pending FROM customer_dues WHERE customer_id = ? AND status = 'PENDING'",
    [customerId]
  );
  const pending = Number(sumRow?.pending) || 0;
  dbRun('UPDATE customers SET total_dues = ? WHERE id = ?', [pending, customerId]);
  return pending;
}

// In-memory cache to prevent duplicate repayment clicks/submissions
const recentRepayments = new Map<string, { timestamp: number; response: any }>();
function pruneRecentRepayments() {
  const expiry = Date.now() - 30 * 1000;
  for (const [k, v] of recentRepayments.entries()) {
    if (v.timestamp < expiry) recentRepayments.delete(k);
  }
}

// Get all customers with pending or total dues
router.get('/customers', (req: AuthenticatedRequest, res: Response) => {
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

    const customers = dbQueryAll(sql, params);
    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get individual dues ledger for customer or all dues
router.get('/', (req: AuthenticatedRequest, res: Response) => {
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

    const dues = dbQueryAll(sql, params);
    res.json({ dues });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single due detail with sale items and payment history
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const due = dbQueryOne<any>(`
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

    // Associated items from the sale
    let items: any[] = [];
    if (due.sale_id) {
      items = dbQueryAll('SELECT * FROM sale_items WHERE sale_id = ?', [due.sale_id]);
    }

    // Payment history for this due
    const payments = dbQueryAll(`
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
router.post('/:id/pay', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, payment_method = 'CASH', notes, idempotency_key } = req.body;

    pruneRecentRepayments();
    const clientKey = (req.headers['x-idempotency-key'] as string) || (typeof idempotency_key === 'string' ? idempotency_key.trim() : null);
    if (clientKey && recentRepayments.has(clientKey)) {
      res.json(recentRepayments.get(clientKey)!.response);
      return;
    }

    const due = dbQueryOne<any>(`
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

    const payNum = Number(amount);
    if (!payNum || payNum <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    if (payNum > due.balance_due) {
      res.status(400).json({
        error: `Payment amount ₹${payNum} cannot exceed current outstanding balance ₹${due.balance_due}`
      });
      return;
    }

    const newPaid = due.amount_paid + payNum;
    const newBalance = due.balance_due - payNum;
    const newStatus = newBalance === 0 ? 'CLEARED' : 'PENDING';
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const paymentId = 'cdp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const ftxId = 'ftx_due_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    dbTransaction(() => {
      // 1. Update customer_dues
      dbRun(`
        UPDATE customer_dues SET
          amount_paid = ?,
          balance_due = ?,
          status = ?,
          updated_at = ?
        WHERE id = ?
      `, [newPaid, newBalance, newStatus, now, id]);

      // 2. Synchronize customer total_dues
      syncCustomerBalance(due.customer_id);

      // 3. Record payment in customer_due_payments
      dbRun(`
        INSERT INTO customer_due_payments (
          id, customer_due_id, customer_id, amount, payment_method, notes, received_by, financial_tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        paymentId,
        id,
        due.customer_id,
        payNum,
        payment_method, // CASH | UPI | BANK
        notes?.trim() || null,
        req.user?.id || 'STAFF',
        ftxId,
        now
      ]);

      // 4. Financial Transaction (Real cash/upi into the business)
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'EXTERNAL', ?, 'CUSTOMER_DUE_COLLECTION', ?, 'CUSTOMER_DUES', ?, ?, ?, 1, ?, ?, ?)
      `, [
        ftxId,
        today,
        payNum,
        payment_method, // CASH | UPI | BANK
        due.customer_name,
        `Customer Due Collected: ${due.customer_name} (Bill #${due.bill_number || id})`,
        payment_method,
        `DUE-${id.slice(-6)}`,
        req.user?.id || 'STAFF',
        now,
        now
      ]);
    });

    saveDb(true);

    logAudit(req.user?.id || 'USER', 'COLLECT_CUSTOMER_DUE', 'CUSTOMER_DUE', id, {
      customer: due.customer_name,
      amount: payNum,
      balance_remaining: newBalance,
      method: payment_method
    });

    const payResponse = {
      success: true,
      balance_due: newBalance,
      status: newStatus,
      payment_id: paymentId,
    };

    if (clientKey) {
      recentRepayments.set(clientKey, { timestamp: Date.now(), response: payResponse });
    }

    res.json(payResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive Customer Ledger (Credit sales, payments, returns, adjustments & running balance)
router.get('/customers/:id/ledger', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const customer = dbQueryOne<any>('SELECT * FROM customers WHERE id = ?', [id]);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // 1. Credit Bills
    const dues = dbQueryAll<any>(`
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

    // 2. Payments Collected
    const payments = dbQueryAll<any>(`
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

    // 3. Build unified chronological statement entries with running balance
    interface LedgerEntry {
      id: string;
      date: string;
      type: 'CREDIT_BILL' | 'PAYMENT' | 'RETURN_ADJUSTMENT' | 'CANCELLATION';
      reference: string;
      debit: number;   // adds to due
      credit: number;  // reduces due
      balance: number; // running balance after this entry
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

    // 2b. Return Adjustments against customer dues
    const returnAdjustments = dbQueryAll<any>(`
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

    // Sort chronologically
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
router.post('/customers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, address, notes } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }

    const id = 'cust_' + Date.now();
    const now = new Date().toISOString();

    dbRun(`
      INSERT INTO customers (id, name, phone, address, notes, total_purchases, total_dues, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?)
    `, [id, name.trim(), phone?.trim() || null, address?.trim() || null, notes?.trim() || null, now]);

    saveDb(true);
    logAudit(req.user?.id || 'USER', 'CREATE_CUSTOMER', 'CUSTOMER', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
