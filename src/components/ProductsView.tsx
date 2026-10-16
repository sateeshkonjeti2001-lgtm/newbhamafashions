import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Tag,
  Filter,
  Layers,
  Edit2,
  AlertCircle,
  CheckCircle2,
  X,
  Boxes,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { Product, Category, Brand, UserRole } from '../types.ts';

interface ProductsViewProps {
  role: UserRole;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ role }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Add/Edit Product Modal
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [code, setCode] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [mrp, setMrp] = useState<number | ''>('');
  const [sellingPrice, setSellingPrice] = useState<number | ''>('');
  const [purchaseCost, setPurchaseCost] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [fabric, setFabric] = useState('');
  const [pattern, setPattern] = useState('');
  const [occasion, setOccasion] = useState('');

  // Quick Category/Brand creation modals
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const isOwner = role === 'OWNER';

  const loadData = async () => {
    setLoading(true);
    try {
      const [pRes, cRes, bRes] = await Promise.all([
        api.getProducts({ search, category_id: selectedCategory }),
        api.getCategories(),
        api.getBrands(),
      ]);
      setProducts(pRes.products || []);
      setCategories(cRes.categories || []);
      setBrands(bRes.brands || []);
    } catch (err: any) {
      console.error('Error loading catalog data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, selectedCategory]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setCategoryId('');
    setBrandId('');
    setCode('');
    setSku('');
    setBarcode('');
    setMrp('');
    setSellingPrice('');
    setPurchaseCost('');
    setDescription('');
    setFabric('');
    setPattern('');
    setOccasion('');
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setCategoryId(p.category_id || '');
    setBrandId(p.brand_id || '');
    setCode(p.code || '');
    setSku(p.sku || '');
    setBarcode(p.barcode || '');
    setMrp(p.mrp);
    setSellingPrice(p.selling_price);
    setPurchaseCost(p.purchase_cost ?? '');
    setDescription(p.description || '');
    setFabric(p.category_attributes?.fabric || '');
    setPattern(p.category_attributes?.pattern || '');
    setOccasion(p.category_attributes?.occasion || '');
    setFormError(null);
    setShowModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || mrp === '' || sellingPrice === '') {
      setFormError('Product Name, MRP, and Selling Price are required.');
      return;
    }

    const numMrp = Number(mrp);
    const numSellingPrice = Number(sellingPrice);

    if (isNaN(numMrp) || numMrp < 0) {
      setFormError('MRP must be a valid number greater than or equal to 0.');
      return;
    }

    if (isNaN(numSellingPrice) || numSellingPrice < 0) {
      setFormError('Selling Price must be a valid number greater than or equal to 0.');
      return;
    }

    if (numSellingPrice > numMrp) {
      setFormError(`Selling Price (₹${numSellingPrice}) cannot exceed MRP (₹${numMrp}).`);
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    const payload = {
      name: name.trim(),
      category_id: categoryId || null,
      brand_id: brandId || null,
      code: code.trim() || null,
      sku: sku.trim() || null,
      barcode: barcode.trim() || null,
      mrp: numMrp,
      selling_price: numSellingPrice,
      purchase_cost: isOwner && purchaseCost !== '' ? Number(purchaseCost) : 0,
      description: description.trim() || null,
      category_attributes: {
        fabric: fabric.trim() || undefined,
        pattern: pattern.trim() || undefined,
        occasion: occasion.trim() || undefined,
      },
      idempotency_key: 'idem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
    };

    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, payload);
      } else {
        await api.createProduct(payload);
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save product');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      const res = await api.createCategory({ name: newCatName.trim() });
      setNewCatName('');
      setShowCatModal(false);
      const cRes = await api.getCategories();
      setCategories(cRes.categories || []);
      setCategoryId(res.id);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    try {
      const res = await api.createBrand({ name: newBrandName.trim() });
      setNewBrandName('');
      setShowBrandModal(false);
      const bRes = await api.getBrands();
      setBrands(bRes.brands || []);
      setBrandId(res.id);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Products &amp; Catalog</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Manage garment inventory items, variants, retail prices &amp; barcodes for New Bhama Fashions
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowCatModal(true)}
            className="px-3.5 py-2 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
          >
            <Tag className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>New Category</span>
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <Plus className="w-4 h-4 text-[#A67C52]" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name, barcode, SKU, or item code..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] placeholder:text-[#9A938B] focus:outline-none focus:border-[#A67C52] focus:ring-1 focus:ring-[#A67C52] shadow-sm"
          />
          <Search className="w-4 h-4 absolute left-3 top-3 text-[#A67C52]" />
        </div>

        <div className="sm:w-60">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2.5 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52] focus:ring-1 focus:ring-[#A67C52] shadow-sm"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1C1917]">
            <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
              <tr>
                <th className="px-4 py-3.5">Item Details</th>
                <th className="px-4 py-3.5">Category / Brand</th>
                <th className="px-4 py-3.5">Identifiers (Barcode/SKU)</th>
                <th className="px-4 py-3.5 text-right">Selling Price</th>
                <th className="px-4 py-3.5 text-right">MRP</th>
                {isOwner && <th className="px-4 py-3.5 text-right">Cost Price</th>}
                <th className="px-4 py-3.5 text-center">Physical Stock</th>
                <th className="px-4 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DED5]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#9A938B]">
                    Loading catalog records...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-[#6F6962] space-y-2">
                    <Boxes className="w-8 h-8 mx-auto text-[#A67C52] stroke-1" />
                    <p className="font-semibold text-sm text-[#1C1917]">No products found in the catalog.</p>
                    <p className="text-xs text-[#9A938B]">
                      Click "+ Add Product" above to record your first physical shop item.
                    </p>
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-[#FAF8F4] transition">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-[#1C1917]">{p.name}</div>
                      {p.category_attributes && (
                        <div className="text-[10px] text-[#6F6962] flex gap-1 mt-0.5">
                          {p.category_attributes.fabric && <span>{p.category_attributes.fabric}</span>}
                          {p.category_attributes.occasion && <span>&bull; {p.category_attributes.occasion}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-[#1C1917] font-medium">{p.category_name || '-'}</div>
                      <div className="text-[10px] text-[#6F6962]">{p.brand_name || '-'}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px]">
                      {p.barcode ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[#A67C52] font-semibold bg-[#FAF8F4] px-1.5 py-0.5 rounded border border-[#E3DED5]">{p.barcode}</span>
                        </div>
                      ) : p.code ? (
                        <span className="text-[#6F6962]">{p.code}</span>
                      ) : (
                        <span className="text-[#9A938B]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-[#1C1917]">
                      ₹{p.selling_price}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[#6F6962]">
                      ₹{p.mrp}
                    </td>
                    {isOwner && (
                      <td className="px-4 py-3.5 text-right text-[#A67C52] font-semibold">
                        {p.purchase_cost ? `₹${p.purchase_cost}` : '-'}
                      </td>
                    )}
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                          p.current_stock > 3
                            ? 'bg-white text-[#3F6B50] border-[#E3DED5]'
                            : p.current_stock > 0
                            ? 'bg-white text-[#A67C52] border-[#E3DED5]'
                            : 'bg-white text-[#A34F4F] border-[#F0CCCC]'
                        }`}
                      >
                        {p.current_stock}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => openEditModal(p)}
                        className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-white rounded-lg border border-transparent hover:border-[#D4CDC2] transition shadow-xs"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-xl w-full space-y-4 my-8 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
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

            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Product / Item Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-1 focus:ring-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[#1C1917]">Category</label>
                    <button
                      type="button"
                      onClick={() => setShowCatModal(true)}
                      className="text-[10px] text-[#A67C52] font-semibold hover:underline"
                    >
                      + New
                    </button>
                  </div>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">Select Category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[#1C1917]">Brand / Maker</label>
                    <button
                      type="button"
                      onClick={() => setShowBrandModal(true)}
                      className="text-[10px] text-[#A67C52] font-semibold hover:underline"
                    >
                      + New
                    </button>
                  </div>
                  <select
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">Select Brand...</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Barcode, SKU, Item Code */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                    Barcode (Laser Scan)
                  </label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Barcode"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                    Item Code / Short Code
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Item Code"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                    SKU
                  </label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="SKU"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              {/* Pricing Section */}
              <div className="p-3.5 bg-[#FAF8F4] rounded-xl border border-[#E3DED5] space-y-3">
                <div className="text-xs font-bold text-[#1C1917]">Price Configuration</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                      Selling Price (₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(Number(e.target.value))}
                      placeholder="Retail price"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs font-bold focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                      MRP (₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={mrp}
                      onChange={(e) => setMrp(Number(e.target.value))}
                      placeholder="Maximum retail price"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>

                  {isOwner && (
                    <div>
                      <label className="block text-xs font-semibold text-[#A67C52] mb-1">
                        Purchase Cost (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={purchaseCost}
                        onChange={(e) => setPurchaseCost(Number(e.target.value))}
                        placeholder="Owner cost"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#A67C52] text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Ladies Fashion Specific Attributes */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#6F6962] mb-1">Fabric</label>
                  <input
                    type="text"
                    value={fabric}
                    onChange={(e) => setFabric(e.target.value)}
                    placeholder="Fabric"
                    className="w-full px-2.5 py-2 bg-white border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#6F6962] mb-1">Pattern</label>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="Pattern"
                    className="w-full px-2.5 py-2 bg-white border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#6F6962] mb-1">Occasion</label>
                  <input
                    type="text"
                    value={occasion}
                    onChange={(e) => setOccasion(e.target.value)}
                    placeholder="Occasion"
                    className="w-full px-2.5 py-2 bg-white border border-[#D4CDC2] rounded-lg text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] hover:bg-[#FAF8F4] text-[#1C1917] rounded-xl text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {formSubmitting ? 'Saving...' : editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Category Modal */}
      {showCatModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 max-w-xs w-full space-y-3 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <h4 className="font-bold text-sm text-[#1C1917]">Create Category</h4>
            <form onSubmit={handleCreateCategory} className="space-y-3">
              <input
                type="text"
                required
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category Name"
                className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCatModal(false)}
                  className="px-3 py-1.5 border border-[#D4CDC2] text-[#6F6962] rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-xs font-semibold shadow-sm"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Brand Modal */}
      {showBrandModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 max-w-xs w-full space-y-3 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <h4 className="font-bold text-sm text-[#1C1917]">Create Brand</h4>
            <form onSubmit={handleCreateBrand} className="space-y-3">
              <input
                type="text"
                required
                autoFocus
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="Brand Name"
                className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBrandModal(false)}
                  className="px-3 py-1.5 border border-[#D4CDC2] text-[#6F6962] rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-lg text-xs font-semibold shadow-sm"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
