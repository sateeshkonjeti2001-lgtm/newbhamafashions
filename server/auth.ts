import bcrypt from 'bcryptjs';
import { dbQueryOne, dbRun } from './db.ts';
import { getRuntimeEnv } from './runtimeEnv.ts';
import type { WebRequest, WebResponse, NextFunction } from './webRouter.ts';
import {
  hmacSha256Hex,
  sha256Hex,
  hexToBytes,
  timingSafeEqualBytes,
  toBase64,
  fromBase64,
  pbkdf2Hash,
  verifyPbkdf2Hash,
} from './cryptoUtil.ts';

export function verifyAuthSecretsConfigured(): void {
  if (getRuntimeEnv('NODE_ENV') === 'production') {
    const authSecret = getRuntimeEnv('AUTH_SECRET');
    const sessionSecret = getRuntimeEnv('SESSION_SECRET');
    if (!authSecret || authSecret.length < 16) {
      throw new Error('CRITICAL SECURITY ERROR: AUTH_SECRET environment variable must be set (min 16 chars) in production.');
    }
    if (!sessionSecret || sessionSecret.length < 16) {
      throw new Error('CRITICAL SECURITY ERROR: SESSION_SECRET environment variable must be set (min 16 chars) in production.');
    }
  }
}

export function getTokenSecret(): string {
  const secret = getRuntimeEnv('AUTH_SECRET');
  if (secret) return secret;
  if (getRuntimeEnv('NODE_ENV') === 'production') {
    throw new Error('CRITICAL SECURITY ERROR: AUTH_SECRET environment variable is required in production.');
  }
  return 'bhama-fashions-dev-local-ephemeral-secret';
}

const activeTokens = new Map<string, { userId: string; expiresAt: number }>();

export interface AuthUser {
  id: string;
  username: string;
  full_name: string;
  role: 'OWNER' | 'CASHIER';
  phone?: string;
}

export interface AuthenticatedRequest extends WebRequest {
  user?: AuthUser;
}

async function parseVerifiedToken(
  token: string
): Promise<{ userId: string; expiresAt: number } | null> {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = fromBase64(token);
    if (!decoded) return null;
    const parts = decoded.split(':');
    if (parts.length < 3) return null;

    const userId = parts[0];
    const expiresAt = Number(parts[1]);
    const sig = parts.slice(2).join(':');

    if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return null;
    }
    if (!/^[a-f0-9]{64}$/.test(sig)) {
      return null;
    }

    const expectedHmac = await hmacSha256Hex(getTokenSecret(), `${userId}:${expiresAt}`);
    const sigBuf = hexToBytes(sig);
    const expBuf = hexToBytes(expectedHmac);
    if (sigBuf && expBuf && timingSafeEqualBytes(sigBuf, expBuf)) {
      return { userId, expiresAt };
    }
  } catch {
    return null;
  }
  return null;
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const tokenHash = await sha256Hex(token);
    const row = await dbQueryOne<{ token_hash: string }>(
      'SELECT token_hash FROM revoked_tokens WHERE token_hash = ?',
      [tokenHash]
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function revokeToken(
  token: string,
  knownUserId?: string | null
): Promise<string | null> {
  if (!token) return knownUserId || null;
  activeTokens.delete(token);

  const parsed = await parseVerifiedToken(token);
  const userId = parsed?.userId || knownUserId || null;
  const expiresAt = parsed?.expiresAt || Date.now() + 24 * 60 * 60 * 1000;
  const nowIso = new Date().toISOString();

  try {
    const tokenHash = await sha256Hex(token);
    await dbRun(
      'INSERT OR REPLACE INTO revoked_tokens (token_hash, user_id, expires_at, revoked_at) VALUES (?, ?, ?, ?)',
      [tokenHash, userId, expiresAt, nowIso]
    );
    // Prune expired revocation records
    await dbRun('DELETE FROM revoked_tokens WHERE expires_at < ?', [Date.now()]);
  } catch (err) {
    console.error('Failed to persist token revocation:', err);
  }

  return userId;
}

export async function generateToken(userId: string): Promise<string> {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const payloadStr = `${userId}:${expiresAt}`;
  const hmac = await hmacSha256Hex(getTokenSecret(), payloadStr);
  const token = toBase64(`${payloadStr}:${hmac}`);
  activeTokens.set(token, {
    userId,
    expiresAt,
  });
  return token;
}

export async function verifyToken(token: string): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;

  let userId: string | null = null;
  let expiresAt = 0;

  const session = activeTokens.get(token);
  if (session) {
    if (Date.now() > session.expiresAt) {
      activeTokens.delete(token);
      return null;
    }
    userId = session.userId;
    expiresAt = session.expiresAt;
  } else {
    const parsed = await parseVerifiedToken(token);
    if (!parsed) return null;
    userId = parsed.userId;
    expiresAt = parsed.expiresAt;
  }

  // Always check persistent server-side revocation table (survives restarts and multi-isolate Workers)
  if (await isTokenRevoked(token)) {
    activeTokens.delete(token);
    return null;
  }

  activeTokens.set(token, { userId, expiresAt });
  return userId;
}

export function extractAuthTokens(req: WebRequest): {
  cookieToken?: string;
  bearerToken?: string;
  primaryToken?: string;
} {
  const cookieToken =
    typeof req.cookies?.nbf_session === 'string' && req.cookies.nbf_session.length > 0
      ? req.cookies.nbf_session
      : undefined;

  const authHeader = req.get('authorization');
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 7
      ? authHeader.substring(7).trim()
      : undefined;

  return {
    cookieToken,
    bearerToken,
    primaryToken: cookieToken || bearerToken,
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: WebResponse,
  next: NextFunction
): Promise<void> {
  const { primaryToken: token } = extractAuthTokens(req);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userId = await verifyToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    return;
  }

  const user = await dbQueryOne<AuthUser>(
    'SELECT id, username, full_name, role, phone FROM users WHERE id = ? AND is_active = 1',
    [userId]
  );

  if (!user) {
    res.status(401).json({ error: 'User account not found or inactive.' });
    return;
  }

  req.user = user;
  await next();
}

export function requireRole(allowedRoles: ('OWNER' | 'CASHIER')[]) {
  return async (req: AuthenticatedRequest, res: WebResponse, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Access denied: Your role does not have permission to access this resource or sensitive financial/supplier information.',
      });
      return;
    }

    await next();
  };
}

export async function hashPassword(password: string): Promise<string> {
  // WebCrypto PBKDF2-SHA256 executes in native BoringSSL (<2ms CPU on Cloudflare Workers Free plan)
  return pbkdf2Hash(password, 100000);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  if (hash.startsWith('pbkdf2_sha256:')) {
    return verifyPbkdf2Hash(password, hash);
  }
  return bcrypt.compare(password, hash);
}
