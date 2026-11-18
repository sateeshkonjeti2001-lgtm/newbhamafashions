import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll } from '../db.ts';
import { authMiddleware, AuthenticatedRequest } from '../auth.ts';

const router = new Router();
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

    const sales = await dbQueryAll<any>(salesQuery, params);

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
    const returns = await dbQueryAll<any>(returnsQuery, returnParams);

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
    const topProducts = await dbQueryAll<any>(topProductsQuery, topProdParams);

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

export default router;
