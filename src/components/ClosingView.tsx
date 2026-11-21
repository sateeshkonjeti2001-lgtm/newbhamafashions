import React, { useState, useEffect } from 'react';
import {
  Lock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Smartphone,
  Wallet,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  History,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { DailyClosing, UserRole } from '../types.ts';
import { getTodayIST, formatDateTimeIST } from '../utils/date.ts';
import { OwnerOverridePrompt } from './OwnerOverridePrompt.tsx';

interface ClosingViewProps {
  role: UserRole;
}

export const ClosingView: React.FC<ClosingViewProps> = ({ role }) => {
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<DailyClosing[]>([]);
  const [loading, setLoading] = useState(true);

  // Closing Form state
  const [actualCash, setActualCash] = useState<number | ''>('');
  const [actualUpi, setActualUpi] = useState<number | ''>('');
  const [cashLeftInDrawer, setCashLeftInDrawer] = useState<number | ''>(0);
  const [cashTakenHome, setCashTakenHome] = useState<number | ''>('');
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  const [closingError, setClosingError] = useState<string | null>(null);
  const [closingSuccess, setClosingSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Closed-Day Owner Override / Reconcile State
  const [unlockClosedEdit, setUnlockClosedEdit] = useState(false);
  const [showOverridePrompt, setShowOverridePrompt] = useState(false);
  const [overrideAction, setOverrideAction] = useState<'update' | 'reconcile'>('reconcile');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const isOwner = role === 'OWNER';

  const loadData = async () => {
    setLoading(true);
    setUnlockClosedEdit(false);
    try {
      const [sumRes, histRes] = await Promise.all([
        api.getDayClosingSummary(selectedDate),
        api.getDailyClosings(),
      ]);
      setSummary(sumRes);
      setHistory(histRes.closings || []);

      if (sumRes.closingRecord) {
        const countedCash = Number(sumRes.closingRecord.actual_counted_cash ?? sumRes.systemExpectedCash ?? 0);
        const drawerFloat = Number(sumRes.closingRecord.cash_left_in_drawer ?? 0);
        setActualCash(countedCash);
        setActualUpi(
          sumRes.closingRecord.actual_upi_counted !== null && sumRes.closingRecord.actual_upi_counted !== undefined
            ? Number(sumRes.closingRecord.actual_upi_counted)
            : sumRes.systemExpectedUpi
        );
        setCashLeftInDrawer(drawerFloat);
        setCashTakenHome(
          sumRes.closingRecord.cash_taken_home !== null && sumRes.closingRecord.cash_taken_home !== undefined
            ? Number(sumRes.closingRecord.cash_taken_home)
            : Math.max(0, countedCash - drawerFloat)
        );
        setDiscrepancyReason(sumRes.closingRecord.discrepancy_reason || '');
        setClosingNotes(sumRes.closingRecord.closing_notes || '');
      } else {
        setActualCash(sumRes.systemExpectedCash);
        setActualUpi(sumRes.systemExpectedUpi);
        setCashLeftInDrawer(0);
        setCashTakenHome(sumRes.systemExpectedCash);
        setDiscrepancyReason('');
        setClosingNotes('');
      }
    } catch (err: any) {
      console.error('Error loading closing data:', err);
      setClosingError(err.message || 'Failed to load day closing summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary) return;

    const actualCashNum = Number(actualCash) || 0;
    const actualUpiNum = Number(actualUpi) || 0;
    const discrepancy = actualCashNum - summary.systemExpectedCash;

    if (discrepancy !== 0 && !discrepancyReason.trim()) {
      setClosingError(
        `Physical cash discrepancy detected (${discrepancy > 0 ? '+₹' + discrepancy : '-₹' + Math.abs(discrepancy)}). Please provide a reason.`
      );
      return;
    }

    if (summary.isClosed) {
      setOverrideAction('update');
      setOverrideError(null);
      setShowOverridePrompt(true);
      return;
    }

    setSubmitting(true);
    setClosingError(null);
    setClosingSuccess(null);

    try {
      await api.closeDay({
        date: selectedDate,
        opening_cash: summary.openingCash,
        actual_cash_counted: actualCashNum,
        actual_upi_counted: actualUpiNum,
        cash_left_in_drawer: Number(cashLeftInDrawer) || 0,
        cash_taken_home: Number(cashTakenHome) || 0,
        discrepancy_reason: discrepancyReason.trim() || null,
        closing_notes: closingNotes.trim() || null,
      });

      setClosingSuccess(`Business Day ${selectedDate} closed and locked successfully.`);
      loadData();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideAction('update');
        setOverrideError(null);
        setShowOverridePrompt(true);
      } else {
        setClosingError(err.message || 'Failed to close day');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOwnerOverrideConfirm = async (ownerPassword: string, reason: string) => {
    if (!summary) return;
    setSubmitting(true);
    setOverrideError(null);
    setClosingError(null);
    setClosingSuccess(null);

    try {
      const actualCashNum = Number(actualCash) || 0;
      const actualUpiNum = Number(actualUpi) || 0;
      await api.reconcileClosedDay(selectedDate, {
        owner_password: ownerPassword,
        reason,
        ...(overrideAction === 'update'
          ? {
              actual_counted_cash: actualCashNum,
              actual_upi_counted: actualUpiNum,
              cash_left_in_drawer: Number(cashLeftInDrawer) || 0,
              cash_taken_home: Number(cashTakenHome) || 0,
              discrepancy_reason: discrepancyReason.trim() || null,
              closing_notes: closingNotes.trim() || null,
            }
          : {}),
      });
      setShowOverridePrompt(false);
      setUnlockClosedEdit(false);
      setClosingSuccess(`Closed business day ${selectedDate} reconciled and updated.`);
      loadData();
    } catch (err: any) {
      setOverrideError(err.message || 'Failed to reconcile closed day');
    } finally {
      setSubmitting(false);
    }
  };

  const isClosed = summary?.isClosed;
  const formLocked = Boolean(isClosed && !unlockClosedEdit);
  const discrepancy =
    summary && actualCash !== '' ? Number(actualCash) - summary.systemExpectedCash : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Daily Closing &amp; Day Book</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            End-of-day register balancing, physical cash drawer count vs. system ledger, and day locking
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-4 h-4 text-[#A67C52]" />
          <span className="text-[#1C1917] font-semibold">Reconciliation Date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-[#6F6962] text-xs">Loading day closing summary...</div>
      ) : summary ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Calculation & Form */}
          <div className="lg:col-span-2 space-y-5">
            {closingSuccess && (
              <div className="p-3.5 bg-[#EBF7EE] border border-[#BDE5C8] rounded-xl text-xs text-[#1E6B37] font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{closingSuccess}</span>
              </div>
            )}

            {/* Status Banner */}
            <div
              className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isClosed
                  ? 'bg-[#F4F9F5] border-[#CCE3D2] text-[#3F6B50]'
                  : 'bg-[#FAF8F4] border-[#D4CDC2] text-[#1C1917]'
              }`}
            >
              <div className="flex items-center gap-3">
                {isClosed ? (
                  <ShieldCheck className="w-6 h-6 text-[#3F6B50] shrink-0" />
                ) : (
                  <Lock className="w-6 h-6 text-[#A67C52] shrink-0" />
                )}
                <div>
                  <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                    <span>
                      {isClosed ? `Day Book Closed for ${selectedDate}` : `Day Book Open for ${selectedDate}`}
                    </span>
                    {Number(summary.closingRecord?.modified_after_close) === 1 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                        Modified After Closing
                      </span>
                    )}
                  </div>
                  <div className="text-xs opacity-80 mt-0.5">
                    {isClosed
                      ? 'Reconciliation finalized. Owner password is required to modify or reconcile entries on this closed date.'
                      : 'Review numbers, count physical cash drawer, and submit closing reconciliation.'}
                  </div>
                </div>
              </div>

              {isClosed && isOwner && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideAction('reconcile');
                      setOverrideError(null);
                      setShowOverridePrompt(true);
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-[#FAF8F4] border border-[#CCE3D2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#A67C52]" />
                    <span>Reconcile System Totals</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnlockClosedEdit((prev) => !prev)}
                    className="px-3 py-1.5 bg-[#171513] hover:bg-[#25211D] text-white rounded-xl text-xs font-semibold transition"
                  >
                    {unlockClosedEdit ? 'Lock Form' : 'Owner Update'}
                  </button>
                </div>
              )}
            </div>

            {Number(summary.closingRecord?.modified_after_close) === 1 && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Post-Close Modification Recorded</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {summary.closingRecord?.last_modification_summary || 'A transaction on this closed day was modified with Owner authorization.'}
                </p>
                {summary.closingRecord?.last_modified_at && (
                  <p className="text-[10px] text-amber-800 font-medium">
                    Last updated by {summary.closingRecord?.last_modified_by || 'Owner'} on{' '}
                    {formatDateTimeIST(summary.closingRecord.last_modified_at)}
                  </p>
                )}
              </div>
            )}

            {/* System Breakdown Card */}
            <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#6F6962]">
                System Calculated Figures ({selectedDate})
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                  <span className="text-[#6F6962] block mb-1">Total Sales</span>
                  <span className="text-base font-bold text-[#1C1917]">
                    ₹{summary.salesBreakdown.totalSales.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                  <span className="text-[#6F6962] block mb-1">Cash Sales</span>
                  <span className="text-base font-bold text-[#A67C52]">
                    ₹{summary.salesBreakdown.cashSales.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                  <span className="text-[#6F6962] block mb-1">UPI Sales</span>
                  <span className="text-base font-bold text-[#1C1917]">
                    ₹{summary.salesBreakdown.upiSales.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                  <span className="text-[#6F6962] block mb-1">Due / Credit</span>
                  <span className="text-base font-bold text-[#A34F4F]">
                    ₹{summary.salesBreakdown.dueSales.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Day Cash Formula Breakdown */}
              <div className="p-4 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs space-y-2">
                <div className="font-bold text-[#1C1917]">Daily Cash Drawer Flow:</div>
                <div className="flex justify-between text-[#6F6962]">
                  <span>(+) Opening Drawer Cash (from previous day)</span>
                  <span className="text-[#1C1917] font-medium">₹{summary.openingCash.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-[#6F6962]">
                  <span>(+) Today's Cash Sales Collected</span>
                  <span className="text-[#1C1917] font-medium">₹{summary.salesBreakdown.cashSales.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-[#6F6962]">
                  <span>(+) Customer Dues Collected in Cash Today</span>
                  <span className="text-[#1C1917] font-medium">₹{summary.duesCollectedCash.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-[#6F6962]">
                  <span>(-) Day Operating Expenses Paid in Cash</span>
                  <span className="text-[#A34F4F] font-medium">-₹{summary.dayExpensesCash.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-[#6F6962]">
                  <span>(-) Cash Paid to Suppliers / Advances Today</span>
                  <span className="text-[#A34F4F] font-medium">-₹{summary.otherCashOutflow.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between font-bold text-sm pt-2.5 border-t border-[#E3DED5] text-[#1C1917]">
                  <span>System Expected Cash in Drawer:</span>
                  <span className="text-[#A67C52] text-base font-bold">₹{summary.systemExpectedCash.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {/* Reconciliation Form */}
            <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#6F6962]">
                Physical Cash Drawer Count &amp; Reconciliation
              </h3>

              {closingError && (
                <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#A34F4F]" />
                  <span>{closingError}</span>
                </div>
              )}

              <form onSubmit={handleCloseDay} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      Physical Cash Counted in Drawer (₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      disabled={formLocked}
                      value={actualCash}
                      onChange={(e) => setActualCash(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2.5 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold text-base focus:outline-none focus:border-[#A67C52] disabled:bg-[#FAF8F4]"
                    />
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-[#6F6962]">System Expected: ₹{summary.systemExpectedCash}</span>
                      <span
                        className={`font-bold ${
                          discrepancy === 0
                            ? 'text-[#3F6B50]'
                            : discrepancy > 0
                            ? 'text-[#1C1917]'
                            : 'text-[#A34F4F]'
                        }`}
                      >
                        {discrepancy === 0
                          ? 'Balanced (₹0)'
                          : discrepancy > 0
                          ? `Overage: +₹${discrepancy}`
                          : `Shortage: -₹${Math.abs(discrepancy)}`}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      UPI QR Receipts Verified (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={formLocked}
                      value={actualUpi}
                      onChange={(e) => setActualUpi(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2.5 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold text-base focus:outline-none focus:border-[#A67C52] disabled:bg-[#FAF8F4]"
                    />
                    <div className="mt-1 text-[11px] text-[#6F6962]">
                      System Recorded UPI: ₹{summary.systemExpectedUpi}
                    </div>
                  </div>
                </div>

                {discrepancy !== 0 && (
                  <div>
                    <label className="block font-semibold text-[#A34F4F] mb-1">
                      Discrepancy Reason / Explanation *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={formLocked}
                      value={discrepancyReason}
                      onChange={(e) => setDiscrepancyReason(e.target.value)}
                      placeholder="Reason for physical cash difference"
                      className="w-full px-3 py-2 bg-white border border-[#F0CCCC] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A34F4F] disabled:bg-[#FAF8F4]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E3DED5]">
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      Cash Left in Drawer for Tomorrow (Float ₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={formLocked}
                      value={cashLeftInDrawer}
                      onChange={(e) => setCashLeftInDrawer(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Opening float for next morning"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-semibold focus:outline-none focus:border-[#A67C52] disabled:bg-[#FAF8F4]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      Cash Taken Home by Owner (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      disabled={formLocked}
                      value={cashTakenHome}
                      onChange={(e) => setCashTakenHome(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Taken for safe keeping"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-semibold focus:outline-none focus:border-[#A67C52] disabled:bg-[#FAF8F4]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Closing Notes / Staff Handover
                  </label>
                  <textarea
                    rows={2}
                    disabled={formLocked}
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    placeholder="Any comments regarding customer walk-ins, festival footfall, or shop handover..."
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52] disabled:bg-[#FAF8F4]"
                  />
                </div>

                {(!isClosed || unlockClosedEdit) && (
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] font-bold rounded-xl text-sm transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Lock className="w-4 h-4 text-[#A67C52]" />
                      <span>
                        {submitting
                          ? 'Saving...'
                          : isClosed
                          ? 'Verify Owner Password & Save Closed-Day Update'
                          : 'Submit Daily Closing & Lock Day'}
                      </span>
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Right Col: Past Day Book Closings History */}
          <div className="space-y-4">
            <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1C1917] mb-3">
                <History className="w-4 h-4 text-[#A67C52]" />
                <span>Recent Day Book Closings</span>
              </div>

              {history.length === 0 ? (
                <div className="text-xs text-[#9A938B] py-6 text-center">
                  No past day book closings recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => {
                    const totalSales = Number(h.cash_sales || 0) + Number(h.upi_sales || 0);
                    const diffCash = Number(h.difference_cash || 0);
                    const countedCash = Number(h.actual_counted_cash || 0);
                    return (
                      <div
                        key={h.id}
                        onClick={() => setSelectedDate(h.closing_date)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition text-xs ${
                          h.closing_date === selectedDate
                            ? 'bg-[#FAF8F4] border-[#171513] shadow-xs'
                            : 'bg-white border-[#E3DED5] hover:border-[#D4CDC2]'
                        }`}
                      >
                        <div className="flex justify-between items-center font-bold text-[#1C1917] mb-1 gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span>{h.closing_date}</span>
                            {Number(h.modified_after_close) === 1 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold">
                                Modified
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              diffCash === 0
                                ? 'text-[#3F6B50] bg-[#F4F9F5] border border-[#CCE3D2]'
                                : 'text-[#A34F4F] bg-[#FDF5F5] border border-[#F0CCCC]'
                            }`}
                          >
                            {diffCash === 0 ? 'Balanced' : `Diff ₹${diffCash}`}
                          </span>
                        </div>
                        <div className="flex justify-between text-[#6F6962] text-[11px]">
                          <span>Sales: ₹{totalSales.toLocaleString('en-IN')}</span>
                          <span>Cash Count: ₹{countedCash.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <OwnerOverridePrompt
        isOpen={showOverridePrompt}
        title={overrideAction === 'update' ? `Update Closed Day (${selectedDate})` : `Reconcile Closed Day (${selectedDate})`}
        description={`Business day ${selectedDate} is already CLOSED. Owner password verification and an audit reason are required to update or reconcile the closing snapshot. Original opening cash and closed timestamp will be preserved.`}
        requireReason={true}
        reasonLabel="Mandatory Reconciliation Reason *"
        errorMessage={overrideError}
        submitting={submitting}
        onCancel={() => {
          setShowOverridePrompt(false);
          setOverrideError(null);
        }}
        onConfirm={handleOwnerOverrideConfirm}
      />
    </div>
  );
};
