/** Typed fetch wrappers around the preview public API (see docs/spacefast-contract.md §2.2). */

export const TZ = "America/Chicago";

export interface StudioInfo {
  name: string;
  address: string;
  map_url: string;
  hours: string;
  timezone: string;
  session_times: string[];
  deposit_copy: string;
  how_it_works: string[];
  website: string;
  demo: boolean;
}

/** Static fallback studio info — matches the contract's synthetic seed data. */
export const DEMO_STUDIO: StudioInfo = {
  name: "Fresh Ink Preview Studio",
  address: "123 Demo Street, Saint Paul, MN 55101",
  map_url: "",
  hours: "Mon–Fri 10:00 AM–7:00 PM, Sat 10:00 AM–5:00 PM",
  timezone: TZ,
  session_times: ["10:00 AM", "11:30 AM", "1:00 PM", "2:30 PM", "4:00 PM", "6:30 PM"],
  deposit_copy: "Payments are disabled in this preview — holds lock in free.",
  how_it_works: [
    "Pick a day and time for your session.",
    "Hold your slot — it stays reserved for 15 minutes.",
    "Lock it in free, no card, no charge.",
    "Get your session pass with calendar download.",
  ],
  website: "https://freshink-preview.view.fast/",
  demo: true,
};

export interface OpenDay {
  date: string; // YYYY-MM-DD
  times: string[];
}

export interface AvailabilityResponse {
  timezone: string;
  open: OpenDay[];
}

export interface HoldResponse {
  booking_id: string;
  status: string;
  hold_expires_in_minutes: number;
  hold_expires_at: string; // ISO-8601 UTC
  checkout_url: string;
}

export interface ConfirmResponse {
  booking_id: string;
  status: "confirmed" | "expired";
  access_token?: string;
  pass_url?: string;
}

export interface BookingStatus {
  booking_id: string;
  status: string;
  booking_date?: string;
  time_slot?: string;
  client_name?: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

export class ApiHttpError extends Error {
  status: number;
  body: ApiError | null;
  constructor(status: number, body: ApiError | null) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const body = (json ?? null) as ApiError | null;
    throw new ApiHttpError(res.status, body);
  }
  return json as T;
}

export async function getStudio(): Promise<StudioInfo> {
  try {
    return await request<StudioInfo>("/api/public/studio");
  } catch {
    return DEMO_STUDIO;
  }
}

export async function getAvailability(from: string, to: string): Promise<AvailabilityResponse> {
  return request<AvailabilityResponse>(
    `/api/public/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export interface HoldPayload {
  date: string;
  time_slot: string;
  name: string;
  email: string;
  phone: string;
  pronouns?: string;
  idea?: string;
}

export function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createHold(payload: HoldPayload): Promise<HoldResponse> {
  return request<HoldResponse>("/api/public/holds", {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey() },
    body: JSON.stringify(payload),
  });
}

export async function confirmHold(booking_id: string, hold_secret: string): Promise<ConfirmResponse> {
  return request<ConfirmResponse>("/api/public/holds-confirm", {
    method: "POST",
    body: JSON.stringify({ booking_id, hold_secret }),
  });
}

export async function getBooking(booking_id: string): Promise<BookingStatus> {
  return request<BookingStatus>(`/api/public/bookings?id=${encodeURIComponent(booking_id)}`);
}

export interface PassResult {
  ok: boolean;
  error?: string;
}

export async function passAction(body: Record<string, unknown>): Promise<PassResult> {
  try {
    return await request<PassResult>("/api/public/pass", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof ApiHttpError) {
      return { ok: false, error: err.body?.error ?? err.message };
    }
    throw err;
  }
}
