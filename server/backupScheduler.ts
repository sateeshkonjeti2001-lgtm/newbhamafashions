import {
  getBackupSettings,
  createBackup,
  calculateNextScheduledTime,
} from './backupService.ts';

let schedulerTimer: NodeJS.Timeout | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000; // 15 minutes

export function startBackupScheduler() {
  console.log('⏰ [Backup Scheduler] Initializing persistent automatic backup service...');
  rescheduleBackup();
}

export function stopBackupScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

export function rescheduleBackup() {
  stopBackupScheduler();

  const settings = getBackupSettings();
  if (!settings.auto_backup_enabled) {
    console.log('⏸️ [Backup Scheduler] Automatic backups currently disabled by store owner.');
    return;
  }

  const { nextIso, nextDisplay, msUntilNext } = calculateNextScheduledTime(settings.schedule_time_ist);
  console.log(`⏳ [Backup Scheduler] Next automatic backup scheduled for: ${nextDisplay} (${nextIso}) [in ${Math.round(msUntilNext / 60000)} minutes]`);

  // Node setTimeout max is 2147483647 ms (~24.8 days). Daily timer is ~86400000 ms, safely within range.
  schedulerTimer = setTimeout(async () => {
    await executeScheduledBackup();
  }, msUntilNext);
}

async function executeScheduledBackup() {
  const settings = getBackupSettings();
  if (!settings.auto_backup_enabled) {
    rescheduleBackup();
    return;
  }

  console.log('🚀 [Backup Scheduler] Executing scheduled automatic database backup...');
  try {
    const result = await createBackup(
      'AUTOMATIC',
      'SYSTEM_SCHEDULER',
      'Automatic System Scheduler',
      `Scheduled nightly backup at ${settings.schedule_time_ist} IST`
    );

    if (result.success && result.backup) {
      console.log(`✅ [Backup Scheduler] Automatic backup completed successfully: ${result.backup.filename} (${(result.backup.file_size / 1024).toFixed(1)} KB)`);
      retryCount = 0;
    } else {
      throw new Error(result.error || 'Unknown backup failure');
    }
  } catch (err: any) {
    console.error('❌ [Backup Scheduler] Automatic backup failed:', err.message);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`🔁 [Backup Scheduler] Scheduling safe retry ${retryCount}/${MAX_RETRIES} in 15 minutes...`);
      schedulerTimer = setTimeout(async () => {
        await executeScheduledBackup();
      }, RETRY_DELAY_MS);
      return;
    } else {
      console.error(`⚠️ [Backup Scheduler] Reached maximum retries (${MAX_RETRIES}). Will resume normal daily schedule tomorrow.`);
      retryCount = 0;
    }
  }

  // Reschedule for next day
  rescheduleBackup();
}
