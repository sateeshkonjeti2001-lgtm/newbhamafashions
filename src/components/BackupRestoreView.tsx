import React, { useState, useEffect } from 'react';
import {
  Database,
  HardDrive,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Calendar,
  Download,
  RefreshCw,
  Lock,
  Unlock,
  Trash2,
  Upload,
  FileText,
  Check,
  X,
  Play,
  Activity,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../services/api.ts';
import {
  BackupRecord,
  BackupHealth,
  BackupSettings,
  DryRunRestoreReport,
} from '../types.ts';

interface BackupRestoreViewProps {
  onDatabaseRestored?: () => void;
}

export const BackupRestoreView: React.FC<BackupRestoreViewProps> = ({
  onDatabaseRestored,
}) => {
  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter & tab controls
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Manual Backup State
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingLiveDb, setDownloadingLiveDb] = useState(false);
  const [backupProgressStep, setBackupProgressStep] = useState<string | null>(null);
  const [manualSuccessMsg, setManualSuccessMsg] = useState<string | null>(null);
  const [manualErrorMsg, setManualErrorMsg] = useState<string | null>(null);

  // Settings form state
  const [scheduleTime, setScheduleTime] = useState('22:00');
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [dailyRetention, setDailyRetention] = useState(14);
  const [weeklyRetention, setWeeklyRetention] = useState(8);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  // Restore Modal State
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupRecord | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; base64: string; size: number } | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgressMsg, setRestoreProgressMsg] = useState<string | null>(null);
  const [restoreSuccessReport, setRestoreSuccessReport] = useState<any | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Dry-Run Restore Test Modal State
  const [testReport, setTestReport] = useState<DryRunRestoreReport | null>(null);
  const [testingBackupId, setTestingBackupId] = useState<string | null>(null);
  const [testingError, setTestingError] = useState<string | null>(null);

  // In-line verify / delete feedback
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [hRes, histRes, sRes] = await Promise.all([
        api.getBackupHealth().catch(() => null),
        api.getBackupHistory().catch(() => ({ history: [] })),
        api.getBackupSettings().catch(() => null),
      ]);

      if (hRes) setHealth(hRes);
      if (histRes?.history) setHistory(histRes.history);
      if (sRes?.settings) {
        setSettings(sRes.settings);
        setScheduleTime(sRes.settings.schedule_time_ist || '22:00');
        setAutoEnabled(Boolean(sRes.settings.auto_backup_enabled));
        setDailyRetention(sRes.settings.retention_daily_count || 14);
        setWeeklyRetention(sRes.settings.retention_weekly_count || 8);
      }
    } catch (err: any) {
      console.error('Error loading backup data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const isD1 = health?.engine === 'cloudflare-d1';

  const handleCreateBackupNow = async () => {
    setCreatingBackup(true);
    setBackupProgressStep(
      isD1 ? 'Exporting consistent Cloudflare D1 SQL snapshot...' : 'Exporting consistent SQLite binary database...'
    );
    setManualSuccessMsg(null);
    setManualErrorMsg(null);

    try {
      setBackupProgressStep(
        isD1 ? 'Validating table counts & SHA-256 checksum...' : 'Validating SQLite PRAGMA integrity & SHA-256...'
      );
      const res = await api.createManualBackup('Manual backup created from Backup & Restore Dashboard');

      if (res.success && res.backup) {
        setBackupProgressStep('Finalizing verified snapshot archive...');
        setManualSuccessMsg(`Backup created & verified successfully: ${res.backup.filename} (${(res.backup.file_size / 1024).toFixed(1)} KB)`);
        loadData();
      } else {
        throw new Error('Backup failed validation');
      }
    } catch (err: any) {
      setManualErrorMsg(err.message || 'Failed to create database backup');
    } finally {
      setCreatingBackup(false);
      setBackupProgressStep(null);
    }
  };

  const handleDownloadLiveDatabase = async () => {
    setDownloadingLiveDb(true);
    setManualSuccessMsg(null);
    setManualErrorMsg(null);
    try {
      const result = await api.downloadLiveDatabase();
      const sizeText = result.sizeBytes >= 1024 * 1024
        ? `${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(result.sizeBytes / 1024).toFixed(1)} KB`;
      setManualSuccessMsg(
        `Verified ${isD1 ? 'Cloudflare D1 SQL' : 'SQLite'} database downloaded for local storage: ${result.filename} (${sizeText})`
      );
    } catch (err: any) {
      setManualErrorMsg(err.message || 'Failed to download live database');
    } finally {
      setDownloadingLiveDb(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccess(null);

    try {
      const res = await api.updateBackupSettings({
        auto_backup_enabled: autoEnabled,
        schedule_time_ist: isD1 ? '22:00' : scheduleTime,
        retention_daily_count: Number(dailyRetention) || 14,
        retention_weekly_count: Number(weeklyRetention) || 8,
      });

      if (res.success) {
        setSettingsSuccess(
          isD1
            ? 'Automatic backup toggle & retention policy saved for the Cloudflare Cron scheduler (22:00 IST / 16:30 UTC).'
            : 'Backup schedule & retention policy saved and rescheduled in the persistent background service.'
        );
        setTimeout(() => setSettingsSuccess(null), 5000);
        loadData();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update backup settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleVerifyBackup = async (id: string) => {
    setActionInProgressId(id);
    try {
      const res = await api.verifyBackup(id);
      if (res.success) {
        loadData();
      } else {
        alert('Verification failed: ' + res.details);
      }
    } catch (err: any) {
      alert('Verification error: ' + err.message);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleTestRestore = async (id: string) => {
    setTestingBackupId(id);
    setTestingError(null);
    setTestReport(null);

    try {
      const res = await api.testRestoreBackup(id);
      if (res.success && res.report) {
        setTestReport(res.report);
        loadData();
      } else {
        throw new Error('Test dry-run restore failed');
      }
    } catch (err: any) {
      setTestingError(err.message || 'Dry-run restore test failed');
    } finally {
      setTestingBackupId(null);
    }
  };

  const handleToggleLock = async (id: string) => {
    setActionInProgressId(id);
    try {
      await api.toggleBackupLock(id);
      loadData();
    } catch (err: any) {
      alert('Failed to toggle lock: ' + err.message);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteBackup = async (id: string, filename: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete backup "${filename}"?\nThis cannot be undone.`)) {
      return;
    }
    setActionInProgressId(id);
    try {
      await api.deleteBackup(id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete backup');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isSqlFile = lowerName.endsWith('.sql');
    const isSqliteFile =
      lowerName.endsWith('.sqlite') || lowerName.endsWith('.db') || lowerName.endsWith('.nbfbak');

    if (isD1 && !isSqlFile) {
      alert(
        isSqliteFile
          ? 'Cloudflare D1 requires a .sql backup export. Binary .sqlite files cannot be restored directly on D1 (convert using scripts/export-sqlite-to-d1.ts).'
          : 'Please select a valid Cloudflare D1 SQL backup file (.sql).'
      );
      return;
    }

    if (!isD1 && !isSqliteFile) {
      alert('Please select a valid SQLite backup file (.sqlite, .db, or .nbfbak)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      setUploadedFile({
        name: file.name,
        base64,
        size: file.size,
      });
      setSelectedBackupForRestore(null);
      setShowRestoreModal(true);
      setRestoreConfirmed(false);
      setRestoreError(null);
      setRestoreSuccessReport(null);
    };
    reader.readAsDataURL(file);
  };

  const handleExecuteRestore = async () => {
    if (!restoreConfirmed) {
      alert('Please confirm by checking the acknowledgement box before proceeding with restoration.');
      return;
    }

    setRestoring(true);
    setRestoreProgressMsg('1. Creating mandatory pre-restore safety snapshot of live database...');
    setRestoreError(null);
    setRestoreSuccessReport(null);

    try {
      let res: any;
      if (uploadedFile) {
        setRestoreProgressMsg(
          isD1
            ? '2. Validating SQL backup format, schema compatibility & OWNER safety...'
            : '2. Uploading file and running SQLite constraint checks...'
        );
        res = await api.uploadRestoreBackup(uploadedFile.name, uploadedFile.base64);
      } else if (selectedBackupForRestore) {
        setRestoreProgressMsg(
          isD1
            ? '2. Validating D1 snapshot and applying atomic batch restore...'
            : '2. Loading backup buffer and validating foreign-key integrity...'
        );
        res = await api.restoreBackup(selectedBackupForRestore.id);
      } else {
        throw new Error('No backup selected for restore');
      }

      if (res.success) {
        setRestoreProgressMsg('3. Database restored successfully! Reloading system cache...');
        setRestoreSuccessReport(res);
        loadData();
        if (onDatabaseRestored) {
          onDatabaseRestored();
        }
      } else {
        throw new Error(res.error || 'Restore failed');
      }
    } catch (err: any) {
      setRestoreError(err.message || 'Restoration failed. Live database was protected.');
    } finally {
      setRestoring(false);
      setRestoreProgressMsg(null);
    }
  };

  const filteredHistory = history.filter((item) => {
    if (typeFilter === 'ALL') return true;
    return item.backup_type === typeFilter;
  });

  const getHealthBadge = (status?: string) => {
    switch (status) {
      case 'HEALTHY':
        return {
          label: 'System Healthy',
          desc: 'Verified recovery points exist & scheduler active',
          badgeClass: 'text-[#1E6B37] bg-[#EBF7EE] border border-[#BDE5C8]',
        };
      case 'BACKUP_DUE':
        return {
          label: 'Backup Due',
          desc: 'No recent valid recovery snapshot within 36 hours',
          badgeClass: 'text-[#A67C52] bg-[#FAF8F4] border border-[#D4CDC2]',
        };
      case 'FAILED':
        return {
          label: 'Last Backup Failed',
          desc: 'Review errors and retry manual backup',
          badgeClass: 'text-[#991B1B] bg-[#FEF2F2] border border-[#F87171]',
        };
      case 'VERIFICATION_REQUIRED':
        return {
          label: 'Verification Due',
          desc: 'Latest backup needs cryptographic integrity verification',
          badgeClass: 'text-[#A67C52] bg-[#FAF8F4] border border-[#D4CDC2]',
        };
      case 'RESTORE_TEST_REQUIRED':
        return {
          label: 'Restore Test Recommended',
          desc: 'Run an isolated dry-run restore test to ensure zero surprises',
          badgeClass: 'text-[#526B7A] bg-[#F0F4F7] border border-[#C5D3DC]',
        };
      default:
        return {
          label: 'Checking...',
          desc: 'Evaluating backup system status',
          badgeClass: 'text-[#6F6962] bg-[#FAF8F4] border border-[#E3DED5]',
        };
    }
  };

  const healthInfo = getHealthBadge(health?.status);

  return (
    <div className="space-y-6">
      {/* Overview & Quick Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Card */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-4.5 space-y-2 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#6F6962] uppercase tracking-wider">
              Backup Health
            </span>
            <Database className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div className="pt-0.5">
            <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full ${healthInfo.badgeClass}`}>
              {healthInfo.label}
            </span>
          </div>
          <p className="text-[11px] text-[#6F6962] leading-tight">
            {healthInfo.desc}
          </p>
        </div>

        {/* Last Successful Card */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-4.5 space-y-2 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#6F6962] uppercase tracking-wider">
              Last Valid Backup
            </span>
            <ShieldCheck className="w-4 h-4 text-[#3F6B50]" />
          </div>
          <div className="text-sm font-bold text-[#1C1917]">
            {health?.lastSuccessfulBackup ? (
              new Date(health.lastSuccessfulBackup.created_at).toLocaleString('en-IN', {
                dateStyle: 'short',
                timeStyle: 'short',
              })
            ) : (
              <span className="text-[#A67C52]">None recorded yet</span>
            )}
          </div>
          <p className="text-[11px] text-[#6F6962] truncate">
            {health?.lastSuccessfulBackup ? (
              <span>Size: {(health.lastSuccessfulBackup.file_size / 1024).toFixed(1)} KB · {health.lastSuccessfulBackup.backup_type}</span>
            ) : (
              'Create a manual backup below'
            )}
          </p>
        </div>

        {/* Next Scheduled Card */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-4.5 space-y-2 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#6F6962] uppercase tracking-wider">
              Next Auto Backup
            </span>
            <Clock className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div className="text-sm font-bold text-[#1C1917]">
            {health?.nextScheduledBackupDisplay || 'Not scheduled'}
          </div>
          <p className="text-[11px] text-[#6F6962]">
            {health?.autoBackupEnabled ? (
              <span className="text-[#3F6B50] font-medium">
                {isD1
                  ? 'Nightly at 22:00 IST (16:30 UTC Cron)'
                  : `Nightly at ${settings?.schedule_time_ist || '22:00'} IST`}
              </span>
            ) : (
              <span className="text-[#A67C52]">Automatic scheduler paused</span>
            )}
          </p>
        </div>

        {/* Storage & Recovery Points */}
        <div className="bg-white border border-[#E3DED5] rounded-2xl p-4.5 space-y-2 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#6F6962] uppercase tracking-wider">
              Storage &amp; Archive
            </span>
            <HardDrive className="w-4 h-4 text-[#A67C52]" />
          </div>
          <div className="text-sm font-bold text-[#1C1917]">
            {health?.totalValidBackups ?? 0} Valid Snapshots
          </div>
          <p className="text-[11px] text-[#6F6962]">
            {isD1 ? 'D1 snapshots:' : 'Disk used:'} {((health?.totalStorageBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>
      </div>

      {/* Prominent Action Banner: Create Backup Now & Feedback */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 shadow-[0_2px_12px_rgba(23,21,19,0.03)] flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-[#A67C52]" />
            <h3 className="font-bold text-base text-[#1C1917]">Instant Database Snapshot</h3>
          </div>
          <p className="text-xs text-[#6F6962] max-w-2xl leading-relaxed">
            Exports a byte-for-byte consistent snapshot of all POS sales, FIFO inventory batches, financial ledger, customer dues, supplier records, and audit logs with SHA-256 validation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={handleCreateBackupNow}
            disabled={creatingBackup}
            className="px-5 py-2.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {creatingBackup ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#A67C52]" />
                <span>Creating Snapshot...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 text-[#A67C52] fill-[#A67C52]" />
                <span>Create Backup Now</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadLiveDatabase}
            disabled={downloadingLiveDb}
            className="px-4 py-2.5 bg-white hover:bg-[#FAF8F4] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
          >
            {downloadingLiveDb ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#A67C52]" />
                <span>{isD1 ? 'Preparing SQL...' : 'Preparing SQLite...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-[#A67C52]" />
                <span>{isD1 ? 'Download D1 Backup (.sql)' : 'Download SQLite (.sqlite)'}</span>
              </>
            )}
          </button>

          <label className="px-4 py-2.5 bg-white hover:bg-[#FAF8F4] border border-[#D4CDC2] text-[#1C1917] rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-xs">
            <Upload className="w-4 h-4 text-[#A67C52]" />
            <span>{isD1 ? 'Upload SQL Backup (.sql)' : 'Upload Backup File'}</span>
            <input
              type="file"
              accept={isD1 ? '.sql' : '.sqlite,.db,.nbfbak'}
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Progress / Status Notice for Manual Backup */}
      {creatingBackup && backupProgressStep && (
        <div className="p-3.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] flex items-center gap-3">
          <RefreshCw className="w-4 h-4 animate-spin text-[#A67C52]" />
          <span className="font-medium">{backupProgressStep}</span>
        </div>
      )}

      {manualSuccessMsg && (
        <div className="p-4 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-[#3F6B50] text-xs flex items-center justify-between gap-3 font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-[#3F6B50]" />
            <span>{manualSuccessMsg}</span>
          </div>
          <button
            onClick={() => setManualSuccessMsg(null)}
            className="text-[#3F6B50] hover:text-[#1E6B37]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {manualErrorMsg && (
        <div className="p-4 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F] text-xs flex items-center justify-between gap-3 font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-[#A34F4F]" />
            <span>{manualErrorMsg}</span>
          </div>
          <button
            onClick={() => setManualErrorMsg(null)}
            className="text-[#A34F4F] hover:text-[#991B1B]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Grid: Scheduler & Retention Settings (Left) + Recovery Guidelines (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Scheduler Form (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#A67C52]" />
              <div>
                <h3 className="font-bold text-sm text-[#1C1917]">Automatic Nightly Scheduler &amp; Retention</h3>
                <p className="text-[11px] text-[#6F6962]">
                  Unattended daily backups running on the background service after shop closing
                </p>
              </div>
            </div>
            <span className="text-[10px] text-[#A67C52] font-semibold bg-[#FAF8F4] px-2.5 py-0.5 rounded-full border border-[#E3DED5]">
              IST Timezone
            </span>
          </div>

          {settingsSuccess && (
            <div className="p-3 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-xs text-[#3F6B50] flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#3F6B50]" />
              <span>{settingsSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            {/* Enable switch */}
            <div className="flex items-center justify-between p-3.5 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl">
              <div className="space-y-0.5">
                <span className="font-bold text-[#1C1917]">Enable Automatic Daily Backups</span>
                <p className="text-[11px] text-[#6F6962]">
                  Runs in the background without needing a browser window open.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  onChange={(e) => setAutoEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#D4CDC2] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#D4CDC2] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#171513]"></div>
              </label>
            </div>

            {/* Schedule time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Daily Backup Time (India Standard Time)
                </label>
                <div className="relative">
                  {isD1 ? (
                    <div className="w-full px-3 py-2 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-[#1C1917] font-semibold">
                      22:00 IST (16:30 UTC · Cloudflare Cron)
                    </div>
                  ) : (
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-semibold focus:outline-none focus:border-[#A67C52]"
                    />
                  )}
                </div>
                <span className="text-[10px] text-[#6F6962] block mt-1">
                  {isD1
                    ? 'Managed by Cloudflare Worker Cron Trigger ("30 16 * * *" = 10:00 PM IST nightly)'
                    : 'Default: 22:00 (10:00 PM IST) after retail store closing'}
                </span>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Daily Snapshots Retention Limit
                </label>
                <input
                  type="number"
                  min="5"
                  max="90"
                  value={dailyRetention}
                  onChange={(e) => setDailyRetention(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-semibold focus:outline-none focus:border-[#A67C52]"
                />
                <span className="text-[10px] text-[#6F6962] block mt-1">
                  Keeps latest {dailyRetention} daily backups (min 5)
                </span>
              </div>
            </div>

            {/* Retention Note */}
            <div className="p-3 bg-[#FAF8F4] border border-[#E3DED5] rounded-xl text-[11px] text-[#6F6962] space-y-1">
              <p className="font-semibold text-[#1C1917]">Safe Retention Protection:</p>
              <p>
                The retention engine never deletes the only valid backup point in the system, and never deletes backups designated as locked/protected.
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold flex items-center gap-2 transition shadow-sm disabled:opacity-50 cursor-pointer text-xs"
              >
                <Check className="w-4 h-4 text-[#A67C52]" />
                <span>{savingSettings ? 'Saving...' : 'Save Schedule & Retention Settings'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Safe Recovery Guidelines Card (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E3DED5]">
            <ShieldCheck className="w-5 h-5 text-[#3F6B50]" />
            <div>
              <h3 className="font-bold text-sm text-[#1C1917]">Disaster Recovery Architecture</h3>
              <p className="text-[11px] text-[#6F6962]">Strict safeguards enforced</p>
            </div>
          </div>

          <div className="space-y-3 text-xs text-[#6F6962] leading-relaxed">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#1C1917]">Mandatory Pre-Restore Snapshot:</strong> Before any restore replaces the database, a safety snapshot of the live database is created and verified automatically.
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#1C1917]">Automatic Rollback:</strong> If a restore fails constraint or integrity checks, the system automatically rolls back without corrupting live data.
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#1C1917]">Isolated Dry-Run Testing:</strong> You can test any backup file in memory with a single click without modifying the live database.
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#1C1917]">External Offline Storage:</strong> Download backups to a USB drive or secondary hard disk for offsite safety.
              </div>
            </div>
          </div>

          {health?.lastRestoreTestResult && (
            <div className="p-3 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#1C1917]">Last Restore Test:</span>
                <span className="text-[10px] text-[#3F6B50] font-semibold bg-[#EBF7EE] px-2 py-0.5 rounded-full border border-[#BDE5C8]">
                  Verified
                </span>
              </div>
              <p className="text-[11px] text-[#6F6962]">{health.lastRestoreTestResult}</p>
              <p className="text-[10px] text-[#9A938B]">
                Tested on: {new Date(health.lastRestoreTestAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Backup History Table */}
      <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)] space-y-3 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E3DED5]">
          <div>
            <h3 className="font-bold text-base text-[#1C1917]">Backup History &amp; Recovery Archive</h3>
            <p className="text-xs text-[#6F6962]">
              Persistent ledger of all automatic, manual, and pre-restore database snapshots
            </p>
          </div>

          {/* Type Filter Buttons */}
          <div className="flex items-center gap-1.5 p-1 bg-[#FAF8F4] rounded-xl border border-[#D4CDC2] text-xs">
            {['ALL', 'AUTOMATIC', 'MANUAL', 'PRE_RESTORE'].map((tab) => (
              <button
                key={tab}
                onClick={() => setTypeFilter(tab)}
                className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  typeFilter === tab
                    ? 'bg-[#171513] text-[#F5F2EC] shadow-sm'
                    : 'text-[#6F6962] hover:text-[#1C1917]'
                }`}
              >
                {tab === 'ALL'
                  ? 'All Backups'
                  : tab === 'AUTOMATIC'
                  ? 'Automatic'
                  : tab === 'MANUAL'
                  ? 'Manual'
                  : 'Pre-Restore'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1C1917]">
            <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
              <tr>
                <th className="px-4 py-3">Timestamp / ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">File Size</th>
                <th className="px-4 py-3">Verification &amp; Checksum</th>
                <th className="px-4 py-3">Created By</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DED5]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#6F6962]">
                    Loading backup history...
                  </td>
                </tr>
              ) : filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#9A938B] space-y-1">
                    <Database className="w-8 h-8 mx-auto text-[#9A938B] stroke-1" />
                    <p className="font-semibold text-[#1C1917]">No backups found for selected filter.</p>
                    <p className="text-xs text-[#6F6962]">
                      Click "Create Backup Now" to create your first consistent recovery point.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredHistory.map((item) => {
                  const isProcessing = actionInProgressId === item.id || testingBackupId === item.id;
                  const isSuccess = item.status === 'SUCCESS';
                  const isVerified = item.verification_status === 'VERIFIED';

                  return (
                    <tr key={item.id} className="hover:bg-[#FAF8F4]/80 transition">
                      <td className="px-4 py-3.5 space-y-0.5">
                        <div className="font-bold text-[#1C1917]">
                          {new Date(item.created_at).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'medium',
                          })}
                        </div>
                        <div className="font-mono text-[10px] text-[#6F6962] truncate max-w-xs">
                          {item.filename}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                            item.backup_type === 'AUTOMATIC'
                              ? 'bg-[#EBF7EE] text-[#1E6B37] border border-[#BDE5C8]'
                              : item.backup_type === 'PRE_RESTORE'
                              ? 'bg-[#F0F4F7] text-[#526B7A] border border-[#C5D3DC]'
                              : 'bg-[#FAF8F4] text-[#A67C52] border border-[#D4CDC2]'
                          }`}
                        >
                          {item.backup_type}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 font-semibold text-[#1C1917]">
                        {item.file_size > 0 ? (
                          <span>{(item.file_size / 1024).toFixed(1)} KB</span>
                        ) : (
                          <span className="text-[#991B1B]">0 KB</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 space-y-1">
                        <div className="flex items-center gap-1.5">
                          {isSuccess && isVerified ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1E6B37]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Verified OK</span>
                            </span>
                          ) : isSuccess ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#A67C52]">
                              <Clock className="w-3.5 h-3.5" />
                              <span>Unchecked</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#991B1B]">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Failed</span>
                            </span>
                          )}
                        </div>
                        {item.checksum_sha256 && (
                          <div className="font-mono text-[10px] text-[#9A938B]">
                            SHA: {item.checksum_sha256.substring(0, 12)}...
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-[#6F6962]">
                        <div className="font-medium text-[#1C1917]">{item.created_by_name || 'System'}</div>
                        <div className="text-[10px] text-[#9A938B]">{item.created_by}</div>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {/* Download */}
                          {isSuccess && (
                            <button
                              onClick={() => api.downloadBackupFile(item.id, item.filename)}
                              title={`Download backup file (${isD1 ? '.sql' : '.sqlite'})`}
                              className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-white rounded-lg border border-transparent hover:border-[#D4CDC2] transition cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-[#A67C52]" />
                            </button>
                          )}

                          {/* Verify */}
                          {isSuccess && (
                            <button
                              onClick={() => handleVerifyBackup(item.id)}
                              disabled={isProcessing}
                              title="Verify SHA-256 and SQLite integrity"
                              className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-white rounded-lg border border-transparent hover:border-[#D4CDC2] transition cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-[#3F6B50]" />
                            </button>
                          )}

                          {/* Dry-Run Test */}
                          {isSuccess && (
                            <button
                              onClick={() => handleTestRestore(item.id)}
                              disabled={isProcessing}
                              title="Run isolated dry-run restore test (Safe in-memory test)"
                              className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-white rounded-lg border border-transparent hover:border-[#D4CDC2] transition cursor-pointer"
                            >
                              <Activity className="w-3.5 h-3.5 text-[#526B7A]" />
                            </button>
                          )}

                          {/* Lock / Unlock */}
                          <button
                            onClick={() => handleToggleLock(item.id)}
                            disabled={isProcessing}
                            title={item.is_locked ? 'Unlock backup (allows retention pruning)' : 'Lock backup (prevents retention pruning)'}
                            className="p-1.5 text-[#6F6962] hover:text-[#1C1917] hover:bg-white rounded-lg border border-transparent hover:border-[#D4CDC2] transition cursor-pointer"
                          >
                            {item.is_locked ? (
                              <Lock className="w-3.5 h-3.5 text-[#A67C52]" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5 text-[#9A938B]" />
                            )}
                          </button>

                          {/* Restore Button */}
                          {isSuccess && (
                            <button
                              onClick={() => {
                                setSelectedBackupForRestore(item);
                                setUploadedFile(null);
                                setShowRestoreModal(true);
                                setRestoreConfirmed(false);
                                setRestoreError(null);
                                setRestoreSuccessReport(null);
                              }}
                              title="Restore ERP database from this point"
                              className="px-2 py-1 bg-white hover:bg-[#FAF8F4] border border-[#D4CDC2] text-[#1C1917] hover:text-[#991B1B] rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer ml-1"
                            >
                              <span>Restore</span>
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteBackup(item.id, item.filename)}
                            disabled={isProcessing || item.is_locked === 1}
                            title={item.is_locked ? 'Cannot delete locked backup' : 'Delete backup'}
                            className="p-1.5 text-[#6F6962] hover:text-[#991B1B] hover:bg-[#FDF5F5] rounded-lg transition disabled:opacity-30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dry-Run Restore Test Modal */}
      {(testReport || testingError) && (
        <div className="fixed inset-0 z-50 bg-[#171513]/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-[0_12px_40px_rgba(23,21,19,0.2)] max-w-lg w-full p-6 space-y-4 border border-[#E3DED5]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#526B7A]" />
                <h3 className="font-bold text-base text-[#1C1917]">Isolated Dry-Run Restore Test</h3>
              </div>
              <button
                onClick={() => {
                  setTestReport(null);
                  setTestingError(null);
                }}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {testingError ? (
              <div className="p-4 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F] space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>Dry-Run Test Failed:</span>
                </div>
                <p>{testingError}</p>
              </div>
            ) : testReport ? (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-[#3F6B50] space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Dry-Run Restore Passed 100% (Non-Destructive)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {testReport.message} Live production database remained untouched.
                  </p>
                </div>

                <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5] space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[#6F6962]">SQLite Integrity:</span>{' '}
                      <strong className="text-[#1E6B37]">{testReport.integrity_status}</strong>
                    </div>
                    <div>
                      <span className="text-[#6F6962]">Foreign Keys:</span>{' '}
                      <strong className="text-[#1E6B37]">{testReport.foreign_keys_ok ? 'All Valid' : 'Warnings'}</strong>
                    </div>
                    <div>
                      <span className="text-[#6F6962]">Store Identity:</span>{' '}
                      <strong className="text-[#1C1917]">{testReport.store_name}</strong>
                    </div>
                    <div>
                      <span className="text-[#6F6962]">Total Tables:</span>{' '}
                      <strong className="text-[#1C1917]">{testReport.table_count} tables</strong>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#E3DED5]">
                    <span className="font-semibold text-[#1C1917] block mb-1">Verified Record Counts in Snapshot:</span>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[10px] text-[#1C1917]">
                      <div>Products: {testReport.sample_records.products}</div>
                      <div>Sales: {testReport.sample_records.sales}</div>
                      <div>Customers: {testReport.sample_records.customers}</div>
                      <div>Purchases: {testReport.sample_records.purchases}</div>
                      <div>Financial Tx: {testReport.sample_records.financial_transactions}</div>
                      <div>Audit Logs: {testReport.sample_records.audit_logs}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="pt-3 border-t border-[#E3DED5] flex justify-end">
              <button
                onClick={() => {
                  setTestReport(null);
                  setTestingError(null);
                }}
                className="px-4 py-2 bg-[#171513] text-[#F5F2EC] rounded-xl text-xs font-semibold cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal (Safe 2-Step Recovery Flow) */}
      {showRestoreModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-[0_12px_40px_rgba(23,21,19,0.2)] max-w-lg w-full p-6 space-y-4 border border-[#E3DED5]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div className="flex items-center gap-2 text-[#991B1B]">
                <ShieldAlert className="w-5 h-5 text-[#991B1B]" />
                <h3 className="font-bold text-base text-[#1C1917]">Confirm Database Restoration</h3>
              </div>
              <button
                onClick={() => {
                  if (!restoring) {
                    setShowRestoreModal(false);
                    setSelectedBackupForRestore(null);
                    setUploadedFile(null);
                  }
                }}
                className="text-[#9A938B] hover:text-[#1C1917]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Details */}
            <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3.5 space-y-1.5 text-xs">
              <div className="font-semibold text-[#1C1917]">Target Recovery Snapshot:</div>
              <p className="font-mono text-[11px] text-[#A67C52] font-bold">
                {uploadedFile ? uploadedFile.name : selectedBackupForRestore?.filename}
              </p>
              <div className="text-[11px] text-[#6F6962] flex gap-3">
                <span>
                  Size: {(uploadedFile ? uploadedFile.size / 1024 : (selectedBackupForRestore?.file_size || 0) / 1024).toFixed(1)} KB
                </span>
                {!uploadedFile && selectedBackupForRestore && (
                  <span>
                    Created: {new Date(selectedBackupForRestore.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                )}
              </div>
            </div>

            {/* Safety Warning */}
            <div className="p-3.5 bg-[#FEF2F2] border border-[#F87171] rounded-xl text-xs text-[#991B1B] space-y-2">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-[#991B1B]" />
                <span>Critical Recovery Warning</span>
              </div>
              <p className="leading-relaxed">
                "Restoring this backup will replace the current database state. Transactions created after the backup timestamp may no longer be present in the restored state."
              </p>
              <div className="pt-1 border-t border-[#F87171]/40 text-[11px] text-[#7F1D1D]">
                A safety snapshot of the live database will be created and verified automatically before restoring.
              </div>
            </div>

            {/* Progress status during restore */}
            {restoring && restoreProgressMsg && (
              <div className="p-3.5 bg-[#FAF8F4] border border-[#D4CDC2] rounded-xl text-xs text-[#1C1917] flex items-center gap-2.5 font-medium">
                <RefreshCw className="w-4 h-4 animate-spin text-[#A67C52]" />
                <span>{restoreProgressMsg}</span>
              </div>
            )}

            {/* Error Message */}
            {restoreError && (
              <div className="p-3 bg-[#FEF2F2] border border-[#F87171] rounded-xl text-xs text-[#991B1B] font-medium">
                {restoreError}
              </div>
            )}

            {/* Success Report */}
            {restoreSuccessReport && (
              <div className="p-3.5 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-xs text-[#3F6B50] space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Database Restored Successfully!</span>
                </div>
                <p className="text-[11px]">
                  Safety snapshot ID: <span className="font-mono font-bold">{restoreSuccessReport.preRestoreBackupId}</span>
                </p>
                <div className="text-[10px] text-[#1E6B37] font-mono">
                  {isD1
                    ? 'The live Cloudflare D1 database has been restored from the validated SQL backup.'
                    : 'The live SQLite database has been replaced with the verified archive.'}
                </div>
              </div>
            )}

            {/* Confirmation Checkbox */}
            {!restoreSuccessReport && (
              <div className="pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#1C1917]">
                  <input
                    type="checkbox"
                    checked={restoreConfirmed}
                    onChange={(e) => setRestoreConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-[#D4CDC2] text-[#A67C52] focus:ring-[#A67C52]"
                  />
                  <span className="font-medium leading-relaxed">
                    I confirm that I want to replace the current live database with this backup snapshot.
                  </span>
                </label>
              </div>
            )}

            {/* Action buttons */}
            <div className="pt-3 border-t border-[#E3DED5] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowRestoreModal(false);
                  setSelectedBackupForRestore(null);
                  setUploadedFile(null);
                }}
                disabled={restoring}
                className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl text-xs font-semibold cursor-pointer"
              >
                {restoreSuccessReport ? 'Close' : 'Cancel'}
              </button>

              {!restoreSuccessReport && (
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={!restoreConfirmed || restoring}
                  className="px-5 py-2 bg-[#991B1B] hover:bg-[#7F1D1D] text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                >
                  {restoring ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Restoring...</span>
                    </>
                  ) : (
                    <span>Confirm &amp; Restore Database</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
