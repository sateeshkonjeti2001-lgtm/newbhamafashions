import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { dbQueryOne, dbQueryAll, dbRun } from './db.ts';
import { logAudit } from './audit.ts';

const TOKEN_SECRET = process.env.AUTH_SECRET || 'bhama-fashions-secret-key-offline-2026';
const activeTokens = new Map<string, { userId: string; expiresAt: number }>();

export interface AuthUser {
  id: string;
  username: string;
  full_name: string;
  role: 'OWNER' | 'CASHIER';
  phone?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function generateToken(userId: string): string {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const payloadStr = `${userId}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('hex');
  const token = Buffer.from(`${payloadStr}:${hmac}`).toString('base64');
  activeTokens.set(token, {
    userId,
    expiresAt,
  });
  return token;
}

export function verifyToken(token: string): string | null {
  const session = activeTokens.get(token);
  if (session) {
    if (Date.now() > session.expiresAt) {
      activeTokens.delete(token);
      return null;
    }
    return session.userId;
  }

  // Fallback: Cryptographically verify signed HMAC token (survives dev server restarts)
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length >= 3) {
      const userId = parts[0];
      const expiresAt = Number(parts[1]);
      const sig = parts.slice(2).join(':');

      if (isNaN(expiresAt) || Date.now() > expiresAt) {
        return null;
      }

      const expectedHmac = crypto.createHmac('sha256', TOKEN_SECRET).update(`${userId}:${expiresAt}`).digest('hex');
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expectedHmac, 'hex');
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        activeTokens.set(token, { userId, expiresAt });
        return userId;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // 1. Check HTTP-only cookie first (preferred secure session mechanism)
  let token: string | undefined = (req as any).cookies?.nbf_session;

  // 2. Fallback to Authorization: Bearer <token> for backward compatibility / API tools
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const userId = verifyToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    return;
  }

  const user = dbQueryOne<AuthUser>(
    'SELECT id, username, full_name, role, phone FROM users WHERE id = ? AND is_active = 1',
    [userId]
  );

  if (!user) {
    res.status(401).json({ error: 'User account not found or inactive.' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(allowedRoles: ('OWNER' | 'CASHIER')[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Access denied: Your role does not have permission to access this resource or sensitive financial/supplier information.'
      });
      return;
    }

    next();
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
