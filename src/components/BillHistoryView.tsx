import React, { useState, useEffect } from 'react';
import {
  Search,
  Calendar,
  Filter,
  Eye,
  RotateCcw,
  Ban,
  Printer,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Phone,
  ArrowLeft,
  RefreshCw,
  X,
  AlertCircle,
  ShieldAlert,
  FileText,
  CreditCard,
  Banknote,
  Smartphone,
  PackageCheck,
  CheckSquare,
  Square,
  Package,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { UserRole } from '../types.ts';
import { ReceiptModal } from './ReceiptModal.tsx';

interface BillHistoryViewProps {
  role: UserRole;
  onNavigateToPOS?: () => void;
}

export const BillHistoryView: React.FC<BillHistoryViewProps> = ({ role, onNavigateToPOS }) => {
  const isOwner = role === 'OWNER';

  // Filters & Search
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [bills, setBills] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Selected Bill Details Modal
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [billDetail, setBillDetail] = useState<{ sale: any; items: any[]; returns: any[]; customerDue?: any } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Bill Cancel Modal (Owner only)
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('Customer changed mind / requested refund');
  const [cancelNotes, setCancelNotes] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  // Item Return Modal
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'UPI' | 'ADJUST_CUSTOMER_DUE'>('CASH');
  const [returnReason, setReturnReason] = useState('Size / fit exchange or return');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  // Thermal Receipt reprint / Return slip print
  const [receiptSale, setReceiptSale] = useState<any | null>(null);
  const [receiptReturnRecord, setReceiptReturnRecord] = useState<any | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load Bills List
  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await api.getBills({
        search: search.trim() || undefined,
        date: dateFilter || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setBills(res.bills || []);
      setTotalCount(res.bills?.length || 0);
    } catch (err: any) {
      console.error('Failed to load bills:', err);
      showNotice('error', err.message || 'Failed to load bills history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, [dateFilter, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchBills();
  };

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // View Bill Details
  const handleOpenDetail = async (billId: string) => {
    setSelectedBillId(billId);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await api.getBillDetail(billId);
      setBillDetail(res);
      // Reset return form state
      const initialQty: Record<string, number> = {};
      res.items.forEach((item: any) => {
        initialQty[item.id] = 0;
      });
      setReturnQuantities(initialQty);
      // Default refund method based on original payment
      if (res.sale.payment_method === 'UPI') {
        setRefundMethod('UPI');
      } else if (res.sale.balance_due > 0) {
        setRefundMethod('ADJUST_CUSTOMER_DUE');
      } else {
        setRefundMethod('CASH');
      }
    } catch (err: any) {
      setDetailError(err.message || 'Failed to fetch bill details');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Direct open Return Items modal from list
  const handleOpenReturnModal = async (billId: string) => {
    setSelectedBillId(billId);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await api.getBillDetail(billId);
      setBillDetail(res);
      const initialQty: Record<string, number> = {};
      res.items.forEach((item: any) => {
        initialQty[item.id] = 0;
      });
      setReturnQuantities(initialQty);
      if (res.sale.payment_method === 'UPI') {
        setRefundMethod('UPI');
      } else if (res.sale.balance_due > 0) {
        setRefundMethod('ADJUST_CUSTOMER_DUE');
      } else {
        setRefundMethod('CASH');
      }
      setShowReturnModal(true);
    } catch (err: any) {
      showNotice('error', err.message || 'Failed to fetch bill details for return');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Direct open Cancel Bill modal from list (Owner only)
  const handleOpenCancelModal = async (billId: string) => {
    setSelectedBillId(billId);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await api.getBillDetail(billId);
      setBillDetail(res);
      setShowCancelModal(true);
    } catch (err: any) {
      showNotice('error', err.message || 'Failed to fetch bill details for cancellation');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Item-level selection helpers
  const handleSelectAllRemaining = () => {
    if (!billDetail?.items) return;
    const newQty: Record<string, number> = {};
    billDetail.items.forEach((it: any) => {
      const prevRet = it.returned_quantity || it.returned_qty || 0;
      const maxReturnable = Math.max(0, it.quantity - prevRet);
      newQty[it.id] = maxReturnable;
    });
    setReturnQuantities(newQty);
  };

  const handleClearSelection = () => {
    if (!billDetail?.items) return;
    const newQty: Record<string, number> = {};
    billDetail.items.forEach((it: any) => {
      newQty[it.id] = 0;
    });
    setReturnQuantities(newQty);
  };

  const handleToggleItem = (itemId: string, maxReturnable: number) => {
    const current = returnQuantities[itemId] || 0;
    setReturnQuantities((prev) => ({
      ...prev,
      [itemId]: current > 0 ? 0 : maxReturnable,
    }));
  };

  const handleSetQuantity = (itemId: string, val: number, maxReturnable: number) => {
    const clamped = Math.max(0, Math.min(maxReturnable, Math.floor(val) || 0));
    setReturnQuantities((prev) => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  // Execute Full Bill Cancel / Void (Owner Only)
  const handleConfirmCancel = async () => {
    if (!billDetail?.sale) return;
    if (!cancelReason.trim()) {
      showNotice('error', 'Cancellation reason is mandatory.');
      return;
    }

    setCancelSubmitting(true);
    try {
      const res = await api.cancelBill(billDetail.sale.id, {
        reason: cancelReason.trim(),
        notes: cancelNotes.trim() || undefined,
      });
      showNotice('success', res.message || `Bill ${billDetail.sale.bill_number} successfully cancelled.`);
      setShowCancelModal(false);
      // Refresh details & list
      await handleOpenDetail(billDetail.sale.id);
      fetchBills();
    } catch (err: any) {
      showNotice('error', err.message || 'Failed to cancel bill');
    } finally {
      setCancelSubmitting(false);
    }
  };

  // Execute Partial Item Return
  const handleConfirmReturn = async () => {
    if (!billDetail?.sale) return;

    const itemsToReturn = Object.entries(returnQuantities)
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([saleItemId, quantity]) => ({
        sale_item_id: saleItemId,
        quantity: Number(quantity),
      }));

    if (itemsToReturn.length === 0) {
      showNotice('error', 'Please specify quantity to return for at least one item.');
      return;
    }

    setReturnSubmitting(true);
    try {
      const res = await api.returnBillItems(billDetail.sale.id, {
        items: itemsToReturn,
        refund_method: refundMethod,
        reason: returnReason.trim(),
        notes: returnNotes.trim() || undefined,
      });

      showNotice('success', `Return ${res.return_record.return_number} processed successfully. Refund: ₹${res.return_record.refund_amount}`);
      setShowReturnModal(false);
      // Automatically prompt return slip
      setReceiptReturnRecord(res.return_record);
      // Refresh
      await handleOpenDetail(billDetail.sale.id);
      fetchBills();
    } catch (err: any) {
      showNotice('error', err.message || 'Failed to process return');
    } finally {
      setReturnSubmitting(false);
    }
  };

  // Calculate return preview
  const calculateReturnTotal = () => {
    if (!billDetail?.items) return 0;
    let total = 0;
    billDetail.items.forEach((item) => {
      const qty = returnQuantities[item.id] || 0;
      if (qty > 0) {
        // unit net price proportional
        const itemNetTotal = item.total_price || (item.quantity * item.unit_price);
        const unitNet = item.quantity > 0 ? (itemNetTotal / item.quantity) : item.unit_price;
        total += Math.round(unitNet * qty);
      }
    });
    return total;
  };

  const calculatedReturnAmount = calculateReturnTotal();

  const totalItemsReturning: number = (Object.values(returnQuantities) as number[]).reduce<number>(
    (acc, q) => acc + (Number(q) || 0),
    0
  );

  const totalPrevRefunds = billDetail?.returns?.reduce((acc: number, r: any) => acc + (Number(r.refund_amount) || 0), 0) || billDetail?.sale?.total_refunded_amount || 0;

  const remainingSaleValue = billDetail?.sale ? Math.max(0, billDetail.sale.total_amount - totalPrevRefunds - calculatedReturnAmount) : 0;

  const hasAnyReturnableItems = billDetail?.items?.some((it: any) => {
    const prev = it.returned_quantity || it.returned_qty || 0;
    return it.quantity - prev > 0;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center gap-2 ${
            notification.type === 'success'
              ? 'bg-[#EBF7EE] text-[#1E6B37] border-[#BDE5C8]'
              : 'bg-[#FDF5F5] text-[#A34F4F] border-[#F0CCCC]'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#E3DED5] shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1C1917] tracking-tight">Completed Bills &amp; Returns</h1>
            <span className="text-xs bg-[#FAF8F4] border border-[#E3DED5] px-2.5 py-0.5 rounded-full font-semibold text-[#6F6962]">
              {totalCount} Bills
            </span>
          </div>
          <p className="text-xs text-[#6F6962] mt-1">
            Search past sales, reprint thermal receipts, process customer item returns, and cancel/void bills with complete audit trail.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchBills}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#D4CDC2] bg-[#FAF8F4] hover:bg-white text-[#1C1917] flex items-center gap-1.5 transition disabled:opacity-50"
            title="Refresh bills list"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#A67C52] ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {onNavigateToPOS && (
            <button
              onClick={onNavigateToPOS}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#171513] hover:bg-[#2A221B] text-[#F5F2EC] flex items-center gap-1.5 shadow-sm transition"
            >
              <span>+ New POS Bill</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-[#E3DED5] shadow-xs flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 text-[#9A938B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Bill # (e.g. 0001), Customer name, phone..."
            className="w-full pl-9 pr-4 py-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52] transition placeholder-[#9A938B]"
          />
        </form>

        {/* Date Filter */}
        <div className="flex items-center gap-1.5 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl px-2.5 py-1.5 text-xs text-[#1C1917]">
          <Calendar className="w-3.5 h-3.5 text-[#A67C52]" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="bg-transparent text-xs focus:outline-none text-[#1C1917]"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter('')}
              className="p-0.5 hover:text-[#A34F4F] transition text-[#9A938B]"
              title="Clear date"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl px-3 py-1.5 text-xs text-[#1C1917]">
          <Filter className="w-3.5 h-3.5 text-[#A67C52]" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-transparent text-xs focus:outline-none text-[#1C1917] font-medium"
          >
            <option value="">All Statuses</option>
            <option value="COMPLETED">Active (Completed)</option>
            <option value="CANCELLED">Cancelled / Void</option>
          </select>
        </div>

        <button
          type="button"
          onClick={fetchBills}
          className="px-3.5 py-2 bg-[#A67C52] hover:bg-[#8E653E] text-white rounded-xl text-xs font-semibold transition"
        >
          Apply Filters
        </button>
      </div>

      {/* Bills Table */}
      <div className="bg-white rounded-2xl border border-[#E3DED5] overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1C1917]">
            <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[11px] font-bold text-[#6F6962] uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Bill No</th>
                <th className="py-3.5 px-4">Date &amp; Time</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-3 text-center">Items</th>
                <th className="py-3.5 px-4 text-right">Bill Total</th>
                <th className="py-3.5 px-3 text-center">Payment</th>
                <th className="py-3.5 px-3 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DED5]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#9A938B]">
                    <div className="w-6 h-6 border-2 border-[#A67C52] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <span>Loading bill records...</span>
                  </td>
                </tr>
              ) : bills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#9A938B]">
                    <FileText className="w-8 h-8 stroke-1 text-[#A67C52] mx-auto mb-2 opacity-50" />
                    <p className="font-medium text-[#1C1917]">No bills found</p>
                    <p className="text-[11px] text-[#6F6962] mt-0.5">Try changing your search terms or date filter.</p>
                  </td>
                </tr>
              ) : (
                bills.map((bill) => {
                  const isCancelled = bill.status === 'CANCELLED';
                  const hasReturns = bill.return_count > 0;
                  const totalRefund = bill.total_refunded_amount || 0;

                  return (
                    <tr
                      key={bill.id}
                      className={`hover:bg-[#FAF8F4]/80 transition ${
                        isCancelled ? 'bg-[#FCF7F7]/60 text-[#8C6969]' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-xs">
                        <span className={isCancelled ? 'line-through text-[#A34F4F]' : 'text-[#1C1917]'}>
                          {bill.bill_number}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#6F6962] whitespace-nowrap">
                        <div>
                          {new Date(bill.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[10px] text-[#9A938B]">
                          {new Date(bill.created_at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#1C1917] truncate max-w-[160px]">
                          {bill.customer_name || 'Walk-in Customer'}
                        </div>
                        {bill.customer_phone && (
                          <div className="text-[10px] text-[#6F6962]">{bill.customer_phone}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-[#FAF8F4] border border-[#E3DED5] font-semibold text-[11px]">
                          {bill.item_count || 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className={`font-bold ${isCancelled ? 'line-through text-[#9A938B]' : 'text-[#1C1917]'}`}>
                          ₹{bill.total_amount}
                        </div>
                        {hasReturns && !isCancelled && (
                          <div className="text-[10px] font-semibold text-[#A34F4F]">
                            -₹{totalRefund} ret
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            bill.payment_method === 'CASH'
                              ? 'bg-[#EBF7EE] text-[#1E6B37]'
                              : bill.payment_method === 'UPI'
                              ? 'bg-[#EEF2F6] text-[#2F527E]'
                              : bill.payment_method === 'CREDIT'
                              ? 'bg-[#FFF4E5] text-[#B76E00]'
                              : 'bg-[#F2EFFC] text-[#5E3FB5]'
                          }`}
                        >
                          {bill.payment_method}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {isCancelled ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5] shadow-2xs tracking-wide">
                            <Ban className="w-3.5 h-3.5 text-[#991B1B]" />
                            CANCELLED
                          </span>
                        ) : (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#EBF7EE] text-[#166534] border border-[#86EFAC] shadow-2xs tracking-wide">
                              <CheckCircle className="w-3.5 h-3.5 text-[#166534]" />
                              COMPLETED
                            </span>
                            {hasReturns && (
                              <span className="text-[10px] font-bold text-[#B76E00] mt-0.5 flex items-center gap-0.5">
                                <RotateCcw className="w-2.5 h-2.5" />
                                Partial Return (-₹{totalRefund})
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenDetail(bill.id)}
                            className="px-3 py-1.5 rounded-lg border border-[#A67C52] bg-[#FAF8F4] hover:bg-[#A67C52] hover:text-white text-[#A67C52] transition text-xs flex items-center gap-1.5 font-bold shadow-2xs"
                            title="View full bill transaction details, product list & actions"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Details</span>
                          </button>
                          <button
                            onClick={() => {
                              // Direct Thermal Print
                              api.getBillDetail(bill.id).then((d) => {
                                setReceiptSale(d.sale);
                              });
                            }}
                            className="p-1.5 px-2 rounded-lg border border-[#D4CDC2] bg-white hover:bg-[#FAF8F4] text-[#6F6962] hover:text-[#1C1917] transition text-xs flex items-center gap-1 font-medium shadow-2xs"
                            title="Reprint 80mm Thermal Receipt"
                          >
                            <Printer className="w-3.5 h-3.5 text-[#A67C52]" />
                            <span className="hidden sm:inline">Reprint</span>
                          </button>
                          {!isCancelled && (
                            <button
                              onClick={() => handleOpenReturnModal(bill.id)}
                              className="p-1.5 px-2 rounded-lg border border-[#D4CDC2] bg-white hover:bg-[#FAF8F4] text-[#6F6962] hover:text-[#A67C52] transition text-xs flex items-center gap-1 font-medium shadow-2xs"
                              title="Directly open return window for this bill"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Return</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BILL DETAILS MODAL (Details, Returns, and Void Actions)           */}
      {/* ================================================================= */}
      {selectedBillId && (
        <div className="fixed inset-0 z-50 bg-[#171513]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#E3DED5] max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden my-6">
            {/* Modal Header */}
            <div className="p-4 bg-[#171513] text-[#F5F2EC] flex items-center justify-between border-b border-[#2A2521]">
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-[#A67C52]" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm tracking-tight">
                      Bill Details &bull; {billDetail?.sale?.bill_number || 'Loading...'}
                    </h3>
                    {billDetail?.sale && (
                      billDetail.sale.status === 'CANCELLED' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF2F2] text-[#991B1B] border border-[#FCA5A5] shadow-2xs">
                          <Ban className="w-3 h-3 text-[#991B1B]" />
                          CANCELLED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF7EE] text-[#166534] border border-[#86EFAC] shadow-2xs">
                          <CheckCircle className="w-3 h-3 text-[#166534]" />
                          COMPLETED
                        </span>
                      )
                    )}
                  </div>
                  <p className="text-[11px] text-[#9A938B]">
                    New Bhama Fashions &bull; Chilakaluripet
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedBillId(null)}
                className="p-1 rounded-lg text-[#9A938B] hover:text-[#F5F2EC] hover:bg-[#25211D] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-[#1C1917]">
              {loadingDetail ? (
                <div className="py-16 text-center text-[#9A938B]">
                  <div className="w-8 h-8 border-2 border-[#A67C52] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p>Loading full bill transaction record...</p>
                </div>
              ) : detailError ? (
                <div className="p-4 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F]">
                  <p className="font-bold">Error loading bill</p>
                  <p>{detailError}</p>
                </div>
              ) : billDetail ? (
                <>
                  {/* CANCELLED WATERMARK BANNER */}
                  {billDetail.sale.status === 'CANCELLED' && (
                    <div className="p-4 bg-[#FDF5F5] border-2 border-[#F0CCCC] rounded-2xl text-[#A34F4F] space-y-1.5">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <AlertTriangle className="w-4 h-4 text-[#A34F4F]" />
                        <span>THIS BILL WAS CANCELLED &amp; VOIDED</span>
                      </div>
                      <p className="text-xs text-[#6F6962]">
                        Cancelled by <strong className="text-[#1C1917]">{billDetail.sale.cancelled_by_name || 'Store Owner'}</strong> on{' '}
                        {new Date(billDetail.sale.cancelled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                      <p className="text-xs text-[#6F6962]">
                        Reason: <span className="font-semibold text-[#A34F4F]">{billDetail.sale.cancelled_reason}</span>
                      </p>
                      <p className="text-[11px] text-[#6F6962] italic mt-1">
                        Stock has been restored to FIFO purchase batches, financial transactions reversed, and customer dues updated. Bill number is retained for auditing.
                      </p>
                    </div>
                  )}

                  {/* Summary Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                    <div>
                      <span className="text-[10px] text-[#6F6962] font-medium block">Date &amp; Time</span>
                      <span className="font-semibold text-xs">
                        {new Date(billDetail.sale.created_at).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#6F6962] font-medium block">Customer</span>
                      <span className="font-semibold text-xs truncate block">
                        {billDetail.sale.customer_name || 'Walk-in Customer'}
                      </span>
                      {billDetail.sale.customer_phone && (
                        <span className="text-[10px] text-[#6F6962]">{billDetail.sale.customer_phone}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] text-[#6F6962] font-medium block">Payment Method</span>
                      <span className="font-bold text-xs uppercase text-[#A67C52]">
                        {billDetail.sale.payment_method}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#6F6962] font-medium block">Cashier / Staff</span>
                      <span className="font-semibold text-xs">{billDetail.sale.cashier_name || 'Staff'}</span>
                    </div>
                  </div>

                  {/* Full List of Products */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-[#A67C52]" />
                        <h4 className="font-bold text-xs uppercase text-[#1C1917] tracking-wider">
                          Full List of Products ({billDetail.items.length})
                        </h4>
                      </div>
                      {billDetail.sale.status === 'COMPLETED' && hasAnyReturnableItems && (
                        <button
                          type="button"
                          onClick={() => setShowReturnModal(true)}
                          className="text-[11px] font-semibold text-[#A67C52] hover:text-[#8E653E] flex items-center gap-1 transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Return Item(s)</span>
                        </button>
                      )}
                    </div>
                    <div className="border border-[#E3DED5] rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[10px] font-bold text-[#6F6962] uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Item / Garment</th>
                            <th className="py-2.5 px-2 text-center">Billed</th>
                            <th className="py-2.5 px-2 text-center">Returned</th>
                            <th className="py-2.5 px-2 text-center">Remaining</th>
                            <th className="py-2.5 px-3 text-right">Net Price</th>
                            <th className="py-2.5 px-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED5]">
                          {billDetail.items.map((it: any) => {
                            const prevRet = it.returned_quantity || it.returned_qty || 0;
                            const remaining = Math.max(0, it.quantity - prevRet);
                            const itemNetTotal = it.total_price || (it.quantity * it.unit_price);
                            const unitNet = it.quantity > 0 ? (itemNetTotal / it.quantity) : it.unit_price;

                            return (
                              <tr key={it.id} className="hover:bg-[#FAF8F4]/50">
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-[#1C1917]">{it.product_name}</div>
                                  {it.product_code && (
                                    <div className="text-[10px] font-mono text-[#9A938B]">SKU: {it.product_code}</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-center font-bold">{it.quantity}</td>
                                <td className="py-2.5 px-2 text-center">
                                  {prevRet > 0 ? (
                                    <span className="text-[#A34F4F] font-bold">
                                      {prevRet} ret
                                    </span>
                                  ) : (
                                    <span className="text-[#9A938B]">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-center">
                                  {remaining === 0 ? (
                                    <span className="text-[10px] text-[#9A938B] font-semibold bg-[#FAF8F4] px-1.5 py-0.5 rounded">
                                      Fully Ret
                                    </span>
                                  ) : (
                                    <span className="text-[11px] font-bold text-[#1E6B37]">
                                      {remaining} left
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right text-[#6F6962]">₹{Math.round(unitNet)}</td>
                                <td className="py-2.5 px-3 text-right font-bold text-[#1C1917]">₹{it.total_price}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Financial Breakdown */}
                  <div className="bg-[#FAF8F4] p-4 rounded-xl border border-[#E3DED5] space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#6F6962]">
                      <span>Subtotal (Selling Price):</span>
                      <span>₹{billDetail.sale.subtotal}</span>
                    </div>
                    {billDetail.sale.festival_discount > 0 && (
                      <div className="flex justify-between text-[#B76E00]">
                        <span>Festival Offer Discount:</span>
                        <span>-₹{billDetail.sale.festival_discount}</span>
                      </div>
                    )}
                    {billDetail.sale.special_discount > 0 && (
                      <div className="flex justify-between text-[#1E6B37]">
                        <span>Owner Special Discount:</span>
                        <span>-₹{billDetail.sale.special_discount}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm text-[#1C1917] pt-1.5 border-t border-[#E3DED5]">
                      <span>Original Bill Grand Total:</span>
                      <span>₹{billDetail.sale.total_amount}</span>
                    </div>

                    {totalPrevRefunds > 0 && (
                      <div className="flex justify-between font-semibold text-[#A34F4F] pt-1">
                        <span>Total Items Refunded:</span>
                        <span>-₹{totalPrevRefunds}</span>
                      </div>
                    )}

                    {totalPrevRefunds > 0 && (
                      <div className="flex justify-between font-bold text-xs text-[#1C1917]">
                        <span>Net Active Bill Value:</span>
                        <span>₹{Math.max(0, billDetail.sale.total_amount - totalPrevRefunds)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-[11px] text-[#6F6962] pt-1 border-t border-[#E3DED5]">
                      <span>Amount Paid: ₹{billDetail.sale.amount_paid} ({billDetail.sale.payment_method})</span>
                      {billDetail.sale.balance_due > 0 && (
                        <span className="text-[#A34F4F] font-bold">
                          Balance Due (Credit): ₹{billDetail.sale.balance_due}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Return Records History (if any) */}
                  {billDetail.returns && billDetail.returns.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-bold text-xs uppercase text-[#6F6962] tracking-wider flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5 text-[#A67C52]" />
                        <span>Return &amp; Refund History ({billDetail.returns.length})</span>
                      </h4>
                      <div className="space-y-2">
                        {billDetail.returns.map((ret: any) => (
                          <div
                            key={ret.id}
                            className="p-3 bg-white border border-[#E3DED5] rounded-xl flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-bold font-mono text-[#1C1917]">{ret.return_number}</div>
                              <div className="text-[11px] text-[#6F6962]">
                                {new Date(ret.created_at).toLocaleString('en-IN', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}{' '}
                                &bull; Refund: <strong className="text-[#1E6B37]">₹{ret.refund_amount}</strong> via{' '}
                                <span className="font-semibold uppercase">{ret.refund_method}</span>
                              </div>
                              {ret.reason && (
                                <div className="text-[10px] text-[#9A938B]">Reason: {ret.reason}</div>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setReceiptReturnRecord(ret);
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-[#D4CDC2] bg-[#FAF8F4] hover:bg-white text-[#1C1917] text-[11px] font-semibold flex items-center gap-1 transition"
                            >
                              <Printer className="w-3 h-3 text-[#A67C52]" />
                              <span>Print Return Slip</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Modal Actions Footer */}
            {billDetail?.sale && (
              <div className="p-4 bg-[#FAF8F4] border-t border-[#E3DED5] flex flex-wrap items-center justify-between gap-3">
                {/* Action 1: [Reprint Receipt] */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptSale(billDetail.sale);
                    }}
                    className="px-4 py-2.5 rounded-xl border border-[#D4CDC2] bg-white hover:bg-[#FAF8F4] text-[#1C1917] text-xs font-bold flex items-center gap-2 shadow-2xs transition hover:border-[#A67C52]"
                    title="Reprint 80mm thermal paper receipt"
                  >
                    <Printer className="w-4 h-4 text-[#A67C52]" />
                    <span>Reprint Receipt</span>
                  </button>
                </div>

                {/* Contextual Actions 2 & 3: [Return Item(s)] and [Cancel Entire Bill] */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Action 2: [Return Item(s)] */}
                  {billDetail.sale.status === 'COMPLETED' ? (
                    hasAnyReturnableItems ? (
                      <button
                        type="button"
                        onClick={() => setShowReturnModal(true)}
                        className="px-4 py-2.5 rounded-xl border border-[#A67C52] bg-white hover:bg-[#A67C52] text-[#A67C52] hover:text-white text-xs font-bold flex items-center gap-2 transition shadow-2xs"
                        title="Process item returns on this bill"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Return Item(s)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="px-3.5 py-2.5 rounded-xl border border-[#BDE5C8] bg-[#EBF7EE] text-[#1E6B37] text-xs font-semibold flex items-center gap-1.5 opacity-80 cursor-not-allowed shadow-2xs"
                        title="All items on this bill have already been returned"
                      >
                        <PackageCheck className="w-4 h-4" />
                        <span>Return Item(s) (All Returned)</span>
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="px-3.5 py-2.5 rounded-xl border border-[#E3DED5] bg-[#FAF8F4] text-[#9A938B] text-xs font-semibold flex items-center gap-1.5 opacity-60 cursor-not-allowed"
                      title="Item returns cannot be processed on a cancelled bill"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Return Item(s) (Cancelled)</span>
                    </button>
                  )}

                  {/* Action 3: [Cancel Entire Bill] */}
                  {billDetail.sale.status === 'COMPLETED' ? (
                    isOwner ? (
                      <button
                        type="button"
                        onClick={() => setShowCancelModal(true)}
                        disabled={billDetail.returns && billDetail.returns.length > 0}
                        title={
                          billDetail.returns && billDetail.returns.length > 0
                            ? 'Cannot cancel entire bill with existing item returns. Return remaining items instead.'
                            : 'Void & cancel the entire bill, restore inventory batches, and reverse payment'
                        }
                        className="px-4 py-2.5 rounded-xl bg-[#A34F4F] hover:bg-[#863D3D] text-white text-xs font-bold flex items-center gap-2 shadow-2xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Ban className="w-4 h-4" />
                        <span>Cancel Entire Bill</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Only store owners have permission to cancel completed bills"
                        className="px-3.5 py-2.5 rounded-xl border border-[#E3DED5] bg-[#FAF8F4] text-[#9A938B] text-xs font-semibold flex items-center gap-1.5 opacity-75 cursor-not-allowed"
                      >
                        <ShieldAlert className="w-4 h-4 text-[#A67C52]" />
                        <span>Cancel Entire Bill (Owner Only)</span>
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="px-3.5 py-2.5 rounded-xl border border-[#F0CCCC] bg-[#FDF5F5] text-[#A34F4F] text-xs font-bold flex items-center gap-1.5 opacity-60 cursor-not-allowed"
                      title="This bill has already been cancelled and voided"
                    >
                      <Ban className="w-4 h-4" />
                      <span>Cancel Entire Bill (Already Cancelled)</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* CANCEL / VOID BILL CONFIRMATION MODAL (OWNER ONLY)                */}
      {/* ================================================================= */}
      {showCancelModal && billDetail?.sale && (
        <div className="fixed inset-0 z-60 bg-[#171513]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#E3DED5] max-w-md w-full overflow-hidden">
            <div className="p-4 bg-[#A34F4F] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <h3 className="font-bold text-sm">Void &amp; Cancel Bill {billDetail.sale.bill_number}</h3>
              </div>
              <button
                onClick={() => setShowCancelModal(false)}
                className="text-white/80 hover:text-white p-1 rounded-md transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-[#1C1917]">
              <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F] space-y-1">
                <p className="font-bold">Permanent Cancellation Warning</p>
                <p className="text-[11px] text-[#6F6962]">
                  This will mark Bill <strong>{billDetail.sale.bill_number}</strong> as CANCELLED. All {billDetail.items.length} items will be restored to inventory via FIFO batches.
                </p>
                {billDetail.sale.amount_paid > 0 && (
                  <p className="text-[11px] text-[#6F6962]">
                    Paid amount of <strong>₹{billDetail.sale.amount_paid}</strong> ({billDetail.sale.payment_method}) will be refunded / reversed in Day Book.
                  </p>
                )}
                {billDetail.sale.balance_due > 0 && (
                  <p className="text-[11px] text-[#6F6962]">
                    Customer credit due of <strong>₹{billDetail.sale.balance_due}</strong> will be cancelled.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#1C1917] uppercase tracking-wider mb-1">
                  Reason for Cancellation *
                </label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="Customer changed mind / requested refund">Customer changed mind / requested refund</option>
                  <option value="Billing mistake / wrong price entered">Billing mistake / wrong price entered</option>
                  <option value="Wrong customer attached">Wrong customer attached</option>
                  <option value="Duplicate bill generated">Duplicate bill generated</option>
                  <option value="Garment defect discovered at billing">Garment defect discovered at billing</option>
                  <option value="Other cancellation">Other cancellation</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#1C1917] uppercase tracking-wider mb-1">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="E.g. Approved by Owner in person, cash drawer refunded..."
                  rows={2}
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52] resize-none"
                />
              </div>
            </div>

            <div className="p-4 bg-[#FAF8F4] border-t border-[#E3DED5] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                disabled={cancelSubmitting}
                className="px-4 py-2 border border-[#D4CDC2] bg-white hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl text-xs font-semibold transition"
              >
                Keep Bill Active
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelSubmitting}
                className="px-4 py-2 bg-[#A34F4F] hover:bg-[#863D3D] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {cancelSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Cancelling Bill...</span>
                  </>
                ) : (
                  <span>Confirm Cancel &amp; Void</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* PARTIAL ITEM RETURN MODAL                                         */}
      {/* ================================================================= */}
      {showReturnModal && billDetail?.sale && (
        <div className="fixed inset-0 z-60 bg-[#171513]/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#E3DED5] max-w-xl w-full overflow-hidden my-6">
            <div className="p-4 bg-[#171513] text-[#F5F2EC] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <RotateCcw className="w-4 h-4 text-[#A67C52]" />
                <div>
                  <h3 className="font-bold text-sm">Return Items &bull; {billDetail.sale.bill_number}</h3>
                  <p className="text-[10px] text-[#9A938B]">
                    Customer: {billDetail.sale.customer_name || 'Walk-in'} &bull; Date: {new Date(billDetail.sale.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowReturnModal(false)}
                className="text-[#9A938B] hover:text-[#F5F2EC] p-1 rounded-md transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-[#1C1917] max-h-[75vh] overflow-y-auto">
              {/* Quick helper selection bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                <div className="text-[11px] text-[#6F6962]">
                  Select products and quantities for customer return:
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAllRemaining}
                    className="px-2.5 py-1 bg-white border border-[#D4CDC2] hover:border-[#A67C52] text-[#A67C52] rounded-lg text-[11px] font-semibold transition shadow-2xs"
                  >
                    Select All Returnable
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="px-2.5 py-1 bg-white border border-[#D4CDC2] hover:border-[#6F6962] text-[#6F6962] rounded-lg text-[11px] font-semibold transition shadow-2xs"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Items Return Table */}
              <div className="border border-[#E3DED5] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[10px] font-bold text-[#6F6962] uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Item / Product</th>
                      <th className="py-2.5 px-2 text-center">Billed</th>
                      <th className="py-2.5 px-2 text-center">Returned</th>
                      <th className="py-2.5 px-2 text-center">Available</th>
                      <th className="py-2.5 px-3 text-center">Return Qty</th>
                      <th className="py-2.5 px-3 text-right">Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3DED5]">
                    {billDetail.items.map((it: any) => {
                      const prevRet = it.returned_quantity || it.returned_qty || 0;
                      const maxReturnable = Math.max(0, it.quantity - prevRet);
                      const currentVal = returnQuantities[it.id] || 0;
                      const itemNetTotal = it.total_price || (it.quantity * it.unit_price);
                      const unitNet = it.quantity > 0 ? (itemNetTotal / it.quantity) : it.unit_price;
                      const lineRefund = Math.round(unitNet * currentVal);
                      const isSelected = currentVal > 0;

                      return (
                        <tr
                          key={it.id}
                          className={`transition ${isSelected ? 'bg-[#FFF9F2]' : 'hover:bg-[#FAF8F4]/50'}`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={maxReturnable <= 0}
                                onChange={() => handleToggleItem(it.id, maxReturnable)}
                                className="mt-0.5 rounded text-[#A67C52] focus:ring-[#A67C52] cursor-pointer disabled:cursor-not-allowed"
                              />
                              <div>
                                <div className="font-semibold text-[#1C1917]">{it.product_name}</div>
                                <div className="text-[10px] text-[#6F6962]">
                                  ₹{Math.round(unitNet)} net
                                  {it.product_code && <span className="font-mono ml-1">({it.product_code})</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold text-[#1C1917]">{it.quantity}</td>
                          <td className="py-2.5 px-2 text-center text-[#A34F4F]">
                            {prevRet > 0 ? `${prevRet}` : '-'}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {maxReturnable > 0 ? (
                              <span className="font-semibold text-[#1E6B37] bg-[#EBF7EE] px-1.5 py-0.5 rounded text-[11px]">
                                {maxReturnable}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9A938B] font-medium">None</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {maxReturnable > 0 ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleSetQuantity(it.id, currentVal - 1, maxReturnable)}
                                  disabled={currentVal <= 0}
                                  className="w-6 h-6 rounded bg-white border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] font-bold disabled:opacity-30 flex items-center justify-center transition"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={maxReturnable}
                                  value={currentVal}
                                  onChange={(e) => handleSetQuantity(it.id, Number(e.target.value), maxReturnable)}
                                  className="w-10 h-6 text-center font-bold bg-white border border-[#D4CDC2] rounded text-xs focus:outline-none focus:border-[#A67C52]"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSetQuantity(it.id, currentVal + 1, maxReturnable)}
                                  disabled={currentVal >= maxReturnable}
                                  className="w-6 h-6 rounded bg-white border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] font-bold disabled:opacity-30 flex items-center justify-center transition"
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetQuantity(it.id, maxReturnable, maxReturnable)}
                                  title="Return Maximum Available"
                                  className="px-1.5 h-6 text-[10px] font-semibold rounded bg-[#FAF8F4] hover:bg-[#E3DED5] text-[#6F6962] border border-[#D4CDC2] transition"
                                >
                                  Max
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-[#9A938B] font-semibold bg-[#FAF8F4] px-2 py-0.5 rounded">
                                Fully Returned
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-[#1C1917]">
                            {lineRefund > 0 ? (
                              <span className="text-[#A67C52]">₹{lineRefund}</span>
                            ) : (
                              <span className="text-[#9A938B]">₹0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Live Return Impact & Financial Summary Card */}
              <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5] space-y-2 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-[#E3DED5]">
                  <div>
                    <span className="text-[11px] text-[#6F6962] block">Items Selected for Return</span>
                    <span className="font-bold text-sm text-[#1C1917]">
                      {totalItemsReturning} item{totalItemsReturning === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-[#6F6962] block">Total Refund Calculated</span>
                    <span className="font-bold text-base text-[#1E6B37]">₹{calculatedReturnAmount}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#6F6962] pt-1">
                  <div>
                    Original Bill Total: <strong className="text-[#1C1917]">₹{billDetail.sale.total_amount}</strong>
                  </div>
                  <div className="text-right">
                    Active Net Bill After Return: <strong className="text-[#1C1917]">₹{remainingSaleValue}</strong>
                  </div>
                </div>

                <div className="p-2 bg-[#EBF7EE] border border-[#BDE5C8] rounded-lg text-[11px] text-[#1E6B37] flex items-start gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Stock will automatically return to original FIFO batches (Stock Ledger movement: <code>CUSTOMER_RETURN</code>), and COGS will be reversed.
                  </span>
                </div>
              </div>

              {/* Refund Method Selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-[#1C1917] uppercase tracking-wider">
                    Refund Payment Method *
                  </label>
                  {billDetail.sale.balance_due > 0 && (
                    <span className="text-[10px] text-[#B76E00] font-semibold bg-[#FFF4E5] px-2 py-0.5 rounded-full border border-[#FFE2B8]">
                      Pending Due on Bill: ₹{billDetail.sale.balance_due}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMethod('CASH')}
                    className={`p-2.5 rounded-xl border text-center font-semibold text-xs flex flex-col items-center gap-1 transition ${
                      refundMethod === 'CASH'
                        ? 'border-[#1E6B37] bg-[#EBF7EE] text-[#1E6B37] ring-1 ring-[#1E6B37]'
                        : 'border-[#E3DED5] bg-[#FAF8F4] text-[#1C1917] hover:bg-white'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Cash Drawer</span>
                    <span className="text-[9px] font-normal opacity-75">Pay physical cash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRefundMethod('UPI')}
                    className={`p-2.5 rounded-xl border text-center font-semibold text-xs flex flex-col items-center gap-1 transition ${
                      refundMethod === 'UPI'
                        ? 'border-[#2F527E] bg-[#EEF2F6] text-[#2F527E]'
                        : 'border-[#E3DED5] bg-[#FAF8F4] text-[#1C1917] hover:bg-white'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>UPI Transfer</span>
                    <span className="text-[9px] font-normal opacity-75">Online UPI refund</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRefundMethod('ADJUST_CUSTOMER_DUE')}
                    className={`p-2.5 rounded-xl border text-center font-semibold text-xs flex flex-col items-center gap-1 transition ${
                      refundMethod === 'ADJUST_CUSTOMER_DUE'
                        ? 'border-[#B76E00] bg-[#FFF4E5] text-[#B76E00]'
                        : 'border-[#E3DED5] bg-[#FAF8F4] text-[#1C1917] hover:bg-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Adjust Due</span>
                    <span className="text-[9px] font-normal opacity-75">Reduce customer credit</span>
                  </button>
                </div>
              </div>

              {/* Reason for Return */}
              <div>
                <label className="block text-[11px] font-bold text-[#1C1917] uppercase tracking-wider mb-1">
                  Return Reason *
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="Size / fit exchange or return">Size / fit exchange or return</option>
                  <option value="Customer color preference">Customer color preference</option>
                  <option value="Fabric defect or damage discovered">Fabric defect or damage discovered</option>
                  <option value="Purchased as gift, not fitting">Purchased as gift, not fitting</option>
                  <option value="Customer changed mind / not required">Customer changed mind / not required</option>
                  <option value="Billing mistake / extra item billed">Billing mistake / extra item billed</option>
                  <option value="Other customer return">Other customer return</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#1C1917] uppercase tracking-wider mb-1">
                  Customer Notes / Feedback (Optional)
                </label>
                <input
                  type="text"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="E.g. Customer returned 1 Kurti in good condition, unworn..."
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            </div>

            <div className="p-4 bg-[#FAF8F4] border-t border-[#E3DED5] flex items-center justify-between gap-3">
              <div className="text-[11px] text-[#6F6962]">
                {totalItemsReturning > 0 ? (
                  <span>
                    Refund: <strong className="text-[#1E6B37]">₹{calculatedReturnAmount}</strong> ({totalItemsReturning} items)
                  </span>
                ) : (
                  <span className="text-[#9A938B]">Select items above to return</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  disabled={returnSubmitting}
                  className="px-4 py-2 border border-[#D4CDC2] bg-white hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl text-xs font-semibold transition shadow-2xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReturn}
                  disabled={returnSubmitting || calculatedReturnAmount <= 0 || totalItemsReturning <= 0}
                  className="px-4 py-2 bg-[#A67C52] hover:bg-[#8E653E] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                >
                  {returnSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Processing Return...</span>
                    </>
                  ) : (
                    <span>Process Return &amp; Print Slip (₹{calculatedReturnAmount})</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* THERMAL RECEIPT / RETURN SLIP MODAL                               */}
      {/* ================================================================= */}
      {(receiptSale || receiptReturnRecord) && (
        <ReceiptModal
          sale={receiptSale}
          returnRecord={receiptReturnRecord}
          onClose={() => {
            setReceiptSale(null);
            setReceiptReturnRecord(null);
          }}
        />
      )}
    </div>
  );
};
