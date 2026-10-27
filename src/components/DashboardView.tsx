import React, { useEffect, useState } from 'react';
import {
  FileText,
  TrendingUp,
  Coins,
  Smartphone,
  AlertTriangle,
  Receipt,
  CalendarCheck,
  RefreshCw,
  Wallet,
  Clock,
  ArrowUpRight,
  ShoppingCart,
  Calendar,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Users,
  ChevronRight,
  Info,
  X,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { UserRole } from '../types.ts';
import { ManualBillModal } from './ManualBillModal.tsx';
import { ReceiptModal } from './ReceiptModal.tsx';

interface DashboardViewProps {
  role: UserRole;
  setActiveTab: (tab: string) => void;
  onNavigateToBills?: (filter?: { date?: string; channel?: 'ALL' | 'POS' | 'MANUAL' }) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  role,
  setActiveTab,
  onNavigateToBills,
}) => {
  const isOwner = role === 'OWNER';
  const todayStr = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual Bill Modal
  const [showManualBillModal, setShowManualBillModal] = useState(false);

  // Success Notification & Receipt Preview
  const [lastSavedBill, setLastSavedBill] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Breakdown Modal for Cash / UPI collections
  const [breakdownType, setBreakdownType] = useState<'CASH' | 'UPI' | null>(null);

  const fetchMetrics = async (dateToFetch?: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = dateToFetch !== undefined ? dateToFetch : selectedDate;
      const res = await api.getDashboard(d);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics(selectedDate);
  }, [selectedDate]);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
  };

  const handleBillSaved = (savedBill: any) => {
    setLastSavedBill(savedBill);
    fetchMetrics(selectedDate);
  };

  const isToday = selectedDate === todayStr;
  const isDayClosed = Boolean(data?.closing?.is_closed);

  // Format date for display
  const formatDateDisplay = (dateString: string) => {
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header with Store Identity, Date & Primary Action */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 shadow-[0_2px_10px_rgba(23,21,19,0.03)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Store Info & Date */}
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1C1917]">
                {data?.store?.name || 'New Bhama Fashions'}
              </h1>
              {/* Day Status Badge */}
              {isDayClosed ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FAF8F4] text-[#6F6962] border border-[#D4CDC2]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#3F6B50]" />
                  Day Closed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#EBF3ED] text-[#2D5A3C] border border-[#CDE1D3]">
                  <span className="w-2 h-2 rounded-full bg-[#3F6B50] animate-pulse"></span>
                  Day Active
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-[#6F6962] flex-wrap">
              <span className="flex items-center gap-1 font-medium">
                <MapPin className="w-3.5 h-3.5 text-[#A67C52]" />
                {data?.store?.location || 'Chilakaluripet, Andhra Pradesh'}
              </span>
              <span className="text-[#D4CDC2]">&bull;</span>
              <span>{data?.store?.tagline || 'Ladies Fashion Retail'}</span>
              <span className="text-[#D4CDC2]">&bull;</span>
              <span>Daily Shop Business Overview</span>
            </div>
          </div>

          {/* Action Buttons: Primary Record Manual Bill + Secondary Controls */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Secondary Refresh Action */}
            <button
              onClick={() => fetchMetrics(selectedDate)}
              disabled={loading}
              title="Refresh shop dashboard data"
              className="px-3 py-2.5 bg-[#FAF8F4] hover:bg-[#F3EFE6] text-[#4A443D] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border border-[#D4CDC2] shadow-2xs cursor-pointer active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#6F6962] ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Business Date Picker Selector */}
            <div className="flex items-center bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl px-2.5 py-1.5 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-[#A67C52] mr-1.5 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#1C1917] focus:outline-hidden cursor-pointer"
                title="Select business date to review records"
              />
              {!isToday && (
                <button
                  onClick={() => handleDateChange(todayStr)}
                  className="ml-2 text-[11px] font-bold text-[#A67C52] hover:text-[#885F38] hover:underline"
                  title="Jump to today"
                >
                  Today
                </button>
              )}
            </div>

            {/* PRIMARY DASHBOARD ACTION: Record Manual Bill */}
            <button
              onClick={() => setShowManualBillModal(true)}
              className="px-4 py-2.5 bg-[#171513] hover:bg-[#2A2520] active:scale-98 text-[#F5F2EC] rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-sm border border-[#171513] cursor-pointer"
            >
              <FileText className="w-4 h-4 text-[#A67C52]" />
              <span>Record Manual Bill</span>
            </button>
          </div>
        </div>

        {/* Selected Date Context Banner */}
        <div className="pt-3 border-t border-[#F0EBE1] flex flex-col sm:flex-row sm:items-center justify-between text-xs text-[#6F6962] gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#1C1917]">Business Date:</span>
            <span className="px-2 py-0.5 rounded-md bg-[#FAF8F4] font-medium text-[#4A443D] border border-[#E3DED5]">
              {formatDateDisplay(selectedDate)}
            </span>
            {isToday ? (
              <span className="text-[11px] text-[#3F6B50] font-semibold bg-[#EBF3ED] px-1.5 py-0.5 rounded">
                Today
              </span>
            ) : (
              <span className="text-[11px] text-[#A67C52] font-medium bg-[#FBF5EE] px-1.5 py-0.5 rounded">
                Historical View
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px]">Daily workflow:</span>
            <span className="text-[11px] font-medium text-[#1C1917]">
              Customer handwritten bills recorded into ERP for accounts &amp; ledger
            </span>
          </div>
        </div>
      </div>

      {/* Bill Saved Notice */}
      {lastSavedBill && (
        <div className="bg-[#EBF3ED] border border-[#CDE1D3] text-[#2D5A3C] p-3.5 rounded-xl flex items-center justify-between gap-3 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0" />
            <div>
              <span className="font-bold">Manual Bill Recorded: </span>
              Bill #{lastSavedBill.bill_number} for ₹
              {(lastSavedBill.total_amount || 0).toLocaleString('en-IN')} successfully entered.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowReceiptModal(true)}
              className="px-2.5 py-1 bg-white hover:bg-[#FAF8F4] text-[#1C1917] rounded-lg font-semibold border border-[#CDE1D3] text-[11px] transition"
            >
              View Receipt Slip
            </button>
            <button
              onClick={() => setLastSavedBill(null)}
              className="text-[#6F6962] hover:text-[#1C1917] p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F] text-xs flex items-center gap-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">Unable to load dashboard data: </span>
            {error}
          </div>
          <button
            onClick={() => fetchMetrics(selectedDate)}
            className="px-2.5 py-1 bg-white text-[#A34F4F] border border-[#F0CCCC] rounded font-semibold hover:bg-[#FDF5F5]"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. SUMMARY LAYOUT - ROW 1: TODAY'S SALES & COLLECTIONS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6F6962]">
            Sales &amp; Collections ({formatDateDisplay(selectedDate)})
          </h2>
          <span className="text-[11px] text-[#9A938B]">Click card to view details</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1.1 Today's Sales */}
          <div
            onClick={() => {
              if (onNavigateToBills) {
                onNavigateToBills({ date: selectedDate });
              } else {
                setActiveTab('bills');
              }
            }}
            className="bg-white border border-[#E3DED5] hover:border-[#A67C52] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Today's Sales</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#3F6B50] border border-[#E3DED5] group-hover:bg-[#EBF3ED] transition">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#1C1917] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.sales?.total_sales || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>
                <strong>{data?.sales?.total_bills || 0}</strong> valid bills recorded
              </span>
              <span className="text-[#A67C52] font-semibold group-hover:underline inline-flex items-center">
                Day Book <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 1.2 Cash Received Today */}
          <div
            onClick={() => setBreakdownType('CASH')}
            className="bg-white border border-[#E3DED5] hover:border-[#3F6B50] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Cash Received Today</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#3F6B50] border border-[#E3DED5] group-hover:bg-[#EBF3ED] transition">
                  <Coins className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#1C1917] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.collections?.cash_received || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>Actual physical cash collected</span>
              <span className="text-[#3F6B50] font-semibold group-hover:underline inline-flex items-center">
                Breakdown <ChevronRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 1.3 UPI Received Today */}
          <div
            onClick={() => setBreakdownType('UPI')}
            className="bg-white border border-[#E3DED5] hover:border-[#526B7A] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">UPI Received Today</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#526B7A] border border-[#E3DED5] group-hover:bg-[#EEF2F5] transition">
                  <Smartphone className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#1C1917] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.collections?.upi_received || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>Digital QR &amp; phone payments</span>
              <span className="text-[#526B7A] font-semibold group-hover:underline inline-flex items-center">
                Breakdown <ChevronRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. SUMMARY LAYOUT - ROW 2: OUTSTANDING AND EXPENSES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6F6962]">
            Outstanding &amp; Cash Status
          </h2>
          <span className="text-[11px] text-[#9A938B]">Financial balances per ledger</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 2.1 Customer Dues Outstanding */}
          <div
            onClick={() => setActiveTab('dues')}
            className="bg-white border border-[#E3DED5] hover:border-[#A34F4F] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Customer Dues Outstanding</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#A34F4F] border border-[#E3DED5] group-hover:bg-[#FDF5F5] transition">
                  <Clock className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#A34F4F] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.customerDues?.total_pending || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>
                {data?.customerDues?.pending_count || 0} pending credit bills (
                {data?.customerDues?.customer_count || 0} customers)
              </span>
              <span className="text-[#A34F4F] font-semibold group-hover:underline inline-flex items-center">
                Customer Credit <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 2.2 Current Cash Drawer Balance */}
          <div
            onClick={() => setActiveTab('money')}
            className="bg-white border border-[#E3DED5] hover:border-[#3F6B50] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Current Cash Drawer Balance</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#3F6B50] border border-[#E3DED5] group-hover:bg-[#EBF3ED] transition">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>

              <div
                className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${
                  (data?.cashDrawer?.current_balance || 0) < 0 ? 'text-[#A34F4F]' : 'text-[#1C1917]'
                }`}
              >
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.cashDrawer?.current_balance || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>Physical drawer cash per recorded ledger</span>
              <span className="text-[#3F6B50] font-semibold group-hover:underline inline-flex items-center">
                Money &amp; Accounts <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 2.3 Today's Expenses */}
          <div
            onClick={() => setActiveTab('money')}
            className="bg-white border border-[#E3DED5] hover:border-[#A67C52] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Today's Expenses</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5] group-hover:bg-[#FBF5EE] transition">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#1C1917] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.expenses?.total_expenses || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>
                {data?.expenses?.count || 0} expenses (₹{data?.expenses?.cash_expenses || 0} cash, ₹
                {data?.expenses?.upi_expenses || 0} UPI)
              </span>
              <span className="text-[#A67C52] font-semibold group-hover:underline inline-flex items-center">
                Record Expense <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. SUMMARY LAYOUT - BOTTOM SECTION */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#6F6962]">
            Operations &amp; Reconciliation Status
          </h2>
          <span className="text-[11px] text-[#9A938B]">Supplier balances &amp; day book</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 3.1 Supplier Outstanding */}
          <div
            onClick={() => setActiveTab('purchases')}
            className="bg-white border border-[#E3DED5] hover:border-[#A34F4F] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Supplier Outstanding</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#A34F4F] border border-[#E3DED5] group-hover:bg-[#FDF5F5] transition">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#A34F4F] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `₹${(data?.supplierOutstanding?.total_pending || 0).toLocaleString('en-IN')}`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>
                {data?.supplierOutstanding?.pending_count || 0} unpaid purchase invoices
              </span>
              <span className="text-[#A34F4F] font-semibold group-hover:underline inline-flex items-center">
                Suppliers <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 3.2 Day Closing / Reconciliation Status */}
          <div
            onClick={() => setActiveTab('closing')}
            className="bg-white border border-[#E3DED5] hover:border-[#526B7A] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Day Closing / Reconciliation</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#526B7A] border border-[#E3DED5] group-hover:bg-[#EEF2F5] transition">
                  <CalendarCheck className="w-4 h-4" />
                </div>
              </div>

              <div>
                {isDayClosed ? (
                  <div className="space-y-0.5">
                    <div className="text-xl sm:text-2xl font-bold text-[#3F6B50] flex items-center gap-1.5">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      Day Closed
                    </div>
                    <div className="text-xs text-[#6F6962]">
                      Counted cash: ₹
                      {(data?.closing?.actual_counted_cash || 0).toLocaleString('en-IN')}
                      {data?.closing?.difference_cash !== 0 && (
                        <span
                          className={`ml-1 font-semibold ${
                            (data?.closing?.difference_cash || 0) < 0
                              ? 'text-[#A34F4F]'
                              : 'text-[#3F6B50]'
                          }`}
                        >
                          (Diff: ₹{(data?.closing?.difference_cash || 0).toLocaleString('en-IN')})
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <div className="text-xl sm:text-2xl font-bold text-[#A67C52] flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-[#A67C52] animate-pulse"></span>
                      Pending Closing
                    </div>
                    <div className="text-xs text-[#6F6962]">
                      Expected cash: ₹
                      {(data?.cashDrawer?.expected_closing_cash || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>{isDayClosed ? 'Reconciled successfully' : 'Count drawer & reconcile'}</span>
              <span className="text-[#526B7A] font-semibold group-hover:underline inline-flex items-center">
                Day Book <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>

          {/* 3.3 Today's Manual Bills Count */}
          <div
            onClick={() => {
              if (onNavigateToBills) {
                onNavigateToBills({ date: selectedDate, channel: 'MANUAL' });
              } else {
                setActiveTab('bills');
              }
            }}
            className="bg-white border border-[#E3DED5] hover:border-[#171513] rounded-xl p-5 shadow-[0_2px_8px_rgba(23,21,19,0.02)] hover:shadow-md transition cursor-pointer group flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[#6F6962]">
                <span className="text-xs font-semibold text-[#4A443D]">Today's Manual Bills</span>
                <div className="p-1.5 rounded-lg bg-[#FAF8F4] text-[#171513] border border-[#E3DED5] group-hover:bg-[#F3EFE6] transition">
                  <FileText className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl sm:text-3xl font-extrabold text-[#1C1917] tracking-tight">
                {loading ? (
                  <span className="text-[#9A938B] text-lg font-normal">Loading...</span>
                ) : (
                  `${data?.manualBills?.count || 0} Bills`
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EBE1] text-[11px] text-[#6F6962] flex items-center justify-between">
              <span>
                Total ₹{(data?.manualBills?.total_amount || 0).toLocaleString('en-IN')} (
                {data?.sales?.pos_bills_count || 0} POS bills)
              </span>
              <span className="text-[#171513] font-semibold group-hover:underline inline-flex items-center">
                View Manual Bills <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Quick Shop Operations & Module Links */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#6F6962]">
            Shop Workflows &amp; Navigation
          </h3>
          <span className="text-xs text-[#9A938B]">All ERP modules intact</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Record Manual Bill (Primary) */}
          <button
            onClick={() => setShowManualBillModal(true)}
            className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#D4CDC2] hover:border-[#171513] rounded-xl text-left space-y-1.5 transition group shadow-2xs hover:shadow cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-[#171513] text-[#F5F2EC] w-fit transition">
              <FileText className="w-4 h-4 text-[#A67C52]" />
            </div>
            <div className="font-bold text-xs text-[#1C1917]">Record Manual Bill</div>
            <div className="text-[11px] text-[#6F6962]">Enter handwritten bill</div>
          </button>

          {/* Daily Closing */}
          <button
            onClick={() => setActiveTab('closing')}
            className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#526B7A] rounded-xl text-left space-y-1.5 transition group shadow-2xs hover:shadow cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#526B7A] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] transition">
              <CalendarCheck className="w-4 h-4" />
            </div>
            <div className="font-bold text-xs text-[#1C1917]">Daily Closing (Day Book)</div>
            <div className="text-[11px] text-[#6F6962]">Count cash &amp; reconcile</div>
          </button>

          {/* Customer Dues */}
          <button
            onClick={() => setActiveTab('dues')}
            className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#A34F4F] rounded-xl text-left space-y-1.5 transition group shadow-2xs hover:shadow cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#A34F4F] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] transition">
              <Clock className="w-4 h-4" />
            </div>
            <div className="font-bold text-xs text-[#1C1917]">Customer Dues</div>
            <div className="text-[11px] text-[#6F6962]">Credit collections</div>
          </button>

          {/* POS Billing (Maintained in navigation) */}
          <button
            onClick={() => setActiveTab('pos')}
            className="p-3.5 bg-[#FAF8F4] hover:bg-white border border-[#E3DED5] hover:border-[#A67C52] rounded-xl text-left space-y-1.5 transition group shadow-2xs hover:shadow cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-white border border-[#E3DED5] text-[#3F6B50] w-fit group-hover:bg-[#171513] group-hover:text-[#F5F2EC] transition">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div className="font-bold text-xs text-[#1C1917]">Computer POS Billing</div>
            <div className="text-[11px] text-[#6F6962]">Available for future use</div>
          </button>
        </div>
      </div>

      {/* 6. Recent Sales Activity on Selected Date */}
      {data?.recentSales && data.recentSales.length > 0 && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-3 shadow-[0_2px_8px_rgba(23,21,19,0.02)]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#6F6962]">
              Recorded Bills ({formatDateDisplay(selectedDate)})
            </h3>
            <button
              onClick={() => {
                if (onNavigateToBills) {
                  onNavigateToBills({ date: selectedDate });
                } else {
                  setActiveTab('bills');
                }
              }}
              className="text-xs font-semibold text-[#A67C52] hover:underline inline-flex items-center"
            >
              View All Bills <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E3DED5] text-[#6F6962]">
                  <th className="py-2.5 px-3 font-semibold">Bill #</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Payment</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EBE1]">
                {data.recentSales.map((sale: any) => (
                  <tr key={sale.id} className="hover:bg-[#FAF8F4] transition">
                    <td className="py-2.5 px-3 font-semibold text-[#1C1917]">
                      {sale.bill_number}
                    </td>
                    <td className="py-2.5 px-3">
                      {sale.channel === 'MANUAL' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#FBF5EE] text-[#A67C52] border border-[#EBDCCF]">
                          Manual Bill
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#FAF8F4] text-[#526B7A] border border-[#E3DED5]">
                          POS Bill
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[#4A443D]">
                      {sale.customer_name || 'Walk-in Customer'}
                    </td>
                    <td className="py-2.5 px-3 text-[#6F6962]">
                      <span className="capitalize">{sale.payment_method?.toLowerCase() || 'Cash'}</span>
                      {sale.balance_due > 0 && (
                        <span className="ml-1 text-[#A34F4F] font-semibold">
                          (Due: ₹{sale.balance_due})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-right text-[#1C1917]">
                      ₹{(sale.total_amount || 0).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Bill Entry Modal */}
      {showManualBillModal && (
        <ManualBillModal
          isOpen={showManualBillModal}
          onClose={() => setShowManualBillModal(false)}
          onBillSaved={handleBillSaved}
        />
      )}

      {/* Thermal Receipt Preview Modal */}
      {showReceiptModal && lastSavedBill && (
        <ReceiptModal
          sale={lastSavedBill}
          onClose={() => setShowReceiptModal(false)}
          storeName={data?.store?.name}
          storeLocation={data?.store?.location}
          contacts={[data?.store?.phone]}
        />
      )}

      {/* Cash / UPI Collections Breakdown Modal */}
      {breakdownType && (
        <div className="fixed inset-0 z-50 bg-[#171513]/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 border border-[#E3DED5] shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div className="flex items-center gap-2">
                {breakdownType === 'CASH' ? (
                  <Coins className="w-5 h-5 text-[#3F6B50]" />
                ) : (
                  <Smartphone className="w-5 h-5 text-[#526B7A]" />
                )}
                <div>
                  <h3 className="font-bold text-sm text-[#1C1917]">
                    {breakdownType === 'CASH' ? 'Cash Collections Breakdown' : 'UPI Collections Breakdown'}
                  </h3>
                  <p className="text-[11px] text-[#6F6962]">{formatDateDisplay(selectedDate)}</p>
                </div>
              </div>
              <button
                onClick={() => setBreakdownType(null)}
                className="text-[#6F6962] hover:text-[#1C1917] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                <span className="font-medium text-[#4A443D]">
                  {breakdownType === 'CASH' ? 'Sales Cash Collected' : 'Sales UPI Received'}
                </span>
                <span className="font-bold text-sm text-[#1C1917]">
                  ₹
                  {(breakdownType === 'CASH'
                    ? data?.collections?.sales_cash || 0
                    : data?.collections?.sales_upi || 0
                  ).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                <span className="font-medium text-[#4A443D]">
                  {breakdownType === 'CASH'
                    ? 'Customer Dues Collected (Cash)'
                    : 'Customer Dues Collected (UPI)'}
                </span>
                <span className="font-bold text-sm text-[#3F6B50]">
                  + ₹
                  {(breakdownType === 'CASH'
                    ? data?.collections?.due_cash || 0
                    : data?.collections?.due_upi || 0
                  ).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-[#F5F2EC] rounded-xl border border-[#D4CDC2]">
                <span className="font-bold text-sm text-[#1C1917]">
                  Total {breakdownType} Received Today
                </span>
                <span className="font-extrabold text-base text-[#1C1917]">
                  ₹
                  {(breakdownType === 'CASH'
                    ? data?.collections?.cash_received || 0
                    : data?.collections?.upi_received || 0
                  ).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  setBreakdownType(null);
                  setActiveTab('money');
                }}
                className="w-full py-2.5 bg-[#171513] hover:bg-[#2A2520] text-[#F5F2EC] rounded-xl font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
              >
                <span>Open Money &amp; Accounts Ledger</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#A67C52]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
