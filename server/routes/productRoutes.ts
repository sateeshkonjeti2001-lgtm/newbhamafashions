import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();

// ----------------- Categories -----------------
router.get('/categories', authMiddleware, (req, res) => {
  try {
    const categories = dbQueryAll('SELECT * FROM categories ORDER BY name ASC');
    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only Owner can manage categories' });
      return;
    }
    const { name, code, description, attributes_schema } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }

    const id = 'cat_' + Date.now();
    const schemaStr = attributes_schema ? JSON.stringify(attributes_schema) : null;
    dbRun(
      'INSERT INTO categories (id, name, code, description, attributes_schema, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [id, name.trim(), code?.trim() || null, description?.trim() || null, schemaStr, new Date().toISOString()]
    );

    logAudit(req.user.id, 'CREATE_CATEGORY', 'CATEGORY', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Brands -----------------
router.get('/brands', authMiddleware, (req, res) => {
  try {
    const brands = dbQueryAll('SELECT * FROM brands ORDER BY name ASC');
    res.json({ brands });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/brands', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only Owner can manage brands' });
      return;
    }
    const { name } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Brand name is required' });
      return;
    }

    const id = 'brd_' + Date.now();
    dbRun('INSERT INTO brands (id, name, is_active, created_at) VALUES (?, ?, 1, ?)', [
      id,
      name.trim(),
      new Date().toISOString()
    ]);

    logAudit(req.user.id, 'CREATE_BRAND', 'BRAND', id, { name });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Products -----------------
router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { search, category_id, active_only } = req.query;

    let sql = `
      SELECT 
        p.id, p.category_id, p.brand_id, p.model_id, p.name, p.code, p.sku, p.barcode,
        p.description, p.tags, p.mrp, p.selling_price, p.festival_discount, p.category_attributes, p.image_url,
        p.is_active, p.sales_channel, p.created_at, p.updated_at,
        c.name as category_name,
        b.name as brand_name,
        COALESCE(SUM(sl.quantity), 0) as current_stock
        ${isOwner ? ', p.purchase_cost' : ''}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE p.id != 'prod_manual_billing'
    `;
    const params: any[] = [];

    if (active_only === 'true') {
      sql += ' AND p.is_active = 1';
    }

    if (category_id) {
      sql += ' AND p.category_id = ?';
      params.push(category_id);
    }

    if (search && typeof search === 'string' && search.trim()) {
      sql += ' AND (p.name LIKE ? OR p.code LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.tags LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    sql += ' GROUP BY p.id ORDER BY p.name ASC';

    const products = dbQueryAll(sql, params);

    // Also attach variants
    const allVariants = dbQueryAll(`
      SELECT 
        v.id, v.product_id, v.size, v.color, v.sku, v.barcode, v.mrp, v.selling_price, v.festival_discount, v.is_active
        ${isOwner ? ', v.purchase_cost' : ''}
      FROM product_variants v
      WHERE v.is_active = 1
    `);

    const variantsByProduct: Record<string, any[]> = {};
    for (const v of allVariants) {
      if (!variantsByProduct[v.product_id]) {
        variantsByProduct[v.product_id] = [];
      }
      variantsByProduct[v.product_id].push(v);
    }

    const result = products.map((p) => ({
      ...p,
      category_attributes: p.category_attributes ? JSON.parse(p.category_attributes) : null,
      variants: variantsByProduct[p.id] || []
    }));

    res.json({ products: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single product details
router.get('/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const { id } = req.params;

    const p = dbQueryOne<any>(`
      SELECT 
        p.*,
        c.name as category_name,
        b.name as brand_name,
        COALESCE(SUM(sl.quantity), 0) as current_stock
        ${isOwner ? '' : ', NULL as purchase_cost'}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE p.id = ?
      GROUP BY p.id
    `, [id]);

    if (!p) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const variants = dbQueryAll(`
      SELECT 
        v.id, v.product_id, v.size, v.color, v.sku, v.barcode, v.mrp, v.selling_price, v.festival_discount, v.is_active
        ${isOwner ? ', v.purchase_cost' : ''}
      FROM product_variants v
      WHERE v.product_id = ?
      ORDER BY v.size ASC, v.color ASC
    `, [id]);

    res.json({
      product: {
        ...p,
        category_attributes: p.category_attributes ? JSON.parse(p.category_attributes) : null,
        variants
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// In-memory cache for idempotency and duplicate request prevention on retries / timeouts
interface RecentProductSubmission {
  productId: string;
  fingerprint: string;
  timestamp: number;
}
const recentSubmissions = new Map<string, RecentProductSubmission>();

function pruneRecentSubmissions() {
  const expiry = Date.now() - 60 * 1000; // 60 seconds TTL
  for (const [key, sub] of recentSubmissions.entries()) {
    if (sub.timestamp < expiry) {
      recentSubmissions.delete(key);
    }
  }
}

// Create product (Owner only)
router.post('/', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only store Owner can add or configure products' });
      return;
    }

    const {
      name,
      category_id,
      brand_id,
      code,
      sku,
      barcode,
      description,
      tags,
      mrp,
      selling_price,
      purchase_cost = 0,
      festival_discount = 0,
      category_attributes,
      image_url,
      variants,
      initial_stock, // optional initial stock adjustment if physical stock exists on day 1
      idempotency_key
    } = req.body;

    // 1. Basic Field Validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Product name is required.' });
      return;
    }

    if (mrp === undefined || mrp === null || isNaN(Number(mrp)) || Number(mrp) < 0) {
      res.status(400).json({ error: 'Valid MRP (Maximum Retail Price) is required and must be >= 0.' });
      return;
    }

    if (selling_price === undefined || selling_price === null || isNaN(Number(selling_price)) || Number(selling_price) < 0) {
      res.status(400).json({ error: 'Valid Selling Price is required and must be >= 0.' });
      return;
    }

    const numMrp = Number(mrp);
    const numSellingPrice = Number(selling_price);
    const numPurchaseCost = Number(purchase_cost) || 0;
    const numFestivalDiscount = Number(festival_discount) || 0;

    if (numSellingPrice > numMrp) {
      res.status(400).json({ error: `Selling Price (₹${numSellingPrice}) cannot exceed MRP (₹${numMrp}).` });
      return;
    }

    // 2. Validate Category & Brand if provided
    const cleanCategoryId = category_id && typeof category_id === 'string' && category_id.trim() ? category_id.trim() : null;
    if (cleanCategoryId) {
      const cat = dbQueryOne<{ id: string; is_active: number }>('SELECT id, is_active FROM categories WHERE id = ?', [cleanCategoryId]);
      if (!cat) {
        res.status(400).json({ error: 'Selected category does not exist.' });
        return;
      }
      if (!cat.is_active) {
        res.status(400).json({ error: 'Selected category is inactive.' });
        return;
      }
    }

    const cleanBrandId = brand_id && typeof brand_id === 'string' && brand_id.trim() ? brand_id.trim() : null;
    if (cleanBrandId) {
      const brd = dbQueryOne<{ id: string; is_active: number }>('SELECT id, is_active FROM brands WHERE id = ?', [cleanBrandId]);
      if (!brd) {
        res.status(400).json({ error: 'Selected brand does not exist.' });
        return;
      }
      if (!brd.is_active) {
        res.status(400).json({ error: 'Selected brand is inactive.' });
        return;
      }
    }

    const cleanCode = code && typeof code === 'string' && code.trim() ? code.trim() : null;
    const cleanSku = sku && typeof sku === 'string' && sku.trim() ? sku.trim() : null;
    const cleanBarcode = barcode && typeof barcode === 'string' && barcode.trim() ? barcode.trim() : null;

    // 3. Idempotency & Retry Protection (run BEFORE uniqueness checks so retries return the existing product instead of duplicate constraint failure)
    pruneRecentSubmissions();
    const clientKey = (req.headers['x-idempotency-key'] as string) || (typeof idempotency_key === 'string' ? idempotency_key.trim() : null);
    const fingerprint = [
      name.trim().toLowerCase(),
      cleanCategoryId || '',
      cleanBrandId || '',
      cleanCode?.toLowerCase() || '',
      cleanSku?.toLowerCase() || '',
      cleanBarcode || '',
      numMrp,
      numSellingPrice
    ].join('::');

    if (clientKey && recentSubmissions.has(clientKey)) {
      const cached = recentSubmissions.get(clientKey)!;
      const existingProduct = dbQueryOne('SELECT id FROM products WHERE id = ?', [cached.productId]);
      if (existingProduct) {
        res.json({ success: true, id: cached.productId, duplicate_prevented: true, message: 'Product already saved (retry detected)' });
        return;
      }
    }

    for (const [, sub] of recentSubmissions.entries()) {
      if (sub.fingerprint === fingerprint && (Date.now() - sub.timestamp) < 20000) {
        const existingProduct = dbQueryOne('SELECT id FROM products WHERE id = ?', [sub.productId]);
        if (existingProduct) {
          res.json({ success: true, id: sub.productId, duplicate_prevented: true, message: 'Duplicate submission prevented' });
          return;
        }
      }
    }

    // 4. Unique Constraints Validation (Code, SKU, Barcode)
    if (cleanCode) {
      const existingCode = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE LOWER(code) = LOWER(?)',
        [cleanCode]
      );
      if (existingCode) {
        res.status(400).json({ error: `Item code '${cleanCode}' is already in use by product '${existingCode.name}'.` });
        return;
      }
    }

    if (cleanSku) {
      const existingProductSku = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE LOWER(sku) = LOWER(?)',
        [cleanSku]
      );
      if (existingProductSku) {
        res.status(400).json({ error: `SKU '${cleanSku}' is already in use by product '${existingProductSku.name}'.` });
        return;
      }

      const existingVariantSku = dbQueryOne<{ id: string; name: string }>(
        'SELECT v.id, p.name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE LOWER(v.sku) = LOWER(?)',
        [cleanSku]
      );
      if (existingVariantSku) {
        res.status(400).json({ error: `SKU '${cleanSku}' is already assigned to a variant of '${existingVariantSku.name}'.` });
        return;
      }
    }

    if (cleanBarcode) {
      const existingProductBarcode = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE barcode = ?',
        [cleanBarcode]
      );
      if (existingProductBarcode) {
        res.status(400).json({ error: `Barcode '${cleanBarcode}' is already assigned to product '${existingProductBarcode.name}'.` });
        return;
      }

      const existingVariantBarcode = dbQueryOne<{ id: string; name: string }>(
        'SELECT v.id, p.name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE v.barcode = ?',
        [cleanBarcode]
      );
      if (existingVariantBarcode) {
        res.status(400).json({ error: `Barcode '${cleanBarcode}' is already assigned to a variant of '${existingVariantBarcode.name}'.` });
        return;
      }
    }

    // 5. Validate Variants if provided
    if (Array.isArray(variants) && variants.length > 0) {
      const seenVariantSkus = new Set<string>();
      const seenVariantBarcodes = new Set<string>();

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const vSku = v.sku && typeof v.sku === 'string' && v.sku.trim() ? v.sku.trim() : null;
        const vBarcode = v.barcode && typeof v.barcode === 'string' && v.barcode.trim() ? v.barcode.trim() : null;

        if (vSku) {
          if (seenVariantSkus.has(vSku.toLowerCase()) || (cleanSku && cleanSku.toLowerCase() === vSku.toLowerCase())) {
            res.status(400).json({ error: `Duplicate SKU '${vSku}' found across variants in this submission.` });
            return;
          }
          seenVariantSkus.add(vSku.toLowerCase());

          const dupSkuDb = dbQueryOne('SELECT id FROM products WHERE LOWER(sku) = LOWER(?)', [vSku])
            || dbQueryOne('SELECT id FROM product_variants WHERE LOWER(sku) = LOWER(?)', [vSku]);
          if (dupSkuDb) {
            res.status(400).json({ error: `Variant SKU '${vSku}' is already in use by an existing item.` });
            return;
          }
        }

        if (vBarcode) {
          if (seenVariantBarcodes.has(vBarcode) || (cleanBarcode && cleanBarcode === vBarcode)) {
            res.status(400).json({ error: `Duplicate barcode '${vBarcode}' found across variants in this submission.` });
            return;
          }
          seenVariantBarcodes.add(vBarcode);

          const dupBarcodeDb = dbQueryOne('SELECT id FROM products WHERE barcode = ?', [vBarcode])
            || dbQueryOne('SELECT id FROM product_variants WHERE barcode = ?', [vBarcode]);
          if (dupBarcodeDb) {
            res.status(400).json({ error: `Variant barcode '${vBarcode}' is already assigned to an existing item.` });
            return;
          }
        }

        const vMrp = v.mrp !== undefined && !isNaN(Number(v.mrp)) ? Number(v.mrp) : numMrp;
        const vSellingPrice = v.selling_price !== undefined && !isNaN(Number(v.selling_price)) ? Number(v.selling_price) : numSellingPrice;
        if (vSellingPrice > vMrp) {
          res.status(400).json({ error: `Variant (Size ${v.size || '-'}, Color ${v.color || '-'}) selling price cannot exceed MRP.` });
          return;
        }
      }
    }

    const productId = 'prod_' + Date.now();
    const now = new Date().toISOString();

    // 6. Atomic Database Writes using robust dbTransaction
    dbTransaction(() => {
      dbRun(`
        INSERT INTO products (
          id, category_id, brand_id, name, code, sku, barcode, description, tags,
          mrp, selling_price, purchase_cost, festival_discount, category_attributes, image_url,
          is_active, sales_channel, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'OFFLINE', ?, ?)
      `, [
        productId,
        cleanCategoryId,
        cleanBrandId,
        name.trim(),
        cleanCode,
        cleanSku,
        cleanBarcode,
        description && typeof description === 'string' ? description.trim() : null,
        tags && typeof tags === 'string' ? tags.trim() : null,
        numMrp,
        numSellingPrice,
        numPurchaseCost,
        numFestivalDiscount,
        category_attributes ? JSON.stringify(category_attributes) : null,
        image_url && typeof image_url === 'string' ? image_url.trim() : null,
        now,
        now
      ]);

      // Add variants if provided
      if (Array.isArray(variants) && variants.length > 0) {
        for (const v of variants) {
          const varId = 'var_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
          dbRun(`
            INSERT INTO product_variants (
              id, product_id, size, color, sku, barcode, mrp, selling_price, purchase_cost, festival_discount, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          `, [
            varId,
            productId,
            v.size?.trim() || null,
            v.color?.trim() || null,
            v.sku?.trim() || null,
            v.barcode?.trim() || null,
            v.mrp !== undefined ? Number(v.mrp) : numMrp,
            v.selling_price !== undefined ? Number(v.selling_price) : numSellingPrice,
            v.purchase_cost !== undefined ? Number(v.purchase_cost) : numPurchaseCost,
            v.festival_discount !== undefined ? Number(v.festival_discount) : numFestivalDiscount,
            now
          ]);
        }
      }

      // If initial real stock is provided (e.g. physical inventory count from store)
      if (Number(initial_stock) > 0) {
        const batchId = 'batch_init_' + productId;
        dbRun(`
          INSERT INTO purchase_batches (
            id, product_id, batch_number, initial_qty, remaining_qty, unit_cost, received_date, is_active, created_at
          ) VALUES (?, ?, 'INITIAL-OPENING', ?, ?, ?, ?, 1, ?)
        `, [
          batchId,
          productId,
          Number(initial_stock),
          Number(initial_stock),
          numPurchaseCost,
          now.split('T')[0],
          now
        ]);

        const stockLedgerId = 'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, batch_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, 'PURCHASE', ?, ?, 'MANUAL_ADJUSTMENT', ?, 'Initial Store Stock Entry', ?, ?)
        `, [
          stockLedgerId,
          productId,
          batchId,
          Number(initial_stock),
          numPurchaseCost,
          productId,
          req.user?.id || 'SYSTEM',
          now
        ]);
      }
    });

    // Record submission in recent cache
    const submissionKey = clientKey || productId;
    recentSubmissions.set(submissionKey, {
      productId,
      fingerprint,
      timestamp: Date.now()
    });

    // 7. Audit log and response
    logAudit(req.user.id, 'CREATE_PRODUCT', 'PRODUCT', productId, {
      name: name.trim(),
      code: cleanCode,
      sku: cleanSku,
      barcode: cleanBarcode,
      mrp: numMrp,
      selling_price: numSellingPrice,
      initial_stock: Number(initial_stock) || 0
    });

    res.json({ success: true, id: productId });
  } catch (err: any) {
    // Log server-side diagnostics without leaking secrets or tokens
    console.error('[Product Save Error]', {
      errorMessage: err.message,
      name: req.body?.name,
      sku: req.body?.sku,
      barcode: req.body?.barcode,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });

    let clientMessage = err.message || 'Failed to save product.';
    if (clientMessage.includes('UNIQUE constraint failed: products.sku')) {
      clientMessage = `SKU '${req.body?.sku}' is already in use by another product.`;
    } else if (clientMessage.includes('UNIQUE constraint failed: products.barcode')) {
      clientMessage = `Barcode '${req.body?.barcode}' is already in use by another product.`;
    } else if (clientMessage.includes('FOREIGN KEY constraint failed')) {
      clientMessage = 'Referenced category or brand does not exist.';
    }

    res.status(400).json({ error: clientMessage });
  }
});

// Update product
router.put('/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Only store Owner can edit products' });
      return;
    }

    const { id } = req.params;
    const {
      name,
      category_id,
      brand_id,
      code,
      sku,
      barcode,
      description,
      tags,
      mrp,
      selling_price,
      purchase_cost,
      festival_discount,
      category_attributes,
      image_url,
      is_active
    } = req.body;

    const existing = dbQueryOne<any>('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const targetMrp = mrp !== undefined ? Number(mrp) : existing.mrp;
    const targetSellingPrice = selling_price !== undefined ? Number(selling_price) : existing.selling_price;

    if (targetMrp < 0 || targetSellingPrice < 0) {
      res.status(400).json({ error: 'MRP and Selling Price must be >= 0.' });
      return;
    }

    if (targetSellingPrice > targetMrp) {
      res.status(400).json({ error: `Selling Price (₹${targetSellingPrice}) cannot exceed MRP (₹${targetMrp}).` });
      return;
    }

    // Category check
    if (category_id !== undefined && category_id !== null && category_id !== '') {
      const cat = dbQueryOne('SELECT id FROM categories WHERE id = ?', [category_id]);
      if (!cat) {
        res.status(400).json({ error: 'Selected category does not exist.' });
        return;
      }
    }

    // Brand check
    if (brand_id !== undefined && brand_id !== null && brand_id !== '') {
      const brd = dbQueryOne('SELECT id FROM brands WHERE id = ?', [brand_id]);
      if (!brd) {
        res.status(400).json({ error: 'Selected brand does not exist.' });
        return;
      }
    }

    // Code check
    if (code && code.trim() && code.trim().toLowerCase() !== (existing.code || '').toLowerCase()) {
      const existingCode = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE LOWER(code) = LOWER(?) AND id != ?',
        [code.trim(), id]
      );
      if (existingCode) {
        res.status(400).json({ error: `Item Code '${code.trim()}' is already taken by '${existingCode.name}'.` });
        return;
      }
    }

    // SKU check
    if (sku && sku.trim() && sku.trim().toLowerCase() !== (existing.sku || '').toLowerCase()) {
      const existingSku = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?',
        [sku.trim(), id]
      );
      if (existingSku) {
        res.status(400).json({ error: `SKU '${sku.trim()}' is already taken by '${existingSku.name}'.` });
        return;
      }

      const existingVariantSku = dbQueryOne<{ id: string; name: string }>(
        'SELECT v.id, p.name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE LOWER(v.sku) = LOWER(?) AND v.product_id != ?',
        [sku.trim(), id]
      );
      if (existingVariantSku) {
        res.status(400).json({ error: `SKU '${sku.trim()}' is already used by a variant of '${existingVariantSku.name}'.` });
        return;
      }
    }

    // Barcode check
    if (barcode && barcode.trim() && barcode.trim() !== (existing.barcode || '')) {
      const existingBarcode = dbQueryOne<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE barcode = ? AND id != ?',
        [barcode.trim(), id]
      );
      if (existingBarcode) {
        res.status(400).json({ error: `Barcode '${barcode.trim()}' is already taken by '${existingBarcode.name}'.` });
        return;
      }

      const existingVariantBarcode = dbQueryOne<{ id: string; name: string }>(
        'SELECT v.id, p.name FROM product_variants v JOIN products p ON v.product_id = p.id WHERE v.barcode = ? AND v.product_id != ?',
        [barcode.trim(), id]
      );
      if (existingVariantBarcode) {
        res.status(400).json({ error: `Barcode '${barcode.trim()}' is already used by a variant of '${existingVariantBarcode.name}'.` });
        return;
      }
    }

    const now = new Date().toISOString();

    dbTransaction(() => {
      dbRun(`
        UPDATE products SET
          name = ?,
          category_id = ?,
          brand_id = ?,
          code = ?,
          sku = ?,
          barcode = ?,
          description = ?,
          tags = ?,
          mrp = ?,
          selling_price = ?,
          purchase_cost = ?,
          festival_discount = ?,
          category_attributes = ?,
          image_url = ?,
          is_active = ?,
          updated_at = ?
        WHERE id = ?
      `, [
        name ? name.trim() : existing.name,
        category_id !== undefined ? (category_id || null) : existing.category_id,
        brand_id !== undefined ? (brand_id || null) : existing.brand_id,
        code !== undefined ? (code?.trim() || null) : existing.code,
        sku !== undefined ? (sku?.trim() || null) : existing.sku,
        barcode !== undefined ? (barcode?.trim() || null) : existing.barcode,
        description !== undefined ? (description?.trim() || null) : existing.description,
        tags !== undefined ? (tags?.trim() || null) : existing.tags,
        targetMrp,
        targetSellingPrice,
        purchase_cost !== undefined ? Number(purchase_cost) : existing.purchase_cost,
        festival_discount !== undefined ? Number(festival_discount) : (existing.festival_discount || 0),
        category_attributes !== undefined ? JSON.stringify(category_attributes) : existing.category_attributes,
        image_url !== undefined ? (image_url?.trim() || null) : existing.image_url,
        is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
        now,
        id
      ]);
    });

    logAudit(req.user.id, 'UPDATE_PRODUCT', 'PRODUCT', id, { name, selling_price: targetSellingPrice, mrp: targetMrp });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Product Update Error]', {
      errorMessage: err.message,
      productId: req.params?.id,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    res.status(400).json({ error: err.message || 'Failed to update product' });
  }
});

export default router;
