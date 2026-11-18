import { WebRouter } from './webRouter.ts';
import { getDbEngine } from './db.ts';

import gateRoutes from './routes/gateRoutes.ts';
import authRoutes from './routes/authRoutes.ts';
import dashboardRoutes from './routes/dashboardRoutes.ts';
import productRoutes from './routes/productRoutes.ts';
import inventoryRoutes from './routes/inventoryRoutes.ts';
import posRoutes from './routes/posRoutes.ts';
import purchaseRoutes from './routes/purchaseRoutes.ts';
import moneyRoutes from './routes/moneyRoutes.ts';
import dueRoutes from './routes/dueRoutes.ts';
import staffRoutes from './routes/staffRoutes.ts';
import closingRoutes from './routes/closingRoutes.ts';
import assetLoanRoutes from './routes/assetLoanRoutes.ts';
import exportRoutes from './routes/exportRoutes.ts';
import auditRoutes from './routes/auditRoutes.ts';
import backupRoutes from './routes/backupRoutes.ts';
import reportRoutes from './routes/reportRoutes.ts';

export function createApiRouter(): WebRouter {
  const api = new WebRouter();

  api.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      store: 'New Bhama Fashions',
      system: 'Offline Retail ERP',
      engine: getDbEngine(),
    });
  });

  api.use('/api/gate', gateRoutes);
  api.use('/api/auth', authRoutes);
  api.use('/api/dashboard', dashboardRoutes);
  api.use('/api/products', productRoutes);
  api.use('/api/inventory', inventoryRoutes);
  api.use('/api/pos', posRoutes);
  api.use('/api/purchases', purchaseRoutes);
  api.use('/api/money', moneyRoutes);
  api.use('/api/dues', dueRoutes);
  api.use('/api/staff', staffRoutes);
  api.use('/api/closing', closingRoutes);
  api.use('/api/assets-loans', assetLoanRoutes);
  api.use('/api/export', exportRoutes);
  api.use('/api/audit', auditRoutes);
  api.use('/api/backup', backupRoutes);
  api.use('/api/reports', reportRoutes);

  // Catch-all 404 for unhandled API routes so they NEVER fall through to SPA HTML fallback
  api.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl || req.path}`,
    });
  });

  return api;
}
