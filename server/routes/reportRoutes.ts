import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, getDb, saveDb } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';

const router = Router();
router.use(authMiddleware);

// Helper to format ISO date to readable label e.g. '15 Oct'
function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// Helper to format month key e.g. '2026-10' to 'Oct 2026'
function formatMonthLabel(monthKey: string): string {
  try {
    const [year, month] = monthKey.split('-');
    const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  } catch {
    return monthKey;
  }
}

// GET /api/reports/sales-trends
router.get('/sales-trends', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';

    // Fetch all completed sales
    let salesQuery = `
      SELECT 
        s.id,
        s.bill_number,
        s.customer_name,
        s.subtotal,
        s.festival_discount,
        s.special_discount,
        s.discount_amount,
        s.total_amount,
        s.cash_paid,
        s.upi_paid,
        s.balance_due,
        s.payment_method,
        s.created_at,
        DATE(s.created_at) as sale_date,
        strftime('%Y-%m', s.created_at) as sale_month,
        strftime('%Y-W%W', s.created_at) as sale_week
      FROM sales s
      WHERE (s.status IS NULL OR s.status = 'COMPLETED')
    `;

    const params: any[] = [];
    if (startDate && endDate) {
      salesQuery += ` AND DATE(s.created_at) >= ? AND DATE(s.created_at) <= ? `;
      params.push(startDate, endDate);
    } else if (startDate) {
      salesQuery += ` AND DATE(s.created_at) >= ? `;
      params.push(startDate);
    } else if (endDate) {
      salesQuery += ` AND DATE(s.created_at) <= ? `;
      params.push(endDate);
    }

    salesQuery += ` ORDER BY s.created_at ASC `;

    const sales = dbQueryAll<any>(salesQuery, params);

    // Fetch returns in range
    let returnsQuery = `
      SELECT 
        id, sale_id, refund_amount, refund_method, created_at,
        DATE(created_at) as return_date
      FROM sale_returns
      WHERE 1=1
    `;
    const returnParams: any[] = [];
    if (startDate && endDate) {
      returnsQuery += ` AND DATE(created_at) >= ? AND DATE(created_at) <= ? `;
      returnParams.push(startDate, endDate);
    }
    const returns = dbQueryAll<any>(returnsQuery, returnParams);

    const returnsByDate: Record<string, { count: number; totalRefund: number }> = {};
    returns.forEach((r) => {
      const d = r.return_date;
      if (!returnsByDate[d]) {
        returnsByDate[d] = { count: 0, totalRefund: 0 };
      }
      returnsByDate[d].count += 1;
      returnsByDate[d].totalRefund += r.refund_amount || 0;
    });

    // 1. Group by Daily
    const dailyMap: Record<string, any> = {};

    sales.forEach((s) => {
      const d = s.sale_date;
      if (!dailyMap[d]) {
        dailyMap[d] = {
          date: d,
          label: formatShortDate(d),
          revenue: 0,
          billsCount: 0,
          cashSales: 0,
          upiSales: 0,
          creditSales: 0,
          discountAmount: 0,
          returnsCount: 0,
          refundAmount: 0,
        };
      }
      dailyMap[d].revenue += s.total_amount || 0;
      dailyMap[d].billsCount += 1;
      dailyMap[d].cashSales += s.cash_paid || 0;
      dailyMap[d].upiSales += s.upi_paid || 0;
      dailyMap[d].creditSales += s.balance_due || 0;
      dailyMap[d].discountAmount += s.discount_amount || 0;
    });

    // Attach returns
    Object.keys(returnsByDate).forEach((d) => {
      if (dailyMap[d]) {
        dailyMap[d].returnsCount = returnsByDate[d].count;
        dailyMap[d].refundAmount = returnsByDate[d].totalRefund;
      }
    });

    const dailyTrends = Object.values(dailyMap).map((item: any) => ({
      ...item,
      netRevenue: Math.max(0, item.revenue - (item.refundAmount || 0)),
      avgOrderValue: item.billsCount > 0 ? Math.round(item.revenue / item.billsCount) : 0,
    }));

    // 2. Group by Weekly
    const weeklyMap: Record<string, any> = {};
    sales.forEach((s) => {
      const w = s.sale_week;
      if (!weeklyMap[w]) {
        weeklyMap[w] = {
          weekKey: w,
          label: `Wk ${w.split('-W')[1] || w}`,
          fullLabel: `Week ${w.split('-W')[1] || w}`,
          minDate: s.sale_date,
          maxDate: s.sale_date,
          revenue: 0,
          billsCount: 0,
          cashSales: 0,
          upiSales: 0,
          creditSales: 0,
        };
      }
      weeklyMap[w].revenue += s.total_amount || 0;
      weeklyMap[w].billsCount += 1;
      weeklyMap[w].cashSales += s.cash_paid || 0;
      weeklyMap[w].upiSales += s.upi_paid || 0;
      weeklyMap[w].creditSales += s.balance_due || 0;
      if (s.sale_date < weeklyMap[w].minDate) weeklyMap[w].minDate = s.sale_date;
      if (s.sale_date > weeklyMap[w].maxDate) weeklyMap[w].maxDate = s.sale_date;
    });

    const weeklyTrends = Object.values(weeklyMap).map((w: any) => ({
      ...w,
      label: `${w.fullLabel} (${formatShortDate(w.minDate)})`,
      avgOrderValue: w.billsCount > 0 ? Math.round(w.revenue / w.billsCount) : 0,
    }));

    // 3. Group by Monthly
    const monthlyMap: Record<string, any> = {};
    sales.forEach((s) => {
      const m = s.sale_month;
      if (!monthlyMap[m]) {
        monthlyMap[m] = {
          monthKey: m,
          label: formatMonthLabel(m),
          revenue: 0,
          billsCount: 0,
          cashSales: 0,
          upiSales: 0,
          creditSales: 0,
        };
      }
      monthlyMap[m].revenue += s.total_amount || 0;
      monthlyMap[m].billsCount += 1;
      monthlyMap[m].cashSales += s.cash_paid || 0;
      monthlyMap[m].upiSales += s.upi_paid || 0;
      monthlyMap[m].creditSales += s.balance_due || 0;
    });

    const monthlyTrends = Object.values(monthlyMap).map((m: any) => ({
      ...m,
      avgOrderValue: m.billsCount > 0 ? Math.round(m.revenue / m.billsCount) : 0,
    }));

    // 4. Overall Totals & Performance Metrics
    const totalRevenue = sales.reduce((acc, s) => acc + (s.total_amount || 0), 0);
    const totalRefunds = returns.reduce((acc, r) => acc + (r.refund_amount || 0), 0);
    const netRevenue = Math.max(0, totalRevenue - totalRefunds);
    const totalBills = sales.length;
    const avgOrderValue = totalBills > 0 ? Math.round(totalRevenue / totalBills) : 0;
    const cashTotal = sales.reduce((acc, s) => acc + (s.cash_paid || 0), 0);
    const upiTotal = sales.reduce((acc, s) => acc + (s.upi_paid || 0), 0);
    const creditTotal = sales.reduce((acc, s) => acc + (s.balance_due || 0), 0);

    const cashPercent = totalRevenue > 0 ? Math.round((cashTotal / totalRevenue) * 100) : 0;
    const upiPercent = totalRevenue > 0 ? Math.round((upiTotal / totalRevenue) * 100) : 0;
    const creditPercent = totalRevenue > 0 ? Math.round((creditTotal / totalRevenue) * 100) : 0;

    // Peak day
    let peakDay: any = null;
    dailyTrends.forEach((d) => {
      if (!peakDay || d.revenue > peakDay.revenue) {
        peakDay = { date: d.date, label: d.label, revenue: d.revenue, billsCount: d.billsCount };
      }
    });

    // Peak week
    let peakWeek: any = null;
    weeklyTrends.forEach((w) => {
      if (!peakWeek || w.revenue > peakWeek.revenue) {
        peakWeek = { weekKey: w.weekKey, label: w.label, revenue: w.revenue };
      }
    });

    // Peak month
    let peakMonth: any = null;
    monthlyTrends.forEach((m) => {
      if (!peakMonth || m.revenue > peakMonth.revenue) {
        peakMonth = { monthKey: m.monthKey, label: m.label, revenue: m.revenue };
      }
    });

    // Top Selling Products in period
    let topProductsQuery = `
      SELECT 
        si.product_name,
        SUM(si.quantity) as total_qty,
        SUM(si.total_price) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE (s.status IS NULL OR s.status = 'COMPLETED')
    `;
    const topProdParams: any[] = [];
    if (startDate && endDate) {
      topProductsQuery += ` AND DATE(s.created_at) >= ? AND DATE(s.created_at) <= ? `;
      topProdParams.push(startDate, endDate);
    }
    topProductsQuery += `
      GROUP BY si.product_name
      ORDER BY total_revenue DESC
      LIMIT 5
    `;
    const topProducts = dbQueryAll<any>(topProductsQuery, topProdParams);

    // Business Performance Insights for Owner
    const insights: string[] = [];

    if (totalBills > 0) {
      insights.push(
        `Total sales revenue reached ₹${totalRevenue.toLocaleString('en-IN')} across ${totalBills} completed transactions.`
      );
      if (upiPercent > 0 || cashPercent > 0) {
        if (upiPercent >= 50) {
          insights.push(
            `Digital payment adoption is dominant: UPI accounts for ${upiPercent}% (₹${upiTotal.toLocaleString('en-IN')}) of total collections vs ${cashPercent}% Cash.`
          );
        } else {
          insights.push(
            `Cash remains the primary tender at ${cashPercent}% (₹${cashTotal.toLocaleString('en-IN')}) with UPI representing ${upiPercent}% (₹${upiTotal.toLocaleString('en-IN')}).`
          );
        }
      }
      insights.push(
        `Average basket size (AOV) is ₹${avgOrderValue.toLocaleString('en-IN')} per customer checkout.`
      );
      if (peakDay) {
        insights.push(
          `Highest sales day was ${peakDay.label} generating ₹${peakDay.revenue.toLocaleString('en-IN')} with ${peakDay.billsCount} bills.`
        );
      }
      if (topProducts.length > 0) {
        insights.push(
          `Top-grossing apparel: "${topProducts[0].product_name}" generated ₹${(topProducts[0].total_revenue || 0).toLocaleString('en-IN')} (${topProducts[0].total_qty} units sold).`
        );
      }
      if (creditTotal > 0) {
        insights.push(
          `Store customer credit accounts for ${creditPercent}% (₹${creditTotal.toLocaleString('en-IN')}) of bill value; monitor customer dues ledger for timely recovery.`
        );
      }
    } else {
      insights.push('No sales recorded for the selected date range yet.');
    }

    res.json({
      success: true,
      hasRealData: sales.length > 0,
      summary: {
        totalRevenue,
        netRevenue,
        totalRefunds,
        totalBills,
        avgOrderValue,
        cashTotal,
        upiTotal,
        creditTotal,
        cashPercent,
        upiPercent,
        creditPercent,
        peakDay,
        peakWeek,
        peakMonth,
      },
      daily: dailyTrends,
      weekly: weeklyTrends,
      monthly: monthlyTrends,
      topProducts,
      insights,
    });
  } catch (err: any) {
    console.error('Error in sales-trends:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate sales trends' });
  }
});

// POST /api/reports/seed-sales-history
// Creates realistic, multi-week boutique retail sales records for September-October 2026
// strictly without deleting or modifying any existing sales or records.
router.post('/seed-sales-history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await getDb();

    // Check existing products to link
    const products = dbQueryAll<any>('SELECT id, name, selling_price, mrp FROM products WHERE is_active = 1');
    if (products.length === 0) {
      return res.status(400).json({ error: 'No active products found to associate sales with.' });
    }

    // Authentic boutique ethnic wear items
    const sampleItems = [
      { name: 'Anarkali Suit Set', price: 1999, mrp: 2499, prodId: products[0].id },
      { name: 'Banarasi Silk Saree', price: 2899, mrp: 3499, prodId: products[0].id },
      { name: 'Embroidered Chanderi Kurti', price: 1299, mrp: 1599, prodId: products[1]?.id || products[0].id },
      { name: 'Cotton Printed Palazzo Set', price: 999, mrp: 1299, prodId: products[1]?.id || products[0].id },
      { name: 'Bridal Dupatta & Lehenga Kurta', price: 3499, mrp: 4299, prodId: products[0].id },
      { name: 'Georgette Festive Sharara', price: 2199, mrp: 2699, prodId: products[0].id },
    ];

    // Seed historical dates from Sep 1, 2026 to Oct 14, 2026
    const baseDate = new Date('2026-09-01T11:00:00.000Z');
    let insertedCount = 0;

    for (let dayOffset = 0; dayOffset < 44; dayOffset++) {
      const curDate = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const isWeekend = curDate.getDay() === 0 || curDate.getDay() === 6;
      // Weekends have 2-3 sales, weekdays 1-2 sales
      const salesOnDay = isWeekend ? 2 + (dayOffset % 2) : 1 + (dayOffset % 3 === 0 ? 1 : 0);

      for (let sIdx = 0; sIdx < salesOnDay; sIdx++) {
        const item = sampleItems[(dayOffset + sIdx) % sampleItems.length];
        const qty = 1 + (dayOffset % 5 === 0 ? 1 : 0);
        const subtotal = item.price * qty;
        const discount = dayOffset % 4 === 0 ? 100 : 0;
        const total = subtotal - discount;

        // Realistic payment split: 60% UPI, 35% Cash, 5% Split/Credit
        let payMethod = 'UPI';
        let cashPaid = 0;
        let upiPaid = total;
        let balDue = 0;

        if ((dayOffset + sIdx) % 3 === 0) {
          payMethod = 'CASH';
          cashPaid = total;
          upiPaid = 0;
        } else if ((dayOffset + sIdx) % 11 === 0) {
          payMethod = 'CREDIT';
          cashPaid = 0;
          upiPaid = 0;
          balDue = total;
        }

        const saleTime = new Date(curDate.getTime() + (12 + sIdx * 3) * 60 * 60 * 1000);
        const dateStr = saleTime.toISOString();
        const yyyymmdd = dateStr.slice(0, 10).replace(/-/g, '');
        const billNum = `NBF-${yyyymmdd}-${String(sIdx + 1).padStart(4, '0')}`;
        const saleId = `sale_hist_${Date.now()}_${dayOffset}_${sIdx}`;

        // Check if bill number exists
        const existing = dbQueryOne<any>('SELECT id FROM sales WHERE bill_number = ?', [billNum]);
        if (existing) continue;

        dbRun(
          `INSERT INTO sales (
            id, bill_number, customer_id, customer_name, customer_phone,
            total_mrp, subtotal, festival_discount, special_discount, discount_amount,
            discount_type, total_amount, amount_paid, balance_due, payment_status,
            payment_method, cash_paid, upi_paid, channel, notes, cashier_id,
            day_closed, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId,
            billNum,
            null,
            `Customer ${dayOffset + 1}`,
            `98480${String(10000 + dayOffset).slice(0, 5)}`,
            item.mrp * qty,
            subtotal,
            discount,
            0,
            discount,
            'AMOUNT',
            total,
            total - balDue,
            balDue,
            balDue > 0 ? 'UNPAID' : 'PAID',
            payMethod,
            cashPaid,
            upiPaid,
            'OFFLINE',
            'Boutique historical transaction record',
            req.user?.id || 'usr_system',
            1,
            'COMPLETED',
            dateStr,
          ]
        );

        // Insert sale item
        const saleItemId = `si_${Date.now()}_${dayOffset}_${sIdx}`;
        dbRun(
          `INSERT INTO sale_items (
            id, sale_id, product_id, product_name, quantity, mrp,
            unit_price, festival_discount, special_discount, discount,
            total_price, cogs, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleItemId,
            saleId,
            item.prodId,
            item.name,
            qty,
            item.mrp,
            item.price,
            discount,
            0,
            discount,
            total,
            Math.round(item.price * 0.6),
            dateStr,
          ]
        );

        insertedCount++;
      }
    }

    saveDb(true);

    res.json({
      success: true,
      count: insertedCount,
      message: `Successfully populated ${insertedCount} historical retail sales records across September & October 2026.`,
    });
  } catch (err: any) {
    console.error('Error seeding historical sales:', err);
    res.status(500).json({ error: err.message || 'Failed to seed historical sales' });
  }
});

export default router;
