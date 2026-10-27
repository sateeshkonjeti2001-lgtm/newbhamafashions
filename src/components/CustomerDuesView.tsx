import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  User,
  Plus,
  Coins,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  Receipt,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { CustomerDue, Customer } from '../types.ts';

export const CustomerDuesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'DUES' | 'CUSTOMERS'>('DUES');
  const [dues, setDues] = useState<CustomerDue[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING');

  // Pay Due Modal
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedDue, setSelectedDue] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [payNotes, setPayNotes] = useState('');

  // Add Customer Modal
  const [showAddCustModal, setShowAddCustModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');

  // Customer Ledger Modal
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState<Customer | null>(null);
  const [customerLedgerData, setCustomerLedgerData] = useState<{
    customer: any;
    timeline: any[];
    total_pending: number;
  } | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openCustomerLedger = async (customer: Customer) => {
    setSelectedLedgerCustomer(customer);
    setShowLedgerModal(true);
    setLoadingLedger(true);
    setCustomerLedgerData(null);
    try {
      const res = await api.getCustomerLedger(customer.id);
      setCustomerLedgerData(res);
    } catch (err: any) {
      alert(err.message || 'Failed to load ledger');
    } finally {
      setLoadingLedger(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [dRes, cRes] = await Promise.all([
        api.getCustomerDues({ status: statusFilter || undefined }),
        api.getCustomers(),
      ]);
      setDues(dRes.dues || []);
      setCustomers(cRes.customers || []);
    } catch (err: any) {
      console.error('Error loading customer dues:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const openPayModal = async (dueItem: CustomerDue) => {
    try {
      const detail = await api.getCustomerDueDetail(dueItem.id);
      setSelectedDue(detail.due);
      setPayAmount(detail.due.balance_due);
      setPayMethod('CASH');
      setPayNotes('');
      setFormError(null);
      setShowPayModal(true);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDue || payAmount <= 0) {
      setFormError('Please enter a valid positive payment amount.');
      return;
    }

    if (payAmount > selectedDue.balance_due) {
      setFormError(`Payment cannot exceed outstanding balance ₹${selectedDue.balance_due}`);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.payCustomerDue(selectedDue.id, {
        amount: payAmount,
        payment_method: payMethod,
        notes: payNotes.trim() || null,
      });

      setShowPayModal(false);
      setSelectedDue(null);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Payment collection failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    try {
      await api.createCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim() || null,
        address: newCustAddress.trim() || null,
      });
      setShowAddCustModal(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const totalOutstanding = dues
    .filter((d) => d.status === 'PENDING')
    .reduce((sum, d) => sum + d.balance_due, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Customer Dues &amp; Credit Ledger</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Track garments given on trust/credit to known customers, payments received &amp; settlement history
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs mr-1 shadow-xs">
            <button
              onClick={() => setActiveTab('DUES')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'DUES' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Credit Bills
            </button>
            <button
              onClick={() => setActiveTab('CUSTOMERS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'CUSTOMERS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Customer Directory
            </button>
          </div>

          <button
            onClick={() => setShowAddCustModal(true)}
            className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#A67C52]" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {/* Outstanding Summary Banner */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center text-[#A67C52]">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#6F6962]">Total Outstanding Customer Credit</div>
            <div className="text-2xl font-extrabold text-[#A34F4F]">
              ₹{totalOutstanding.toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#6F6962] font-semibold">Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
          >
            <option value="PENDING">Pending Dues Only</option>
            <option value="CLEARED">Cleared / Fully Paid</option>
            <option value="">All Credit Records</option>
          </select>
        </div>
      </div>

      {/* Tab: DUES */}
      {activeTab === 'DUES' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Customer Name</th>
                  <th className="px-4 py-3.5">Phone</th>
                  <th className="px-4 py-3.5">Bill Number</th>
                  <th className="px-4 py-3.5">Date Given</th>
                  <th className="px-4 py-3.5 text-right">Original Due</th>
                  <th className="px-4 py-3.5 text-right">Collected</th>
                  <th className="px-4 py-3.5 text-right">Balance Due</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                  <th className="px-4 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[#9A938B]">
                      Loading customer credit records...
                    </td>
                  </tr>
                ) : dues.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-[#6F6962] space-y-1">
                      <p className="font-semibold text-sm text-[#1C1917]">No customer credit records found.</p>
                      <p className="text-xs text-[#9A938B]">
                        When a sale is checked out with payment mode &quot;Due / Credit&quot;, it appears here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  dues.map((d) => (
                    <tr key={d.id} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5 font-semibold text-[#1C1917]">
                        {d.customer_name}
                      </td>
                      <td className="px-4 py-3.5 text-[#6F6962]">
                        {d.customer_phone || '-'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[#A67C52] font-semibold">
                        {d.bill_number || '-'}
                      </td>
                      <td className="px-4 py-3.5 text-[#6F6962] text-[11px]">
                        {new Date(d.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-[#1C1917]">
                        ₹{d.original_due}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#3F6B50]">
                        ₹{d.amount_paid}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#A34F4F]">
                        ₹{d.balance_due}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                            d.status === 'CLEARED'
                              ? 'bg-white text-[#3F6B50] border-[#E3DED5]'
                              : 'bg-white text-[#A34F4F] border-[#F0CCCC]'
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {d.balance_due > 0 && (
                          <button
                            onClick={() => openPayModal(d)}
                            className="px-3 py-1 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-[11px] font-semibold transition shadow-xs"
                          >
                            Collect Payment
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

      {/* Tab: CUSTOMERS DIRECTORY */}
      {activeTab === 'CUSTOMERS' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Customer Name</th>
                  <th className="px-4 py-3.5">Phone</th>
                  <th className="px-4 py-3.5">Address / Village</th>
                  <th className="px-4 py-3.5 text-right">Current Outstanding Credit</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#9A938B]">
                      No customers registered yet.
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => (
                    <tr key={c.id} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5 font-semibold text-[#1C1917]">{c.name}</td>
                      <td className="px-4 py-3.5 text-[#6F6962]">{c.phone || '-'}</td>
                      <td className="px-4 py-3.5 text-[#6F6962]">{c.address || '-'}</td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#A34F4F]">
                        ₹{c.total_dues || 0}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => openCustomerLedger(c)}
                          className="px-3 py-1 bg-white border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] rounded-lg text-[11px] font-semibold transition shadow-2xs flex items-center gap-1.5 ml-auto"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-[#A67C52]" />
                          <span>View Ledger</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collect Due Modal */}
      {showPayModal && selectedDue && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1C1917]">Collect Customer Due</h3>
                <p className="text-xs text-[#6F6962]">
                  {selectedDue.customer_name} &bull; Bill #{selectedDue.bill_number}
                </p>
              </div>
              <button onClick={() => setShowPayModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs space-y-1.5">
              <div className="flex justify-between text-[#6F6962]">
                <span>Original Bill Amount:</span>
                <span className="font-semibold text-[#1C1917]">₹{selectedDue.original_due}</span>
              </div>
              <div className="flex justify-between text-[#6F6962]">
                <span>Already Collected:</span>
                <span className="font-bold text-[#3F6B50]">₹{selectedDue.amount_paid}</span>
              </div>
              <div className="flex justify-between text-xs font-bold pt-1.5 border-t border-[#E3DED5] text-[#1C1917]">
                <span>Remaining Due:</span>
                <span className="text-[#A34F4F] text-sm font-extrabold">₹{selectedDue.balance_due}</span>
              </div>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCollectPayment} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Collection Amount (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={selectedDue.balance_due}
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('CASH')}
                    className={`py-2 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5 ${
                      payMethod === 'CASH'
                        ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                        : 'bg-white text-[#6F6962] border border-[#D4CDC2] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <Coins className="w-3.5 h-3.5 text-[#A67C52]" /> Cash Drawer
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('UPI')}
                    className={`py-2 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5 ${
                      payMethod === 'UPI'
                        ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                        : 'bg-white text-[#6F6962] border border-[#D4CDC2] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5 text-[#A67C52]" /> UPI Digital
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / Reference</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Notes / Reference"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Recording...' : 'Collect & Settle (₹' + payAmount + ')'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <h3 className="font-bold text-sm text-[#1C1917]">Add Customer Profile</h3>
            <form onSubmit={handleCreateCustomer} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="Customer Full Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="Phone Number"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Village / Street Address</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  placeholder="Village / Street Address"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowAddCustModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm transition"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Ledger Statement Modal */}
      {showLedgerModal && selectedLedgerCustomer && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-3xl w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-[#A67C52]" />
                  <h3 className="font-bold text-base text-[#1C1917]">Customer Account Ledger</h3>
                </div>
                <p className="text-xs text-[#6F6962] mt-0.5">
                  Complete chronological statement &amp; running balance for <strong className="text-[#1C1917]">{selectedLedgerCustomer.name}</strong>
                  {selectedLedgerCustomer.phone && ` (${selectedLedgerCustomer.phone})`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowLedgerModal(false);
                  setSelectedLedgerCustomer(null);
                  setCustomerLedgerData(null);
                }}
                className="text-[#9A938B] hover:text-[#1C1917] p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs">
              <div>
                <span className="text-[#6F6962] block">Customer Name</span>
                <span className="font-bold text-[#1C1917] text-sm">{selectedLedgerCustomer.name}</span>
                {selectedLedgerCustomer.address && (
                  <span className="text-[10px] text-[#6F6962] block mt-0.5 truncate">{selectedLedgerCustomer.address}</span>
                )}
              </div>
              <div>
                <span className="text-[#6F6962] block">Total Purchases</span>
                <span className="font-bold text-[#1C1917] text-sm">
                  ₹{Number(selectedLedgerCustomer.total_purchases || 0).toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span className="text-[#6F6962] block">Current Outstanding Due</span>
                <span className="font-extrabold text-[#A34F4F] text-base">
                  ₹{Number(customerLedgerData?.total_pending ?? selectedLedgerCustomer.total_dues ?? 0).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Ledger Transactions Table */}
            <div className="border border-[#E3DED5] rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs text-[#1C1917]">
                <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5] sticky top-0">
                  <tr>
                    <th className="px-3.5 py-2.5">Date &amp; Time</th>
                    <th className="px-3.5 py-2.5">Transaction Type</th>
                    <th className="px-3.5 py-2.5">Reference #</th>
                    <th className="px-3.5 py-2.5 text-right text-[#A34F4F]">Debit (+Due)</th>
                    <th className="px-3.5 py-2.5 text-right text-[#3F6B50]">Credit (-Paid)</th>
                    <th className="px-3.5 py-2.5 text-right font-bold">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3DED5]">
                  {loadingLedger ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[#9A938B]">
                        Loading account statement...
                      </td>
                    </tr>
                  ) : !customerLedgerData || customerLedgerData.timeline.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[#9A938B]">
                        No credit sales or payment ledger transactions recorded for this customer.
                      </td>
                    </tr>
                  ) : (
                    customerLedgerData.timeline.map((entry: any) => (
                      <tr key={entry.id} className="hover:bg-[#FAF8F4] transition">
                        <td className="px-3.5 py-2.5 whitespace-nowrap text-[11px]">
                          <div>{entry.date ? new Date(entry.date).toLocaleDateString('en-IN') : '-'}</div>
                          <div className="text-[10px] text-[#6F6962]">
                            {entry.date ? new Date(entry.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              entry.type === 'CREDIT_BILL'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : entry.type === 'PAYMENT'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : entry.type === 'RETURN_ADJUSTMENT'
                                ? 'bg-blue-50 text-blue-800 border-blue-200'
                                : 'bg-red-50 text-red-800 border-red-200'
                            }`}
                          >
                            {entry.type === 'CREDIT_BILL'
                              ? 'Credit Sale'
                              : entry.type === 'PAYMENT'
                              ? 'Due Repayment'
                              : entry.type === 'RETURN_ADJUSTMENT'
                              ? 'Return Adjust'
                              : 'Bill Voided'}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px]">
                          <div>{entry.reference}</div>
                          {entry.notes && (
                            <div className="text-[10px] text-[#6F6962] font-sans truncate max-w-xs">{entry.notes}</div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-[#A34F4F]">
                          {entry.debit > 0 ? `+₹${entry.debit}` : '-'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-[#3F6B50]">
                          {entry.credit > 0 ? `-₹${entry.credit}` : '-'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-extrabold text-[#1C1917]">
                          ₹{entry.balance}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-[#E3DED5] text-xs">
              <span className="text-[#6F6962]">
                Verified against database transactions &amp; financial records
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowLedgerModal(false);
                  setSelectedLedgerCustomer(null);
                  setCustomerLedgerData(null);
                }}
                className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm transition"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
