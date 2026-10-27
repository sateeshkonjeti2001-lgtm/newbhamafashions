import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db.ts';

import authRoutes from './server/routes/authRoutes.ts';
import dashboardRoutes from './server/routes/dashboardRoutes.ts';
import productRoutes from './server/routes/productRoutes.ts';
import inventoryRoutes from './server/routes/inventoryRoutes.ts';
import posRoutes from './server/routes/posRoutes.ts';
import purchaseRoutes from './server/routes/purchaseRoutes.ts';
import moneyRoutes from './server/routes/moneyRoutes.ts';
import dueRoutes from './server/routes/dueRoutes.ts';
import staffRoutes from './server/routes/staffRoutes.ts';
import closingRoutes from './server/routes/closingRoutes.ts';
import assetLoanRoutes from './server/routes/assetLoanRoutes.ts';
import exportRoutes from './server/routes/exportRoutes.ts';
import auditRoutes from './server/routes/auditRoutes.ts';
import backupRoutes from './server/routes/backupRoutes.ts';
import reportRoutes from './server/routes/reportRoutes.ts';
import { startBackupScheduler } from './server/backupScheduler.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Initialize SQLite database
  await getDb();
  console.log('✅ SQLite Database initialized successfully.');

  // Initialize persistent automatic backup scheduler
  startBackupScheduler();

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', store: 'New Bhama Fashions', system: 'Offline Retail ERP' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/pos', posRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/money', moneyRoutes);
  app.use('/api/dues', dueRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/closing', closingRoutes);
  app.use('/api/assets-loans', assetLoanRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/reports', reportRoutes);

  // Catch-all 404 for unhandled API routes so they NEVER fall through to Vite SPA HTML fallback
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl || req.path}` });
  });

  // Global error handler for API routes ensuring JSON responses
  app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
