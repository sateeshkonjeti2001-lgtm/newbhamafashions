import bcrypt from 'bcryptjs';
import { getTokenSecret } from './auth.ts';
import { getRuntimeEnv } from './runtimeEnv.ts';
import type { WebRequest, WebResponse, NextFunction, CookieOptions } from './webRouter.ts';
import {
  hmacSha256Hex,
  sha256Bytes,
  hexToBytes,
  randomHex,
  timingSafeEqualBytes,
  toBase64Url,
  fromBase64Url,
  verifyPbkdf2Hash,
} from './cryptoUtil.ts';

export const ENTRY_GATE_COOKIE_NAME = 'nbf_entry_gate';
const ENTRY_GATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Salted PBKDF2-SHA256 hash used only when ENTRY_PIN_HASH and ENTRY_PIN env vars are not set.
// Plaintext PIN is never stored in source code or sent to the client.
const DEFAULT_ENTRY_PIN_HASH =
  'pbkdf2_sha256:100000:6ca1de8c454682acef4f2407d2595434:db186d389af5be79460f6776e27a5b66e655368fd7524db32c72c9efbb27a88f';

async function verifyHashFormat(pin: string, hash: string): Promise<boolean> {
  if (hash.startsWith('pbkdf2_sha256:')) {
    return verifyPbkdf2Hash(pin, hash);
  }
  return bcrypt.compare(pin, hash);
}

export async function verifyEntryPin(submittedPin: string): Promise<boolean> {
  if (!submittedPin || !/^\d{4}$/.test(submittedPin)) {
    return false;
  }

  const configuredHash = getRuntimeEnv('ENTRY_PIN_HASH')?.trim();
  if (configuredHash) {
    return verifyHashFormat(submittedPin, configuredHash);
  }

  const configuredPin = getRuntimeEnv('ENTRY_PIN')?.trim();
  if (configuredPin) {
    const submittedDigest = await sha256Bytes(submittedPin);
    const expectedDigest = await sha256Bytes(configuredPin);
    return timingSafeEqualBytes(submittedDigest, expectedDigest);
  }

  return verifyPbkdf2Hash(submittedPin, DEFAULT_ENTRY_PIN_HASH);
}

export async function generateEntryGateToken(): Promise<string> {
  const nonce = randomHex(16);
  const expiresAt = Date.now() + ENTRY_GATE_TTL_MS;
  const payload = `gate:${nonce}:${expiresAt}`;
  const hmac = await hmacSha256Hex(getTokenSecret(), payload);
  return toBase64Url(`${payload}:${hmac}`);
}

export async function verifyEntryGateToken(token: string | undefined): Promise<boolean> {
  if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return false;
  }

  try {
    const decoded = fromBase64Url(token);
    if (!decoded || toBase64Url(decoded) !== token) {
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
    const expectedHmac = await hmacSha256Hex(getTokenSecret(), payload);

    if (!/^[a-f0-9]{64}$/.test(sig) || sig.length !== expectedHmac.length) {
      return false;
    }

    const sigBuf = hexToBytes(sig);
    const expBuf = hexToBytes(expectedHmac);

    if (!sigBuf || !expBuf) {
      return false;
    }
    return timingSafeEqualBytes(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function extractEntryGateToken(req: WebRequest): string | undefined {
  const cookieToken = req.cookies?.[ENTRY_GATE_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  const headerToken = req.get('x-entry-gate-token');
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }
  return undefined;
}

export function getEntryGateCookieOptions(req: WebRequest): CookieOptions {
  const isProd = getRuntimeEnv('NODE_ENV') === 'production';
  const isHttps = Boolean(req.secure || req.get('x-forwarded-proto') === 'https');
  const sameSite: CookieOptions['sameSite'] = isProd ? 'strict' : isHttps ? 'none' : 'lax';

  const options: CookieOptions = {
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

export async function entryGateMiddleware(
  req: WebRequest,
  res: WebResponse,
  next: NextFunction
): Promise<void> {
  const token = extractEntryGateToken(req);
  if (!(await verifyEntryGateToken(token))) {
    res.status(403).json({ error: 'Entry verification required' });
    return;
  }
  await next();
}
