import { logSyncToFirestore } from './firebase.ts';

export interface SheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  createdAt: string;
}

/**
 * Creates a formatted Google Spreadsheet for New Bhama Fashions Day Book & Sales
 */
export async function exportDayBookToGoogleSheets(
  accessToken: string,
  userEmail: string,
  summary: any,
  bills: any[],
  transactions: any[]
): Promise<SheetExportResult> {
  const dateStr = summary?.date || new Date().toISOString().split('T')[0];
  const title = `New Bhama Fashions - Day Book & Sales (${dateStr})`;

  // 1. Create Spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Day Summary' } },
        { properties: { title: 'Sales Bills' } },
        { properties: { title: 'Cash & UPI In-Out' } },
      ],
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to create Google Sheet: ${createRes.statusText}`);
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 2. Prepare Data for Each Sheet
  const summaryRows = [
    ['NEW BHAMA FASHIONS - DAILY CLOSING & DAY BOOK'],
    ['Location: Chilakaluripet, Andhra Pradesh'],
    ['Report Date', dateStr],
    ['Generated At', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Closing Status', summary?.isClosed ? 'DAY CLOSED' : 'ACTIVE / IN PROGRESS'],
    [],
    ['KEY FINANCIAL METRICS', 'AMOUNT (₹)'],
    ['Total Net Sales', summary?.total_sales || 0],
    ['Total Bills Count', summary?.bill_count || bills.length || 0],
    ['Total Discounts Given', summary?.total_discount || 0],
    ['Festival & Special Discounts', summary?.festival_discounts || 0],
    [],
    ['PAYMENT BREAKDOWN', 'AMOUNT (₹)'],
    ['Cash Sales', summary?.cash_sales || 0],
    ['UPI / QR Sales', summary?.upi_sales || 0],
    ['Card / Swipe Sales', summary?.card_sales || 0],
    ['Customer Credit / Dues', summary?.due_sales || 0],
    [],
    ['CASH DRAWER RECONCILIATION', 'AMOUNT (₹)'],
    ['Opening Cash Balance', summary?.opening_cash || 0],
    ['Manual Cash Added (In)', summary?.cash_in || 0],
    ['Expenses / Cash Withdrawn (Out)', summary?.cash_out || 0],
    ['Expected Cash in Drawer', summary?.expected_cash || 0],
    ['Actual Physical Cash Counted', summary?.actual_cash || summary?.expected_cash || 0],
    ['Cash Discrepancy (Over / Short)', summary?.discrepancy || 0],
    [],
    ['Closing Notes / Remarks', summary?.notes || 'Day reconciled successfully.'],
  ];

  const billsHeader = [
    'Bill Number',
    'Date & Time',
    'Customer Name',
    'Customer Phone',
    'Payment Method',
    'Items Count',
    'Subtotal (₹)',
    'Discount (₹)',
    'Total Amount (₹)',
    'Cashier',
    'Status',
  ];

  const billsRows = [
    ['NEW BHAMA FASHIONS - COMPLETED BILLS FOR ' + dateStr],
    [],
    billsHeader,
    ...bills.map((b) => [
      b.bill_number || b.id,
      b.created_at ? new Date(b.created_at).toLocaleTimeString('en-IN') : '',
      b.customer_name || 'Walk-in Customer',
      b.customer_phone || '-',
      b.payment_method || 'CASH',
      b.items_count || (b.items ? b.items.length : 1),
      b.subtotal || b.total_amount,
      b.discount || 0,
      b.total_amount || 0,
      b.cashier_name || 'Store Owner',
      b.is_cancelled ? 'CANCELLED' : 'COMPLETED',
    ]),
  ];

  const transHeader = ['Time', 'Type', 'Category', 'Description', 'Amount (₹)', 'Payment Mode', 'Logged By'];
  const transRows = [
    ['NEW BHAMA FASHIONS - CASH FLOW & EXPENSES FOR ' + dateStr],
    [],
    transHeader,
    ...transactions.map((t) => [
      t.created_at ? new Date(t.created_at).toLocaleTimeString('en-IN') : '',
      t.type || 'EXPENSE',
      t.category || 'General',
      t.description || '',
      t.amount || 0,
      t.payment_mode || 'CASH',
      t.created_by_name || 'Store Admin',
    ]),
  ];

  // 3. Batch Update Values
  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: "'Day Summary'!A1", values: summaryRows },
          { range: "'Sales Bills'!A1", values: billsRows },
          { range: "'Cash & UPI In-Out'!A1", values: transRows },
        ],
      }),
    }
  );

  if (!batchRes.ok) {
    const errData = await batchRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || 'Failed to populate Google Sheet values');
  }

  // 4. Log sync to Firestore
  await logSyncToFirestore({
    type: 'sheets_export',
    title,
    details: `Exported ${bills.length} bills & Day Book summary to Google Sheets.`,
    userEmail,
    status: 'SUCCESS',
    url: spreadsheetUrl,
  });

  return {
    spreadsheetId,
    spreadsheetUrl,
    title,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Exports Products & Stock Valuation to Google Sheets
 */
export async function exportInventoryToGoogleSheets(
  accessToken: string,
  userEmail: string,
  products: any[]
): Promise<SheetExportResult> {
  const dateStr = new Date().toISOString().split('T')[0];
  const title = `New Bhama Fashions - Stock & Valuation Report (${dateStr})`;

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Stock Inventory' } }],
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to create Google Sheet: ${createRes.statusText}`);
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const totalCostVal = products.reduce((acc, p) => acc + (p.cost_price || 0) * (p.stock_quantity || 0), 0);
  const totalRetailVal = products.reduce((acc, p) => acc + (p.selling_price || 0) * (p.stock_quantity || 0), 0);
  const totalUnits = products.reduce((acc, p) => acc + (p.stock_quantity || 0), 0);

  const header = [
    'Barcode / SKU',
    'Product Name',
    'Category',
    'Brand',
    'HSN Code',
    'Current Stock (Qty)',
    'Min Stock Alert',
    'Cost Price (₹)',
    'Selling Price / MRP (₹)',
    'Total Stock Cost (₹)',
    'Total Retail Value (₹)',
    'Stock Status',
  ];

  const rows = [
    ['NEW BHAMA FASHIONS - COMPLETE INVENTORY & VALUATION REPORT'],
    ['Location: Chilakaluripet, AP | Generated: ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Total Catalog Items', products.length],
    ['Total Physical Units', totalUnits],
    ['Total Inventory Cost Value (₹)', totalCostVal.toFixed(2)],
    ['Total Inventory Retail Value (₹)', totalRetailVal.toFixed(2)],
    [],
    header,
    ...products.map((p) => {
      const qty = p.stock_quantity || 0;
      const minAlert = p.min_stock_alert || 5;
      let status = 'IN STOCK';
      if (qty <= 0) status = 'OUT OF STOCK';
      else if (qty <= minAlert) status = 'LOW STOCK ALERT';

      return [
        p.barcode || p.sku || '-',
        p.name || 'Unnamed Item',
        p.category || 'General',
        p.brand || 'Bhama',
        p.hsn_code || '-',
        qty,
        minAlert,
        p.cost_price || 0,
        p.selling_price || 0,
        ((p.cost_price || 0) * qty).toFixed(2),
        ((p.selling_price || 0) * qty).toFixed(2),
        status,
      ];
    }),
  ];

  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [{ range: "'Stock Inventory'!A1", values: rows }],
      }),
    }
  );

  if (!batchRes.ok) {
    const errData = await batchRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || 'Failed to update Google Sheet rows');
  }

  await logSyncToFirestore({
    type: 'sheets_export',
    title,
    details: `Exported ${products.length} products (₹${totalRetailVal.toFixed(2)} retail value) to Google Sheets.`,
    userEmail,
    status: 'SUCCESS',
    url: spreadsheetUrl,
  });

  return {
    spreadsheetId,
    spreadsheetUrl,
    title,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Exports Customer Dues Ledger to Google Sheets
 */
export async function exportCustomerDuesToGoogleSheets(
  accessToken: string,
  userEmail: string,
  customers: any[]
): Promise<SheetExportResult> {
  const dateStr = new Date().toISOString().split('T')[0];
  const title = `New Bhama Fashions - Customer Dues & Credit Ledger (${dateStr})`;

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Customer Dues Ledger' } }],
    }),
  });

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData?.error?.message || 'Failed to create Google Sheet');
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const totalOutstanding = customers.reduce((acc, c) => acc + (c.due_balance || c.balance || 0), 0);

  const header = [
    'Customer Name',
    'Phone Number',
    'Outstanding Due Balance (₹)',
    'Total Purchases (₹)',
    'Credit Limit (₹)',
    'Last Payment Date',
    'Follow-up Status',
  ];

  const rows = [
    ['NEW BHAMA FASHIONS - CUSTOMER CREDIT & DUES LEDGER'],
    ['Location: Chilakaluripet, AP | Generated: ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Total Customers with Outstanding Balance', customers.filter((c) => (c.due_balance || 0) > 0).length],
    ['Total Outstanding Credit Balance (₹)', totalOutstanding.toFixed(2)],
    [],
    header,
    ...customers.map((c) => {
      const due = c.due_balance || c.balance || 0;
      return [
        c.name || 'Customer',
        c.phone || '-',
        due,
        c.total_purchases || 0,
        c.credit_limit || 5000,
        c.last_payment_date || '-',
        due > 0 ? 'PENDING RECOVERY' : 'CLEAR',
      ];
    }),
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [{ range: "'Customer Dues Ledger'!A1", values: rows }],
    }),
  });

  await logSyncToFirestore({
    type: 'sheets_export',
    title,
    details: `Exported dues ledger with ₹${totalOutstanding.toFixed(2)} total outstanding credit.`,
    userEmail,
    status: 'SUCCESS',
    url: spreadsheetUrl,
  });

  return {
    spreadsheetId,
    spreadsheetUrl,
    title,
    createdAt: new Date().toISOString(),
  };
}
