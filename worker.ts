import type { D1Database, ExecutionContext, Fetcher, ScheduledController } from '@cloudflare/workers-types';
import { createApiRouter } from './server/apiApp.ts';
import { handleWebRouterFetch } from './server/webRouter.ts';
import { runWithRuntimeEnv } from './server/runtimeEnv.ts';
import { runWithDbProvider, dbQueryOne } from './server/db.ts';
import { createD1DbProvider } from './server/dbD1.ts';
import { runWithBackupProvider } from './server/backupService.ts';
import { createD1BackupProvider } from './server/backupD1.ts';
import { verifyAuthSecretsConfigured } from './server/auth.ts';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AUTH_SECRET?: string;
  SESSION_SECRET?: string;
  NODE_ENV?: string;
}

const apiRouter = createApiRouter();

function buildEnvRecord(env: Env): Record<string, string | undefined> {
  return {
    NODE_ENV: env.NODE_ENV || 'production',
    AUTH_SECRET: env.AUTH_SECRET,
    SESSION_SECRET: env.SESSION_SECRET,
  };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const envRecord = buildEnvRecord(env);

      return runWithRuntimeEnv(envRecord, async () => {
        try {
          verifyAuthSecretsConfigured();
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: err?.message || 'Server authentication secrets not configured' }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        if (!env.DB) {
          return new Response(
            JSON.stringify({
              error:
                'Cloudflare D1 database binding "DB" is missing. Verify wrangler.jsonc and Cloudflare Worker D1 bindings.',
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        }

        const d1Provider = createD1DbProvider(env.DB);
        const backupProvider = createD1BackupProvider(env.DB);

        return runWithDbProvider(d1Provider, () =>
          runWithBackupProvider(backupProvider, () => handleWebRouterFetch(apiRouter, request))
        );
      });
    }

    return env.ASSETS.fetch(request as unknown as Parameters<Fetcher['fetch']>[0]) as unknown as Promise<Response>;
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.DB) {
      console.error('[Cron] Cloudflare D1 database binding "DB" is missing; skipping scheduled backup.');
      return;
    }

    const envRecord = buildEnvRecord(env);
    await runWithRuntimeEnv(envRecord, async () => {
      const d1Provider = createD1DbProvider(env.DB);
      const backupProvider = createD1BackupProvider(env.DB);

      await runWithDbProvider(d1Provider, () =>
        runWithBackupProvider(backupProvider, async () => {
          const userCountRow = await dbQueryOne<{ count: number }>(
            'SELECT COUNT(*) as count FROM users WHERE is_active = 1'
          );
          if (!userCountRow || Number(userCountRow.count) === 0) {
            console.log('[Cron] Store not initialized yet; skipping scheduled automatic backup.');
            return;
          }

          const settings = await backupProvider.getBackupSettings();
          if (!settings.auto_backup_enabled) {
            console.log('[Cron] Automatic backups are paused in settings; skipping.');
            return;
          }

          const res = await backupProvider.createBackup(
            'AUTOMATIC',
            'SYSTEM_CRON',
            'Cloudflare Cron Scheduler',
            'Automatic nightly D1 backup (22:00 IST / 16:30 UTC)'
          );
          if (!res.success) {
            console.error('[Cron] Scheduled automatic backup failed:', res.error);
          } else {
            console.log('[Cron] Scheduled automatic backup created:', res.backup?.filename);
          }
        })
      );
    });
  },
};
