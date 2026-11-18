import { AsyncLocalStorage } from 'node:async_hooks';

export interface BackupRecord {
  id: string;
  filename: string;
  filepath: string;
  backup_type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
  file_size: number;
  checksum_sha256: string;
  schema_version: string;
  status: 'SUCCESS' | 'FAILED';
  verification_status: 'VERIFIED' | 'FAILED' | 'UNCHECKED';
  verification_details?: string | null;
  table_counts?: Record<string, number> | null;
  error_message?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  notes?: string | null;
  is_locked: number;
  created_at: string;
}

export interface BackupSettings {
  auto_backup_enabled: boolean;
  schedule_time_ist: string; // e.g. "22:00" (10:00 PM IST)
  retention_daily_count: number; // default 14
  retention_weekly_count: number; // default 8
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error_message?: string | null;
  last_restore_test_at?: string | null;
  last_restore_test_result?: string | null;
}

export interface DataSafetyStatus {
  checkedAt: string;
  engine?: 'sqlite-node' | 'cloudflare-d1';
  database: {
    filename: string;
    filepath: string;
    sizeBytes: number;
    walSizeBytes: number;
    lastModifiedAt: string | null;
    totalTables: number;
    totalRecords: number;
  };
  litestream: {
    configured: boolean;
    gcsBucket: string | null;
    replicaPath: string | null;
    binaryInstalled: boolean;
    configPath: string | null;
    retention: string | null;
    processRunning: boolean;
    shadowDirPresent: boolean;
    shadowLastUpdatedAt: string | null;
    latestSnapshotAt: string | null;
    latestGeneration: string | null;
    status: 'REPLICATING' | 'DEGRADED' | 'STANDALONE_LOCAL' | 'D1_CLOUDFLARE';
    statusLabel: string;
    statusDetail: string;
  };
  backup: {
    healthStatus: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED';
    lastSuccessfulBackupAt: string | null;
    lastSuccessfulBackup: {
      id: string;
      filename: string;
      backup_type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
      file_size: number;
      verification_status: 'VERIFIED' | 'FAILED' | 'UNCHECKED';
      checksum_sha256: string;
      created_at: string;
    } | null;
    lastAttemptAt: string | null;
    lastErrorMessage: string | null;
    autoBackupEnabled: boolean;
    nextScheduledBackupDisplay: string;
    totalValidBackups: number;
    totalStorageBytes: number;
    lastRestoreTestAt: string | null;
    lastRestoreTestResult: string | null;
  };
}

export interface BackupHealthSummary {
  engine?: 'sqlite-node' | 'cloudflare-d1';
  status: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED';
  lastSuccessfulBackup: BackupRecord | null;
  lastAttemptedBackup: BackupRecord | null;
  nextScheduledBackupIso: string | null;
  nextScheduledBackupDisplay: string | null;
  autoBackupEnabled: boolean;
  totalValidBackups: number;
  totalStorageBytes: number;
  latestVerificationResult: string | null;
  lastRestoreTestResult: string | null;
  lastRestoreTestAt: string | null;
}

export interface BackupProvider {
  getBackupSettings(): Promise<BackupSettings>;
  updateBackupSettings(newSettings: Partial<BackupSettings>, userId?: string): Promise<BackupSettings>;
  createBackup(
    type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE',
    userId?: string,
    userFullName?: string,
    notes?: string
  ): Promise<{ success: boolean; backup?: BackupRecord; error?: string }>;
  verifyBackup(backupId: string, userId?: string): Promise<{ success: boolean; details?: string; error?: string }>;
  testRestoreBackup(backupId: string, userId?: string): Promise<{ success: boolean; report?: any; error?: string }>;
  restoreDatabase(
    backupIdOrBuffer: string | Uint8Array,
    userId: string,
    userFullName?: string,
    sourceFileName?: string
  ): Promise<{ success: boolean; preRestoreBackupId?: string; error?: string; validationError?: boolean; restoredSummary?: any }>;
  deleteBackup(backupId: string, userId: string): Promise<{ success: boolean; error?: string }>;
  toggleBackupLock(
    backupId: string,
    userId: string
  ): Promise<{ success: boolean; is_locked: boolean; error?: string }>;
  getBackupById(backupId: string): Promise<BackupRecord | null>;
  getBackupHistory(): Promise<BackupRecord[]>;
  getBackupHealth(): Promise<BackupHealthSummary>;
  getBackupDownloadPayload(
    backupId: string,
    userId?: string
  ): Promise<{ data: Uint8Array; filename: string; contentType: string; size: number } | null>;
  getLiveDatabaseInfo(): Promise<{
    filename: string;
    sizeBytes: number;
    totalTables: number;
    totalRecords: number;
    tableCounts: Record<string, number>;
    engine?: string;
    downloadExtension?: string;
  }>;
  exportVerifiedLiveDatabase(
    userId?: string,
    userFullName?: string
  ): Promise<{
    buffer: Uint8Array;
    filename: string;
    sha256: string;
    size: number;
    tableCounts: Record<string, number>;
    contentType: string;
  }>;
  getDataSafetyStatus(): Promise<DataSafetyStatus>;
}

const backupStorage = new AsyncLocalStorage<BackupProvider>();
let defaultBackupProvider: BackupProvider | null = null;

export function registerBackupProvider(provider: BackupProvider): void {
  defaultBackupProvider = provider;
}

export function runWithBackupProvider<T>(provider: BackupProvider, fn: () => Promise<T>): Promise<T> {
  return backupStorage.run(provider, fn);
}

function getProvider(): BackupProvider {
  const provider = backupStorage.getStore() || defaultBackupProvider;
  if (!provider) {
    throw new Error('Backup provider not initialized');
  }
  return provider;
}

export function calculateNextScheduledTime(scheduleTimeIst: string = '22:00'): {
  nextIso: string;
  nextDisplay: string;
  msUntilNext: number;
} {
  const [hourStr, minStr] = scheduleTimeIst.split(':');
  const schedHour = parseInt(hourStr || '22', 10);
  const schedMin = parseInt(minStr || '0', 10);

  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const nowIst = new Date(nowUtc + IST_OFFSET_MS);

  const year = nowIst.getUTCFullYear();
  const month = nowIst.getUTCMonth();
  const day = nowIst.getUTCDate();

  let targetIst = new Date(Date.UTC(year, month, day, schedHour, schedMin, 0));
  if (targetIst.getTime() <= nowIst.getTime()) {
    targetIst = new Date(Date.UTC(year, month, day + 1, schedHour, schedMin, 0));
  }

  const targetUtcMs = targetIst.getTime() - IST_OFFSET_MS;
  const msUntilNext = Math.max(0, targetUtcMs - nowUtc);
  const nextDate = new Date(targetUtcMs);

  const nextDisplay =
    nextDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' IST';

  return {
    nextIso: nextDate.toISOString(),
    nextDisplay,
    msUntilNext,
  };
}

export function getBackupSettings() {
  return getProvider().getBackupSettings();
}

export function updateBackupSettings(newSettings: Partial<BackupSettings>, userId?: string) {
  return getProvider().updateBackupSettings(newSettings, userId);
}

export function createBackup(
  type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE',
  userId?: string,
  userFullName?: string,
  notes?: string
) {
  return getProvider().createBackup(type, userId, userFullName, notes);
}

export function verifyBackup(backupId: string, userId?: string) {
  return getProvider().verifyBackup(backupId, userId);
}

export function testRestoreBackup(backupId: string, userId?: string) {
  return getProvider().testRestoreBackup(backupId, userId);
}

export function restoreDatabase(
  backupIdOrBuffer: string | Uint8Array,
  userId: string,
  userFullName?: string,
  sourceFileName?: string
) {
  return getProvider().restoreDatabase(backupIdOrBuffer, userId, userFullName, sourceFileName);
}

export function deleteBackup(backupId: string, userId: string) {
  return getProvider().deleteBackup(backupId, userId);
}

export function toggleBackupLock(backupId: string, userId: string) {
  return getProvider().toggleBackupLock(backupId, userId);
}

export function getBackupById(backupId: string) {
  return getProvider().getBackupById(backupId);
}

export function getBackupHistory() {
  return getProvider().getBackupHistory();
}

export function getBackupHealth() {
  return getProvider().getBackupHealth();
}

export function getBackupDownloadPayload(backupId: string, userId?: string) {
  return getProvider().getBackupDownloadPayload(backupId, userId);
}

export function getLiveDatabaseInfo() {
  return getProvider().getLiveDatabaseInfo();
}

export function exportVerifiedLiveDatabase(userId?: string, userFullName?: string) {
  return getProvider().exportVerifiedLiveDatabase(userId, userFullName);
}

export function getDataSafetyStatus() {
  return getProvider().getDataSafetyStatus();
}
