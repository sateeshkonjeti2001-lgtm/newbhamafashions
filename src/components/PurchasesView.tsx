import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  Search,
  Receipt,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  X,
  CreditCard,
  Building,
  Calendar,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { Supplier, Purchase, Product } from '../types.ts';

export const PurchasesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'PURCHASES' | 'SUPPLIERS'>('PURCHASES');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // New Purchase Modal
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<'BANK' | 'CASH' | 'UPI'>('BANK');
  const [purchaseNotes, setPurchaseNotes] = useState('');

  // Purchase Line Items
  const [purchaseItems, setPurchaseItems] = useState<
    { product_id: string; product_name: string; quantity: number; unit_cost: number; total: number }[]
  >([]);

  // Add Item to purchase line
  const [selectedProdId, setSelectedProdId] = useState('');
  const [itemQty, setItemQty] = useState<number>(1);
  const [itemCost, setItemCost] = useState<number>(0);

  // New Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supGst, setSupGst] = useState('');

  // Settle Due Modal
  const [showPayDueModal, setShowPayDueModal] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [payDueAmount, setPayDueAmount] = useState<number>(0);
  const [payDueMethod, setPayDueMethod] = useState<'BANK' | 'CASH' | 'UPI'>('BANK');
  const [payDueNotes, setPayDueNotes] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pRes, sRes, prodRes] = await Promise.all([
        api.getPurchases(),
        api.getSuppliers(),
        api.getProducts(),
      ]);
      setPurchases(pRes.purchases || []);
      setSuppliers(sRes.suppliers || []);
      setProducts(prodRes.products || []);
    } catch (err: any) {
      console.error('Error loading purchases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddLineItem = () => {
    if (!selectedProdId || itemQty <= 0 || itemCost <= 0) return;
    const prod = products.find((p) => p.id === selectedProdId);
    if (!prod) return;

    const total = itemQty * itemCost;
    setPurchaseItems([
      ...purchaseItems,
      {
        product_id: prod.id,
        product_name: prod.name,
        quantity: itemQty,
        unit_cost: itemCost,
        total,
      },
    ]);

    setSelectedProdId('');
    setItemQty(1);
    setItemCost(0);
  };

  const removeLineItem = (idx: number) => {
    setPurchaseItems(purchaseItems.filter((_, i) => i !== idx));
  };

  const totalPurchaseBill = purchaseItems.reduce((s, i) => s + i.total, 0);

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !invoiceNumber.trim() || purchaseItems.length === 0) {
      setFormError('Supplier, invoice number, and at least one item are required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const pAmt = paidAmount === '' ? 0 : Number(paidAmount);
    if (pAmt > totalPurchaseBill) {
      setFormError('Paid amount cannot exceed total purchase invoice amount.');
      setSubmitting(false);
      return;
    }

    try {
      await api.createPurchase({
        supplier_id: supplierId,
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        total_amount: totalPurchaseBill,
        paid_amount: pAmt,
        payment_method: paymentMethod,
        notes: purchaseNotes.trim() || null,
        items: purchaseItems.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
        })),
      });

      setShowPurchaseModal(false);
      setPurchaseItems([]);
      setInvoiceNumber('');
      setPaidAmount('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save purchase invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;
    try {
      const res = await api.createSupplier({
        name: supName.trim(),
        phone: supPhone.trim() || null,
        address: supAddress.trim() || null,
        gst_or_pan: supGst.trim() || null,
      });
      setShowSupplierModal(false);
      setSupName('');
      setSupPhone('');
      setSupAddress('');
      setSupGst('');
      loadData();
      setSupplierId(res.id);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSettleDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchase || payDueAmount <= 0) return;

    setSubmitting(true);
    try {
      await api.paySupplierDue(selectedPurchase.id, {
        amount: payDueAmount,
        payment_method: payDueMethod,
        notes: payDueNotes.trim() || null,
      });

      setShowPayDueModal(false);
      setSelectedPurchase(null);
      setPayDueAmount(0);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Purchases &amp; Suppliers</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Stock intake invoices, supplier credit balances &amp; settlement payments (Owner Restricted)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs mr-1 shadow-xs">
            <button
              onClick={() => setActiveTab('PURCHASES')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'PURCHASES' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Invoices
            </button>
            <button
              onClick={() => setActiveTab('SUPPLIERS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'SUPPLIERS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Suppliers Directory
            </button>
          </div>

          <button
            onClick={() => setShowSupplierModal(true)}
            className="px-3.5 py-2 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <Building className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>New Supplier</span>
          </button>

          <button
            onClick={() => setShowPurchaseModal(true)}
            className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#A67C52]" />
            <span>Record Purchase Bill</span>
          </button>
        </div>
      </div>

      {/* Tab 1: PURCHASES */}
      {activeTab === 'PURCHASES' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Invoice # / Date</th>
                  <th className="px-4 py-3.5">Supplier Name</th>
                  <th className="px-4 py-3.5 text-right">Total Bill</th>
                  <th className="px-4 py-3.5 text-right">Paid Amount</th>
                  <th className="px-4 py-3.5 text-right">Balance Due</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                  <th className="px-4 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#9A938B]">
                      Loading purchase invoices...
                    </td>
                  </tr>
                ) : purchases.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-[#6F6962] space-y-2">
                      <Truck className="w-8 h-8 mx-auto text-[#A67C52] stroke-1" />
                      <p className="font-semibold text-sm text-[#1C1917]">No purchase invoices recorded.</p>
                      <p className="text-xs text-[#9A938B]">
                        Record supplier bills when taking stock into New Bhama Fashions.
                      </p>
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-bold text-[#1C1917]">{p.invoice_number}</div>
                        <div className="text-[10px] text-[#6F6962]">{p.invoice_date}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[#1C1917]">{p.supplier_name}</div>
                        {p.supplier_phone && (
                          <div className="text-[10px] text-[#6F6962]">{p.supplier_phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#1C1917]">
                        ₹{p.total_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#3F6B50]">
                        ₹{p.paid_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#A34F4F]">
                        ₹{p.balance_due.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                            p.payment_status === 'PAID'
                              ? 'bg-white text-[#3F6B50] border-[#E3DED5]'
                              : p.payment_status === 'PARTIAL'
                              ? 'bg-white text-[#A67C52] border-[#E3DED5]'
                              : 'bg-white text-[#A34F4F] border-[#F0CCCC]'
                          }`}
                        >
                          {p.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {p.balance_due > 0 && (
                          <button
                            onClick={() => {
                              setSelectedPurchase(p);
                              setPayDueAmount(p.balance_due);
                              setShowPayDueModal(true);
                            }}
                            className="px-3 py-1 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-[11px] font-semibold transition shadow-xs"
                          >
                            Pay Due
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

      {/* Tab 2: SUPPLIERS DIRECTORY */}
      {activeTab === 'SUPPLIERS' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Supplier / Agency</th>
                  <th className="px-4 py-3.5">Phone</th>
                  <th className="px-4 py-3.5">GST / PAN</th>
                  <th className="px-4 py-3.5">City / Address</th>
                  <th className="px-4 py-3.5 text-right">Outstanding Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#9A938B]">
                      No suppliers registered yet.
                    </td>
                  </tr>
                ) : (
                  suppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5 font-semibold text-[#1C1917]">{s.name}</td>
                      <td className="px-4 py-3.5 text-[#6F6962]">{s.phone || '-'}</td>
                      <td className="px-4 py-3.5 font-mono text-[#6F6962]">{s.gst_or_pan || '-'}</td>
                      <td className="px-4 py-3.5 text-[#6F6962]">{s.address || '-'}</td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#A34F4F]">
                        ₹{s.total_dues?.toLocaleString('en-IN') || 0}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Purchase Bill Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-2xl w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Record Purchase Bill</h3>
              <button
                onClick={() => setShowPurchaseModal(false)}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Supplier *
                  </label>
                  <select
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">Select Supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Invoice / Bill # *
                  </label>
                  <input
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Invoice / Bill #"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Invoice Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              {/* Items in Invoice */}
              <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] space-y-3">
                <div className="font-bold text-[#1C1917]">Stock Items on Invoice</div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedProdId}
                    onChange={(e) => {
                      setSelectedProdId(e.target.value);
                      const prod = products.find((p) => p.id === e.target.value);
                      if (prod && prod.purchase_cost) {
                        setItemCost(prod.purchase_cost);
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">Choose item to add...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Code: {p.code || p.barcode || 'N/A'})
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="1"
                    value={itemQty}
                    onChange={(e) => setItemQty(Math.max(1, Number(e.target.value)))}
                    placeholder="Qty"
                    className="w-20 px-2 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-center focus:outline-none focus:border-[#A67C52]"
                  />

                  <input
                    type="number"
                    min="0"
                    value={itemCost || ''}
                    onChange={(e) => setItemCost(Number(e.target.value))}
                    placeholder="Cost ₹"
                    className="w-24 px-2 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-right focus:outline-none focus:border-[#A67C52]"
                  />

                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold transition shadow-xs"
                  >
                    + Add Item
                  </button>
                </div>

                {/* Items list */}
                {purchaseItems.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#E3DED5]">
                    {purchaseItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 bg-white border border-[#E3DED5] rounded-xl text-xs shadow-xs"
                      >
                        <span className="font-semibold text-[#1C1917]">{item.product_name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[#6F6962]">
                            {item.quantity} &times; ₹{item.unit_cost} ={' '}
                            <strong className="text-[#1C1917]">₹{item.total}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLineItem(idx)}
                            className="text-[#A34F4F] hover:text-[#7D3838] p-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 font-bold text-sm text-[#1C1917]">
                  <span>Total Invoice Amount:</span>
                  <span className="text-[#A67C52] text-base">₹{totalPurchaseBill}</span>
                </div>
              </div>

              {/* Payment details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Amount Paid Now (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={totalPurchaseBill}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0 if full credit"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                  <div className="text-[11px] text-[#6F6962] mt-1">
                    Balance due to supplier: ₹{Math.max(0, totalPurchaseBill - (Number(paidAmount) || 0))}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Payment Mode (If paying now)
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e: any) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="BANK">Bank Transfer / NEFT / RTGS</option>
                    <option value="UPI">UPI / Digital</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowPurchaseModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Recording...' : 'Save & Intake Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Supplier Due Modal */}
      {showPayDueModal && selectedPurchase && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#1C1917]">Settle Supplier Due</h3>
                <p className="text-xs text-[#6F6962]">
                  Bill #{selectedPurchase.invoice_number} ({selectedPurchase.supplier_name})
                </p>
              </div>
              <button
                onClick={() => setShowPayDueModal(false)}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSettleDue} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Payment Amount (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={selectedPurchase.balance_due}
                  value={payDueAmount}
                  onChange={(e) => setPayDueAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Payment Method</label>
                <select
                  value={payDueMethod}
                  onChange={(e: any) => setPayDueMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="BANK">Bank Account / Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / Ref</label>
                <input
                  type="text"
                  value={payDueNotes}
                  onChange={(e) => setPayDueNotes(e.target.value)}
                  placeholder="Notes / Ref"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowPayDueModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <h3 className="font-bold text-sm text-[#1C1917]">Add Supplier</h3>
            <form onSubmit={handleCreateSupplier} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Supplier / Agency Name *
                </label>
                <input
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="Supplier / Agency Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Phone</label>
                <input
                  type="tel"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                  placeholder="Phone Number"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">GST / PAN</label>
                <input
                  type="text"
                  value={supGst}
                  onChange={(e) => setSupGst(e.target.value)}
                  placeholder="GST / PAN"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Address / City</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  placeholder="Address / City"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm transition"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
