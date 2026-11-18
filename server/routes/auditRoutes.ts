import { WebRouter as Router, WebResponse as Response } from '../webRouter.ts';
import { dbQueryAll } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';

const router = new Router();
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { entity_type, action, limit = 100 } = req.query;
    let sql = `
      SELECT 
        a.*,
        u.username,
        u.full_name as user_full_name,
        u.role as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (entity_type) {
      sql += ' AND a.entity_type = ?';
      params.push(entity_type);
    }

    if (action) {
      sql += ' AND a.action = ?';
      params.push(action);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const rows = await dbQueryAll(sql, params);
    const logs = rows.map((l) => ({
      ...l,
      details: l.details ? JSON.parse(l.details) : null,
    }));

    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
