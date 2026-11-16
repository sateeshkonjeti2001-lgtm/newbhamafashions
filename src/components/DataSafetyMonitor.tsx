import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Database,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Cloud,
  HardDrive,
  ShieldCheck,
  Download,
  Archive,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { DataSafetyStatus } from '../types.ts';

interface DataSafetyMonitorProps {
  onOpenBackupCenter?: () => void;
}

export const DataSafetyMonitor: React.FC<DataSafetyMonitorProps> = ({
  onOpenBackupCenter,
}) => {
  const [status, setStatus] = useState<DataSafetyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingDb, setDownloadingDb] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStatus = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      setRefreshing(true);
    }
    try {
      const data = await api.getDataSafetyStatus();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load real-time data safety telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus(false);
  }, [fetchStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchStatus(true);
    }, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchStatus]);

  const handleQuickBackup = async () => {
    setCreatingBackup(true);
    setActionMessage(null);
    try {
      const res = await api.createManualBackup('Snapshot triggered from Audit Data Safety monitor');
      setActionMessage({
        type: 'success',
        text: `Verified backup created: ${res.backup.filename}`,
      });
      await fetchStatus(false);
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to create snapshot',
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleQuickDownload = async () => {
    setDownloadingDb(true);
    setActionMessage(null);
    try {
      const res = await api.downloadLiveDatabase();
      setActionMessage({
        type: 'success',
        text: `Downloaded verified SQLite copy: ${res.filename}`,
      });
      await fetchStatus(false);
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to download live database',
      });
    } finally {
      setDownloadingDb(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  };

  const formatIstDateTime = (iso: string | null | undefined) => {
    if (!iso) return 'Never';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return (
      dt.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }) + ' IST'
    );
  };

  const formatRelativeAge = (iso: string | null | undefined) => {
    if (!iso) return 'No successful backup recorded yet';
    const dt = new Date(iso).getTime();
    if (Number.isNaN(dt)) return '';
    const diffMs = Math.max(0, Date.now() - dt);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  if (loading && !status) {
    return (
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-10 text-center space-y-2.5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <RefreshCw className="w-6 h-6 animate-spin text-[#A67C52] mx-auto" />
        <p className="text-xs font-medium text-[#6F6962]">
          Checking Litestream replication, SQLite storage &amp; backup status...
        </p>
      </div>
    );
  }

  const ls = status?.litestream;
  const db = status?.database;
  const bak = status?.backup;

  const lsBadgeClasses =
    ls?.status === 'REPLICATING'
      ? 'bg-[#EBF7EE] text-[#1E6B37] border-[#BDE5C8]'
      : ls?.status === 'DEGRADED'
      ? 'bg-[#FDF5F5] text-[#A34F4F] border-[#F0CCCC]'
      : 'bg-[#FAF8F4] text-[#6F6962] border-[#D4CDC2]';

  return (
    <div className="space-y-5">
      {/* Live Monitor Control Bar */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#171513] flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-[#1C1917]">Real-Time Data Safety Monitor</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FAF8F4] text-[#3F6B50] border border-[#E3DED5]">
                <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-[#3F6B50] animate-pulse' : 'bg-[#9A938B]'}`} />
                {autoRefresh ? 'Live (10s)' : 'Paused'}
              </span>
            </div>
            <p className="text-[11px] text-[#6F6962]">
              Last checked: {status ? formatIstDateTime(status.checkedAt) : '-'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="px-3 py-1.5 rounded-xl border border-[#D4CDC2] bg-[#FAF8F4] hover:bg-[#F3EFE6] text-xs font-semibold text-[#1C1917] transition cursor-pointer"
          >
            {autoRefresh ? 'Pause Auto-Refresh' : 'Resume Auto-Refresh'}
          </button>

          <button
            type="button"
            onClick={() => fetchStatus(false)}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-xl bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#A67C52] ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh Now'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center gap-2 border ${
            actionMessage.type === 'success'
              ? 'bg-[#F4F9F5] border-[#CCE3D2] text-[#3F6B50]'
              : 'bg-[#FDF5F5] border-[#F0CCCC] text-[#A34F4F]'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span className="font-medium">{actionMessage.text}</span>
        </div>
      )}

      {/* Primary 3 Data Safety Cards */}
      {status && ls && db && bak && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Card 1: Real-Time Litestream Replication Status */}
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)] flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E3DED5]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0">
                    <Cloud className="w-4 h-4 text-[#A67C52]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#1C1917]">Litestream Replication</h4>
                    <p className="text-[11px] text-[#6F6962]">Continuous GCS WAL Sync</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${lsBadgeClasses}`}>
                  {ls.statusLabel}
                </span>
              </div>

              <p className="text-xs text-[#6F6962] leading-relaxed">{ls.statusDetail}</p>

              <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Target Bucket:</span>
                  <span className="font-mono text-[11px] font-semibold text-[#1C1917] truncate max-w-[190px]">
                    {ls.replicaPath || 'Not set (Local mode)'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Replicate Process:</span>
                  <span
                    className={`font-semibold ${
                      ls.processRunning ? 'text-[#1E6B37]' : 'text-[#6F6962]'
                    }`}
                  >
                    {ls.processRunning ? 'Running' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Binary &amp; Config:</span>
                  <span className="font-medium text-[#1C1917]">
                    {ls.binaryInstalled ? 'Installed' : 'Not installed'} &middot;{' '}
                    {ls.configPath ? 'Configured' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Retention Policy:</span>
                  <span className="font-mono text-[11px] text-[#1C1917]">
                    {ls.retention || '720h (30d)'}
                  </span>
                </div>
                {(ls.latestSnapshotAt || ls.shadowLastUpdatedAt) && (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E3DED5]">
                    <span className="text-[#6F6962]">Latest Replica Sync:</span>
                    <span className="font-mono text-[10px] font-semibold text-[#1C1917]">
                      {formatIstDateTime(ls.latestSnapshotAt || ls.shadowLastUpdatedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: SQLite Database File Size & Footprint */}
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)] flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E3DED5]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0">
                    <Database className="w-4 h-4 text-[#A67C52]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#1C1917]">Database File Size</h4>
                    <p className="text-[11px] text-[#6F6962] font-mono">{db.filename}</p>
                  </div>
                </div>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5]">
                  SQLite
                </span>
              </div>

              <div>
                <p className="text-3xl font-bold tracking-tight text-[#1C1917]">
                  {formatBytes(db.sizeBytes)}
                </p>
                <p className="text-[11px] text-[#6F6962] font-mono mt-0.5">
                  {db.sizeBytes.toLocaleString('en-IN')} bytes on disk
                </p>
              </div>

              <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Tables / Records:</span>
                  <span className="font-semibold text-[#1C1917]">
                    {db.totalTables} tables &middot; {db.totalRecords.toLocaleString('en-IN')} rows
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">WAL / SHM Overhead:</span>
                  <span className="font-mono text-[11px] text-[#1C1917]">
                    {formatBytes(db.walSizeBytes)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6F6962]">Last Disk Write:</span>
                  <span className="font-medium text-[11px] text-[#1C1917] text-right">
                    {formatIstDateTime(db.lastModifiedAt)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleQuickDownload}
              disabled={downloadingDb}
              className="w-full py-2 px-3 bg-[#FAF8F4] hover:bg-[#F3EFE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>{downloadingDb ? 'Exporting Verified Copy...' : 'Download Live .sqlite Copy'}</span>
            </button>
          </div>

          {/* Card 3: Last Successful Backup */}
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)] flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E3DED5]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-[#A67C52]" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-[#1C1917]">Last Successful Backup</h4>
                    <p className="text-[11px] text-[#6F6962]">Verified Snapshot Record</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                    bak.lastSuccessfulBackupAt
                      ? 'bg-[#EBF7EE] text-[#1E6B37] border-[#BDE5C8]'
                      : 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]'
                  }`}
                >
                  {bak.lastSuccessfulBackupAt ? 'Recorded' : 'Backup Needed'}
                </span>
              </div>

              <div>
                <p className="text-lg font-bold tracking-tight text-[#1C1917]">
                  {formatIstDateTime(bak.lastSuccessfulBackupAt)}
                </p>
                <p className="text-[11px] text-[#6F6962] mt-0.5">
                  {formatRelativeAge(bak.lastSuccessfulBackupAt)}
                </p>
              </div>

              <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3 space-y-2 text-xs">
                {bak.lastSuccessfulBackup ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#6F6962]">Type / Integrity:</span>
                      <span className="font-semibold text-[#1C1917]">
                        {bak.lastSuccessfulBackup.backup_type} &middot;{' '}
                        <span
                          className={
                            bak.lastSuccessfulBackup.verification_status === 'VERIFIED'
                              ? 'text-[#1E6B37]'
                              : 'text-[#A67C52]'
                          }
                        >
                          {bak.lastSuccessfulBackup.verification_status}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#6F6962]">Snapshot Size:</span>
                      <span className="font-semibold text-[#1C1917]">
                        {formatBytes(bak.lastSuccessfulBackup.file_size)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#6F6962]">SHA-256:</span>
                      <span className="font-mono text-[10px] text-[#1C1917]">
                        {bak.lastSuccessfulBackup.checksum_sha256.substring(0, 14)}...
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-[#6F6962]">
                    No local backup snapshot has been created yet. Create your first snapshot below.
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E3DED5]">
                  <span className="text-[#6F6962]">Next Scheduled:</span>
                  <span className="font-medium text-[11px] text-[#1C1917] text-right">
                    {bak.nextScheduledBackupDisplay}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleQuickBackup}
              disabled={creatingBackup}
              className="w-full py-2 px-3 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>{creatingBackup ? 'Creating Snapshot...' : 'Create Backup Snapshot Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Data Safety Summary & Quick Navigation */}
      {status && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FAF8F4] border border-[#E3DED5] flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-[#3F6B50]" />
            </div>
            <div className="space-y-1 text-xs">
              <h4 className="font-bold text-[#1C1917] flex items-center gap-2">
                <span>Archive &amp; Recovery Summary</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FAF8F4] border border-[#E3DED5] text-[#6F6962] font-semibold">
                  {status.backup.totalValidBackups} valid archive{status.backup.totalValidBackups === 1 ? '' : 's'} ({formatBytes(status.backup.totalStorageBytes)})
                </span>
              </h4>
              <p className="text-[#6F6962] leading-relaxed">
                Nightly scheduler is{' '}
                <strong className="text-[#1C1917]">
                  {status.backup.autoBackupEnabled ? 'enabled (10:00 PM IST)' : 'paused'}
                </strong>
                .{' '}
                {status.backup.lastRestoreTestAt
                  ? `Last dry-run restore test: ${formatIstDateTime(status.backup.lastRestoreTestAt)} (${status.backup.lastRestoreTestResult || 'PASSED'}).`
                  : 'Run a dry-run restore test in the Backup & Restore center to verify disaster recovery readiness.'}
              </p>
              {status.backup.lastErrorMessage && (
                <p className="text-[#A34F4F] font-medium">
                  Last backup warning: {status.backup.lastErrorMessage}
                </p>
              )}
            </div>
          </div>

          {onOpenBackupCenter && (
            <button
              type="button"
              onClick={onOpenBackupCenter}
              className="px-4 py-2 bg-[#FAF8F4] hover:bg-[#F3EFE6] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>Manage Archives &amp; Restore</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#6F6962]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
