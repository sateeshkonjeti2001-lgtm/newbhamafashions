import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Calendar,
  Cloud,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  LogOut,
  CalendarPlus,
  ArrowUpRight,
  ShieldCheck,
  Clock,
  Sparkles,
  Layers,
  Database,
  Building,
} from 'lucide-react';
import {
  signInWithGoogle,
  signOutGoogle,
  getCachedAccessToken,
  initFirebaseAuth,
  testFirestoreConnection,
  fetchSyncLogsFromFirestore,
  GoogleSyncLogItem,
} from '../services/firebase.ts';
import {
  exportDayBookToGoogleSheets,
  exportInventoryToGoogleSheets,
  exportCustomerDuesToGoogleSheets,
  SheetExportResult,
} from '../services/googleSheets.ts';
import {
  scheduleDailyClosingCalendarReminder,
  createGoogleCalendarEvent,
  getUpcomingCalendarEvents,
  CalendarEventItem,
} from '../services/googleCalendar.ts';
import { api } from '../services/api.ts';

export const GoogleWorkspaceView: React.FC = () => {
  const [googleUser, setGoogleUser] = useState<any | null>(null);
  const [token, setToken] = useState<string | null>(getCachedAccessToken());
  const [activeTab, setActiveTab] = useState<'sheets' | 'calendar' | 'firebase'>('sheets');
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Firestore status
  const [firestoreStatus, setFirestoreStatus] = useState<{ ok: boolean; message: string }>({
    ok: true,
    message: 'Initializing...',
  });
  const [syncLogs, setSyncLogs] = useState<GoogleSyncLogItem[]>([]);

  // Sheets state
  const [createdSheets, setCreatedSheets] = useState<SheetExportResult[]>([]);
  const [exportingType, setExportingType] = useState<string | null>(null);

  // Calendar state
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [showEventModal, setShowEventModal] = useState<boolean>(false);
  const [customEvent, setCustomEvent] = useState({
    title: 'Festival Sale & Special Discount Launch',
    date: new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime: '11:00',
    description: 'New Bhama Fashions festival collection launch and customer promotions.',
  });

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = initFirebaseAuth(
      (user, cachedToken) => {
        setGoogleUser(user);
        if (cachedToken) setToken(cachedToken);
      },
      () => {
        setGoogleUser(null);
        setToken(null);
      }
    );

    // Verify Firestore connection on mount
    testFirestoreConnection().then((res) => {
      setFirestoreStatus(res);
      loadSyncLogs();
    });

    return () => unsubscribe();
  }, []);

  // Fetch upcoming events when token becomes available
  useEffect(() => {
    if (token) {
      loadUpcomingEvents(token);
    }
  }, [token]);

  const loadSyncLogs = async () => {
    const logs = await fetchSyncLogsFromFirestore(15);
    setSyncLogs(logs);
  };

  const loadUpcomingEvents = async (t: string) => {
    setLoadingEvents(true);
    try {
      const events = await getUpcomingCalendarEvents(t, 8);
      setUpcomingEvents(events);
    } catch (err) {
      console.warn('Error loading calendar events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleSignIn = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await signInWithGoogle();
      if (res) {
        setGoogleUser(res.user);
        setToken(res.accessToken);
        setStatusMessage({
          type: 'success',
          text: `Signed in as ${res.user.email}. Google Sheets and Calendar are ready!`,
        });
        loadUpcomingEvents(res.accessToken);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Google sign-in was canceled or failed.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGoogle();
    setGoogleUser(null);
    setToken(null);
    setUpcomingEvents([]);
    setStatusMessage({ type: 'success', text: 'Disconnected from Google Account.' });
  };

  // Google Sheets Export Actions
  const handleExportDayBook = async () => {
    if (!token || !googleUser) {
      setStatusMessage({ type: 'error', text: 'Please sign in with Google first.' });
      return;
    }

    setExportingType('daybook');
    setStatusMessage(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const summary = await api.getDayClosingSummary(today);
      const billsRes = await api.getBills({ limit: 150 });
      const transRes = await api.getTransactions();

      const result = await exportDayBookToGoogleSheets(
        token,
        googleUser.email || 'user@example.com',
        summary,
        billsRes.bills || [],
        transRes.transactions || []
      );

      setCreatedSheets((prev) => [result, ...prev]);
      setStatusMessage({
        type: 'success',
        text: `Day Book & Sales exported to Google Sheet successfully!`,
      });
      loadSyncLogs();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to export Day Book to Google Sheets.',
      });
    } finally {
      setExportingType(null);
    }
  };

  const handleExportInventory = async () => {
    if (!token || !googleUser) {
      setStatusMessage({ type: 'error', text: 'Please sign in with Google first.' });
      return;
    }

    setExportingType('inventory');
    setStatusMessage(null);
    try {
      const productsRes = await api.getProducts();
      const products = productsRes.products || [];

      const result = await exportInventoryToGoogleSheets(
        token,
        googleUser.email || 'user@example.com',
        products
      );

      setCreatedSheets((prev) => [result, ...prev]);
      setStatusMessage({
        type: 'success',
        text: `Catalog inventory (${products.length} items) exported to Google Sheet!`,
      });
      loadSyncLogs();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to export inventory to Google Sheets.',
      });
    } finally {
      setExportingType(null);
    }
  };

  const handleExportCustomerDues = async () => {
    if (!token || !googleUser) {
      setStatusMessage({ type: 'error', text: 'Please sign in with Google first.' });
      return;
    }

    setExportingType('dues');
    setStatusMessage(null);
    try {
      const customersRes = await api.getCustomers();
      const customers = customersRes.customers || [];

      const result = await exportCustomerDuesToGoogleSheets(
        token,
        googleUser.email || 'user@example.com',
        customers
      );

      setCreatedSheets((prev) => [result, ...prev]);
      setStatusMessage({
        type: 'success',
        text: `Customer dues & credit ledger exported to Google Sheet!`,
      });
      loadSyncLogs();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to export customer dues.',
      });
    } finally {
      setExportingType(null);
    }
  };

  // Google Calendar Actions
  const handleScheduleDailyClosing = async () => {
    if (!token || !googleUser) {
      setStatusMessage({ type: 'error', text: 'Please sign in with Google first.' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    try {
      const event = await scheduleDailyClosingCalendarReminder(
        token,
        googleUser.email || 'user@example.com'
      );
      setStatusMessage({
        type: 'success',
        text: 'Scheduled Daily Closing & Day Book reminder in Google Calendar for 10:00 PM IST!',
      });
      loadUpcomingEvents(token);
      loadSyncLogs();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to schedule calendar reminder.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCustomEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !googleUser) {
      setStatusMessage({ type: 'error', text: 'Please sign in with Google first.' });
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    try {
      const startIso = `${customEvent.date}T${customEvent.startTime}:00+05:30`;
      const endIso = `${customEvent.date}T${customEvent.endTime}:00+05:30`;

      await createGoogleCalendarEvent(token, googleUser.email || 'user@example.com', {
        summary: `🏬 ${customEvent.title}`,
        description: customEvent.description,
        startDateTime: startIso,
        endDateTime: endIso,
        location: 'New Bhama Fashions, Chilakaluripet, AP',
      });

      setShowEventModal(false);
      setStatusMessage({
        type: 'success',
        text: `Scheduled "${customEvent.title}" on Google Calendar!`,
      });
      loadUpcomingEvents(token);
      loadSyncLogs();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Failed to create calendar event.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">
              Google Workspace &amp; Firebase Hub
            </h2>
            <span className="text-[11px] font-semibold bg-[#FAF8F4] text-[#8C6D53] border border-[#E3DED5] px-2 py-0.5 rounded-md flex items-center gap-1">
              <Cloud className="w-3 h-3 text-[#8C6D53]" />
              Cloud Sync Active
            </span>
          </div>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Synchronize New Bhama Fashions ERP with Google Sheets, Google Calendar, and Firebase Cloud storage.
          </p>
        </div>

        {/* Firestore Status Pill */}
        <div className="flex items-center gap-2 text-xs bg-white border border-[#E3DED5] px-3 py-1.5 rounded-lg shadow-sm">
          <div className={`w-2 h-2 rounded-full ${firestoreStatus.ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-[#6F6962] font-medium">Firestore DB:</span>
          <span className="font-semibold text-[#1C1917]">{firestoreStatus.ok ? 'Connected' : 'Offline'}</span>
        </div>
      </div>

      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs shadow-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-stone-400 hover:text-stone-600 text-sm font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Google Authentication Box */}
      <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#1C1917]">Google Account Integration</h3>
                {googleUser ? (
                  <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    Authorized
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6F6962] mt-0.5">
                {googleUser
                  ? `Connected as ${googleUser.email} with permissions for Google Sheets & Google Calendar.`
                  : 'Connect your Google account with permission to export spreadsheets and schedule calendar events.'}
              </p>
            </div>
          </div>

          <div>
            {googleUser ? (
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E3DED5] rounded-lg text-xs font-semibold text-[#6F6962] hover:text-[#A34F4F] hover:bg-stone-50 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-stone-50 text-stone-800 font-semibold text-xs border border-stone-300 rounded-lg shadow-sm hover:shadow transition disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>{loading ? 'Connecting...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-[#E3DED5] gap-2">
        <button
          onClick={() => setActiveTab('sheets')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-[2px] ${
            activeTab === 'sheets'
              ? 'border-[#8C6D53] text-[#8C6D53]'
              : 'border-transparent text-[#6F6962] hover:text-[#1C1917]'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Google Sheets Hub
        </button>

        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-[2px] ${
            activeTab === 'calendar'
              ? 'border-[#8C6D53] text-[#8C6D53]'
              : 'border-transparent text-[#6F6962] hover:text-[#1C1917]'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Google Calendar Hub
        </button>

        <button
          onClick={() => setActiveTab('firebase')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-[2px] ${
            activeTab === 'firebase'
              ? 'border-[#8C6D53] text-[#8C6D53]'
              : 'border-transparent text-[#6F6962] hover:text-[#1C1917]'
          }`}
        >
          <Cloud className="w-4 h-4" />
          Firebase Sync &amp; Audit Logs
        </button>
      </div>

      {/* TAB 1: GOOGLE SHEETS */}
      {activeTab === 'sheets' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Action 1: Day Book */}
            <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#1C1917]">Day Book &amp; Sales Bills</h4>
                  <p className="text-xs text-[#6F6962] mt-1">
                    Export daily sales summary, payment modes (Cash, UPI, Card, Dues), drawer reconciliation, and all bills for today.
                  </p>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={handleExportDayBook}
                  disabled={exportingType === 'daybook' || !token}
                  className="w-full flex items-center justify-center gap-2 bg-[#8C6D53] hover:bg-[#735841] text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {exportingType === 'daybook' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Creating Spreadsheet...
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Export Day Book to Sheets
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Action 2: Inventory */}
            <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#1C1917]">Inventory &amp; Stock Valuation</h4>
                  <p className="text-xs text-[#6F6962] mt-1">
                    Export complete garment catalog with quantities, cost vs retail prices, inventory valuation, and low stock warnings.
                  </p>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={handleExportInventory}
                  disabled={exportingType === 'inventory' || !token}
                  className="w-full flex items-center justify-center gap-2 bg-[#8C6D53] hover:bg-[#735841] text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {exportingType === 'inventory' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Exporting Inventory...
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Export Stock to Sheets
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Action 3: Customer Dues */}
            <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#1C1917]">Customer Credit &amp; Dues</h4>
                  <p className="text-xs text-[#6F6962] mt-1">
                    Export all customer contact numbers, credit limits, outstanding balances, and repayment records for collection follow-ups.
                  </p>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={handleExportCustomerDues}
                  disabled={exportingType === 'dues' || !token}
                  className="w-full flex items-center justify-center gap-2 bg-[#8C6D53] hover:bg-[#735841] text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {exportingType === 'dues' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Exporting Ledger...
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Export Dues to Sheets
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Recently Exported Spreadsheets */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm">
            <h4 className="text-sm font-bold text-[#1C1917] mb-3 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#8C6D53]" />
              Active Google Spreadsheets in Your Drive
            </h4>

            {createdSheets.length === 0 ? (
              <div className="p-8 text-center bg-[#FAF8F4] rounded-lg border border-dashed border-[#E3DED5]">
                <FileSpreadsheet className="w-8 h-8 text-[#9A938B] mx-auto mb-2" />
                <p className="text-xs text-[#6F6962]">
                  No spreadsheets generated in this session yet. Click any of the export buttons above to create live Google Sheets!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {createdSheets.map((sheet, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg border border-[#E3DED5] bg-[#FAF8F4] hover:bg-stone-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-100 text-emerald-800 rounded-md">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[#1C1917]">{sheet.title}</div>
                        <div className="text-[10px] text-[#6F6962]">
                          Created {new Date(sheet.createdAt).toLocaleTimeString('en-IN')} &bull; ID: {sheet.spreadsheetId}
                        </div>
                      </div>
                    </div>
                    <a
                      href={sheet.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E3DED5] hover:border-[#8C6D53] text-[#8C6D53] rounded-md text-xs font-semibold shadow-xs transition"
                    >
                      <span>Open in Sheets</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: GOOGLE CALENDAR */}
      {activeTab === 'calendar' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Quick Action 1: Daily Closing at 10:00 PM */}
            <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-lg bg-amber-50 text-amber-700">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-[#1C1917]">Store Daily Closing Reminder</h4>
                </div>
                <p className="text-xs text-[#6F6962] leading-relaxed">
                  Schedules an automatic Google Calendar event for <strong>10:00 PM IST (Asia/Kolkata)</strong> with popup and email reminders to perform physical cash verification, reconcile Day Book, and verify offline database backups.
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={handleScheduleDailyClosing}
                  disabled={loading || !token}
                  className="w-full flex items-center justify-center gap-2 bg-[#8C6D53] hover:bg-[#735841] text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Schedule Daily Closing at 10:00 PM
                </button>
              </div>
            </div>

            {/* Quick Action 2: Custom Store Event */}
            <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-[#1C1917]">Festival Sale &amp; Store Milestones</h4>
                </div>
                <p className="text-xs text-[#6F6962] leading-relaxed">
                  Schedule festival discount launches (Sankranti, Diwali, Dussehra), seasonal stock arrival deadlines, supplier payment days, or quarterly tax filings.
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={() => setShowEventModal(true)}
                  disabled={!token}
                  className="w-full flex items-center justify-center gap-2 bg-white border border-[#E3DED5] hover:bg-stone-50 text-[#1C1917] px-3 py-2 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-[#8C6D53]" />
                  Add Custom Event to Calendar
                </button>
              </div>
            </div>
          </div>

          {/* Upcoming Google Calendar Events */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-[#1C1917] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#8C6D53]" />
                Upcoming Store Schedule on Google Calendar
              </h4>
              {token && (
                <button
                  onClick={() => loadUpcomingEvents(token)}
                  disabled={loadingEvents}
                  className="flex items-center gap-1.5 text-xs text-[#8C6D53] hover:underline font-semibold"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingEvents ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              )}
            </div>

            {loadingEvents ? (
              <div className="p-6 text-center text-xs text-[#6F6962]">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#8C6D53]" />
                Fetching events from Google Calendar...
              </div>
            ) : upcomingEvents.length === 0 ? (
              <div className="p-8 text-center bg-[#FAF8F4] rounded-lg border border-dashed border-[#E3DED5]">
                <Calendar className="w-8 h-8 text-[#9A938B] mx-auto mb-2" />
                <p className="text-xs text-[#6F6962]">
                  {token
                    ? 'No upcoming store calendar events found. Use the buttons above to schedule store routines!'
                    : 'Sign in with Google above to view and schedule events on your Google Calendar.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {upcomingEvents.map((evt) => {
                  const dateDisplay = evt.start.dateTime
                    ? new Date(evt.start.dateTime).toLocaleString('en-IN', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : evt.start.date || 'All Day';

                  return (
                    <div
                      key={evt.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-[#E3DED5] bg-[#FAF8F4] hover:bg-stone-50 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 text-amber-800 rounded-md">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#1C1917]">{evt.summary}</div>
                          <div className="text-[10px] text-[#6F6962] flex items-center gap-2 mt-0.5">
                            <Clock className="w-3 h-3" />
                            <span>{dateDisplay}</span>
                            {evt.description && <span className="truncate max-w-xs">&bull; {evt.description}</span>}
                          </div>
                        </div>
                      </div>
                      <a
                        href={evt.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E3DED5] hover:border-[#8C6D53] text-[#8C6D53] rounded-md text-xs font-semibold shadow-xs transition"
                      >
                        <span>View</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: FIREBASE SYNC & AUDIT LOGS */}
      {activeTab === 'firebase' && (
        <div className="space-y-6">
          {/* Cloud Architecture Info */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm">
            <h4 className="text-sm font-bold text-[#1C1917] mb-2 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-[#8C6D53]" />
              Firebase Cloud Firestore Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#6F6962] mt-3">
              <div className="p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5]">
                <div className="font-semibold text-[#1C1917]">Project ID</div>
                <div className="font-mono text-[11px] text-[#8C6D53] truncate mt-0.5">
                  gen-lang-client-0483853938
                </div>
              </div>
              <div className="p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5]">
                <div className="font-semibold text-[#1C1917]">Database Engine</div>
                <div className="font-mono text-[11px] text-[#8C6D53] truncate mt-0.5">
                  Firestore (asia-east1)
                </div>
              </div>
              <div className="p-3 bg-[#FAF8F4] rounded-lg border border-[#E3DED5]">
                <div className="font-semibold text-[#1C1917]">Security Rules</div>
                <div className="font-mono text-[11px] text-emerald-600 truncate mt-0.5">
                  ABAC Rules Deployed &bull; Zero-Trust
                </div>
              </div>
            </div>
          </div>

          {/* Sync & Activity Logs */}
          <div className="bg-white border border-[#E3DED5] rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-[#1C1917] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#8C6D53]" />
                  Google Sync &amp; Cloud Activity Logs
                </h4>
                <p className="text-xs text-[#6F6962] mt-0.5">
                  Persisted directly to Firestore collection <code>/google_sync_logs</code>
                </p>
              </div>
              <button
                onClick={loadSyncLogs}
                className="flex items-center gap-1.5 text-xs text-[#8C6D53] hover:underline font-semibold"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh Logs
              </button>
            </div>

            {syncLogs.length === 0 ? (
              <div className="p-8 text-center bg-[#FAF8F4] rounded-lg border border-dashed border-[#E3DED5]">
                <Cloud className="w-8 h-8 text-[#9A938B] mx-auto mb-2" />
                <p className="text-xs text-[#6F6962]">
                  No sync logs recorded yet. Operations will stream here once Sheets or Calendar events are triggered!
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#FAF8F4] text-[#6F6962] border-b border-[#E3DED5] uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp (IST)</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Summary</th>
                      <th className="py-2.5 px-3">User</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3DED5]">
                    {syncLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-stone-50">
                        <td className="py-2 px-3 text-[#6F6962] whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              log.type === 'sheets_export'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {log.type === 'sheets_export' ? 'SHEETS' : 'CALENDAR'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-medium text-[#1C1917]">{log.title}</td>
                        <td className="py-2 px-3 text-[#6F6962]">{log.userEmail}</td>
                        <td className="py-2 px-3 text-right">
                          {log.url && (
                            <a
                              href={log.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#8C6D53] hover:underline font-semibold inline-flex items-center gap-1"
                            >
                              <span>View</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-[#E3DED5] max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="text-sm font-bold text-[#1C1917] flex items-center gap-2">
                <CalendarPlus className="w-4 h-4 text-[#8C6D53]" />
                Schedule Store Calendar Event
              </h3>
              <button
                onClick={() => setShowEventModal(false)}
                className="text-stone-400 hover:text-stone-600 text-base font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateCustomEvent} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#6F6962] font-semibold mb-1">Event Title</label>
                <input
                  type="text"
                  required
                  value={customEvent.title}
                  onChange={(e) => setCustomEvent({ ...customEvent, title: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E3DED5] rounded-lg focus:outline-none focus:border-[#8C6D53]"
                  placeholder="e.g. Sankranti Mega Sale Launch"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[#6F6962] font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={customEvent.date}
                    onChange={(e) => setCustomEvent({ ...customEvent, date: e.target.value })}
                    className="w-full px-2 py-1.5 border border-[#E3DED5] rounded-lg focus:outline-none focus:border-[#8C6D53]"
                  />
                </div>
                <div>
                  <label className="block text-[#6F6962] font-semibold mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={customEvent.startTime}
                    onChange={(e) => setCustomEvent({ ...customEvent, startTime: e.target.value })}
                    className="w-full px-2 py-1.5 border border-[#E3DED5] rounded-lg focus:outline-none focus:border-[#8C6D53]"
                  />
                </div>
                <div>
                  <label className="block text-[#6F6962] font-semibold mb-1">End Time</label>
                  <input
                    type="time"
                    required
                    value={customEvent.endTime}
                    onChange={(e) => setCustomEvent({ ...customEvent, endTime: e.target.value })}
                    className="w-full px-2 py-1.5 border border-[#E3DED5] rounded-lg focus:outline-none focus:border-[#8C6D53]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#6F6962] font-semibold mb-1">Description / Notes</label>
                <textarea
                  rows={3}
                  value={customEvent.description}
                  onChange={(e) => setCustomEvent({ ...customEvent, description: e.target.value })}
                  className="w-full px-3 py-2 border border-[#E3DED5] rounded-lg focus:outline-none focus:border-[#8C6D53]"
                  placeholder="Details for the store team..."
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="px-3.5 py-2 border border-[#E3DED5] rounded-lg text-[#6F6962] hover:bg-stone-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#8C6D53] hover:bg-[#735841] text-white rounded-lg font-semibold shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Scheduling...' : 'Save to Google Calendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
