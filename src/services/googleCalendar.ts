import { logSyncToFirestore } from './firebase.ts';

export interface CalendarEventPayload {
  summary: string;
  description: string;
  startDateTime: string; // ISO string or YYYY-MM-DDTHH:mm:ss
  endDateTime: string;
  location?: string;
}

export interface CalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  htmlLink: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

/**
 * Creates a Google Calendar event in the user's primary calendar
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  userEmail: string,
  event: CalendarEventPayload
): Promise<CalendarEventItem> {
  const body = {
    summary: event.summary,
    description: event.description,
    location: event.location || 'New Bhama Fashions, Chilakaluripet, AP',
    start: {
      dateTime: event.startDateTime,
      timeZone: 'Asia/Kolkata',
    },
    end: {
      dateTime: event.endDateTime,
      timeZone: 'Asia/Kolkata',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 15 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to create Calendar event: ${res.statusText}`);
  }

  const created = await res.json();

  await logSyncToFirestore({
    type: 'calendar_event',
    title: event.summary,
    details: `Created calendar reminder: "${event.summary}" scheduled for ${event.startDateTime}`,
    userEmail,
    status: 'SUCCESS',
    url: created.htmlLink,
  });

  return created;
}

/**
 * Fetches upcoming calendar events from the primary calendar
 */
export async function getUpcomingCalendarEvents(
  accessToken: string,
  maxResults = 10
): Promise<CalendarEventItem[]> {
  const timeMin = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
    timeMin
  )}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to fetch Calendar events: ${res.statusText}`);
  }

  const data = await res.json();
  return data.items || [];
}

/**
 * Helper: Schedule Daily Closing & Day Book Reminder at 10:00 PM IST
 */
export async function scheduleDailyClosingCalendarReminder(
  accessToken: string,
  userEmail: string,
  dateStr?: string
): Promise<CalendarEventItem> {
  const today = dateStr || new Date().toISOString().split('T')[0];
  const start = `${today}T22:00:00+05:30`;
  const end = `${today}T22:30:00+05:30`;

  return createGoogleCalendarEvent(accessToken, userEmail, {
    summary: '🏬 New Bhama Fashions - Daily Closing & Day Book Reconciliation',
    description:
      'Store closing routine at New Bhama Fashions (Chilakaluripet):\n1. Reconcile physical cash drawer with POS totals.\n2. Verify UPI/QR collections.\n3. Mark Day Book as closed.\n4. Check automated daily database backup.',
    startDateTime: start,
    endDateTime: end,
    location: 'New Bhama Fashions, Chilakaluripet, AP',
  });
}

/**
 * Helper: Schedule Supplier Payment Due Reminder
 */
export async function scheduleSupplierDueCalendarReminder(
  accessToken: string,
  userEmail: string,
  supplierName: string,
  billNumber: string,
  dueDate: string,
  amount: number
): Promise<CalendarEventItem> {
  const start = `${dueDate}T10:00:00+05:30`;
  const end = `${dueDate}T10:45:00+05:30`;

  return createGoogleCalendarEvent(accessToken, userEmail, {
    summary: `💳 Supplier Payment Due: ${supplierName} (₹${amount.toLocaleString('en-IN')})`,
    description: `Payment due for purchase bill #${billNumber} to supplier ${supplierName}.\nPending Amount: ₹${amount.toLocaleString(
      'en-IN'
    )}.\nPlease issue RTGS/NEFT or cash payment and record in Money & Accounts.`,
    startDateTime: start,
    endDateTime: end,
  });
}

/**
 * Helper: Schedule Customer Payment Follow-up Reminder
 */
export async function scheduleCustomerDueCalendarReminder(
  accessToken: string,
  userEmail: string,
  customerName: string,
  customerPhone: string,
  dueDate: string,
  dueBalance: number
): Promise<CalendarEventItem> {
  const start = `${dueDate}T11:00:00+05:30`;
  const end = `${dueDate}T11:30:00+05:30`;

  return createGoogleCalendarEvent(accessToken, userEmail, {
    summary: `📞 Follow-up Customer Due: ${customerName} (₹${dueBalance.toLocaleString('en-IN')})`,
    description: `Follow up on outstanding credit balance for ${customerName} (Phone: ${customerPhone}).\nOutstanding Due: ₹${dueBalance.toLocaleString(
      'en-IN'
    )}.\nCollect payment via cash or UPI and record in Customer Dues Ledger.`,
    startDateTime: start,
    endDateTime: end,
  });
}
