import React from 'react';
import {
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  ReceiptText,
  Shirt,
  Boxes,
  Truck,
  Wallet,
  BookOpen,
  UserCheck,
  CalendarCheck,
  Landmark,
  FileSpreadsheet,
  History,
  Cloud,
  ChevronLeft,
  ChevronRight,
  X,
  Store,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { UserRole } from '../types.ts';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  role: UserRole;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  role,
  isMobileOpen = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const isOwner = role === 'OWNER';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ownerOnly: false },
    { id: 'daily-bills', label: 'Daily Bills', icon: Receipt, ownerOnly: false },
    { id: 'pos', label: 'POS Billing', icon: ShoppingCart, ownerOnly: false },
    { id: 'bills', label: 'Bills & Returns', icon: ReceiptText, ownerOnly: false },
    { id: 'products', label: 'Products & Catalog', icon: Shirt, ownerOnly: false },
    { id: 'inventory', label: 'Stock & Inventory', icon: Boxes, ownerOnly: false },
    { id: 'purchases', label: 'Purchases & Suppliers', icon: Truck, ownerOnly: true },
    { id: 'money', label: 'Money & Accounts', icon: Wallet, ownerOnly: true },
    { id: 'dues', label: 'Customer Dues (Credit)', icon: BookOpen, ownerOnly: false },
    { id: 'staff', label: 'Staff & Attendance', icon: UserCheck, ownerOnly: false },
    { id: 'closing', label: 'Daily Closing (Day Book)', icon: CalendarCheck, ownerOnly: false },
    { id: 'assets_loans', label: 'Assets & Loans', icon: Landmark, ownerOnly: true },
    { id: 'reports', label: 'Reports & Excel', icon: FileSpreadsheet, ownerOnly: false },
    { id: 'google_workspace', label: 'Google Sheets & Calendar', icon: Cloud, ownerOnly: false },
    { id: 'audit', label: 'Audit & Settings', icon: History, ownerOnly: true },
  ];

  const visibleItems = navItems.filter((item) => !item.ownerOnly || isOwner);

  const handleNavClick = (id: string) => {
    setActiveTab(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* 1. Mobile Drawer Navigation (< lg screens) */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Dark Backdrop */}
          <div
            className="fixed inset-0 bg-[#171513]/70 backdrop-blur-xs transition-opacity duration-200"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Slide-in Drawer Container */}
          <aside className="relative w-72 max-w-[85vw] bg-[#171513] text-white flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200 h-full">
            {/* Mobile Drawer Header */}
            <div className="p-4 border-b border-[#25211D] flex items-center justify-between bg-[#1D1A17]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#2A221B] text-[#A67C52] border border-[#3E342B]">
                  <Store className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-sm text-[#F5F2EC]">New Bhama Fashions</h2>
                  <span className="text-[10px] text-[#9A938B]">Chilakaluripet, AP</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#9A938B] hover:text-[#F5F2EC] hover:bg-[#25211D] rounded-xl transition cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile Nav Links */}
            <div className="px-4 py-2 text-[10px] font-bold tracking-wider text-[#9A938B] uppercase">
              Store Operations
            </div>
            <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-colors duration-150 text-left relative group ${
                      isActive
                        ? 'bg-[#2A221B] text-[#F5F2EC] font-semibold border border-[#A67C52]/40'
                        : 'text-[#9A938B] hover:bg-[#25211D] hover:text-[#F5F2EC]'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-2 bottom-2 w-1 bg-[#A67C52] rounded-r-full" />
                    )}
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#A67C52]' : 'text-[#9A938B] group-hover:text-[#F5F2EC]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-3.5 border-t border-[#25211D] text-[11px] text-[#9A938B]/80 text-center font-medium bg-[#1D1A17]">
              New Bhama Fashions &bull; Offline ERP
            </div>
          </aside>
        </div>
      )}

      {/* 2. Desktop Sidebar (>= lg screens, 1024px+) */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 bg-[#171513] border-r border-[#25211D] transition-all duration-200 select-none ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        <div className={`px-4 py-3.5 text-[11px] font-semibold tracking-wider text-[#9A938B] uppercase flex items-center ${
          isCollapsed ? 'justify-center' : 'justify-between'
        }`}>
          {!isCollapsed && <span>Store Operations</span>}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg text-[#9A938B] hover:text-[#F5F2EC] hover:bg-[#25211D] transition cursor-pointer"
            >
              {isCollapsed ? <PanelLeft className="w-4 h-4 text-[#A67C52]" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={isCollapsed ? item.label : undefined}
                className={`w-full flex items-center ${
                  isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'
                } rounded-xl text-xs transition-colors duration-150 text-left relative group ${
                  isActive
                    ? 'bg-[#2A221B] text-[#F5F2EC] font-semibold'
                    : 'text-[#9A938B] hover:bg-[#25211D] hover:text-[#F5F2EC]'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-[#A67C52] rounded-r-full" />
                )}
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-[#A67C52]' : 'text-[#9A938B] group-hover:text-[#F5F2EC]'
                  }`}
                />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className={`p-3.5 border-t border-[#25211D] text-[11px] text-[#9A938B]/80 font-medium ${
          isCollapsed ? 'text-center' : 'text-center'
        }`}>
          {isCollapsed ? 'NBF' : 'New Bhama Fashions \u2022 v1.0 Offline'}
        </div>
      </aside>
    </>
  );
};
