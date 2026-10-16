import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
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
} from 'lucide-react';
import { UserRole } from '../types.ts';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  role: UserRole;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, role }) => {
  const isOwner = role === 'OWNER';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ownerOnly: false },
    { id: 'pos', label: 'POS Billing', icon: ShoppingCart, ownerOnly: false },
    { id: 'bills', label: 'Bills & Returns', icon: Receipt, ownerOnly: false },
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

  return (
    <aside className="w-64 bg-[#171513] border-r border-[#25211D] flex flex-col shrink-0">
      <div className="px-4 py-3.5 text-[11px] font-semibold tracking-wider text-[#9A938B] uppercase">
        Store Operations
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-colors duration-150 text-left relative group ${
                isActive
                  ? 'bg-[#2A221B] text-[#F5F2EC] font-semibold'
                  : 'text-[#9A938B] hover:bg-[#25211D] hover:text-[#F5F2EC]'
              }`}
            >
              {/* Active brown accent indicator bar on the left */}
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-[#A67C52] rounded-r-full" />
              )}
              <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[#A67C52]' : 'text-[#9A938B] group-hover:text-[#F5F2EC]'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3.5 border-t border-[#25211D] text-[11px] text-[#9A938B]/80 text-center font-medium">
        New Bhama Fashions &bull; v1.0 Offline
      </div>
    </aside>
  );
};
