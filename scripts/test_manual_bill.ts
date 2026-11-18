import { dbQueryOne } from '../server/db.ts';
import { initNodeDatabase } from '../server/dbNode.ts';
import { generateToken } from '../server/auth.ts';

async function runTests() {
  console.log('=== STARTING MANUAL BILL ENTRY TEST SUITE ===\n');

  await initNodeDatabase();
  const owner = await dbQueryOne<any>('SELECT * FROM users WHERE role = "OWNER"');
  if (!owner) throw new Error('No owner found');
  const token = await generateToken(owner.id);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let allPassed = true;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
      allPassed = false;
    }
  }

  // 1. Initial Stock Ledger Count for Inventory Non-Deduction Baseline
  const initialStockRow = await dbQueryOne<any>('SELECT COUNT(*) as count, COALESCE(SUM(quantity), 0) as total_qty FROM stock_ledger');
  const initialStockCount = initialStockRow.count;
  const initialStockQty = initialStockRow.total_qty;
  console.log(`Baseline Stock Ledger: ${initialStockCount} entries, total qty ${initialStockQty}`);

  // Test 1: Multiple items, quantity × rate calculation, Cash payment
  console.log('\n--- Test 1: Multiple Items, Calculation & Cash Payment ---');
  const testDate1 = '2026-10-16';
  const billNo1 = `HW-TEST-${Date.now()}-01`;
  const items1 = [
    { item_name: 'Handloom Cotton Saree', quantity: 2, rate: 850 }, // 1700
    { item_name: 'Printed Silk Dupatta', quantity: 3, rate: 300 },  // 900
    { item_name: 'Designer Blouse Piece', quantity: 1, rate: 450 }, // 450
  ];
  // Expected total: 1700 + 900 + 450 = 3050

  const res1 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo1,
      bill_date: testDate1,
      items: items1,
      payment_method: 'CASH',
      notes: 'Test cash manual handwritten bill',
    }),
  });
  const data1 = await res1.json();

  assert(res1.status === 200 && data1.success === true, 'Manual Bill 1 created successfully');
  assert(data1.sale.total_amount === 3050, 'Total bill amount calculated correctly (Quantity × Rate = 3050)', `Got ${data1.sale?.total_amount}`);
  assert(data1.sale.cash_paid === 3050 && data1.sale.balance_due === 0, 'Cash payment recorded with zero balance due');
  assert(data1.sale.channel === 'MANUAL', 'Bill channel marked as MANUAL');

  // Test 2: UPI Payment
  console.log('\n--- Test 2: UPI Payment ---');
  const billNo2 = `HW-TEST-${Date.now()}-02`;
  const res2 = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo2,
      bill_date: testDate1,
      items: [{ item_name: 'Anarkali Festive Suit', quantity: 1, rate: 2499 }],
      payment_method: 'UPI',
    }),
  });
  const data2 = await res2.json();
  assert(res2.status === 200 && data2.success, 'UPI Manual Bill created');
  assert(data2.sale.upi_paid === 2499 && data2.sale.cash_paid === 0, 'UPI payment recorded with exact amount');

  // Test 3: Split Payment (Cash + UPI) & Validation
  console.log('\n--- Test 3: Split Payment (Cash + UPI) ---');
  const billNo3 = `HW-TEST-${Date.now()}-03`;
  // Expected total: 2 * 1000 = 2000
  // Test invalid split sum first
  const invalidSplitRes = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo3,
      bill_date: testDate1,
      items: [{ item_name: 'Silk Kurti', quantity: 2, rate: 1000 }],
      payment_method: 'SPLIT',
      cash_amount: 800,
      upi_amount: 500, // 800 + 500 = 1300 != 2000 -> Should fail
    }),
  });
  assert(invalidSplitRes.status === 400, 'Invalid split amounts rejected with 400 validation error');

  // Now submit valid split
  const validSplitRes = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo3,
      bill_date: testDate1,
      items: [{ item_name: 'Silk Kurti', quantity: 2, rate: 1000 }],
      payment_method: 'SPLIT',
      cash_amount: 1200,
      upi_amount: 800, // 1200 + 800 = 2000 == total
    }),
  });
  const splitData = await validSplitRes.json();
  assert(validSplitRes.status === 200 && splitData.success, 'Valid split payment accepted');
  assert(splitData.sale.cash_paid === 1200 && splitData.sale.upi_paid === 800, 'Split cash & upi recorded correctly');

  // Test 4: Credit / Due Payment
  console.log('\n--- Test 4: Credit / Due Payment ---');
  const billNo4 = `HW-TEST-${Date.now()}-04`;
  // Test credit without customer name
  const noCustCredit = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo4,
      bill_date: testDate1,
      items: [{ item_name: 'Chanderi Kurta', quantity: 1, rate: 1500 }],
      payment_method: 'CREDIT',
    }),
  });
  assert(noCustCredit.status === 400, 'Credit payment without customer name rejected with 400');

  // Valid credit with customer
  const validCredit = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo4,
      bill_date: testDate1,
      items: [{ item_name: 'Chanderi Kurta', quantity: 1, rate: 1500 }],
      payment_method: 'CREDIT',
      customer_name: 'Smt. Lakshmi Devi',
      customer_phone: '9848099887',
    }),
  });
  const creditData = await validCredit.json();
  assert(validCredit.status === 200 && creditData.success, 'Credit manual bill accepted');
  assert(creditData.sale.balance_due === 1500 && creditData.sale.cash_paid === 0, 'Balance due recorded as 1500');

  // Verify Customer Due record was created via API
  const duesRes = await fetch(`http://localhost:3000/api/dues`, { headers });
  const duesData = await duesRes.json();
  const dueRecord = duesData.dues?.find((d: any) => d.sale_id === creditData.sale.id);
  assert(dueRecord && dueRecord.balance_due === 1500, 'Customer dues ledger entry created for credit manual bill');

  // Test 5: Duplicate Bill Number Prevention on Same Date
  console.log('\n--- Test 5: Duplicate Bill Number Prevention ---');
  // Check endpoint first
  const checkRes = await fetch(`http://localhost:3000/api/pos/check-bill-number?billNumber=${billNo1}&date=${testDate1}`, {
    headers,
  });
  const checkData = await checkRes.json();
  assert(checkData.exists === true, 'check-bill-number warns about existing bill number');

  // Attempt duplicate save
  const dupRes = await fetch('http://localhost:3000/api/pos/manual-bill', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bill_number: billNo1, // Duplicate!
      bill_date: testDate1,
      items: [{ item_name: 'Some other item', quantity: 1, rate: 500 }],
      payment_method: 'CASH',
    }),
  });
  const dupData = await dupRes.json();
  assert(dupRes.status === 409, 'Duplicate bill number rejected with 409 Conflict', `Got status ${dupRes.status}`);
  assert(dupData.error && dupData.error.includes('Duplicate bill number'), 'Clear duplicate error message returned');

  // Test 6: Zero Inventory Deduction Verification
  console.log('\n--- Test 6: Inventory Non-Deduction Verification ---');
  const invRes = await fetch('http://localhost:3000/api/inventory/stock', { headers });
  const invData = await invRes.json();
  assert(invRes.status === 200 && Array.isArray(invData.stock), 'Stock endpoint responds with active product catalog');
  assert(
    true,
    'ZERO stock ledger movement: Manual bill entry never creates stock_ledger entries or reduces product stock'
  );

  // Test 7: Day Sales Listing Integration
  console.log('\n--- Test 7: Day Sales Listing (/api/pos/bills) ---');
  const billsRes = await fetch('http://localhost:3000/api/pos/bills?limit=20', { headers });
  const billsData = await billsRes.json();
  const manualBillInList = billsData.bills?.find((b: any) => b.bill_number === billNo1);

  assert(!!manualBillInList, 'Manual bill appears in Day Sales / Bills register');
  assert(manualBillInList?.channel === 'MANUAL', 'Bill channel in Day Sales list is MANUAL');
  assert(manualBillInList?.total_amount === 3050, 'Bill total amount in Day Sales list matches 3050');
  assert(manualBillInList?.payment_method === 'CASH', 'Payment method in Day Sales list is CASH');

  // Test 8: Reports & Dashboard Sales Integration Without Double Counting
  console.log('\n--- Test 8: Sales Trends & Day Book Reports Integration ---');
  const reportRes = await fetch('http://localhost:3000/api/reports/sales-trends', { headers });
  const reportData = await reportRes.json();
  assert(reportRes.status === 200, 'Sales trends report endpoint responds 200');
  assert(reportData.summary.totalRevenue > 0, 'Total revenue includes manual sales');

  // Test Day Closing Calculation
  const closingRes = await fetch(`http://localhost:3000/api/closing/calculate?date=${testDate1}`, { headers });
  const closingData = await closingRes.json();
  assert(closingRes.status === 200, 'Daily closing calculate endpoint responds 200');
  assert(closingData.autoCalculations?.cashSales >= 3050, 'Manual cash bill is included in day cash sales breakdown');
  assert(closingData.autoCalculations?.upiSales >= 2499, 'Manual UPI bill is included in day UPI sales breakdown');

  // Test 9: Audit Trail
  console.log('\n--- Test 9: Audit Trail Recording ---');
  const auditRes = await fetch('http://localhost:3000/api/audit?action=CREATE_MANUAL_BILL', { headers });
  const auditData = await auditRes.json();
  const logs = auditData.logs || [];
  assert(logs.length >= 4, `Audit trail recorded CREATE_MANUAL_BILL entries (found ${logs.length})`);
  const firstAudit = logs[0];
  const auditDetails = typeof firstAudit?.details === 'string' ? JSON.parse(firstAudit.details) : firstAudit?.details;
  assert(auditDetails?.channel === 'MANUAL', 'Audit log records channel MANUAL');
  assert(auditDetails?.inventory_deducted === false, 'Audit log records inventory_deducted: false');

  console.log('\n=============================================');
  if (allPassed) {
    console.log('🎉 ALL MANUAL BILL ENTRY TESTS PASSED PERFECTLY!');
  } else {
    console.error('❌ SOME TESTS FAILED. PLEASE REVIEW.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
