import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { syncCustomerBalance } from './dueRoutes.ts';

const router = Router();

// In-memory idempotency cache for POS Checkout to prevent duplicate submissions on double-click / network retry
interface RecentCheckout {
  saleId: string;
  response: any;
  timestamp: number;
}
const recentCheckouts = new Map<string, RecentCheckout>();

function pruneRecentCheckouts() {
  const expiry = Date.now() - 60 * 1000;
  for (const [key, val] of recentCheckouts.entries()) {
    if (val.timestamp < expiry) {
      recentCheckouts.delete(key);
    }
  }
}

// Fast product search for POS
router.get('/search', authMiddleware, (req, res) => {
  try {
    const { query } = req.query;
    const term = (query && typeof query === 'string') ? query.trim() : '';
    const likeTerm = `%${term}%`;
    const isBlank = !term;

    // If query is provided, search by name, code, sku, barcode, ID, tags.
    // If query is empty, return active catalog products for quick POS selection.
    const products = isBlank
      ? dbQueryAll(`
          SELECT 
            p.id, p.name, p.code, p.sku, p.barcode, p.mrp, p.selling_price, p.festival_discount,
            c.name as category_name,
            b.name as brand_name,
            COALESCE(SUM(sl.quantity), 0) as current_stock
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN stock_ledger sl ON p.id = sl.product_id
          WHERE p.is_active = 1
          GROUP BY p.id
          ORDER BY p.created_at DESC
          LIMIT 30
        `)
      : dbQueryAll(`
          SELECT 
            p.id, p.name, p.code, p.sku, p.barcode, p.mrp, p.selling_price, p.festival_discount,
            c.name as category_name,
            b.name as brand_name,
            COALESCE(SUM(sl.quantity), 0) as current_stock
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN stock_ledger sl ON p.id = sl.product_id
          WHERE p.is_active = 1
            AND (p.name LIKE ? OR p.code LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.id = ? OR p.tags LIKE ?)
          GROUP BY p.id
          ORDER BY 
            CASE 
              WHEN p.barcode = ? THEN 1
              WHEN p.sku = ? THEN 2
              WHEN p.code = ? THEN 3
              ELSE 4 
            END,
            p.name ASC
          LIMIT 30
        `, [likeTerm, likeTerm, likeTerm, likeTerm, term, likeTerm, term, term, term]);

    // Also attach any variants for these products
    const productIds = products.map((p) => p.id);
    let variants: any[] = [];
    if (productIds.length > 0) {
      const placeholders = productIds.map(() => '?').join(',');
      variants = dbQueryAll(
        `SELECT id, product_id, size, color, sku, barcode, mrp, selling_price, festival_discount FROM product_variants WHERE product_id IN (${placeholders}) AND is_active = 1`,
        productIds
      );
    }

    const variantsMap: Record<string, any[]> = {};
    for (const v of variants) {
      if (!variantsMap[v.product_id]) variantsMap[v.product_id] = [];
      variantsMap[v.product_id].push(v);
    }

    const results = products.map((p) => ({
      ...p,
      variants: variantsMap[p.id] || []
    }));

    res.json({ products: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Barcode direct scan lookup (instant single match)
router.get('/scan/:code', authMiddleware, (req, res) => {
  try {
    const { code } = req.params;
    if (!code) {
      res.status(400).json({ error: 'Code is required' });
      return;
    }

    const trimmed = code.trim();

    // Check variants first for exact barcode/sku match
    const variantMatch = dbQueryOne<any>(`
      SELECT 
        v.id as variant_id, v.product_id, v.size, v.color, v.sku as variant_sku, v.barcode as variant_barcode,
        v.mrp, v.selling_price, v.festival_discount,
        p.name as product_name, p.code as product_code, p.festival_discount as product_festival_discount,
        c.name as category_name
      FROM product_variants v
      JOIN products p ON v.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (v.barcode = ? OR v.sku = ?) AND v.is_active = 1 AND p.is_active = 1
    `, [trimmed, trimmed]);

    if (variantMatch) {
      // Get current stock
      const stockRow = dbQueryOne<any>('SELECT COALESCE(SUM(quantity), 0) as stock FROM stock_ledger WHERE product_id = ?', [variantMatch.product_id]);
      res.json({
        found: true,
        type: 'VARIANT',
        item: {
          ...variantMatch,
          festival_discount: variantMatch.festival_discount ?? variantMatch.product_festival_discount ?? 0,
          current_stock: stockRow?.stock || 0
        }
      });
      return;
    }

    // Check main product barcode, sku, or code
    const prodMatch = dbQueryOne<any>(`
      SELECT 
        p.id, p.name, p.code, p.sku, p.barcode, p.mrp, p.selling_price, p.festival_discount,
        c.name as category_name,
        COALESCE(SUM(sl.quantity), 0) as current_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE (p.barcode = ? OR p.sku = ? OR p.code = ?) AND p.is_active = 1
      GROUP BY p.id
    `, [trimmed, trimmed, trimmed]);

    if (prodMatch) {
      const variants = dbQueryAll('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1', [prodMatch.id]);
      res.json({
        found: true,
        type: 'PRODUCT',
        item: {
          ...prodMatch,
          variants
        }
      });
      return;
    }

    res.json({ found: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate next sequential bill number (e.g. NBF-20260916-0001)
function getNextBillNumber(): string {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const prefix = `NBF-${today}-`;
  const latest = dbQueryOne<any>(
    'SELECT bill_number FROM sales WHERE bill_number LIKE ? ORDER BY bill_number DESC LIMIT 1',
    [`${prefix}%`]
  );

  let seq = 1;
  if (latest && latest.bill_number) {
    const parts = latest.bill_number.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// Generate next sequential return number (e.g. RET-20260916-0001)
function getNextReturnNumber(): string {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const prefix = `RET-${today}-`;
  const latest = dbQueryOne<any>(
    'SELECT return_number FROM sale_returns WHERE return_number LIKE ? ORDER BY return_number DESC LIMIT 1',
    [`${prefix}%`]
  );

  let seq = 1;
  if (latest && latest.return_number) {
    const parts = latest.return_number.split('-');
    if (parts.length === 3) {
      seq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${prefix}${seq.toString().padStart(4, '0')}`;
}

// Complete Sale Transactionally
router.post('/checkout', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      items,
      customer, // optional { id, name, phone, address }
      customer_id,
      customer_name,
      customer_phone,
      customer_address,
      special_discount: billSpecialDiscountInput = 0,
      discount_amount = 0,
      discount_type = 'AMOUNT', // 'AMOUNT' or 'PERCENT'
      payment_method, // 'CASH' | 'UPI' | 'SPLIT' | 'CREDIT'
      cash_paid = 0,
      upi_paid = 0,
      notes,
      idempotency_key,
    } = req.body;

    // 0. Idempotency check to prevent duplicate bills & duplicate stock deductions on network retries
    pruneRecentCheckouts();
    const clientKey = (req.headers['x-idempotency-key'] as string) || (typeof idempotency_key === 'string' ? idempotency_key.trim() : null);
    if (clientKey && recentCheckouts.has(clientKey)) {
      const cached = recentCheckouts.get(clientKey)!;
      res.json(cached.response);
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Cannot checkout an empty bill. Please add items.' });
      return;
    }

    // Backend authoritative price calculation to prevent manipulation
    let calculatedSellingSubtotal = 0;
    let totalMrp = 0;
    let totalFestivalDiscount = 0;
    let totalItemSpecialDiscount = 0;
    const validatedItems: any[] = [];

    for (const it of items) {
      const product = dbQueryOne<any>('SELECT * FROM products WHERE id = ? AND is_active = 1', [it.product_id]);
      if (!product) {
        res.status(400).json({ error: `Product not found or inactive: ${it.product_name || it.product_id}` });
        return;
      }

      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      let unitPrice = Number(product.selling_price) || 0;
      let mrp = Number(product.mrp) || unitPrice;
      let festDiscountPerUnit = Number(product.festival_discount) || 0;
      let variantDesc = null;

      if (it.variant_id) {
        const variant = dbQueryOne<any>('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', [
          it.variant_id,
          it.product_id
        ]);
        if (variant) {
          unitPrice = Number(variant.selling_price) || unitPrice;
          mrp = Number(variant.mrp) || mrp;
          festDiscountPerUnit = Number(variant.festival_discount ?? product.festival_discount) || 0;
          variantDesc = [variant.size, variant.color].filter(Boolean).join(' / ');
        }
      }

      // Festival discount per unit (fixed ₹)
      festDiscountPerUnit = Math.max(0, festDiscountPerUnit);

      // Manual Special discount per unit (fixed ₹ entered by Owner, if any)
      const itemSpecialDiscountPerUnit = Math.max(0, Number(it.special_discount) || 0);

      // Price Validation: discount cannot exceed normal selling price
      if (festDiscountPerUnit + itemSpecialDiscountPerUnit > unitPrice) {
        res.status(400).json({
          error: `Discount on '${product.name}' (Festival: ₹${festDiscountPerUnit} + Special: ₹${itemSpecialDiscountPerUnit}) cannot exceed Selling Price (₹${unitPrice}).`
        });
        return;
      }

      // Check stock availability
      const currentStockRow = dbQueryOne<any>(
        'SELECT COALESCE(SUM(quantity), 0) as stock FROM stock_ledger WHERE product_id = ?',
        [it.product_id]
      );
      const availableStock = currentStockRow?.stock || 0;
      if (availableStock < qty) {
        res.status(400).json({
          error: `Insufficient stock for '${product.name}'. Available: ${availableStock}, Requested: ${qty}`
        });
        return;
      }

      const lineMrp = mrp * qty;
      const lineSellingPrice = unitPrice * qty;
      const lineFestivalDiscount = festDiscountPerUnit * qty;
      const lineSpecialDiscount = itemSpecialDiscountPerUnit * qty;
      const lineTotal = Math.max(0, lineSellingPrice - lineFestivalDiscount - lineSpecialDiscount);

      totalMrp += lineMrp;
      calculatedSellingSubtotal += lineSellingPrice;
      totalFestivalDiscount += lineFestivalDiscount;
      totalItemSpecialDiscount += lineSpecialDiscount;

      validatedItems.push({
        product,
        variant_id: it.variant_id || null,
        product_name: product.name,
        variant_desc: variantDesc,
        quantity: qty,
        mrp,
        unit_price: unitPrice,
        festival_discount: lineFestivalDiscount,
        special_discount: lineSpecialDiscount,
        discount: lineFestivalDiscount + lineSpecialDiscount,
        total_price: lineTotal
      });
    }

    // Bill-level manual special discount or legacy discount amount
    const rawBillSpecialDiscount = Math.max(0, Number(billSpecialDiscountInput) || 0);
    // If the client sent the combined special discount (>= item special discount sum), extract only the bill-level portion to avoid double counting
    const billSpecialDiscount = rawBillSpecialDiscount >= totalItemSpecialDiscount 
      ? rawBillSpecialDiscount - totalItemSpecialDiscount 
      : rawBillSpecialDiscount;
    const totalSpecialDiscount = totalItemSpecialDiscount + billSpecialDiscount;

    let totalDiscount = totalFestivalDiscount + totalSpecialDiscount;
    if (discount_amount && Number(discount_amount) > 0 && totalDiscount === 0) {
      if (discount_type === 'PERCENT') {
        const pct = Math.min(100, Math.max(0, Number(discount_amount) || 0));
        totalDiscount = (calculatedSellingSubtotal * pct) / 100;
      } else {
        totalDiscount = Math.min(calculatedSellingSubtotal, Math.max(0, Number(discount_amount) || 0));
      }
    }

    // Price validation: discounts cannot exceed selling subtotal
    if (totalDiscount > calculatedSellingSubtotal) {
      res.status(400).json({
        error: `Total discounts (₹${totalDiscount}) cannot exceed normal Selling Price subtotal (₹${calculatedSellingSubtotal}).`
      });
      return;
    }

    const calculatedTotal = Math.max(0, Math.round(calculatedSellingSubtotal - totalDiscount));
    const totalSavings = Math.max(0, totalMrp - calculatedTotal);

    // Resolve customer flexibly from either object or flat properties
    const effectiveCustomer = customer || (customer_name ? {
      id: customer_id || null,
      name: customer_name,
      phone: customer_phone || null,
      address: customer_address || null,
    } : null);

    // Validate payment breakdown
    const cashNum = Math.max(0, Number(cash_paid) || 0);
    const upiNum = Math.max(0, Number(upi_paid) || 0);
    let totalPaid = 0;
    let balanceDue = 0;

    if (payment_method === 'CASH') {
      totalPaid = calculatedTotal;
      balanceDue = 0;
    } else if (payment_method === 'UPI') {
      totalPaid = calculatedTotal;
      balanceDue = 0;
    } else if (payment_method === 'SPLIT') {
      totalPaid = Math.min(calculatedTotal, cashNum + upiNum);
      balanceDue = Math.max(0, calculatedTotal - totalPaid);
      if (balanceDue > 0 && (!effectiveCustomer || !effectiveCustomer.name || !effectiveCustomer.name.trim() || effectiveCustomer.name.trim() === 'Walk-in Customer')) {
        res.status(400).json({
          error: 'Customer name or profile is required for Split payment with remaining outstanding balance due.'
        });
        return;
      }
    } else if (payment_method === 'CREDIT') {
      totalPaid = Math.min(calculatedTotal, cashNum + upiNum); // partial advance paid in cash/upi, if any
      balanceDue = Math.max(0, calculatedTotal - totalPaid);
      if (!effectiveCustomer || !effectiveCustomer.name || !effectiveCustomer.name.trim() || effectiveCustomer.name.trim() === 'Walk-in Customer') {
        res.status(400).json({
          error: 'Customer name or profile is required to issue goods on credit/due.'
        });
        return;
      }
    } else {
      res.status(400).json({ error: 'Invalid payment method' });
      return;
    }

    const paymentStatus = balanceDue === 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';

    const saleId = 'sale_' + Date.now();
    const billNumber = getNextBillNumber();
    const now = new Date().toISOString();

    let customerId: string | null = null;
    let customerNameStr: string = 'Walk-in Customer';
    let customerPhoneStr: string | null = null;

    dbTransaction(() => {
      // Handle customer record if named customer is provided
      if (effectiveCustomer && effectiveCustomer.name && effectiveCustomer.name.trim() && effectiveCustomer.name.trim() !== 'Walk-in Customer') {
        const cleanName = effectiveCustomer.name.trim();
        const cleanPhone = effectiveCustomer.phone?.trim() || null;
        customerNameStr = cleanName;
        customerPhoneStr = cleanPhone;

        if (effectiveCustomer.id) {
          customerId = effectiveCustomer.id;
          dbRun('UPDATE customers SET total_purchases = total_purchases + ?, total_dues = total_dues + ? WHERE id = ?', [
            calculatedTotal,
            balanceDue,
            customerId
          ]);
        } else {
          // Look up existing customer by phone or by name to prevent duplicate customer rows
          const existingCust = cleanPhone
            ? dbQueryOne<any>('SELECT id FROM customers WHERE phone = ?', [cleanPhone])
            : dbQueryOne<any>('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)', [cleanName]);

          if (existingCust) {
            customerId = existingCust.id;
            dbRun('UPDATE customers SET total_purchases = total_purchases + ?, total_dues = total_dues + ? WHERE id = ?', [
              calculatedTotal,
              balanceDue,
              customerId
            ]);
          } else {
            customerId = 'cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            dbRun(
              'INSERT INTO customers (id, name, phone, address, notes, total_purchases, total_dues, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [
                customerId,
                cleanName,
                cleanPhone,
                effectiveCustomer.address?.trim() || null,
                effectiveCustomer.notes?.trim() || null,
                calculatedTotal,
                balanceDue,
                now
              ]
            );
          }
        }
      } else if (effectiveCustomer && effectiveCustomer.name) {
        customerNameStr = effectiveCustomer.name.trim();
        customerPhoneStr = effectiveCustomer.phone?.trim() || null;
      }

      const actualCashCollected = payment_method === 'CASH' ? calculatedTotal : (payment_method === 'SPLIT' || payment_method === 'CREDIT') ? Math.min(calculatedTotal, cashNum) : 0;
      const actualUpiCollected = payment_method === 'UPI' ? calculatedTotal : (payment_method === 'SPLIT' || payment_method === 'CREDIT') ? Math.min(Math.max(0, calculatedTotal - actualCashCollected), upiNum) : 0;

      // 1. Insert sale record
      dbRun(`
        INSERT INTO sales (
          id, bill_number, customer_id, customer_name, customer_phone, total_mrp, subtotal,
          festival_discount, special_discount, discount_amount, discount_type, total_amount,
          amount_paid, balance_due, payment_status, payment_method, cash_paid, upi_paid,
          channel, notes, cashier_id, day_closed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', ?, ?, 0, ?)
      `, [
        saleId,
        billNumber,
        customerId,
        customerNameStr,
        customerPhoneStr,
        totalMrp,
        calculatedSellingSubtotal,
        totalFestivalDiscount,
        totalSpecialDiscount,
        totalDiscount,
        discount_type,
        calculatedTotal,
        totalPaid,
        balanceDue,
        paymentStatus,
        payment_method,
        actualCashCollected,
        actualUpiCollected,
        notes?.trim() || null,
        req.user?.id || 'CASHIER',
        now
      ]);

      // 2. Insert sale items & deduct inventory using FIFO batches
      for (const item of validatedItems) {
        const saleItemId = 'si_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        let neededQty = item.quantity;
        let itemCogs = 0;

        // FIFO batch lookup
        const activeBatches = dbQueryAll<any>(`
          SELECT * FROM purchase_batches 
          WHERE product_id = ? AND remaining_qty > 0 
          ORDER BY received_date ASC, created_at ASC
        `, [item.product.id]);

        for (const batch of activeBatches) {
          if (neededQty <= 0) break;
          const take = Math.min(batch.remaining_qty, neededQty);
          const newRemaining = batch.remaining_qty - take;
          dbRun('UPDATE purchase_batches SET remaining_qty = ?, is_active = ? WHERE id = ?', [
            newRemaining,
            newRemaining > 0 ? 1 : 0,
            batch.id
          ]);
          itemCogs += take * batch.unit_cost;
          neededQty -= take;
        }

        // If no purchase batches existed (e.g. initial stock without batch), use product.purchase_cost
        if (neededQty > 0) {
          itemCogs += neededQty * (item.product.purchase_cost || 0);
        }

        dbRun(`
          INSERT INTO sale_items (
            id, sale_id, product_id, variant_id, product_name, variant_desc,
            quantity, mrp, unit_price, festival_discount, special_discount, discount, total_price, cogs, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          saleItemId,
          saleId,
          item.product.id,
          item.variant_id,
          item.product_name,
          item.variant_desc,
          item.quantity,
          item.mrp,
          item.unit_price,
          item.festival_discount,
          item.special_discount,
          item.discount,
          item.total_price,
          itemCogs,
          now
        ]);

        // Stock Ledger entry (immutable negative movement)
        dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, variant_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, 'SALE', ?, ?, 'SALE', ?, ?, ?, ?)
        `, [
          'stk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          item.product.id,
          item.variant_id,
          -item.quantity,
          itemCogs / item.quantity,
          saleId,
          `Sale Bill #${billNumber}`,
          req.user?.id || 'CASHIER',
          now
        ]);
      }

      // 3. If credit balance due > 0, record in customer_dues
      if (balanceDue > 0 && customerId) {
        const dueId = 'due_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        dbRun(`
          INSERT INTO customer_dues (
            id, customer_id, sale_id, original_due, amount_paid, balance_due, status, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, ?, 'PENDING', ?, ?, ?)
        `, [
          dueId,
          customerId,
          saleId,
          balanceDue,
          balanceDue,
          `Credit from bill #${billNumber}${totalPaid > 0 ? ` (Advance paid: ₹${totalPaid})` : ''}`,
          now,
          now
        ]);
      }
      if (customerId) {
        syncCustomerBalance(customerId);
      }

      // 4. Financial Transactions for collected cash / upi (Unpaid credit is strictly NOT recorded as collected cash)
      if (actualCashCollected > 0) {
        const txId = 'ftx_cash_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', 'CASH', 'INCOME', ?, 'SALES', ?, 'CASH', ?, 1, ?, ?, ?)
        `, [
          txId,
          now.split('T')[0],
          actualCashCollected,
          customer?.name || 'Walk-in Customer',
          `Sale Bill #${billNumber}`,
          billNumber,
          req.user?.id || 'CASHIER',
          now,
          now
        ]);
      }

      if (actualUpiCollected > 0) {
        const txId = 'ftx_upi_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', 'UPI', 'INCOME', ?, 'SALES', ?, 'UPI', ?, 1, ?, ?, ?)
        `, [
          txId,
          now.split('T')[0],
          actualUpiCollected,
          customer?.name || 'Walk-in Customer',
          `Sale Bill #${billNumber}`,
          billNumber,
          req.user?.id || 'CASHIER',
          now,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'CASHIER', 'POS_SALE', 'SALE', saleId, {
      bill_number: billNumber,
      total: calculatedTotal,
      paid: totalPaid,
      payment_method
    });

    // Internal audit for Special Discount (tamper-evident record, strictly internal)
    if (totalSpecialDiscount > 0) {
      logAudit(req.user?.id || 'OWNER', 'SPECIAL_DISCOUNT_APPLIED', 'SALE', saleId, {
        bill_number: billNumber,
        bill_id: saleId,
        original_selling_price: calculatedSellingSubtotal,
        festival_discount: totalFestivalDiscount,
        special_discount: totalSpecialDiscount,
        final_price: calculatedTotal,
        applied_by: req.user?.username || req.user?.full_name || 'OWNER',
        timestamp: now
      });
    }

    saveDb(true);

    const checkoutResponse = {
      success: true,
      sale: {
        id: saleId,
        bill_number: billNumber,
        customer_id: customerId,
        customer_name: customerNameStr,
        customer_phone: customerPhoneStr,
        total_mrp: totalMrp,
        subtotal: calculatedSellingSubtotal,
        festival_discount: totalFestivalDiscount,
        special_discount: totalSpecialDiscount,
        discount_amount: totalDiscount,
        total_amount: calculatedTotal,
        total_savings: totalSavings,
        amount_paid: totalPaid,
        balance_due: balanceDue,
        payment_method,
        payment_status: paymentStatus,
        items: validatedItems,
        cashier_name: req.user?.full_name || 'Cashier',
        created_at: now
      }
    };

    if (clientKey) {
      recentCheckouts.set(clientKey, {
        saleId,
        response: checkoutResponse,
        timestamp: Date.now()
      });
    }

    res.json(checkoutResponse);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check for existing bill number on given date to prevent duplicates
router.get('/check-bill-number', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const billNumber = ((req.query.billNumber as string) || '').trim();
    const date = ((req.query.date as string) || '').trim();
    if (!billNumber) {
      res.json({ exists: false });
      return;
    }
    let query = 'SELECT id, bill_number, created_at, total_amount, channel FROM sales WHERE bill_number = ?';
    const params: any[] = [billNumber];
    if (date) {
      query += ' AND DATE(created_at) = ?';
      params.push(date);
    }
    const match = dbQueryOne<any>(query, params);
    res.json({
      exists: !!match,
      bill: match || null,
      message: match
        ? `Warning: Bill #${billNumber} already exists in records for ${date || 'in system'}.`
        : 'Bill number is available.'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual Bill Entry for handwritten customer bills (without POS stock deduction)
router.post('/manual-bill', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      bill_number,
      bill_date,
      items,
      payment_method, // 'CASH' | 'UPI' | 'SPLIT' | 'CREDIT'
      cash_amount = 0,
      upi_amount = 0,
      customer_name,
      customer_phone,
      notes
    } = req.body;

    // 1. Validate Bill Number
    if (!bill_number || typeof bill_number !== 'string' || !bill_number.trim()) {
      res.status(400).json({ error: 'Handwritten bill number is required.' });
      return;
    }
    const cleanBillNumber = bill_number.trim();

    // 2. Validate Bill Date
    const todayStr = new Date().toISOString().split('T')[0];
    const targetDate =
      bill_date && typeof bill_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bill_date.trim())
        ? bill_date.trim()
        : todayStr;

    // Check duplicate bill number for the same date
    const existingBill = dbQueryOne<any>(
      'SELECT id, bill_number FROM sales WHERE bill_number = ? AND DATE(created_at) = ?',
      [cleanBillNumber, targetDate]
    );
    if (existingBill) {
      res.status(409).json({
        error: `Duplicate bill number: Bill #${cleanBillNumber} has already been recorded for ${targetDate}. Please verify the handwritten bill number.`
      });
      return;
    }

    // 3. Validate Items
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Please add at least one item row to the handwritten bill.' });
      return;
    }

    const validatedItems: Array<{
      item_name: string;
      quantity: number;
      rate: number;
      item_total: number;
    }> = [];

    let calculatedTotal = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.item_name || it.name || '').trim();
      if (!name) {
        res.status(400).json({ error: `Item #${i + 1} must have an item name.` });
        return;
      }
      const qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty < 1) {
        res.status(400).json({ error: `Item "${name}" has invalid quantity. Must be at least 1.` });
        return;
      }
      const rate = Number(it.rate !== undefined ? it.rate : it.unit_price);
      if (isNaN(rate) || rate < 0) {
        res.status(400).json({ error: `Item "${name}" has invalid rate. Rate cannot be negative.` });
        return;
      }
      const itemTotal = Math.round(qty * rate);
      calculatedTotal += itemTotal;
      validatedItems.push({
        item_name: name,
        quantity: qty,
        rate,
        item_total: itemTotal,
      });
    }

    if (calculatedTotal <= 0) {
      res.status(400).json({ error: 'Total bill amount must be greater than ₹0.' });
      return;
    }

    // 4. Validate Payment Method
    const validMethods = ['CASH', 'UPI', 'CARD', 'SPLIT', 'CREDIT'];
    if (!validMethods.includes(payment_method)) {
      res.status(400).json({ error: `Invalid payment method. Must be one of: ${validMethods.join(', ')}` });
      return;
    }

    let cashPaid = 0;
    let upiPaid = 0;
    let cardPaid = 0;
    let balanceDue = 0;

    if (payment_method === 'CASH') {
      cashPaid = calculatedTotal;
      upiPaid = 0;
      cardPaid = 0;
      balanceDue = 0;
    } else if (payment_method === 'UPI') {
      cashPaid = 0;
      upiPaid = calculatedTotal;
      cardPaid = 0;
      balanceDue = 0;
    } else if (payment_method === 'CARD') {
      cashPaid = 0;
      upiPaid = 0;
      cardPaid = calculatedTotal;
      balanceDue = 0;
    } else if (payment_method === 'SPLIT') {
      const cashNum = Math.max(0, Number(cash_amount) || 0);
      const upiNum = Math.max(0, Number(upi_amount) || 0);
      const splitSum = cashNum + upiNum;
      if (Math.abs(splitSum - calculatedTotal) > 0.01) {
        res.status(400).json({
          error: `Split amounts (Cash ₹${cashNum} + UPI ₹${upiNum} = ₹${splitSum}) must equal the total bill amount ₹${calculatedTotal}.`
        });
        return;
      }
      cashPaid = cashNum;
      upiPaid = upiNum;
      cardPaid = 0;
      balanceDue = 0;
    } else if (payment_method === 'CREDIT') {
      cashPaid = 0;
      upiPaid = 0;
      cardPaid = 0;
      balanceDue = calculatedTotal;
      if (!customer_name || !customer_name.trim()) {
        res.status(400).json({
          error: 'Customer Name is required when recording a handwritten bill on Credit/Due.'
        });
        return;
      }
    }

    const paymentStatus = balanceDue === 0 ? 'PAID' : 'UNPAID';
    const saleId = 'sale_manual_' + Date.now();
    const timePortion = new Date().toTimeString().split(' ')[0] || '12:00:00';
    const createdAt = `${targetDate}T${timePortion}.000Z`;

    // Ensure fallback system product exists so foreign key references in sale_items succeed
    dbRun(`
      INSERT OR IGNORE INTO products (
        id, name, code, sku, barcode, category_id, mrp, selling_price, is_active, created_at, updated_at
      ) VALUES (
        'prod_manual_billing', 'Handwritten Bill Item', 'MANUAL-HW', 'SKU-MANUAL-HW', '000000000000', NULL, 0, 0, 0, ?, ?
      )
    `, [createdAt, createdAt]);

    let customerId: string | null = null;

    dbTransaction(() => {
      // If customer info is provided or credit
      if (customer_name && customer_name.trim()) {
        const cleanName = customer_name.trim();
        const cleanPhone = (customer_phone || '').trim();
        const existingCust = cleanPhone
          ? dbQueryOne<any>('SELECT id FROM customers WHERE phone = ?', [cleanPhone])
          : dbQueryOne<any>('SELECT id FROM customers WHERE name = ?', [cleanName]);

        if (existingCust) {
          customerId = existingCust.id;
          dbRun(
            'UPDATE customers SET total_purchases = total_purchases + ?, total_dues = total_dues + ? WHERE id = ?',
            [calculatedTotal, balanceDue, customerId]
          );
        } else {
          customerId = 'cust_' + Date.now();
          dbRun(
            'INSERT INTO customers (id, name, phone, address, notes, total_purchases, total_dues, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [customerId, cleanName, cleanPhone || null, null, 'Added via manual bill entry', calculatedTotal, balanceDue, createdAt]
          );
        }
      }

      // Record in sales table with channel = 'MANUAL'
      dbRun(`
        INSERT INTO sales (
          id, bill_number, customer_id, customer_name, customer_phone,
          total_mrp, subtotal, festival_discount, special_discount, discount_amount,
          discount_type, total_amount, amount_paid, balance_due, payment_status,
          payment_method, cash_paid, upi_paid, card_paid, channel, notes, cashier_id,
          day_closed, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        saleId,
        cleanBillNumber,
        customerId,
        customer_name ? customer_name.trim() : null,
        customer_phone ? customer_phone.trim() : null,
        calculatedTotal,
        calculatedTotal,
        0,
        0,
        0,
        'AMOUNT',
        calculatedTotal,
        calculatedTotal - balanceDue,
        balanceDue,
        paymentStatus,
        payment_method,
        cashPaid,
        upiPaid,
        cardPaid,
        'MANUAL',
        notes ? `Handwritten Bill: ${notes.trim()}` : 'Handwritten Bill Entry',
        req.user?.id || 'usr_cashier',
        0,
        'COMPLETED',
        createdAt
      ]);

      // Record items in sale_items (CRITICAL: NO stock_ledger insertion = zero inventory deduction!)
      validatedItems.forEach((it, idx) => {
        const itemId = `si_manual_${Date.now()}_${idx}`;
        dbRun(`
          INSERT INTO sale_items (
            id, sale_id, product_id, product_name, quantity, mrp,
            unit_price, festival_discount, special_discount, discount,
            total_price, cogs, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          itemId,
          saleId,
          'prod_manual_billing',
          it.item_name,
          it.quantity,
          it.rate,
          it.rate,
          0,
          0,
          0,
          it.item_total,
          0,
          createdAt
        ]);
      });

      // Record customer due if credit
      if (balanceDue > 0 && customerId) {
        const dueId = 'due_' + Date.now();
        dbRun(`
          INSERT INTO customer_dues (
            id, customer_id, sale_id, original_due, amount_paid, balance_due, due_date, status, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          dueId,
          customerId,
          saleId,
          balanceDue,
          0,
          balanceDue,
          new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          'PENDING',
          `Outstanding balance on handwritten bill #${cleanBillNumber}`,
          createdAt,
          createdAt
        ]);
      }

      // Record financial transactions for collected cash / upi
      if (cashPaid > 0) {
        const txId = 'ftx_manual_cash_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', 'CASH', 'INCOME', ?, 'SALES', ?, 'CASH', ?, 1, ?, ?, ?)
        `, [
          txId,
          targetDate,
          cashPaid,
          customer_name ? customer_name.trim() : 'Walk-in Customer',
          `Manual Bill #${cleanBillNumber}`,
          cleanBillNumber,
          req.user?.id || 'CASHIER',
          createdAt,
          createdAt
        ]);
      }

      if (upiPaid > 0) {
        const txId = 'ftx_manual_upi_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', 'UPI', 'INCOME', ?, 'SALES', ?, 'UPI', ?, 1, ?, ?, ?)
        `, [
          txId,
          targetDate,
          upiPaid,
          customer_name ? customer_name.trim() : 'Walk-in Customer',
          `Manual Bill #${cleanBillNumber}`,
          cleanBillNumber,
          req.user?.id || 'CASHIER',
          createdAt,
          createdAt
        ]);
      }

      if (cardPaid > 0) {
        const txId = 'ftx_manual_card_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', 'BANK', 'INCOME', ?, 'SALES', ?, 'CARD', ?, 1, ?, ?, ?)
        `, [
          txId,
          targetDate,
          cardPaid,
          customer_name ? customer_name.trim() : 'Walk-in Customer',
          `Manual Bill #${cleanBillNumber}`,
          cleanBillNumber,
          req.user?.id || 'CASHIER',
          createdAt,
          createdAt
        ]);
      }

      // Record audit log
      logAudit(
        req.user?.id || 'usr_unknown',
        'CREATE_MANUAL_BILL',
        'sales',
        saleId,
        {
          message: `Created handwritten manual bill #${cleanBillNumber} for ₹${calculatedTotal} (${payment_method}) dated ${targetDate}`,
          bill_number: cleanBillNumber,
          bill_date: targetDate,
          total_amount: calculatedTotal,
          items_count: validatedItems.length,
          payment_method,
          channel: 'MANUAL',
          inventory_deducted: false
        }
      );
    });

    saveDb();

    res.json({
      success: true,
      message: `Manual bill #${cleanBillNumber} saved successfully for ${targetDate}.`,
      sale: {
        id: saleId,
        bill_number: cleanBillNumber,
        bill_date: targetDate,
        total_amount: calculatedTotal,
        payment_method,
        cash_paid: cashPaid,
        upi_paid: upiPaid,
        card_paid: cardPaid,
        balance_due: balanceDue,
        items: validatedItems,
        channel: 'MANUAL',
        created_at: createdAt
      }
    });
  } catch (err: any) {
    console.error('Error saving manual bill:', err);
    res.status(500).json({ error: err.message || 'Failed to save manual bill' });
  }
});

// Recent sales list for POS view
router.get('/recent', authMiddleware, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sales = dbQueryAll(`
      SELECT 
        s.id, s.bill_number, s.customer_name, s.customer_phone,
        s.total_mrp, s.subtotal, s.festival_discount, s.special_discount,
        s.discount_amount, s.total_amount, s.amount_paid, s.balance_due,
        s.payment_status, s.payment_method, s.created_at,
        u.full_name as cashier_name
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE DATE(s.created_at) = ?
      ORDER BY s.created_at DESC
      LIMIT 20
    `, [today]);

    res.json({ sales });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bill History / Sales History listing with filters
router.get('/bills', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, date, start_date, end_date, status, channel, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT 
        s.id, s.bill_number, s.customer_id, s.customer_name, s.customer_phone,
        s.total_mrp, s.subtotal, s.festival_discount, s.special_discount,
        s.discount_amount, s.total_amount, s.amount_paid, s.balance_due,
        s.payment_status, s.payment_method, s.cash_paid, s.upi_paid,
        s.channel, s.notes, s.cashier_id, s.day_closed, s.created_at,
        COALESCE(s.status, 'COMPLETED') as status,
        s.cancelled_at, s.cancelled_by, s.cancelled_by_name, s.cancelled_reason,
        u.full_name as cashier_name,
        COUNT(DISTINCT si.id) as product_count,
        COALESCE(SUM(si.quantity), 0) as total_items,
        GROUP_CONCAT(si.product_name || ' (' || si.quantity || ')', ', ') as items_summary,
        COALESCE(r.total_refunded, 0) as total_refunded_amount,
        COALESCE(r.return_count, 0) as return_count
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      LEFT JOIN (
        SELECT sale_id, COUNT(*) as return_count, SUM(refund_amount) as total_refunded
        FROM sale_returns
        GROUP BY sale_id
      ) r ON s.id = r.sale_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search && typeof search === 'string' && search.trim()) {
      const term = `%${search.trim()}%`;
      sql += ` AND (s.bill_number LIKE ? OR s.customer_name LIKE ? OR s.customer_phone LIKE ?)`;
      params.push(term, term, term);
    }

    if (date && typeof date === 'string' && date.trim()) {
      sql += ` AND DATE(s.created_at) = ?`;
      params.push(date.trim());
    } else {
      if (start_date && typeof start_date === 'string' && start_date.trim()) {
        sql += ` AND DATE(s.created_at) >= ?`;
        params.push(start_date.trim());
      }
      if (end_date && typeof end_date === 'string' && end_date.trim()) {
        sql += ` AND DATE(s.created_at) <= ?`;
        params.push(end_date.trim());
      }
    }

    if (channel && typeof channel === 'string' && channel.trim() !== 'ALL') {
      sql += ` AND s.channel = ?`;
      params.push(channel.trim());
    }

    if (status && status !== 'ALL') {
      if (status === 'CANCELLED') {
        sql += ` AND s.status = 'CANCELLED'`;
      } else if (status === 'COMPLETED') {
        sql += ` AND (s.status IS NULL OR s.status = 'COMPLETED')`;
      }
    }

    sql += ` GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit) || 50, Number(offset) || 0);

    const bills = dbQueryAll(sql, params);
    res.json({ bills });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single Bill Detail (with items, return history, and dues)
router.get('/bills/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sale = dbQueryOne<any>(`
      SELECT 
        s.*,
        COALESCE(s.status, 'COMPLETED') as status,
        u.full_name as cashier_name
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      WHERE s.id = ? OR s.bill_number = ?
    `, [id, id]);

    if (!sale) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    const items = dbQueryAll<any>(`
      SELECT 
        si.*,
        p.code as product_code,
        p.sku as product_sku,
        p.barcode as product_barcode,
        COALESCE(ret.returned_qty, 0) as returned_qty,
        COALESCE(ret.returned_qty, 0) as returned_quantity
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN (
        SELECT sale_item_id, SUM(quantity) as returned_qty
        FROM sale_return_items
        GROUP BY sale_item_id
      ) ret ON si.id = ret.sale_item_id
      WHERE si.sale_id = ?
    `, [sale.id]);

    const returns = dbQueryAll<any>(`
      SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY created_at DESC
    `, [sale.id]);

    for (const r of returns) {
      r.items = dbQueryAll<any>('SELECT * FROM sale_return_items WHERE return_id = ?', [r.id]);
    }

    const returnSummary = dbQueryOne<any>(`
      SELECT COUNT(*) as return_count, COALESCE(SUM(refund_amount), 0) as total_refunded_amount
      FROM sale_returns
      WHERE sale_id = ?
    `, [sale.id]);
    sale.total_refunded_amount = returnSummary?.total_refunded_amount || 0;
    sale.return_count = returnSummary?.return_count || 0;

    const customerDue = dbQueryOne<any>('SELECT * FROM customer_dues WHERE sale_id = ?', [sale.id]);

    res.json({
      sale,
      items,
      returns,
      customerDue
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel / Void a completed bill (OWNER-only)
router.post('/bills/:id/cancel', authMiddleware, requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'A valid cancellation reason is required.' });
      return;
    }

    const sale = dbQueryOne<any>('SELECT * FROM sales WHERE id = ? OR bill_number = ?', [id, id]);
    if (!sale) {
      res.status(404).json({ error: 'Bill not found.' });
      return;
    }

    if (sale.status === 'CANCELLED') {
      res.status(400).json({ error: `Bill #${sale.bill_number} has already been cancelled.` });
      return;
    }

    // Check if partial returns already happened on this bill
    const existingReturns = dbQueryAll<any>('SELECT id FROM sale_returns WHERE sale_id = ?', [sale.id]);
    if (existingReturns.length > 0) {
      res.status(400).json({
        error: 'This bill has existing item returns. To adjust remaining items, please use Return Item(s) rather than voiding the entire bill.'
      });
      return;
    }

    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];
    const saleDate = sale.created_at.split('T')[0];

    // Check if business day of the sale is already closed
    const closingRecord = dbQueryOne<any>('SELECT status FROM daily_closings WHERE closing_date = ?', [saleDate]);
    const isDayClosed = sale.day_closed === 1 || (closingRecord && closingRecord.status === 'CLOSED') || saleDate < todayStr;
    const reversalTxDate = isDayClosed ? todayStr : saleDate;

    const fullReason = reason.trim() + (notes && notes.trim() ? ` - ${notes.trim()}` : '');
    const cancelledByName = req.user?.full_name || req.user?.username || 'Owner';

    dbTransaction(() => {
      // 1. Mark bill as CANCELLED (Never delete!)
      dbRun(`
        UPDATE sales SET
          status = 'CANCELLED',
          cancelled_at = ?,
          cancelled_by = ?,
          cancelled_by_name = ?,
          cancelled_reason = ?
        WHERE id = ?
      `, [now, req.user?.id || 'OWNER', cancelledByName, fullReason, sale.id]);

      // 2. Restore inventory & FIFO batches for every item (Only for POS sales; manual bills never deducted stock)
      if (sale.channel !== 'MANUAL') {
        const saleItems = dbQueryAll<any>('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
        for (const item of saleItems) {
          let qtyToRestore = item.quantity;

          // Restore to FIFO purchase_batches where remaining_qty < initial_qty
          const batches = dbQueryAll<any>(`
            SELECT * FROM purchase_batches 
            WHERE product_id = ? AND remaining_qty < initial_qty 
            ORDER BY received_date DESC, created_at DESC
          `, [item.product_id]);

          for (const batch of batches) {
            if (qtyToRestore <= 0) break;
            const space = batch.initial_qty - batch.remaining_qty;
            const restore = Math.min(space, qtyToRestore);
            dbRun('UPDATE purchase_batches SET remaining_qty = remaining_qty + ?, is_active = 1 WHERE id = ?', [
              restore,
              batch.id
            ]);
            qtyToRestore -= restore;
          }

          // If any excess remaining or no batch with space, restore to latest batch if available
          if (qtyToRestore > 0) {
            const latestBatch = dbQueryOne<any>(
              'SELECT id FROM purchase_batches WHERE product_id = ? ORDER BY received_date DESC, created_at DESC LIMIT 1',
              [item.product_id]
            );
            if (latestBatch) {
              dbRun('UPDATE purchase_batches SET remaining_qty = remaining_qty + ?, is_active = 1 WHERE id = ?', [
                qtyToRestore,
                latestBatch.id
              ]);
            }
          }

          // Record stock ledger reversal movement (movement_type: CUSTOMER_RETURN)
          dbRun(`
            INSERT INTO stock_ledger (
              id, product_id, variant_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
            ) VALUES (?, ?, ?, 'CUSTOMER_RETURN', ?, ?, 'RETURN', ?, ?, ?, ?)
          `, [
            'stk_rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            item.product_id,
            item.variant_id,
            item.quantity, // positive quantity restores stock
            item.cogs > 0 ? (item.cogs / item.quantity) : 0,
            sale.id,
            `Void Reversal Bill #${sale.bill_number}: ${fullReason}`,
            req.user?.id || 'OWNER',
            now
          ]);
        }
      }

      // 3. Reverse Financial movements (Cash, UPI, Split)
      const origCashTx = dbQueryOne<any>(
        "SELECT * FROM financial_transactions WHERE reference_no = ? AND destination_account = 'CASH' AND is_reversed = 0 LIMIT 1",
        [sale.bill_number]
      );
      const origUpiTx = dbQueryOne<any>(
        "SELECT * FROM financial_transactions WHERE reference_no = ? AND destination_account = 'UPI' AND is_reversed = 0 LIMIT 1",
        [sale.bill_number]
      );

      if (origCashTx) {
        dbRun('UPDATE financial_transactions SET is_reversed = 1, updated_at = ? WHERE id = ?', [now, origCashTx.id]);
      }
      if (origUpiTx) {
        dbRun('UPDATE financial_transactions SET is_reversed = 1, updated_at = ? WHERE id = ?', [now, origUpiTx.id]);
      }

      // Cash Reversal
      if (sale.cash_paid > 0) {
        const revCashId = 'ftx_v_cash_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, is_reversed, original_tx_id, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'CASH', 'EXTERNAL', 'OTHER', ?, 'SALE_REVERSAL', ?, 'CASH', ?, ?, 1, 1, ?, ?, ?, ?)
        `, [
          revCashId,
          reversalTxDate,
          sale.cash_paid,
          sale.customer_name || 'Walk-in Customer',
          `Void Reversal (Cash): Bill #${sale.bill_number}`,
          `VOID-${sale.bill_number}`,
          `Bill Cancellation Reason: ${fullReason}`,
          origCashTx?.id || null,
          req.user?.id || 'OWNER',
          now,
          now
        ]);

        if (isDayClosed && origCashTx) {
          dbRun(`
            INSERT INTO financial_corrections (
              id, original_tx_id, correction_date, difference_amount, reason, user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            'corr_c_' + Date.now(),
            origCashTx.id,
            todayStr,
            -sale.cash_paid,
            `Bill Void #${sale.bill_number}: ${fullReason}`,
            req.user?.id || 'OWNER',
            now
          ]);
        }
      }

      // UPI Reversal
      if (sale.upi_paid > 0) {
        const revUpiId = 'ftx_v_upi_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, is_reversed, original_tx_id, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'UPI', 'EXTERNAL', 'OTHER', ?, 'SALE_REVERSAL', ?, 'UPI', ?, ?, 1, 1, ?, ?, ?, ?)
        `, [
          revUpiId,
          reversalTxDate,
          sale.upi_paid,
          sale.customer_name || 'Walk-in Customer',
          `Void Reversal (UPI): Bill #${sale.bill_number}`,
          `VOID-${sale.bill_number}`,
          `Bill Cancellation Reason: ${fullReason}`,
          origUpiTx?.id || null,
          req.user?.id || 'OWNER',
          now,
          now
        ]);

        if (isDayClosed && origUpiTx) {
          dbRun(`
            INSERT INTO financial_corrections (
              id, original_tx_id, correction_date, difference_amount, reason, user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            'corr_u_' + Date.now(),
            origUpiTx.id,
            todayStr,
            -sale.upi_paid,
            `Bill Void #${sale.bill_number}: ${fullReason}`,
            req.user?.id || 'OWNER',
            now
          ]);
        }
      }

      // 4. Reverse Customer Due / Credit if applicable
      if (sale.balance_due > 0 || sale.payment_method === 'CREDIT') {
        const due = dbQueryOne<any>('SELECT * FROM customer_dues WHERE sale_id = ?', [sale.id]);
        if (due) {
          dbRun(`
            UPDATE customer_dues SET
              status = 'CLEARED',
              balance_due = 0,
              updated_at = ?,
              notes = notes || ?
            WHERE id = ?
          `, [now, ` [CANCELLED with Bill #${sale.bill_number}]`, due.id]);

          if (sale.customer_id) {
            syncCustomerBalance(sale.customer_id);
          }
        }
      }

      // 5. Adjust customer total_purchases
      if (sale.customer_id) {
        dbRun('UPDATE customers SET total_purchases = MAX(0, total_purchases - ?) WHERE id = ?', [
          sale.total_amount,
          sale.customer_id
        ]);
      }
    });

    saveDb(true);

    logAudit(req.user?.id || 'OWNER', 'BILL_VOIDED', 'SALE', sale.id, {
      bill_number: sale.bill_number,
      original_amount: sale.total_amount,
      payment_method: sale.payment_method,
      cancelled_by: cancelledByName,
      reason: fullReason,
      timestamp: now
    });

    res.json({
      success: true,
      message: `Bill #${sale.bill_number} successfully cancelled and reversed.`,
      sale: {
        ...sale,
        status: 'CANCELLED',
        cancelled_at: now,
        cancelled_by: req.user?.id || 'OWNER',
        cancelled_by_name: cancelledByName,
        cancelled_reason: fullReason
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Return individual items from a completed bill
router.post('/bills/:id/return', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { items: returnItemsReq, refund_method = 'CASH', reason, notes } = req.body;

    if (!Array.isArray(returnItemsReq) || returnItemsReq.length === 0) {
      res.status(400).json({ error: 'Please select at least one item to return.' });
      return;
    }

    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'A valid return reason is required.' });
      return;
    }

    const sale = dbQueryOne<any>('SELECT * FROM sales WHERE id = ? OR bill_number = ?', [id, id]);
    if (!sale) {
      res.status(404).json({ error: 'Bill not found.' });
      return;
    }

    if (sale.status === 'CANCELLED') {
      res.status(400).json({ error: 'Cannot process returns on a cancelled bill.' });
      return;
    }

    const validatedReturns: any[] = [];
    let totalRefundAmount = 0;
    let totalCogsReversed = 0;

    for (const reqIt of returnItemsReq) {
      const si = dbQueryOne<any>('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', [
        reqIt.sale_item_id,
        sale.id
      ]);
      if (!si) {
        res.status(400).json({ error: `Sale item not found: ${reqIt.sale_item_id}` });
        return;
      }

      const returnQty = Math.max(1, parseInt(reqIt.quantity, 10) || 1);
      const prevReturnedRow = dbQueryOne<any>(
        'SELECT COALESCE(SUM(quantity), 0) as q FROM sale_return_items WHERE sale_item_id = ?',
        [si.id]
      );
      const alreadyReturned = prevReturnedRow?.q || 0;
      const returnable = si.quantity - alreadyReturned;

      if (returnQty > returnable) {
        res.status(400).json({
          error: `Cannot return ${returnQty} of '${si.product_name}'. Only ${returnable} remaining returnable.`
        });
        return;
      }

      // Unit effective selling price on this line
      const unitEffective = si.total_price / si.quantity;
      const itemRefund = Math.round(unitEffective * returnQty);
      const itemCogs = Math.round(((si.cogs / si.quantity) * returnQty) * 100) / 100;

      totalRefundAmount += itemRefund;
      totalCogsReversed += itemCogs;

      validatedReturns.push({
        sale_item: si,
        quantity: returnQty,
        unit_price: unitEffective,
        refund_amount: itemRefund,
        cogs_reversed: itemCogs
      });
    }

    const returnNumber = getNextReturnNumber();
    const returnId = 'ret_' + Date.now();
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];
    const saleDate = sale.created_at.split('T')[0];
    const closingRecord = dbQueryOne<any>('SELECT status FROM daily_closings WHERE closing_date = ?', [saleDate]);
    const isDayClosed = sale.day_closed === 1 || (closingRecord && closingRecord.status === 'CLOSED') || saleDate < todayStr;
    const reversalTxDate = isDayClosed ? todayStr : saleDate;

    const fullReason = reason.trim() + (notes && notes.trim() ? ` - ${notes.trim()}` : '');
    const returnedByName = req.user?.full_name || req.user?.username || 'Staff';

    dbTransaction(() => {
      // 1. Insert into sale_returns
      dbRun(`
        INSERT INTO sale_returns (
          id, sale_id, bill_number, return_number, refund_amount, cogs_reversed,
          refund_method, reason, returned_by, returned_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        returnId,
        sale.id,
        sale.bill_number,
        returnNumber,
        totalRefundAmount,
        totalCogsReversed,
        refund_method,
        fullReason,
        req.user?.id || 'STAFF',
        returnedByName,
        now
      ]);

      // 2. Insert items and restore FIFO inventory
      for (const vr of validatedReturns) {
        const returnItemId = 'sri_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        dbRun(`
          INSERT INTO sale_return_items (
            id, return_id, sale_id, sale_item_id, product_id, variant_id,
            product_name, quantity, unit_price, refund_amount, cogs_reversed, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          returnItemId,
          returnId,
          sale.id,
          vr.sale_item.id,
          vr.sale_item.product_id,
          vr.sale_item.variant_id,
          vr.sale_item.product_name,
          vr.quantity,
          vr.unit_price,
          vr.refund_amount,
          vr.cogs_reversed,
          now
        ]);

        // Restore to FIFO purchase_batches
        let qtyToRestore = vr.quantity;
        const batches = dbQueryAll<any>(`
          SELECT * FROM purchase_batches 
          WHERE product_id = ? AND remaining_qty < initial_qty 
          ORDER BY received_date DESC, created_at DESC
        `, [vr.sale_item.product_id]);

        for (const batch of batches) {
          if (qtyToRestore <= 0) break;
          const space = batch.initial_qty - batch.remaining_qty;
          const restore = Math.min(space, qtyToRestore);
          dbRun('UPDATE purchase_batches SET remaining_qty = remaining_qty + ?, is_active = 1 WHERE id = ?', [
            restore,
            batch.id
          ]);
          qtyToRestore -= restore;
        }

        if (qtyToRestore > 0) {
          const latestBatch = dbQueryOne<any>(
            'SELECT id FROM purchase_batches WHERE product_id = ? ORDER BY received_date DESC, created_at DESC LIMIT 1',
            [vr.sale_item.product_id]
          );
          if (latestBatch) {
            dbRun('UPDATE purchase_batches SET remaining_qty = remaining_qty + ?, is_active = 1 WHERE id = ?', [
              qtyToRestore,
              latestBatch.id
            ]);
          }
        }

        // Record stock ledger movement
        dbRun(`
          INSERT INTO stock_ledger (
            id, product_id, variant_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by, created_at
          ) VALUES (?, ?, ?, 'CUSTOMER_RETURN', ?, ?, 'RETURN', ?, ?, ?, ?)
        `, [
          'stk_ret_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          vr.sale_item.product_id,
          vr.sale_item.variant_id,
          vr.quantity, // positive quantity adds to stock
          vr.cogs_reversed > 0 ? (vr.cogs_reversed / vr.quantity) : 0,
          returnId,
          `Return #${returnNumber} (Bill #${sale.bill_number}): ${fullReason}`,
          req.user?.id || 'STAFF',
          now
        ]);
      }

      // 3. Financial refund recording
      if (refund_method === 'CASH' && totalRefundAmount > 0) {
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'CASH', 'EXTERNAL', 'OTHER', ?, 'SALE_REFUND', ?, 'CASH', ?, ?, 1, ?, ?, ?)
        `, [
          'ftx_ret_cash_' + Date.now(),
          reversalTxDate,
          totalRefundAmount,
          sale.customer_name || 'Walk-in Customer',
          `Refund for Return #${returnNumber} (Bill #${sale.bill_number})`,
          returnNumber,
          `Return Reason: ${fullReason}`,
          req.user?.id || 'STAFF',
          now,
          now
        ]);
      } else if (refund_method === 'UPI' && totalRefundAmount > 0) {
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no, notes,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'UPI', 'EXTERNAL', 'OTHER', ?, 'SALE_REFUND', ?, 'UPI', ?, ?, 1, ?, ?, ?)
        `, [
          'ftx_ret_upi_' + Date.now(),
          reversalTxDate,
          totalRefundAmount,
          sale.customer_name || 'Walk-in Customer',
          `UPI Refund for Return #${returnNumber} (Bill #${sale.bill_number})`,
          returnNumber,
          `Return Reason: ${fullReason}`,
          req.user?.id || 'STAFF',
          now,
          now
        ]);
      } else if ((refund_method === 'CREDIT_ADJUSTMENT' || refund_method === 'ADJUST_CUSTOMER_DUE') && totalRefundAmount > 0) {
        const due = dbQueryOne<any>('SELECT * FROM customer_dues WHERE sale_id = ?', [sale.id]);
        if (due) {
          const newBal = Math.max(0, due.balance_due - totalRefundAmount);
          const newStatus = newBal === 0 ? 'CLEARED' : due.status;
          dbRun(`
            UPDATE customer_dues SET
              balance_due = ?,
              status = ?,
              updated_at = ?,
              notes = notes || ?
            WHERE id = ?
          `, [newBal, newStatus, now, ` [Adjusted -₹${totalRefundAmount} via Return #${returnNumber}]`, due.id]);

          if (sale.customer_id) {
            syncCustomerBalance(sale.customer_id);
          }
        }
      }

      // 4. Adjust customer total purchases
      if (sale.customer_id) {
        dbRun('UPDATE customers SET total_purchases = MAX(0, total_purchases - ?) WHERE id = ?', [
          totalRefundAmount,
          sale.customer_id
        ]);
      }
    });

    saveDb(true);

    logAudit(req.user?.id || 'STAFF', 'CUSTOMER_RETURN', 'SALE', sale.id, {
      bill_number: sale.bill_number,
      return_number: returnNumber,
      refund_amount: totalRefundAmount,
      refund_method,
      items_count: validatedReturns.length,
      returned_by: returnedByName,
      reason: fullReason,
      timestamp: now
    });

    res.json({
      success: true,
      return_record: {
        id: returnId,
        bill_number: sale.bill_number,
        return_number: returnNumber,
        refund_amount: totalRefundAmount,
        refund_method,
        reason: fullReason,
        returned_by_name: returnedByName,
        created_at: now,
        items: validatedReturns.map((v) => ({
          product_name: v.sale_item.product_name,
          quantity: v.quantity,
          unit_price: v.unit_price,
          refund_amount: v.refund_amount
        })),
        remaining_sale_value: Math.max(0, sale.total_amount - totalRefundAmount)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
