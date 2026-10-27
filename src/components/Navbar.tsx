import React from 'react';
import {
  Store,
  User,
  LogOut,
  Calendar,
  ShieldCheck,
  UserCheck,
  Menu,
  ShoppingCart,
} from 'lucide-react';
import { User as UserType } from '../types.ts';

interface NavbarProps {
  user: UserType;
  onLogout: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  dayClosed?: boolean;
  onToggleMobileMenu?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
  activeTab,
  setActiveTab,
  dayClosed = false,
  onToggleMobileMenu,
}) => {
  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case 'dashboard':
        return 'Dashboard';
      case 'daily-bills':
        return 'Daily Bills';
      case 'pos':
        return 'POS Billing';
      case 'bills':
        return 'Bills & Returns';
      case 'products':
        return 'Products';
      case 'inventory':
        return 'Inventory';
      case 'purchases':
        return 'Purchases';
      case 'money':
        return 'Accounts';
      case 'dues':
        return 'Customer Dues';
      case 'staff':
        return 'Staff';
      case 'closing':
        return 'Day Closing';
      case 'assets_loans':
        return 'Assets';
      case 'reports':
        return 'Reports';
      case 'google_workspace':
        return 'Google Workspace';
      case 'audit':
        return 'Audit';
      default:
        return 'ERP';
    }
  };

  return (
    <header className="bg-white border-b border-[#E3DED5] text-[#1C1917] sticky top-0 z-30 shadow-[0_2px_10px_rgba(23,21,19,0.03)] shrink-0">
      <div className="px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hamburger (mobile/tablet) + Brand */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Mobile hamburger button */}
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="lg:hidden p-2 min-w-[40px] min-h-[40px] text-[#1C1917] hover:bg-[#FAF8F4] border border-[#E3DED5] rounded-xl flex items-center justify-center transition cursor-pointer shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5 text-[#A67C52]" />
          </button>

          <div className="p-1.5 sm:p-2 rounded-xl bg-[#171513] text-[#F5F2EC] shadow-xs flex items-center justify-center shrink-0">
            <Store className="w-4 h-4 sm:w-5 sm:h-5 text-[#A67C52]" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h1 className="font-bold text-sm sm:text-base tracking-tight text-[#1C1917] truncate">
                New Bhama Fashions
              </h1>
              <span className="hidden md:inline-block text-[11px] font-medium bg-[#FAF8F4] text-[#6F6962] border border-[#E3DED5] px-2 py-0.5 rounded-md">
                Chilakaluripet, AP
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#6F6962]">
              <span className="hidden sm:inline">Offline Store ERP</span>
              <span className="lg:hidden text-[#A67C52] font-semibold flex items-center gap-1">
                <span className="hidden sm:inline">&bull;</span> {getTabLabel(activeTab)}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Date / Day Status / User / Quick POS / Logout */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Business Day Status Pill */}
          <div className="hidden sm:flex items-center gap-2 bg-[#FAF8F4] px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#E3DED5] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[#9A938B]" />
            <span className="text-[#1C1917] font-medium hidden md:inline">{todayStr}</span>
            <span className="text-[#D4CDC2] hidden md:inline">|</span>
            {dayClosed ? (
              <span className="text-[#A34F4F] font-semibold flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-[#A34F4F]"></span> Closed
              </span>
            ) : (
              <span className="text-[#3F6B50] font-semibold flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-[#3F6B50] animate-pulse"></span> Active
              </span>
            )}
          </div>

          {/* User Profile Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 bg-[#FAF8F4] px-2.5 sm:px-3 py-1.5 rounded-xl border border-[#E3DED5]">
            {user.role === 'OWNER' ? (
              <ShieldCheck className="w-4 h-4 text-[#A67C52] shrink-0" />
            ) : (
              <UserCheck className="w-4 h-4 text-[#526B7A] shrink-0" />
            )}
            <div className="text-xs">
              <span className="font-semibold text-[#1C1917] hidden sm:inline">{user.full_name}</span>
              <span className="text-[10px] sm:ml-1.5 uppercase font-bold tracking-wider text-[#9A938B]">
                {user.role}
              </span>
            </div>
          </div>

          {/* Quick POS Shortcut (tablet & desktop) */}
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="hidden sm:flex items-center gap-1.5 bg-[#A67C52] hover:bg-[#8F6843] text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>POS</span>
          </button>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            title="Sign out of ERP"
            className="p-2 min-w-[36px] min-h-[36px] text-[#6F6962] hover:text-[#A34F4F] hover:bg-[#FAF8F4] border border-transparent hover:border-[#E3DED5] rounded-xl transition cursor-pointer flex items-center justify-center"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
