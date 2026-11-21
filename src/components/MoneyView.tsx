import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Plus,
  Coins,
  Building2,
  Smartphone,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  RotateCcw,
  Lock,
  X,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { FinancialTransaction, UserRole } from '../types.ts';
import { getTodayIST } from '../utils/date.ts';
import { OwnerOverridePrompt } from './OwnerOverridePrompt.tsx';

interface MoneyViewProps {
  role?: UserRole;
}

export const MoneyView: React.FC<MoneyViewProps> = ({ role }) => {
  const isOwner = role === 'OWNER';
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'PROFIT_LOSS'>('REGISTER');
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [accounts, setAccounts] = useState<{ cash: number; upi: number; bank: number | null }>({
    cash: 0,
    upi: 0,
    bank: null,
  });
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageBanner, setPageBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');

  // New Transaction Modal
  const [showModal, setShowModal] = useState(false);
  const [txType, setTxType] = useState('OPERATING_EXPENSE');
  const [sourceAccount, setSourceAccount] = useState<'CASH' | 'UPI' | 'BANK' | 'EXTERNAL'>('CASH');
  const [destAccount, setDestAccount] = useState<'CASH' | 'UPI' | 'BANK' | 'EXTERNAL'>('EXTERNAL');
  const [amount, setAmount] = useState<number | ''>('');
  const [personEntity, setPersonEntity] = useState('');
  const [category, setCategory] = useState('Shop Expenses');
  const [purpose, setPurpose] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [refNo, setRefNo] = useState('');
  const [txDate, setTxDate] = useState(getTodayIST());

  // Edit Manual Transaction Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTx, setEditTx] = useState<FinancialTransaction | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editPurpose, setEditPurpose] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPerson, setEditPerson] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [editSourceAccount, setEditSourceAccount] = useState<'CASH' | 'UPI' | 'BANK' | 'EXTERNAL'>('CASH');
  const [editDestAccount, setEditDestAccount] = useState<'CASH' | 'UPI' | 'BANK' | 'EXTERNAL'>('EXTERNAL');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  // Reverse Manual Transaction Modal (non-closed or initial reason capture)
  const [reverseTx, setReverseTx] = useState<FinancialTransaction | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  // Rule 10 Formal Correction Modal
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);
  const [correctedAmount, setCorrectedAmount] = useState<number>(0);
  const [correctionReason, setCorrectionReason] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Owner Password Override Prompt
  const [overridePrompt, setOverridePrompt] = useState<{
    title: string;
    description: string;
    requireReason: boolean;
    initialReason?: string;
    confirmLabel?: string;
    onConfirm: (ownerPassword: string, reason: string) => Promise<void>;
  } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const promises: Promise<any>[] = [
        api.getTransactions({ type: typeFilter || undefined, account: accountFilter || undefined }),
        api.getAccounts(),
      ];
      if (isOwner) {
        promises.push(api.getProfitLoss().catch(() => null));
      }
      const [tRes, aRes, plRes] = await Promise.all(promises);
      setTransactions(tRes.transactions || []);
      setAccounts(aRes.accounts);
      if (plRes) setProfitLoss(plRes);
    } catch (err: any) {
      setPageBanner({ type: 'error', text: err.message || 'Failed to load money flow data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [typeFilter, accountFilter]);

  const showSuccess = (text: string) => {
    setPageBanner({ type: 'success', text });
    setTimeout(() => setPageBanner((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const handleOpenNewTx = () => {
    setTxType('OPERATING_EXPENSE');
    setSourceAccount('CASH');
    setDestAccount('EXTERNAL');
    setAmount('');
    setPersonEntity('');
    setCategory('Shop Expenses');
    setPurpose('');
    setPaymentMethod('CASH');
    setRefNo('');
    setTxDate(getTodayIST());
    setFormError(null);
    setShowModal(true);
  };

  const handleTypeChange = (newType: string) => {
    setTxType(newType);
    if (newType === 'OPERATING_EXPENSE') {
      setSourceAccount('CASH');
      setDestAccount('EXTERNAL');
      setCategory('Shop Expenses');
    } else if (newType === 'OWNER_CAPITAL') {
      setSourceAccount('EXTERNAL');
      setDestAccount('CASH');
      setCategory('Capital Injection');
    } else if (newType === 'OWNER_WITHDRAWAL') {
      setSourceAccount('CASH');
      setDestAccount('EXTERNAL');
      setCategory('Owner Withdrawal');
    } else if (newType === 'TRANSFER') {
      setSourceAccount('CASH');
      setDestAccount('BANK');
      setCategory('Internal Transfer');
    }
  };

  const submitNewTransaction = async (ownerPassword?: string) => {
    const amtNum = Number(amount);
    const payload = {
      date: txDate,
      amount: amtNum,
      transaction_type: txType,
      source_account: sourceAccount,
      destination_account: destAccount,
      person_entity: personEntity.trim() || null,
      category,
      purpose: purpose.trim(),
      payment_method: paymentMethod,
      reference_no: refNo.trim() || null,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    };

    await api.createTransaction(payload);
    setShowModal(false);
    setOverridePrompt(null);
    showSuccess(`Recorded ${txType} of ₹${amtNum.toLocaleString('en-IN')} on ${txDate}.`);
    await loadData();
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = Number(amount);
    if (!amtNum || amtNum <= 0 || !purpose.trim()) {
      setFormError('Please provide a valid positive amount and purpose.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitNewTransaction();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Closed Business Day Authorization',
          description: err.message || `Business day ${txDate} is CLOSED. Enter the Store Owner password to record this transaction.`,
          requireReason: false,
          confirmLabel: 'Verify & Save Entry',
          onConfirm: async (pwd) => {
            await submitNewTransaction(pwd);
          },
        });
      } else {
        setFormError(err.message || 'Failed to record transaction');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (tx: FinancialTransaction) => {
    setEditTx(tx);
    setEditDate(tx.date);
    setEditAmount(tx.amount);
    setEditPurpose(tx.purpose || '');
    setEditCategory(tx.category || '');
    setEditPerson(tx.person_entity || '');
    setEditPaymentMethod((tx.payment_method as 'CASH' | 'UPI' | 'BANK') || 'CASH');
    setEditSourceAccount(tx.source_account);
    setEditDestAccount(tx.destination_account);
    setEditNotes(tx.notes || '');
    setEditReason('');
    setFormError(null);
    setShowEditModal(true);
  };

  const submitEditTransaction = async (ownerPassword?: string, reasonFromPrompt?: string) => {
    if (!editTx) return;
    const amtNum = Number(editAmount);
    const effectiveReason = (reasonFromPrompt || editReason).trim();
    const res = await api.updateTransaction(editTx.id, {
      date: editDate,
      amount: amtNum,
      purpose: editPurpose.trim(),
      category: editCategory.trim() || editTx.category,
      person_entity: editPerson.trim() || null,
      payment_method: editPaymentMethod,
      source_account: editSourceAccount,
      destination_account: editDestAccount,
      notes: editNotes.trim() || null,
      reason: effectiveReason || undefined,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });

    setShowEditModal(false);
    setEditTx(null);
    setOverridePrompt(null);
    const closedMsg =
      res.modified_closed_dates && res.modified_closed_dates.length > 0
        ? ` Closed day snapshot reconciled (${res.modified_closed_dates.join(', ')}).`
        : '';
    showSuccess(`Updated transaction "${editPurpose.trim()}" cleanly.${closedMsg}`);
    await loadData();
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTx) return;
    const amtNum = Number(editAmount);
    if (!amtNum || amtNum <= 0 || !editPurpose.trim()) {
      setFormError('Valid positive amount and purpose are required.');
      return;
    }

    const todayStr = getTodayIST();
    const needsReason = editDate < todayStr || editTx.date < todayStr || Number(editTx.day_closed) === 1;
    if (needsReason && !editReason.trim()) {
      setFormError('Mandatory audit reason is required when editing past-date or closed-day entries.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitEditTransaction();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || 'This transaction affects a CLOSED business day. Verify Store Owner password to apply changes and reconcile daily closing totals.',
          requireReason: !editReason.trim(),
          initialReason: editReason.trim(),
          confirmLabel: 'Verify & Save Edit',
          onConfirm: async (pwd, rsn) => {
            await submitEditTransaction(pwd, rsn || editReason.trim());
          },
        });
      } else {
        setFormError(err.message || 'Failed to update transaction');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenReverse = (tx: FinancialTransaction) => {
    setReverseTx(tx);
    setReverseReason('');
    setFormError(null);
  };

  const submitReverseTransaction = async (tx: FinancialTransaction, reasonText: string, ownerPassword?: string) => {
    const res = await api.reverseTransaction(tx.id, {
      reason: reasonText,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });
    setReverseTx(null);
    setOverridePrompt(null);
    const closedMsg =
      res.modified_closed_dates && res.modified_closed_dates.length > 0
        ? ` Closed day reconciled (${res.modified_closed_dates.join(', ')}).`
        : '';
    showSuccess(`Reversed transaction "${tx.purpose}" (₹${tx.amount.toLocaleString('en-IN')}).${closedMsg}`);
    await loadData();
  };

  const handleConfirmReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTx) return;
    if (!reverseReason.trim()) {
      setFormError('Mandatory reason is required to reverse a transaction.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitReverseTransaction(reverseTx, reverseReason.trim());
    } catch (err: any) {
      if (err?.requires_owner_password) {
        const target = reverseTx;
        const savedReason = reverseReason.trim();
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day Reversal)',
          description: err.message || `Day ${target.date} is CLOSED. Enter Store Owner password to reverse "${target.purpose}".`,
          requireReason: false,
          confirmLabel: 'Verify & Reverse Entry',
          onConfirm: async (pwd) => {
            await submitReverseTransaction(target, savedReason, pwd);
          },
        });
      } else {
        setFormError(err.message || 'Failed to reverse transaction');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenCorrection = (tx: FinancialTransaction) => {
    setSelectedTx(tx);
    setCorrectedAmount(tx.amount);
    setCorrectionReason('');
    setFormError(null);
    setShowCorrectionModal(true);
  };

  const submitCorrection = async (ownerPassword?: string, reasonFromPrompt?: string) => {
    if (!selectedTx) return;
    const effectiveReason = reasonFromPrompt || correctionReason.trim();
    await api.correctTransaction(selectedTx.id, {
      new_amount: correctedAmount,
      reason: effectiveReason,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });

    setShowCorrectionModal(false);
    setSelectedTx(null);
    setOverridePrompt(null);
    showSuccess(`Posted Rule 10 net adjustment entry for "${selectedTx.purpose}".`);
    await loadData();
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTx) return;
    if (correctedAmount < 0 || isNaN(correctedAmount)) {
      setFormError('Corrected amount must be 0 or greater.');
      return;
    }
    if (!correctionReason.trim()) {
      setFormError('Rule 10 requires a documented reason for formal correction entries.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitCorrection();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required',
          description: err.message || 'This correction affects a CLOSED business day. Enter Store Owner password to post adjustment.',
          requireReason: false,
          confirmLabel: 'Verify & Post Adjustment',
          onConfirm: async (pwd) => {
            await submitCorrection(pwd);
          },
        });
      } else {
        setFormError(err.message || 'Correction failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverrideConfirm = async (ownerPassword: string, reason: string) => {
    if (!overridePrompt) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      await overridePrompt.onConfirm(ownerPassword, reason);
    } catch (err: any) {
      setOverrideError(err.message || 'Authorization failed');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const isToday = (dateStr: string) => dateStr === getTodayIST();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Money Flow &amp; Accounts</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Cash, UPI &amp; Bank ledgers, operating expenses, capital tracking, and Owner-authorized corrections
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs mr-1 shadow-xs">
            <button
              onClick={() => setActiveTab('REGISTER')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'REGISTER' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Money Register
            </button>
            {isOwner && (
              <button
                onClick={() => setActiveTab('PROFIT_LOSS')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeTab === 'PROFIT_LOSS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
                }`}
              >
                Profit &amp; Loss
              </button>
            )}
          </div>

          <button
            onClick={handleOpenNewTx}
            className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#A67C52]" />
            <span>Record Movement / Expense</span>
          </button>
        </div>
      </div>

      {pageBanner && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            pageBanner.type === 'success'
              ? 'bg-[#F4F9F5] border-[#CCE3D2] text-[#3F6B50]'
              : 'bg-[#FDF5F5] border-[#F0CCCC] text-[#A34F4F]'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {pageBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{pageBanner.text}</span>
          </div>
          <button onClick={() => setPageBanner(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Real Account Balances Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Cash in Hand / Drawer */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-1.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-semibold">Cash in Drawer</span>
            <Coins className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div className="text-2xl font-extrabold text-[#1C1917] tracking-tight">
            ₹{accounts.cash.toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-[#9A938B]">Physical retail register cash</p>
        </div>

        {/* UPI Account Balance */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-1.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-semibold">UPI Digital Receipts</span>
            <Smartphone className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div className="text-2xl font-extrabold text-[#A67C52] tracking-tight">
            ₹{accounts.upi.toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-[#9A938B]">Digital QR receipts into business</p>
        </div>

        {/* Bank Account */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-1.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between text-[#6F6962]">
            <span className="text-xs font-semibold">Bank Account</span>
            <Building2 className="w-4 h-4 text-[#3F6B50]" />
          </div>
          <div className="text-2xl font-extrabold text-[#3F6B50] tracking-tight">
            {accounts.bank !== null ? `₹${accounts.bank.toLocaleString('en-IN')}` : 'Owner Only'}
          </div>
          <p className="text-[11px] text-[#9A938B]">Recorded business bank movements</p>
        </div>
      </div>

      {/* Tab: REGISTER */}
      {activeTab === 'REGISTER' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 text-xs">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
            >
              <option value="">All Movement Types</option>
              <option value="OPERATING_EXPENSE">Operating Expenses</option>
              <option value="OWNER_CAPITAL">Owner Capital In</option>
              <option value="OWNER_WITHDRAWAL">Owner Withdrawal / Drawings</option>
              <option value="SUPPLIER_PAYMENT">Supplier Payments</option>
              <option value="CUSTOMER_DUE_COLLECTION">Customer Dues Collected</option>
              <option value="TRANSFER">Internal Transfers</option>
            </select>

            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
            >
              <option value="">All Accounts</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank</option>
            </select>
          </div>

          {/* Transactions Table */}
          <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1C1917]">
                <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                  <tr>
                    <th className="px-4 py-3.5">Date (IST)</th>
                    <th className="px-4 py-3.5">Movement Type</th>
                    <th className="px-4 py-3.5">From &rarr; To</th>
                    <th className="px-4 py-3.5">Purpose / Person</th>
                    <th className="px-4 py-3.5 text-right">Amount</th>
                    <th className="px-4 py-3.5 text-center">Status / Entry</th>
                    <th className="px-4 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3DED5]">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[#9A938B]">
                        Loading financial transactions...
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center text-[#6F6962] space-y-1">
                        <p className="font-semibold text-sm text-[#1C1917]">No financial transactions recorded yet.</p>
                        <p className="text-xs text-[#9A938B]">
                          Click &quot;+ Record Movement / Expense&quot; to log shop expenses, capital, or drawings.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => {
                      const editableSameDay = !tx.is_system_generated && isToday(tx.date) && !tx.day_closed;
                      const isReversed = Boolean(tx.is_reversed);
                      const canEditManual = !tx.is_system_generated && !isReversed && (editableSameDay || isOwner);
                      return (
                        <tr key={tx.id} className={`transition ${isReversed ? 'bg-[#FAF8F4]/70 opacity-70' : 'hover:bg-[#FAF8F4]'}`}>
                          <td className="px-4 py-3.5 text-[#6F6962] font-mono text-[11px] whitespace-nowrap">
                            {tx.date}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]">
                              {tx.transaction_type}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-[11px] font-medium whitespace-nowrap">
                            <span className="text-[#6F6962]">{tx.source_account}</span>
                            <span className="text-[#9A938B] mx-1">&rarr;</span>
                            <span className="text-[#A67C52] font-semibold">{tx.destination_account}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className={`font-semibold ${isReversed ? 'line-through text-[#6F6962]' : 'text-[#1C1917]'}`}>
                              {tx.purpose}
                            </div>
                            {tx.person_entity && (
                              <div className="text-[10px] text-[#6F6962]">{tx.person_entity}</div>
                            )}
                            {tx.notes && (
                              <div className="text-[10px] text-[#9A938B] truncate max-w-xs">{tx.notes}</div>
                            )}
                          </td>
                          <td className={`px-4 py-3.5 text-right font-bold text-sm whitespace-nowrap ${isReversed ? 'line-through text-[#9A938B]' : 'text-[#1C1917]'}`}>
                            ₹{tx.amount.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3.5 text-center whitespace-nowrap">
                            {isReversed ? (
                              <span className="text-[10px] text-[#A34F4F] bg-[#FDF5F5] px-2 py-0.5 rounded-md border border-[#F0CCCC] font-bold">
                                Reversed
                              </span>
                            ) : tx.is_system_generated ? (
                              <span className="text-[10px] text-[#6F6962] bg-[#FAF8F4] px-2 py-0.5 rounded-md border border-[#E3DED5]">
                                Auto
                              </span>
                            ) : tx.day_closed ? (
                              <span className="text-[10px] text-[#A34F4F] bg-[#FDF5F5] px-2 py-0.5 rounded-md border border-[#F0CCCC] inline-flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" /> Closed Day
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#3F6B50] bg-[#F4F9F5] px-2 py-0.5 rounded-md border border-[#CCE3D2]">
                                Manual Entry
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {!isReversed && (
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                {canEditManual && (
                                  <button
                                    onClick={() => handleOpenEdit(tx)}
                                    className="px-2.5 py-1 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-lg text-[11px] font-semibold transition shadow-xs inline-flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3 text-[#A67C52]" />
                                    <span>Edit</span>
                                  </button>
                                )}
                                {isOwner && !tx.is_system_generated && (
                                  <button
                                    onClick={() => handleOpenReverse(tx)}
                                    className="px-2.5 py-1 bg-white hover:bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC] rounded-lg text-[11px] font-semibold transition shadow-xs inline-flex items-center gap-1"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Reverse</span>
                                  </button>
                                )}
                                {isOwner && (
                                  <button
                                    onClick={() => handleOpenCorrection(tx)}
                                    className="px-2.5 py-1 bg-white hover:bg-[#FAF8F4] text-[#6F6962] hover:text-[#1C1917] border border-[#E3DED5] rounded-lg text-[11px] font-medium transition"
                                    title="Post Rule 10 net adjustment entry"
                                  >
                                    Adjust
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: PROFIT & LOSS */}
      {activeTab === 'PROFIT_LOSS' && isOwner && profitLoss && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-6 max-w-2xl mx-auto shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="border-b border-[#E3DED5] pb-3">
            <h3 className="font-bold text-base text-[#1C1917]">Store Profit &amp; Loss Statement</h3>
            <p className="text-xs text-[#6F6962]">
              Computed strictly from recorded sales, FIFO cost of goods sold, and operating expenses.
            </p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <span className="text-[#1C1917] font-semibold">Gross Retail Sales</span>
              <span className="font-bold text-[#3F6B50] text-base">
                ₹{(profitLoss.grossSales || 0).toLocaleString('en-IN')}
              </span>
            </div>

            {Number(profitLoss.totalRefunds || 0) > 0 && (
              <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
                <span className="text-[#1C1917] font-semibold">Customer Returns / Refunds</span>
                <span className="font-semibold text-[#A34F4F]">
                  -₹{Number(profitLoss.totalRefunds).toLocaleString('en-IN')}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <div>
                <span className="text-[#1C1917] font-semibold">Cost of Goods Sold (COGS)</span>
                <p className="text-[10px] text-[#6F6962]">Actual cost of garments sold via FIFO</p>
              </div>
              <span className="font-semibold text-[#A34F4F]">
                -₹{(profitLoss.cogs || 0).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex justify-between items-center py-2.5 bg-[#FAF8F4] px-3.5 rounded-xl font-semibold border border-[#E3DED5]">
              <span className="text-[#1C1917]">Gross Profit (Net Sales - COGS)</span>
              <span className="text-[#A67C52] text-base font-bold">
                ₹{(profitLoss.grossProfit || 0).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <div>
                <span className="text-[#1C1917] font-semibold">Operating Expenses</span>
                <p className="text-[10px] text-[#6F6962]">Tea, electricity, cleaning, repairs, etc.</p>
              </div>
              <span className="font-semibold text-[#A67C52]">
                -₹{(profitLoss.operatingExpenses || 0).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex justify-between items-center py-3.5 bg-[#FAF8F4] border border-[#D4CDC2] px-4 rounded-xl font-bold text-base">
              <span className="text-[#1C1917]">Net Operating Profit</span>
              <span className={`text-xl font-extrabold ${(profitLoss.netProfit || 0) >= 0 ? 'text-[#3F6B50]' : 'text-[#A34F4F]'}`}>
                ₹{(profitLoss.netProfit || 0).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs text-[#6F6962] space-y-1">
            <div className="font-bold text-[#1C1917]">Accounting Integrity Rules Enforced:</div>
            <p>&bull; Inventory intake is an asset addition, not an expense.</p>
            <p>&bull; Supplier payments settle liabilities, not expenses.</p>
            <p>&bull; Owner capital and withdrawals are equity movements, not P&amp;L items.</p>
          </div>
        </div>
      )}

      {/* Record Movement Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Record Money Movement</h3>
              <button onClick={() => setShowModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveTransaction} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Movement Type</label>
                <select
                  value={txType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="OPERATING_EXPENSE">Operating Expense (Tea, cleaning, bills, repairs)</option>
                  {isOwner && (
                    <>
                      <option value="OWNER_CAPITAL">Owner Capital In (Personal money introduced)</option>
                      <option value="OWNER_WITHDRAWAL">Owner Withdrawal / Drawings (Taken for personal use)</option>
                      <option value="TRANSFER">Internal Transfer (Cash deposited into Bank)</option>
                    </>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">From (Source)</label>
                  <select
                    value={sourceAccount}
                    onChange={(e: any) => setSourceAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank Account</option>
                    <option value="EXTERNAL">External / Owner Pocket</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">To (Destination)</label>
                  <select
                    value={destAccount}
                    onChange={(e: any) => setDestAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="EXTERNAL">External / Vendor</option>
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank Account</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Amount"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Business Date (IST) *</label>
                  <input
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Purpose / Description *</label>
                <input
                  type="text"
                  required
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Purpose / Description"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Paid To / Person (Optional)</label>
                <input
                  type="text"
                  value={personEntity}
                  onChange={(e) => setPersonEntity(e.target.value)}
                  placeholder="Paid To / Person"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Saving...' : 'Record Movement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Manual Transaction Modal */}
      {showEditModal && editTx && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1C1917]">Edit Financial Entry</h3>
                <p className="text-[11px] text-[#6F6962]">
                  {editTx.transaction_type} &bull; Original Date: {editTx.date}
                </p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {Boolean(editTx.day_closed) && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                This entry belongs to a closed business day. Saving changes requires Owner password verification and will update daily closing totals cleanly.
              </div>
            )}

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Date (IST) *</label>
                  <input
                    type="date"
                    required
                    disabled={!isOwner}
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] disabled:bg-[#FAF8F4] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Source Account</label>
                  <select
                    value={editSourceAccount}
                    onChange={(e: any) => setEditSourceAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank</option>
                    <option value="EXTERNAL">External</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Destination Account</label>
                  <select
                    value={editDestAccount}
                    onChange={(e: any) => setEditDestAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="EXTERNAL">External</option>
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Payment Mode</label>
                  <select
                    value={editPaymentMethod}
                    onChange={(e: any) => setEditPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="BANK">Bank</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Category</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Purpose *</label>
                <input
                  type="text"
                  required
                  value={editPurpose}
                  onChange={(e) => setEditPurpose(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Person / Party</label>
                <input
                  type="text"
                  value={editPerson}
                  onChange={(e) => setEditPerson(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Audit Reason {(editDate < getTodayIST() || editTx.date < getTodayIST() || Boolean(editTx.day_closed)) ? '*' : '(Optional)'}
                </label>
                <textarea
                  rows={2}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Why is this transaction being updated?"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Reversal Modal */}
      {reverseTx && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#A34F4F]">Reverse Financial Entry</h3>
                <p className="text-[11px] text-[#6F6962]">
                  {reverseTx.purpose} (₹{reverseTx.amount.toLocaleString('en-IN')} on {reverseTx.date})
                </p>
              </div>
              <button onClick={() => setReverseTx(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleConfirmReverse} className="space-y-3 text-xs">
              <p className="text-[#6F6962]">
                This marks the entry as <strong>Reversed</strong> (preventing duplicate reversals) and updates Cash/UPI/Bank balances and closed-day snapshots safely.
              </p>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mandatory Reversal Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Enter reason for reversing this entry..."
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setReverseTx(null)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#A34F4F] hover:bg-[#8E4141] text-white rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rule 10 Formal Correction Modal */}
      {showCorrectionModal && selectedTx && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#1C1917]">Rule 10: Financial Correction Entry</h3>
                <p className="text-[11px] text-[#6F6962]">
                  {selectedTx.purpose} (Original Date: {selectedTx.date})
                </p>
              </div>
              <button
                onClick={() => setShowCorrectionModal(false)}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs space-y-1">
              <div className="text-[#6F6962]">
                Original Recorded Amount: <strong className="text-[#1C1917]">₹{selectedTx.amount}</strong>
              </div>
              <div className="text-[#6F6962]">
                Difference to be posted: <strong className="text-[#A67C52]">
                  {correctedAmount - selectedTx.amount >= 0 ? `+₹${correctedAmount - selectedTx.amount}` : `-₹${Math.abs(correctedAmount - selectedTx.amount)}`}
                </strong>
              </div>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveCorrection} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Corrected Real Amount (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={correctedAmount}
                  onChange={(e) => setCorrectedAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Documented Correction Reason *
                </label>
                <textarea
                  required
                  rows={2}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="Documented reason for correction"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowCorrectionModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Applying...' : 'Post Correction Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Owner Override Verification Prompt */}
      <OwnerOverridePrompt
        isOpen={Boolean(overridePrompt)}
        title={overridePrompt?.title}
        description={overridePrompt?.description || ''}
        requireReason={overridePrompt?.requireReason ?? false}
        initialReason={overridePrompt?.initialReason}
        confirmLabel={overridePrompt?.confirmLabel}
        errorMessage={overrideError}
        submitting={overrideSubmitting}
        onCancel={() => {
          setOverridePrompt(null);
          setOverrideError(null);
        }}
        onConfirm={handleOverrideConfirm}
      />
    </div>
  );
};
