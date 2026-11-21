import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  FileText,
  Calendar,
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Wallet,
  Smartphone,
  Coins,
  CreditCard,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Cloud,
  Lock,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { saveManualBillToFirestore } from '../services/firebase.ts';
import { getTodayIST, toISTDateString, getISTCalendarDayDiff, isValidDateStr } from '../utils/date.ts';
import { OwnerOverridePrompt } from './OwnerOverridePrompt.tsx';

export interface ManualBillItem {
  id: string;
  product_id?: string;
  itemName: string;
  quantity: number;
  rate: number;
}

interface ManualBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBillSaved: (savedBill: any, mode?: 'create' | 'edit') => void;
  editBill?: { sale: any; items: any[] } | null;
}

export const ManualBillModal: React.FC<ManualBillModalProps> = ({
  isOpen,
  onClose,
  onBillSaved,
  editBill = null,
}) => {
  const isEditMode = Boolean(editBill?.sale?.id);
  const todayStr = getTodayIST();
  const originalBillDate = isEditMode && editBill?.sale
    ? (editBill.sale.bill_date || toISTDateString(editBill.sale.created_at) || todayStr)
    : todayStr;
  const daysSinceCreated = isEditMode && editBill?.sale?.created_at
    ? getISTCalendarDayDiff(editBill.sale.created_at)
    : 0;
  const isOutsideNormalWindow = isEditMode && daysSinceCreated > 2;
  const isOriginalDayClosed = isEditMode && (
    Number(editBill?.sale?.day_closed) === 1 || editBill?.sale?.closing_status === 'CLOSED'
  );
  const needsOwnerOverride = isOutsideNormalWindow || isOriginalDayClosed;

  // Bill Details
  const [billDate, setBillDate] = useState<string>(todayStr);
  const [billNumber, setBillNumber] = useState<string>('');
  const [billNumberWarning, setBillNumberWarning] = useState<string | null>(null);
  const [checkingNumber, setCheckingNumber] = useState<boolean>(false);

  // Items
  const [items, setItems] = useState<ManualBillItem[]>([
    { id: '1', itemName: '', quantity: 1, rate: 0 },
  ]);

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'SPLIT' | 'CREDIT'>('CASH');
  const [cashAmount, setCashAmount] = useState<number | ''>('');
  const [upiAmount, setUpiAmount] = useState<number | ''>('');

  // Customer info (optional, required if CREDIT)
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');

  // Form State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firestoreStatus, setFirestoreStatus] = useState<string | null>(null);
  const [confirmingEdit, setConfirmingEdit] = useState<boolean>(false);

  // Owner Override Prompt State
  const [showOwnerPrompt, setShowOwnerPrompt] = useState<boolean>(false);
  const [ownerPromptDesc, setOwnerPromptDesc] = useState<string>('');
  const [ownerPromptError, setOwnerPromptError] = useState<string | null>(null);

  // Reset or prefill form when modal opens
  useEffect(() => {
    if (!isOpen) {
      setConfirmingEdit(false);
      setShowOwnerPrompt(false);
      setOwnerPromptError(null);
      return;
    }

    const currentToday = getTodayIST();
    if (editBill?.sale) {
      const s = editBill.sale;
      const existingDate = s.bill_date || toISTDateString(s.created_at) || currentToday;
      setBillDate(existingDate);
      setBillNumber(s.bill_number || '');
      setBillNumberWarning(null);

      const loadedItems: ManualBillItem[] =
        Array.isArray(editBill.items) && editBill.items.length > 0
          ? editBill.items.map((it: any, idx: number) => ({
              id: it.id || `edit_${idx}_${Date.now()}`,
              product_id: it.product_id || undefined,
              itemName: it.product_name || it.item_name || '',
              quantity: Math.max(1, Number(it.quantity) || 1),
              rate: Number(it.unit_price !== undefined ? it.unit_price : it.rate) || 0,
            }))
          : [{ id: Date.now().toString(), itemName: '', quantity: 1, rate: 0 }];

      setItems(loadedItems);

      const pm = (s.payment_method || 'CASH') as 'CASH' | 'UPI' | 'CARD' | 'SPLIT' | 'CREDIT';
      setPaymentMethod(pm);
      if (pm === 'SPLIT') {
        setCashAmount(Number(s.cash_paid) || 0);
        setUpiAmount(Number(s.upi_paid) || 0);
      } else {
        setCashAmount('');
        setUpiAmount('');
      }

      setCustomerName(s.customer_name || '');
      setCustomerPhone(s.customer_phone || '');

      const rawNotes = String(s.notes || '');
      if (rawNotes === 'Handwritten Bill Entry') {
        setNotes('');
      } else if (rawNotes.startsWith('Handwritten Bill: ')) {
        setNotes(rawNotes.slice('Handwritten Bill: '.length));
      } else {
        setNotes(rawNotes);
      }

      setEditReason('');
      setFormError(null);
      setFirestoreStatus(null);
      setConfirmingEdit(false);
      setShowOwnerPrompt(false);
      setOwnerPromptError(null);
    } else {
      setBillDate(currentToday);
      setBillNumber('');
      setBillNumberWarning(null);
      setItems([{ id: Date.now().toString(), itemName: '', quantity: 1, rate: 0 }]);
      setPaymentMethod('CASH');
      setCashAmount('');
      setUpiAmount('');
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setEditReason('');
      setFormError(null);
      setFirestoreStatus(null);
      setConfirmingEdit(false);
      setShowOwnerPrompt(false);
      setOwnerPromptError(null);
    }
  }, [isOpen, editBill]);

  // Check duplicate bill number with debounce (create mode only)
  useEffect(() => {
    if (isEditMode || !billNumber.trim()) {
      setBillNumberWarning(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingNumber(true);
      try {
        const res = await api.checkBillNumber({
          billNumber: billNumber.trim(),
          date: billDate,
        });
        if (res.exists) {
          setBillNumberWarning(
            `A bill with number "${billNumber.trim()}" is already recorded for ${billDate}. Please verify to avoid duplicates.`
          );
        } else {
          setBillNumberWarning(null);
        }
      } catch {
        // silent fail on network check
      } finally {
        setCheckingNumber(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [billNumber, billDate, isEditMode]);

  // Calculate bill total
  const calculatedTotal = items.reduce((sum, item) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const rate = Math.max(0, Number(item.rate) || 0);
    return sum + Math.round(qty * rate);
  }, 0);

  // Update Split fields when total changes or method changes
  useEffect(() => {
    if (paymentMethod === 'SPLIT') {
      if (cashAmount === '' && upiAmount === '') {
        // Default half & half or clean split
        const half = Math.floor(calculatedTotal / 2);
        setCashAmount(half);
        setUpiAmount(calculatedTotal - half);
      }
    }
  }, [paymentMethod, calculatedTotal]);

  if (!isOpen) return null;

  // Item row operations
  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString() + Math.random(), itemName: '', quantity: 1, rate: 0 },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleItemChange = (id: string, field: keyof ManualBillItem, value: any) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        return { ...it, [field]: value };
      })
    );
  };

  const validateForm = (): boolean => {
    setFormError(null);

    if (!billNumber.trim()) {
      setFormError('Please enter the original handwritten bill number.');
      return false;
    }

    if (!isValidDateStr(billDate)) {
      setFormError('Please select a valid business bill date (YYYY-MM-DD).');
      return false;
    }

    if (billDate > todayStr) {
      setFormError(`Bill date cannot be in the future beyond today (${todayStr} IST).`);
      return false;
    }

    if (!isEditMode && billNumberWarning) {
      setFormError(
        `Duplicate bill number: Bill #${billNumber.trim()} already exists for ${billDate}. Please verify the handwritten bill number to avoid duplicates.`
      );
      return false;
    }

    if (items.length === 0) {
      setFormError('Please add at least one item.');
      return false;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.itemName.trim()) {
        setFormError(`Item #${i + 1} is missing an item name.`);
        return false;
      }
      if (Number(it.quantity) < 1) {
        setFormError(`Item "${it.itemName}" must have quantity of at least 1.`);
        return false;
      }
      if (Number(it.rate) <= 0) {
        setFormError(`Item "${it.itemName}" must have a valid rate greater than ₹0.`);
        return false;
      }
    }

    if (calculatedTotal <= 0) {
      setFormError('Total bill amount must be greater than ₹0.');
      return false;
    }

    const cashVal = Number(cashAmount) || 0;
    const upiVal = Number(upiAmount) || 0;

    if (paymentMethod === 'SPLIT') {
      const splitTotal = cashVal + upiVal;
      if (Math.abs(splitTotal - calculatedTotal) > 0.01) {
        setFormError(
          `Split amounts do not match Total Bill. Cash (₹${cashVal}) + UPI (₹${upiVal}) = ₹${splitTotal}, but Total is ₹${calculatedTotal}.`
        );
        return false;
      }
    }

    if (paymentMethod === 'CREDIT' && !customerName.trim()) {
      setFormError('Customer Name is required for Credit / Due bills.');
      return false;
    }

    return true;
  };

  // Submit Handler (Create directly unless closed day prompts; Edit opens confirmation step first)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (isEditMode && !confirmingEdit) {
      setConfirmingEdit(true);
      return;
    }

    if (isEditMode && needsOwnerOverride && !showOwnerPrompt) {
      const reasons: string[] = [];
      if (isOutsideNormalWindow) {
        reasons.push(`bill is ${daysSinceCreated + 1} IST days old (past the 3-day editing window)`);
      }
      if (isOriginalDayClosed) {
        reasons.push(`business day ${originalBillDate} is already CLOSED`);
      }
      setOwnerPromptDesc(
        `Owner password verification is required because ${reasons.join(' and ')}. Authorizes editing Bill #${billNumber.trim()} only.`
      );
      setOwnerPromptError(null);
      setShowOwnerPrompt(true);
      return;
    }

    await performSave();
  };

  const performSave = async (ownerPassword?: string, overrideReason?: string) => {
    const cashVal = Number(cashAmount) || 0;
    const upiVal = Number(upiAmount) || 0;
    const resolvedReason = (overrideReason !== undefined ? overrideReason : editReason).trim();

    setSubmitting(true);
    setFormError(null);
    setOwnerPromptError(null);

    try {
      const payload: any = {
        bill_number: billNumber.trim(),
        bill_date: billDate,
        items: items.map((it) => ({
          ...(it.product_id ? { product_id: it.product_id } : {}),
          item_name: it.itemName.trim(),
          quantity: Number(it.quantity),
          rate: Number(it.rate),
        })),
        payment_method: paymentMethod,
        cash_amount: paymentMethod === 'CASH' ? calculatedTotal : paymentMethod === 'SPLIT' ? cashVal : 0,
        upi_amount: paymentMethod === 'UPI' ? calculatedTotal : paymentMethod === 'SPLIT' ? upiVal : 0,
        card_amount: paymentMethod === 'CARD' ? calculatedTotal : 0,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(isEditMode && resolvedReason ? { edit_reason: resolvedReason } : {}),
        ...(ownerPassword ? { owner_password: ownerPassword } : {}),
      };

      if (isEditMode && editBill?.sale?.id) {
        const res = await api.updateManualBill(editBill.sale.id, payload);
        setConfirmingEdit(false);
        setShowOwnerPrompt(false);
        onBillSaved(res.sale, 'edit');
        onClose();
        return;
      }

      // Step A: Save to local/D1 ERP database
      const res = await api.createManualBill(payload);

      // Step B: Save to Firebase Firestore database in collection `manual_bills` (best-effort)
      try {
        const firestorePayload = {
          billNumber: billNumber.trim(),
          billDate,
          totalAmount: calculatedTotal,
          paymentMethod,
          cashAmount: paymentMethod === 'CASH' ? calculatedTotal : paymentMethod === 'SPLIT' ? cashVal : 0,
          upiAmount: paymentMethod === 'UPI' ? calculatedTotal : paymentMethod === 'SPLIT' ? upiVal : 0,
          cardAmount: paymentMethod === 'CARD' ? calculatedTotal : 0,
          dueAmount: paymentMethod === 'CREDIT' ? calculatedTotal : 0,
          itemCount: items.length,
          items: items.map((it) => ({
            itemName: it.itemName.trim(),
            quantity: Number(it.quantity),
            rate: Number(it.rate),
            itemTotal: Math.round(Number(it.quantity) * Number(it.rate)),
          })),
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          notes: notes.trim() || undefined,
        };

        const firestoreRes = await saveManualBillToFirestore(firestorePayload);
        if (firestoreRes.ok) {
          setFirestoreStatus('Synced to Firestore');
        }
      } catch (fErr) {
        console.warn('Firestore write warning:', fErr);
      }

      setShowOwnerPrompt(false);
      onBillSaved(res.sale, 'create');
      onClose();
    } catch (err: any) {
      console.error('Error saving manual bill:', err);
      if (err?.requires_owner_password) {
        if (overrideReason) setEditReason(overrideReason);
        setOwnerPromptDesc(
          err.message ||
            'Owner password verification is required because this bill affects a closed business day or is older than 3 IST calendar days.'
        );
        setOwnerPromptError(ownerPassword ? err.message : null);
        setShowOwnerPrompt(true);
      } else {
        setConfirmingEdit(false);
        setFormError(err.message || 'Failed to save manual bill');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-[#E3DED5] rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-6 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#E3DED5] bg-[#FAF8F4] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white text-[#A67C52] border border-[#E3DED5] rounded-xl shadow-2xs">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-[#1C1917] tracking-tight">
                  {isEditMode ? `Edit Manual Bill #${billNumber}` : 'Manual Bill Entry'}
                </h2>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${
                    !isEditMode
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : needsOwnerOverride
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {!isEditMode
                    ? 'Handwritten Bill Record'
                    : needsOwnerOverride
                    ? isOriginalDayClosed
                      ? 'Closed Day • Owner Auth'
                      : `Day ${daysSinceCreated + 1} • Owner Auth`
                    : `3-Day Edit Window (Day ${Math.min(3, daysSinceCreated + 1)}/3)`}
                </span>
              </div>
              <p className="text-xs text-[#6F6962] mt-0.5">
                {isEditMode
                  ? needsOwnerOverride
                    ? 'Direct edit past 3 IST calendar days or on a closed business day requires Owner password verification.'
                    : 'Update items, bill date, payment mode, or customer details without creating a duplicate bill.'
                  : 'Record customer handwritten bills for day sales without deducting POS inventory stock'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Error Banner */}
          {formError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{formError}</div>
            </div>
          )}

          {/* Owner Override Notice Banner in Edit Mode */}
          {isEditMode && needsOwnerOverride && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold block">Owner Password Override Applies</span>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  {isOutsideNormalWindow &&
                    `Created ${daysSinceCreated} IST day(s) ago (normal 3-day window expired). `}
                  {isOriginalDayClosed &&
                    `Original business day (${originalBillDate}) is CLOSED. `}
                  Changing the bill date does not reset the creation window. You will be prompted for the Store Owner password and mandatory audit reason when saving.
                </p>
              </div>
            </div>
          )}

          {/* Section 1: Bill Details */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
              1. Bill Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Bill Date (IST Business Date) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-[#A67C52] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={billDate}
                    max={todayStr}
                    onChange={(e) => setBillDate(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <span className="text-[11px] text-[#6F6962] mt-1 block">
                  {isEditMode
                    ? billDate !== originalBillDate
                      ? `Moving bill date ${originalBillDate} → ${billDate}. Daily sales & closings for both dates will reconcile automatically.`
                      : 'Can be moved to today or a past business date (original creation timestamp stays fixed).'
                    : 'Select the actual IST business date written on the physical handwritten bill'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Handwritten Bill Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={billNumber}
                  onChange={(e) => !isEditMode && setBillNumber(e.target.value)}
                  readOnly={isEditMode}
                  placeholder="Enter bill number"
                  required
                  className={`w-full px-3 py-2 border border-[#D4CDC2] rounded-xl text-xs font-medium focus:outline-none ${
                    isEditMode
                      ? 'bg-[#F0EDE6] text-[#6F6962] cursor-not-allowed font-mono'
                      : 'bg-[#FAF8F4] text-[#1C1917] focus:border-[#A67C52]'
                  }`}
                />
                {isEditMode ? (
                  <span className="text-[11px] text-[#3F6B50] font-medium mt-1 block">
                    Original bill number is preserved on edit (no duplicate bill created)
                  </span>
                ) : checkingNumber ? (
                  <span className="text-[11px] text-[#6F6962] mt-1 block">Checking bill number...</span>
                ) : billNumberWarning ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{billNumberWarning}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#6F6962] mt-1 block">
                    Original sequential bill number from your physical bill book
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Item Details */}
          <div className="space-y-3 pt-3 border-t border-[#E3DED5]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
                  2. Item Details
                </h3>
                <p className="text-[11px] text-[#6F6962]">
                  Add all items on the bill. Item Total is automatically calculated as Quantity × Rate.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddItem}
                className="px-3 py-1.5 bg-[#FAF8F4] hover:bg-[#F0EDE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition"
              >
                <Plus className="w-3.5 h-3.5 text-[#A67C52]" />
                <span>Add Item Row</span>
              </button>
            </div>

            {/* Items Table */}
            <div className="border border-[#E3DED5] rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#FAF8F4] border-b border-[#E3DED5] text-[#6F6962] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3 w-8 text-center">#</th>
                      <th className="py-2.5 px-3 min-w-[180px]">Item Name</th>
                      <th className="py-2.5 px-3 w-24 text-right">Qty</th>
                      <th className="py-2.5 px-3 w-28 text-right">Rate (₹)</th>
                      <th className="py-2.5 px-3 w-28 text-right">Item Total (₹)</th>
                      <th className="py-2.5 px-2 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3DED5]">
                    {items.map((item, idx) => {
                      const itemTotal = Math.round(
                        (Math.max(0, Number(item.quantity) || 0)) *
                        (Math.max(0, Number(item.rate) || 0))
                      );

                      return (
                        <tr key={item.id} className="hover:bg-[#FAF8F4]/50">
                          <td className="py-2.5 px-3 text-center text-[#6F6962] font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.itemName}
                              onChange={(e) => handleItemChange(item.id, 'itemName', e.target.value)}
                              placeholder="Item name"
                              required
                              className="w-full px-2.5 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={(e) =>
                                handleItemChange(item.id, 'quantity', parseInt(e.target.value, 10) || 1)
                              }
                              required
                              className="w-20 px-2.5 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-xs text-right font-mono text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.rate === 0 ? '' : item.rate}
                              onChange={(e) =>
                                handleItemChange(
                                  item.id,
                                  'rate',
                                  e.target.value === '' ? 0 : parseFloat(e.target.value) || 0
                                )
                              }
                              placeholder="0"
                              required
                              className="w-24 px-2.5 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-xs text-right font-mono text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-[#1C1917] tabular-nums">
                            ₹{itemTotal.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              disabled={items.length <= 1}
                              title={items.length <= 1 ? 'At least one item is required' : 'Remove row'}
                              className="p-1 text-[#6F6962] hover:text-red-600 disabled:opacity-30 rounded-md transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Section 3: Bill Total & Handwritten Comparison */}
          <div className="bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E3DED5] pb-3">
              <div>
                <span className="text-xs font-semibold text-[#6F6962] uppercase tracking-wider block">
                  Total Bill Amount (Calculated Sum of Items)
                </span>
                <span className="text-2xl font-bold font-mono text-[#1C1917] tabular-nums mt-0.5 block">
                  ₹{calculatedTotal.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-left sm:text-right text-xs text-[#6F6962]">
                <span className="block font-medium">{items.length} item line{items.length === 1 ? '' : 's'}</span>
                <span className="text-[11px] text-[#3F6B50] font-semibold">No auto taxes or discounts applied</span>
              </div>
            </div>

            {/* Comparison Verification Callout */}
            <div className="flex items-start gap-2.5 text-xs text-[#1C1917] bg-white border border-[#E3DED5] p-3 rounded-lg">
              <ShieldCheck className="w-4 h-4 text-[#A67C52] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[#1C1917] block">Verify with Handwritten Bill</span>
                <p className="text-[11px] text-[#6F6962] mt-0.5">
                  Confirm that the calculated total <strong className="text-[#1C1917]">₹{calculatedTotal.toLocaleString('en-IN')}</strong> matches the handwritten grand total on the physical paper bill slip before saving.
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: Payment Method */}
          <div className="space-y-3 pt-3 border-t border-[#E3DED5]">
            <h3 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
              3. Payment Method
            </h3>

            {/* Method Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'CASH'
                    ? 'bg-[#1C1917] text-white border-[#1C1917] shadow-xs'
                    : 'bg-[#FAF8F4] text-[#1C1917] border-[#D4CDC2] hover:bg-white'
                }`}
              >
                <Coins className="w-4 h-4 text-emerald-500" />
                <span>Cash</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('UPI')}
                className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'UPI'
                    ? 'bg-[#1C1917] text-white border-[#1C1917] shadow-xs'
                    : 'bg-[#FAF8F4] text-[#1C1917] border-[#D4CDC2] hover:bg-white'
                }`}
              >
                <Smartphone className="w-4 h-4 text-blue-500" />
                <span>UPI</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CARD')}
                className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'CARD'
                    ? 'bg-[#1C1917] text-white border-[#1C1917] shadow-xs'
                    : 'bg-[#FAF8F4] text-[#1C1917] border-[#D4CDC2] hover:bg-white'
                }`}
              >
                <CreditCard className="w-4 h-4 text-indigo-500" />
                <span>Card</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('SPLIT')}
                className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'SPLIT'
                    ? 'bg-[#1C1917] text-white border-[#1C1917] shadow-xs'
                    : 'bg-[#FAF8F4] text-[#1C1917] border-[#D4CDC2] hover:bg-white'
                }`}
              >
                <Wallet className="w-4 h-4 text-purple-500" />
                <span>Split (Cash + UPI)</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CREDIT')}
                className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'CREDIT'
                    ? 'bg-[#1C1917] text-white border-[#1C1917] shadow-xs'
                    : 'bg-[#FAF8F4] text-[#1C1917] border-[#D4CDC2] hover:bg-white'
                }`}
              >
                <BookOpen className="w-4 h-4 text-amber-500" />
                <span>Credit / Due</span>
              </button>
            </div>

            {/* Split Breakdown Fields */}
            {paymentMethod === 'SPLIT' && (
              <div className="p-4 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl space-y-3">
                <span className="text-xs font-bold text-[#1C1917] block">
                  Enter Split Amounts (Sum must equal ₹{calculatedTotal.toLocaleString('en-IN')})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                      Cash Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={cashAmount}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                        setCashAmount(val);
                        if (val !== '' && calculatedTotal >= val) {
                          setUpiAmount(calculatedTotal - val);
                        }
                      }}
                      placeholder="0"
                      required
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                      UPI Amount (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={upiAmount}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                        setUpiAmount(val);
                        if (val !== '' && calculatedTotal >= val) {
                          setCashAmount(calculatedTotal - val);
                        }
                      }}
                      placeholder="0"
                      required
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                {/* Live Split Sum Validator */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[#E3DED5]">
                  <span className="text-[#6F6962]">
                    Total Allocated: <strong className="font-mono text-[#1C1917]">₹{((Number(cashAmount) || 0) + (Number(upiAmount) || 0)).toLocaleString('en-IN')}</strong>
                  </span>
                  {Math.abs((Number(cashAmount) || 0) + (Number(upiAmount) || 0) - calculatedTotal) < 0.01 ? (
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Exact Match</span>
                    </span>
                  ) : (
                    <span className="text-red-600 font-bold">
                      Difference: ₹{Math.abs(calculatedTotal - ((Number(cashAmount) || 0) + (Number(upiAmount) || 0))).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Credit Info Notice */}
            {paymentMethod === 'CREDIT' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                <span className="font-bold block">Credit / Due Notice</span>
                <p className="text-[11px] leading-relaxed">
                  The full bill total of ₹{calculatedTotal.toLocaleString('en-IN')} will be recorded as an outstanding balance in Customer Dues. Customer name is mandatory below.
                </p>
              </div>
            )}
          </div>

          {/* Section 5: Optional Customer & Notes */}
          <div className="space-y-3 pt-3 border-t border-[#E3DED5]">
            <h3 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider">
              4. Customer &amp; Notes {paymentMethod === 'CREDIT' ? '(Mandatory for Credit)' : '(Optional)'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Customer Name {paymentMethod === 'CREDIT' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  required={paymentMethod === 'CREDIT'}
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Customer Phone
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Customer phone number"
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                Slip Reference or Remarks
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Slip reference or remarks"
                className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            {isEditMode && (
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Reason for Editing {needsOwnerOverride ? <span className="text-red-500">*</span> : '(Optional — saved to Edit History)'}
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. Corrected quantity, rate, date, or payment mode"
                  className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            )}
          </div>

          {/* Pre-save Confirmation Summary (Edit Mode) */}
          {isEditMode && confirmingEdit && (
            <div className="p-4 bg-[#FBF5EE] border-2 border-[#A67C52] rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1C1917]">
                <AlertCircle className="w-4 h-4 text-[#A67C52]" />
                <span>Confirm Bill Changes for #{billNumber}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-white border border-[#E3DED5] rounded-lg p-3">
                <div>
                  <span className="text-[10px] text-[#9A938B] block uppercase font-semibold">Bill Date</span>
                  <span className="font-mono font-semibold text-[#1C1917]">
                    {originalBillDate === billDate ? billDate : `${originalBillDate} → ${billDate}`}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#9A938B] block uppercase font-semibold">Previous Total</span>
                  <span className="font-mono font-semibold text-[#6F6962] line-through">
                    ₹{(Number(editBill?.sale?.total_amount) || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#9A938B] block uppercase font-semibold">Updated Total</span>
                  <span className="font-mono font-bold text-[#1C1917]">
                    ₹{calculatedTotal.toLocaleString('en-IN')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#9A938B] block uppercase font-semibold">Payment Method</span>
                  <span className="font-semibold text-[#1C1917]">
                    {editBill?.sale?.payment_method} → {paymentMethod}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#6F6962]">
                Saving will update this existing bill atomically, reconcile Cash/UPI/Customer Dues/Day Closings for affected dates, and append an entry to Edit History.
              </p>
            </div>
          )}
        </form>

        {/* Modal Footer */}
        <div className="px-5 py-4 border-t border-[#E3DED5] bg-[#FAF8F4] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#6F6962] self-start sm:self-auto">
            <Cloud className="w-4 h-4 text-emerald-600" />
            <span>
              {isEditMode
                ? 'Updates existing bill atomically & preserves audit trail'
                : 'Saves to Day Sales & Firebase Firestore (0 Inventory Deduction)'}
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            {isEditMode && confirmingEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingEdit(false)}
                  disabled={submitting}
                  className="flex-1 sm:flex-none px-4 py-2 border border-[#D4CDC2] text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-[#3F6B50] hover:bg-[#31553E] disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{submitting ? 'Saving Changes...' : needsOwnerOverride ? 'Verify Owner & Save' : 'Confirm & Save Changes'}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 sm:flex-none px-4 py-2 border border-[#D4CDC2] text-[#1C1917] hover:bg-[#F0EDE6] rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || calculatedTotal <= 0}
                  className="flex-1 sm:flex-none px-5 py-2.5 bg-[#A67C52] hover:bg-[#8C653E] disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'Saving...'
                      : isEditMode
                      ? `Save Changes (₹${calculatedTotal.toLocaleString('en-IN')})`
                      : `Save Bill (₹${calculatedTotal.toLocaleString('en-IN')})`}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <OwnerOverridePrompt
        isOpen={showOwnerPrompt}
        title={isEditMode ? `Authorize Edit: Bill #${billNumber}` : `Authorize Closed-Day Entry (${billDate})`}
        description={ownerPromptDesc}
        requireReason={isEditMode}
        reasonLabel="Mandatory Edit Audit Reason *"
        initialReason={editReason}
        errorMessage={ownerPromptError}
        submitting={submitting}
        onCancel={() => {
          setShowOwnerPrompt(false);
          setOwnerPromptError(null);
        }}
        onConfirm={(pwd, reason) => performSave(pwd, reason)}
      />
    </div>
  );
};
