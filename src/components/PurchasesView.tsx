import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  AlertCircle,
  CheckCircle2,
  Edit3,
  RotateCcw,
  X,
  Building,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { Supplier, Purchase, Product, UserRole } from '../types.ts';
import { getTodayIST } from '../utils/date.ts';
import { OwnerOverridePrompt } from './OwnerOverridePrompt.tsx';

interface PurchasesViewProps {
  role?: UserRole;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({ role }) => {
  const isOwner = role === 'OWNER' || role === undefined;
  const [activeTab, setActiveTab] = useState<'PURCHASES' | 'SUPPLIERS'>('PURCHASES');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageBanner, setPageBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New / Edit Purchase Modal
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayIST());
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<'BANK' | 'CASH' | 'UPI'>('BANK');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [purchaseEditReason, setPurchaseEditReason] = useState('');

  // Purchase Line Items
  const [purchaseItems, setPurchaseItems] = useState<
    { product_id: string; product_name: string; quantity: number; unit_cost: number; total: number }[]
  >([]);

  // Add Item to purchase line
  const [selectedProdId, setSelectedProdId] = useState('');
  const [itemQty, setItemQty] = useState<number>(1);
  const [itemCost, setItemCost] = useState<number>(0);

  // Add New Product Directly from Invoice Modal
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategoryId, setNewProdCategoryId] = useState('');
  const [newProdCode, setNewProdCode] = useState('');
  const [newProdSku, setNewProdSku] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdPurchaseCost, setNewProdPurchaseCost] = useState<number | ''>('');
  const [newProdSellingPrice, setNewProdSellingPrice] = useState<number | ''>('');
  const [newProdMrp, setNewProdMrp] = useState<number | ''>('');
  const [newProdQty, setNewProdQty] = useState<number>(1);
  const [newProdError, setNewProdError] = useState<string | null>(null);
  const [newProdSaving, setNewProdSaving] = useState(false);

  // New Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supGst, setSupGst] = useState('');
  const [supplierFormError, setSupplierFormError] = useState<string | null>(null);

  // Settle Due Modal
  const [showPayDueModal, setShowPayDueModal] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [payDueAmount, setPayDueAmount] = useState<number>(0);
  const [payDueMethod, setPayDueMethod] = useState<'BANK' | 'CASH' | 'UPI'>('BANK');
  const [payDueNotes, setPayDueNotes] = useState('');
  const [payDueError, setPayDueError] = useState<string | null>(null);

  // Reverse Purchase Modal
  const [reverseTarget, setReverseTarget] = useState<Purchase | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);

  // Owner Override Prompt
  const [overridePrompt, setOverridePrompt] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: (ownerPassword: string) => Promise<void>;
  } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pRes, sRes, prodRes, catRes] = await Promise.all([
        api.getPurchases(),
        api.getSuppliers(),
        api.getProducts(),
        api.getCategories().catch(() => ({ categories: [] })),
      ]);
      setPurchases(pRes.purchases || []);
      setSuppliers(sRes.suppliers || []);
      setProducts(prodRes.products || []);
      setCategories(catRes.categories || []);
    } catch (err: any) {
      console.error('Error loading purchases:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProductFromInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) {
      setNewProdError('Product Name is required.');
      return;
    }

    const costNum = Number(newProdPurchaseCost) || 0;
    const sellNum = Number(newProdSellingPrice) || 0;
    const mrpNum = Number(newProdMrp) || sellNum;
    const qtyNum = Math.max(1, Number(newProdQty) || 1);

    if (costNum < 0 || sellNum < 0 || mrpNum < 0) {
      setNewProdError('Prices cannot be negative.');
      return;
    }

    if (sellNum > mrpNum) {
      setNewProdError(`Selling price (₹${sellNum}) cannot exceed MRP (₹${mrpNum}).`);
      return;
    }

    // Uniqueness validation against loaded products
    const trimmedSku = newProdSku.trim().toLowerCase();
    const trimmedCode = newProdCode.trim().toLowerCase();
    const trimmedBarcode = newProdBarcode.trim();

    if (trimmedSku && products.some((p) => p.sku?.toLowerCase() === trimmedSku)) {
      setNewProdError(`SKU '${newProdSku.trim()}' is already in use by an existing product.`);
      return;
    }
    if (trimmedCode && products.some((p) => p.code?.toLowerCase() === trimmedCode)) {
      setNewProdError(`Item code '${newProdCode.trim()}' is already in use by an existing product.`);
      return;
    }
    if (trimmedBarcode && products.some((p) => p.barcode === trimmedBarcode)) {
      setNewProdError(`Barcode '${trimmedBarcode}' is already assigned to an existing product.`);
      return;
    }

    setNewProdSaving(true);
    setNewProdError(null);

    try {
      const res = await api.createProduct({
        name: newProdName.trim(),
        category_id: newProdCategoryId || (categories[0]?.id || null),
        code: trimmedCode || null,
        sku: trimmedSku || null,
        barcode: trimmedBarcode || null,
        purchase_cost: costNum,
        selling_price: sellNum,
        mrp: mrpNum,
        initial_stock: 0, // Stock strictly increases only when invoice is successfully saved!
      });

      // Reload products catalog so the new product is available in the store
      const prodRes = await api.getProducts();
      setProducts(prodRes.products || []);

      // Automatically add new product directly into the current purchase invoice items
      const newCreatedId = res.id;
      const totalCost = qtyNum * costNum;
      setPurchaseItems((prev) => [
        ...prev,
        {
          product_id: newCreatedId,
          product_name: newProdName.trim(),
          quantity: qtyNum,
          unit_cost: costNum,
          total: totalCost,
        },
      ]);

      // Set selector inputs
      setSelectedProdId(newCreatedId);
      setItemQty(qtyNum);
      setItemCost(costNum);

      // Close modal and reset form
      setShowNewProductModal(false);
      setNewProdName('');
      setNewProdCode('');
      setNewProdSku('');
      setNewProdBarcode('');
      setNewProdPurchaseCost('');
      setNewProdSellingPrice('');
      setNewProdMrp('');
      setNewProdQty(1);
    } catch (err: any) {
      setNewProdError(err.message || 'Failed to create product');
    } finally {
      setNewProdSaving(false);
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

  const showSuccess = (text: string) => {
    setPageBanner({ type: 'success', text });
    setTimeout(() => setPageBanner((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const openNewPurchaseModal = () => {
    setEditingPurchaseId(null);
    setSupplierId('');
    setInvoiceNumber('');
    setInvoiceDate(getTodayIST());
    setPaidAmount('');
    setPaymentMethod('BANK');
    setPurchaseNotes('');
    setPurchaseEditReason('');
    setPurchaseItems([]);
    setSelectedProdId('');
    setItemQty(1);
    setItemCost(0);
    setFormError(null);
    setShowPurchaseModal(true);
  };

  const handleOpenEditPurchase = async (purchase: Purchase) => {
    setFormError(null);
    setPageBanner(null);
    try {
      const res = await api.getPurchase(purchase.id);
      const full = res.purchase;
      setEditingPurchaseId(full.id);
      setSupplierId(full.supplier_id);
      setInvoiceNumber(full.invoice_number);
      setInvoiceDate(full.invoice_date || getTodayIST());
      setPaidAmount(full.paid_amount ?? 0);
      setPaymentMethod((full.payment_method as 'BANK' | 'CASH' | 'UPI') || 'BANK');
      setPurchaseNotes(full.notes || '');
      setPurchaseEditReason('');
      setPurchaseItems(
        (full.items || []).map((it: any) => ({
          product_id: it.product_id,
          product_name: it.product_name || 'Item',
          quantity: Number(it.quantity) || 1,
          unit_cost: Number(it.unit_cost) || 0,
          total: Number(it.total_cost) || Number(it.quantity || 1) * Number(it.unit_cost || 0),
        }))
      );
      setShowPurchaseModal(true);
    } catch (err: any) {
      setPageBanner({ type: 'error', text: err.message || 'Failed to load purchase invoice details.' });
    }
  };

  const submitPurchaseForm = async (ownerPassword?: string) => {
    const pAmt = paidAmount === '' ? 0 : Number(paidAmount);
    const payload = {
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
      ...(editingPurchaseId ? { reason: purchaseEditReason.trim() } : {}),
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    };

    if (editingPurchaseId) {
      const res = await api.updatePurchase(editingPurchaseId, payload);
      const closedNote =
        res.modified_closed_dates && res.modified_closed_dates.length > 0
          ? ` Reconciled closed day (${res.modified_closed_dates.join(', ')}).`
          : '';
      showSuccess(`Purchase invoice #${invoiceNumber.trim()} updated.${closedNote}`);
    } else {
      await api.createPurchase(payload);
      showSuccess(`Purchase invoice #${invoiceNumber.trim()} saved and stock updated.`);
    }

    setShowPurchaseModal(false);
    setEditingPurchaseId(null);
    setPurchaseItems([]);
    setInvoiceNumber('');
    setPaidAmount('');
    setPurchaseEditReason('');
    setOverridePrompt(null);
    await loadData();
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !invoiceNumber.trim() || purchaseItems.length === 0) {
      setFormError('Supplier, invoice number, and at least one item are required.');
      return;
    }

    if (editingPurchaseId && !purchaseEditReason.trim()) {
      setFormError('Mandatory audit reason is required when editing a purchase invoice.');
      return;
    }

    const pAmt = paidAmount === '' ? 0 : Number(paidAmount);
    if (pAmt > totalPurchaseBill) {
      setFormError('Paid amount cannot exceed total purchase invoice amount.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitPurchaseForm();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || 'This purchase affects a CLOSED business day. Verify Store Owner password to proceed.',
          confirmLabel: editingPurchaseId ? 'Verify & Update Purchase' : 'Verify & Save Purchase',
          onConfirm: async (pwd) => {
            await submitPurchaseForm(pwd);
          },
        });
      } else {
        setFormError(err.message || 'Failed to save purchase invoice');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) {
      setSupplierFormError('Supplier name is required.');
      return;
    }
    setSupplierFormError(null);
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
      await loadData();
      setSupplierId(res.id);
      showSuccess(`Supplier "${supName.trim()}" added.`);
    } catch (err: any) {
      setSupplierFormError(err.message || 'Failed to save supplier');
    }
  };

  const submitSettleDue = async (ownerPassword?: string) => {
    if (!selectedPurchase) return;
    const res = await api.paySupplierDue(selectedPurchase.id, {
      amount: payDueAmount,
      payment_method: payDueMethod,
      notes: payDueNotes.trim() || null,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });

    setShowPayDueModal(false);
    setSelectedPurchase(null);
    setPayDueAmount(0);
    setOverridePrompt(null);
    const closedNote =
      res.modified_closed_dates && res.modified_closed_dates.length > 0
        ? ` Reconciled closed day (${res.modified_closed_dates.join(', ')}).`
        : '';
    showSuccess(`Recorded supplier payment of ₹${payDueAmount.toLocaleString('en-IN')}.${closedNote}`);
    await loadData();
  };

  const handleSettleDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchase || payDueAmount <= 0) {
      setPayDueError('Enter a valid positive payment amount.');
      return;
    }

    setSubmitting(true);
    setPayDueError(null);
    try {
      await submitSettleDue();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || 'Today is CLOSED. Verify Store Owner password to record this supplier payment.',
          confirmLabel: 'Verify & Record Payment',
          onConfirm: async (pwd) => {
            await submitSettleDue(pwd);
          },
        });
      } else {
        setPayDueError(err.message || 'Failed to record supplier payment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitReversePurchase = async (purchase: Purchase, reasonText: string, ownerPassword?: string) => {
    const res = await api.reversePurchase(purchase.id, {
      reason: reasonText,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });
    setReverseTarget(null);
    setReverseReason('');
    setOverridePrompt(null);
    const closedNote =
      res.modified_closed_dates && res.modified_closed_dates.length > 0
        ? ` Reconciled closed day (${res.modified_closed_dates.join(', ')}).`
        : '';
    showSuccess(`Reversed purchase invoice #${purchase.invoice_number} and restored stock/financial ledgers.${closedNote}`);
    await loadData();
  };

  const handleConfirmReversePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    if (!reverseReason.trim()) {
      setReverseError('Mandatory reason is required to reverse a purchase invoice.');
      return;
    }

    setSubmitting(true);
    setReverseError(null);
    try {
      await submitReversePurchase(reverseTarget, reverseReason.trim());
    } catch (err: any) {
      if (err?.requires_owner_password) {
        const target = reverseTarget;
        const rsn = reverseReason.trim();
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || `Invoice #${target.invoice_number} involves a CLOSED business day. Verify Store Owner password to reverse it.`,
          confirmLabel: 'Verify & Reverse Purchase',
          onConfirm: async (pwd) => {
            await submitReversePurchase(target, rsn, pwd);
          },
        });
      } else {
        setReverseError(err.message || 'Failed to reverse purchase');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverrideConfirm = async (ownerPassword: string) => {
    if (!overridePrompt) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      await overridePrompt.onConfirm(ownerPassword);
    } catch (err: any) {
      setOverrideError(err.message || 'Owner authorization failed');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Purchases &amp; Suppliers</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Stock intake invoices, supplier credit balances &amp; Owner-authorized edits/reversals
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
            onClick={() => {
              setSupplierFormError(null);
              setShowSupplierModal(true);
            }}
            className="px-3.5 py-2 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <Building className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>New Supplier</span>
          </button>

          <button
            onClick={openNewPurchaseModal}
            className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#A67C52]" />
            <span>Record Purchase Bill</span>
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
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{pageBanner.text}</span>
          </div>
          <button onClick={() => setPageBanner(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
                  purchases.map((p) => {
                    const isReversed = Boolean(p.is_reversed);
                    return (
                    <tr key={p.id} className={`transition ${isReversed ? 'bg-[#FAF8F4]/70 opacity-70' : 'hover:bg-[#FAF8F4]'}`}>
                      <td className="px-4 py-3.5">
                        <div className={`font-mono font-bold ${isReversed ? 'line-through text-[#6F6962]' : 'text-[#1C1917]'}`}>
                          {p.invoice_number}
                        </div>
                        <div className="text-[10px] text-[#6F6962]">{p.invoice_date}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[#1C1917]">{p.supplier_name}</div>
                        {p.supplier_phone && (
                          <div className="text-[10px] text-[#6F6962]">{p.supplier_phone}</div>
                        )}
                      </td>
                      <td className={`px-4 py-3.5 text-right font-bold ${isReversed ? 'line-through text-[#9A938B]' : 'text-[#1C1917]'}`}>
                        ₹{p.total_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#3F6B50]">
                        ₹{p.paid_amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#A34F4F]">
                        ₹{p.balance_due.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isReversed ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC]">
                            REVERSED
                          </span>
                        ) : (
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
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        {!isReversed && (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {p.balance_due > 0 && (
                              <button
                                onClick={() => {
                                  setSelectedPurchase(p);
                                  setPayDueAmount(p.balance_due);
                                  setPayDueNotes('');
                                  setPayDueError(null);
                                  setShowPayDueModal(true);
                                }}
                                className="px-3 py-1 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-[11px] font-semibold transition shadow-xs"
                              >
                                Pay Due
                              </button>
                            )}
                            {isOwner && (
                              <>
                                <button
                                  onClick={() => handleOpenEditPurchase(p)}
                                  className="px-2.5 py-1 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-lg text-[11px] font-semibold transition shadow-xs inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3 text-[#A67C52]" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setReverseTarget(p);
                                    setReverseReason('');
                                    setReverseError(null);
                                  }}
                                  className="px-2.5 py-1 bg-white hover:bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC] rounded-lg text-[11px] font-semibold transition shadow-xs inline-flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Reverse</span>
                                </button>
                              </>
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

      {/* New / Edit Purchase Bill Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-2xl w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">
                {editingPurchaseId ? 'Edit Purchase Invoice' : 'Record Purchase Bill'}
              </h3>
              <button
                onClick={() => {
                  setShowPurchaseModal(false);
                  setEditingPurchaseId(null);
                }}
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

            <form onSubmit={handleSavePurchase} className="space-y-4 text-xs">
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
                <div className="flex items-center justify-between">
                  <div className="font-bold text-[#1C1917]">Stock Items on Invoice</div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewProdError(null);
                      setShowNewProductModal(true);
                    }}
                    className="text-[11px] font-semibold text-[#A67C52] hover:text-[#8F6843] bg-white border border-[#D4CDC2] hover:border-[#A67C52] px-2.5 py-1 rounded-lg transition shadow-2xs flex items-center gap-1"
                    title="Quickly add a newly purchased product directly to catalog and this invoice"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#A67C52]" />
                    <span>+ Add New Product</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedProdId}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setNewProdError(null);
                        setShowNewProductModal(true);
                        return;
                      }
                      setSelectedProdId(e.target.value);
                      const prod = products.find((p) => p.id === e.target.value);
                      if (prod && prod.purchase_cost) {
                        setItemCost(prod.purchase_cost);
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">Choose item to add...</option>
                    <option value="__NEW__" className="font-semibold text-[#A67C52] bg-[#FAF8F4]">
                      + Add New Product to Catalog...
                    </option>
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
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white border border-[#E3DED5] rounded-xl text-xs shadow-xs"
                      >
                        <span className="font-semibold text-[#1C1917] flex-1 min-w-[140px]">{item.product_name}</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const q = Math.max(1, Number(e.target.value) || 1);
                              setPurchaseItems((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, quantity: q, total: q * it.unit_cost } : it))
                              );
                            }}
                            aria-label="Quantity"
                            className="w-16 px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-center font-semibold"
                          />
                          <span className="text-[#6F6962]">&times; ₹</span>
                          <input
                            type="number"
                            min="0"
                            value={item.unit_cost}
                            onChange={(e) => {
                              const c = Math.max(0, Number(e.target.value) || 0);
                              setPurchaseItems((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, unit_cost: c, total: it.quantity * c } : it))
                              );
                            }}
                            aria-label="Unit cost"
                            className="w-20 px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-right font-semibold"
                          />
                          <span className="text-[#1C1917] font-bold min-w-[64px] text-right">
                            ₹{item.total.toLocaleString('en-IN')}
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

              {editingPurchaseId && (
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Audit Reason for Invoice Edit *
                  </label>
                  <textarea
                    required
                    rows={2}
                    value={purchaseEditReason}
                    onChange={(e) => setPurchaseEditReason(e.target.value)}
                    placeholder="Reason for modifying this purchase invoice..."
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => {
                    setShowPurchaseModal(false);
                    setEditingPurchaseId(null);
                  }}
                  className="px-4 py-2 border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Saving...' : editingPurchaseId ? 'Save Invoice Changes' : 'Save & Intake Stock'}
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

            {payDueError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {payDueError}
              </div>
            )}

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
            {supplierFormError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {supplierFormError}
              </div>
            )}
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

      {/* Add New Product Directly from Purchase Invoice Modal */}
      {showNewProductModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-lg w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-base text-[#1C1917]">Add New Product to Catalog</h3>
                <p className="text-xs text-[#6F6962]">
                  Creates product in store catalog &amp; automatically adds it to this purchase invoice
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewProductModal(false)}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {newProdError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{newProdError}</span>
              </div>
            )}

            <form onSubmit={handleCreateProductFromInvoice} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Product / Garment Name *
                </label>
                <input
                  type="text"
                  required
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  placeholder="Product / item name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Category *</label>
                  <select
                    value={newProdCategoryId}
                    onChange={(e) => setNewProdCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    {categories.length > 0 ? (
                      categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ) : (
                      <option value="">General Garments</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Item Code / SKU</label>
                  <input
                    type="text"
                    value={newProdSku}
                    onChange={(e) => setNewProdSku(e.target.value)}
                    placeholder="Item code / SKU"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Barcode (Optional)</label>
                  <input
                    type="text"
                    value={newProdBarcode}
                    onChange={(e) => setNewProdBarcode(e.target.value)}
                    placeholder="Barcode number"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Invoice Quantity *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newProdQty}
                    onChange={(e) => setNewProdQty(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold text-center focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-[#FAF8F4] rounded-xl border border-[#E3DED5]">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Purchase Cost (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newProdPurchaseCost}
                    onChange={(e) => setNewProdPurchaseCost(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Cost price"
                    className="w-full px-3 py-1.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] font-bold text-right focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Selling Price (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newProdSellingPrice}
                    onChange={(e) => setNewProdSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Selling price"
                    className="w-full px-3 py-1.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] font-bold text-right focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    MRP (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={newProdMrp}
                    onChange={(e) => setNewProdMrp(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="MRP"
                    className="w-full px-3 py-1.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] font-bold text-right focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="text-[11px] text-[#6F6962] bg-amber-50 border border-amber-200 p-2 rounded-lg">
                <strong>Inventory Note:</strong> Product stock will not increase until this purchase invoice is submitted and saved.
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowNewProductModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newProdSaving}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {newProdSaving ? 'Creating Product...' : 'Create & Add to Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Purchase Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#A34F4F]">Reverse Purchase Invoice</h3>
                <p className="text-[11px] text-[#6F6962]">
                  Inv #{reverseTarget.invoice_number} ({reverseTarget.supplier_name}) &bull; ₹{reverseTarget.total_amount.toLocaleString('en-IN')}
                </p>
              </div>
              <button onClick={() => setReverseTarget(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reverseError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {reverseError}
              </div>
            )}

            <form onSubmit={handleConfirmReversePurchase} className="space-y-3 text-xs">
              <p className="text-[#6F6962]">
                Safely reverses unsold stock batches and supplier payments for this invoice. Blocked automatically if stock units were already sold.
              </p>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mandatory Reversal Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Why is this purchase invoice being reversed?"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setReverseTarget(null)}
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

      {/* Owner Override Verification Prompt */}
      <OwnerOverridePrompt
        isOpen={Boolean(overridePrompt)}
        title={overridePrompt?.title}
        description={overridePrompt?.description || ''}
        requireReason={false}
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
