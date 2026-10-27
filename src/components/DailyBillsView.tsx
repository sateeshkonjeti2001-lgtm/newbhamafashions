import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  Calendar,
  Filter,
  Eye,
  Printer,
  Ban,
  RefreshCw,
  Coins,
  Smartphone,
  CreditCard,
  Wallet,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Phone,
  X,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { UserRole } from '../types.ts';
import { ManualBillModal } from './ManualBillModal.tsx';
import { ReceiptModal } from './ReceiptModal.tsx';

interface DailyBillsViewProps {
  role: UserRole;
  onNavigateToDashboard?: () => void;
  initialDate?: string;
}

export const DailyBillsView: React.FC<DailyBillsViewProps> = ({
  role,
  onNavigateToDashboard,
  initialDate,
}) => {
  const isOwner = role === 'OWNER';
  const todayStr = new Date().toISOString().split('T')[0];

  // Filters
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || todayStr);
  const [dateMode, setDateMode] = useState<'TODAY' | 'YESTERDAY' | 'MONTH' | 'ALL' | 'CUSTOM'>('TODAY');
  const [search, setSearch] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Data & States
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [selectedBillDetail, setSelectedBillDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [receiptBill, setReceiptBill] = useState<any | null>(null);

  // Cancellation Modal (Owner Only)
  const [billToCancel, setBillToCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('Customer returned goods / handwritten error');
  const [cancelNotes, setCancelNotes] = useState<string>('');
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Success Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Compute date filter arguments based on dateMode
  const getDateParams = () => {
    if (dateMode === 'TODAY') {
      return { date: todayStr };
    }
    if (dateMode === 'YESTERDAY') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      return { date: yStr };
    }
    if (dateMode === 'MONTH') {
      const now = new Date();
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return { start_date: firstDay, end_date: todayStr };
    }
    if (dateMode === 'CUSTOM') {
      return { date: selectedDate };
    }
    // ALL
    return {};
  };

  // Fetch Daily Bills (channel = 'MANUAL')
  const fetchDailyBills = async () => {
    setLoading(true);
    setError(null);
    try {
      const dateParams = getDateParams();
      const res = await api.getBills({
        ...dateParams,
        channel: 'MANUAL',
        search: search.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        limit: 100,
      });

      let fetched = res.bills || [];

      // Filter by payment method client-side if selected
      if (paymentFilter !== 'ALL') {
        fetched = fetched.filter((b: any) => b.payment_method === paymentFilter);
      }

      setBills(fetched);
    } catch (err: any) {
      console.error('Error fetching daily bills:', err);
      setError(err.message || 'Failed to load daily bills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDailyBills();
  }, [dateMode, selectedDate, statusFilter, paymentFilter]);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDailyBills();
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Open Full Bill Detail
  const handleViewBill = async (billId: string) => {
    setLoadingDetail(true);
    setSelectedBillDetail(null);
    try {
      const res = await api.getBillDetail(billId);
      setSelectedBillDetail(res);
    } catch (err: any) {
      showToast(`Could not load bill details: ${err.message}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Handle Safe Cancel Bill
  const handleConfirmCancel = async () => {
    if (!billToCancel) return;
    if (!cancelReason.trim()) {
      setCancelError('Please select or specify a reason for cancellation.');
      return;
    }

    setCancelling(true);
    setCancelError(null);
    try {
      const res = await api.cancelBill(billToCancel.id, {
        reason: cancelReason.trim(),
        notes: cancelNotes.trim() || undefined,
      });

      showToast(`Bill #${billToCancel.bill_number} successfully cancelled and reversed.`);
      setBillToCancel(null);
      setCancelNotes('');
      if (selectedBillDetail && selectedBillDetail.sale?.id === billToCancel.id) {
        setSelectedBillDetail(null);
      }
      fetchDailyBills();
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel bill');
    } finally {
      setCancelling(false);
    }
  };

  // Calculate Metrics from current fetched list
  const metrics = useMemo(() => {
    let totalSales = 0;
    let cashReceived = 0;
    let upiReceived = 0;
    let cardReceived = 0;
    let creditDue = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    for (const b of bills) {
      if (b.status === 'CANCELLED') {
        cancelledCount++;
        continue;
      }
      completedCount++;
      totalSales += Number(b.total_amount) || 0;
      cashReceived += Number(b.cash_paid) || 0;
      upiReceived += Number(b.upi_paid) || 0;
      cardReceived += Number(b.card_paid) || (b.payment_method === 'CARD' ? Number(b.total_amount) : 0);
      creditDue += Number(b.balance_due) || 0;
    }

    return {
      totalBills: bills.length,
      completedCount,
      cancelledCount,
      totalSales,
      cashReceived,
      upiReceived,
      cardReceived,
      creditDue,
    };
  }, [bills]);

  // Format date helper
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-5">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-[#171513] text-[#F5F2EC] px-4 py-3 rounded-xl shadow-lg border border-[#3E3832] text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-[#A67C52]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Header with Title & Primary '+ Add Daily Bill' Action */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 shadow-[0_2px_10px_rgba(23,21,19,0.03)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-[#A67C52]">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#1C1917]">
                  Daily Bills
                </h1>
                <p className="text-xs text-[#6F6962] mt-0.5">
                  Handwritten Customer Bills &bull; Day Sales Entry &bull; Zero POS Inventory Deduction
                </p>
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchDailyBills}
              disabled={loading}
              title="Refresh list"
              className="p-2.5 bg-[#FAF8F4] hover:bg-[#F3EFE6] text-[#4A443D] border border-[#D4CDC2] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 text-[#6F6962] ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 bg-[#A67C52] hover:bg-[#8C653E] active:scale-98 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm border border-[#8C653E] transition cursor-pointer"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>+ Add Daily Bill</span>
            </button>
          </div>
        </div>

        {/* Business Rule Guarantee Banner */}
        <div className="pt-3 border-t border-[#F0EBE1] flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-[#6F6962]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#3F6B50] shrink-0" />
            <span>
              Recorded handwritten bills feed into daily sales, cash drawer collections, customer dues, and day closing without altering barcode stock levels.
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#9A938B]">
            Channel: <strong className="text-[#1C1917]">MANUAL_BILL</strong>
          </span>
        </div>
      </div>

      {/* 2. Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {/* Total Bills */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between">
          <span className="text-[11px] sm:text-xs font-semibold text-[#6F6962]">Daily Bills</span>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#1C1917] tabular-nums mt-1">
            {metrics.completedCount}
            {metrics.cancelledCount > 0 && (
              <span className="text-[10px] sm:text-xs text-[#A34F4F] font-normal ml-1">
                ({metrics.cancelledCount} void)
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#9A938B] mt-1">
            {dateMode === 'TODAY' ? 'Recorded today' : 'In filtered view'}
          </span>
        </div>

        {/* Total Sales */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between">
          <span className="text-[11px] sm:text-xs font-semibold text-[#6F6962]">Total Sales</span>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#1C1917] tabular-nums mt-1">
            ₹{metrics.totalSales.toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-[#3F6B50] font-medium mt-1">
            Sum of items
          </span>
        </div>

        {/* Cash Collected */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-[11px] sm:text-xs font-semibold">Cash</span>
            <Coins className="w-3.5 h-3.5 text-[#3F6B50]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#3F6B50] tabular-nums mt-1">
            ₹{metrics.cashReceived.toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-[#9A938B] mt-1">Cash drawer</span>
        </div>

        {/* UPI Collected */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-[11px] sm:text-xs font-semibold">UPI</span>
            <Smartphone className="w-3.5 h-3.5 text-[#526B7A]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#526B7A] tabular-nums mt-1">
            ₹{metrics.upiReceived.toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-[#9A938B] mt-1">Digital QR</span>
        </div>

        {/* Card Collected */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-[11px] sm:text-xs font-semibold">Card</span>
            <CreditCard className="w-3.5 h-3.5 text-[#3730A3]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#3730A3] tabular-nums mt-1">
            ₹{metrics.cardReceived.toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-[#9A938B] mt-1">POS swipe/tap</span>
        </div>

        {/* Customer Dues / Credit */}
        <div className="bg-white border border-[#E3DED5] rounded-xl p-3 sm:p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-[11px] sm:text-xs font-semibold">Customer Dues</span>
            <Clock className="w-3.5 h-3.5 text-[#A34F4F]" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#A34F4F] tabular-nums mt-1">
            ₹{metrics.creditDue.toLocaleString('en-IN')}
          </div>
          <span className="text-[10px] text-[#9A938B] mt-1">Pending credit</span>
        </div>
      </div>

      {/* 3. Filter & Search Controls */}
      <div className="bg-white border border-[#E3DED5] rounded-xl p-4 shadow-[0_2px_8px_rgba(23,21,19,0.02)] space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Quick Date Segmented Filter */}
          <div className="flex items-center gap-1 p-1 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl overflow-x-auto">
            <button
              onClick={() => {
                setDateMode('TODAY');
                setSelectedDate(todayStr);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap cursor-pointer ${
                dateMode === 'TODAY'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                setDateMode('YESTERDAY');
                const y = new Date();
                y.setDate(y.getDate() - 1);
                setSelectedDate(y.toISOString().split('T')[0]);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap cursor-pointer ${
                dateMode === 'YESTERDAY'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setDateMode('MONTH')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap cursor-pointer ${
                dateMode === 'MONTH'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setDateMode('ALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap cursor-pointer ${
                dateMode === 'ALL'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              All Dates
            </button>
          </div>

          {/* Custom Date Picker */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl px-2.5 py-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-[#A67C52] mr-1.5 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setDateMode('CUSTOM');
                }}
                className="bg-transparent text-xs font-semibold text-[#1C1917] focus:outline-hidden cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Search, Payment & Status Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#F0EBE1]">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#9A938B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Bill # or Customer..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-hidden focus:border-[#A67C52]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Payment Method Selector */}
          <div>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs font-semibold text-[#1C1917] focus:outline-hidden focus:border-[#A67C52] cursor-pointer"
            >
              <option value="ALL">All Payment Methods</option>
              <option value="CASH">Cash Only</option>
              <option value="UPI">UPI Only</option>
              <option value="CARD">Card Only</option>
              <option value="SPLIT">Split (Cash + UPI)</option>
              <option value="CREDIT">Credit / Due</option>
            </select>
          </div>

          {/* Status Selector */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs font-semibold text-[#1C1917] focus:outline-hidden focus:border-[#A67C52] cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed Only</option>
              <option value="CANCELLED">Cancelled / Voided Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Daily Bills Table */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_10px_rgba(23,21,19,0.03)]">
        {loading ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#A67C52] border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-[#6F6962] font-medium">Loading handwritten daily bills...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-[#A34F4F] mx-auto" />
            <p className="text-xs text-[#A34F4F] font-semibold">{error}</p>
            <button
              onClick={fetchDailyBills}
              className="px-4 py-2 bg-[#FAF8F4] border border-[#D4CDC2] text-xs font-bold rounded-xl hover:bg-[#F3EFE6]"
            >
              Try Again
            </button>
          </div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 bg-[#FAF8F4] border border-[#E3DED5] rounded-2xl flex items-center justify-center mx-auto text-[#A67C52]">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1C1917]">No Daily Bills Found</h3>
              <p className="text-xs text-[#6F6962] mt-0.5">
                {search || paymentFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No manual bills match your active search or filters.'
                  : 'No handwritten bills recorded for the selected date.'}
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-[#A67C52] hover:bg-[#8C653E] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record First Daily Bill</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[#6F6962] font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Bill Number</th>
                  <th className="py-3 px-4 min-w-[200px]">Item Summary</th>
                  <th className="py-3 px-4 text-right">Total Bill (₹)</th>
                  <th className="py-3 px-4 text-center">Payment Method</th>
                  <th className="py-3 px-4 text-center">Status / Dues</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {bills.map((bill) => {
                  const isCancelled = bill.status === 'CANCELLED';
                  const isCredit = bill.payment_method === 'CREDIT' || bill.balance_due > 0;
                  const itemSummary = bill.items_summary || (bill.total_items ? `${bill.total_items} items` : 'Handwritten Items');

                  return (
                    <tr
                      key={bill.id}
                      className={`transition-colors ${
                        isCancelled
                          ? 'bg-[#FDF7F7] opacity-75'
                          : 'hover:bg-[#FAF8F4]/70'
                      }`}
                    >
                      {/* Date */}
                      <td className="py-3.5 px-4 font-medium text-[#1C1917] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{formatDate(bill.created_at)}</span>
                        </div>
                      </td>

                      {/* Bill Number */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-[#1C1917] px-2 py-0.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-md">
                            #{bill.bill_number}
                          </span>
                          <span className="text-[10px] text-[#A67C52] font-semibold bg-[#FBF5EE] border border-[#E8DFC9] px-1.5 py-0.5 rounded">
                            Slip
                          </span>
                        </div>
                        {bill.customer_name && (
                          <div className="text-[11px] text-[#6F6962] mt-0.5 flex items-center gap-1">
                            <User className="w-3 h-3 text-[#9A938B]" />
                            <span>{bill.customer_name}</span>
                          </div>
                        )}
                      </td>

                      {/* Item Summary */}
                      <td className="py-3.5 px-4">
                        <div className="text-xs text-[#1C1917] line-clamp-1 font-medium" title={itemSummary}>
                          {itemSummary}
                        </div>
                        <div className="text-[11px] text-[#9A938B] mt-0.5">
                          {bill.total_items || bill.product_count || 1} item line{bill.total_items === 1 ? '' : 's'}
                        </div>
                      </td>

                      {/* Total Bill Amount */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono tabular-nums">
                        <span
                          className={`text-sm font-bold ${
                            isCancelled
                              ? 'text-[#A34F4F] line-through'
                              : 'text-[#1C1917]'
                          }`}
                        >
                          ₹{(bill.total_amount || 0).toLocaleString('en-IN')}
                        </span>
                        {bill.payment_method === 'SPLIT' && (
                          <div className="text-[10px] text-[#6F6962] mt-0.5 font-normal">
                            Cash ₹{bill.cash_paid} + UPI ₹{bill.upi_paid}
                          </div>
                        )}
                      </td>

                      {/* Payment Method Badge */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {bill.payment_method === 'CASH' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2D5A3C] bg-[#EBF3ED] px-2 py-0.5 rounded-md border border-[#CDE1D3]">
                            <Coins className="w-3 h-3" />
                            Cash
                          </span>
                        )}
                        {bill.payment_method === 'UPI' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E4758] bg-[#EEF2F5] px-2 py-0.5 rounded-md border border-[#CDD8DF]">
                            <Smartphone className="w-3 h-3" />
                            UPI
                          </span>
                        )}
                        {bill.payment_method === 'CARD' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3730A3] bg-[#EEF2FF] px-2 py-0.5 rounded-md border border-[#C7D2FE]">
                            <CreditCard className="w-3 h-3" />
                            Card
                          </span>
                        )}
                        {bill.payment_method === 'SPLIT' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5A3866] bg-[#F5EFF7] px-2 py-0.5 rounded-md border border-[#E0D0E3]">
                            <Wallet className="w-3 h-3" />
                            Split
                          </span>
                        )}
                        {bill.payment_method === 'CREDIT' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C481A] bg-[#FAF1E8] px-2 py-0.5 rounded-md border border-[#ECD9C5]">
                            <BookOpen className="w-3 h-3" />
                            Credit
                          </span>
                        )}
                      </td>

                      {/* Payment / Due Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {isCancelled ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#A34F4F] bg-[#FDF5F5] px-2 py-0.5 rounded-md border border-[#F0CCCC]">
                            <Ban className="w-3 h-3" />
                            Cancelled
                          </span>
                        ) : isCredit ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#A34F4F] bg-[#FDF5F5] px-2 py-0.5 rounded-md border border-[#F0CCCC]">
                            <Clock className="w-3 h-3" />
                            Due: ₹{(bill.balance_due || bill.total_amount).toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2D5A3C] bg-[#EBF3ED] px-2 py-0.5 rounded-md border border-[#CDE1D3]">
                            <CheckCircle2 className="w-3 h-3" />
                            Paid
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Bill Details */}
                          <button
                            onClick={() => handleViewBill(bill.id)}
                            title="View handwritten bill details"
                            className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-[#FAF8F4] border border-transparent hover:border-[#D4CDC2] rounded-lg transition cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Print Slip */}
                          <button
                            onClick={() => setReceiptBill(bill)}
                            title="Print / View thermal bill slip"
                            className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-[#FAF8F4] border border-transparent hover:border-[#D4CDC2] rounded-lg transition cursor-pointer"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Safe Authorized Cancel (Owner only) */}
                          {isOwner && !isCancelled && (
                            <button
                              onClick={() => {
                                setBillToCancel(bill);
                                setCancelReason('Customer returned goods / handwritten error');
                                setCancelNotes('');
                                setCancelError(null);
                              }}
                              title="Safe cancel and reverse financial entry"
                              className="p-1.5 text-[#A34F4F] hover:text-red-700 hover:bg-[#FDF5F5] border border-transparent hover:border-[#F0CCCC] rounded-lg transition cursor-pointer"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile Stacked Card View (< sm) */}
            <div className="sm:hidden divide-y divide-[#E3DED5]">
              {bills.map((bill) => {
                const isCancelled = bill.status === 'CANCELLED';
                const isCredit = bill.payment_method === 'CREDIT' || bill.balance_due > 0;
                const itemSummary = bill.items_summary || (bill.total_items ? `${bill.total_items} items` : 'Handwritten Items');

                return (
                  <div
                    key={bill.id}
                    className={`p-4 space-y-3 transition-colors ${
                      isCancelled ? 'bg-[#FDF7F7] opacity-80' : 'bg-white hover:bg-[#FAF8F4]/50'
                    }`}
                  >
                    {/* Header Row: Bill Number, Slip Tag, Date */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-sm text-[#1C1917] px-2 py-0.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-md">
                          #{bill.bill_number}
                        </span>
                        <span className="text-[10px] text-[#A67C52] font-semibold bg-[#FBF5EE] border border-[#E8DFC9] px-1.5 py-0.5 rounded">
                          Slip
                        </span>
                      </div>
                      <span className="text-xs text-[#6F6962] font-medium">
                        {formatDate(bill.created_at)}
                      </span>
                    </div>

                    {/* Customer Info (if any) */}
                    {bill.customer_name && (
                      <div className="flex items-center gap-1.5 text-xs text-[#1C1917] font-medium bg-[#FAF8F4] px-2.5 py-1 rounded-lg border border-[#E3DED5]/60">
                        <User className="w-3.5 h-3.5 text-[#A67C52] shrink-0" />
                        <span>{bill.customer_name}</span>
                        {bill.customer_phone && (
                          <span className="text-[#6F6962] font-mono text-[11px] ml-auto">
                            {bill.customer_phone}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Item Summary */}
                    <div>
                      <p className="text-xs text-[#1C1917] font-medium leading-relaxed">
                        {itemSummary}
                      </p>
                      <span className="text-[11px] text-[#9A938B]">
                        {bill.total_items || bill.product_count || 1} item line{bill.total_items === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* Financial & Status Bar */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#F0EBE1]">
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-[#9A938B] block">
                          Total Bill
                        </span>
                        <span
                          className={`text-base font-bold font-mono tabular-nums ${
                            isCancelled ? 'text-[#A34F4F] line-through' : 'text-[#1C1917]'
                          }`}
                        >
                          ₹{(bill.total_amount || 0).toLocaleString('en-IN')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Payment badge */}
                        {bill.payment_method === 'CASH' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2D5A3C] bg-[#EBF3ED] px-2 py-1 rounded-md border border-[#CDE1D3]">
                            <Coins className="w-3.5 h-3.5" />
                            Cash
                          </span>
                        )}
                        {bill.payment_method === 'UPI' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2E4758] bg-[#EEF2F5] px-2 py-1 rounded-md border border-[#CDD8DF]">
                            <Smartphone className="w-3.5 h-3.5" />
                            UPI
                          </span>
                        )}
                        {bill.payment_method === 'CARD' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#3730A3] bg-[#EEF2FF] px-2 py-1 rounded-md border border-[#C7D2FE]">
                            <CreditCard className="w-3.5 h-3.5" />
                            Card
                          </span>
                        )}
                        {bill.payment_method === 'SPLIT' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5A3866] bg-[#F5EFF7] px-2 py-1 rounded-md border border-[#E0D0E3]">
                            <Wallet className="w-3.5 h-3.5" />
                            Split
                          </span>
                        )}
                        {bill.payment_method === 'CREDIT' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C481A] bg-[#FAF1E8] px-2 py-1 rounded-md border border-[#ECD9C5]">
                            <BookOpen className="w-3.5 h-3.5" />
                            Credit
                          </span>
                        )}

                        {/* Status badge */}
                        {isCancelled ? (
                          <span className="text-xs font-bold text-[#A34F4F] bg-[#FDF5F5] px-2 py-1 rounded-md border border-[#F0CCCC]">
                            Void
                          </span>
                        ) : isCredit ? (
                          <span className="text-xs font-bold text-[#A34F4F] bg-[#FDF5F5] px-2 py-1 rounded-md border border-[#F0CCCC]">
                            Due ₹{bill.balance_due || bill.total_amount}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-[#2D5A3C] bg-[#EBF3ED] px-2 py-1 rounded-md border border-[#CDE1D3]">
                            Paid
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Touch-Friendly Action Buttons (min 44px touch targets) */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      <button
                        onClick={() => handleViewBill(bill.id)}
                        className="min-h-[44px] px-3 py-2 bg-[#FAF8F4] hover:bg-[#F0EDE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Eye className="w-4 h-4 text-[#A67C52]" />
                        <span>View Slip</span>
                      </button>

                      <button
                        onClick={() => setReceiptBill(bill)}
                        className="min-h-[44px] px-3 py-2 bg-[#FAF8F4] hover:bg-[#F0EDE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Printer className="w-4 h-4 text-[#526B7A]" />
                        <span>Receipt</span>
                      </button>

                      {isOwner && !isCancelled && (
                        <button
                          onClick={() => {
                            setBillToCancel(bill);
                            setCancelReason('Customer returned goods / handwritten error');
                            setCancelNotes('');
                            setCancelError(null);
                          }}
                          className="col-span-2 sm:col-span-1 min-h-[44px] px-3 py-2 bg-[#FDF5F5] hover:bg-[#FCE8E8] border border-[#F0CCCC] text-[#A34F4F] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Ban className="w-4 h-4" />
                          <span>Cancel Bill</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. Add Daily Bill Modal (ManualBillModal) */}
      <ManualBillModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onBillSaved={(savedBill) => {
          showToast(`Daily Bill #${savedBill.bill_number} recorded successfully!`);
          fetchDailyBills();
        }}
      />

      {/* 6. View Single Bill Detail Modal */}
      {selectedBillDetail && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl my-6 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#E3DED5] bg-[#FAF8F4] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white text-[#A67C52] border border-[#E3DED5] rounded-xl">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#1C1917]">
                      Handwritten Bill #{selectedBillDetail.sale?.bill_number}
                    </h2>
                    {selectedBillDetail.sale?.status === 'CANCELLED' ? (
                      <span className="text-[11px] font-bold text-[#A34F4F] bg-[#FDF5F5] border border-[#F0CCCC] px-2 py-0.5 rounded-full">
                        Cancelled / Void
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-[#2D5A3C] bg-[#EBF3ED] border border-[#CDE1D3] px-2 py-0.5 rounded-full">
                        Completed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#6F6962] mt-0.5">
                    Recorded Date: {formatDate(selectedBillDetail.sale?.created_at)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedBillDetail(null)}
                className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Cancellation Banner if Cancelled */}
              {selectedBillDetail.sale?.status === 'CANCELLED' && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span>Bill Cancelled and Financial Entries Reversed</span>
                  </div>
                  <p className="text-[11px]">
                    Reason: {selectedBillDetail.sale?.cancelled_reason || 'Manual cancellation'} &bull; Cancelled by: {selectedBillDetail.sale?.cancelled_by_name || 'Owner'} on {formatDate(selectedBillDetail.sale?.cancelled_at)}
                  </p>
                </div>
              )}

              {/* Customer & Info Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[#FAF8F4] border border-[#E3DED5] p-3.5 rounded-xl">
                <div>
                  <span className="text-[#9A938B] block text-[11px]">Customer Info</span>
                  <span className="font-bold text-[#1C1917] block">
                    {selectedBillDetail.sale?.customer_name || 'Walk-in Customer'}
                  </span>
                  {selectedBillDetail.sale?.customer_phone && (
                    <span className="text-[#6F6962] block mt-0.5 font-mono">
                      {selectedBillDetail.sale?.customer_phone}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-[#9A938B] block text-[11px]">Entry Audit Details</span>
                  <span className="font-medium text-[#1C1917] block">
                    Cashier / User: {selectedBillDetail.sale?.cashier_name || 'Store Staff'}
                  </span>
                  <span className="text-[#6F6962] block mt-0.5 text-[11px]">
                    Channel: {selectedBillDetail.sale?.channel || 'MANUAL'} (0 inventory movement)
                  </span>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
                  Bill Items ({selectedBillDetail.items?.length || 0})
                </h3>
                <div className="border border-[#E3DED5] rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[#6F6962] font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Item Name</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Rate (₹)</th>
                        <th className="py-2.5 px-3 text-right">Item Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3DED5]">
                      {selectedBillDetail.items?.map((it: any, idx: number) => (
                        <tr key={it.id || idx}>
                          <td className="py-2 px-3 font-medium text-[#1C1917]">
                            {it.product_name}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[#6F6962]">
                            {it.quantity}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[#6F6962]">
                            ₹{it.unit_price}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-[#1C1917] tabular-nums">
                            ₹{it.total_price}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Summary */}
              <div className="bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-[#1C1917] border-b border-[#E3DED5] pb-2">
                  <span>Grand Total Bill Amount</span>
                  <span className="text-base font-mono tabular-nums">
                    ₹{(selectedBillDetail.sale?.total_amount || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-1">
                  <div>
                    <span className="text-[#9A938B] block text-[11px]">Method</span>
                    <span className="font-semibold text-[#1C1917]">
                      {selectedBillDetail.sale?.payment_method}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#9A938B] block text-[11px]">Cash Paid</span>
                    <span className="font-mono font-semibold text-[#3F6B50]">
                      ₹{(selectedBillDetail.sale?.cash_paid || 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#9A938B] block text-[11px]">UPI Paid</span>
                    <span className="font-mono font-semibold text-[#526B7A]">
                      ₹{(selectedBillDetail.sale?.upi_paid || 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#9A938B] block text-[11px]">Card Paid</span>
                    <span className="font-mono font-semibold text-[#3730A3]">
                      ₹{(selectedBillDetail.sale?.card_paid || (selectedBillDetail.sale?.payment_method === 'CARD' ? selectedBillDetail.sale?.total_amount : 0) || 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#9A938B] block text-[11px]">Balance Due</span>
                    <span className="font-mono font-bold text-[#A34F4F]">
                      ₹{(selectedBillDetail.sale?.balance_due || 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedBillDetail.sale?.notes && (
                <div className="text-xs text-[#6F6962] bg-[#FAF8F4] p-3 rounded-lg border border-[#E3DED5]">
                  <span className="font-bold text-[#1C1917] block mb-0.5">Notes / Slip Reference:</span>
                  <span>{selectedBillDetail.sale.notes}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[#E3DED5] bg-[#FAF8F4] flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedBillDetail(null)}
                className="px-4 py-2 border border-[#D4CDC2] text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReceiptBill(selectedBillDetail.sale);
                  }}
                  className="px-4 py-2 bg-[#FAF8F4] hover:bg-[#F3EFE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
                >
                  <Printer className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>Print Slip</span>
                </button>

                {isOwner && selectedBillDetail.sale?.status !== 'CANCELLED' && (
                  <button
                    type="button"
                    onClick={() => {
                      setBillToCancel(selectedBillDetail.sale);
                      setCancelReason('Customer returned goods / handwritten error');
                      setCancelNotes('');
                      setCancelError(null);
                    }}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition"
                  >
                    <Ban className="w-3.5 h-3.5 text-white" />
                    <span>Cancel Bill</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Safe Authorized Cancellation Confirmation Modal */}
      {billToCancel && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl my-6 flex flex-col">
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/60 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-red-800">
                <Ban className="w-5 h-5 text-red-600" />
                <h3 className="font-bold text-sm">Cancel Handwritten Bill #{billToCancel.bill_number}</h3>
              </div>
              <button
                onClick={() => setBillToCancel(null)}
                disabled={cancelling}
                className="text-red-700 hover:text-red-900 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {cancelError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl font-medium">
                  {cancelError}
                </div>
              )}

              <p className="text-[#6F6962] leading-relaxed">
                Cancelling this handwritten bill will mark it as <strong className="text-red-700">CANCELLED</strong>, reverse any cash drawer entries (₹{billToCancel.cash_paid || 0}) or UPI entries (₹{billToCancel.upi_paid || 0}), clear customer dues, and preserve the full audit trail.
              </p>

              <div>
                <label className="block text-xs font-bold text-[#1C1917] mb-1">
                  Reason for Cancellation <span className="text-red-500">*</span>
                </label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs font-semibold text-[#1C1917] focus:outline-hidden"
                >
                  <option value="Customer returned goods / handwritten error">Customer returned goods / handwritten error</option>
                  <option value="Incorrect bill number or amount entered">Incorrect bill number or amount entered</option>
                  <option value="Duplicate entry entered by mistake">Duplicate entry entered by mistake</option>
                  <option value="Customer cancelled order before delivery">Customer cancelled order before delivery</option>
                  <option value="Other administrative correction">Other administrative correction</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Additional Notes
                </label>
                <input
                  type="text"
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Optional detail for audit record..."
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-hidden"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#E3DED5] bg-[#FAF8F4] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setBillToCancel(null)}
                disabled={cancelling}
                className="px-4 py-2 border border-[#D4CDC2] text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl text-xs font-semibold transition"
              >
                Keep Bill
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{cancelling ? 'Cancelling...' : 'Confirm Cancellation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Receipt Modal */}
      {receiptBill && (
        <ReceiptModal
          sale={receiptBill}
          onClose={() => setReceiptBill(null)}
          storeName="New Bhama Fashions"
          storeLocation="Chilakaluripet, Andhra Pradesh"
        />
      )}
    </div>
  );
};
