import { Router, Response } from 'express';
import { dbQueryAll, dbQueryOne, dbRun, dbTransaction } from '../db.ts';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../auth.ts';
import { logAudit } from '../audit.ts';

const router = Router();
router.use(authMiddleware);
router.use(requireRole(['OWNER']));

// ----------------- Assets -----------------
router.get('/assets', (req: AuthenticatedRequest, res: Response) => {
  try {
    const assets = dbQueryAll(`
      SELECT 
        a.*,
        l.lender_name
      FROM assets a
      LEFT JOIN loans l ON a.loan_id = l.id
      ORDER BY a.purchase_date DESC
    `);
    res.json({ assets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assets', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, purchase_date, purchase_value, funding_source, loan_id, payment_method = 'BANK', notes } = req.body;
    // funding_source: 'OWN_FUNDS' | 'LOAN' | 'OTHER'

    const val = Number(purchase_value);
    if (!name || !name.trim() || !val || val <= 0) {
      res.status(400).json({ error: 'Asset name and valid purchase value are required' });
      return;
    }

    const assetId = 'ast_' + Date.now();
    const now = new Date().toISOString();
    const pDate = purchase_date || now.split('T')[0];

    dbTransaction(() => {
      dbRun(`
        INSERT INTO assets (
          id, name, purchase_date, purchase_value, funding_source, loan_id, current_status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      `, [
        assetId,
        name.trim(),
        pDate,
        val,
        funding_source || 'OWN_FUNDS',
        loan_id || null,
        notes?.trim() || null,
        now
      ]);

      // If funded from own business money, record ASSET_PURCHASE financial transaction
      if (funding_source === 'OWN_FUNDS') {
        const ftxId = 'ftx_ast_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'ASSET_PURCHASE', ?, 'BUSINESS_ASSET', ?, ?, ?, 1, ?, ?, ?)
        `, [
          ftxId,
          pDate,
          val,
          payment_method, // CASH | UPI | BANK
          name.trim(),
          `Asset Purchase: ${name.trim()}`,
          payment_method,
          `AST-${assetId.slice(-4)}`,
          req.user?.id || 'OWNER',
          now,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'OWNER', 'CREATE_ASSET', 'ASSET', assetId, { name, value: val });
    res.json({ success: true, id: assetId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dispose / Sell Asset
router.post('/assets/:id/dispose', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { disposal_date, disposal_value, payment_method = 'BANK', disposal_notes } = req.body;

    const asset = dbQueryOne<any>('SELECT * FROM assets WHERE id = ?', [id]);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    const dVal = Number(disposal_value) || 0;
    const profitOrLoss = dVal - asset.purchase_value;
    const now = new Date().toISOString();
    const dDate = disposal_date || now.split('T')[0];

    dbTransaction(() => {
      dbRun(`
        UPDATE assets SET
          current_status = 'SOLD',
          disposal_date = ?,
          disposal_value = ?,
          disposal_notes = ?,
          profit_or_loss = ?
        WHERE id = ?
      `, [dDate, dVal, disposal_notes?.trim() || null, profitOrLoss, id]);

      if (dVal > 0) {
        const ftxId = 'ftx_ast_sale_' + Date.now();
        dbRun(`
          INSERT INTO financial_transactions (
            id, date, amount, source_account, destination_account, transaction_type,
            person_entity, category, purpose, payment_method, reference_no,
            is_system_generated, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'EXTERNAL', ?, 'ASSET_SALE', ?, 'BUSINESS_ASSET_SALE', ?, ?, ?, 1, ?, ?, ?)
        `, [
          ftxId,
          dDate,
          dVal,
          payment_method, // CASH | UPI | BANK
          asset.name,
          `Asset Sale/Disposal: ${asset.name}`,
          payment_method,
          `AST-DISP-${id.slice(-4)}`,
          req.user?.id || 'OWNER',
          now,
          now
        ]);
      }
    });

    logAudit(req.user?.id || 'OWNER', 'DISPOSE_ASSET', 'ASSET', id, {
      name: asset.name,
      disposal_value: dVal,
      profitOrLoss
    });

    res.json({ success: true, profit_or_loss: profitOrLoss });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Loans -----------------
router.get('/loans', (req: AuthenticatedRequest, res: Response) => {
  try {
    const loans = dbQueryAll(`
      SELECT 
        l.*,
        COUNT(lr.id) as total_repayments_count
      FROM loans l
      LEFT JOIN loan_repayments lr ON l.id = lr.loan_id
      GROUP BY l.id
      ORDER BY l.loan_date DESC
    `);
    res.json({ loans });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record New Loan Received
router.post('/loans', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lender_name, loan_amount, loan_date, interest_info, payment_method = 'BANK', notes } = req.body;

    const amt = Number(loan_amount);
    if (!lender_name || !lender_name.trim() || !amt || amt <= 0) {
      res.status(400).json({ error: 'Lender name and valid loan amount are required' });
      return;
    }

    const loanId = 'loan_' + Date.now();
    const now = new Date().toISOString();
    const lDate = loan_date || now.split('T')[0];

    dbTransaction(() => {
      dbRun(`
        INSERT INTO loans (
          id, lender_name, loan_amount, loan_date, interest_info, total_repaid, outstanding_balance, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 'ACTIVE', ?, ?)
      `, [
        loanId,
        lender_name.trim(),
        amt,
        lDate,
        interest_info?.trim() || null,
        amt,
        notes?.trim() || null,
        now
      ]);

      // Loan receipt into business accounts (LOAN_RECEIVED)
      const ftxId = 'ftx_loan_' + Date.now();
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'EXTERNAL', ?, 'LOAN_RECEIVED', ?, 'LOAN_PRINCIPAL', ?, ?, ?, 1, ?, ?, ?)
      `, [
        ftxId,
        lDate,
        amt,
        payment_method, // BANK | CASH | UPI
        lender_name.trim(),
        `Loan Received from ${lender_name.trim()}`,
        payment_method,
        `LOAN-${loanId.slice(-4)}`,
        req.user?.id || 'OWNER',
        now,
        now
      ]);
    });

    logAudit(req.user?.id || 'OWNER', 'CREATE_LOAN', 'LOAN', loanId, { lender: lender_name, amount: amt });
    res.json({ success: true, id: loanId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Record Loan Repayment
router.post('/loans/:id/repay', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { principal_amount, interest_amount = 0, payment_method = 'BANK', repayment_date, notes } = req.body;

    const loan = dbQueryOne<any>('SELECT * FROM loans WHERE id = ?', [id]);
    if (!loan) {
      res.status(404).json({ error: 'Loan record not found' });
      return;
    }

    const pAmt = Number(principal_amount) || 0;
    const iAmt = Number(interest_amount) || 0;
    const totalRepay = pAmt + iAmt;

    if (totalRepay <= 0) {
      res.status(400).json({ error: 'Valid repayment amount is required' });
      return;
    }

    if (pAmt > loan.outstanding_balance) {
      res.status(400).json({
        error: `Principal repayment ₹${pAmt} cannot exceed outstanding loan balance ₹${loan.outstanding_balance}`
      });
      return;
    }

    const newOutstanding = loan.outstanding_balance - pAmt;
    const newTotalRepaid = loan.total_repaid + pAmt;
    const newStatus = newOutstanding === 0 ? 'CLOSED' : 'ACTIVE';
    const now = new Date().toISOString();
    const rDate = repayment_date || now.split('T')[0];
    const repayId = 'lrp_' + Date.now();
    const ftxId = 'ftx_lrp_' + Date.now();

    dbTransaction(() => {
      // 1. Update loan
      dbRun(`
        UPDATE loans SET
          total_repaid = ?,
          outstanding_balance = ?,
          status = ?
        WHERE id = ?
      `, [newTotalRepaid, newOutstanding, newStatus, id]);

      // 2. Insert repayment log
      dbRun(`
        INSERT INTO loan_repayments (
          id, loan_id, repayment_date, principal_amount, interest_amount, total_amount, payment_method, notes, financial_tx_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        repayId,
        id,
        rDate,
        pAmt,
        iAmt,
        totalRepay,
        payment_method,
        notes?.trim() || null,
        ftxId,
        now
      ]);

      // 3. Financial Transaction for repayment
      dbRun(`
        INSERT INTO financial_transactions (
          id, date, amount, source_account, destination_account, transaction_type,
          person_entity, category, purpose, payment_method, reference_no,
          is_system_generated, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'EXTERNAL', 'LOAN_REPAYMENT', ?, 'LOAN_REPAYMENT', ?, ?, ?, 1, ?, ?, ?)
      `, [
        ftxId,
        rDate,
        totalRepay,
        payment_method, // BANK | CASH | UPI
        loan.lender_name,
        `Loan Repayment to ${loan.lender_name} (Principal: ₹${pAmt}, Interest: ₹${iAmt})`,
        payment_method,
        `LRP-${repayId.slice(-4)}`,
        req.user?.id || 'OWNER',
        now,
        now
      ]);
    });

    logAudit(req.user?.id || 'OWNER', 'REPAY_LOAN', 'LOAN', id, {
      lender: loan.lender_name,
      principal: pAmt,
      interest: iAmt,
      remaining: newOutstanding
    });

    res.json({ success: true, outstanding_balance: newOutstanding, status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
