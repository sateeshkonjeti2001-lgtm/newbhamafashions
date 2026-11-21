import { dbQueryOne, dbRun } from './db.ts';
import { isValidDateString, sqlEffectiveSaleDate } from './dateUtil.ts';

export async function isBusinessDayClosed(dateStr: string): Promise<{ isClosed: boolean; record: any | null }> {
  if (!isValidDateString(dateStr)) {
    return { isClosed: false, record: null };
  }
  const record = await dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [dateStr]);
  return {
    isClosed: record?.status === 'CLOSED',
    record: record || null,
  };
}

export async function reconcileClosedDaySnapshot(
  dateStr: string,
  actorName: string,
  modificationSummary: string,
  modifiedAt?: string
): Promise<{ updated: boolean }> {
  if (!isValidDateString(dateStr)) return { updated: false };

  const existing = await dbQueryOne<any>('SELECT * FROM daily_closings WHERE closing_date = ?', [dateStr]);
  if (!existing || existing.status !== 'CLOSED') {
    await dbRun(`UPDATE sales SET day_closed = 0 WHERE ${sqlEffectiveSaleDate()} = ?`, [dateStr]);
    await dbRun('UPDATE financial_transactions SET day_closed = 0 WHERE date = ?', [dateStr]);
    await dbRun('UPDATE expenses SET day_closed = 0 WHERE date = ?', [dateStr]);
    return { updated: false };
  }

  const cashSales =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(cash_paid), 0) as t FROM sales WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')`,
        [dateStr]
      )
    )?.t || 0;

  const upiSales =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(upi_paid), 0) as t FROM sales WHERE ${sqlEffectiveSaleDate()} = ? AND (status IS NULL OR status = 'COMPLETED')`,
        [dateStr]
      )
    )?.t || 0;

  const cashReceivedOther =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions
         WHERE date = ? AND is_reversed = 0 AND destination_account = 'CASH' AND transaction_type NOT IN ('INCOME')`,
        [dateStr]
      )
    )?.t || 0;

  const cashExpenses =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions
         WHERE date = ? AND is_reversed = 0 AND source_account = 'CASH' AND transaction_type = 'OPERATING_EXPENSE'`,
        [dateStr]
      )
    )?.t || 0;

  const cashPaidOther =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(ft.amount), 0) as t
         FROM financial_transactions ft
         LEFT JOIN sales s ON ft.reference_no = ('VOID-' || s.bill_number)
         WHERE ft.date = ?
           AND ft.is_reversed = 0
           AND ft.source_account = 'CASH'
           AND ft.transaction_type NOT IN ('OPERATING_EXPENSE')
           AND NOT (ft.category = 'SALE_REVERSAL' AND s.created_at IS NOT NULL AND ${sqlEffectiveSaleDate('s.')} = ?)`,
        [dateStr, dateStr]
      )
    )?.t || 0;

  const upiReceivedOther =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions
         WHERE date = ? AND is_reversed = 0 AND destination_account = 'UPI' AND transaction_type NOT IN ('INCOME')`,
        [dateStr]
      )
    )?.t || 0;

  const upiPayments =
    (
      await dbQueryOne<any>(
        `SELECT COALESCE(SUM(amount), 0) as t FROM financial_transactions
         WHERE date = ? AND is_reversed = 0 AND source_account = 'UPI'`,
        [dateStr]
      )
    )?.t || 0;

  const openCash = Number(existing.opening_cash || 0);
  const actualCounted = Number(existing.actual_counted_cash || 0);
  const expectedClosingCash =
    Math.round((openCash + cashSales + cashReceivedOther - cashExpenses - cashPaidOther) * 100) / 100;
  const differenceCash = Math.round((actualCounted - expectedClosingCash) * 100) / 100;
  const modAt = modifiedAt || new Date().toISOString();

  await dbRun(
    `UPDATE daily_closings SET
      cash_sales = ?,
      cash_received_other = ?,
      cash_expenses = ?,
      cash_paid_other = ?,
      expected_closing_cash = ?,
      difference_cash = ?,
      upi_sales = ?,
      upi_received_other = ?,
      upi_payments = ?,
      modified_after_close = 1,
      last_modified_at = ?,
      last_modified_by = ?,
      last_modification_summary = ?
     WHERE closing_date = ?`,
    [
      cashSales,
      cashReceivedOther,
      cashExpenses,
      cashPaidOther,
      expectedClosingCash,
      differenceCash,
      upiSales,
      upiReceivedOther,
      upiPayments,
      modAt,
      actorName,
      modificationSummary,
      dateStr,
    ]
  );

  // Preserve original closed_at and closed_by_user_id; mark records on this date day_closed = 1
  await dbRun(`UPDATE sales SET day_closed = 1 WHERE ${sqlEffectiveSaleDate()} = ?`, [dateStr]);
  await dbRun('UPDATE financial_transactions SET day_closed = 1 WHERE date = ?', [dateStr]);
  await dbRun('UPDATE expenses SET day_closed = 1 WHERE date = ?', [dateStr]);

  return { updated: true };
}

export async function reconcileAffectedDayClosings(
  dates: Array<string | null | undefined>,
  actorName: string,
  modificationSummary: string,
  modifiedAt?: string
): Promise<string[]> {
  const uniqueDates = Array.from(
    new Set(dates.filter((d): d is string => Boolean(d) && isValidDateString(d)))
  );
  const modifiedDates: string[] = [];
  for (const d of uniqueDates) {
    const res = await reconcileClosedDaySnapshot(d, actorName, modificationSummary, modifiedAt);
    if (res.updated) {
      modifiedDates.push(d);
    }
  }
  return modifiedDates;
}
