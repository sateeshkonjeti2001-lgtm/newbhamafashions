import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { randomHex } from '../cryptoUtil.ts';
import { getTodayIST, isValidDateString } from '../dateUtil.ts';
import { verifyOwnerPasswordOverride } from '../ownerOverride.ts';
import { isBusinessDayClosed, reconcileAffectedDayClosings } from '../closingSync.ts';

const router = new Router();

// Protect all supplier and purchase endpoints so only OWNER can access
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

// Suppliers List
router.get('/suppliers', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const suppliers = await dbQueryAll(`
      SELECT 
        s.*,
        COALESCE(SUM(CASE WHEN COALESCE(p.is_reversed, 0) = 0 THEN p.balance_due ELSE 0 END), 0) as total_dues,
        COALESCE(SUM(CASE WHEN COALESCE(p.is_reversed, 0) = 0 THEN 1 ELSE 0 END), 0) as total_invoices
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
router.post('/suppliers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, email, address, gst_or_pan, notes } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }

    const id = 'sup_' + Date.now();
    const now = new Date().toISOString();

    await dbRun(`
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
      now,
    ]);
    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'CREATE_SUPPLIER', 'SUPPLIER', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Purchases List
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
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

    const purchases = await dbQueryAll(sql, params);
    res.json({ purchases });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Purchase details with items
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const purchase = await dbQueryOne<any>(`
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

    const items = await dbQueryAll(`
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
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      supplier_id,
      invoice_number,
      invoice_date,
      items,
      paid_amount = 0,
      payment_method = 'CASH',
      notes,
      owner_password,
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

    const supplier = await dbQueryOne<any>('SELECT * FROM suppliers WHERE id = ?', [supplier_id]);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    let calculatedTotalCost = 0;
    const validatedItems: any[] = [];

    for (const it of items) {
      const product = await dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [it.product_id]);
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
        batch_number: it.batch_number?.trim() || invoice_number.trim(),
      });
    }

    const paidNum = Math.max(0, Number(paid_amount) || 0);
    const balanceDue = Math.max(0, calculatedTotalCost - paidNum);
    const paymentStatus = balanceDue === 0 ? 'PAID' : paidNum > 0 ? 'PARTIAL' : 'UNPAID';

    const purchaseId = 'pur_' + Date.now();
    const now = new Date().toISOString();
    const invDate = typeof invoice_date === 'string' && isValidDateString(invoice_date) ? invoice_date.trim() : getTodayIST();

    const invClosing = paidNum > 0 ? await isBusinessDayClosed(invDate) : { isClosed: false, record: null };
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (invClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${invDate} is CLOSED. Owner password verification is required to record cash/UPI/bank supplier payment on a closed day.`
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

    await dbTransaction(async () => {
      await dbRun(`
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
        now,
      ]);

      for (const it of validatedItems) {
        const purchaseItemId = 'pi_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const batchId = 'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

        await dbRun(`
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
          now,
        ]);

        await dbRun(`
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
          now,
        ]);

        await dbRun(`
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
          now,
        ]);

        await dbRun('UPDATE products SET purchase_cost = ? WHERE id = ?', [it.unit_cost, it.product_id]);
      }

      if (paidNum > 0) {
        const ftxId = 'ftx_sup_' + Date.now();
        await dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, day_closed, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'SUPPLIER_PAYMENT', ?, 'INVENTORY_PURCHASE', ?, ?, ?, 1, ?, ?, ?, ?)
        `, [
          ftxId,
          invDate,
          paidNum,
          payment_method,
          supplier.name,
          `Purchase Invoice #${invoice_number}`,
          payment_method,
          invoice_number,
          invClosing.isClosed ? 1 : 0,
          req.user?.id || 'OWNER',
          now,
          now,
        ]);
      }
    });
    if (invClosing.isClosed && paidNum > 0) {
      await reconcileAffectedDayClosings(
        [invDate],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Purchase Invoice #${invoice_number} initial payment (₹${paidNum}) on closed day ${invDate}`,
        now
      );
    }
    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'CREATE_PURCHASE', 'PURCHASE', purchaseId, {
      invoice_number,
      supplier: supplier.name,
      total: calculatedTotalCost,
      paid: paidNum,
    });

    res.json({ success: true, id: purchaseId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Pay Supplier Outstanding Due
router.post('/:id/pay', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, payment_method = 'CASH', notes, owner_password } = req.body;

    const purchase = await dbQueryOne<any>(`
      SELECT p.*, s.name as supplier_name 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      WHERE p.id = ?
    `, [id]);

    if (!purchase) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }

    if (purchase.is_reversed) {
      res.status(400).json({ error: 'Cannot pay due on a reversed purchase invoice.' });
      return;
    }

    const payNum = Number(amount);
    if (!payNum || payNum <= 0) {
      res.status(400).json({ error: 'Valid payment amount is required' });
      return;
    }

    if (payNum > purchase.balance_due) {
      res.status(400).json({
        error: `Payment amount ₹${payNum} cannot exceed outstanding balance due ₹${purchase.balance_due}`,
      });
      return;
    }

    const newPaid = purchase.paid_amount + payNum;
    const newBalance = purchase.balance_due - payNum;
    const newStatus = newBalance === 0 ? 'PAID' : 'PARTIAL';
    const now = new Date().toISOString();
    const today = getTodayIST();

    const todayClosing = await isBusinessDayClosed(today);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (todayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${today} is CLOSED. Owner password verification is required to record supplier settlement on a closed day.`
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

    await dbTransaction(async () => {
      await dbRun(`
        UPDATE purchases SET
          paid_amount = ?,
          balance_due = ?,
          payment_status = ?
        WHERE id = ?
      `, [newPaid, newBalance, newStatus, id]);

      const ftxId = 'ftx_sup_due_' + Date.now();
      await dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, day_closed, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'SUPPLIER_PAYMENT', ?, 'SUPPLIER_DUE_SETTLEMENT', ?, ?, ?, 1, ?, ?, ?, ?)
      `, [
        ftxId,
        today,
        payNum,
        payment_method,
        purchase.supplier_name,
        `Supplier Due Payment: Inv #${purchase.invoice_number} (${notes || 'Settlement'})`,
        payment_method,
        purchase.invoice_number,
        todayClosing.isClosed ? 1 : 0,
        req.user?.id || 'OWNER',
        now,
        now,
      ]);
    });

    if (todayClosing.isClosed) {
      await reconcileAffectedDayClosings(
        [today],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Supplier payment ₹${payNum} for Inv #${purchase.invoice_number} on closed day`,
        now
      );
    }

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'PAY_SUPPLIER_DUE', 'PURCHASE', id, {
      supplier: purchase.supplier_name,
      amount: payNum,
      balance: newBalance,
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json({ success: true, balance_due: newBalance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Edit Purchase Invoice & Reconcile Stock + Financials (Owner only)
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      supplier_id,
      invoice_number,
      invoice_date,
      items,
      paid_amount,
      payment_method = 'CASH',
      notes,
      reason,
      owner_password,
    } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory edit reason is required when modifying a purchase invoice.' });
      return;
    }

    const existingPurchase = await dbQueryOne<any>('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!existingPurchase) {
      res.status(404).json({ error: 'Purchase record not found.' });
      return;
    }

    if (existingPurchase.is_reversed) {
      res.status(400).json({ error: 'Reversed purchases cannot be edited.' });
      return;
    }

    const cleanInvNo = String(invoice_number || existingPurchase.invoice_number || '').trim();
    if (!cleanInvNo) {
      res.status(400).json({ error: 'Invoice number is required.' });
      return;
    }

    const newInvDate =
      typeof invoice_date === 'string' && isValidDateString(invoice_date)
        ? invoice_date.trim()
        : existingPurchase.invoice_date;

    const targetSupplierId = supplier_id || existingPurchase.supplier_id;
    const supplier = await dbQueryOne<any>('SELECT * FROM suppliers WHERE id = ?', [targetSupplierId]);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found.' });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Purchase must include at least one item.' });
      return;
    }

    const existingItems = await dbQueryAll<any>('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    const existingBatches = await dbQueryAll<any>(
      `SELECT pb.*, pi.product_id as item_prod_id
       FROM purchase_batches pb
       JOIN purchase_items pi ON pb.purchase_item_id = pi.id
       WHERE pi.purchase_id = ?`,
      [id]
    );

    const batchByPurchaseItemId = new Map<string, any>();
    for (const b of existingBatches) {
      batchByPurchaseItemId.set(b.purchase_item_id, b);
    }

    const existingSettlements = await dbQueryAll<any>(
      `SELECT * FROM financial_transactions
       WHERE reference_no = ? AND transaction_type = 'SUPPLIER_PAYMENT'
         AND category = 'SUPPLIER_DUE_SETTLEMENT' AND is_reversed = 0`,
      [existingPurchase.invoice_number]
    );
    const totalExtraSettlements = existingSettlements.reduce((s, tx) => s + Number(tx.amount || 0), 0);

    const existingInitialTx = await dbQueryOne<any>(
      `SELECT * FROM financial_transactions
       WHERE reference_no = ? AND transaction_type = 'SUPPLIER_PAYMENT'
         AND category = 'INVENTORY_PURCHASE' AND is_reversed = 0
       LIMIT 1`,
      [existingPurchase.invoice_number]
    );

    let calculatedTotalCost = 0;
    const validatedItems: Array<{
      existing_item_id: string | null;
      existing_batch: any | null;
      product_id: string;
      product_name: string;
      variant_id: string | null;
      quantity: number;
      unit_cost: number;
      total_cost: number;
      batch_number: string;
      delta_qty: number;
    }> = [];

    for (const it of items) {
      const product = await dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!product) {
        res.status(400).json({ error: `Product not found: ${it.product_id}` });
        return;
      }
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      const unitCost = Math.max(0, Number(it.unit_cost) || 0);
      const totalItemCost = Math.round(qty * unitCost * 100) / 100;
      calculatedTotalCost += totalItemCost;

      const matchedOld = existingItems.find(
        (old) => old.product_id === it.product_id && (old.variant_id || null) === (it.variant_id || null)
      );
      const linkedBatch = matchedOld ? batchByPurchaseItemId.get(matchedOld.id) || null : null;
      if (linkedBatch) {
        const consumed = Number(linkedBatch.initial_qty || 0) - Number(linkedBatch.remaining_qty || 0);
        if (qty < consumed) {
          res.status(400).json({
            error: `Cannot reduce "${product.name}" quantity to ${qty}: ${consumed} units from this batch have already been sold or adjusted.`,
          });
          return;
        }
      }

      validatedItems.push({
        existing_item_id: matchedOld?.id || null,
        existing_batch: linkedBatch,
        product_id: it.product_id,
        product_name: product.name,
        variant_id: it.variant_id || null,
        quantity: qty,
        unit_cost: unitCost,
        total_cost: totalItemCost,
        batch_number: it.batch_number?.trim() || cleanInvNo,
        delta_qty: matchedOld ? qty - Number(matchedOld.quantity || 0) : qty,
      });
    }

    // Check any removed items from original purchase
    const removedItems = existingItems.filter(
      (old) => !validatedItems.some((v) => v.existing_item_id === old.id)
    );
    for (const rem of removedItems) {
      const remBatch = batchByPurchaseItemId.get(rem.id);
      if (remBatch && Number(remBatch.remaining_qty) < Number(remBatch.initial_qty)) {
        res.status(400).json({
          error: 'Cannot remove a purchase item whose stock batch has already been partially or fully sold.',
        });
        return;
      }
    }

    const totalPaidNum =
      paid_amount !== undefined ? Math.max(0, Number(paid_amount) || 0) : Number(existingPurchase.paid_amount || 0);
    if (totalPaidNum < totalExtraSettlements) {
      res.status(400).json({
        error: `Total paid cannot be less than ₹${totalExtraSettlements} already paid via supplier due settlements.`,
      });
      return;
    }
    if (totalPaidNum > calculatedTotalCost) {
      res.status(400).json({
        error: `Paid amount ₹${totalPaidNum} cannot exceed invoice total ₹${calculatedTotalCost}.`,
      });
      return;
    }

    const newInitialPaid = Math.round((totalPaidNum - totalExtraSettlements) * 100) / 100;
    const newBalanceDue = Math.max(0, Math.round((calculatedTotalCost - totalPaidNum) * 100) / 100);
    const newPayStatus = newBalanceDue === 0 ? 'PAID' : totalPaidNum > 0 ? 'PARTIAL' : 'UNPAID';

    const oldTxDate = existingInitialTx?.date || existingPurchase.invoice_date;
    const oldClosing = await isBusinessDayClosed(oldTxDate);
    const newClosing = newInvDate !== oldTxDate ? await isBusinessDayClosed(newInvDate) : oldClosing;
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (oldClosing.isClosed || newClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Purchase affects a CLOSED business day (${oldClosing.isClosed ? oldTxDate : newInvDate}). Owner password verification is required.`
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

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE purchases SET
          supplier_id = ?,
          invoice_number = ?,
          invoice_date = ?,
          total_amount = ?,
          paid_amount = ?,
          balance_due = ?,
          payment_status = ?,
          payment_method = ?,
          notes = ?
         WHERE id = ?`,
        [
          targetSupplierId,
          cleanInvNo,
          newInvDate,
          calculatedTotalCost,
          totalPaidNum,
          newBalanceDue,
          newPayStatus,
          totalPaidNum > 0 ? payment_method : null,
          notes !== undefined ? notes?.trim() || null : existingPurchase.notes,
          id,
        ]
      );

      for (const rem of removedItems) {
        const remBatch = batchByPurchaseItemId.get(rem.id);
        if (remBatch) {
          await dbRun('UPDATE purchase_batches SET remaining_qty = 0, is_active = 0 WHERE id = ?', [remBatch.id]);
        }
        await dbRun('DELETE FROM purchase_items WHERE id = ?', [rem.id]);
        await dbRun(
          `INSERT INTO stock_ledger (
            id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'PURCHASE', ?, ?, ?, ?)`,
          [
            'stk_pedit_' + Date.now() + '_' + randomHex(4),
            rem.product_id,
            rem.variant_id || null,
            remBatch?.id || null,
            -Number(rem.quantity),
            rem.unit_cost,
            id,
            `Purchase Edit #${cleanInvNo} (Item removed): ${cleanReason}`,
            req.user?.id || 'OWNER',
            now,
          ]
        );
      }

      for (const v of validatedItems) {
        if (v.existing_item_id && v.existing_batch) {
          const oldBatch = v.existing_batch;
          const consumed = Number(oldBatch.initial_qty || 0) - Number(oldBatch.remaining_qty || 0);
          const newRemaining = Math.max(0, v.quantity - consumed);
          await dbRun(
            `UPDATE purchase_items SET quantity = ?, unit_cost = ?, total_cost = ?, batch_number = ? WHERE id = ?`,
            [v.quantity, v.unit_cost, v.total_cost, v.batch_number, v.existing_item_id]
          );
          await dbRun(
            `UPDATE purchase_batches SET initial_qty = ?, remaining_qty = ?, unit_cost = ?, batch_number = ?, received_date = ?, is_active = ? WHERE id = ?`,
            [v.quantity, newRemaining, v.unit_cost, v.batch_number, newInvDate, newRemaining > 0 ? 1 : 0, oldBatch.id]
          );
          if (v.delta_qty !== 0) {
            await dbRun(
              `INSERT INTO stock_ledger (
                id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
              ) VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'PURCHASE', ?, ?, ?, ?)`,
              [
                'stk_pedit_' + Date.now() + '_' + randomHex(4),
                v.product_id,
                v.variant_id,
                oldBatch.id,
                v.delta_qty,
                v.unit_cost,
                id,
                `Purchase Edit #${cleanInvNo}: ${cleanReason}`,
                req.user?.id || 'OWNER',
                now,
              ]
            );
          }
        } else {
          const purchaseItemId = 'pi_' + Date.now() + '_' + randomHex(4);
          const batchId = 'batch_' + Date.now() + '_' + randomHex(4);
          await dbRun(
            `INSERT INTO purchase_items (
              id, purchase_id, product_id, variant_id, quantity, unit_cost, total_cost, batch_number, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [purchaseItemId, id, v.product_id, v.variant_id, v.quantity, v.unit_cost, v.total_cost, v.batch_number, now]
          );
          await dbRun(
            `INSERT INTO purchase_batches (
              id, purchase_item_id, product_id, variant_id, batch_number, initial_qty, remaining_qty, unit_cost, received_date, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [batchId, purchaseItemId, v.product_id, v.variant_id, v.batch_number, v.quantity, v.quantity, v.unit_cost, newInvDate, now]
          );
          await dbRun(
            `INSERT INTO stock_ledger (
              id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
            ) VALUES (?, ?, ?, ?, 'PURCHASE', ?, ?, 'PURCHASE', ?, ?, ?, ?)`,
            [
              'stk_pedit_' + Date.now() + '_' + randomHex(4),
              v.product_id,
              v.variant_id,
              batchId,
              v.quantity,
              v.unit_cost,
              id,
              `Purchase Edit #${cleanInvNo} (Item added): ${cleanReason}`,
              req.user?.id || 'OWNER',
              now,
            ]
          );
        }
        await dbRun('UPDATE products SET purchase_cost = ? WHERE id = ?', [v.unit_cost, v.product_id]);
      }

      if (newInitialPaid > 0) {
        if (existingInitialTx) {
          await dbRun(
            `UPDATE financial_transactions SET
              date = ?, amount = ?, source_account = ?, person_entity = ?, purpose = ?,
              payment_method = ?, reference_no = ?, day_closed = ?, updated_at = ?
             WHERE id = ?`,
            [
              newInvDate,
              newInitialPaid,
              payment_method,
              supplier.name,
              `Purchase Invoice #${cleanInvNo}`,
              payment_method,
              cleanInvNo,
              newClosing.isClosed ? 1 : 0,
              now,
              existingInitialTx.id,
            ]
          );
        } else {
          await dbRun(
            `INSERT INTO financial_transactions (
              id, date, amount, source_account, destination_account, transaction_type,
              person_entity, category, purpose, payment_method, reference_no,
              is_system_generated, day_closed, user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'SUPPLIER_PAYMENT', ?, 'INVENTORY_PURCHASE', ?, ?, ?, 1, ?, ?, ?, ?)`,
            [
              'ftx_sup_' + Date.now() + '_' + randomHex(3),
              newInvDate,
              newInitialPaid,
              payment_method,
              supplier.name,
              `Purchase Invoice #${cleanInvNo}`,
              payment_method,
              cleanInvNo,
              newClosing.isClosed ? 1 : 0,
              req.user?.id || 'OWNER',
              now,
              now,
            ]
          );
        }
      } else if (existingInitialTx) {
        await dbRun('UPDATE financial_transactions SET is_reversed = 1, updated_at = ? WHERE id = ?', [
          now,
          existingInitialTx.id,
        ]);
      }
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      [oldTxDate, newInvDate],
      overrideOwner?.full_name || req.user?.full_name || 'Owner',
      `Edited Purchase Inv #${cleanInvNo} (₹${existingPurchase.total_amount} -> ₹${calculatedTotalCost}): ${cleanReason}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'EDIT_PURCHASE', 'PURCHASE', id, {
      invoice_number: cleanInvNo,
      reason: cleanReason,
      override_authorized_by: overrideOwner?.full_name || null,
      modified_closed_dates: modifiedClosedDates,
      before: {
        invoice_number: existingPurchase.invoice_number,
        invoice_date: existingPurchase.invoice_date,
        total_amount: existingPurchase.total_amount,
        paid_amount: existingPurchase.paid_amount,
        balance_due: existingPurchase.balance_due,
        items: existingItems,
      },
      after: {
        invoice_number: cleanInvNo,
        invoice_date: newInvDate,
        total_amount: calculatedTotalCost,
        paid_amount: totalPaidNum,
        balance_due: newBalanceDue,
      },
    });

    res.json({ success: true, modified_closed_dates: modifiedClosedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Safe Reversal of a Purchase Invoice (Owner only)
router.post('/:id/reverse', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, owner_password } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reverse a purchase invoice.' });
      return;
    }

    const purchase = await dbQueryOne<any>(
      `SELECT p.*, s.name as supplier_name FROM purchases p JOIN suppliers s ON p.supplier_id = s.id WHERE p.id = ?`,
      [id]
    );
    if (!purchase) {
      res.status(404).json({ error: 'Purchase record not found.' });
      return;
    }

    if (purchase.is_reversed) {
      res.status(400).json({ error: 'This purchase invoice has already been reversed.' });
      return;
    }

    const items = await dbQueryAll<any>('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    const batches = await dbQueryAll<any>(
      `SELECT pb.*
       FROM purchase_batches pb
       JOIN purchase_items pi ON pb.purchase_item_id = pi.id
       WHERE pi.purchase_id = ?`,
      [id]
    );

    const consumedBatch = batches.find((b) => Number(b.remaining_qty) < Number(b.initial_qty));
    if (consumedBatch) {
      res.status(400).json({
        error: 'Cannot reverse this purchase invoice because units from its stock batches have already been sold or adjusted.',
      });
      return;
    }

    const finTxs = await dbQueryAll<any>(
      `SELECT * FROM financial_transactions
       WHERE reference_no = ? AND transaction_type = 'SUPPLIER_PAYMENT' AND is_reversed = 0`,
      [purchase.invoice_number]
    );

    const affectedDates = Array.from(new Set(finTxs.map((t) => t.date).concat([purchase.invoice_date])));
    let anyClosed = false;
    for (const d of affectedDates) {
      if ((await isBusinessDayClosed(d)).isClosed) {
        anyClosed = true;
        break;
      }
    }

    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (anyClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Purchase #${purchase.invoice_number} involves a CLOSED business day. Owner password verification is required.`
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
        `UPDATE purchases SET
          is_reversed = 1,
          paid_amount = 0,
          balance_due = 0,
          reversed_reason = ?,
          reversed_at = ?,
          reversed_by = ?
         WHERE id = ?`,
        [cleanReason, now, req.user?.id || 'OWNER', id]
      );

      for (const b of batches) {
        await dbRun('UPDATE purchase_batches SET remaining_qty = 0, is_active = 0 WHERE id = ?', [b.id]);
      }

      for (const it of items) {
        await dbRun(
          `INSERT INTO stock_ledger (
            id, product_id, variant_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, 'SUPPLIER_RETURN', ?, ?, 'PURCHASE', ?, ?, ?, ?)`,
          [
            'stk_prev_' + Date.now() + '_' + randomHex(4),
            it.product_id,
            it.variant_id || null,
            -Number(it.quantity),
            it.unit_cost,
            id,
            `Purchase Reversal #${purchase.invoice_number}: ${cleanReason}`,
            req.user?.id || 'OWNER',
            now,
          ]
        );
      }

      for (const tx of finTxs) {
        await dbRun(
          `UPDATE financial_transactions SET
            is_reversed = 1,
            notes = COALESCE(notes || ' | ', '') || ?,
            updated_at = ?
           WHERE id = ?`,
          [`[REVERSED Purchase #${purchase.invoice_number}: ${cleanReason}]`, now, tx.id]
        );
      }
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      affectedDates,
      actorName,
      `Reversed Purchase Inv #${purchase.invoice_number} (₹${purchase.total_amount}): ${cleanReason}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'REVERSE_PURCHASE', 'PURCHASE', id, {
      invoice_number: purchase.invoice_number,
      supplier: purchase.supplier_name,
      total_amount: purchase.total_amount,
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
