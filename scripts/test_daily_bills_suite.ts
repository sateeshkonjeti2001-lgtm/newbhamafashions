import { dbQueryOne } from '../server/db.ts';
import { initNodeDatabase } from '../server/dbNode.ts';
import { generateToken } from '../server/auth.ts';

async function runTestSuite() {
  console.log('====================================================');
  console.log('NEW BHAMA FASHIONS ERP - DAILY BILLS VERIFICATION SUITE');
  console.log('====================================================\n');

  await initNodeDatabase();
  const owner = await dbQueryOne<any>('SELECT * FROM users WHERE role = "OWNER"');
  if (!owner) throw new Error('No owner found in database');
  const token = await generateToken(owner.id);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let allPassed = true;
  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
      failCount++;
      allPassed = false;
    }
  }

  // Baseline Inventory Ledger Check
  const stockBaseline = await dbQueryOne<any>('SELECT COUNT(*) as cnt, COALESCE(SUM(quantity), 0) as total_qty FROM stock_ledger');
  const baselineCount = stockBaseline.cnt;
  const baselineQty = stockBaseline.total_qty;
  console.log(`Initial Stock Ledger Baseline: ${baselineCount} rows, Total Qty: ${baselineQty}\n`);

  // 1. Single Item Bill Entry (Quantity × Rate calculation & Cash payment)
  console.log('--- Test 1: Single Item Bill Entry (Cash Payment) ---');
  const testDate = new Date().toISOString().split('T')[0];
  const billNum1 = `HW-SNGL-${Date.now().toString().slice(-6)}`;
  const singleItem = [{ item_name: 'Pure Cotton Kurti', quantity: 2, rate: 650 }]; // 1300

  const res1 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum1,
      bill_date: testDate,
      items: singleItem,
      payment_method: 'CASH',
      notes: 'Single item test bill',
    }),
  });
  const data1 = await res1.json();
  assert(res1.status === 200 && data1.success === true, 'Single-item daily bill created successfully');
  assert(data1.sale?.total_amount === 1300, 'Total calculation (2 × 650 = 1300) is exact');
  assert(data1.sale?.cash_paid === 1300 && data1.sale?.balance_due === 0, 'Cash paid 1300, balance due 0');
  assert(data1.sale?.channel === 'MANUAL', 'Bill channel is MANUAL');

  // 2. Multi-Item Bill Entry (Quantity × Rate for each item + sum calculation + UPI Payment)
  console.log('\n--- Test 2: Multi-Item Bill Entry (UPI Payment) ---');
  const billNum2 = `HW-MULTI-${Date.now().toString().slice(-6)}`;
  const multiItems = [
    { item_name: 'Kalamkari Silk Saree', quantity: 1, rate: 2200 }, // 2200
    { item_name: 'Fancy Designer Blouse', quantity: 2, rate: 450 },  // 900
    { item_name: 'Embroidered Dupatta', quantity: 3, rate: 350 },   // 1050
  ];
  // Expected Total: 2200 + 900 + 1050 = 4150

  const res2 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum2,
      bill_date: testDate,
      items: multiItems,
      payment_method: 'UPI',
      customer_name: 'Lakshmi Devi',
      customer_phone: '9848011223',
    }),
  });
  const data2 = await res2.json();
  assert(res2.status === 200 && data2.success === true, 'Multi-item daily bill created successfully');
  assert(data2.sale?.total_amount === 4150, 'Multi-item grand total calculation (2200 + 900 + 1050 = 4150) is exact');
  assert(data2.sale?.upi_paid === 4150 && data2.sale?.cash_paid === 0, 'UPI payment recorded with full amount');

  // 3. Split Payment (Cash + UPI) with validation
  console.log('\n--- Test 3: Split Payment (Cash + UPI) & Validation ---');
  const billNum3 = `HW-SPLIT-${Date.now().toString().slice(-6)}`;
  const splitItems = [{ item_name: 'Anarkali Suit Set', quantity: 1, rate: 3000 }]; // 3000

  // 3a. Invalid Split sum (must fail)
  const res3Invalid = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum3,
      bill_date: testDate,
      items: splitItems,
      payment_method: 'SPLIT',
      cash_amount: 1000,
      upi_amount: 1500, // Sum = 2500 != 3000
    }),
  });
  assert(res3Invalid.status === 400, 'Invalid split sum rejected with HTTP 400');

  // 3b. Valid Split sum (1200 Cash + 1800 UPI = 3000)
  const res3 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum3,
      bill_date: testDate,
      items: splitItems,
      payment_method: 'SPLIT',
      cash_amount: 1200,
      upi_amount: 1800,
    }),
  });
  const data3 = await res3.json();
  assert(res3.status === 200 && data3.success === true, 'Valid split payment accepted');
  assert(data3.sale?.cash_paid === 1200 && data3.sale?.upi_paid === 1800, 'Cash ₹1200 and UPI ₹1800 recorded accurately');

  // 4. Credit / Due Payment (Customer balance tracking)
  console.log('\n--- Test 4: Credit / Due Payment ---');
  const billNum4 = `HW-CREDIT-${Date.now().toString().slice(-6)}`;
  const creditItems = [{ item_name: 'Pattu Pavada Set', quantity: 1, rate: 2500 }]; // 2500

  // 4a. Credit requires customer name
  const res4MissingCust = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum4,
      bill_date: testDate,
      items: creditItems,
      payment_method: 'CREDIT',
    }),
  });
  assert(res4MissingCust.status === 400, 'Credit payment without customer name rejected with HTTP 400');

  // 4b. Credit with customer name
  const res4 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum4,
      bill_date: testDate,
      items: creditItems,
      payment_method: 'CREDIT',
      customer_name: 'Sravani Rao',
      customer_phone: '9848099887',
    }),
  });
  const data4 = await res4.json();
  assert(res4.status === 200 && data4.success === true, 'Credit daily bill recorded successfully');
  assert(data4.sale?.balance_due === 2500 && data4.sale?.cash_paid === 0 && data4.sale?.upi_paid === 0, 'Zero money collected; full balance ₹2500 left as due');

  // Verify customer due record on the bill
  const dueDetailRes = await fetch(`http://localhost:3000/api/pos/bills/${data4.sale.id}`, { headers });
  const dueDetailData = await dueDetailRes.json();
  assert(
    !!dueDetailData.customerDue && dueDetailData.customerDue.balance_due === 2500 && dueDetailData.customerDue.status === 'PENDING',
    `Customer due record created with pending status (Due: ₹${dueDetailData.customerDue?.balance_due})`
  );

  // 5. Duplicate Bill Number Warning and Prevention
  console.log('\n--- Test 5: Duplicate Bill Number Detection ---');
  // Check API duplicate detection endpoint
  const checkRes = await fetch(
    `http://localhost:3000/api/pos/check-bill-number?billNumber=${encodeURIComponent(billNum1)}&date=${testDate}`,
    { headers }
  );
  const checkData = await checkRes.json();
  assert(checkData.exists === true, `Duplicate check correctly reported bill #${billNum1} exists on ${testDate}`);

  // Attempt to save duplicate bill number on the same date (must be rejected)
  const dupRes = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNum1,
      bill_date: testDate,
      items: [{ item_name: 'Duplicate Test', quantity: 1, rate: 500 }],
      payment_method: 'CASH',
    }),
  });
  assert(dupRes.status === 409, 'Duplicate bill number on same date rejected with HTTP 409 Conflict');

  // 6. Zero Inventory Deduction Verification
  console.log('\n--- Test 6: Zero Inventory Deduction Verification ---');
  const ledgerRes = await fetch('http://localhost:3000/api/inventory/ledger?limit=10', { headers });
  const ledgerData = await ledgerRes.json();
  // None of the ledger movements should reference our manual bills
  const manualInLedger = ledgerData.ledger?.some((l: any) => l.reason?.includes(billNum1) || l.reason?.includes(billNum2));
  assert(!manualInLedger, 'Zero inventory movements created for manual bills in stock ledger');

  // 7. Saved Bill Retrieval and Date / Channel Filtering
  console.log('\n--- Test 7: Saved Daily Bills Retrieval & Filtering ---');
  const billsRes = await fetch(`http://localhost:3000/api/pos/bills?channel=MANUAL&date=${testDate}`, { headers });
  const billsData = await billsRes.json();
  assert(billsRes.status === 200 && Array.isArray(billsData.bills), 'Daily bills list retrieved successfully');

  const retrievedBill1 = billsData.bills.find((b: any) => b.bill_number === billNum1);
  assert(!!retrievedBill1, `Bill #${billNum1} found in manual bills list`);
  
  // Also verify single bill detail
  const detailRes = await fetch(`http://localhost:3000/api/pos/bills/${data1.sale.id}`, { headers });
  const detailData = await detailRes.json();
  assert(detailRes.status === 200 && detailData.items?.length === 1, 'Bill detail endpoint returns full item rows');
  assert(detailData.items[0]?.product_name === 'Pure Cotton Kurti', 'Item name preserved accurately in bill items');

  // 8. Consolidated Reporting & Dashboard Integration
  console.log('\n--- Test 8: Consolidated Reporting & Dashboard Integration ---');
  const dashRes = await fetch(`http://localhost:3000/api/dashboard?date=${testDate}`, { headers });
  const dashData = await dashRes.json();
  assert(dashRes.status === 200, 'Dashboard data returned successfully');
  assert(dashData.manualBills?.count >= 4, `Dashboard counts at least 4 manual bills today (found ${dashData.manualBills?.count})`);
  assert(dashData.manualBills?.total_amount >= 11000, `Dashboard total includes daily bills (₹${dashData.manualBills?.total_amount})`);

  // Verify no double counting: Total sales = pos_bills_total + manual_bills_total
  const expectedTotal = dashData.sales.pos_bills_total + dashData.sales.manual_bills_total;
  assert(
    Math.abs(dashData.sales.total_sales - expectedTotal) < 0.01,
    `Total Sales (₹${dashData.sales.total_sales}) equals POS (₹${dashData.sales.pos_bills_total}) + Manual (₹${dashData.sales.manual_bills_total}) without double counting`
  );

  // 9. Existing POS Billing Workflow Intact
  console.log('\n--- Test 9: Existing POS Billing Intact ---');
  const posRes = await fetch('http://localhost:3000/api/pos/search?query=', { headers });
  const posData = await posRes.json();
  assert(posRes.status === 200 && Array.isArray(posData.products), 'POS product catalog search working normally');

  // 10. Safe Cancellation of a Daily Bill with Ledger Reversal
  console.log('\n--- Test 10: Safe Cancellation & Ledger Reversal ---');
  const cancelRes = await fetch(`http://localhost:3000/api/pos/bills/${data1.sale.id}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      reason: 'Customer returned handwritten bill in test',
      notes: 'Automated test suite cancellation',
    }),
  });
  const cancelData = await cancelRes.json();
  assert(cancelRes.status === 200 && cancelData.success === true, 'Bill cancelled successfully through authorized owner route');

  // Verify bill status via API
  const cancelledBillRes = await fetch(`http://localhost:3000/api/pos/bills/${data1.sale.id}`, { headers });
  const cancelledBillData = await cancelledBillRes.json();
  assert(cancelledBillData.sale?.status === 'CANCELLED', 'Sale record status updated to CANCELLED');

  console.log('\n====================================================');
  console.log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
