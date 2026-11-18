import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import * as XLSX from 'xlsx';
import { dbQueryAll } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';

const router = new Router();
router.use(authMiddleware);

function sendExcelBuffer(res: Response, data: Record<string, any>[], sheetName: string, fileName: string) {
  const ws = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ Info: 'No real records found in database' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const bytes = new Uint8Array(arrayBuf);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.send(bytes);
}

// 1. Sales Register Excel
router.get('/sales', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sales = await dbQueryAll(`
      SELECT 
        s.bill_number as 'Bill Number',
        s.created_at as 'Date & Time',
        s.customer_name as 'Customer Name',
        s.customer_phone as 'Customer Phone',
        s.subtotal as 'Subtotal (₹)',
        s.festival_discount as 'Festival Discount (₹)',
        s.special_discount as 'Special Discount (₹)',
        s.discount_amount as 'Total Discount (₹)',
        s.total_amount as 'Total Amount (₹)',
        s.amount_paid as 'Amount Paid (₹)',
        s.balance_due as 'Balance Due (₹)',
        s.payment_method as 'Payment Method',
        s.payment_status as 'Payment Status',
        u.full_name as 'Cashier'
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      ORDER BY s.created_at DESC
    `);
    sendExcelBuffer(res, sales, 'Sales', `NBF_Sales_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Inventory / Stock Report Excel
router.get('/inventory', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const sql = `
      SELECT 
        p.name as 'Product Name',
        p.code as 'Item Code',
        p.sku as 'SKU',
        p.barcode as 'Barcode',
        c.name as 'Category',
        b.name as 'Brand',
        p.mrp as 'MRP (₹)',
        p.selling_price as 'Selling Price (₹)',
        COALESCE(SUM(sl.quantity), 0) as 'Current Physical Stock'
        ${isOwner ? ", p.purchase_cost as 'Purchase Cost (₹)', (COALESCE(SUM(sl.quantity), 0) * p.purchase_cost) as 'Stock Valuation (₹)'" : ''}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN stock_ledger sl ON p.id = sl.product_id
      WHERE p.is_active = 1
      GROUP BY p.id
      ORDER BY p.name ASC
    `;
    const rows = await dbQueryAll(sql);
    sendExcelBuffer(res, rows, 'Stock', `NBF_Stock_Inventory_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Daily Closing Records Excel
router.get('/daily-closings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const closings = await dbQueryAll(`
      SELECT 
        dc.closing_date as 'Date',
        dc.opening_cash as 'Opening Cash (₹)',
        dc.cash_sales as 'Cash Sales (₹)',
        dc.cash_received_other as 'Other Cash Received (₹)',
        dc.cash_expenses as 'Cash Expenses (₹)',
        dc.cash_paid_other as 'Other Cash Paid (₹)',
        dc.expected_closing_cash as 'Expected Closing Cash (₹)',
        dc.actual_counted_cash as 'Actual Counted Cash (₹)',
        dc.difference_cash as 'Shortage/Excess (₹)',
        dc.upi_sales as 'UPI Sales (₹)',
        dc.upi_received_other as 'Other UPI In (₹)',
        dc.upi_payments as 'UPI Paid Out (₹)',
        dc.status as 'Status',
        u.full_name as 'Closed By',
        dc.closed_at as 'Closed At',
        dc.closing_notes as 'Notes'
      FROM daily_closings dc
      LEFT JOIN users u ON dc.closed_by_user_id = u.id
      ORDER BY dc.closing_date DESC
    `);
    sendExcelBuffer(res, closings, 'Daily Closings', `NBF_Daily_Closing_DayBook_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Customer Dues / Credit Ledger Excel
router.get('/customer-dues', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const dues = await dbQueryAll(`
      SELECT 
        c.name as 'Customer Name',
        c.phone as 'Phone Number',
        s.bill_number as 'Sale Bill #',
        cd.created_at as 'Credit Given Date',
        cd.original_due as 'Original Credit (₹)',
        cd.amount_paid as 'Amount Collected (₹)',
        cd.balance_due as 'Outstanding Due (₹)',
        cd.status as 'Status',
        cd.notes as 'Notes'
      FROM customer_dues cd
      JOIN customers c ON cd.customer_id = c.id
      LEFT JOIN sales s ON cd.sale_id = s.id
      ORDER BY cd.created_at DESC
    `);
    sendExcelBuffer(res, dues, 'Customer Dues', `NBF_Customer_Dues_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Purchases & Supplier Dues Excel (Owner only)
router.get('/purchases', requireRole(['OWNER']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const purchases = await dbQueryAll(`
      SELECT 
        p.invoice_number as 'Invoice Number',
        p.invoice_date as 'Invoice Date',
        s.name as 'Supplier Name',
        s.phone as 'Supplier Phone',
        p.total_amount as 'Total Bill (₹)',
        p.paid_amount as 'Paid Amount (₹)',
        p.balance_due as 'Balance Due (₹)',
        p.payment_status as 'Payment Status',
        p.payment_method as 'Payment Method',
        p.notes as 'Notes'
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.invoice_date DESC
    `);
    sendExcelBuffer(res, purchases, 'Purchases', `NBF_Purchases_Register_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Expenses Register Excel (Owner only)
router.get('/expenses', requireRole(['OWNER']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const expenses = await dbQueryAll(`
      SELECT 
        e.date as 'Date',
        e.category as 'Category',
        e.amount as 'Amount (₹)',
        e.payment_method as 'Payment Mode',
        e.paid_to as 'Paid To / Person',
        e.purpose as 'Purpose',
        e.reference_no as 'Reference',
        u.full_name as 'Recorded By'
      FROM expenses e
      LEFT JOIN users u ON e.user_id = u.id
      ORDER BY e.date DESC
    `);
    sendExcelBuffer(res, expenses, 'Expenses', `NBF_Operating_Expenses_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Cashbook / Money Flow Excel (Owner only)
router.get('/money-flow', requireRole(['OWNER']), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const transactions = await dbQueryAll(`
      SELECT 
        ft.date as 'Date',
        ft.amount as 'Amount (₹)',
        ft.transaction_type as 'Transaction Type',
        ft.source_account as 'From Account',
        ft.destination_account as 'To Account',
        ft.person_entity as 'Entity / Person',
        ft.purpose as 'Purpose',
        ft.payment_method as 'Method',
        ft.reference_no as 'Reference #',
        CASE WHEN ft.is_system_generated = 1 THEN 'System' ELSE 'Manual' END as 'Source',
        u.full_name as 'User'
      FROM financial_transactions ft
      LEFT JOIN users u ON ft.user_id = u.id
      ORDER BY ft.date DESC, ft.created_at DESC
    `);
    sendExcelBuffer(res, transactions, 'Money Flow', `NBF_Business_Money_Flow_${Date.now()}`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
