/**
 * FreshInk booking core: TypeScript ports of the source plpgsql functions.
 *
 * - create_pending_appointment -> createHold()
 * - confirm_free_hold          -> confirmHold()
 * - get_unavailable_slots      -> getUnavailableSlots()
 * - get_booking_status         -> getBookingStatus()
 * - confirm_attendance / reschedule -> confirmAttendance() / reschedule()
 *
 * Timezone: America/Chicago everywhere. D1 stores datetimes as ISO-8601
 * UTC strings; "today" and slot-elapsed checks are computed here via
 * Intl.DateTimeFormat (D1 has no timestamptz / at time zone).
 *
 * Known preview limitation (documented in the contract): the double-booking
 * guard is check-then-insert inside one function invocation — D1/MySQL has
 * no partial unique index, so a concurrent race could double-book a slot.
 */
import { all, first, newId, randomHex, run, type SpacefastDb } from "./db";
import { AuthError, InputError } from "./http";
import { STUDIO_TIMEZONE, TIME_SLOTS } from "./studio";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RANGE_DAYS = 31;
const HOLD_MINUTES = 15;
const AGENT_HOLDS_PER_HOUR = 5;
const AGENT_ACTIVE_HOLDS_STUDIO = 20;
const RESCHEDULE_MAX = 3;
const RESCHEDULE_CUTOFF_HOURS = 24;

/** Session start time in minutes since midnight (Chicago) per slot label. */
const SLOT_START_MINUTES: Record<string, number> = {
  "10:00 AM": 10 * 60,
  "11:30 AM": 11 * 60 + 30,
  "1:00 PM": 13 * 60,
  "2:30 PM": 14 * 60 + 30,
  "4:00 PM": 16 * 60,
  "6:30 PM": 18 * 60 + 30,
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** YYYY-MM-DD in America/Chicago. */
export function chicagoToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Minutes since midnight in America/Chicago right now. */
function chicagoMinutesNow(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * True when a slot can no longer be booked: the date is in the past, or it
 * is today in Chicago and the slot's start time has passed. This is the
 * confirmed-bug fix — public listings must exclude elapsed same-day slots,
 * not just past dates.
 */
export function slotElapsed(date: string, timeSlot: string): boolean {
  const today = chicagoToday();
  if (date < today) return true;
  if (date > today) return false;
  const start = SLOT_START_MINUTES[timeSlot];
  if (start === undefined) return true; // unknown slot: treat as unbookable
  return chicagoMinutesNow() >= start;
}

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** Validates a ?from/&to range; defaults to today + 13 days. */
export function validateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): { from: string; to: string } {
  const start = from && from.length > 0 ? from : chicagoToday();
  const end = to && to.length > 0 ? to : addDays(start, 13);
  if (!isValidDate(start)) throw new InputError("invalid_from", "from must be YYYY-MM-DD.");
  if (!isValidDate(end)) throw new InputError("invalid_to", "to must be YYYY-MM-DD.");
  if (end < start) throw new InputError("invalid_range", "to must not be before from.");
  if (daysBetween(start, end) > MAX_RANGE_DAYS) {
    throw new InputError(
      "range_too_large",
      `Date range is limited to ${MAX_RANGE_DAYS} days.`,
    );
  }
  return { from: start, to: end };
}

/**
 * Offset (ms) of America/Chicago from UTC at a given instant, so a
 * Chicago-local date+time can be converted to an absolute UTC instant.
 */
function chicagoOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) % 24,
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - at.getTime();
}

/** Absolute UTC instant of a Chicago-local date + slot start. */
function chicagoSlotStartUtc(date: string, timeSlot: string): number {
  const start = SLOT_START_MINUTES[timeSlot];
  if (start === undefined) throw new InputError("invalid_time_slot", "Unknown time slot.");
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon: stable DST offset
  const offset = chicagoOffsetMs(probe);
  return Date.UTC(y, m - 1, d, Math.floor(start / 60), start % 60) - offset;
}

/** Mock email: preview-only. Logs; nothing is ever sent. */
export function mockEmail(
  template: string,
  to: string,
  data: Record<string, unknown>,
): void {
  console.log(`[mock-email] template=${template} to=${to} data=${JSON.stringify(data)}`);
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

export interface UnavailableMap {
  /** Per date, the set of taken slot labels. */
  slots: Map<string, Set<string>>;
  /** Dates with a whole-day block (time_slot IS NULL). */
  fullyBlocked: Set<string>;
}

/**
 * Port of get_unavailable_slots: confirmed bookings + live pending holds
 * (hold_expires_at > now) + blocked_slots over [from, to].
 */
export async function getUnavailableSlots(
  db: SpacefastDb,
  from: string,
  to: string,
): Promise<UnavailableMap> {
  const slots = new Map<string, Set<string>>();
  const fullyBlocked = new Set<string>();
  const add = (date: string, slot: string): void => {
    let set = slots.get(date);
    if (!set) {
      set = new Set<string>();
      slots.set(date, set);
    }
    set.add(slot);
  };

  const nowIso = new Date().toISOString();
  const bookings = await all(
    db,
    `SELECT booking_date, time_slot FROM appointments
     WHERE booking_date >= ? AND booking_date <= ?
       AND (status = 'confirmed'
            OR (status = 'pending' AND hold_expires_at > ?))`,
    from,
    to,
    nowIso,
  );
  for (const row of bookings) add(String(row["booking_date"]), String(row["time_slot"]));

  const blocks = await all(
    db,
    `SELECT blocked_date, time_slot FROM blocked_slots
     WHERE blocked_date >= ? AND blocked_date <= ?`,
    from,
    to,
  );
  for (const row of blocks) {
    const date = String(row["blocked_date"]);
    const slot = row["time_slot"];
    if (slot == null) {
      fullyBlocked.add(date);
      for (const s of TIME_SLOTS) add(date, s);
    } else {
      add(date, String(slot));
    }
  }
  return { slots, fullyBlocked };
}

export interface OpenDay {
  date: string;
  times: string[];
}

/**
 * Open times per date in [from, to]. Skips past dates, fully-blocked days,
 * taken slots, and — the confirmed-bug fix — elapsed same-day slots
 * (America/Chicago).
 */
export async function listOpenTimes(
  db: SpacefastDb,
  from?: string | null,
  to?: string | null,
): Promise<{ timezone: string; open: OpenDay[] }> {
  const { from: start, to: end } = validateRange(from, to);
  const { slots, fullyBlocked } = await getUnavailableSlots(db, start, end);
  const today = chicagoToday();
  const open: OpenDay[] = [];
  let cursor = start < today ? today : start;
  while (cursor <= end) {
    const taken = slots.get(cursor) ?? new Set<string>();
    const times = fullyBlocked.has(cursor)
      ? []
      : TIME_SLOTS.filter((s) => !taken.has(s) && !slotElapsed(cursor, s));
    open.push({ date: cursor, times });
    cursor = addDays(cursor, 1);
  }
  return { timezone: STUDIO_TIMEZONE, open };
}

/** True when date+slot is blocked or taken (optionally excluding one booking id). */
export async function slotUnavailable(
  db: SpacefastDb,
  date: string,
  timeSlot: string,
  excludeId?: string,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const conflict = await first(
    db,
    `SELECT id FROM appointments
     WHERE booking_date = ? AND time_slot = ?
       AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?))
       ${excludeId ? "AND id != ?" : ""}
     LIMIT 1`,
    ...(excludeId ? [date, timeSlot, nowIso, excludeId] : [date, timeSlot, nowIso]),
  );
  if (conflict) return true;
  const block = await first(
    db,
    `SELECT id FROM blocked_slots
     WHERE blocked_date = ? AND (time_slot IS NULL OR time_slot = ?)
     LIMIT 1`,
    date,
    timeSlot,
  );
  return block != null;
}

/* ------------------------------------------------------------------ */
/* Hold lifecycle                                                      */
/* ------------------------------------------------------------------ */

export interface CreateHoldInput {
  name: string;
  phone: string;
  email: string;
  date: string;
  time_slot: string;
  pronouns?: string | undefined;
  idea_description?: string | undefined;
  source?: "web" | "agent" | undefined;
}

function validateHoldInput(input: CreateHoldInput): {
  name: string;
  phone: string;
  email: string;
  date: string;
  timeSlot: string;
} {
  const name = (input.name ?? "").trim();
  if (name.length === 0) throw new InputError("invalid_name", "A name is required.");
  if (name.length > 200) throw new InputError("invalid_name", "Name is too long.");

  const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length < 7) {
    throw new InputError("invalid_phone", "A valid phone number is required (at least 7 digits).");
  }

  const email = (input.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320) {
    throw new InputError("invalid_email", "A valid email address is required.");
  }

  const date = (input.date ?? "").trim();
  if (!isValidDate(date)) throw new InputError("invalid_date", "date must be YYYY-MM-DD.");
  if (date < chicagoToday()) {
    throw new InputError("date_in_past", "That date is in the past.");
  }

  const timeSlot = (input.time_slot ?? "").trim();
  if (!SLOT_START_MINUTES[timeSlot]) {
    throw new InputError(
      "invalid_time_slot",
      `time_slot must be one of: ${TIME_SLOTS.join(", ")}.`,
    );
  }
  if (slotElapsed(date, timeSlot)) {
    throw new InputError("slot_elapsed", "That time has already passed today.");
  }

  return { name, phone: (input.phone ?? "").trim(), email, date, timeSlot };
}

/**
 * Port of create_pending_appointment. Validates input, rejects past dates
 * and elapsed same-day slots, checks blocked_slots, opportunistically
 * expires stale pendings on the same slot, enforces the double-booking
 * guard, enforces agent hold caps, then inserts a 15-minute pending hold.
 */
export async function createHold(
  db: SpacefastDb,
  input: CreateHoldInput,
  opts: { callerHash: string; isAgent: boolean },
): Promise<{ booking_id: string; hold_secret: string; hold_expires_at: string }> {
  const { name, phone, email, date, timeSlot } = validateHoldInput(input);
  const nowIso = new Date().toISOString();

  const blocked = await first(
    db,
    `SELECT id FROM blocked_slots
     WHERE blocked_date = ? AND (time_slot IS NULL OR time_slot = ?)
     LIMIT 1`,
    date,
    timeSlot,
  );
  if (blocked) throw new InputError("slot_blocked", "That time is blocked.", 409);

  // Opportunistically expire stale pendings on this slot (lazy sweeper).
  await run(
    db,
    `UPDATE appointments SET status = 'expired', payment_status = 'expired'
     WHERE status = 'pending' AND booking_date = ? AND time_slot = ?
       AND hold_expires_at <= ?`,
    date,
    timeSlot,
    nowIso,
  );

  // Double-booking guard (check-then-insert; see module doc on the race).
  const conflict = await first(
    db,
    `SELECT id FROM appointments
     WHERE booking_date = ? AND time_slot = ?
       AND (status = 'confirmed' OR (status = 'pending' AND hold_expires_at > ?))
     LIMIT 1`,
    date,
    timeSlot,
    nowIso,
  );
  if (conflict) {
    throw new InputError("slot_taken", "That time was just taken.", 409);
  }

  const source = input.source === "agent" || opts.isAgent ? "agent" : "web";
  if (opts.isAgent) {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const callerRow = await first(
      db,
      `SELECT COUNT(*) AS c FROM agent_hold_log
       WHERE caller_hash = ? AND created_at >= ?`,
      opts.callerHash,
      hourAgo,
    );
    if (Number(callerRow?.["c"] ?? 0) >= AGENT_HOLDS_PER_HOUR) {
      throw new InputError(
        "hold_limit",
        `Hold limit reached: ${AGENT_HOLDS_PER_HOUR} holds per caller per hour.`,
        429,
      );
    }
    const studioRow = await first(
      db,
      `SELECT COUNT(*) AS c FROM appointments
       WHERE source = 'agent' AND status = 'pending' AND hold_expires_at > ?`,
      nowIso,
    );
    if (Number(studioRow?.["c"] ?? 0) >= AGENT_ACTIVE_HOLDS_STUDIO) {
      throw new InputError(
        "studio_hold_limit",
        "The studio has reached its active agent-hold limit. Try again soon.",
        429,
      );
    }
  }

  const bookingId = crypto.randomUUID();
  const holdSecret = randomHex(16); // 32 hex chars
  const accessToken = crypto.randomUUID();
  const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();

  await run(
    db,
    `INSERT INTO appointments
       (id, client_name, phone, email, booking_date, time_slot, status, payment_status,
        hold_expires_at, hold_secret, access_token, pronouns, idea_description, source,
        notes, reminder_sent_at, client_confirmed_at, reschedule_count, rescheduled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending',
        ?, ?, ?, ?, ?, ?,
        NULL, NULL, NULL, 0, NULL, ?)`,
    bookingId,
    name,
    phone,
    email,
    date,
    timeSlot,
    holdExpiresAt,
    holdSecret,
    accessToken,
    input.pronouns?.trim() || null,
    input.idea_description?.trim() || null,
    source,
    nowIso,
  );

  if (opts.isAgent) {
    await run(
      db,
      `INSERT INTO agent_hold_log (id, caller_hash, appointment_id, created_at)
       VALUES (?, ?, ?, ?)`,
      newId(),
      opts.callerHash,
      bookingId,
      nowIso,
    );
  }

  return { booking_id: bookingId, hold_secret: holdSecret, hold_expires_at: holdExpiresAt };
}

export interface ConfirmHoldResult {
  booking_id: string;
  status: "confirmed" | "expired" | "cancelled";
  access_token?: string | undefined;
}

/**
 * Port of confirm_free_hold. Verifies the hold secret; expired holds are
 * marked expired; live holds become confirmed. Preview: payment_status is
 * set to 'paid' as a free lock-in — no payment processed.
 */
export async function confirmHold(
  db: SpacefastDb,
  bookingId: string,
  holdSecret: string,
): Promise<ConfirmHoldResult> {
  const row = await first(db, "SELECT * FROM appointments WHERE id = ? LIMIT 1", bookingId);
  if (!row) throw new InputError("not_found", "No hold with that booking id.", 404);
  const status = String(row["status"] ?? "");
  if (status === "confirmed") {
    return {
      booking_id: bookingId,
      status: "confirmed",
      access_token: String(row["access_token"] ?? ""),
    };
  }
  if (status !== "pending") {
    return { booking_id: bookingId, status: status as ConfirmHoldResult["status"] };
  }
  if (!row["hold_secret"] || String(row["hold_secret"]) !== holdSecret) {
    throw new InputError("invalid_secret", "Hold secret does not match.", 403);
  }
  const nowIso = new Date().toISOString();
  if (String(row["hold_expires_at"] ?? "") <= nowIso) {
    await run(
      db,
      `UPDATE appointments SET status = 'expired', payment_status = 'expired' WHERE id = ?`,
      bookingId,
    );
    return { booking_id: bookingId, status: "expired" };
  }
  // preview: free lock-in, no payment processed
  await run(
    db,
    `UPDATE appointments
     SET status = 'confirmed', payment_status = 'paid', hold_secret = NULL
     WHERE id = ?`,
    bookingId,
  );
  return {
    booking_id: bookingId,
    status: "confirmed",
    access_token: String(row["access_token"] ?? ""),
  };
}

/** Port of get_booking_status with lazy expiry. */
export async function getBookingStatus(
  db: SpacefastDb,
  bookingId: string,
): Promise<"pending" | "confirmed" | "expired" | "cancelled" | "not_found"> {
  const row = await first(
    db,
    "SELECT status, hold_expires_at FROM appointments WHERE id = ? LIMIT 1",
    bookingId,
  );
  if (!row) return "not_found";
  const status = String(row["status"] ?? "");
  if (status === "pending" && String(row["hold_expires_at"] ?? "") <= new Date().toISOString()) {
    return "expired"; // lazy expiry; row is cleaned up opportunistically on write
  }
  if (status === "pending" || status === "confirmed" || status === "expired" || status === "cancelled") {
    return status;
  }
  return "not_found";
}

/** Public (non-secret) fields for a booking. hold_secret is never exposed. */
export function publicBooking(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    booking_id: String(row["id"] ?? ""),
    booking_date: String(row["booking_date"] ?? ""),
    time_slot: String(row["time_slot"] ?? ""),
    status: String(row["status"] ?? ""),
    payment_status: String(row["payment_status"] ?? ""),
    client_name: String(row["client_name"] ?? ""),
    pronouns: row["pronouns"] == null ? null : String(row["pronouns"]),
    source: row["source"] == null ? null : String(row["source"]),
    reschedule_count: Number(row["reschedule_count"] ?? 0),
    created_at: row["created_at"] == null ? null : String(row["created_at"]),
  };
  if (String(row["status"]) === "pending" && row["hold_expires_at"]) {
    out["hold_expires_at"] = String(row["hold_expires_at"]);
  }
  return out;
}

/** Attendance confirmation from the session pass (access_token). */
export async function confirmAttendance(
  db: SpacefastDb,
  accessToken: string,
): Promise<{ booking_id: string; client_confirmed_at: string }> {
  const row = await first(
    db,
    "SELECT id FROM appointments WHERE access_token = ? AND status = 'confirmed' LIMIT 1",
    accessToken,
  );
  if (!row) {
    throw new InputError("not_found", "No confirmed booking for that pass token.", 404);
  }
  const nowIso = new Date().toISOString();
  await run(db, `UPDATE appointments SET client_confirmed_at = ? WHERE id = ?`, nowIso, String(row["id"]));
  return { booking_id: String(row["id"]), client_confirmed_at: nowIso };
}

/**
 * Reschedule a confirmed booking: max 3, closes 24h before the session,
 * new slot must be open (not blocked, not taken, not elapsed).
 */
export async function reschedule(
  db: SpacefastDb,
  accessToken: string,
  newDate: string,
  newSlot: string,
): Promise<{ booking_id: string; booking_date: string; time_slot: string; reschedule_count: number }> {
  const row = await first(
    db,
    "SELECT * FROM appointments WHERE access_token = ? LIMIT 1",
    accessToken,
  );
  if (!row || String(row["status"]) !== "confirmed") {
    throw new InputError("not_found", "No confirmed booking for that pass token.", 404);
  }
  const bookingId = String(row["id"]);
  if (Number(row["reschedule_count"] ?? 0) >= RESCHEDULE_MAX) {
    throw new InputError(
      "reschedule_limit",
      `Reschedules are limited to ${RESCHEDULE_MAX} per booking.`,
    );
  }
  if (!isValidDate(newDate)) throw new InputError("invalid_date", "new_date must be YYYY-MM-DD.");
  if (!SLOT_START_MINUTES[newSlot]) {
    throw new InputError(
      "invalid_time_slot",
      `new_time_slot must be one of: ${TIME_SLOTS.join(", ")}.`,
    );
  }

  // 24h cutoff against the *current* session start (Chicago-local).
  const currentStartUtc = chicagoSlotStartUtc(String(row["booking_date"]), String(row["time_slot"]));
  if (Date.now() > currentStartUtc - RESCHEDULE_CUTOFF_HOURS * 3_600_000) {
    throw new InputError(
      "reschedule_cutoff",
      "Reschedules close 24 hours before the session.",
    );
  }

  if (newDate < chicagoToday() || slotElapsed(newDate, newSlot)) {
    throw new InputError("slot_elapsed", "That time has already passed.");
  }
  if (await slotUnavailable(db, newDate, newSlot, bookingId)) {
    throw new InputError("slot_taken", "That time was just taken.", 409);
  }

  const count = Number(row["reschedule_count"] ?? 0) + 1;
  const nowIso = new Date().toISOString();
  await run(
    db,
    `UPDATE appointments
     SET booking_date = ?, time_slot = ?, reschedule_count = ?, rescheduled_at = ?
     WHERE id = ?`,
    newDate,
    newSlot,
    count,
    nowIso,
    bookingId,
  );
  return { booking_id: bookingId, booking_date: newDate, time_slot: newSlot, reschedule_count: count };
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

export type RateKind = "read" | "write";

export interface RateGate {
  allowed: boolean;
  retryAfterS: number;
  limit: number;
}

/**
 * Sliding-window rate limiting backed by api_rate_log.
 * - anonymous (IP hash): 60 reads/min + 5 writes/hour
 * - keyed (API key):     600 reads/min + 30 writes/hour
 */
export async function checkRateLimit(
  db: SpacefastDb,
  callerHash: string,
  kind: RateKind,
  keyed: boolean,
): Promise<RateGate> {
  const windowMs = kind === "read" ? 60_000 : 3_600_000;
  const limit = keyed ? (kind === "read" ? 600 : 30) : (kind === "read" ? 60 : 5);
  const bucket = kind === "read"
    ? new Date().toISOString().slice(0, 16) // minute: 2026-09-28T10:42
    : new Date().toISOString().slice(0, 13); // hour: 2026-09-28T10
  const bucketKey = `${kind}:${bucket}`;
  const bucketStartIso = kind === "read" ? `${bucket}:00.000Z` : `${bucket}:00:00.000Z`;

  // Prune stale rows so the log table stays small.
  await run(
    db,
    "DELETE FROM api_rate_log WHERE created_at < ?",
    new Date(Date.now() - 2 * 3_600_000).toISOString(),
  );

  const row = await first(
    db,
    `SELECT COUNT(*) AS c FROM api_rate_log
     WHERE caller_hash = ? AND bucket = ? AND created_at >= ?`,
    callerHash,
    bucketKey,
    bucketStartIso,
  );
  const count = Number(row?.["c"] ?? 0);
  if (count >= limit) {
    const retryAfterS = Math.max(
      1,
      Math.ceil((Date.parse(bucketStartIso) + windowMs - Date.now()) / 1000),
    );
    return { allowed: false, retryAfterS, limit };
  }
  await run(
    db,
    `INSERT INTO api_rate_log (id, caller_hash, bucket, created_at)
     VALUES (?, ?, ?, ?)`,
    newId(),
    callerHash,
    bucketKey,
    new Date().toISOString(),
  );
  return { allowed: true, retryAfterS: 0, limit };
}

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

/**
 * Replays a stored response when (key, callerHash) was seen before;
 * otherwise runs fn and stores its JSON response.
 */
export async function withIdempotency<T>(
  db: SpacefastDb,
  key: string,
  callerHash: string,
  fn: () => Promise<T>,
): Promise<{ response: T; replayed: boolean }> {
  if (!key || key.length > 128) {
    throw new InputError("invalid_idempotency_key", "Idempotency-Key must be 1-128 characters.");
  }
  const existing = await first(
    db,
    "SELECT response FROM idempotency_keys WHERE `key` = ? AND caller_hash = ? LIMIT 1",
    key,
    callerHash,
  );
  if (existing?.["response"] != null) {
    return { response: JSON.parse(String(existing["response"])) as T, replayed: true };
  }
  const response = await fn();
  try {
    await run(
      db,
      "INSERT INTO idempotency_keys (`key`, caller_hash, response, created_at) VALUES (?, ?, ?, ?)",
      key,
      callerHash,
      JSON.stringify(response),
      new Date().toISOString(),
    );
  } catch {
    // Race: another invocation stored the key first. Keep our response.
  }
  return { response, replayed: false };
}

/* ------------------------------------------------------------------ */
/* Caller identity                                                     */
/* ------------------------------------------------------------------ */

export interface Caller {
  kind: "key" | "anonymous";
  hash: string;
  keyed: boolean;
  email: string | null;
  label: string | null;
}

/**
 * Caller identity: sha256 hex of the API key from the X-API-Key header
 * (validated against agent_api_keys), otherwise sha256 of the client IP.
 * A presented-but-unknown key is a 401 rather than silent downgrade.
 */
export async function resolveCaller(
  db: SpacefastDb,
  request: Request,
  ip: string,
): Promise<Caller> {
  const rawKey = request.headers.get("X-API-Key")?.trim();
  if (rawKey) {
    const hash = await sha256Hex(rawKey);
    const row = await first(
      db,
      "SELECT id, email, label FROM agent_api_keys WHERE key_hash = ? LIMIT 1",
      hash,
    );
    if (!row) throw new AuthError("That API key is not recognized.");
    await run(
      db,
      "UPDATE agent_api_keys SET last_used_at = ? WHERE id = ?",
      new Date().toISOString(),
      String(row["id"]),
    );
    return {
      kind: "key",
      hash,
      keyed: true,
      email: row["email"] == null ? null : String(row["email"]),
      label: row["label"] == null ? null : String(row["label"]),
    };
  }
  return {
    kind: "anonymous",
    hash: await sha256Hex(`ip:${ip}`),
    keyed: false,
    email: null,
    label: null,
  };
}
