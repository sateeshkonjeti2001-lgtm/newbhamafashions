import React, { useEffect, useState } from 'react';
import {
  Database,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  HardDrive,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../services/api.ts';

interface DatabaseBackupProps {
  onOpenFullBackupTab?: () => void;
}

interface LiveDbInfo {
  filename: string;
  sizeBytes: number;
  totalTables: number;
  totalRecords: number;
  engine?: 'sqlite-node' | 'cloudflare-d1';
  downloadExtension?: string;
}

export const DatabaseBackup: React.FC<DatabaseBackupProps> = ({
  onOpenFullBackupTab,
}) => {
  const [dbInfo, setDbInfo] = useState<LiveDbInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<{
    filename: string;
    sizeBytes: number;
    checksum: string | null;
    timestamp: string;
  } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchDbInfo = async () => {
    setLoadingInfo(true);
    setInfoError(null);
    try {
      const info = await api.getLiveDatabaseInfo();
      setDbInfo({
        filename: info.filename,
        sizeBytes: info.sizeBytes,
        totalTables: info.totalTables,
        totalRecords: info.totalRecords,
        engine: info.engine,
        downloadExtension: info.downloadExtension,
      });
    } catch (err: any) {
      setInfoError(err.message || 'Unable to inspect database status');
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    fetchDbInfo();
  }, []);

  const handleManualDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(null);

    try {
      const result = await api.downloadLiveDatabase();
      setDownloadSuccess({
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        timestamp: new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });
      fetchDbInfo();
    } catch (err: any) {
      setDownloadError(err.message || 'Failed to export and download SQLite database');
    } finally {
      setDownloading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[#E3DED5] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[#1C1917]">Database Backup</h3>
            <p className="text-[11px] text-[#6F6962]">
              {dbInfo?.engine === 'cloudflare-d1'
                ? 'Download live Cloudflare D1 SQL snapshot to your device for local safety storage'
                : 'Download live SQLite file to your device for local safety storage'}
            </p>
          </div>
        </div>

        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5] shrink-0">
          {dbInfo?.engine === 'cloudflare-d1'
            ? `D1 Backup (${dbInfo.downloadExtension || '.sql'})`
            : 'SQLite (.sqlite)'}
        </span>
      </div>

      {/* Live Database Summary */}
      {loadingInfo ? (
        <div className="p-3 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-[11px] text-[#6F6962] flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#A67C52]" />
          <span>Inspecting live SQLite database...</span>
        </div>
      ) : infoError ? (
        <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[11px] text-[#A34F4F] flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{infoError}</span>
          </span>
          <button
            type="button"
            onClick={fetchDbInfo}
            className="text-[11px] font-semibold underline hover:no-underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : dbInfo ? (
        <div className="grid grid-cols-3 gap-2 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3 text-xs">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#6F6962] font-semibold block">
              Database File
            </span>
            <span className="font-mono text-[11px] font-bold text-[#1C1917] truncate block">
              {dbInfo.filename}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#6F6962] font-semibold block">
              Current Size
            </span>
            <span className="font-bold text-[11px] text-[#1C1917]">
              {formatBytes(dbInfo.sizeBytes)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#6F6962] font-semibold block">
              Schema / Rows
            </span>
            <span className="font-bold text-[11px] text-[#1C1917]">
              {dbInfo.totalTables} tbl · {dbInfo.totalRecords.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      ) : null}

      {/* Manual Download Action */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={handleManualDownload}
          disabled={downloading}
          className="w-full py-2.5 px-4 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition shadow-sm disabled:opacity-60 cursor-pointer"
        >
          {downloading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-[#A67C52]" />
              <span>Verifying Integrity &amp; Preparing Download...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4 text-[#A67C52]" />
              <span>
                {dbInfo?.engine === 'cloudflare-d1'
                  ? 'Download D1 Database Snapshot (.sql)'
                  : 'Download SQLite Database (.sqlite)'}
              </span>
            </>
          )}
        </button>

        {downloadSuccess && (
          <div className="p-3 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-[11px] text-[#3F6B50] space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#3F6B50]" />
              <span>Verified Database Downloaded ({downloadSuccess.timestamp})</span>
            </div>
            <div className="font-mono text-[10px] text-[#1E6B37] break-all">
              File: {downloadSuccess.filename} ({formatBytes(downloadSuccess.sizeBytes)})
            </div>
            {downloadSuccess.checksum && (
              <div className="font-mono text-[10px] text-[#3F6B50] truncate">
                SHA-256: {downloadSuccess.checksum.substring(0, 16)}...
              </div>
            )}
          </div>
        )}

        {downloadError && (
          <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[11px] text-[#A34F4F] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}
      </div>

      {/* Safety Guidance & Full Archive Link */}
      <div className="pt-2 border-t border-[#E3DED5] space-y-2 text-[11px] text-[#6F6962]">
        <div className="flex items-start gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-[#3F6B50] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {dbInfo?.engine === 'cloudflare-d1' ? (
              <>
                Exports a verified <span className="font-mono text-[#1C1917]">.sql</span> snapshot with SHA-256 verification before downloading. Save copies to your computer or offline storage.
              </>
            ) : (
              <>
                Runs <span className="font-mono text-[#1C1917]">PRAGMA integrity_check</span> before downloading. Save copies to your computer, USB drive, or private cloud folder.
              </>
            )}
          </p>
        </div>

        {onOpenFullBackupTab && (
          <button
            type="button"
            onClick={onOpenFullBackupTab}
            className="w-full py-1.5 px-3 bg-[#FAF8F4] hover:bg-[#F3EFE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <HardDrive className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>Open Scheduled Backups &amp; Restore Center</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-[#6F6962]" />
          </button>
        )}
      </div>
    </div>
  );
};
