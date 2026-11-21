import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryOne, dbQueryAll } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { getTodayIST, sqlEffectiveSaleDate, sqlISTDate } from '../dateUtil.ts';

const router = new Router();

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const todayStr = getTodayIST();
    const targetDate = (req.query.date as string) || todayStr;
    const isToday = targetDate === todayStr;

    // 1. Store Details
    const storeNameRow = await dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_name']);
    const storeLocationRow = await dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_location']);
    const storeTaglineRow = await dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_tagline']);
    const phone1Row = await dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_1']);

    const storeInfo = {
      name: storeNameRow?.value || 'New Bhama Fashions',
      location: storeLocationRow?.value || 'Chilakaluripet, Andhra Pradesh',
      tagline: storeTaglineRow?.value || 'Ladies Fashion Retail',
      phone: phone1Row?.value || '6305782832',
    };

    // 2. Sales Metrics for targetDate
    const salesSummary = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as total_bills,
        COALESCE(SUM(total_amount), 0) as gross_sales,
        COALESCE(SUM(cash_paid), 0) as cash_sales,
        COALESCE(SUM(upi_paid), 0) as upi_sales,
        COALESCE(SUM(balance_due), 0) as credit_sales,
        COALESCE(SUM(CASE WHEN channel = 'MANUAL' THEN 1 ELSE 0 END), 0) as manual_bills_count,
        COALESCE(SUM(CASE WHEN channel = 'MANUAL' THEN total_amount ELSE 0 END), 0) as manual_bills_total,
        COALESCE(SUM(CASE WHEN channel = 'MANUAL' THEN cash_paid ELSE 0 END), 0) as manual_cash_sales,
        COALESCE(SUM(CASE WHEN channel = 'MANUAL' THEN upi_paid ELSE 0 END), 0) as manual_upi_sales,
        COALESCE(SUM(CASE WHEN channel = 'MANUAL' THEN balance_due ELSE 0 END), 0) as manual_credit_sales,
        COALESCE(SUM(CASE WHEN channel != 'MANUAL' OR channel IS NULL THEN 1 ELSE 0 END), 0) as pos_bills_count,
        COALESCE(SUM(CASE WHEN channel != 'MANUAL' OR channel IS NULL THEN total_amount ELSE 0 END), 0) as pos_bills_total
      FROM sales 
      WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')
    `, [targetDate])) || {
      total_bills: 0,
      gross_sales: 0,
      cash_sales: 0,
      upi_sales: 0,
      credit_sales: 0,
      manual_bills_count: 0,
      manual_bills_total: 0,
      manual_cash_sales: 0,
      manual_upi_sales: 0,
      manual_credit_sales: 0,
      pos_bills_count: 0,
      pos_bills_total: 0,
    };

    // 3. Returns and Refunds for targetDate
    const returnsSummary = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as return_count,
        COALESCE(SUM(refund_amount), 0) as total_refunds,
        COALESCE(SUM(CASE WHEN refund_method = 'CASH' THEN refund_amount ELSE 0 END), 0) as cash_refunds,
        COALESCE(SUM(CASE WHEN refund_method = 'UPI' THEN refund_amount ELSE 0 END), 0) as upi_refunds
      FROM sale_returns
      WHERE ${sqlISTDate('created_at')} = ?
    `, [targetDate])) || { return_count: 0, total_refunds: 0, cash_refunds: 0, upi_refunds: 0 };

    const netSales = Math.max(0, salesSummary.gross_sales - returnsSummary.total_refunds);
    const netSalesCash = Math.max(0, salesSummary.cash_sales - returnsSummary.cash_refunds);
    const netSalesUpi = Math.max(0, salesSummary.upi_sales - returnsSummary.upi_refunds);

    // 4. Customer Due Collections on targetDate
    const dueCollections = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_collected,
        COALESCE(SUM(CASE WHEN destination_account = 'CASH' OR payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_collected,
        COALESCE(SUM(CASE WHEN destination_account = 'UPI' OR payment_method = 'UPI' THEN amount ELSE 0 END), 0) as upi_collected
      FROM financial_transactions
      WHERE date = ? 
        AND transaction_type = 'CUSTOMER_DUE_COLLECTION'
        AND is_reversed = 0
    `, [targetDate])) || { count: 0, total_collected: 0, cash_collected: 0, upi_collected: 0 };

    const cashReceivedToday = netSalesCash + dueCollections.cash_collected;
    const upiReceivedToday = netSalesUpi + dueCollections.upi_collected;

    // 5. Customer Dues Outstanding
    const customerDuesSummary = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as pending_count,
        COALESCE(SUM(balance_due), 0) as total_pending_dues,
        COUNT(DISTINCT customer_id) as customer_count
      FROM customer_dues 
      WHERE status = 'PENDING' AND balance_due > 0
    `)) || { pending_count: 0, total_pending_dues: 0, customer_count: 0 };

    // 6. Current Cash Drawer Balance per Cash Ledger
    const cashInRow = await dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM financial_transactions 
      WHERE destination_account = 'CASH' AND is_reversed = 0
    `);
    const cashOutRow = await dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM financial_transactions 
      WHERE source_account = 'CASH' AND is_reversed = 0
    `);
    const currentCashBalance = Math.round(((cashInRow?.total || 0) - (cashOutRow?.total || 0)) * 100) / 100;

    const dateCashInRow = await dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM financial_transactions 
      WHERE destination_account = 'CASH' AND date = ? AND is_reversed = 0
    `, [targetDate]);
    const dateCashOutRow = await dbQueryOne<any>(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM financial_transactions 
      WHERE source_account = 'CASH' AND date = ? AND is_reversed = 0
    `, [targetDate]);

    // 7. Operating Expenses for targetDate
    const expenseTable = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN payment_method = 'UPI' THEN amount ELSE 0 END), 0) as upi_expenses
      FROM expenses 
      WHERE date = ?
    `, [targetDate])) || { count: 0, total_expenses: 0, cash_expenses: 0, upi_expenses: 0 };

    const ftExpenses = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN destination_account = 'CASH' OR source_account = 'CASH' OR payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN destination_account = 'UPI' OR source_account = 'UPI' OR payment_method = 'UPI' THEN amount ELSE 0 END), 0) as upi_expenses
      FROM financial_transactions
      WHERE date = ? AND transaction_type = 'OPERATING_EXPENSE' AND is_reversed = 0
    `, [targetDate])) || { count: 0, total_expenses: 0, cash_expenses: 0, upi_expenses: 0 };

    const totalExpenses = Math.max(expenseTable.total_expenses, ftExpenses.total_expenses);
    const cashExpenses = Math.max(expenseTable.cash_expenses, ftExpenses.cash_expenses);
    const upiExpenses = Math.max(expenseTable.upi_expenses, ftExpenses.upi_expenses);
    const expenseCount = Math.max(expenseTable.count, ftExpenses.count);

    // 8. Supplier Outstanding
    const supplierDuesSummary = (await dbQueryOne<any>(`
      SELECT 
        COUNT(*) as pending_count,
        COALESCE(SUM(balance_due), 0) as total_supplier_dues
      FROM purchases 
      WHERE balance_due > 0 AND COALESCE(is_reversed, 0) = 0
    `)) || { pending_count: 0, total_supplier_dues: 0 };

    // 9. Day Closing Status
    const dailyClosing = await dbQueryOne<any>(`
      SELECT 
        dc.id, 
        dc.closing_date, 
        dc.opening_cash, 
        dc.expected_closing_cash, 
        dc.actual_counted_cash, 
        dc.difference_cash, 
        dc.status,
        dc.closed_at,
        dc.closing_notes,
        dc.modified_after_close,
        dc.last_modified_at,
        dc.last_modified_by,
        dc.last_modification_summary,
        u.full_name as closed_by_name
      FROM daily_closings dc
      LEFT JOIN users u ON dc.closed_by_user_id = u.id
      WHERE dc.closing_date = ?
    `, [targetDate]);

    const isDayClosed = dailyClosing?.status === 'CLOSED';

    let openingCash = dailyClosing?.opening_cash || 0;
    if (!dailyClosing || dailyClosing.opening_cash === undefined) {
      const prevClosing = await dbQueryOne<any>(
        'SELECT actual_counted_cash FROM daily_closings WHERE closing_date < ? ORDER BY closing_date DESC LIMIT 1',
        [targetDate]
      );
      openingCash = prevClosing ? prevClosing.actual_counted_cash : 0;
    }

    const expectedClosingCash =
      Math.round((openingCash + (dateCashInRow?.total || 0) - (dateCashOutRow?.total || 0)) * 100) / 100;

    // 10. Low Stock Alerts
    const stockAlerts = await dbQueryAll(`
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

    // 11. Recent Sales for targetDate
    const recentSales = await dbQueryAll(`
      SELECT 
        id, 
        bill_number, 
        customer_name, 
        total_amount, 
        payment_method, 
        payment_status, 
        cash_paid, 
        upi_paid, 
        balance_due,
        channel, 
        created_at
      FROM sales
      WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')
      ORDER BY created_at DESC
      LIMIT 6
    `, [targetDate]);

    // 12. Available dates
    const availableDates = await dbQueryAll<{ sale_date: string; count: number; total: number }>(`
      SELECT 
        ${sqlEffectiveSaleDate()} as sale_date, 
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total
      FROM sales 
      WHERE status IS NULL OR status = 'COMPLETED'
      GROUP BY sale_date 
      ORDER BY sale_date DESC 
      LIMIT 15
    `);

    const totalProducts = (await dbQueryOne<any>('SELECT COUNT(*) as c FROM products WHERE is_active = 1'))?.c || 0;
    const lowStockCount = stockAlerts.filter((s: any) => s.current_stock > 0).length;
    const outOfStockCount = stockAlerts.filter((s: any) => s.current_stock <= 0).length;

    res.json({
      selectedDate: targetDate,
      isToday,
      isOwner,
      store: storeInfo,

      sales: {
        total_sales: netSales,
        gross_sales: salesSummary.gross_sales,
        total_bills: salesSummary.total_bills,
        cash_sales: netSalesCash,
        upi_sales: netSalesUpi,
        credit_sales: salesSummary.credit_sales,
        manual_bills_count: salesSummary.manual_bills_count,
        manual_bills_total: salesSummary.manual_bills_total,
        manual_cash_sales: salesSummary.manual_cash_sales,
        manual_upi_sales: salesSummary.manual_upi_sales,
        manual_credit_sales: salesSummary.manual_credit_sales,
        pos_bills_count: salesSummary.pos_bills_count,
        pos_bills_total: salesSummary.pos_bills_total,
      },
      collections: {
        cash_received: cashReceivedToday,
        sales_cash: netSalesCash,
        due_cash: dueCollections.cash_collected,
        upi_received: upiReceivedToday,
        sales_upi: netSalesUpi,
        due_upi: dueCollections.upi_collected,
      },

      customerDues: {
        total_pending: customerDuesSummary.total_pending_dues,
        pending_count: customerDuesSummary.pending_count,
        customer_count: customerDuesSummary.customer_count,
        credit_sales_today: salesSummary.credit_sales,
      },
      cashDrawer: {
        current_balance: currentCashBalance,
        opening_cash: openingCash,
        today_cash_in: dateCashInRow?.total || 0,
        today_cash_out: dateCashOutRow?.total || 0,
        expected_closing_cash: expectedClosingCash,
      },
      expenses: {
        total_expenses: totalExpenses,
        cash_expenses: cashExpenses,
        upi_expenses: upiExpenses,
        count: expenseCount,
      },

      supplierOutstanding: {
        total_pending: supplierDuesSummary.total_supplier_dues,
        pending_count: supplierDuesSummary.pending_count,
      },
      closing: {
        is_closed: isDayClosed,
        status: isDayClosed ? 'CLOSED' : 'ACTIVE',
        opening_cash: openingCash,
        expected_closing_cash: dailyClosing?.expected_closing_cash ?? expectedClosingCash,
        actual_counted_cash: dailyClosing?.actual_counted_cash ?? null,
        closed_at: dailyClosing?.closed_at ?? null,
        closed_by_name: dailyClosing?.closed_by_name ?? null,
        notes: dailyClosing?.closing_notes ?? null,
        modified_after_close: Number(dailyClosing?.modified_after_close || 0) === 1,
        last_modification_summary: dailyClosing?.last_modification_summary ?? null,
      },
      manualBills: {
        count: salesSummary.manual_bills_count,
        total_amount: salesSummary.manual_bills_total,
        cash_amount: salesSummary.manual_cash_sales,
        upi_amount: salesSummary.manual_upi_sales,
        credit_amount: salesSummary.manual_credit_sales,
      },

      recentSales,
      stockAlerts,
      availableDates,
      stockCount: {
        total_products: totalProducts,
        low_stock: lowStockCount,
        out_of_stock: outOfStockCount,
      },

      todaySales: {
        total: netSales,
        bills_count: salesSummary.total_bills,
        cash_collected: cashReceivedToday,
        upi_collected: upiReceivedToday,
      },
      todayExpenses: totalExpenses,
      pendingCustomerDues: customerDuesSummary.total_pending_dues,
      pendingSupplierDues: supplierDuesSummary.total_supplier_dues,
      accounts: {
        cash: currentCashBalance,
        upi: upiReceivedToday,
      },
      dailyClosing,
    });
  } catch (err: any) {
    console.error('Error fetching dashboard metrics:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard metrics' });
  }
});

export default router;
