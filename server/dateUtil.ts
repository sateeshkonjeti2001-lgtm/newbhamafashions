export const IST_OFFSET_MS = 330 * 60 * 1000; // Asia/Kolkata = UTC+05:30

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed;
}

export function toISTDateString(input?: string | Date | null): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (isValidDateString(trimmed)) {
      return trimmed;
    }
    if (trimmed) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
      }
    }
    return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const baseDate = input instanceof Date ? input : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  return new Date(baseDate.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function getTodayIST(refDate?: Date): string {
  return toISTDateString(refDate || new Date());
}

export function addDaysIST(dateStr: string, deltaDays: number): string {
  const baseDateStr = isValidDateString(dateStr) ? dateStr.trim() : getTodayIST();
  const ms = Date.parse(`${baseDateStr}T00:00:00.000Z`) + deltaDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function getISTCalendarDayDiff(createdIso: string, refNow?: Date): number {
  const createdIST = toISTDateString(createdIso);
  const todayIST = getTodayIST(refNow);
  const createdDayMs = Date.parse(`${createdIST}T00:00:00.000Z`);
  const todayDayMs = Date.parse(`${todayIST}T00:00:00.000Z`);
  return Math.round((todayDayMs - createdDayMs) / 86400000);
}

export function sqlISTDate(columnExpr: string): string {
  return `DATE(${columnExpr}, '+330 minutes')`;
}

export function sqlEffectiveSaleDate(tableAlias: string = ''): string {
  const prefix = tableAlias ? (tableAlias.endsWith('.') ? tableAlias : `${tableAlias}.`) : '';
  return `COALESCE(${prefix}bill_date, DATE(${prefix}created_at, '+330 minutes'))`;
}
