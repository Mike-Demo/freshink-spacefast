/** Chicago-time slot helpers + client-side .ics generation. */

export const TZ = "America/Chicago";

/** YYYY-MM-DD for a Date in America/Chicago. */
export function chicagoDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA yields YYYY-MM-DD
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Convert "10:00 AM" to minutes after midnight. */
export function slotMinutes(slot: string): number {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(slot.trim());
  if (!m) return 0;
  const hour = Number(m[1]) % 12;
  const minute = Number(m[2]);
  const pm = (m[3] ?? "").toUpperCase() === "PM";
  return (hour + (pm ? 12 : 0)) * 60 + minute;
}

/** Chicago minutes-after-midnight right now. */
export function chicagoNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
    .format(new Date())
    .split(":")
    .map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * True when a slot on `dateKey` has already started in Chicago.
 * Defense-in-depth: the API filters elapsed slots too, but the client
 * hides them as well so nothing stale is ever clickable.
 */
export function isSlotElapsed(dateKey: string, slot: string): boolean {
  const todayKey = chicagoDateKey(new Date());
  if (dateKey < todayKey) return true;
  if (dateKey > todayKey) return false;
  return slotMinutes(slot) <= chicagoNowMinutes();
}

export function isWeekend(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  const day = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
  return day === 0 || day === 6;
}

export function formatLongDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function formatShortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Format a US phone number as (555) 019-2834 while typing. */
export function formatPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Chicago UTC offset (minutes) for the given local wall time, via Intl round-trip. */
function chicagoOffsetMinutes(year: number, month: number, day: number, hour: number, minute: number): number {
  // Guess UTC = wall time, then measure how Chicago renders that instant and correct.
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUtc - guess) / 60000;
}

function icsDateUTC(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Build a 90-minute calendar event for a session, emitted in UTC.
 * Downloads as `fresh-ink-session.ics` on the pass page.
 */
export function buildSessionIcs(opts: {
  dateKey: string; // YYYY-MM-DD (Chicago)
  timeSlot: string; // "1:00 PM"
  clientName: string;
  address: string;
  passUrl: string;
}): string {
  const [y, m, d] = opts.dateKey.split("-").map(Number);
  const mins = slotMinutes(opts.timeSlot);
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  const offset = chicagoOffsetMinutes(y ?? 1970, m ?? 1, d ?? 1, hour, minute);
  const startUtc = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute) - offset * 60000;
  const endUtc = startUtc + 90 * 60000;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fresh Ink Preview//Session Pass//EN",
    "BEGIN:VEVENT",
    `UID:${opts.dateKey}-${opts.timeSlot.replace(/[^0-9]/g, "")}-${Date.now()}@freshink-preview.view.fast`,
    `DTSTAMP:${icsDateUTC(Date.now())}`,
    `DTSTART:${icsDateUTC(startUtc)}`,
    `DTEND:${icsDateUTC(endUtc)}`,
    `SUMMARY:${icsEscape(`Fresh Ink session — ${opts.clientName}`)} (preview, no charge)`,
    `DESCRIPTION:${icsEscape(`Demo booking — payments disabled in this preview. Session pass: ${opts.passUrl}`)}`,
    `LOCATION:${icsEscape(opts.address)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder: Fresh Ink session tomorrow",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
