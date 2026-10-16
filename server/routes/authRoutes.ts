import { Router, Response } from 'express';
import { dbQueryOne, dbQueryAll, dbRun } from '../db.ts';
import { hashPassword, checkPassword, generateToken, authMiddleware, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();

// Check if store is initialized
router.get('/status', async (req, res) => {
  try {
    const userCountRow = dbQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const isInitialized = (userCountRow?.count || 0) > 0;
    const storeNameRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_name']);
    const storeLocationRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_location']);
    const storeTaglineRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_tagline']);
    const phone1Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_1']);
    const phone2Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_2']);
    const phone3Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_3']);

    const owner = dbQueryOne<{ id: string; username: string; full_name: string; phone: string }>(
      "SELECT id, username, full_name, phone FROM users WHERE role = 'OWNER' AND is_active = 1 ORDER BY created_at ASC"
    );

    res.json({
      initialized: isInitialized,
      storeName: storeNameRow?.value || 'New Bhama Fashions',
      storeLocation: storeLocationRow?.value || 'Chilakaluripet, Andhra Pradesh',
      storeTagline: storeTaglineRow?.value || 'Ladies Fashion Retail',
      contactPhone1: phone1Row?.value || '',
      contactPhone2: phone2Row?.value || '',
      contactPhone3: phone3Row?.value || '',
      owner: owner || null,
      owners: owner ? [owner] : [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Setup initial OWNER account (only allowed when 0 users exist)
// Configures one administrator account for New Bhama Fashions
router.post('/setup', async (req, res) => {
  try {
    const userCountRow = dbQueryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    if ((userCountRow?.count || 0) > 0) {
      res.status(400).json({ error: 'System is already initialized. Please login.' });
      return;
    }

    const {
      username,
      password,
      full_name,
      phone,
      contact_phone_1,
      contact_phone_2,
      contact_phone_3,
      store_name,
      store_location,
      store_tagline,
    } = req.body;

    const ownerUsername = (username || '').trim().toLowerCase();
    const ownerPassword = (password || '').trim();
    const ownerFullName = (full_name || '').trim();
    const ownerPhone = (phone || '').trim();

    if (!ownerFullName) {
      res.status(400).json({ error: 'Owner full name is required.' });
      return;
    }
    if (!ownerUsername) {
      res.status(400).json({ error: 'Owner username is required.' });
      return;
    }
    if (!ownerPassword) {
      res.status(400).json({ error: 'Owner password is required.' });
      return;
    }
    if (ownerPassword.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      return;
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(ownerPassword);
    const userId = 'usr_' + Date.now();

    // 1. Create the single Store Owner administrator account
    dbRun(
      'INSERT INTO users (id, username, password_hash, full_name, role, phone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [userId, ownerUsername, passwordHash, ownerFullName, 'OWNER', ownerPhone || null, now, now]
    );

    // 2. Save Store Details & Contact Numbers
    const finalStoreName = (store_name || 'New Bhama Fashions').trim();
    const finalStoreTagline = (store_tagline || 'Ladies Fashion Retail').trim();
    const finalStoreLocation = (store_location || 'Chilakaluripet, Andhra Pradesh').trim();

    const p1 = (contact_phone_1 || ownerPhone || '').trim();
    const p2 = (contact_phone_2 || '').trim();
    const p3 = (contact_phone_3 || '').trim();

    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_name', finalStoreName, now, userId
    ]);
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_tagline', finalStoreTagline, now, userId
    ]);
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_location', finalStoreLocation, now, userId
    ]);
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_1', p1, now, userId
    ]);
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_2', p2, now, userId
    ]);
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_3', p3, now, userId
    ]);

    logAudit(userId, 'SETUP_STORE', 'STORE', userId, {
      message: 'Initialized store with single owner administrator account',
      owner: ownerFullName,
      username: ownerUsername,
      store_name: finalStoreName,
      contact_phone: p1,
    });

    const token = generateToken(userId);
    res.json({
      success: true,
      token,
      user: {
        id: userId,
        username: ownerUsername,
        full_name: ownerFullName,
        role: 'OWNER',
        phone: ownerPhone || null
      },
      contacts: {
        phone1: p1,
        phone2: p2,
        phone3: p3
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Please enter both username and password' });
      return;
    }

    const user = dbQueryOne<any>(
      'SELECT id, username, password_hash, full_name, role, phone, is_active FROM users WHERE LOWER(username) = ?',
      [username.trim().toLowerCase()]
    );

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ error: 'This user account is deactivated. Contact store owner.' });
      return;
    }

    const isMatch = await checkPassword(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = generateToken(user.id);
    logAudit(user.id, 'USER_LOGIN', 'USER', user.id, { username: user.username });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get current session info
router.get('/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

// User management (OWNER only)
router.get('/users', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ error: 'Only store Owner can manage staff accounts' });
    return;
  }
  const users = dbQueryAll(
    'SELECT id, username, full_name, role, phone, is_active, created_at FROM users ORDER BY created_at ASC'
  );
  res.json({ users });
});

router.post('/users', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ error: 'Only store Owner can create user accounts' });
    return;
  }

  const { username, password, full_name, role, phone } = req.body;
  if (!username || !password || !full_name || !role) {
    res.status(400).json({ error: 'Username, password, full name, and role (OWNER or CASHIER) are required' });
    return;
  }

  if (role !== 'OWNER' && role !== 'CASHIER') {
    res.status(400).json({ error: 'Role must be OWNER or CASHIER' });
    return;
  }

  const existing = dbQueryOne('SELECT id FROM users WHERE LOWER(username) = ?', [username.trim().toLowerCase()]);
  if (existing) {
    res.status(400).json({ error: 'Username already taken. Please choose another.' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = 'usr_' + Date.now();
  const now = new Date().toISOString();

  dbRun(
    'INSERT INTO users (id, username, password_hash, full_name, role, phone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [userId, username.trim().toLowerCase(), passwordHash, full_name.trim(), role, phone?.trim() || null, now, now]
  );

  logAudit(req.user.id, 'CREATE_USER', 'USER', userId, { username, role, full_name });

  res.json({
    success: true,
    user: {
      id: userId,
      username: username.trim().toLowerCase(),
      full_name: full_name.trim(),
      role,
      phone: phone?.trim() || null,
      is_active: 1
    }
  });
});

// Update user details (OWNER only)
router.put('/users/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ error: 'Only store Owner can update user accounts' });
    return;
  }

  const { id } = req.params;
  const { full_name, phone, role, password, is_active } = req.body;

  const existing = dbQueryOne<any>('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Prevent removing the last active OWNER
  if (existing.role === 'OWNER' && (role === 'CASHIER' || is_active === 0)) {
    const ownerCount = dbQueryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = 1 AND id != ?",
      [id]
    );
    if ((ownerCount?.count || 0) < 1) {
      res.status(400).json({ error: 'Cannot deactivate or demote the only active Store Owner' });
      return;
    }
  }

  const now = new Date().toISOString();
  let newPasswordHash = existing.password_hash;
  if (password && password.trim()) {
    newPasswordHash = await hashPassword(password.trim());
  }

  dbRun(
    'UPDATE users SET full_name = ?, phone = ?, role = ?, password_hash = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [
      full_name ? full_name.trim() : existing.full_name,
      phone !== undefined ? (phone ? phone.trim() : null) : existing.phone,
      role || existing.role,
      newPasswordHash,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      now,
      id
    ]
  );

  logAudit(req.user.id, 'UPDATE_USER', 'USER', id, {
    full_name,
    role,
    is_active,
    password_changed: Boolean(password && password.trim()),
  });

  res.json({ success: true, message: 'User updated successfully' });
});

// Deactivate user
router.delete('/users/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ error: 'Only store Owner can deactivate user accounts' });
    return;
  }

  const { id } = req.params;
  if (id === req.user.id) {
    res.status(400).json({ error: 'You cannot deactivate your own currently active session account.' });
    return;
  }

  const existing = dbQueryOne<any>('SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (existing.role === 'OWNER') {
    const activeOwners = dbQueryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = 1 AND id != ?",
      [id]
    );
    if ((activeOwners?.count || 0) < 1) {
      res.status(400).json({ error: 'Cannot deactivate the sole active Store Owner' });
      return;
    }
  }

  const now = new Date().toISOString();
  dbRun('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', [now, id]);
  logAudit(req.user.id, 'DEACTIVATE_USER', 'USER', id, { username: existing.username });

  res.json({ success: true, message: 'User deactivated' });
});

// Store Profile & 3 Contact Numbers (GET)
router.get('/store-profile', async (req, res) => {
  try {
    const storeNameRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_name']);
    const storeLocationRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_location']);
    const storeTaglineRow = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['store_tagline']);
    const phone1Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_1']);
    const phone2Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_2']);
    const phone3Row = dbQueryOne<{ value: string }>('SELECT value FROM store_settings WHERE key = ?', ['contact_phone_3']);

    const owner = dbQueryOne<{ id: string; username: string; full_name: string; phone: string; is_active: number }>(
      "SELECT id, username, full_name, phone, is_active FROM users WHERE role = 'OWNER' ORDER BY created_at ASC"
    );

    res.json({
      store_name: storeNameRow?.value || 'New Bhama Fashions',
      store_location: storeLocationRow?.value || 'Chilakaluripet, Andhra Pradesh',
      store_tagline: storeTaglineRow?.value || 'Ladies Fashion Retail',
      contact_phone_1: phone1Row?.value || '',
      contact_phone_2: phone2Row?.value || '',
      contact_phone_3: phone3Row?.value || '',
      owner: owner || null,
      owners: owner ? [owner] : [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Store Profile & 3 Contact Numbers (PUT - OWNER only)
router.put('/store-profile', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ error: 'Only Store Owner can update store details and contacts' });
    return;
  }

  const {
    store_name,
    store_location,
    store_tagline,
    contact_phone_1,
    contact_phone_2,
    contact_phone_3,
  } = req.body;

  const now = new Date().toISOString();
  const userId = req.user.id;

  if (store_name !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_name', store_name.trim(), now, userId
    ]);
  }
  if (store_location !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_location', store_location.trim(), now, userId
    ]);
  }
  if (store_tagline !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'store_tagline', store_tagline.trim(), now, userId
    ]);
  }
  if (contact_phone_1 !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_1', contact_phone_1.trim(), now, userId
    ]);
  }
  if (contact_phone_2 !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_2', contact_phone_2.trim(), now, userId
    ]);
  }
  if (contact_phone_3 !== undefined) {
    dbRun('INSERT OR REPLACE INTO store_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'contact_phone_3', contact_phone_3.trim(), now, userId
    ]);
  }

  logAudit(userId, 'UPDATE_STORE_PROFILE', 'STORE', userId, {
    store_name,
    store_location,
    contact_phone_1,
    contact_phone_2,
    contact_phone_3,
  });

  res.json({
    success: true,
    message: 'Store profile & 3 contact numbers updated successfully'
  });
});

export default router;
