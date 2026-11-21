import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { randomHex } from '../cryptoUtil.ts';
import { getTodayIST } from '../dateUtil.ts';

const router = new Router();

// Current stock status across all products
router.get('/stock', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { category_id, search } = req.query;

    let sql = `
      SELECT 
        p.id,
        p.id as product_id,
        p.name,
        p.name as product_name,
        p.code,
        p.sku,
        p.barcode,
        p.mrp,
        p.selling_price,
        c.name as category_name,
        b.name as brand_name,
        COALESCE(SUM(sl.quantity), 0) as current_stock
        ${isOwner ? ', p.purchase_cost' : ''}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE p.is_active = 1
    `;
    const params: any[] = [];

    if (category_id) {
      sql += ' AND p.category_id = ?';
      params.push(category_id);
    }

    if (search && typeof search === 'string' && search.trim()) {
      sql += ' AND (p.name LIKE ? OR p.code LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += ' GROUP BY p.id ORDER BY p.name ASC';

    const stockList = await dbQueryAll(sql, params);
    res.json({ stock: stockList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Immutable Stock Movement History / Ledger
router.get('/ledger', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { product_id, movement_type, limit = 100 } = req.query;

    let sql = `
      SELECT 
        sl.id,
        sl.product_id,
        sl.variant_id,
        sl.batch_id,
        sl.movement_type,
        sl.quantity,
        sl.reference_type,
        sl.reference_id,
        sl.reason,
        sl.created_at,
        p.name as product_name,
        p.code as product_code,
        u.full_name as created_by_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM stock_ledger r
          WHERE r.reference_id = sl.id AND r.reason LIKE 'REVERSAL of%'
        ) THEN 1 ELSE 0 END as is_reversed,
        CASE WHEN sl.reference_type IN ('MANUAL_ADJUSTMENT', 'WRITE_OFF')
          AND sl.reason NOT LIKE 'REVERSAL of%'
          AND NOT EXISTS (
            SELECT 1 FROM stock_ledger r
            WHERE r.reference_id = sl.id AND r.reason LIKE 'REVERSAL of%'
          ) THEN 1 ELSE 0 END as reversible
        ${isOwner ? ', sl.unit_cost' : ''}
      FROM stock_ledger sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN users u ON sl.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (product_id) {
      sql += ' AND sl.product_id = ?';
      params.push(product_id);
    }

    if (movement_type) {
      sql += ' AND sl.movement_type = ?';
      params.push(movement_type);
    }

    sql += ' ORDER BY sl.created_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const ledger = await dbQueryAll(sql, params);
    res.json({ ledger });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Active Purchase Batches
router.get('/batches', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { product_id } = req.query;

    let sql = `
      SELECT 
        pb.id,
        pb.product_id,
        pb.variant_id,
        pb.batch_number,
        pb.batch_number as invoice_number,
        pb.initial_qty,
        pb.initial_qty as original_quantity,
        pb.remaining_qty,
        pb.remaining_qty as remaining_quantity,
        pb.received_date,
        pb.is_active,
        pb.created_at,
        p.name as product_name
        ${isOwner ? ', pb.unit_cost' : ''}
      FROM purchase_batches pb
      JOIN products p ON pb.product_id = p.id
      WHERE pb.remaining_qty > 0
    `;
    const params: any[] = [];

    if (product_id) {
      sql += ' AND pb.product_id = ?';
      params.push(product_id);
    }

    sql += ' ORDER BY pb.received_date ASC, pb.created_at ASC';

    const batches = await dbQueryAll(sql, params);
    res.json({ batches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual Stock Adjustment / Damage / Write-off
router.post('/adjust', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only Owner can perform manual stock adjustments or write-offs' });
      return;
    }

    const { product_id, variant_id, adjustment_type, quantity, reason } = req.body;

    if (!product_id || !quantity || Number(quantity) === 0) {
      res.status(400).json({ error: 'Product and non-zero quantity are required.' });
      return;
    }

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'Detailed reason is required for stock movement traceability.' });
      return;
    }

    const product = await dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [product_id]);
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const qtyNum = Number(quantity);
    const stockRow = await dbQueryOne<{ current_stock: number }>(
      'SELECT COALESCE(SUM(quantity), 0) as current_stock FROM stock_ledger WHERE product_id = ?',
      [product_id]
    );
    const currentStock = Number(stockRow?.current_stock || 0);
    if (qtyNum < 0 && currentStock + qtyNum < 0) {
      res.status(400).json({
        error: `Cannot reduce stock by ${Math.abs(qtyNum)}: current available stock for "${product.name}" is ${currentStock}.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const todayIST = getTodayIST();
    const ledgerId = 'stk_adj_' + Date.now() + '_' + randomHex(3);

    const batchUpdates: Array<{ id: string; remaining_qty: number; is_active: number }> = [];
    if (qtyNum < 0) {
      let needed = Math.abs(qtyNum);
      const batches = await dbQueryAll<any>(
        'SELECT * FROM purchase_batches WHERE product_id = ? AND remaining_qty > 0 ORDER BY received_date ASC, created_at ASC',
        [product_id]
      );
      for (const b of batches) {
        if (needed <= 0) break;
        const take = Math.min(b.remaining_qty, needed);
        const newRemaining = b.remaining_qty - take;
        batchUpdates.push({
          id: b.id,
          remaining_qty: newRemaining,
          is_active: newRemaining > 0 ? 1 : 0,
        });
        needed -= take;
      }
    }

    await dbTransaction(async () => {
      if (qtyNum < 0) {
        for (const bu of batchUpdates) {
          await dbRun('UPDATE purchase_batches SET remaining_qty = ?, is_active = ? WHERE id = ?', [
            bu.remaining_qty,
            bu.is_active,
            bu.id,
          ]);
        }

        await dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, variant_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, ?, ?)
        `, [
          ledgerId,
          product_id,
          variant_id || null,
          adjustment_type || 'ADJUSTMENT',
          qtyNum,
          product.purchase_cost || 0,
          ledgerId,
          reason.trim(),
          req.user?.id || 'SYSTEM',
          now,
        ]);
      } else {
        const batchId = 'batch_adj_' + Date.now() + '_' + randomHex(3);
        await dbRun(`
          INSERT INTO purchase_batches (
            id, product_id, variant_id, batch_number, initial_qty, remaining_qty, unit_cost, received_date, is_active, created_at
          ) VALUES (?, ?, ?, 'MANUAL-ADJ', ?, ?, ?, ?, 1, ?)
        `, [
          batchId,
          product_id,
          variant_id || null,
          qtyNum,
          qtyNum,
          product.purchase_cost || 0,
          todayIST,
          now,
        ]);

        await dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, ?, ?)
        `, [
          ledgerId,
          product_id,
          variant_id || null,
          batchId,
          qtyNum,
          product.purchase_cost || 0,
          ledgerId,
          reason.trim(),
          req.user?.id || 'SYSTEM',
          now,
        ]);
      }
    });

    saveDb(true);
    await logAudit(req.user.id, 'STOCK_ADJUSTMENT', 'STOCK', ledgerId, {
      product: product.name,
      quantity: qtyNum,
      type: adjustment_type,
      reason,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Safe Reversal of a Manual Stock Adjustment / Write-off (Owner only)
router.post('/ledger/:id/reverse', authMiddleware, requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reverse a stock adjustment.' });
      return;
    }

    const entry = await dbQueryOne<any>(
      `SELECT sl.*, p.name as product_name
       FROM stock_ledger sl
       JOIN products p ON sl.product_id = p.id
       WHERE sl.id = ?`,
      [id]
    );
    if (!entry) {
      res.status(404).json({ error: 'Stock ledger entry not found.' });
      return;
    }

    if (!['MANUAL_ADJUSTMENT', 'WRITE_OFF'].includes(entry.reference_type || '')) {
      res.status(400).json({
        error: `Only manual stock adjustments and write-offs can be reversed here (found ${entry.reference_type || entry.movement_type}).`,
      });
      return;
    }

    if (String(entry.reason || '').startsWith('REVERSAL of')) {
      res.status(400).json({ error: 'Reversal entries cannot be reversed again.' });
      return;
    }

    const existingReversal = await dbQueryOne<any>(
      `SELECT id FROM stock_ledger WHERE reference_id = ? AND reason LIKE 'REVERSAL of%'`,
      [id]
    );
    if (existingReversal) {
      res.status(400).json({ error: 'This stock adjustment has already been reversed.' });
      return;
    }

    const reverseQty = -Number(entry.quantity || 0);
    if (reverseQty === 0) {
      res.status(400).json({ error: 'Entry has zero quantity and cannot be reversed.' });
      return;
    }

    const stockRow = await dbQueryOne<{ current_stock: number }>(
      'SELECT COALESCE(SUM(quantity), 0) as current_stock FROM stock_ledger WHERE product_id = ?',
      [entry.product_id]
    );
    const currentStock = Number(stockRow?.current_stock || 0);
    if (reverseQty < 0 && currentStock + reverseQty < 0) {
      res.status(400).json({
        error: `Cannot reverse +${entry.quantity} adjustment for "${entry.product_name}" because current stock (${currentStock}) would become negative.`,
      });
      return;
    }

    let linkedBatch: any = null;
    if (entry.batch_id) {
      linkedBatch = await dbQueryOne<any>('SELECT * FROM purchase_batches WHERE id = ?', [entry.batch_id]);
      if (reverseQty < 0 && linkedBatch && Number(linkedBatch.remaining_qty || 0) < Math.abs(reverseQty)) {
        res.status(400).json({
          error: `Cannot reverse +${entry.quantity} batch addition because units from batch ${linkedBatch.batch_number} have already been sold.`,
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const todayIST = getTodayIST();
    const reversalId = 'stk_rev_' + Date.now() + '_' + randomHex(3);
    const cleanReason = String(reason).trim();

    await dbTransaction(async () => {
      if (linkedBatch && reverseQty < 0) {
        const newRemaining = Math.max(0, Number(linkedBatch.remaining_qty) + reverseQty);
        await dbRun('UPDATE purchase_batches SET remaining_qty = ?, is_active = ? WHERE id = ?', [
          newRemaining,
          newRemaining > 0 ? 1 : 0,
          linkedBatch.id,
        ]);
      } else if (reverseQty > 0) {
        const restoreBatchId = 'batch_rev_' + Date.now() + '_' + randomHex(3);
        await dbRun(
          `INSERT INTO purchase_batches (
            id, product_id, variant_id, batch_number, initial_qty, remaining_qty, unit_cost, received_date, is_active, created_at
          ) VALUES (?, ?, ?, 'ADJ-REVERSAL', ?, ?, ?, ?, 1, ?)`,
          [
            restoreBatchId,
            entry.product_id,
            entry.variant_id || null,
            reverseQty,
            reverseQty,
            entry.unit_cost || 0,
            todayIST,
            now,
          ]
        );
      }

      await dbRun(
        `INSERT INTO stock_ledger (
          id, product_id, variant_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, ?, ?)`,
        [
          reversalId,
          entry.product_id,
          entry.variant_id || null,
          entry.batch_id || null,
          reverseQty,
          entry.unit_cost || 0,
          id,
          `REVERSAL of ${id}: ${cleanReason}`,
          req.user?.id || 'OWNER',
          now,
        ]
      );
    });

    saveDb(true);
    await logAudit(req.user!.id, 'REVERSE_STOCK_ADJUSTMENT', 'STOCK', id, {
      product: entry.product_name,
      original_quantity: entry.quantity,
      reversal_quantity: reverseQty,
      reversal_id: reversalId,
      reason: cleanReason,
    });

    res.json({ success: true, reversal_id: reversalId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
