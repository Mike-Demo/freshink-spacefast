/**
 * Minimal wrapper around SpaceFast's env.DB (D1-shaped API).
 * Wrapper pattern copied from CEO Owl's functions/_core/db.ts.
 *
 * All datetimes are ISO-8601 UTC strings; booleans are 0/1 integers.
 * Chicago-local "today" / slot-elapsed math lives in booking.ts via
 * Intl.DateTimeFormat (D1 has no timestamptz / at time zone).
 */

export interface DbStatement {
  bind(...params: unknown[]): DbResult;
}

export interface DbResult {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
}

export interface SpacefastDb {
  prepare(sql: string): DbStatement;
}

function toDbValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export function q(db: SpacefastDb, sql: string, ...params: unknown[]): DbResult {
  return db.prepare(sql).bind(...params.map(toDbValue));
}

export async function all(
  db: SpacefastDb,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown>[]> {
  const res = await q(db, sql, ...params).all();
  return res.results ?? [];
}

export async function first(
  db: SpacefastDb,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown> | null> {
  return (await q(db, sql, ...params).first()) ?? null;
}

export async function run(db: SpacefastDb, sql: string, ...params: unknown[]): Promise<void> {
  await q(db, sql, ...params).run();
}

/** Random id for primary keys (hex, 128-bit). */
export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Random hex token of `bytes` bytes (e.g. 16 bytes -> 32 hex chars). */
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let schemaEnsured = false;
let seeded = false;

/** Runs a DDL statement, ignoring "already exists" races on cold start. */
async function ensureOnce(db: SpacefastDb, sql: string): Promise<void> {
  try {
    await run(db, sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|duplicate/i.test(message)) return;
    throw error;
  }
}

/** Creates the preview tables if they do not exist. Idempotent. */
export async function ensureSchema(db: SpacefastDb): Promise<void> {
  if (schemaEnsured) return;
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(64) PRIMARY KEY,
      client_name TEXT,
      phone TEXT,
      email TEXT,
      booking_date VARCHAR(10),
      time_slot VARCHAR(16),
      status TEXT,
      payment_status TEXT,
      hold_expires_at TEXT,
      hold_secret TEXT,
      access_token VARCHAR(128) UNIQUE,
      pronouns TEXT,
      idea_description TEXT,
      source TEXT,
      notes TEXT,
      reminder_sent_at TEXT,
      client_confirmed_at TEXT,
      reschedule_count INTEGER DEFAULT 0,
      rescheduled_at TEXT,
      created_at TEXT
    )`,
  );
  await ensureOnce(
    db,
    `CREATE INDEX appointments_date_slot_idx ON appointments (booking_date, time_slot)`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS blocked_slots (
      id VARCHAR(64) PRIMARY KEY,
      blocked_date VARCHAR(10) NOT NULL,
      time_slot VARCHAR(16),
      reason TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  await ensureOnce(
    db,
    `CREATE INDEX blocked_slots_date_idx ON blocked_slots (blocked_date)`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS agent_api_keys (
      id VARCHAR(64) PRIMARY KEY,
      key_hash VARCHAR(128) UNIQUE NOT NULL,
      email TEXT NOT NULL,
      label TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS agent_hold_log (
      id VARCHAR(64) PRIMARY KEY,
      caller_hash VARCHAR(128) NOT NULL,
      appointment_id TEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL
    )`,
  );
  await ensureOnce(
    db,
    `CREATE INDEX agent_hold_log_caller_idx ON agent_hold_log (caller_hash, created_at)`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS api_rate_log (
      id VARCHAR(64) PRIMARY KEY,
      caller_hash VARCHAR(128) NOT NULL,
      bucket VARCHAR(64) NOT NULL,
      created_at VARCHAR(32) NOT NULL
    )`,
  );
  await ensureOnce(
    db,
    `CREATE INDEX api_rate_log_caller_idx ON api_rate_log (caller_hash, bucket, created_at)`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS idempotency_keys (
      \`key\` VARCHAR(128) PRIMARY KEY,
      caller_hash VARCHAR(128) NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id VARCHAR(64) PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      manage_token TEXT NOT NULL,
      events TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS reminder_runs (
      id VARCHAR(64) PRIMARY KEY,
      ran_at TEXT NOT NULL,
      skipped_reason TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      suppressed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      sms_simulated INTEGER NOT NULL DEFAULT 0
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS cron_tokens (
      id VARCHAR(64) PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash VARCHAR(128) NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role VARCHAR(32) NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  schemaEnsured = true;
}

/**
 * Inserts clearly-labeled synthetic demo data on first boot only:
 * 2 fake blocked dates ("Demo holiday") + 2 fake confirmed appointments
 * with fictional names, example.com emails, and 555 numbers, so
 * availability listings are not trivially empty.
 *
 * Never seed anything resembling real customer data. Never use real
 * credentials. Only runs when the appointments table is empty.
 */
export async function seedIfEmpty(db: SpacefastDb): Promise<void> {
  if (seeded) return;
  try {
    const row = await first(db, "SELECT COUNT(*) AS c FROM appointments");
    if (Number(row?.["c"] ?? 0) > 0) return;

    const now = new Date().toISOString();
    const dayOffset = (days: number): string => {
      const d = new Date(Date.now() + days * 86_400_000);
      return d.toISOString().slice(0, 10);
    };

    await run(
      db,
      `INSERT INTO blocked_slots (id, blocked_date, time_slot, reason, created_at)
       VALUES (?, ?, NULL, ?, ?), (?, ?, NULL, ?, ?)`,
      newId(),
      dayOffset(10),
      "Demo holiday (synthetic preview data)",
      now,
      newId(),
      dayOffset(17),
      "Demo holiday (synthetic preview data)",
      now,
    );

    const seedAppointments: Array<{
      name: string;
      phone: string;
      email: string;
      date: string;
      slot: string;
    }> = [
      { name: "Demo Tester", phone: "555-0100", email: "tester@example.com", date: dayOffset(4), slot: "1:00 PM" },
      { name: "Sample Client", phone: "555-0101", email: "sample@example.com", date: dayOffset(6), slot: "4:00 PM" },
    ];
    for (const a of seedAppointments) {
      await run(
        db,
        `INSERT INTO appointments
           (id, client_name, phone, email, booking_date, time_slot, status, payment_status,
            hold_expires_at, hold_secret, access_token, pronouns, idea_description, source,
            notes, reminder_sent_at, client_confirmed_at, reschedule_count, rescheduled_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'paid',
            NULL, NULL, ?, 'they/them', 'Demo idea (synthetic)', 'web',
            'SYNTHETIC PREVIEW DATA', NULL, NULL, 0, NULL, ?)`,
        newId(),
        a.name,
        a.phone,
        a.email,
        a.date,
        a.slot,
        crypto.randomUUID(),
        now,
      );
    }
  } catch (error) {
    // Seeding is best-effort; the booking flow must not depend on it.
    console.error("seedIfEmpty failed:", error);
    return;
  }
  seeded = true;
}
