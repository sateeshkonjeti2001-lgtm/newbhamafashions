import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction, saveDb } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';
import { randomHex } from '../cryptoUtil.ts';
import { getTodayIST, toISTDateString } from '../dateUtil.ts';
import { verifyOwnerPasswordOverride } from '../ownerOverride.ts';
import { isBusinessDayClosed, reconcileAffectedDayClosings } from '../closingSync.ts';

const router = new Router();
router.use(authMiddleware);

// Staff list
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isOwner = req.user?.role === 'OWNER';
    const staff = await dbQueryAll(`
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
router.post('/', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, role_title, monthly_salary, joining_date, address, emergency_contact } = req.body;
    if (!name || !name.trim() || !role_title || !role_title.trim()) {
      res.status(400).json({ error: 'Name and role title are required' });
      return;
    }

    const id = 'stf_' + Date.now();
    const now = new Date().toISOString();

    await dbRun(`
      INSERT INTO staff (
        id, name, phone, role_title, monthly_salary, joining_date, address, emergency_contact, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      id,
      name.trim(),
      phone?.trim() || null,
      role_title.trim(),
      Number(monthly_salary) || 0,
      joining_date || getTodayIST(),
      address?.trim() || null,
      emergency_contact?.trim() || null,
      now
    ]);
    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'CREATE_STAFF', 'STAFF', id, { name, role: role_title });
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mark / Update Attendance for a date
router.post('/attendance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { staff_id, date, status, check_in_time, check_out_time, notes, reason, owner_password } = req.body;
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

    const existingAttendance = await dbQueryOne<any>(
      'SELECT * FROM attendance WHERE staff_id = ? AND date = ?',
      [staff_id, date]
    );
    const todayIST = getTodayIST();
    const dayClosing = await isBusinessDayClosed(date);

    if (dayClosing.isClosed && req.user?.role !== 'OWNER') {
      res.status(403).json({
        error: `Business day ${date} is CLOSED. Only Owner can modify attendance for a closed day.`,
      });
      return;
    }

    if ((existingAttendance && date !== todayIST) || dayClosing.isClosed) {
      if (!reason || !String(reason).trim()) {
        res.status(400).json({
          error: 'Mandatory reason is required when modifying past or closed-day attendance.',
        });
        return;
      }
    }

    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (dayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${date} is CLOSED. Owner password verification is required to modify closed-day attendance.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const now = new Date().toISOString();
    const attId = 'att_' + Date.now();
    const cleanReason = reason ? String(reason).trim() : null;
    const effectiveNotes = cleanReason
      ? `${notes?.trim() ? notes.trim() + ' ' : ''}[Edit: ${cleanReason}]`
      : notes?.trim() || null;

    await dbRun(`
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
      effectiveNotes,
      req.user?.id || 'USER',
      now
    ]);
    saveDb(true);

    if (existingAttendance) {
      await logAudit(req.user?.id || 'USER', 'UPDATE_ATTENDANCE', 'ATTENDANCE', existingAttendance.id, {
        staff_id,
        date,
        reason: cleanReason,
        override_authorized_by: overrideOwner?.full_name || null,
        before: {
          status: existingAttendance.status,
          check_in_time: existingAttendance.check_in_time,
          check_out_time: existingAttendance.check_out_time,
        },
        after: { status, check_in_time: check_in_time || null, check_out_time: check_out_time || null },
      });
    } else {
      await logAudit(req.user?.id || 'USER', 'MARK_ATTENDANCE', 'ATTENDANCE', staff_id, { date, status });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Attendance Record (Owner only)
router.delete('/attendance/:id', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, owner_password } = req.body || {};

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to remove an attendance record.' });
      return;
    }

    const existing = await dbQueryOne<any>(
      `SELECT a.*, s.name as staff_name FROM attendance a JOIN staff s ON a.staff_id = s.id WHERE a.id = ?`,
      [id]
    );
    if (!existing) {
      res.status(404).json({ error: 'Attendance record not found.' });
      return;
    }

    const dayClosing = await isBusinessDayClosed(existing.date);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (dayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Attendance is on a CLOSED business day (${existing.date}). Owner password verification is required.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    await dbRun('DELETE FROM attendance WHERE id = ?', [id]);
    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'DELETE_ATTENDANCE', 'ATTENDANCE', id, {
      staff_id: existing.staff_id,
      staff_name: existing.staff_name,
      date: existing.date,
      previous_status: existing.status,
      reason: String(reason).trim(),
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for a date or month
router.get('/attendance', async (req: AuthenticatedRequest, res: Response) => {
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
    const records = await dbQueryAll(sql, params);
    res.json({ attendance: records });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Staff Salary or Advance Payment (Owner only)
router.post('/salary-payment', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { staff_id, month, year, payment_type, amount, payment_method = 'CASH', notes, owner_password } = req.body;
    // payment_type: 'SALARY' | 'ADVANCE'

    const payAmt = Number(amount);
    if (!staff_id || !payAmt || payAmt <= 0) {
      res.status(400).json({ error: 'Staff member and valid positive amount are required' });
      return;
    }

    const staffMember = await dbQueryOne<any>('SELECT * FROM staff WHERE id = ?', [staff_id]);
    if (!staffMember) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    const now = new Date().toISOString();
    const today = getTodayIST();
    const todayClosing = await isBusinessDayClosed(today);
    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (todayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Business day ${today} is CLOSED. Owner password verification is required to pay staff salary/advance on a closed day.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const payId = 'spay_' + Date.now() + '_' + randomHex(3);
    const ftxId = 'ftx_staff_' + Date.now() + '_' + randomHex(3);

    await dbTransaction(async () => {
      await dbRun(`
        INSERT INTO salary_payments (
          id, staff_id, month, year, payment_type, amount, payment_method, notes, paid_by, financial_tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        payId,
        staff_id,
        parseInt(month, 10) || Number(today.split('-')[1]),
        parseInt(year, 10) || Number(today.split('-')[0]),
        payment_type || 'SALARY',
        payAmt,
        payment_method,
        notes?.trim() || null,
        req.user?.id || 'OWNER',
        ftxId,
        now
      ]);

      await dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, day_closed, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'STAFF_PAYMENT', ?, 'STAFF_SALARY', ?, ?, ?, 1, ?, ?, ?, ?)
      `, [
        ftxId,
        today,
        payAmt,
        payment_method,
        staffMember.name,
        `Staff ${payment_type === 'ADVANCE' ? 'Advance' : 'Salary'}: ${staffMember.name} (${notes || 'Payment'})`,
        payment_method,
        `STAFF-${staff_id.slice(-4)}`,
        todayClosing.isClosed ? 1 : 0,
        req.user?.id || 'OWNER',
        now,
        now
      ]);
    });

    if (todayClosing.isClosed) {
      await reconcileAffectedDayClosings(
        [today],
        overrideOwner?.full_name || req.user?.full_name || 'Owner',
        `Staff ${payment_type || 'SALARY'} payment ₹${payAmt} (${payment_method}) for ${staffMember.name} on closed day`,
        now
      );
    }

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'STAFF_PAYMENT', 'STAFF', staff_id, {
      staff: staffMember.name,
      type: payment_type,
      amount: payAmt,
      override_authorized_by: overrideOwner?.full_name || null,
    });

    res.json({ success: true, id: payId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Safe Reversal of a Staff Salary / Advance Payment (Owner only)
router.post('/salary-payments/:id/reverse', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, owner_password } = req.body;

    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'Mandatory reason is required to reverse a salary payment.' });
      return;
    }

    const spay = await dbQueryOne<any>(
      `SELECT sp.*, s.name as staff_name FROM salary_payments sp JOIN staff s ON sp.staff_id = s.id WHERE sp.id = ?`,
      [id]
    );
    if (!spay) {
      res.status(404).json({ error: 'Salary payment record not found.' });
      return;
    }

    if (spay.is_reversed) {
      res.status(400).json({ error: 'This salary payment has already been reversed.' });
      return;
    }

    const ftx = spay.financial_tx_id
      ? await dbQueryOne<any>('SELECT * FROM financial_transactions WHERE id = ?', [spay.financial_tx_id])
      : null;
    const payDate = ftx?.date || toISTDateString(spay.created_at);
    const dayClosing = await isBusinessDayClosed(payDate);

    let overrideOwner: { id: string; username: string; full_name: string } | null = null;
    if (dayClosing.isClosed) {
      const override = await verifyOwnerPasswordOverride(
        owner_password,
        `Salary payment belongs to a CLOSED business day (${payDate}). Owner password verification is required.`
      );
      if (!override.ok) {
        res.status(override.status).json({
          error: override.error,
          code: override.code,
          requires_owner_password: true,
        });
        return;
      }
      overrideOwner = override.owner;
    }

    const now = new Date().toISOString();
    const cleanReason = String(reason).trim();

    await dbTransaction(async () => {
      await dbRun(
        `UPDATE salary_payments SET
          is_reversed = 1,
          reversed_reason = ?,
          reversed_at = ?,
          reversed_by = ?
         WHERE id = ?`,
        [cleanReason, now, req.user?.id || 'OWNER', id]
      );

      if (spay.financial_tx_id) {
        await dbRun(
          `UPDATE financial_transactions SET
            is_reversed = 1,
            notes = COALESCE(notes || ' | ', '') || ?,
            updated_at = ?
           WHERE id = ?`,
          [`[REVERSED Salary Payment: ${cleanReason}]`, now, spay.financial_tx_id]
        );
      }
    });

    const modifiedClosedDates = await reconcileAffectedDayClosings(
      [payDate],
      overrideOwner?.full_name || req.user?.full_name || 'Owner',
      `Reversed ${spay.payment_type} ₹${spay.amount} (${spay.payment_method}) for ${spay.staff_name}: ${cleanReason}`,
      now
    );

    saveDb(true);

    await logAudit(req.user?.id || 'OWNER', 'REVERSE_SALARY_PAYMENT', 'SALARY_PAYMENT', id, {
      staff_id: spay.staff_id,
      staff_name: spay.staff_name,
      payment_type: spay.payment_type,
      amount: spay.amount,
      reason: cleanReason,
      override_authorized_by: overrideOwner?.full_name || null,
      modified_closed_dates: modifiedClosedDates,
    });

    res.json({ success: true, modified_closed_dates: modifiedClosedDates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Staff payment history (Owner only)
router.get('/salary-payments', requireRole(['OWNER']), async (req: AuthenticatedRequest, res: Response) => {
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
    const payments = await dbQueryAll(sql, params);
    res.json({ payments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
