import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import { saveDb } from './server/db.ts';
import { initNodeDatabase } from './server/dbNode.ts';
import { registerNodeBackupProvider } from './server/backupNode.ts';
import { verifyAuthSecretsConfigured } from './server/auth.ts';
import { createApiRouter } from './server/apiApp.ts';
import { handleWebRouterFetch } from './server/webRouter.ts';
import { startBackupScheduler, stopBackupScheduler } from './server/backupScheduler.ts';

function readRawRequestBody(req: express.Request): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function startServer() {
  verifyAuthSecretsConfigured();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust proxy: Cloud Run and reverse proxies forward client IP in X-Forwarded-For
  app.set('trust proxy', 1);

  // Initialize local Node SQLite database & backup provider
  await initNodeDatabase();
  registerNodeBackupProvider();
  console.log('✅ SQLite Database initialized successfully.');

  // Initialize persistent automatic backup scheduler
  startBackupScheduler();

  // Security Headers via Helmet (HSTS, X-Content-Type-Options, Frameguard)
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Vite and embedded assets
      crossOriginEmbedderPolicy: false,
    })
  );

  // Unified API Router bridge (identical routing/auth/gate behavior to Cloudflare Worker)
  const apiRouter = createApiRouter();

  const handleApiBridge = async (req: express.Request, res: express.Response) => {
    try {
      const protocol = req.protocol || 'http';
      const host = req.get('host') || `127.0.0.1:${PORT}`;
      const targetUrl = `${protocol}://${host}${req.originalUrl || req.url}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, String(value));
        }
      }
      if (!headers.has('x-forwarded-proto') && req.protocol) {
        headers.set('x-forwarded-proto', req.protocol);
      }
      if (!headers.has('x-forwarded-for') && req.ip) {
        headers.set('x-forwarded-for', req.ip);
      }

      const method = req.method.toUpperCase();
      let body: BodyInit | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const rawBytes = await readRawRequestBody(req);
        if (rawBytes.byteLength > 0) {
          body = rawBytes as unknown as BodyInit;
        }
      }

      const webReq = new Request(targetUrl, {
        method,
        headers,
        body,
      });

      const webRes = await handleWebRouterFetch(apiRouter, webReq);

      res.status(webRes.status);

      const getSetCookie = (webRes.headers as any).getSetCookie;
      const setCookies: string[] = typeof getSetCookie === 'function' ? getSetCookie.call(webRes.headers) : [];

      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });

      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies);
      } else {
        const fallbackCookie = webRes.headers.get('set-cookie');
        if (fallbackCookie) {
          res.setHeader('Set-Cookie', fallbackCookie);
        }
      }

      const buf = Buffer.from(await webRes.arrayBuffer());
      res.send(buf);
    } catch (err: any) {
      console.error('Unhandled API Bridge Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || 'Internal server error' });
      }
    }
  };

  app.use('/api', handleApiBridge);

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
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown on container termination (SIGTERM)
  const shutdown = (signal: string) => {
    console.log(`🛑 Received ${signal}. Flushing database and shutting down gracefully...`);
    stopBackupScheduler();
    try {
      saveDb(true);
      console.log('💾 Database flushed to disk successfully.');
    } catch (saveErr) {
      console.error('Error flushing database on shutdown:', saveErr);
    }
    server.close(() => {
      console.log('👋 HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 8 seconds
    setTimeout(() => {
      console.error('⚠️ Forcing process exit after timeout.');
      process.exit(1);
    }, 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
