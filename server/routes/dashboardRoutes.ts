import { Router, Response } from 'express';
import { dbQueryOne, dbQueryAll } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';

const router = Router();

router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    // Today's date in YYYY-MM-DD local format
    const today = new Date().toISOString().split('T')[0];

    // Today's Sales metrics (only active COMPLETED sales)
    const salesSummary = dbQueryOne<any>(`
      SELECT 
        COUNT(*) as total_bills,
        COALESCE(SUM(total_amount), 0) as total_sales,
        COALESCE(SUM(cash_paid), 0) as cash_sales,
        COALESCE(SUM(upi_paid), 0) as upi_sales,
        COALESCE(SUM(balance_due), 0) as credit_sales
      FROM sales 
      WHERE DATE(created_at) = ? AND (status IS NULL OR status = 'COMPLETED')
    `, [today]) || { total_bills: 0, total_sales: 0, cash_sales: 0, upi_sales: 0, credit_sales: 0 };

    // Today's Returns
    const returnsToday = dbQueryOne<any>(`
      SELECT 
        COUNT(*) as return_count,
        COALESCE(SUM(refund_amount), 0) as total_refunds
      FROM sale_returns
      WHERE DATE(created_at) = ?
    `, [today]) || { return_count: 0, total_refunds: 0 };

    // Net sales after refunds
    salesSummary.total_sales = Math.max(0, salesSummary.total_sales - returnsToday.total_refunds);

    // Today's Expenses
    const expenseSummary = dbQueryOne<any>(`
      SELECT 
        COUNT(*) as expense_count,
        COALESCE(SUM(amount), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'UPI' THEN amount ELSE 0 END), 0) as upi_expenses
      FROM expenses 
      WHERE date = ?
    `, [today]) || { expense_count: 0, total_expenses: 0, cash_expenses: 0, upi_expenses: 0 };

    // Pending Customer Dues Total
    const duesSummary = dbQueryOne<any>(`
      SELECT 
        COUNT(*) as pending_count,
        COALESCE(SUM(balance_due), 0) as total_pending_dues
      FROM customer_dues 
      WHERE status = 'PENDING' AND balance_due > 0
    `) || { pending_count: 0, total_pending_dues: 0 };

    // Supplier Dues Total (Owner only)
    let supplierDuesSummary = { pending_count: 0, total_supplier_dues: 0 };
    if (isOwner) {
      supplierDuesSummary = dbQueryOne<any>(`
        SELECT 
          COUNT(*) as pending_count,
          COALESCE(SUM(balance_due), 0) as total_supplier_dues
        FROM purchases 
        WHERE balance_due > 0
      `) || { pending_count: 0, total_supplier_dues: 0 };
    }

    // Low stock alerts (products where total remaining quantity across batches is <= 3 or 0)
    // We compute actual stock from stock_ledger
    const stockAlerts = dbQueryAll(`
      SELECT 
        p.id,
        p.name,
        p.code,
        p.sku,
        c.name as category_name,
        COALESCE(SUM(sl.quantity), 0) as current_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE p.is_active = 1
      GROUP BY p.id
      HAVING current_stock <= 3
      ORDER BY current_stock ASC
      LIMIT 10
    `);

    // Today's active daily closing status
    const dailyClosing = dbQueryOne<any>(`
      SELECT id, closing_date, opening_cash, expected_closing_cash, actual_counted_cash, difference_cash, status
      FROM daily_closings
      WHERE closing_date = ?
    `, [today]);

    // Recent 5 sales today
    const recentSales = dbQueryAll(`
      SELECT id, bill_number, customer_name, total_amount, payment_method, payment_status, created_at
      FROM sales
      WHERE DATE(created_at) = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, [today]);

    // Total counts in real database
    const counts = {
      total_products: dbQueryOne<any>('SELECT COUNT(*) as c FROM products WHERE is_active = 1')?.c || 0,
      total_customers: dbQueryOne<any>('SELECT COUNT(*) as c FROM customers')?.c || 0,
      total_suppliers: isOwner ? (dbQueryOne<any>('SELECT COUNT(*) as c FROM suppliers WHERE is_active = 1')?.c || 0) : null,
      active_staff: isOwner ? (dbQueryOne<any>('SELECT COUNT(*) as c FROM staff WHERE is_active = 1')?.c || 0) : null
    };

    res.json({
      today,
      isOwner,
      sales: salesSummary,
      expenses: expenseSummary,
      customerDues: duesSummary,
      supplierDues: isOwner ? supplierDuesSummary : null,
      stockAlerts,
      dailyClosing,
      recentSales,
      counts
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
