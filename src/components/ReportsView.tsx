import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  DollarSign,
  Boxes,
  Truck,
  BookOpen,
  PieChart,
  Shield,
  FileText,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { UserRole } from '../types.ts';
import { Cloud, ArrowUpRight } from 'lucide-react';
import { SalesTrendsChart } from './SalesTrendsChart.tsx';

interface ReportsViewProps {
  role: UserRole;
  setActiveTab?: (tab: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ role, setActiveTab }) => {
  const [startDate, setStartDate] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const setPresetRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const isOwner = role === 'OWNER';

  const handleDownload = async (type: string, title: string) => {
    setDownloading(type);
    try {
      await api.downloadExport(type, { startDate, endDate });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  };

  const reportCards = [
    {
      id: 'sales',
      title: 'Sales Register Report',
      desc: 'Complete itemized sales records with customer, bill number, amounts, and payment methods.',
      icon: DollarSign,
      color: 'text-[#3F6B50] bg-[#F4F9F5] border border-[#CCE3D2]',
      ownerOnly: false,
    },
    {
      id: 'stock',
      title: 'Stock & Inventory Valuation',
      desc: 'Current physical quantity on shelf, barcode, selling price, and total stock valuation.',
      icon: Boxes,
      color: 'text-[#A67C52] bg-[#FAF8F4] border border-[#E3DED5]',
      ownerOnly: false,
    },
    {
      id: 'customer_dues',
      title: 'Customer Credit & Dues Ledger',
      desc: 'Full list of outstanding store credits, bill references, customer details, and balance due.',
      icon: BookOpen,
      color: 'text-[#A67C52] bg-[#FAF8F4] border border-[#E3DED5]',
      ownerOnly: false,
    },
    {
      id: 'daily_closing',
      title: 'Daily Closing & Day Book Register',
      desc: 'Reconciled day summaries, physical cash counts, system expectations, and cash discrepancies.',
      icon: FileText,
      color: 'text-[#1C1917] bg-[#F0EDE6] border border-[#D4CDC2]',
      ownerOnly: false,
    },
    {
      id: 'purchases',
      title: 'Supplier Purchases & Dues Report',
      desc: 'Supplier invoices, total intake amounts, amounts settled, and pending accounts payable.',
      icon: Truck,
      color: 'text-[#1C1917] bg-[#F0EDE6] border border-[#D4CDC2]',
      ownerOnly: true,
    },
    {
      id: 'money_flow',
      title: 'Financial Money Flow & Expenses',
      desc: 'All categorized operating expenses, owner capital in, owner drawings, and account movements.',
      icon: PieChart,
      color: 'text-[#A34F4F] bg-[#FDF5F5] border border-[#F0CCCC]',
      ownerOnly: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Business Reports &amp; Excel Exports</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Export clean, structured spreadsheets and financial registers for New Bhama Fashions
          </p>
        </div>

        {/* Date Filter & Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs shadow-xs">
            <button
              onClick={() => setPresetRange(7)}
              className="px-2.5 py-1 rounded-lg text-[#6F6962] hover:text-[#1C1917] hover:bg-[#FAF8F4] font-medium transition"
            >
              7D
            </button>
            <button
              onClick={() => setPresetRange(30)}
              className="px-2.5 py-1 rounded-lg text-[#6F6962] hover:text-[#1C1917] hover:bg-[#FAF8F4] font-medium transition"
            >
              30D
            </button>
            <button
              onClick={() => setPresetRange(90)}
              className="px-2.5 py-1 rounded-lg text-[#6F6962] hover:text-[#1C1917] hover:bg-[#FAF8F4] font-medium transition"
            >
              90D
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white border border-[#D4CDC2] p-1.5 sm:p-2 rounded-xl text-xs shadow-xs">
            <Calendar className="w-4 h-4 text-[#A67C52]" />
            <span className="text-[#6F6962] font-semibold">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
            />
            <span className="text-[#6F6962] font-semibold">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 bg-[#FAF8F4] border border-[#D4CDC2] rounded-lg text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
            />
          </div>
        </div>
      </div>

      {/* Visual Sales Trends & Performance Insights (Recharts) */}
      <SalesTrendsChart startDate={startDate} endDate={endDate} isOwner={isOwner} />

      {/* Google Sheets Integration Banner */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-[#FAF8F4] border border-emerald-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#1C1917]">Live Google Sheets &amp; Cloud Sync</h3>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>
            <p className="text-xs text-[#6F6962] mt-0.5">
              Sync Day Book, Catalog Valuation, and Customer Dues straight into your Google Drive spreadsheets!
            </p>
          </div>
        </div>

        {setActiveTab && (
          <button
            onClick={() => setActiveTab('google_workspace')}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold shadow-xs transition shrink-0"
          >
            <span>Open Google Sheets Hub</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Section Header for Downloadable Registers */}
      <div className="pt-2">
        <h3 className="text-sm font-bold text-[#1C1917] uppercase tracking-wider">
          Downloadable Excel &amp; Financial Registers
        </h3>
        <p className="text-xs text-[#6F6962] mt-0.5">
          Itemized transactional ledgers formatted for chartered accountants and inventory auditors
        </p>
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {reportCards.map((r) => {
          if (r.ownerOnly && !isOwner) return null;
          const isBusy = downloading === r.id;

          return (
            <div
              key={r.id}
              className="bg-white border border-[#E3DED5] rounded-2xl p-6 flex flex-col justify-between hover:border-[#D4CDC2] transition shadow-[0_2px_12px_rgba(23,21,19,0.03)] space-y-5"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-xl ${r.color}`}>
                    <r.icon className="w-5 h-5" />
                  </div>
                  {r.ownerOnly && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#A67C52] border border-[#D4CDC2]">
                      Owner Only
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="font-bold text-sm text-[#1C1917]">{r.title}</h3>
                  <p className="text-xs text-[#6F6962] mt-1.5 leading-relaxed">{r.desc}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E3DED5]">
                <button
                  onClick={() => handleDownload(r.id, r.title)}
                  disabled={isBusy}
                  className="w-full py-2.5 bg-[#FAF8F4] hover:bg-[#F0EDE6] text-[#1C1917] border border-[#D4CDC2] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-xs"
                >
                  <Download className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>{isBusy ? 'Generating Export...' : 'Download Excel / CSV'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
