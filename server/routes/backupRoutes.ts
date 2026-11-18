import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { getDbEngine } from '../db.ts';
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
  getBackupDownloadPayload,
  getLiveDatabaseInfo,
  exportVerifiedLiveDatabase,
  getDataSafetyStatus,
} from '../backupService.ts';
import { rescheduleBackup } from '../backupScheduler.ts';

const router = new Router();

// Protect all backup and restore endpoints: Owner only
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

// 1. Health Status & Overview
router.get('/health', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const health = await getBackupHealth();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1b. Real-Time Data Safety & Replication Monitor
router.get('/data-safety', async (_req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await getDataSafetyStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Backup History
router.get('/history', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await getBackupHistory();
    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Settings (Schedule & Retention)
router.get('/settings', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await getBackupSettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await updateBackupSettings(req.body, req.user?.id);
    if (getDbEngine() === 'sqlite-node') {
      await rescheduleBackup();
    }
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
router.get('/download/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const payload = await getBackupDownloadPayload(id, req.user?.id);
    if (!payload) {
      res.status(404).json({ error: 'Backup not found or payload unavailable' });
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
    res.setHeader('Content-Type', payload.contentType);
    res.setHeader('Content-Length', String(payload.size));
    res.setHeader('Cache-Control', 'no-store');
    res.send(payload.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7b. Get Live Database Info (size, tables, records)
router.get('/live-info', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const info = await getLiveDatabaseInfo();
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7c. Direct Manual Download of Live Database
router.get('/download-live', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await exportVerifiedLiveDatabase(req.user?.id, req.user?.full_name);

    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.size));
    res.setHeader('X-Backup-Checksum', result.sha256);
    res.setHeader('X-Database-Size', String(result.size));
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to export verified database' });
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
      res.status(result.validationError ? 400 : 500).json({
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
    if (!fileData || typeof fileData !== 'string') {
      res.status(400).json({ error: 'No file data received' });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const cleanB64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const binary = atob(cleanB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (bytes.byteLength < 100) {
      res.status(400).json({ error: 'Uploaded file is too small to be a valid database backup' });
      return;
    }

    const result = await restoreDatabase(
      bytes,
      req.user.id,
      req.user.full_name,
      filename || 'uploaded_backup.sql'
    );
    if (!result.success) {
      res.status(result.validationError ? 400 : 500).json({
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
router.post('/toggle-lock/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const result = await toggleBackupLock(id, req.user.id);
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
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const result = await deleteBackup(id, req.user.id);
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
