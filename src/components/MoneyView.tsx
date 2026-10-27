import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Plus,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  Coins,
  Building2,
  Smartphone,
  AlertTriangle,
  FileText,
  Calendar,
  X,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { FinancialTransaction, UserRole } from '../types.ts';

export const MoneyView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'PROFIT_LOSS'>('REGISTER');
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [accounts, setAccounts] = useState<{ cash: number; upi: number; bank: number | null }>({
    cash: 0,
    upi: 0,
    bank: null,
  });
  const [profitLoss, setProfitLoss] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);

  // Rule 10 Formal Correction Modal
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);
  const [correctedAmount, setCorrectedAmount] = useState<number>(0);
  const [correctionReason, setCorrectionReason] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tRes, aRes, plRes] = await Promise.all([
        api.getTransactions({ type: typeFilter || undefined, account: accountFilter || undefined }),
        api.getAccounts(),
        api.getProfitLoss(),
      ]);
      setTransactions(tRes.transactions || []);
      setAccounts(aRes.accounts);
      setProfitLoss(plRes);
    } catch (err: any) {
      console.error('Error loading money data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [typeFilter, accountFilter]);

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
    setTxDate(new Date().toISOString().split('T')[0]);
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
    } else if (newType === 'OWNER_DRAWINGS') {
      setSourceAccount('CASH');
      setDestAccount('EXTERNAL');
      setCategory('Owner Drawings');
    } else if (newType === 'TRANSFER') {
      setSourceAccount('CASH');
      setDestAccount('BANK');
      setCategory('Internal Transfer');
    }
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
      await api.createTransaction({
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
      });

      setShowModal(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record transaction');
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

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTx) return;
    if (correctedAmount <= 0) {
      setFormError('Corrected amount must be greater than 0.');
      return;
    }
    if (!correctionReason.trim()) {
      setFormError('Rule 10 requires a documented reason for past/closed entry corrections.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.correctTransaction(selectedTx.id, {
        corrected_amount: correctedAmount,
        reason: correctionReason.trim(),
      });

      setShowCorrectionModal(false);
      setSelectedTx(null);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Correction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const isToday = (dateStr: string) => {
    return dateStr === new Date().toISOString().split('T')[0];
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Money Flow &amp; Accounts</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Cash, UPI &amp; Bank ledgers, operating expenses, capital tracking, and formal correction audit
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
            <button
              onClick={() => setActiveTab('PROFIT_LOSS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'PROFIT_LOSS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Profit &amp; Loss
            </button>
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
            {accounts.bank !== null ? `₹${accounts.bank.toLocaleString('en-IN')}` : '₹0'}
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
              <option value="OWNER_DRAWINGS">Owner Drawings / Withdrawal</option>
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
                    <th className="px-4 py-3.5">Date</th>
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
                      return (
                        <tr key={tx.id} className="hover:bg-[#FAF8F4] transition">
                          <td className="px-4 py-3.5 text-[#6F6962] font-mono text-[11px]">
                            {tx.date}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]">
                              {tx.transaction_type}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-[11px] font-medium">
                            <span className="text-[#6F6962]">{tx.source_account}</span>
                            <span className="text-[#9A938B] mx-1">&rarr;</span>
                            <span className="text-[#A67C52] font-semibold">{tx.destination_account}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-[#1C1917]">{tx.purpose}</div>
                            {tx.person_entity && (
                              <div className="text-[10px] text-[#6F6962]">{tx.person_entity}</div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold text-[#1C1917] text-sm">
                            ₹{tx.amount.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {tx.is_system_generated ? (
                              <span className="text-[10px] text-[#6F6962] bg-[#FAF8F4] px-2 py-0.5 rounded-full border border-[#E3DED5]">
                                Auto
                              </span>
                            ) : tx.day_closed ? (
                              <span className="text-[10px] text-[#A34F4F] bg-[#FDF5F5] px-2 py-0.5 rounded-full border border-[#F0CCCC]">
                                Locked / Closed
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#3F6B50] bg-[#F4F9F5] px-2 py-0.5 rounded-full border border-[#CCE3D2]">
                                Manual Entry
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            {!tx.is_system_generated && !tx.is_reversed && (
                              <button
                                onClick={() => handleOpenCorrection(tx)}
                                className="px-2.5 py-1 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-lg text-[11px] font-semibold transition shadow-xs"
                              >
                                {editableSameDay ? 'Edit Entry' : 'Correct (Rule 10)'}
                              </button>
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
      {activeTab === 'PROFIT_LOSS' && profitLoss && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-6 max-w-2xl mx-auto shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="border-b border-[#E3DED5] pb-3">
            <h3 className="font-bold text-base text-[#1C1917]">Store Profit &amp; Loss Statement</h3>
            <p className="text-xs text-[#6F6962]">
              Computed strictly from recorded sales, FIFO cost of goods sold, and operating expenses.
            </p>
          </div>

          <div className="space-y-3 text-sm">
            {/* Revenue */}
            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <span className="text-[#1C1917] font-semibold">Gross Retail Sales</span>
              <span className="font-bold text-[#3F6B50] text-base">
                ₹{profitLoss.grossSales.toLocaleString('en-IN')}
              </span>
            </div>

            {/* COGS */}
            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <div>
                <span className="text-[#1C1917] font-semibold">Cost of Goods Sold (COGS)</span>
                <p className="text-[10px] text-[#6F6962]">Actual cost of garments sold via FIFO</p>
              </div>
              <span className="font-semibold text-[#A34F4F]">
                -₹{profitLoss.cogs.toLocaleString('en-IN')}
              </span>
            </div>

            {/* Gross Profit */}
            <div className="flex justify-between items-center py-2.5 bg-[#FAF8F4] px-3.5 rounded-xl font-semibold border border-[#E3DED5]">
              <span className="text-[#1C1917]">Gross Profit (Sales - COGS)</span>
              <span className="text-[#A67C52] text-base font-bold">
                ₹{profitLoss.grossProfit.toLocaleString('en-IN')}
              </span>
            </div>

            {/* Operating Expenses */}
            <div className="flex justify-between items-center py-2 border-b border-[#E3DED5]">
              <div>
                <span className="text-[#1C1917] font-semibold">Operating Expenses</span>
                <p className="text-[10px] text-[#6F6962]">Tea, electricity, cleaning, staff wages, etc.</p>
              </div>
              <span className="font-semibold text-[#A67C52]">
                -₹{profitLoss.operatingExpenses.toLocaleString('en-IN')}
              </span>
            </div>

            {/* Net Profit */}
            <div className="flex justify-between items-center py-3.5 bg-[#FAF8F4] border border-[#D4CDC2] px-4 rounded-xl font-bold text-base">
              <span className="text-[#1C1917]">Net Operating Profit</span>
              <span className={`text-xl font-extrabold ${profitLoss.netProfit >= 0 ? 'text-[#3F6B50]' : 'text-[#A34F4F]'}`}>
                ₹{profitLoss.netProfit.toLocaleString('en-IN')}
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
                  <option value="OWNER_CAPITAL">Owner Capital In (Personal money introduced)</option>
                  <option value="OWNER_DRAWINGS">Owner Drawings / Withdrawal (Taken for personal use)</option>
                  <option value="TRANSFER">Internal Transfer (Cash deposited into Bank)</option>
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
                    onChange={(e) => setAmount(Number(e.target.value))}
                    placeholder="Amount"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Date *</label>
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
                  min="1"
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
    </div>
  );
};
