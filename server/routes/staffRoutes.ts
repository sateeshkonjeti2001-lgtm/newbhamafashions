import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();
router.use(authMiddleware);

// Staff list
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const staff = dbQueryAll(`
      SELECT 
        s.id, s.name, s.phone, s.role_title, s.joining_date, s.address, s.emergency_contact, s.is_active, s.created_at
        ${isOwner ? ', s.monthly_salary' : ''}
      FROM staff s
      ORDER BY s.is_active DESC, s.name ASC
    `);
    res.json({ staff });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Staff (Owner only)
router.post('/', requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, role_title, monthly_salary, joining_date, address, emergency_contact } = req.body;
    if (!name || !name.trim() || !role_title || !role_title.trim()) {
      res.status(400).json({ error: 'Name and role title are required' });
      return;
    }

    const id = 'stf_' + Date.now();
    const now = new Date().toISOString();

    dbRun(`
      INSERT INTO staff (
        id, name, phone, role_title, monthly_salary, joining_date, address, emergency_contact, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      id,
      name.trim(),
      phone?.trim() || null,
      role_title.trim(),
      Number(monthly_salary) || 0,
      joining_date || now.split('T')[0],
      address?.trim() || null,
      emergency_contact?.trim() || null,
      now
    ]);

    logAudit(req.user?.id || 'OWNER', 'CREATE_STAFF', 'STAFF', id, { name, role: role_title });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mark / Update Attendance for a date
router.post('/attendance', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { staff_id, date, status, check_in_time, check_out_time, notes } = req.body;
    // status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE'
    if (!staff_id || !date || !status) {
      res.status(400).json({ error: 'Staff member, date, and status are required' });
      return;
    }

    const validStatuses = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Status must be PRESENT, ABSENT, HALF_DAY, or LEAVE' });
      return;
    }

    const now = new Date().toISOString();
    const attId = 'att_' + Date.now();

    dbRun(`
      INSERT INTO attendance (id, staff_id, date, status, check_in_time, check_out_time, notes, marked_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(staff_id, date) DO UPDATE SET
        status = excluded.status,
        check_in_time = excluded.check_in_time,
        check_out_time = excluded.check_out_time,
        notes = excluded.notes,
        marked_by = excluded.marked_by
    `, [
      attId,
      staff_id,
      date,
      status,
      check_in_time || null,
      check_out_time || null,
      notes?.trim() || null,
      req.user?.id || 'USER',
      now
    ]);

    logAudit(req.user?.id || 'USER', 'MARK_ATTENDANCE', 'ATTENDANCE', staff_id, { date, status });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for a date or month
router.get('/attendance', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, month, year } = req.query;
    let sql = `
      SELECT 
        a.*,
        s.name as staff_name,
        s.role_title,
        u.full_name as marked_by_name
      FROM attendance a
      JOIN staff s ON a.staff_id = s.id
      LEFT JOIN users u ON a.marked_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (date) {
      sql += ' AND a.date = ?';
      params.push(date);
    } else if (month && year) {
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      sql += ' AND a.date LIKE ?';
      params.push(`${monthPrefix}%`);
    }

    sql += ' ORDER BY a.date DESC, s.name ASC';
    const records = dbQueryAll(sql, params);
    res.json({ attendance: records });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Staff Salary or Advance Payment (Owner only)
router.post('/salary-payment', requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { staff_id, month, year, payment_type, amount, payment_method = 'CASH', notes } = req.body;
    // payment_type: 'SALARY' | 'ADVANCE'

    const payAmt = Number(amount);
    if (!staff_id || !payAmt || payAmt <= 0) {
      res.status(400).json({ error: 'Staff member and valid positive amount are required' });
      return;
    }

    const staffMember = dbQueryOne<any>('SELECT * FROM staff WHERE id = ?', [staff_id]);
    if (!staffMember) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const payId = 'spay_' + Date.now();
    const ftxId = 'ftx_staff_' + Date.now();

    dbTransaction(() => {
      // 1. Record salary payment
      dbRun(`
        INSERT INTO salary_payments (
          id, staff_id, month, year, payment_type, amount, payment_method, notes, paid_by, financial_tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payId,
        staff_id,
        parseInt(month, 10) || new Date().getMonth() + 1,
        parseInt(year, 10) || new Date().getFullYear(),
        payment_type || 'SALARY',
        payAmt,
        payment_method,
        notes?.trim() || null,
        req.user?.id || 'OWNER',
        ftxId,
        now
      ]);

      // 2. Financial Transaction (STAFF_PAYMENT)
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'STAFF_PAYMENT', ?, 'STAFF_SALARY', ?, ?, ?, 1, ?, ?, ?)
      `, [
        ftxId,
        today,
        payAmt,
        payment_method, // CASH | UPI | BANK
        staffMember.name,
        `Staff ${payment_type === 'ADVANCE' ? 'Advance' : 'Salary'}: ${staffMember.name} (${notes || 'Payment'})`,
        payment_method,
        `STAFF-${staff_id.slice(-4)}`,
        req.user?.id || 'OWNER',
        now,
        now
      ]);
    });

    logAudit(req.user?.id || 'OWNER', 'STAFF_PAYMENT', 'STAFF', staff_id, {
      staff: staffMember.name,
      type: payment_type,
      amount: payAmt
    });

    res.json({ success: true, id: payId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Staff payment history (Owner only)
router.get('/salary-payments', requireRole(['OWNER']), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { staff_id } = req.query;
    let sql = `
      SELECT 
        sp.*,
        s.name as staff_name,
        s.role_title,
        u.full_name as paid_by_name
      FROM salary_payments sp
      JOIN staff s ON sp.staff_id = s.id
      LEFT JOIN users u ON sp.paid_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (staff_id) {
      sql += ' AND sp.staff_id = ?';
      params.push(staff_id);
    }

    sql += ' ORDER BY sp.created_at DESC';
    const payments = dbQueryAll(sql, params);
    res.json({ payments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
