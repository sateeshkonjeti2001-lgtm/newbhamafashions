import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Search,
  AlertCircle,
  History,
  Layers,
  CheckCircle2,
  RotateCcw,
  X,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { StockLedgerEntry, UserRole } from '../types.ts';
import { formatDateIST, formatDateTimeIST } from '../utils/date.ts';

interface InventoryViewProps {
  role: UserRole;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ role }) => {
  const [activeTab, setActiveTab] = useState<'STOCK' | 'LEDGER' | 'BATCHES'>('STOCK');
  const [stockList, setStockList] = useState<any[]>([]);
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageBanner, setPageBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Stock Adjustment Modal
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [adjType, setAdjType] = useState<'DAMAGE' | 'WRITE_OFF' | 'ADJUSTMENT'>('ADJUSTMENT');
  const [adjQty, setAdjQty] = useState<number>(0);
  const [adjReason, setAdjReason] = useState('');
  const [adjError, setAdjError] = useState<string | null>(null);

  // Reverse Stock Adjustment Modal
  const [reverseEntry, setReverseEntry] = useState<StockLedgerEntry | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const isOwner = role === 'OWNER';

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'STOCK') {
        const res = await api.getStock({ search });
        setStockList(res.stock || []);
      } else if (activeTab === 'LEDGER') {
        const res = await api.getStockLedger({ limit: 100 });
        setLedger(res.ledger || []);
      } else if (activeTab === 'BATCHES' && isOwner) {
        const res = await api.getBatches();
        setBatches(res.batches || []);
      }
    } catch (err: any) {
      console.error('Error loading inventory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, search]);

  const openAdjustmentModal = (item: any) => {
    setSelectedProduct({
      ...item,
      id: item.id || item.product_id,
      name: item.name || item.product_name || 'Item',
      current_stock: item.current_stock ?? 0,
    });
    setAdjType('ADJUSTMENT');
    setAdjQty(0);
    setAdjReason('');
    setAdjError(null);
    setShowAdjModal(true);
  };

  const showSuccess = (text: string) => {
    setPageBanner({ type: 'success', text });
    setTimeout(() => setPageBanner((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    if (!adjQty || isNaN(Number(adjQty))) {
      setAdjError('Please enter a valid non-zero adjustment quantity.');
      return;
    }
    if (!adjReason.trim()) {
      setAdjError('Rule 5: Non-sale stock adjustment requires a documented reason.');
      return;
    }

    setSubmitting(true);
    setAdjError(null);

    try {
      await api.adjustStock({
        product_id: selectedProduct.id,
        quantity: Number(adjQty),
        adjustment_type: adjType,
        reason: adjReason.trim(),
      });

      setShowAdjModal(false);
      showSuccess(`Stock adjusted for "${selectedProduct.name}" (${Number(adjQty) > 0 ? `+${adjQty}` : adjQty} units).`);
      await loadData();
    } catch (err: any) {
      setAdjError(err.message || 'Stock adjustment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReverseAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseEntry) return;
    if (!reverseReason.trim()) {
      setReverseError('Mandatory reason is required to reverse a stock adjustment.');
      return;
    }

    setSubmitting(true);
    setReverseError(null);
    try {
      await api.reverseStockAdjustment(reverseEntry.id, { reason: reverseReason.trim() });
      const prodName = reverseEntry.product_name;
      setReverseEntry(null);
      setReverseReason('');
      showSuccess(`Reversed stock adjustment for "${prodName}".`);
      await loadData();
    } catch (err: any) {
      setReverseError(err.message || 'Failed to reverse stock adjustment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Stock &amp; Inventory Ledger</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Real physical inventory counts, immutable stock audit ledger &amp; FIFO batches
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs shadow-xs">
          <button
            onClick={() => setActiveTab('STOCK')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'STOCK' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
            }`}
          >
            Physical Stock
          </button>
          <button
            onClick={() => setActiveTab('LEDGER')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'LEDGER' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
            }`}
          >
            Stock Audit Ledger
          </button>
          {isOwner && (
            <button
              onClick={() => setActiveTab('BATCHES')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'BATCHES' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              FIFO Batches
            </button>
          )}
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

      {/* Tab: PHYSICAL STOCK */}
      {activeTab === 'STOCK' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search physical stock by product name, barcode, code..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52] focus:ring-1 focus:ring-[#A67C52] shadow-sm"
            />
            <Search className="w-4 h-4 absolute left-3 top-3 text-[#A67C52]" />
          </div>

          <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1C1917]">
                <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                  <tr>
                    <th className="px-4 py-3.5">Product Name</th>
                    <th className="px-4 py-3.5">Category</th>
                    <th className="px-4 py-3.5">Barcode / Code</th>
                    <th className="px-4 py-3.5 text-right">Selling Price</th>
                    {isOwner && <th className="px-4 py-3.5 text-right">Purchase Cost</th>}
                    <th className="px-4 py-3.5 text-center">Physical Stock</th>
                    {isOwner && <th className="px-4 py-3.5 text-right">Stock Adjustment</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3DED5]">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[#9A938B]">
                        Loading physical inventory counts...
                      </td>
                    </tr>
                  ) : stockList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center text-[#6F6962] space-y-2">
                        <Boxes className="w-8 h-8 mx-auto text-[#A67C52] stroke-1" />
                        <p className="font-semibold text-sm text-[#1C1917]">No stock records in database.</p>
                        <p className="text-xs text-[#9A938B]">
                          Stock increases automatically when purchases are recorded, and decreases when bills are printed.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    stockList.map((item, idx) => {
                      const itemKey = item.id || item.product_id || `stock-item-${idx}-${item.code || item.barcode || ''}`;
                      const itemName = item.name || item.product_name || 'Item';
                      return (
                      <tr key={itemKey} className="hover:bg-[#FAF8F4] transition">
                        <td className="px-4 py-3.5 font-semibold text-[#1C1917]">
                          {itemName}
                        </td>
                        <td className="px-4 py-3.5 text-[#6F6962]">
                          {item.category_name || '-'}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-[#6F6962]">
                          {item.barcode || item.code || '-'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-[#1C1917]">
                          ₹{item.selling_price}
                        </td>
                        {isOwner && (
                          <td className="px-4 py-3.5 text-right text-[#A67C52] font-semibold">
                            {item.purchase_cost ? `₹${item.purchase_cost}` : '-'}
                          </td>
                        )}
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                              item.current_stock > 3
                                ? 'bg-white text-[#3F6B50] border-[#E3DED5]'
                                : item.current_stock > 0
                                ? 'bg-white text-[#A67C52] border-[#E3DED5]'
                                : 'bg-white text-[#A34F4F] border-[#F0CCCC]'
                            }`}
                          >
                            {item.current_stock}
                          </span>
                        </td>
                        {isOwner && (
                          <td className="px-4 py-3.5 text-right">
                            <button
                              onClick={() => openAdjustmentModal(item)}
                              className="px-3 py-1.5 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-lg text-[11px] font-semibold transition shadow-xs"
                            >
                              Adjust Stock
                            </button>
                          </td>
                        )}
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

      {/* Tab: AUDIT LEDGER */}
      {activeTab === 'LEDGER' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="p-3.5 bg-[#FAF8F4] border-b border-[#E3DED5] text-xs font-bold text-[#1C1917] flex items-center gap-2">
            <History className="w-4 h-4 text-[#A67C52]" />
            <span>Immutable Stock Movement Ledger</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Timestamp (IST)</th>
                  <th className="px-4 py-3.5">Product Name</th>
                  <th className="px-4 py-3.5">Movement Type</th>
                  <th className="px-4 py-3.5 text-center">Qty Change</th>
                  <th className="px-4 py-3.5">Reference / Bill</th>
                  <th className="px-4 py-3.5">Reason / Notes</th>
                  <th className="px-4 py-3.5">Recorded By</th>
                  {isOwner && <th className="px-4 py-3.5 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loading ? (
                  <tr>
                    <td colSpan={isOwner ? 8 : 7} className="px-4 py-10 text-center text-[#9A938B]">
                      Loading stock audit ledger...
                    </td>
                  </tr>
                ) : ledger.length === 0 ? (
                  <tr>
                    <td colSpan={isOwner ? 8 : 7} className="px-4 py-14 text-center text-[#6F6962] space-y-1">
                      <p className="font-semibold text-sm text-[#1C1917]">No stock movements recorded yet.</p>
                      <p className="text-xs text-[#9A938B]">
                        Every physical sale, purchase, or adjustment will be permanently logged here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  ledger.map((row, idx) => {
                    const rowKey = row.id || `ledger-${idx}-${row.product_id || ''}-${row.created_at || ''}`;
                    const isPositive = row.quantity > 0;
                    const isReversed = Boolean(row.is_reversed);
                    const canReverse = isOwner && Boolean(row.reversible);
                    return (
                      <tr key={rowKey} className={`transition ${isReversed ? 'bg-[#FAF8F4]/70 opacity-75' : 'hover:bg-[#FAF8F4]'}`}>
                        <td className="px-4 py-3.5 text-[#6F6962] text-[11px] whitespace-nowrap">
                          {formatDateTimeIST(row.created_at)}
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-[#1C1917]">
                          {row.product_name}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]">
                              {row.movement_type}
                            </span>
                            {isReversed && (
                              <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC]">
                                Reversed
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`font-bold font-mono ${
                              isReversed
                                ? 'line-through text-[#9A938B]'
                                : isPositive
                                ? 'text-[#3F6B50]'
                                : 'text-[#A34F4F]'
                            }`}
                          >
                            {isPositive ? `+${row.quantity}` : row.quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[#1C1917] text-[11px]">
                          {row.reference_type} {row.reference_id ? `(#${row.reference_id})` : ''}
                        </td>
                        <td className="px-4 py-3.5 text-[#6F6962]">
                          {row.reason || '-'}
                        </td>
                        <td className="px-4 py-3.5 text-[#1C1917]">
                          {row.created_by_name || 'System'}
                        </td>
                        {isOwner && (
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            {canReverse && (
                              <button
                                onClick={() => {
                                  setReverseEntry(row);
                                  setReverseReason('');
                                  setReverseError(null);
                                }}
                                className="px-2.5 py-1 bg-white hover:bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC] rounded-lg text-[10px] font-semibold inline-flex items-center gap-1 transition"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reverse Adjustment</span>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: FIFO BATCHES */}
      {activeTab === 'BATCHES' && isOwner && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="p-3.5 bg-[#FAF8F4] border-b border-[#E3DED5] text-xs font-bold text-[#1C1917] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#A67C52]" />
            <span>FIFO Inventory Batches (First-In First-Out Valuation)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Batch Date</th>
                  <th className="px-4 py-3.5">Product Name</th>
                  <th className="px-4 py-3.5">Purchase Invoice</th>
                  <th className="px-4 py-3.5 text-center">Original Qty</th>
                  <th className="px-4 py-3.5 text-center">Remaining Qty</th>
                  <th className="px-4 py-3.5 text-right">Unit Cost Price</th>
                  <th className="px-4 py-3.5 text-right">Remaining Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#9A938B]">
                      Loading purchase batches...
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-[#6F6962]">
                      No purchase batches created yet. Batches are generated when purchase invoices are entered.
                    </td>
                  </tr>
                ) : (
                  batches.map((b, idx) => {
                    const batchKey = b.id || `batch-row-${idx}-${b.batch_number || b.invoice_number || ''}`;
                    const origQty = b.original_quantity ?? b.initial_qty ?? 0;
                    const remQty = b.remaining_quantity ?? b.remaining_qty ?? 0;
                    const unitCost = Number(b.unit_cost) || 0;
                    return (
                    <tr key={batchKey} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5 text-[#6F6962]">
                        {b.created_at ? formatDateIST(b.created_at) : '-'}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-[#1C1917]">
                        {b.product_name}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[#A67C52] font-semibold">
                        {b.invoice_number || b.batch_number || '-'}
                      </td>
                      <td className="px-4 py-3.5 text-center">{origQty}</td>
                      <td className="px-4 py-3.5 text-center font-bold text-[#A67C52]">
                        {remQty}
                      </td>
                      <td className="px-4 py-3.5 text-right text-[#1C1917]">
                        ₹{unitCost}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-[#1C1917]">
                        ₹{(remQty * unitCost).toLocaleString('en-IN')}
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

      {/* Manual Stock Adjustment Modal */}
      {showAdjModal && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#1C1917]">Adjust Physical Stock</h3>
                <p className="text-xs text-[#6F6962]">{selectedProduct.name}</p>
              </div>
              <button
                onClick={() => setShowAdjModal(false)}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] text-xs text-[#1C1917] flex justify-between font-medium">
              <span>Current Recorded Stock:</span>
              <span className="font-bold text-[#A67C52]">{selectedProduct.current_stock} units</span>
            </div>

            {adjError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{adjError}</span>
              </div>
            )}

            <form onSubmit={handleStockAdjustment} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Adjustment Type
                </label>
                <select
                  value={adjType}
                  onChange={(e: any) => setAdjType(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="DAMAGE">Damage / Defective garment</option>
                  <option value="WRITE_OFF">Write-off / Lost stock</option>
                  <option value="ADJUSTMENT">Physical count audit correction</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Quantity Change (+ to add, - to reduce) *
                </label>
                <input
                  type="number"
                  required
                  value={adjQty || ''}
                  onChange={(e) => setAdjQty(Number(e.target.value))}
                  placeholder="Quantity (+ to add, - to reduce)"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Documented Reason *
                </label>
                <textarea
                  required
                  rows={2}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Documented reason for stock adjustment"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowAdjModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Applying...' : 'Apply Stock Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Stock Adjustment Modal */}
      {reverseEntry && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#A34F4F]">Reverse Stock Adjustment</h3>
                <p className="text-[11px] text-[#6F6962]">
                  {reverseEntry.product_name} &bull; Qty: {reverseEntry.quantity > 0 ? `+${reverseEntry.quantity}` : reverseEntry.quantity}
                </p>
              </div>
              <button onClick={() => setReverseEntry(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reverseError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reverseError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmReverseAdjustment} className="space-y-3 text-xs">
              <p className="text-[#6F6962]">
                Posts an immutable offsetting stock entry and restores FIFO batch quantities cleanly. Blocked automatically if stock would go negative or units were already sold.
              </p>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mandatory Reversal Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Enter reason for reversing this stock adjustment..."
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setReverseEntry(null)}
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
    </div>
  );
};
