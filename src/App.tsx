import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  ReceiptText,
  Menu,
} from 'lucide-react';
import { api, removeStoredToken } from './services/api.ts';
import { User } from './types.ts';
import { Navbar } from './components/Navbar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { DailyBillsView } from './components/DailyBillsView.tsx';
import { POSView } from './components/POSView.tsx';
import { BillHistoryView } from './components/BillHistoryView.tsx';
import { ProductsView } from './components/ProductsView.tsx';
import { InventoryView } from './components/InventoryView.tsx';
import { PurchasesView } from './components/PurchasesView.tsx';
import { MoneyView } from './components/MoneyView.tsx';
import { CustomerDuesView } from './components/CustomerDuesView.tsx';
import { StaffView } from './components/StaffView.tsx';
import { ClosingView } from './components/ClosingView.tsx';
import { AssetsLoansView } from './components/AssetsLoansView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { AuditView } from './components/AuditView.tsx';
import { GoogleWorkspaceView } from './components/GoogleWorkspaceView.tsx';

const SetupScreen = lazy(() =>
  import('./components/SetupScreen.tsx').then((m) => ({ default: m.SetupScreen }))
);
const LoginScreen = lazy(() =>
  import('./components/LoginScreen.tsx').then((m) => ({ default: m.LoginScreen }))
);

export default function App() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [dayClosed, setDayClosed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [billsFilter, setBillsFilter] = useState<{ date?: string; channel?: 'ALL' | 'POS' | 'MANUAL' }>({
    channel: 'ALL',
  });
  const [loading, setLoading] = useState<boolean>(true);

  const initAuth = async () => {
    setLoading(true);
    try {
      // 1. Check if owner setup is required
      const statusRes = await api.getSetupStatus();
      if (statusRes.setup_required) {
        setSetupRequired(true);
        setLoading(false);
        return;
      }
      setSetupRequired(false);

      // 2. Check if logged in (checks HTTP-only session cookie or token)
      try {
        const meRes = await api.getMe();
        if (meRes.user) {
          setCurrentUser(meRes.user);

          // Fetch day closed status
          try {
            const todayStr = new Date().toISOString().split('T')[0];
            const closingRes = await api.getDayClosingSummary(todayStr);
            setDayClosed(Boolean(closingRes.isClosed));
          } catch (e) {
            // Non-blocking
          }
        } else {
          removeStoredToken();
        }
      } catch (err) {
        removeStoredToken();
      }
    } catch (err: any) {
      console.error('App init error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn('Logout server notification failed:', err);
    }
    removeStoredToken();
    setCurrentUser(null);
    setActiveTab('dashboard');
    setMobileMenuOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F2EC] text-[#1C1917] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-[#A67C52] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-[#6F6962] font-medium tracking-wide">
            Initializing New Bhama Fashions ERP...
          </p>
        </div>
      </div>
    );
  }

  // 1. First-time Owner Setup Screen
  if (setupRequired) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F5F2EC]" />}>
        <SetupScreen
          onSetupSuccess={(user) => {
            setSetupRequired(false);
            setCurrentUser(user);
          }}
        />
      </Suspense>
    );
  }

  // 2. Login Screen
  if (!currentUser) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F5F2EC]" />}>
        <LoginScreen
          onLoginSuccess={(user) => {
            setCurrentUser(user);
          }}
        />
      </Suspense>
    );
  }

  // 3. Main Business ERP System
  return (
    <div className="h-screen bg-[#F5F2EC] text-[#1C1917] flex flex-col font-sans overflow-hidden">
      <Navbar
        user={currentUser}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        dayClosed={dayClosed}
        onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
      />

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          role={currentUser.role}
          isMobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        />

        <main
          className={`flex-1 min-h-0 bg-[#F5F2EC] pb-16 md:pb-0 ${
            activeTab === 'pos'
              ? 'p-2 sm:p-3 lg:p-3.5 flex flex-col overflow-y-auto lg:overflow-hidden'
              : 'overflow-y-auto p-3 sm:p-5 lg:p-8'
          }`}
        >
          <div
            className={
              activeTab === 'pos'
                ? 'flex-1 min-h-0 w-full h-full flex flex-col'
                : 'max-w-7xl mx-auto'
            }
          >
            {activeTab === 'dashboard' && (
              <DashboardView
                role={currentUser.role}
                setActiveTab={setActiveTab}
                onNavigateToBills={(filter) => {
                  if (filter) {
                    setBillsFilter(filter);
                    if (filter.channel === 'MANUAL') {
                      setActiveTab('daily-bills');
                      return;
                    }
                  }
                  setActiveTab('bills');
                }}
              />
            )}

            {activeTab === 'daily-bills' && (
              <DailyBillsView
                role={currentUser.role}
                onNavigateToDashboard={() => setActiveTab('dashboard')}
                initialDate={billsFilter.date}
              />
            )}

            {activeTab === 'pos' && (
              <POSView
                role={currentUser.role}
                currentUser={currentUser}
                onNavigateToBills={() => setActiveTab('bills')}
              />
            )}

            {activeTab === 'bills' && (
              <BillHistoryView
                role={currentUser.role}
                onNavigateToPOS={() => setActiveTab('pos')}
                initialDateFilter={billsFilter.date}
                initialChannelFilter={billsFilter.channel}
              />
            )}

            {activeTab === 'products' && (
              <ProductsView role={currentUser.role} />
            )}

            {activeTab === 'inventory' && (
              <InventoryView role={currentUser.role} />
            )}

            {activeTab === 'purchases' && <PurchasesView />}

            {activeTab === 'money' && <MoneyView />}

            {activeTab === 'dues' && <CustomerDuesView />}

            {activeTab === 'staff' && <StaffView role={currentUser.role} />}

            {activeTab === 'closing' && (
              <ClosingView role={currentUser.role} />
            )}

            {activeTab === 'assets_loans' && <AssetsLoansView />}

            {activeTab === 'reports' && (
              <ReportsView
                role={currentUser.role}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab === 'google_workspace' && <GoogleWorkspaceView />}

            {activeTab === 'audit' && <AuditView />}
          </div>
        </main>
      </div>

      {/* 4. Bottom Mobile Quick Navigation Bar (< md screens) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-[#171513] text-[#9A938B] border-t border-[#25211D] z-30 flex items-center justify-around px-2 py-1 shadow-lg"
        aria-label="Mobile quick actions"
      >
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[48px] text-[10px] font-medium transition cursor-pointer ${
            activeTab === 'dashboard'
              ? 'text-[#F5F2EC] font-bold bg-[#2A221B]'
              : 'hover:text-[#F5F2EC]'
          }`}
        >
          <LayoutDashboard className={`w-4 h-4 mb-1 ${activeTab === 'dashboard' ? 'text-[#A67C52]' : ''}`} />
          <span>Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('daily-bills')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[48px] text-[10px] font-medium transition cursor-pointer ${
            activeTab === 'daily-bills'
              ? 'text-[#F5F2EC] font-bold bg-[#2A221B]'
              : 'hover:text-[#F5F2EC]'
          }`}
        >
          <Receipt className={`w-4 h-4 mb-1 ${activeTab === 'daily-bills' ? 'text-[#A67C52]' : ''}`} />
          <span>Daily Bills</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pos')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[48px] text-[10px] font-medium transition cursor-pointer ${
            activeTab === 'pos'
              ? 'text-[#F5F2EC] font-bold bg-[#2A221B]'
              : 'hover:text-[#F5F2EC]'
          }`}
        >
          <ShoppingCart className={`w-4 h-4 mb-1 ${activeTab === 'pos' ? 'text-[#A67C52]' : ''}`} />
          <span>POS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bills')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[48px] text-[10px] font-medium transition cursor-pointer ${
            activeTab === 'bills'
              ? 'text-[#F5F2EC] font-bold bg-[#2A221B]'
              : 'hover:text-[#F5F2EC]'
          }`}
        >
          <ReceiptText className={`w-4 h-4 mb-1 ${activeTab === 'bills' ? 'text-[#A67C52]' : ''}`} />
          <span>Bills</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center py-1.5 px-3 rounded-xl min-h-[48px] text-[10px] font-medium hover:text-[#F5F2EC] transition cursor-pointer"
        >
          <Menu className="w-4 h-4 mb-1 text-[#A67C52]" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
