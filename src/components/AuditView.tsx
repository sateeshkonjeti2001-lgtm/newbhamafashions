import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Search,
  Filter,
  History,
  AlertCircle,
  User,
  Clock,
  FileCode,
  Store,
  PhoneCall,
  Save,
  CheckCircle2,
  Printer,
  ShieldCheck,
  Building,
  Database,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { AuditLogEntry, User as UserType } from '../types.ts';
import { BackupRestoreView } from './BackupRestoreView.tsx';

export const AuditView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'AUDIT' | 'SETTINGS' | 'BACKUP'>('AUDIT');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Store Settings State
  const [storeName, setStoreName] = useState('New Bhama Fashions');
  const [storeLocation, setStoreLocation] = useState('Chilakaluripet, Andhra Pradesh');
  const [storeTagline, setStoreTagline] = useState('Ladies Fashion Retail');
  const [contactPhone1, setContactPhone1] = useState('');
  const [contactPhone2, setContactPhone2] = useState('');
  const [contactPhone3, setContactPhone3] = useState('');
  const [ownerInfo, setOwnerInfo] = useState<UserType | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [auditRes, storeRes] = await Promise.all([
        api.getAuditLogs({ action: actionFilter || undefined, limit: 100 }),
        api.getStoreProfile().catch(() => null),
      ]);
      setLogs(auditRes.logs || []);
      if (storeRes) {
        setStoreName(storeRes.store_name || 'New Bhama Fashions');
        setStoreLocation(storeRes.store_location || 'Chilakaluripet, Andhra Pradesh');
        setStoreTagline(storeRes.store_tagline || 'Ladies Fashion Retail');
        setContactPhone1(storeRes.contact_phone_1 || '');
        setContactPhone2(storeRes.contact_phone_2 || '');
        setContactPhone3(storeRes.contact_phone_3 || '');
        if (storeRes.owner) {
          setOwnerInfo(storeRes.owner);
        }
      }
    } catch (err: any) {
      console.error('Error loading audit logs & settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [actionFilter]);

  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      await api.updateStoreProfile({
        store_name: storeName.trim(),
        store_location: storeLocation.trim(),
        store_tagline: storeTagline.trim(),
        contact_phone_1: contactPhone1.trim(),
        contact_phone_2: contactPhone2.trim(),
        contact_phone_3: contactPhone3.trim(),
      });
      setSaveSuccess('Store Settings & Official Contact Numbers updated successfully! Changes reflect on all POS receipts & reports.');
      setTimeout(() => setSaveSuccess(null), 5000);
      loadData();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to update store settings');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">
            {activeTab === 'AUDIT'
              ? 'System Security & Audit Logs'
              : activeTab === 'SETTINGS'
              ? 'Store Settings & Official Contacts'
              : 'Database Backup & Restore'}
          </h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            {activeTab === 'AUDIT'
              ? 'Immutable tamper-evident record of all critical store actions, price changes, reversals & adjustments'
              : activeTab === 'SETTINGS'
              ? 'Official shop contact numbers, store identity, and thermal receipt details for New Bhama Fashions'
              : 'Automatic nightly backups at 10:00 PM IST, manual snapshots, integrity verification, and safe disaster recovery'}
          </p>
        </div>

        {/* Tab Switcher & Filter Controls */}
        <div className="flex items-center gap-2.5">
          <div className="flex bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs shadow-xs">
            <button
              onClick={() => setActiveTab('AUDIT')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'AUDIT'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              <History className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>Audit Logs</span>
            </button>
            <button
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'SETTINGS'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              <Store className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>Store Settings</span>
            </button>
            <button
              onClick={() => setActiveTab('BACKUP')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'BACKUP'
                  ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                  : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>Database Backup &amp; Restore</span>
            </button>
          </div>

          {activeTab === 'AUDIT' && (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
            >
              <option value="">All Security Events</option>
              <option value="STOCK_ADJUSTMENT">Stock Adjustments</option>
              <option value="TRANSACTION_CORRECTION">Transaction Corrections (Rule 10)</option>
              <option value="PURCHASE_CREATED">Purchase Bills</option>
              <option value="PURCHASE_PAYMENT">Supplier Payments</option>
              <option value="CUSTOMER_DUE_PAYMENT">Customer Due Settlements</option>
              <option value="DAILY_CLOSING">Daily Closings</option>
            </select>
          )}
        </div>
      </div>

      {/* Tab 1: Audit Logs View */}
      {activeTab === 'AUDIT' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action Type</th>
                  <th className="px-4 py-3">Entity / ID</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">State Change / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[#6F6962]">
                      Loading security audit logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-[#9A938B] space-y-1">
                      <ShieldAlert className="w-8 h-8 mx-auto text-[#9A938B] stroke-1" />
                      <p className="font-semibold text-[#1C1917]">No security audit events logged yet.</p>
                      <p className="text-xs text-[#6F6962]">
                        Actions like stock adjustments, day closings, and financial corrections appear here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    let parsedChanges: any = null;
                    try {
                      parsedChanges = log.changes ? JSON.parse(log.changes) : null;
                    } catch (e) {
                      parsedChanges = log.changes;
                    }

                    return (
                      <tr key={log.id} className="hover:bg-[#FAF8F4]/80 transition">
                        <td className="px-4 py-3 text-[#6F6962] text-[11px] font-mono whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2]">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[#A67C52] font-semibold text-[11px]">
                          {log.entity_type} {log.entity_id ? `(#${log.entity_id})` : ''}
                        </td>
                        <td className="px-4 py-3 text-[#1C1917] font-semibold">
                          {log.user_name || 'System'}
                        </td>
                        <td className="px-4 py-3">
                          {parsedChanges ? (
                            <div className="font-mono text-[11px] text-[#1C1917] bg-[#FAF8F4] p-2.5 rounded-xl border border-[#E3DED5] max-w-xl overflow-x-auto">
                              {typeof parsedChanges === 'object' ? (
                                <pre className="text-[10px] whitespace-pre-wrap text-[#1C1917]">
                                  {JSON.stringify(parsedChanges, null, 2)}
                                </pre>
                              ) : (
                                String(parsedChanges)
                              )}
                            </div>
                          ) : (
                            <span className="text-[#9A938B]">-</span>
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

      {/* Tab 2: Store Settings & Contacts View */}
      {activeTab === 'SETTINGS' && (
        <div className="space-y-6">
          {saveSuccess && (
            <div className="p-4 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-[#3F6B50] text-xs flex items-center gap-2.5 font-medium shadow-xs">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-[#3F6B50]" />
              <span>{saveSuccess}</span>
            </div>
          )}

          {saveError && (
            <div className="p-4 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F] text-xs flex items-center gap-2.5 font-medium shadow-xs">
              <AlertCircle className="w-5 h-5 shrink-0 text-[#A34F4F]" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Store Configuration Form (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
              <div className="flex items-center gap-2 pb-3 border-b border-[#E3DED5]">
                <Building className="w-5 h-5 text-[#A67C52]" />
                <div>
                  <h3 className="font-bold text-sm text-[#1C1917]">Store Identity &amp; Contact Details</h3>
                  <p className="text-[11px] text-[#6F6962]">
                    Official shop numbers printed on receipts and invoices. Independent of owner user accounts.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveStoreSettings} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      Store Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      placeholder="New Bhama Fashions"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">
                      Location / City *
                    </label>
                    <input
                      type="text"
                      required
                      value={storeLocation}
                      onChange={(e) => setStoreLocation(e.target.value)}
                      placeholder="Chilakaluripet, Andhra Pradesh"
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">
                    Store Tagline / Description
                  </label>
                  <input
                    type="text"
                    value={storeTagline}
                    onChange={(e) => setStoreTagline(e.target.value)}
                    placeholder="Ladies Fashion Retail"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                {/* Shop Official Contact Numbers */}
                <div className="pt-3 border-t border-[#E3DED5] space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#6F6962] flex items-center gap-1.5">
                      <PhoneCall className="w-3.5 h-3.5 text-[#A67C52]" />
                      <span>Official Shop Contact Numbers</span>
                    </h4>
                    <span className="text-[10px] text-[#A67C52] font-semibold bg-[#FAF8F4] px-2 py-0.5 rounded-md border border-[#E3DED5]">
                      Thermal Receipt Ready
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 1 (Counter / Billing Primary)</span>
                        <span className="text-[10px] text-[#A67C52] font-semibold">Primary Print</span>
                      </label>
                      <input
                        type="tel"
                        value={contactPhone1}
                        onChange={(e) => setContactPhone1(e.target.value)}
                        placeholder="e.g. 9848012345 (Counter Phone)"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>

                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 2 (Store Owner Mobile)</span>
                        <span className="text-[10px] text-[#A67C52] font-semibold">Store Owner</span>
                      </label>
                      <input
                        type="tel"
                        value={contactPhone2}
                        onChange={(e) => setContactPhone2(e.target.value)}
                        placeholder="e.g. 9440112345 (Owner Mobile)"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>

                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 3 (Shop WhatsApp / Support)</span>
                        <span className="text-[10px] text-[#3F6B50] font-semibold">Shop WhatsApp</span>
                      </label>
                      <input
                        type="tel"
                        value={contactPhone3}
                        onChange={(e) => setContactPhone3(e.target.value)}
                        placeholder="e.g. 9848598765 (WhatsApp Support)"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-5 py-2.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold flex items-center gap-2 transition shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-4 h-4 text-[#A67C52]" />
                    <span>{savingSettings ? 'Saving...' : 'Save Store Details & Contacts'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Right: Thermal Receipt Preview & Master Owner Account (5 cols) */}
            <div className="lg:col-span-5 space-y-5">
              {/* Thermal Receipt Header Preview */}
              <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-3.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
                <div className="flex items-center gap-2 pb-2.5 border-b border-[#E3DED5]">
                  <Printer className="w-4 h-4 text-[#A67C52]" />
                  <div>
                    <h3 className="font-bold text-sm text-[#1C1917]">Thermal Receipt Header Preview</h3>
                    <p className="text-[11px] text-[#6F6962]">How contacts appear on 80mm bills</p>
                  </div>
                </div>

                {/* Thermal Simulation Card */}
                <div className="p-4 bg-[#FAF8F4] border border-dashed border-[#D4CDC2] rounded-xl font-mono text-center space-y-1 text-xs">
                  <p className="text-sm font-bold text-[#1C1917] uppercase tracking-wide">
                    {storeName || 'NEW BHAMA FASHIONS'}
                  </p>
                  <p className="text-[11px] text-[#6F6962]">{storeTagline || 'Ladies Fashion Retail'}</p>
                  <p className="text-[10px] text-[#6F6962]">{storeLocation || 'Chilakaluripet, Andhra Pradesh'}</p>
                  <p className="text-[11px] font-sans font-semibold text-[#1C1917] pt-1 border-t border-dashed border-[#D4CDC2]">
                    Ph: {[contactPhone1, contactPhone2, contactPhone3].filter(Boolean).join(' • ') || '98480xxxxx'}
                  </p>
                  <p className="text-[9px] text-[#9A938B] pt-1">
                    GST / Offline Thermal Print Format &bull; 80mm Roll
                  </p>
                </div>

                <p className="text-[11px] text-[#6F6962] leading-relaxed">
                  The official store contact numbers are printed directly from store settings, ensuring they remain consistent across all cashiers and POS terminals.
                </p>
              </div>

              {/* Master Administrator Account Status */}
              <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-3.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
                <div className="flex items-center justify-between border-b border-[#E3DED5] pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[#171513] text-[#F5F2EC] flex items-center justify-center font-bold text-xs">
                      <ShieldCheck className="w-4 h-4 text-[#A67C52]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1C1917]">Store Administrator</h3>
                      <p className="text-[11px] text-[#6F6962]">Single Master Account</p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#EBF7EE] text-[#1E6B37] border border-[#BDE5C8]">
                    Active Owner
                  </span>
                </div>

                {ownerInfo ? (
                  <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#6F6962]">Owner Name:</span>
                      <span className="font-bold text-[#1C1917]">{ownerInfo.full_name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6F6962]">Username:</span>
                      <span className="font-mono font-medium text-[#1C1917]">{ownerInfo.username}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6F6962]">Role:</span>
                      <span className="font-semibold text-[#A67C52]">{ownerInfo.role}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#6F6962]">Phone:</span>
                      <span className="text-[#1C1917]">{ownerInfo.phone || 'Not set'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#6F6962] bg-[#FAF8F4] p-3 rounded-xl border border-[#E3DED5]">
                    Single Administrator account configured for New Bhama Fashions.
                  </div>
                )}

                <div className="text-[11px] text-[#6F6962] space-y-1">
                  <p className="font-medium text-[#1C1917]">&bull; One Login Account Security:</p>
                  <p>
                    Authentication is strictly limited to 1 Master Store Owner administrator account plus optional counter cashiers.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Database Backup & Restore View */}
      {activeTab === 'BACKUP' && (
        <BackupRestoreView onDatabaseRestored={() => loadData()} />
      )}
    </div>
  );
};
