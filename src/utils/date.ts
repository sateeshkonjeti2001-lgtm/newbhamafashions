const IST_OFFSET_MS = 330 * 60 * 1000;

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed;
}

export function toISTDateString(input?: string | Date | null): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (isValidDateStr(trimmed)) {
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

export function getTodayIST(): string {
  return toISTDateString(new Date());
}

export function getYesterdayIST(): string {
  const todayIST = getTodayIST();
  const ms = Date.parse(`${todayIST}T00:00:00.000Z`) - 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function getISTCalendarDayDiff(createdIso: string): number {
  const createdIST = toISTDateString(createdIso);
  const todayIST = getTodayIST();
  const createdDayMs = Date.parse(`${createdIST}T00:00:00.000Z`);
  const todayDayMs = Date.parse(`${todayIST}T00:00:00.000Z`);
  return Math.round((todayDayMs - createdDayMs) / 86400000);
}

export function formatDateIST(input?: string | Date | null): string {
  if (!input) return '-';
  try {
    const d = input instanceof Date ? input : new Date(isValidDateStr(input) ? `${input}T00:00:00+05:30` : input);
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(input);
  }
}

export function formatTimeIST(input?: string | Date | null): string {
  if (!input) return '-';
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

export function formatDateTimeIST(input?: string | Date | null): string {
  if (!input) return '-';
  try {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(input);
  }
}
