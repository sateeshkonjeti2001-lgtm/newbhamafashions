import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  Coins,
  Smartphone,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ShoppingCart,
  PlusCircle,
  Receipt,
  CalendarCheck,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { UserRole } from '../types.ts';

interface DashboardViewProps {
  role: UserRole;
  setActiveTab: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ role, setActiveTab }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboard();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const isOwner = role === 'OWNER';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Store Dashboard</h2>
          <p className="text-xs text-[#6F6962]">
            Real-time physical store metrics for New Bhama Fashions (Chilakaluripet, AP)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-3 py-2 bg-white hover:bg-[#FAF8F4] text-[#1C1917] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border border-[#D4CDC2] shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#6F6962] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setActiveTab('pos')}
            className="px-3.5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <ShoppingCart className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>Start POS Billing</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-[#A34F4F] text-xs">
          {error}
        </div>
      )}

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-2 shadow-[0_2px_8px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-medium">Today's Sales</span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#3F6B50] border border-[#E3DED5]">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#1C1917] tracking-tight">
            ₹{data?.todaySales?.total?.toLocaleString('en-IN') || 0}
          </div>
          <div className="text-[11px] text-[#6F6962] flex items-center gap-1">
            <span>{data?.todaySales?.bills_count || 0} bills completed today</span>
          </div>
        </div>

        {/* Cash Collected Today */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-2 shadow-[0_2px_8px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-medium">Cash Collected (Sales)</span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5]">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#1C1917] tracking-tight">
            ₹{data?.todaySales?.cash_collected?.toLocaleString('en-IN') || 0}
          </div>
          <div className="text-[11px] text-[#6F6962]">
            Physical cash in drawer from today's sales
          </div>
        </div>

        {/* UPI Collected Today */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-2 shadow-[0_2px_8px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-medium">UPI Collected (Sales)</span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#526B7A] border border-[#E3DED5]">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#1C1917] tracking-tight">
            ₹{data?.todaySales?.upi_collected?.toLocaleString('en-IN') || 0}
          </div>
          <div className="text-[11px] text-[#6F6962]">
            Digital QR / UPI receipts today
          </div>
        </div>

        {/* Pending Customer Dues */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-2 shadow-[0_2px_8px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-medium">Pending Customer Credit</span>
            <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#A34F4F] border border-[#E3DED5]">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-[#A34F4F] tracking-tight">
            ₹{data?.pendingCustomerDues?.toLocaleString('en-IN') || 0}
          </div>
          <div className="text-[11px] text-[#6F6962] flex items-center justify-between">
            <span>To be collected</span>
            <button
              onClick={() => setActiveTab('dues')}
              className="text-[#A67C52] hover:text-[#8F6843] font-semibold hover:underline inline-flex items-center"
            >
              View ledger <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Owner-Specific Financial Cards */}
      {isOwner && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Estimated Cash Balance in Drawer */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-1 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
            <div className="text-xs text-[#6F6962] flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-[#3F6B50]" /> Current Cash Balance
            </div>
            <div className="text-xl font-bold text-[#1C1917]">
              ₹{data?.accounts?.cash?.toLocaleString('en-IN') || 0}
            </div>
            <p className="text-[11px] text-[#9A938B]">Net physical cash per recorded ledger</p>
          </div>

          {/* Today's Operating Expenses */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-1 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
            <div className="text-xs text-[#6F6962] flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-[#A67C52]" /> Today's Expenses
            </div>
            <div className="text-xl font-bold text-[#1C1917]">
              ₹{data?.todayExpenses?.toLocaleString('en-IN') || 0}
            </div>
            <p className="text-[11px] text-[#9A938B]">Shop tea, cleaning, electricity, etc.</p>
          </div>

          {/* Pending Supplier Dues */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-4 space-y-1 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
            <div className="text-xs text-[#6F6962] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[#A34F4F]" /> Supplier Liabilities
            </div>
            <div className="text-xl font-bold text-[#A34F4F]">
              ₹{data?.pendingSupplierDues?.toLocaleString('en-IN') || 0}
            </div>
            <p className="text-[11px] text-[#9A938B]">Unpaid purchase invoices</p>
          </div>
        </div>
      )}

      {/* Inventory Alerts & Quick Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stock Status Box */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-5 space-y-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1C1917] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#A67C52]" /> Stock Level Status
            </h3>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-[#FAF8F4] text-[#6F6962] border border-[#E3DED5]">
              Total {data?.stockCount?.total_products || 0} Products
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5] text-xs">
              <span className="text-[#1C1917] font-medium">Low Stock Items (Qty &le; 3)</span>
              <span className={`font-bold text-sm ${data?.stockCount?.low_stock > 0 ? 'text-[#A67C52]' : 'text-[#6F6962]'}`}>
                {data?.stockCount?.low_stock || 0}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5] text-xs">
              <span className="text-[#1C1917] font-medium">Out of Stock (Qty = 0)</span>
              <span className={`font-bold text-sm ${data?.stockCount?.out_of_stock > 0 ? 'text-[#A34F4F]' : 'text-[#6F6962]'}`}>
                {data?.stockCount?.out_of_stock || 0}
              </span>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('inventory')}
            className="w-full py-2.5 bg-white hover:bg-[#FAF8F4] text-[#1C1917] rounded-lg text-xs font-semibold border border-[#D4CDC2] shadow-sm transition"
          >
            Open Stock Ledger &amp; Inventory
          </button>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-2 bg-white border border-[#E3DED5] rounded-xl p-5 space-y-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
          <h3 className="text-sm font-semibold text-[#1C1917]">Quick Shop Operations</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => setActiveTab('pos')}
              className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#D4CDC2] rounded-xl text-left space-y-2 transition group shadow-sm hover:shadow"
            >
              <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#3F6B50] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] group-hover:border-[#171513] transition">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div className="font-semibold text-xs text-[#1C1917]">New POS Bill</div>
              <div className="text-[11px] text-[#6F6962]">Scan barcode or search</div>
            </button>

            <button
              onClick={() => setActiveTab('products')}
              className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#D4CDC2] rounded-xl text-left space-y-2 transition group shadow-sm hover:shadow"
            >
              <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#A67C52] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] group-hover:border-[#171513] transition">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div className="font-semibold text-xs text-[#1C1917]">Add Product</div>
              <div className="text-[11px] text-[#6F6962]">New garment / item</div>
            </button>

            {isOwner && (
              <button
                onClick={() => setActiveTab('money')}
                className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#D4CDC2] rounded-xl text-left space-y-2 transition group shadow-sm hover:shadow"
              >
                <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#A67C52] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] group-hover:border-[#171513] transition">
                  <Receipt className="w-5 h-5" />
                </div>
                <div className="font-semibold text-xs text-[#1C1917]">Record Expense</div>
                <div className="text-[11px] text-[#6F6962]">Tea, bills, supplies</div>
              </button>
            )}

            <button
              onClick={() => setActiveTab('closing')}
              className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#D4CDC2] rounded-xl text-left space-y-2 transition group shadow-sm hover:shadow"
            >
              <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#526B7A] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] group-hover:border-[#171513] transition">
                <CalendarCheck className="w-5 h-5" />
              </div>
              <div className="font-semibold text-xs text-[#1C1917]">Day Closing</div>
              <div className="text-[11px] text-[#6F6962]">Count cash &amp; reconcile</div>
            </button>
          </div>

          <div className="p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5] text-[11px] text-[#6F6962] flex items-center justify-between">
            <span>
              Store: <strong className="text-[#1C1917]">New Bhama Fashions</strong> &bull; Ladies fashion retail &bull; Chilakaluripet, AP
            </span>
            <span className="text-[#3F6B50] font-semibold">Offline Real-Time Mode</span>
          </div>
        </div>
      </div>
    </div>
  );
};
