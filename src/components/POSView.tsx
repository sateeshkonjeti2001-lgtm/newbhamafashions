import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Barcode,
  Plus,
  Minus,
  Trash2,
  Receipt,
  ShoppingCart,
  ArrowRight,
  User as UserIcon,
  CreditCard,
  Banknote,
  Smartphone,
  AlertCircle,
  X,
  Tag,
  ShieldCheck,
  Percent,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { CartItem, Product, User } from '../types.ts';
import { ReceiptModal } from './ReceiptModal.tsx';

interface POSViewProps {
  role?: string;
  currentUser?: User | null;
  onNavigateToBills?: () => void;
}

export const POSView: React.FC<POSViewProps> = ({ role, currentUser, onNavigateToBills }) => {
  const [userRole, setUserRole] = useState<string>(role || currentUser?.role || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<{ id?: string; name: string; phone?: string }>({
    name: 'Walk-in Customer',
    phone: '',
  });
  const [isCreditMode, setIsCreditMode] = useState(false);
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);

  // Manual Special Discount (Fixed ₹ amount entered by Owner only, hidden until opened)
  const [showSpecialDiscountInput, setShowSpecialDiscountInput] = useState<boolean>(false);
  const [specialDiscountAmount, setSpecialDiscountAmount] = useState<number>(0);

  // General Discount (if needed)
  const [discountType, setDiscountType] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [discountValue, setDiscountValue] = useState<number>(0);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'SPLIT' | 'CREDIT'>('CASH');
  const [cashPaid, setCashPaid] = useState<number>(0);
  const [upiPaid, setUpiPaid] = useState<number>(0);
  const [amountReceived, setAmountReceived] = useState<number>(0); // for quick change calculation in CASH mode
  const [mobileTab, setMobileTab] = useState<'CATALOG' | 'CART'>('CATALOG');

  // Completed sale for receipt
  const [completedSale, setCompletedSale] = useState<any | null>(null);
  const [storeInfo, setStoreInfo] = useState<{
    storeName: string;
    storeLocation: string;
    contacts: string[];
  }>({
    storeName: 'New Bhama Fashions',
    storeLocation: 'Chilakaluripet, Andhra Pradesh',
    contacts: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const cartListRef = useRef<HTMLDivElement>(null);
  const prevCartLengthRef = useRef<number>(0);

  // Keep recently added item visible inside the cart list without forcing page scrolling
  useEffect(() => {
    if (cart.length > prevCartLengthRef.current) {
      if (cartListRef.current) {
        cartListRef.current.scrollTo({
          top: cartListRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }
    prevCartLengthRef.current = cart.length;
  }, [cart.length]);

  useEffect(() => {
    api.getStoreProfile().then((res) => {
      if (res) {
        setStoreInfo({
          storeName: res.store_name || 'New Bhama Fashions',
          storeLocation: res.store_location || 'Chilakaluripet, Andhra Pradesh',
          contacts: [res.contact_phone_1, res.contact_phone_2, res.contact_phone_3].filter(Boolean),
        });
      }
    }).catch(() => {});
  }, []);

  // Search items as user types, or load quick catalog on mount/clear
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await api.posSearch(searchQuery.trim());
        setSearchResults(res.products || []);
      } catch (err: any) {
        console.error('Search error:', err);
      }
    }, searchQuery.trim() ? 200 : 0);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load known customers for credit or assignment
  useEffect(() => {
    api.getCustomers().then((res) => setAllCustomers(res.customers || [])).catch(() => {});
  }, []);

  // Fetch current user role if not passed
  useEffect(() => {
    if (!userRole) {
      api.getMe().then((res) => {
        if (res.user?.role) setUserRole(res.user.role);
      }).catch(() => {});
    }
  }, [userRole]);

  // Handle Barcode Scan (Enter key pressed in scan box)
  const handleBarcodeScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = searchQuery.trim();
      if (!code) return;

      setError(null);
      try {
        const item = await api.posScan(code);
        if (item) {
          addToCart(item);
          setSearchQuery('');
        }
      } catch (err: any) {
        setError(err.message || `No product found for barcode "${code}"`);
      }
    }
  };

  const addToCart = (product: any, variant?: any) => {
    setError(null);
    const existingIndex = cart.findIndex((item) => {
      if (variant && item.variant_id) {
        return item.variant_id === variant.id;
      }
      return item.product.id === product.id && !item.variant_id;
    });

    const currentPhysicalStock = variant ? (variant.stock ?? product.current_stock) : product.current_stock;
    const currentQtyInCart = existingIndex >= 0 ? cart[existingIndex].quantity : 0;

    if (currentQtyInCart + 1 > currentPhysicalStock) {
      setError(`Cannot add item: "${product.name}" only has ${currentPhysicalStock} in stock!`);
      return;
    }

    const unitPrice = Number(variant?.selling_price || product.selling_price) || 0;
    const mrp = Number(variant?.mrp || product.mrp) || unitPrice;
    const festDiscount = Number(variant?.festival_discount ?? product.festival_discount) || 0;

    if (existingIndex >= 0) {
      const updated = [...cart];
      const item = updated[existingIndex];
      item.quantity += 1;
      const festTotal = (item.festival_discount || 0) * item.quantity;
      const specTotal = (item.special_discount || 0) * item.quantity;
      item.total_price = Math.max(0, (item.quantity * item.unit_price) - festTotal - specTotal);
      setCart(updated);
    } else {
      const newItem: CartItem = {
        product,
        variant,
        variant_id: variant?.id,
        product_name: product.name,
        variant_desc: variant ? `${variant.size || ''} ${variant.color || ''}`.trim() : undefined,
        quantity: 1,
        mrp,
        unit_price: unitPrice,
        festival_discount: festDiscount,
        special_discount: 0,
        discount: festDiscount,
        total_price: Math.max(0, unitPrice - festDiscount),
      };
      setCart([...cart, newItem]);
    }
  };

  const updateQuantity = (index: number, delta: number) => {
    setError(null);
    const updated = [...cart];
    const item = updated[index];
    const newQty = item.quantity + delta;

    if (newQty <= 0) {
      removeItem(index);
      return;
    }

    const availableStock = item.variant ? (item.variant.stock ?? item.product.current_stock) : item.product.current_stock;
    if (newQty > availableStock) {
      setError(`Only ${availableStock} units of "${item.product_name}" are available in stock.`);
      return;
    }

    item.quantity = newQty;
    const festTotal = (item.festival_discount || 0) * item.quantity;
    const specTotal = (item.special_discount || 0) * item.quantity;
    item.total_price = Math.max(0, (item.quantity * item.unit_price) - festTotal - specTotal);
    setCart(updated);
  };

  const updateItemSpecialDiscount = (index: number, disc: number) => {
    const updated = [...cart];
    const item = updated[index];
    const val = Math.max(0, disc);
    // Cannot exceed unit price minus festival discount
    const maxAllowed = Math.max(0, item.unit_price - (item.festival_discount || 0));
    item.special_discount = Math.min(maxAllowed, val);
    const festTotal = (item.festival_discount || 0) * item.quantity;
    const specTotal = item.special_discount * item.quantity;
    item.total_price = Math.max(0, (item.quantity * item.unit_price) - festTotal - specTotal);
    setCart(updated);
  };

  const removeItem = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  // Authoritative Pricing & Discount Calculations
  const isOwner = userRole === 'OWNER';

  const totalMrp = cart.reduce((sum, item) => sum + (item.mrp * item.quantity), 0);
  const sellingSubtotal = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
  const totalFestivalDiscount = cart.reduce((sum, item) => sum + ((item.festival_discount || 0) * item.quantity), 0);
  const totalItemSpecialDiscount = cart.reduce((sum, item) => sum + ((item.special_discount || 0) * item.quantity), 0);

  // Bill-level manual special discount (strictly fixed ₹, non-negative, entered by Owner)
  const billSpecialDiscount = Math.max(0, specialDiscountAmount || 0);
  const totalSpecialDiscount = totalItemSpecialDiscount + billSpecialDiscount;

  // Optional legacy discount fallback if used without special discount
  let legacyDiscount = 0;
  if (discountValue > 0 && totalSpecialDiscount === 0 && totalFestivalDiscount === 0) {
    if (discountType === 'PERCENT') {
      legacyDiscount = Math.round((sellingSubtotal * Math.min(100, Math.max(0, discountValue))) / 100);
    } else {
      legacyDiscount = Math.min(sellingSubtotal, Math.max(0, discountValue));
    }
  }

  const effectiveTotalDiscount = totalFestivalDiscount + totalSpecialDiscount + legacyDiscount;
  const grandTotal = Math.max(0, Math.round(sellingSubtotal - effectiveTotalDiscount));
  const totalSavings = Math.max(0, totalMrp - grandTotal);

  // Sync payment amounts when total changes
  useEffect(() => {
    if (paymentMethod === 'CASH') {
      setCashPaid(grandTotal);
      setUpiPaid(0);
      setAmountReceived(grandTotal);
    } else if (paymentMethod === 'UPI') {
      setUpiPaid(grandTotal);
      setCashPaid(0);
      setAmountReceived(0);
    } else if (paymentMethod === 'CREDIT') {
      setCashPaid(0);
      setUpiPaid(0);
    } else if (paymentMethod === 'SPLIT') {
      // Default half-half split on first switch if both are zero
      if (cashPaid === 0 && upiPaid === 0 && grandTotal > 0) {
        const half = Math.floor(grandTotal / 2);
        setCashPaid(half);
        setUpiPaid(grandTotal - half);
      }
    }
  }, [grandTotal, paymentMethod]);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setError('Cart is empty. Please add items to bill.');
      return;
    }
    if (loading) return;

    setError(null);
    setLoading(true);

    try {
      let cPaid = 0;
      let uPaid = 0;

      if (paymentMethod === 'CASH') {
        cPaid = grandTotal;
        uPaid = 0;
      } else if (paymentMethod === 'UPI') {
        uPaid = grandTotal;
        cPaid = 0;
      } else if (paymentMethod === 'SPLIT') {
        cPaid = Math.max(0, Number(cashPaid) || 0);
        uPaid = Math.max(0, Number(upiPaid) || 0);
        const totalPaid = cPaid + uPaid;
        const due = Math.max(0, grandTotal - totalPaid);
        if (due > 0 && (!selectedCustomer.id && (!selectedCustomer.name || selectedCustomer.name.trim() === 'Walk-in Customer'))) {
          setError(`Split payment has an unpaid due of ₹${due}. Please select or add a named customer to record outstanding dues.`);
          setLoading(false);
          return;
        }
      } else if (paymentMethod === 'CREDIT') {
        cPaid = Math.max(0, Number(cashPaid) || 0);
        uPaid = Math.max(0, Number(upiPaid) || 0);
        if (!selectedCustomer.id && (!selectedCustomer.name || selectedCustomer.name.trim() === 'Walk-in Customer')) {
          setError('Customer name or profile is required to issue goods on credit / due.');
          setLoading(false);
          return;
        }
      }

      const clientKey = 'pos_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const payload = {
        idempotency_key: clientKey,
        customer_id: selectedCustomer.id || null,
        customer_name: selectedCustomer.name,
        customer_phone: selectedCustomer.phone || null,
        items: cart.map((c) => ({
          product_id: c.product.id,
          variant_id: c.variant_id || null,
          product_name: c.product_name,
          variant_desc: c.variant_desc || null,
          quantity: c.quantity,
          mrp: c.mrp,
          unit_price: c.unit_price,
          festival_discount: c.festival_discount || 0,
          special_discount: c.special_discount || 0,
          discount: ((c.festival_discount || 0) + (c.special_discount || 0)) * c.quantity,
          total_price: c.total_price,
        })),
        total_mrp: totalMrp,
        subtotal: sellingSubtotal,
        festival_discount: totalFestivalDiscount,
        special_discount: totalSpecialDiscount,
        discount_amount: effectiveTotalDiscount,
        discount_type: 'AMOUNT',
        total_amount: grandTotal,
        total_savings: totalSavings,
        payment_method: paymentMethod,
        cash_paid: cPaid,
        upi_paid: uPaid,
        channel: 'OFFLINE_STORE',
      };

      const res = await api.posCheckout(payload);

      // Successfully checked out! Reset cart and open receipt
      setCompletedSale({
        ...res.sale,
        total_mrp: totalMrp,
        subtotal: sellingSubtotal,
        festival_discount: totalFestivalDiscount,
        special_discount: totalSpecialDiscount,
        total_amount: grandTotal,
        total_savings: totalSavings,
        items: cart,
      });

      setCart([]);
      setSpecialDiscountAmount(0);
      setShowSpecialDiscountInput(false);
      setDiscountValue(0);
      setSelectedCustomer({ name: 'Walk-in Customer', phone: '' });
      setIsCreditMode(false);
      setPaymentMethod('CASH');
    } catch (err: any) {
      // Preserve cart on failure so cashier can retry safely
      setError(err.message || 'Checkout failed to save bill. Please check values and retry.');
    } finally {
      setLoading(false);
    }
  };

  const changeDue = Math.max(0, amountReceived - grandTotal);
  const totalCartItems = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="flex-1 min-h-0 w-full h-full flex flex-col lg:flex-row gap-2.5 sm:gap-3.5">
      {/* Mobile / Tablet View Switcher (< lg) */}
      <div className="lg:hidden flex items-center bg-white border border-[#E3DED5] rounded-xl p-1 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('CATALOG')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 min-h-[40px] cursor-pointer ${
            mobileTab === 'CATALOG'
              ? 'bg-[#1C1917] text-white shadow-xs'
              : 'text-[#6F6962] hover:text-[#1C1917]'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Product Catalog</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('CART')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 min-h-[40px] cursor-pointer ${
            mobileTab === 'CART'
              ? 'bg-[#1C1917] text-white shadow-xs'
              : 'text-[#6F6962] hover:text-[#1C1917]'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5 text-[#A67C52]" />
          <span>Cart ({totalCartItems})</span>
          {totalCartItems > 0 && (
            <span className="font-mono text-emerald-400 font-bold ml-1">₹{grandTotal}</span>
          )}
        </button>
      </div>

      {/* Left Column: Product Search & Quick Catalog */}
      <div className={`flex-1 min-h-0 h-full flex flex-col bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)] ${
        mobileTab === 'CART' ? 'hidden lg:flex' : 'flex'
      }`}>
        {/* Top Scan / Search Bar */}
        <div className="p-3 sm:p-3.5 bg-[#FAF8F4] border-b border-[#E3DED5] space-y-1.5 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={barcodeInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeScan}
                autoFocus
                placeholder="Scan Barcode / Enter Item Code or Product Name (Press Enter to add)..."
                className="w-full pl-9 pr-8 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 placeholder:text-[#9A938B] font-mono shadow-2xs transition"
              />
              <Barcode className="w-4 h-4 absolute left-3 top-2.5 text-[#A67C52]" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2 text-[#9A938B] hover:text-[#1C1917]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {onNavigateToBills && (
              <button
                type="button"
                onClick={onNavigateToBills}
                className="px-3 py-2 bg-white border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow-2xs transition"
                title="View bill history, print past receipts, process returns or voids"
              >
                <Receipt className="w-3.5 h-3.5 text-[#A67C52]" />
                <span className="hidden sm:inline">Bills &amp; Returns</span>
              </button>
            )}
          </div>
          <div className="text-[11px] text-[#6F6962] flex items-center justify-between px-1">
            <span>Laser scanner ready: aim barcode and press trigger</span>
            <span className="text-[#A67C52] font-semibold">Auto-focus active</span>
          </div>
        </div>

        {/* Search Results / Item List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-3.5 space-y-2.5">
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-stretch">
              {searchResults.map((p) => {
                const hasVariants = p.variants && p.variants.length > 0;
                const isOutOfStock = p.current_stock <= 0;
                const isLowStock = p.current_stock > 0 && p.current_stock <= 2;

                return (
                  <div
                    key={p.id}
                    className="p-3 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl flex flex-col justify-between hover:border-[#A67C52] hover:bg-white transition shadow-2xs h-full"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 pr-1">
                          <h4
                            className="font-semibold text-xs text-[#1C1917] leading-snug line-clamp-2 min-h-[2.5em] break-words"
                            title={p.name}
                          >
                            {p.name}
                          </h4>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold border shrink-0 ${
                            p.current_stock > 3
                              ? 'bg-[#EBF5EE] border-[#C6E7D0] text-[#276738]'
                              : p.current_stock > 0
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : 'bg-[#FDF5F5] border-[#F0CCCC] text-[#A34F4F]'
                          }`}
                        >
                          {p.current_stock > 0 ? `Stock: ${p.current_stock}` : 'Out of Stock'}
                        </span>
                      </div>

                      <div className="text-[11px] text-[#6F6962] mt-1.5 flex flex-wrap items-center gap-1.5">
                        {p.code && (
                          <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#E3DED5] text-[10px] shrink-0">
                            {p.code}
                          </span>
                        )}
                        {p.barcode && p.barcode !== p.code && (
                          <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#E3DED5] text-[10px] text-[#A67C52] shrink-0" title="Barcode">
                            🏷 {p.barcode}
                          </span>
                        )}
                        {p.category_name && (
                          <span className="text-[10px] text-[#6F6962] truncate max-w-[110px]" title={p.category_name}>
                            &bull; {p.category_name}
                          </span>
                        )}
                      </div>

                      {/* Explicit Stock Status - Stable row height prevents layout jumps */}
                      <div className="min-h-[20px] flex items-center mt-1">
                        {isOutOfStock ? (
                          <div className="text-[10px] text-[#A34F4F] font-semibold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>Out of stock &mdash; Cannot add</span>
                          </div>
                        ) : isLowStock ? (
                          <div className="text-[10px] text-[#A67C52] font-semibold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>Low stock: only {p.current_stock} item{p.current_stock > 1 ? 's' : ''} left</span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-[#3F6B50] font-medium">
                            In stock ({p.current_stock} available)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pricing and Action */}
                    <div className="mt-2.5 pt-2 border-t border-[#E3DED5] flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-[#1C1917]">₹{p.selling_price}</span>
                          {p.mrp > p.selling_price && (
                            <span className="text-[10px] text-[#9A938B] line-through font-mono">
                              MRP ₹{p.mrp}
                            </span>
                          )}
                        </div>
                        {p.festival_discount > 0 && (
                          <div className="text-[9px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-semibold inline-block mt-0.5">
                            Fest Offer: -₹{p.festival_discount}
                          </div>
                        )}
                      </div>

                      {hasVariants ? (
                        <div className="flex flex-wrap gap-1 justify-end max-w-full">
                          {p.variants?.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => addToCart(p, v)}
                              disabled={isOutOfStock}
                              className="px-2 py-1 bg-[#171513] hover:bg-[#25211D] disabled:opacity-40 disabled:cursor-not-allowed text-[#F5F2EC] text-[10px] font-semibold rounded-lg shadow-2xs transition shrink-0"
                            >
                              + {v.size || ''} {v.color || ''} (₹{v.selling_price})
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(p)}
                          disabled={isOutOfStock}
                          className="px-3 py-1.5 bg-[#171513] hover:bg-[#25211D] disabled:opacity-40 disabled:cursor-not-allowed text-[#F5F2EC] text-xs font-semibold rounded-lg flex items-center gap-1 shadow-2xs transition shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5 text-[#A67C52]" /> Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#9A938B] space-y-3">
              <div className="p-3 bg-[#FAF8F4] border border-[#E3DED5] rounded-2xl">
                <Search className="w-8 h-8 stroke-1 text-[#A67C52]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1C1917]">Scan Barcode or Search Products</p>
                <p className="text-xs text-[#6F6962] max-w-sm mt-1">
                  Type any garment code, SKU, barcode, or product name above to quickly add items to the current customer's bill.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Sticky Quick Jump to Cart */}
        {cart.length > 0 && (
          <div className="lg:hidden p-3 bg-[#FAF8F4] border-t border-[#E3DED5] flex items-center justify-between shrink-0">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#9A938B] block">Current Bill</span>
              <span className="text-xs font-bold font-mono text-[#1C1917]">
                {totalCartItems} item{totalCartItems === 1 ? '' : 's'} &bull; ₹{grandTotal}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileTab('CART')}
              className="px-4 py-2 bg-[#A67C52] hover:bg-[#8F6843] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition min-h-[40px] cursor-pointer"
            >
              <span>View Cart &amp; Checkout</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Right Column: Active Bill Cart & Checkout */}
      <div className={`w-full lg:w-[390px] xl:w-[420px] bg-white border border-[#E3DED5] rounded-2xl flex flex-col overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)] shrink-0 min-h-0 h-full ${
        mobileTab === 'CATALOG' ? 'hidden lg:flex' : 'flex'
      }`}>
        {/* Cart Header */}
        <div className="p-3 sm:p-3.5 bg-[#FAF8F4] border-b border-[#E3DED5] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#A67C52]" />
            <h3 className="font-bold text-xs text-[#1C1917]">Current Bill ({cart.reduce((s, i) => s + i.quantity, 0)} Items)</h3>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Cancel current uncompleted bill? The current cart will be cleared with no stock or financial changes.')) {
                  setCart([]);
                  setSpecialDiscountAmount(0);
                  setShowSpecialDiscountInput(false);
                  setDiscountValue(0);
                  setSelectedCustomer({ name: 'Walk-in Customer', phone: '' });
                  setError(null);
                }
              }}
              className="text-[11px] font-semibold text-[#A34F4F] hover:bg-[#FDF5F5] px-2 py-1 rounded-lg border border-transparent hover:border-[#F0CCCC] transition flex items-center gap-1 shrink-0"
              title="Cancel uncompleted bill (no stock deduction or payment occurs)"
            >
              <Trash2 className="w-3 h-3" />
              <span>Cancel Bill</span>
            </button>
          )}
        </div>

        {/* Customer Assignment */}
        <div className="px-3.5 py-2 bg-white border-b border-[#E3DED5] flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <div className="p-1 rounded-md bg-[#FAF8F4] border border-[#E3DED5] text-[#A67C52] shrink-0">
              <UserIcon className="w-3.5 h-3.5" />
            </div>
            <div className="truncate">
              <span className="font-semibold text-[#1C1917]">{selectedCustomer.name}</span>
              {selectedCustomer.phone && (
                <span className="text-[10px] text-[#6F6962] ml-1">({selectedCustomer.phone})</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCustomerModal(true)}
            className="text-[11px] text-[#A67C52] hover:text-[#8F6843] font-semibold underline shrink-0 ml-2"
          >
            Change
          </button>
        </div>

        {error && (
          <div className="m-2 p-2 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-[11px] text-[#A34F4F] flex items-center gap-1.5 shrink-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="break-words flex-1">{error}</span>
          </div>
        )}

        {/* Cart Items List - Independently Scrollable */}
        <div ref={cartListRef} className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#9A938B] py-8 text-center px-4">
              Bill cart is empty. Scan an item barcode or click '+ Add' from the catalog.
            </div>
          ) : (
            cart.map((item, idx) => (
              <div
                key={`${item.product.id}-${item.variant_id || 'base'}-${idx}`}
                className="p-2.5 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl flex flex-col gap-1.5 text-xs shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[#1C1917] break-words leading-tight">{item.product_name}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {item.variant_desc && (
                        <span className="text-[10px] text-[#A67C52] bg-white border border-[#E3DED5] px-1.5 py-0.5 rounded font-medium">
                          {item.variant_desc}
                        </span>
                      )}
                      {item.mrp > item.unit_price && (
                        <span className="text-[10px] text-[#9A938B] line-through font-mono">
                          MRP ₹{item.mrp}
                        </span>
                      )}
                      {item.festival_discount && item.festival_discount > 0 ? (
                        <span className="text-[9px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-semibold">
                          Fest Offer -₹{item.festival_discount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-[#9A938B] hover:text-[#A34F4F] p-1 rounded-md hover:bg-white border border-transparent hover:border-[#E3DED5] transition shrink-0"
                    title="Remove item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[#E3DED5]/60">
                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-1 bg-white border border-[#D4CDC2] rounded-lg px-1 py-0.5 shadow-2xs shrink-0">
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, -1)}
                      className="p-0.5 text-[#6F6962] hover:text-[#1C1917]"
                      title="Decrease quantity"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-bold text-[#1C1917] px-1.5 text-xs min-w-[20px] text-center">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, 1)}
                      className="p-0.5 text-[#6F6962] hover:text-[#1C1917]"
                      title="Increase quantity"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Unit price & total */}
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-[#6F6962]">@ ₹{item.unit_price}</span>
                    <span className="font-bold text-[#1C1917] ml-2 text-xs">₹{item.total_price}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bill Summary & Price Breakdown - Pinned and accessible */}
        <div className="p-3 bg-[#FAF8F4] border-t border-[#E3DED5] space-y-2 text-xs shrink-0">
          <div className="space-y-1">
            {totalMrp > sellingSubtotal && (
              <div className="flex justify-between text-[#9A938B] text-[11px]">
                <span>Total MRP:</span>
                <span className="line-through font-mono">₹{totalMrp}</span>
              </div>
            )}

            <div className="flex justify-between text-[#6F6962]">
              <span>Selling Subtotal:</span>
              <span className="text-[#1C1917] font-semibold">₹{sellingSubtotal}</span>
            </div>

            {/* Festival Offer (Only visible if active) */}
            {totalFestivalDiscount > 0 && (
              <div className="flex justify-between items-center text-amber-800 bg-amber-50/80 border border-amber-200/70 px-2 py-0.5 rounded-lg font-medium text-[11px]">
                <span className="flex items-center gap-1">
                  <Tag className="w-3 h-3 text-amber-700" />
                  Festival Offer:
                </span>
                <span className="font-bold">-₹{totalFestivalDiscount}</span>
              </div>
            )}

            {/* Special Discount Applied Line (Hidden if 0) */}
            {totalSpecialDiscount > 0 && (
              <div className="flex justify-between items-center text-[#276738] bg-[#EBF5EE] border border-[#C6E7D0] px-2 py-0.5 rounded-lg font-medium text-[11px]">
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#276738]" />
                  <span>Special Discount:</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">-₹{totalSpecialDiscount}</span>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setSpecialDiscountAmount(0);
                        setShowSpecialDiscountInput(false);
                      }}
                      className="text-[#A34F4F] hover:text-[#7A3636] text-[10px] underline ml-1"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Owner Special Discount Trigger (Hidden when unused unless Owner opens it) */}
            {isOwner && !showSpecialDiscountInput && specialDiscountAmount === 0 && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowSpecialDiscountInput(true)}
                  className="w-full py-1 px-2 bg-white hover:bg-[#FAF8F4] text-[#A67C52] border border-dashed border-[#A67C52]/50 hover:border-[#A67C52] rounded-lg font-semibold text-[11px] transition flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <Tag className="w-3 h-3" />
                  <span>+ Add Special Discount (Owner)</span>
                </button>
              </div>
            )}

            {/* Owner Special Discount Input Box */}
            {isOwner && showSpecialDiscountInput && (
              <div className="p-2 bg-white border border-[#A67C52] rounded-xl space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1 text-[#A67C52] font-bold">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Owner Special Discount</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSpecialDiscountAmount(0);
                      setShowSpecialDiscountInput(false);
                    }}
                    className="text-[#9A938B] hover:text-[#1C1917] p-0.5"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-[#1C1917] shrink-0">Fixed ₹:</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1 text-xs text-[#6F6962] font-mono">₹</span>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, sellingSubtotal - totalFestivalDiscount)}
                      value={specialDiscountAmount || ''}
                      onChange={(e) => {
                        const maxAllowed = Math.max(0, sellingSubtotal - totalFestivalDiscount);
                        const num = Number(e.target.value);
                        if (num < 0) {
                          setSpecialDiscountAmount(0);
                        } else if (num > maxAllowed) {
                          setSpecialDiscountAmount(maxAllowed);
                        } else {
                          setSpecialDiscountAmount(num);
                        }
                      }}
                      placeholder="Amount"
                      className="w-full pl-5 pr-2 py-0.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-md text-xs font-bold text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSpecialDiscountInput(false)}
                    className="px-2 py-0.5 bg-[#171513] text-[#F5F2EC] rounded-md text-[11px] font-semibold hover:bg-[#25211D] shrink-0"
                  >
                    Apply
                  </button>
                </div>
                <div className="text-[10px] text-[#6F6962] flex justify-between">
                  <span>Audited internally</span>
                  <span>Max: ₹{Math.max(0, sellingSubtotal - totalFestivalDiscount)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Final Payable */}
          <div className="flex justify-between items-center pt-1.5 border-t border-[#E3DED5] text-[#1C1917]">
            <span className="text-xs font-bold">Final Payable:</span>
            <span className="text-lg sm:text-xl text-[#171513] font-extrabold tracking-tight">₹{grandTotal}</span>
          </div>

          {/* Total Savings Badge */}
          {totalSavings > 0 && (
            <div className="flex justify-between items-center bg-[#EBF5EE] border border-[#C6E7D0] px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-bold text-[#276738]">
              <span>Customer Savings:</span>
              <span>₹{totalSavings}</span>
            </div>
          )}

          {/* Payment Method Selector */}
          <div>
            <div className="text-[10px] font-bold text-[#6F6962] uppercase tracking-wider mb-1">
              Payment Method
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`py-1.5 px-1 rounded-lg text-center font-semibold text-[10px] sm:text-[11px] transition flex flex-col items-center gap-0.5 border ${
                  paymentMethod === 'CASH'
                    ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-2xs'
                    : 'bg-white text-[#1C1917] border-[#D4CDC2] hover:bg-[#FAF8F4]'
                }`}
              >
                <Banknote className="w-3.5 h-3.5 text-[#A67C52]" />
                <span>Cash</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('UPI')}
                className={`py-1.5 px-1 rounded-lg text-center font-semibold text-[10px] sm:text-[11px] transition flex flex-col items-center gap-0.5 border ${
                  paymentMethod === 'UPI'
                    ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-2xs'
                    : 'bg-white text-[#1C1917] border-[#D4CDC2] hover:bg-[#FAF8F4]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 text-[#A67C52]" />
                <span>UPI QR</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('SPLIT')}
                className={`py-1.5 px-1 rounded-lg text-center font-semibold text-[10px] sm:text-[11px] transition flex flex-col items-center gap-0.5 border ${
                  paymentMethod === 'SPLIT'
                    ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-2xs'
                    : 'bg-white text-[#1C1917] border-[#D4CDC2] hover:bg-[#FAF8F4]'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 text-[#A67C52]" />
                <span>Split</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CREDIT')}
                className={`py-1.5 px-1 rounded-lg text-center font-semibold text-[10px] sm:text-[11px] transition flex flex-col items-center gap-0.5 border ${
                  paymentMethod === 'CREDIT'
                    ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-2xs'
                    : 'bg-white text-[#1C1917] border-[#D4CDC2] hover:bg-[#FAF8F4]'
                }`}
              >
                <UserIcon className="w-3.5 h-3.5 text-[#A67C52]" />
                <span>Due</span>
              </button>
            </div>
          </div>

          {/* Cash Change Calculator */}
          {paymentMethod === 'CASH' && (
            <div className="bg-white p-2 rounded-xl border border-[#D4CDC2] space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[#6F6962] font-medium">Cash Given:</span>
                <input
                  type="number"
                  min="0"
                  value={amountReceived || ''}
                  onChange={(e) => setAmountReceived(Number(e.target.value) || 0)}
                  className="w-20 px-2 py-0.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded text-right text-xs text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-[#E3DED5] font-medium">
                <span className="text-[#6F6962]">Change Return:</span>
                <span className="text-[#A67C52] font-bold">₹{changeDue}</span>
              </div>
            </div>
          )}

          {/* Split Mode Breakdown */}
          {paymentMethod === 'SPLIT' && (() => {
            const cVal = Number(cashPaid) || 0;
            const uVal = Number(upiPaid) || 0;
            const totalEntered = cVal + uVal;
            const remainingDue = Math.max(0, grandTotal - totalEntered);
            const extraChange = Math.max(0, totalEntered - grandTotal);

            return (
              <div className="bg-white p-2.5 rounded-xl border border-[#D4CDC2] space-y-2 text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#6F6962] font-semibold block mb-0.5">Cash (₹):</label>
                    <input
                      type="number"
                      min="0"
                      value={cashPaid || ''}
                      onChange={(e) => setCashPaid(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-full px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded text-xs text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                  <div>
                    <label className="text-[#6F6962] font-semibold block mb-0.5">UPI (₹):</label>
                    <input
                      type="number"
                      min="0"
                      value={upiPaid || ''}
                      onChange={(e) => setUpiPaid(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-full px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded text-xs text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[#E3DED5] text-[11px]">
                  <span className="text-[#6F6962]">Total Received:</span>
                  <span className="font-bold text-[#1C1917]">₹{totalEntered}</span>
                </div>

                {remainingDue > 0 && (
                  <div className="flex items-center justify-between text-amber-900 bg-amber-50 border border-amber-200 p-1.5 rounded-lg text-[10px]">
                    <span className="font-semibold">Remaining Due: ₹{remainingDue}</span>
                    <button
                      type="button"
                      onClick={() => setUpiPaid(Math.max(0, grandTotal - cVal))}
                      className="text-[#A67C52] hover:underline font-bold text-[10px]"
                    >
                      Fill via UPI
                    </button>
                  </div>
                )}

                {extraChange > 0 && (
                  <div className="flex items-center justify-between text-[#276738] bg-[#EBF5EE] border border-[#C6E7D0] p-1.5 rounded-lg text-[10px] font-bold">
                    <span>Cash Change Return:</span>
                    <span>₹{extraChange}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Credit / Due Mode Breakdown */}
          {paymentMethod === 'CREDIT' && (() => {
            const advCash = Number(cashPaid) || 0;
            const advUpi = Number(upiPaid) || 0;
            const totalAdv = advCash + advUpi;
            const netDue = Math.max(0, grandTotal - totalAdv);

            return (
              <div className="bg-white p-2.5 rounded-xl border border-[#D4CDC2] space-y-2 text-[11px]">
                <div className="text-[10px] text-[#A67C52] font-semibold flex items-center justify-between">
                  <span>Customer Credit (Due Sale)</span>
                  <span>Bill: ₹{grandTotal}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#6F6962] text-[10px] font-semibold block mb-0.5">Advance Cash (₹):</label>
                    <input
                      type="number"
                      min="0"
                      value={cashPaid || ''}
                      onChange={(e) => setCashPaid(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-full px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded text-xs text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                  <div>
                    <label className="text-[#6F6962] text-[10px] font-semibold block mb-0.5">Advance UPI (₹):</label>
                    <input
                      type="number"
                      min="0"
                      value={upiPaid || ''}
                      onChange={(e) => setUpiPaid(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-full px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded text-xs text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[#E3DED5] text-[11px]">
                  <span className="text-[#6F6962]">Advance Paid:</span>
                  <span className="font-bold text-[#1C1917]">₹{totalAdv}</span>
                </div>

                <div className="flex items-center justify-between bg-rose-50 border border-rose-200 text-rose-800 p-1.5 rounded-lg text-[10px] font-bold">
                  <span>Outstanding Due Added:</span>
                  <span>₹{netDue}</span>
                </div>
              </div>
            );
          })()}

          {/* Checkout Button */}
          <button
            type="button"
            onClick={handleCheckout}
            disabled={loading || cart.length === 0}
            className="w-full py-2.5 sm:py-3 bg-[#171513] hover:bg-[#25211D] disabled:opacity-50 text-[#F5F2EC] font-bold rounded-xl shadow-xs text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing Bill...
              </span>
            ) : (
              `Complete Bill & Print (₹${grandTotal})`
            )}
          </button>
        </div>
      </div>

      {/* Customer Selector Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-sm text-[#1C1917]">Select / Add Customer</h3>
              <button onClick={() => setShowCustomerModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">Customer Name</label>
                <input
                  type="text"
                  value={selectedCustomer.name}
                  onChange={(e) => setSelectedCustomer({ ...selectedCustomer, name: e.target.value })}
                  placeholder="Customer Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  value={selectedCustomer.phone}
                  onChange={(e) => setSelectedCustomer({ ...selectedCustomer, phone: e.target.value })}
                  placeholder="Phone Number"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              {allCustomers.length > 0 && (
                <div className="pt-2 border-t border-[#E3DED5] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#6F6962]">Or pick registered customer:</span>
                  </div>
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or phone..."
                    className="w-full px-2.5 py-1.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] placeholder:text-[#9A938B]"
                  />
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {allCustomers
                      .filter((c) =>
                        !customerSearch.trim() ||
                        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
                        (c.phone && c.phone.includes(customerSearch))
                      )
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer({ id: c.id, name: c.name, phone: c.phone || '' });
                            setShowCustomerModal(false);
                          }}
                          className="w-full text-left p-2 hover:bg-[#FAF8F4] rounded-lg text-xs flex justify-between items-center border border-transparent hover:border-[#E3DED5] transition"
                        >
                          <div>
                            <span className="font-semibold text-[#1C1917] block">{c.name}</span>
                            <span className="text-[10px] text-[#6F6962]">{c.phone || 'No phone'}</span>
                          </div>
                          {c.total_dues > 0 && (
                            <span className="text-rose-700 font-bold text-[10px] bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                              Due: ₹{c.total_dues}
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="w-full py-2.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Confirm Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thermal Receipt Print Modal */}
      {completedSale && (
        <ReceiptModal
          sale={completedSale}
          onClose={() => setCompletedSale(null)}
          storeName={storeInfo.storeName}
          storeLocation={storeInfo.storeLocation}
          contacts={storeInfo.contacts}
        />
      )}
    </div>
  );
};
