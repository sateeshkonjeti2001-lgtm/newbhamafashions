import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();

// Protect all supplier and purchase endpoints so only OWNER can access
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

// Suppliers List
router.get('/suppliers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const suppliers = dbQueryAll(`
      SELECT 
        s.*,
        COALESCE(SUM(p.balance_due), 0) as total_dues,
        COUNT(p.id) as total_invoices
      FROM suppliers s
      LEFT JOIN purchases p ON s.id = p.supplier_id
      GROUP BY s.id
      ORDER BY s.name ASC
    `);
    res.json({ suppliers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Supplier
router.post('/suppliers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, email, address, gst_or_pan, notes } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }

    const id = 'sup_' + Date.now();
    const now = new Date().toISOString();

    dbRun(`
      INSERT INTO suppliers (id, name, phone, email, address, gst_or_pan, notes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      id,
      name.trim(),
      phone?.trim() || null,
      email?.trim() || null,
      address?.trim() || null,
      gst_or_pan?.trim() || null,
      notes?.trim() || null,
      now
    ]);

    logAudit(req.user?.id || 'OWNER', 'CREATE_SUPPLIER', 'SUPPLIER', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Purchases List
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { supplier_id, status } = req.query;
    let sql = `
      SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        u.full_name as created_by_name
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (supplier_id) {
      sql += ' AND p.supplier_id = ?';
      params.push(supplier_id);
    }

    if (status) {
      sql += ' AND p.payment_status = ?';
      params.push(status);
    }

    sql += ' ORDER BY p.invoice_date DESC, p.created_at DESC';

    const purchases = dbQueryAll(sql, params);
    res.json({ purchases });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Purchase details with items
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const purchase = dbQueryOne<any>(`
      SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.address as supplier_address,
        u.full_name as created_by_name
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `, [id]);

    if (!purchase) {
      res.status(404).json({ error: 'Purchase record not found' });
      return;
    }

    const items = dbQueryAll(`
      SELECT 
        pi.*,
        pr.name as product_name,
        pr.code as product_code
      FROM purchase_items pi
      JOIN products pr ON pi.product_id = pr.id
      WHERE pi.purchase_id = ?
    `, [id]);

    res.json({ purchase: { ...purchase, items } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Purchase Invoice & Stock In
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      supplier_id,
      invoice_number,
      invoice_date,
      items,
      paid_amount = 0,
      payment_method = 'CASH', // 'CASH' | 'UPI' | 'BANK'
      notes
    } = req.body;

    if (!supplier_id) {
      res.status(400).json({ error: 'Supplier selection is required' });
      return;
    }

    if (!invoice_number || !invoice_number.trim()) {
      res.status(400).json({ error: 'Invoice number is required' });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Please add at least one purchase item' });
      return;
    }

    const supplier = dbQueryOne<any>('SELECT * FROM suppliers WHERE id = ?', [supplier_id]);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    let calculatedTotalCost = 0;
    const validatedItems: any[] = [];

    for (const it of items) {
      const product = dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!product) {
        res.status(400).json({ error: `Product not found: ${it.product_id}` });
        return;
      }
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      const unitCost = Math.max(0, Number(it.unit_cost) || 0);
      const totalItemCost = qty * unitCost;
      calculatedTotalCost += totalItemCost;

      validatedItems.push({
        product_id: it.product_id,
        variant_id: it.variant_id || null,
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalItemCost,
        batch_number: it.batch_number?.trim() || invoice_number.trim()
      });
    }

    const paidNum = Math.max(0, Number(paid_amount) || 0);
    const balanceDue = Math.max(0, calculatedTotalCost - paidNum);
    const paymentStatus = balanceDue === 0 ? 'PAID' : paidNum > 0 ? 'PARTIAL' : 'UNPAID';

    const purchaseId = 'pur_' + Date.now();
    const now = new Date().toISOString();
    const invDate = invoice_date ? invoice_date : now.split('T')[0];

    dbTransaction(() => {
      // 1. Insert Purchase
      dbRun(`
        INSERT INTO purchases (
          id, supplier_id, invoice_number, invoice_date, total_amount,
          paid_amount, balance_due, payment_status, payment_method, notes,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        purchaseId,
        supplier_id,
        invoice_number.trim(),
        invDate,
        calculatedTotalCost,
        paidNum,
        balanceDue,
        paymentStatus,
        paidNum > 0 ? payment_method : null,
        notes?.trim() || null,
        req.user?.id || 'OWNER',
        now
      ]);

      // 2. Insert items, create purchase batches, and ledger entries
      for (const it of validatedItems) {
        const purchaseItemId = 'pi_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const batchId = 'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

        dbRun(`
          INSERT INTO purchase_items (
            id, purchase_id, product_id, variant_id, quantity, unit_cost, total_cost, batch_number, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          purchaseItemId,
          purchaseId,
          it.product_id,
          it.variant_id,
          it.quantity,
          it.unit_cost,
          it.total_cost,
          it.batch_number,
          now
        ]);

        dbRun(`
          INSERT INTO purchase_batches (
            id, purchase_item_id, product_id, variant_id, batch_number, initial_qty, remaining_qty, unit_cost, received_date, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `, [
          batchId,
          purchaseItemId,
          it.product_id,
          it.variant_id,
          it.batch_number,
          it.quantity,
          it.quantity,
          it.unit_cost,
          invDate,
          now
        ]);

        // Stock Ledger entry
        dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, 'PURCHASE', ?, ?, 'PURCHASE', ?, ?, ?, ?)
        `, [
          'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          it.product_id,
          it.variant_id,
          batchId,
          it.quantity,
          it.unit_cost,
          purchaseId,
          `Purchase Invoice #${invoice_number}`,
          req.user?.id || 'OWNER',
          now
        ]);

        // Update product latest purchase cost
        dbRun('UPDATE products SET purchase_cost = ? WHERE id = ?', [it.unit_cost, it.product_id]);
      }

      // 3. Financial Transaction for paid amount (Distinct from operating expense!)
      if (paidNum > 0) {
        const ftxId = 'ftx_sup_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'SUPPLIER_PAYMENT', ?, 'INVENTORY_PURCHASE', ?, ?, ?, 1, ?, ?, ?)
        `, [
          ftxId,
          invDate,
          paidNum,
          payment_method, // CASH | UPI | BANK
          supplier.name,
          `Purchase Invoice #${invoice_number}`,
          invoice_number,
          req.user?.id || 'OWNER',
          now,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'OWNER', 'CREATE_PURCHASE', 'PURCHASE', purchaseId, {
      invoice_number,
      supplier: supplier.name,
      total: calculatedTotalCost,
      paid: paidNum
    });

    res.json({ success: true, id: purchaseId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Pay Supplier Outstanding Due
router.post('/:id/pay', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, payment_method = 'CASH', notes } = req.body;

    const purchase = dbQueryOne<any>(`
      SELECT p.*, s.name as supplier_name 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      WHERE p.id = ?
    `, [id]);

    if (!purchase) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }

    const payNum = Number(amount);
    if (!payNum || payNum <= 0) {
      res.status(400).json({ error: 'Valid payment amount is required' });
      return;
    }

    if (payNum > purchase.balance_due) {
      res.status(400).json({
        error: `Payment amount ₹${payNum} cannot exceed outstanding balance due ₹${purchase.balance_due}`
      });
      return;
    }

    const newPaid = purchase.paid_amount + payNum;
    const newBalance = purchase.balance_due - payNum;
    const newStatus = newBalance === 0 ? 'PAID' : 'PARTIAL';
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    dbTransaction(() => {
      dbRun(`
        UPDATE purchases SET
          paid_amount = ?,
          balance_due = ?,
          payment_status = ?
        WHERE id = ?
      `, [newPaid, newBalance, newStatus, id]);

      // Financial transaction for supplier payment (not operating expense!)
      const ftxId = 'ftx_sup_due_' + Date.now();
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'SUPPLIER_PAYMENT', ?, 'SUPPLIER_DUE_SETTLEMENT', ?, ?, ?, 1, ?, ?, ?)
      `, [
        ftxId,
        today,
        payNum,
        payment_method,
        purchase.supplier_name,
        `Supplier Due Payment: Inv #${purchase.invoice_number} (${notes || 'Settlement'})`,
        purchase.invoice_number,
        req.user?.id || 'OWNER',
        now,
        now
      ]);
    });

    logAudit(req.user?.id || 'OWNER', 'PAY_SUPPLIER_DUE', 'PURCHASE', id, {
      supplier: purchase.supplier_name,
      amount: payNum,
      balance: newBalance
    });

    res.json({ success: true, balance_due: newBalance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
