import { Router, Response } from 'express';
import fs from 'fs';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import {
  getBackupHealth,
  getBackupHistory,
  getBackupSettings,
  updateBackupSettings,
  createBackup,
  verifyBackup,
  testRestoreBackup,
  restoreDatabase,
  deleteBackup,
  toggleBackupLock,
  getBackupById,
  getLiveDatabaseInfo,
  exportVerifiedLiveDatabase,
  getDataSafetyStatus,
} from '../backupService.ts';
import { rescheduleBackup } from '../backupScheduler.ts';
import { logAudit } from '../audit.ts';

const router = Router();

// Protect all backup and restore endpoints: Owner only
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

// 1. Health Status & Overview
router.get('/health', (req: AuthenticatedRequest, res: Response) => {
  try {
    const health = getBackupHealth();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1b. Real-Time Data Safety & Litestream Monitor
router.get('/data-safety', async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await getDataSafetyStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Backup History
router.get('/history', (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = getBackupHistory();
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Settings (Schedule & Retention)
router.get('/settings', (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = getBackupSettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = updateBackupSettings(req.body, req.user?.id);
    rescheduleBackup();
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Create Manual Backup
router.post('/create', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const notes = req.body.notes || 'Manual backup initiated by Store Owner';
    const result = await createBackup('MANUAL', req.user?.id, req.user?.full_name, notes);
    if (!result.success) {
      res.status(500).json({ error: result.error || 'Backup creation failed' });
      return;
    }
    res.json({ success: true, backup: result.backup });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Verify Backup
router.post('/verify/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await verifyBackup(id, req.user?.id);
    if (!result.success) {
      res.status(400).json({ error: result.error || 'Verification failed' });
      return;
    }
    res.json({ success: true, details: result.details });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Isolated Dry-Run Restore Test
router.post('/test-restore/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await testRestoreBackup(id, req.user?.id);
    if (!result.success) {
      res.status(400).json({ error: result.error || 'Dry-run restore test failed' });
      return;
    }
    res.json({ success: true, report: result.report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Download Backup File
router.get('/download/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const record = getBackupById(id);
    if (!record) {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }
    if (!record.filepath || !fs.existsSync(record.filepath)) {
      res.status(404).json({ error: 'Backup file missing on disk' });
      return;
    }

    logAudit(req.user?.id || 'SYSTEM', 'DOWNLOAD_BACKUP', 'BACKUP', id, {
      filename: record.filename,
      size: record.file_size,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(record.filepath);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7b. Get Live Database Info (size, tables, records)
router.get('/live-info', (req: AuthenticatedRequest, res: Response) => {
  try {
    const info = getLiveDatabaseInfo();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7c. Direct Manual Download of Live SQLite Database
router.get('/download-live', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await exportVerifiedLiveDatabase(req.user?.id, req.user?.full_name);

    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Length', String(result.size));
    res.setHeader('X-Backup-Checksum', result.sha256);
    res.setHeader('X-Database-Size', String(result.size));
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to export verified SQLite database' });
  }
});

// 8. Restore from Existing Archive
router.post('/restore/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const result = await restoreDatabase(id, req.user.id, req.user.full_name);
    if (!result.success) {
      res.status(500).json({
        error: result.error,
        preRestoreBackupId: result.preRestoreBackupId,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Database restored successfully to specified recovery point.',
      preRestoreBackupId: result.preRestoreBackupId,
      restoredSummary: result.restoredSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Upload and Restore File
router.post('/upload-restore', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { filename, fileData } = req.body;
    if (!fileData) {
      res.status(400).json({ error: 'No file data received' });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const buffer = Buffer.from(fileData, 'base64');
    if (buffer.length < 100) {
      res.status(400).json({ error: 'Uploaded file is too small to be a valid SQLite database' });
      return;
    }

    const result = await restoreDatabase(buffer, req.user.id, req.user.full_name, filename || 'uploaded_backup.sqlite');
    if (!result.success) {
      res.status(500).json({
        error: result.error,
        preRestoreBackupId: result.preRestoreBackupId,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Uploaded backup file restored successfully. Live database recovered.',
      preRestoreBackupId: result.preRestoreBackupId,
      restoredSummary: result.restoredSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Toggle Lock Status
router.post('/toggle-lock/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const result = toggleBackupLock(id, req.user.id);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true, is_locked: result.is_locked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Delete Backup
router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const result = deleteBackup(id, req.user.id);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
