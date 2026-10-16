import React, { useState, useEffect } from 'react';
import {
  Armchair,
  Landmark,
  Plus,
  Building,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  Coins,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { Asset, BusinessLoan } from '../types.ts';

export const AssetsLoansView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ASSETS' | 'LOANS'>('ASSETS');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<BusinessLoan[]>([]);
  const [loading, setLoading] = useState(true);

  // New Asset Modal
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState('Store Fixtures');
  const [purchaseCost, setPurchaseCost] = useState<number | ''>('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [condition, setCondition] = useState('NEW');
  const [assetNotes, setAssetNotes] = useState('');

  // New Loan Modal
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [lenderName, setLenderName] = useState('');
  const [principalAmount, setPrincipalAmount] = useState<number | ''>('');
  const [interestRate, setInterestRate] = useState<number | ''>('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyEmi, setMonthlyEmi] = useState<number | ''>('');
  const [loanNotes, setLoanNotes] = useState('');

  // Loan Repayment Modal
  const [showPayLoanModal, setShowPayLoanModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<BusinessLoan | null>(null);
  const [repayAmount, setRepayAmount] = useState<number | ''>('');
  const [repayMethod, setRepayMethod] = useState<'BANK' | 'CASH' | 'UPI'>('BANK');
  const [repayNotes, setRepayNotes] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [aRes, lRes] = await Promise.all([
        api.getAssets(),
        api.getLoans(),
      ]);
      setAssets(aRes.assets || []);
      setLoans(lRes.loans || []);
    } catch (err: any) {
      console.error('Error loading assets/loans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetName.trim() || !purchaseCost || Number(purchaseCost) <= 0) {
      setFormError('Asset name and purchase cost are required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.createAsset({
        name: assetName.trim(),
        category: assetCategory,
        purchase_cost: Number(purchaseCost),
        purchase_date: purchaseDate,
        condition,
        notes: assetNotes.trim() || null,
      });

      setShowAssetModal(false);
      setAssetName('');
      setPurchaseCost('');
      setAssetNotes('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save asset');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lenderName.trim() || !principalAmount || Number(principalAmount) <= 0) {
      setFormError('Lender name and principal amount are required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.createLoan({
        lender_name: lenderName.trim(),
        principal_amount: Number(principalAmount),
        interest_rate: interestRate ? Number(interestRate) : 0,
        start_date: startDate,
        monthly_emi: monthlyEmi ? Number(monthlyEmi) : 0,
        notes: loanNotes.trim() || null,
      });

      setShowLoanModal(false);
      setLenderName('');
      setPrincipalAmount('');
      setInterestRate('');
      setMonthlyEmi('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record loan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRepayLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan || !repayAmount || Number(repayAmount) <= 0) {
      setFormError('Please enter a valid repayment amount.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.repayLoan(selectedLoan.id, {
        amount: Number(repayAmount),
        payment_method: repayMethod,
        notes: repayNotes.trim() || null,
      });

      setShowPayLoanModal(false);
      setSelectedLoan(null);
      setRepayAmount('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to record repayment');
    } finally {
      setSubmitting(false);
    }
  };

  const totalAssetValue = assets.reduce((sum, a) => sum + a.purchase_cost, 0);
  const totalLoanBalance = loans.reduce((sum, l) => sum + l.balance_amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Assets &amp; Store Loans</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Physical store fixtures, computers, air conditioners &amp; business loan balances (Owner Only)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-[#F0EDE6] p-1 rounded-xl text-xs mr-2">
            <button
              onClick={() => setActiveTab('ASSETS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'ASSETS'
                  ? 'bg-white text-[#1C1917] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Store Assets
            </button>
            <button
              onClick={() => setActiveTab('LOANS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'LOANS'
                  ? 'bg-white text-[#1C1917] shadow-xs'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Business Loans
            </button>
          </div>

          {activeTab === 'ASSETS' ? (
            <button
              onClick={() => setShowAssetModal(true)}
              className="px-3.5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4 text-[#A67C52]" />
              <span>Add Store Asset</span>
            </button>
          ) : (
            <button
              onClick={() => setShowLoanModal(true)}
              className="px-3.5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4 text-[#A67C52]" />
              <span>Record Loan</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 flex items-center gap-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="p-3 rounded-xl bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5]">
            <Armchair className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-[#6F6962]">Total Store Assets Valuation</div>
            <div className="text-2xl font-bold text-[#1C1917] tracking-tight">
              ₹{totalAssetValue.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-[#9A938B]">{assets.length} items registered</p>
          </div>
        </div>

        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 flex items-center gap-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="p-3 rounded-xl bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC]">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-[#6F6962]">Outstanding Loan Balance</div>
            <div className="text-2xl font-bold text-[#A34F4F] tracking-tight">
              ₹{totalLoanBalance.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-[#9A938B]">{loans.length} active borrowings</p>
          </div>
        </div>
      </div>

      {/* Tab 1: ASSETS */}
      {activeTab === 'ASSETS' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3">Asset Item</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Purchase Date</th>
                  <th className="px-4 py-3 text-right">Cost Price</th>
                  <th className="px-4 py-3 text-center">Condition</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[#9A938B] space-y-1">
                      <Armchair className="w-8 h-8 mx-auto text-[#9A938B] stroke-1" />
                      <p className="font-semibold text-[#1C1917]">No store assets recorded.</p>
                      <p className="text-xs text-[#6F6962]">
                        Record furniture, mannequins, AC units, display racks, and billing computers.
                      </p>
                    </td>
                  </tr>
                ) : (
                  assets.map((a) => (
                    <tr key={a.id} className="hover:bg-[#FAF8F4]/80 transition">
                      <td className="px-4 py-3 font-semibold text-[#1C1917]">{a.name}</td>
                      <td className="px-4 py-3 text-[#6F6962]">{a.category}</td>
                      <td className="px-4 py-3 text-[#6F6962]">{a.purchase_date}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#1C1917]">
                        ₹{a.purchase_cost.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2]">
                          {a.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6F6962]">{a.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: LOANS */}
      {activeTab === 'LOANS' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3">Lender / Institution</th>
                  <th className="px-4 py-3 text-right">Principal</th>
                  <th className="px-4 py-3 text-center">Interest</th>
                  <th className="px-4 py-3 text-right">Monthly EMI</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[#9A938B] space-y-1">
                      <Landmark className="w-8 h-8 mx-auto text-[#9A938B] stroke-1" />
                      <p className="font-semibold text-[#1C1917]">No loans or outside borrowings recorded.</p>
                    </td>
                  </tr>
                ) : (
                  loans.map((l) => (
                    <tr key={l.id} className="hover:bg-[#FAF8F4]/80 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#1C1917]">{l.lender_name}</div>
                        <div className="text-[10px] text-[#6F6962]">Start: {l.start_date}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-[#6F6962]">
                        ₹{l.principal_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-medium text-[#1C1917]">
                        {l.interest_rate}%
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[#1C1917]">
                        {l.monthly_emi ? `₹${l.monthly_emi.toLocaleString('en-IN')}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#A34F4F] text-sm">
                        ₹{l.balance_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {l.balance_amount > 0 && (
                          <button
                            onClick={() => {
                              setSelectedLoan(l);
                              setRepayAmount(l.monthly_emi || '');
                              setShowPayLoanModal(true);
                            }}
                            className="px-3 py-1.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-[11px] font-semibold transition shadow-xs"
                          >
                            Pay EMI / Repay
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Asset Modal */}
      {showAssetModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Add Store Asset</h3>
              <button onClick={() => setShowAssetModal(false)} className="text-[#6F6962] hover:text-[#1C1917] p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateAsset} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Asset Name *</label>
                <input
                  type="text"
                  required
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="Asset Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Category</label>
                  <select
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="Store Fixtures">Store Fixtures &amp; Racks</option>
                    <option value="Electronics & IT">Electronics &amp; IT / Printers</option>
                    <option value="Display & Mannequins">Display &amp; Mannequins</option>
                    <option value="Air Conditioning">Air Conditioning &amp; Fans</option>
                    <option value="Signage">Signage &amp; Branding</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Purchase Cost (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(Number(e.target.value))}
                    placeholder="Purchase Cost"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Condition</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="NEW">New</option>
                    <option value="GOOD">Good Working Condition</option>
                    <option value="FAIR">Fair / Needs Maintenance</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / Warranty</label>
                <input
                  type="text"
                  value={assetNotes}
                  onChange={(e) => setAssetNotes(e.target.value)}
                  placeholder="Warranty / Notes"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowAssetModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold disabled:opacity-50 transition shadow-sm"
                >
                  {submitting ? 'Saving...' : 'Save Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Loan Modal */}
      {showLoanModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Record Business Loan</h3>
              <button onClick={() => setShowLoanModal(false)} className="text-[#6F6962] hover:text-[#1C1917] p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateLoan} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Lender / Bank Name *</label>
                <input
                  type="text"
                  required
                  value={lenderName}
                  onChange={(e) => setLenderName(e.target.value)}
                  placeholder="Lender / Bank Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Principal Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(Number(e.target.value))}
                    placeholder="Principal Amount"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Interest Rate (% p.a.)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={interestRate}
                    onChange={(e) => setInterestRate(Number(e.target.value))}
                    placeholder="Interest Rate"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Monthly EMI (₹)</label>
                  <input
                    type="number"
                    value={monthlyEmi}
                    onChange={(e) => setMonthlyEmi(Number(e.target.value))}
                    placeholder="Monthly EMI"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / Account Reference</label>
                <input
                  type="text"
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                  placeholder="Notes / Account Reference"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowLoanModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold disabled:opacity-50 transition shadow-sm"
                >
                  {submitting ? 'Saving...' : 'Record Loan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Repay Loan Modal */}
      {showPayLoanModal && selectedLoan && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1C1917]">Record Loan Payment</h3>
                <p className="text-xs text-[#6F6962]">{selectedLoan.lender_name}</p>
              </div>
              <button onClick={() => setShowPayLoanModal(false)} className="text-[#6F6962] hover:text-[#1C1917] p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs">
              <span className="text-[#6F6962]">Current Outstanding Balance: </span>
              <strong className="text-[#A34F4F] font-bold">
                ₹{selectedLoan.balance_amount.toLocaleString('en-IN')}
              </strong>
            </div>

            {formError && (
              <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleRepayLoan} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Repayment Amount (₹) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  max={selectedLoan.balance_amount}
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Payment Method</label>
                <select
                  value={repayMethod}
                  onChange={(e: any) => setRepayMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="BANK">Bank Account / ECS / Cheque</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / UTR</label>
                <input
                  type="text"
                  value={repayNotes}
                  onChange={(e) => setRepayNotes(e.target.value)}
                  placeholder="Notes / UTR"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowPayLoanModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold disabled:opacity-50 transition shadow-sm"
                >
                  {submitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
