import type { Request, Response, NextFunction, CookieOptions } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getTokenSecret } from './auth.ts';

export const ENTRY_GATE_COOKIE_NAME = 'nbf_entry_gate';
const ENTRY_GATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Salted bcrypt hash used only when ENTRY_PIN_HASH and ENTRY_PIN env vars are not set.
// Plaintext PIN is never stored in source code or sent to the client.
const DEFAULT_ENTRY_PIN_HASH = '$2b$10$9hQ/qflNMlwRIe4WflpKlOwWhyglSZZHn0PZL36FAHDw8SkvnX4.S';

export async function verifyEntryPin(submittedPin: string): Promise<boolean> {
  if (!submittedPin || !/^\d{4}$/.test(submittedPin)) {
    return false;
  }

  const configuredHash = process.env.ENTRY_PIN_HASH?.trim();
  if (configuredHash) {
    return bcrypt.compare(submittedPin, configuredHash);
  }

  const configuredPin = process.env.ENTRY_PIN?.trim();
  if (configuredPin) {
    const submittedDigest = crypto.createHash('sha256').update(submittedPin).digest();
    const expectedDigest = crypto.createHash('sha256').update(configuredPin).digest();
    return crypto.timingSafeEqual(submittedDigest, expectedDigest);
  }

  return bcrypt.compare(submittedPin, DEFAULT_ENTRY_PIN_HASH);
}

export function generateEntryGateToken(): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + ENTRY_GATE_TTL_MS;
  const payload = `gate:${nonce}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`, 'utf-8').toString('base64url');
}

export function verifyEntryGateToken(token: string | undefined): boolean {
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return false;
  }

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    if (Buffer.from(decoded, 'utf-8').toString('base64url') !== token) {
      return false;
    }

    const parts = decoded.split(':');
    if (parts.length !== 4 || parts[0] !== 'gate') {
      return false;
    }

    const nonce = parts[1];
    const expiresAt = Number(parts[2]);
    const sig = parts[3];

    if (!nonce || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return false;
    }

    const payload = `gate:${nonce}:${expiresAt}`;
    const expectedHmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');

    if (!/^[a-f0-9]{64}$/.test(sig) || sig.length !== expectedHmac.length) {
      return false;
    }

    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedHmac, 'hex');

    if (sigBuf.length !== expBuf.length || sigBuf.length === 0) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function extractEntryGateToken(req: Request): string | undefined {
  const cookieToken = (req as any).cookies?.[ENTRY_GATE_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  const headerToken = req.get('x-entry-gate-token');
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }
  return undefined;
}

export function getEntryGateCookieOptions(req: Request): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  const isHttps = Boolean(req.secure || req.get('x-forwarded-proto') === 'https');
  const sameSite: CookieOptions['sameSite'] = isProd ? 'strict' : isHttps ? 'none' : 'lax';

  const options: CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    secure: isProd ? true : isHttps,
    sameSite,
    maxAge: ENTRY_GATE_TTL_MS,
    path: '/',
  };

  if (sameSite === 'none') {
    options.partitioned = true;
  }

  return options;
}

export function entryGateMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = extractEntryGateToken(req);
  if (!verifyEntryGateToken(token)) {
    res.status(403).json({ error: 'Entry verification required' });
    return;
  }
  next();
}
