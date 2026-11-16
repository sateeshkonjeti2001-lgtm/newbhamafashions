import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  ENTRY_GATE_COOKIE_NAME,
  verifyEntryPin,
  generateEntryGateToken,
  verifyEntryGateToken,
  extractEntryGateToken,
  getEntryGateCookieOptions,
} from '../gate.ts';

const router = Router();

// Rate-limit failed PIN attempts (max 10 incorrect attempts per 15 minutes per IP)
const gateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { verified: false },
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false,
    trustProxy: false,
  },
});

// Check whether the current browser has a valid server-signed entry-gate cookie or token
router.get('/status', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = extractEntryGateToken(req);
  const verified = verifyEntryGateToken(token);
  res.json({ verified });
});

// Verify 4-digit entry PIN on server and issue HttpOnly cookie + signed token on success
router.post('/verify', gateLimiter, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const submittedPin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const isValid = await verifyEntryPin(submittedPin);

    if (!isValid) {
      res.status(401).json({ verified: false });
      return;
    }

    const gateToken = generateEntryGateToken();
    res.cookie(ENTRY_GATE_COOKIE_NAME, gateToken, getEntryGateCookieOptions(req));
    res.json({ verified: true, gateToken });
  } catch {
    res.status(500).json({ verified: false });
  }
});

export default router;
