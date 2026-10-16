import React from 'react';
import { Store, User, LogOut, Calendar, ShieldCheck, UserCheck } from 'lucide-react';
import { User as UserType } from '../types.ts';

interface NavbarProps {
  user: UserType;
  onLogout: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  dayClosed?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
  setActiveTab,
  dayClosed = false,
}) => {
  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="bg-white border-b border-[#E3DED5] text-[#1C1917] sticky top-0 z-30 shadow-[0_2px_10px_rgba(23,21,19,0.03)]">
      <div className="px-5 py-3 flex items-center justify-between gap-4">
        {/* Brand & Store Location */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#171513] text-[#F5F2EC] shadow-sm flex items-center justify-center">
            <Store className="w-5 h-5 text-[#A67C52]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-[#1C1917]">New Bhama Fashions</h1>
              <span className="text-[11px] font-medium bg-[#FAF8F4] text-[#6F6962] border border-[#E3DED5] px-2 py-0.5 rounded-md">
                Chilakaluripet, AP
              </span>
            </div>
            <p className="text-[11px] text-[#6F6962]">Offline Store ERP &amp; POS Billing</p>
          </div>
        </div>

        {/* Business Day Status & Quick Switch */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-[#FAF8F4] px-3 py-1.5 rounded-lg border border-[#E3DED5] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[#9A938B]" />
            <span className="text-[#1C1917] font-medium">{todayStr}</span>
            <span className="text-[#D4CDC2]">|</span>
            {dayClosed ? (
              <span className="text-[#A34F4F] font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A34F4F]"></span> Day Closed
              </span>
            ) : (
              <span className="text-[#3F6B50] font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#3F6B50] animate-pulse"></span> Day Active
              </span>
            )}
          </div>

          {/* User Profile Pill */}
          <div className="flex items-center gap-2 bg-[#FAF8F4] px-3 py-1.5 rounded-lg border border-[#E3DED5]">
            {user.role === 'OWNER' ? (
              <ShieldCheck className="w-4 h-4 text-[#A67C52]" />
            ) : (
              <UserCheck className="w-4 h-4 text-[#526B7A]" />
            )}
            <div className="text-xs">
              <span className="font-medium text-[#1C1917]">{user.full_name}</span>
              <span className="text-[10px] ml-1.5 uppercase font-bold tracking-wider text-[#9A938B]">
                ({user.role})
              </span>
            </div>
          </div>

          {/* Quick POS Shortcut */}
          <button
            onClick={() => setActiveTab('pos')}
            className="hidden md:flex items-center gap-1.5 bg-[#A67C52] hover:bg-[#8F6843] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition"
          >
            Open POS
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            title="Sign out of ERP"
            className="p-1.5 text-[#6F6962] hover:text-[#A34F4F] hover:bg-[#FAF8F4] border border-transparent hover:border-[#E3DED5] rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
