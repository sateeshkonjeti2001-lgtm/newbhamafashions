import { AsyncLocalStorage } from 'node:async_hooks';

type EnvMap = Record<string, string | undefined>;

const envStorage = new AsyncLocalStorage<EnvMap>();

export function runWithRuntimeEnv<T>(env: EnvMap, fn: () => Promise<T>): Promise<T> {
  return envStorage.run(env, fn);
}

export function getRuntimeEnv(key: string): string | undefined {
  const store = envStorage.getStore();
  if (store && key in store && store[key] !== undefined) {
    return store[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }
  return undefined;
}
