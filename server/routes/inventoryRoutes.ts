import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();

// Current stock status across all products
router.get('/stock', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
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

    const stockList = dbQueryAll(sql, params);
    res.json({ stock: stockList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Immutable Stock Movement History / Ledger
router.get('/ledger', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
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
        u.full_name as created_by_name
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

    const ledger = dbQueryAll(sql, params);
    res.json({ ledger });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Active Purchase Batches (Owner only for cost)
router.get('/batches', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
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

    const batches = dbQueryAll(sql, params);
    res.json({ batches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual Stock Adjustment / Damage / Write-off
router.post('/adjust', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only Owner can perform manual stock adjustments or write-offs' });
      return;
    }

    const { product_id, variant_id, adjustment_type, quantity, reason } = req.body;
    // adjustment_type: 'DAMAGE' | 'WRITE_OFF' | 'ADJUSTMENT' (in or out)

    if (!product_id || !quantity || Number(quantity) === 0) {
      res.status(400).json({ error: 'Product and non-zero quantity are required.' });
      return;
    }

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'Detailed reason is required for stock movement traceability.' });
      return;
    }

    const product = dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [product_id]);
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const qtyNum = Number(quantity);
    const now = new Date().toISOString();
    const ledgerId = 'stk_adj_' + Date.now();

    dbTransaction(() => {
      // If negative movement (out, damage, write-off)
      if (qtyNum < 0) {
        // Reduce from oldest batch FIFO
        const absQty = Math.abs(qtyNum);
        let needed = absQty;
        const batches = dbQueryAll<any>(
          'SELECT * FROM purchase_batches WHERE product_id = ? AND remaining_qty > 0 ORDER BY received_date ASC, created_at ASC',
          [product_id]
        );

        for (const b of batches) {
          if (needed <= 0) break;
          const take = Math.min(b.remaining_qty, needed);
          const newRemaining = b.remaining_qty - take;
          dbRun('UPDATE purchase_batches SET remaining_qty = ?, is_active = ? WHERE id = ?', [
            newRemaining,
            newRemaining > 0 ? 1 : 0,
            b.id
          ]);
          needed -= take;
        }

        dbRun(`
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
          now
        ]);
      } else {
        // Positive stock adjustment (Stock In)
        const batchId = 'batch_adj_' + Date.now();
        dbRun(`
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
          now.split('T')[0],
          now
        ]);

        dbRun(`
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
          now
        ]);
      }
    });

    logAudit(req.user.id, 'STOCK_ADJUSTMENT', 'STOCK', ledgerId, {
      product: product.name,
      quantity: qtyNum,
      type: adjustment_type,
      reason
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
