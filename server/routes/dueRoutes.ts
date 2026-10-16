import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();
router.use(authMiddleware);

// Get all customers with pending or total dues
router.get('/customers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, pending_only } = req.query;
    let sql = `
      SELECT 
        c.*,
        COUNT(cd.id) as total_due_records,
        COALESCE(SUM(cd.balance_due), 0) as current_pending_dues
      FROM customers c
      LEFT JOIN customer_dues cd ON c.id = cd.customer_id AND cd.status = 'PENDING'
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
    const { amount, payment_method = 'CASH', notes } = req.body;

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

    const paymentId = 'cdp_' + Date.now();
    const ftxId = 'ftx_due_' + Date.now();

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

      // 2. Update customer total_dues
      dbRun('UPDATE customers SET total_dues = MAX(0, total_dues - ?) WHERE id = ?', [payNum, due.customer_id]);

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

    logAudit(req.user?.id || 'USER', 'COLLECT_CUSTOMER_DUE', 'CUSTOMER_DUE', id, {
      customer: due.customer_name,
      amount: payNum,
      balance_remaining: newBalance,
      method: payment_method
    });

    res.json({
      success: true,
      balance_due: newBalance,
      status: newStatus
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

    logAudit(req.user?.id || 'USER', 'CREATE_CUSTOMER', 'CUSTOMER', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
