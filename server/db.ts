import { AsyncLocalStorage } from 'node:async_hooks';

export interface DbProvider {
  engine: 'sqlite-node' | 'cloudflare-d1';
  queryAll<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  run(sql: string, params?: any[]): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  save?(force?: boolean): void;
  exportBuffer?(): Promise<Uint8Array>;
  reloadFromBuffer?(buf: Uint8Array): Promise<{ success: boolean; error?: string }>;
  getStats(): Promise<Record<string, number>>;
  getDatabaseFileSize?(): Promise<{ sizeBytes: number; walSizeBytes: number; lastModifiedAt: string | null }>;
}

const providerStorage = new AsyncLocalStorage<DbProvider>();
let defaultProvider: DbProvider | null = null;

export function registerDbProvider(provider: DbProvider): void {
  defaultProvider = provider;
}

export function runWithDbProvider<T>(provider: DbProvider, fn: () => Promise<T>): Promise<T> {
  return providerStorage.run(provider, fn);
}

export function getActiveDbProvider(): DbProvider {
  const active = providerStorage.getStore() || defaultProvider;
  if (!active) {
    throw new Error('Database provider not initialized');
  }
  return active;
}

export function getDbEngine(): 'sqlite-node' | 'cloudflare-d1' {
  return getActiveDbProvider().engine;
}

export async function dbQueryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return getActiveDbProvider().queryAll<T>(sql, params);
}

export async function dbQueryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  return getActiveDbProvider().queryOne<T>(sql, params);
}

export async function dbRun(sql: string, params: any[] = []): Promise<void> {
  return getActiveDbProvider().run(sql, params);
}

export async function dbTransaction<T>(callback: () => Promise<T>): Promise<T> {
  return getActiveDbProvider().transaction(callback);
}

export function saveDb(force: boolean = false): void {
  const provider = providerStorage.getStore() || defaultProvider;
  provider?.save?.(force);
}

export async function exportDatabaseBuffer(): Promise<Uint8Array> {
  const provider = getActiveDbProvider();
  if (!provider.exportBuffer) {
    throw new Error('Binary SQLite export is not available on this database engine');
  }
  return provider.exportBuffer();
}

export async function reloadDatabaseFromBuffer(
  newBuffer: Uint8Array
): Promise<{ success: boolean; error?: string }> {
  const provider = getActiveDbProvider();
  if (!provider.reloadFromBuffer) {
    return {
      success: false,
      error: 'Binary SQLite buffer restore is only supported in standalone SQLite mode.',
    };
  }
  return provider.reloadFromBuffer(newBuffer);
}

export async function getDatabaseStats(): Promise<Record<string, number>> {
  return getActiveDbProvider().getStats();
}

export async function getDatabaseFileMetrics(): Promise<{
  sizeBytes: number;
  walSizeBytes: number;
  lastModifiedAt: string | null;
}> {
  const provider = getActiveDbProvider();
  if (provider.getDatabaseFileSize) {
    return provider.getDatabaseFileSize();
  }
  return { sizeBytes: 0, walSizeBytes: 0, lastModifiedAt: null };
}
