import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  BarChart3,
  Calendar,
  Wallet,
  Smartphone,
  Coins,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Info,
} from 'lucide-react';
import { api } from '../services/api.ts';

interface SalesTrendsChartProps {
  startDate: string;
  endDate: string;
  isOwner?: boolean;
}

type Granularity = 'daily' | 'weekly' | 'monthly';
type MetricView = 'revenue' | 'payment_modes' | 'volume' | 'aov';

// Custom tooltip renderer for Recharts
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-[#1C1917] text-white p-3 rounded-xl shadow-lg border border-[#3E3834] text-xs space-y-1.5 min-w-[180px]">
      <p className="font-bold text-[#E3DED5] border-b border-[#3E3834] pb-1">{label}</p>
      {payload.map((entry: any, index: number) => {
        const isRupee =
          entry.name.includes('Revenue') ||
          entry.name.includes('Sales') ||
          entry.name.includes('AOV') ||
          entry.name.includes('Cash') ||
          entry.name.includes('UPI') ||
          entry.name.includes('Credit');

        const formattedVal = isRupee
          ? `₹${Number(entry.value || 0).toLocaleString('en-IN')}`
          : Number(entry.value || 0).toLocaleString('en-IN');

        return (
          <div key={`tooltip-${index}`} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#A8A29E]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span>{entry.name}:</span>
            </span>
            <span className="font-mono font-semibold text-white tabular-nums">{formattedVal}</span>
          </div>
        );
      })}
    </div>
  );
};

export const SalesTrendsChart: React.FC<SalesTrendsChartProps> = ({
  startDate,
  endDate,
  isOwner = true,
}) => {
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [metricView, setMetricView] = useState<MetricView>('revenue');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const fetchTrends = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSalesTrends({ startDate, endDate });
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sales performance data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrends();
  }, [startDate, endDate]);

  const chartData = data ? data[granularity] || [] : [];
  const summary = data?.summary || {
    totalRevenue: 0,
    netRevenue: 0,
    totalBills: 0,
    avgOrderValue: 0,
    cashTotal: 0,
    upiTotal: 0,
    creditTotal: 0,
    cashPercent: 0,
    upiPercent: 0,
    creditPercent: 0,
    peakDay: null,
  };
  const insights = data?.insights || [];
  const topProducts = data?.topProducts || [];

  return (
    <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
      {/* Top Header & Interactive Switchers */}
      <div className="p-5 sm:p-6 border-b border-[#E3DED5] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5] rounded-xl">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-[#1C1917] tracking-tight">
                Sales Trends &amp; Revenue Analytics
              </h3>
            </div>
            <p className="text-xs text-[#6F6962] mt-1">
              Visual turnover patterns, payment mode splits, and ticket size growth for New Bhama Fashions
            </p>
          </div>

          {/* Granularity Switcher (Daily / Weekly / Monthly) */}
          <div className="flex items-center gap-1 bg-[#FAF8F4] border border-[#E3DED5] p-1 rounded-xl shrink-0 self-start md:self-auto">
            <button
              onClick={() => setGranularity('daily')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                granularity === 'daily'
                  ? 'bg-white text-[#1C1917] shadow-xs border border-[#D4CDC2]'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setGranularity('weekly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                granularity === 'weekly'
                  ? 'bg-white text-[#1C1917] shadow-xs border border-[#D4CDC2]'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setGranularity('monthly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                granularity === 'monthly'
                  ? 'bg-white text-[#1C1917] shadow-xs border border-[#D4CDC2]'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={fetchTrends}
              disabled={loading}
              title="Refresh Sales Data"
              className="p-1.5 text-[#6F6962] hover:text-[#1C1917] rounded-lg transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#A67C52]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Metric Selector Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-[#6F6962] font-semibold text-[11px] uppercase tracking-wider shrink-0 mr-1">
            Metric:
          </span>
          <button
            onClick={() => setMetricView('revenue')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
              metricView === 'revenue'
                ? 'bg-[#1C1917] text-white shadow-xs'
                : 'bg-[#FAF8F4] text-[#6F6962] hover:bg-[#F0EDE6] border border-[#E3DED5]'
            }`}
          >
            Gross Revenue (₹)
          </button>
          <button
            onClick={() => setMetricView('payment_modes')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
              metricView === 'payment_modes'
                ? 'bg-[#1C1917] text-white shadow-xs'
                : 'bg-[#FAF8F4] text-[#6F6962] hover:bg-[#F0EDE6] border border-[#E3DED5]'
            }`}
          >
            Cash vs. UPI vs. Credit
          </button>
          <button
            onClick={() => setMetricView('volume')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
              metricView === 'volume'
                ? 'bg-[#1C1917] text-white shadow-xs'
                : 'bg-[#FAF8F4] text-[#6F6962] hover:bg-[#F0EDE6] border border-[#E3DED5]'
            }`}
          >
            Bills Count (Volume)
          </button>
          <button
            onClick={() => setMetricView('aov')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap shrink-0 ${
              metricView === 'aov'
                ? 'bg-[#1C1917] text-white shadow-xs'
                : 'bg-[#FAF8F4] text-[#6F6962] hover:bg-[#F0EDE6] border border-[#E3DED5]'
            }`}
          >
            Average Order Value (₹)
          </button>
        </div>
      </div>

      {/* KPI Stat Cards Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 border-b border-[#E3DED5] divide-y lg:divide-y-0 lg:divide-x divide-[#E3DED5] bg-[#FAF8F4]/50">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-[#6F6962]">
            <span>Total Sales Revenue</span>
            <Wallet className="w-3.5 h-3.5 text-[#A67C52]" />
          </div>
          <p className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[#1C1917] tabular-nums">
            ₹{summary.totalRevenue.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#3F6B50] font-semibold mt-0.5">
            Net: ₹{summary.netRevenue.toLocaleString('en-IN')}
          </p>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-[#6F6962]">
            <span>Transactions (Bills)</span>
            <ShoppingBag className="w-3.5 h-3.5 text-[#3F6B50]" />
          </div>
          <p className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[#1C1917] tabular-nums">
            {summary.totalBills}
          </p>
          <p className="text-[11px] text-[#6F6962] mt-0.5">Completed bills</p>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-[#6F6962]">
            <span>Average Order Value</span>
            <BarChart3 className="w-3.5 h-3.5 text-[#A67C52]" />
          </div>
          <p className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[#1C1917] tabular-nums">
            ₹{summary.avgOrderValue.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#6F6962] mt-0.5">Per customer ticket</p>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-[#6F6962]">
            <span>UPI Digital Payments</span>
            <Smartphone className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <p className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[#1C1917] tabular-nums">
            ₹{summary.upiTotal.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-blue-700 font-semibold mt-0.5">
            {summary.upiPercent}% of total turnover
          </p>
        </div>

        <div className="p-4 sm:p-5 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-xs text-[#6F6962]">
            <span>Cash Tender</span>
            <Coins className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <p className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[#1C1917] tabular-nums">
            ₹{summary.cashTotal.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
            {summary.cashPercent}% physical cash
          </p>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="p-5 sm:p-6 space-y-6">
        {loading ? (
          <div className="h-72 flex flex-col items-center justify-center text-[#6F6962] space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-[#A67C52]" />
            <p className="text-xs font-semibold">Aggregating sales trends...</p>
          </div>
        ) : error ? (
          <div className="h-72 flex flex-col items-center justify-center text-red-600 p-4 text-center space-y-2">
            <p className="text-sm font-bold">Failed to load sales visualization</p>
            <p className="text-xs text-[#6F6962]">{error}</p>
            <button
              onClick={fetchTrends}
              className="px-4 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs font-bold text-[#1C1917] hover:bg-[#F0EDE6]"
            >
              Retry
            </button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-center p-6 bg-[#FAF8F4] border border-dashed border-[#D4CDC2] rounded-xl space-y-3">
            <Calendar className="w-8 h-8 text-[#A67C52]" />
            <div>
              <p className="text-sm font-bold text-[#1C1917]">No sales recorded in this period</p>
              <p className="text-xs text-[#6F6962] mt-0.5 max-w-sm">
                Sales transactions and daily bills entered for this date range will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {metricView === 'revenue' ? (
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#A67C52" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#A67C52" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3F6B50" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3F6B50" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E3DED5" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#E3DED5' }}
                    />
                    <YAxis
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ paddingBottom: 12, fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Gross Revenue (₹)"
                      stroke="#A67C52"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#revenueGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="netRevenue"
                      name="Net Revenue (₹)"
                      stroke="#3F6B50"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      fillOpacity={1}
                      fill="url(#netGrad)"
                    />
                  </AreaChart>
                ) : metricView === 'payment_modes' ? (
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E3DED5" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#E3DED5' }}
                    />
                    <YAxis
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="square"
                      wrapperStyle={{ paddingBottom: 12, fontSize: 12 }}
                    />
                    <Bar
                      dataKey="upiSales"
                      name="UPI Sales (₹)"
                      stackId="a"
                      fill="#2563EB"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="cashSales"
                      name="Cash Sales (₹)"
                      stackId="a"
                      fill="#16A34A"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="creditSales"
                      name="Store Credit (₹)"
                      stackId="a"
                      fill="#D97706"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                ) : metricView === 'volume' ? (
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E3DED5" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#E3DED5' }}
                    />
                    <YAxis
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ paddingBottom: 12, fontSize: 12 }}
                    />
                    <Bar
                      dataKey="billsCount"
                      name="Bills Count (Transactions)"
                      fill="#A67C52"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="aovGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3F6B50" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#3F6B50" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E3DED5" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#E3DED5' }}
                    />
                    <YAxis
                      tick={{ fill: '#6F6962', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${v}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ paddingBottom: 12, fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="avgOrderValue"
                      name="Average Order Value (₹)"
                      stroke="#3F6B50"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#aovGrad)"
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Business Performance Insights & Top Categories/Products */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-4 border-t border-[#E3DED5]">
          {/* Executive Insights for the Owner */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#A67C52]" />
              <h4 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
                Store Owner Performance Insights
              </h4>
            </div>

            <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-4 space-y-2.5">
              {insights.map((insight: string, idx: number) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs text-[#1C1917] leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#A67C52] mt-1.5 shrink-0" />
                  <span>{insight}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Selling Products in Period */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#3F6B50]" />
                <h4 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
                  Top Apparel Revenue
                </h4>
              </div>
              <span className="text-[11px] text-[#6F6962]">Units Sold</span>
            </div>

            <div className="space-y-2">
              {topProducts.length === 0 ? (
                <div className="p-3 text-center text-xs text-[#6F6962] bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                  No itemized breakdown available
                </div>
              ) : (
                topProducts.map((p: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl flex items-center justify-between text-xs"
                  >
                    <div className="truncate pr-2">
                      <p className="font-semibold text-[#1C1917] truncate">{p.product_name}</p>
                      <p className="text-[11px] text-[#6F6962] font-mono tabular-nums">
                        ₹{(p.total_revenue || 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-[#3F6B50] px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-md shrink-0">
                      {p.total_qty} pcs
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
