/**
 * POST /api/public/holds-confirm — free lock-in for a pending hold.
 *
 * Body: { booking_id, hold_secret }.
 * Query-param style was chosen because CEO Owl establishes no dynamic
 * segment pattern ([id].ts) and SpaceFast Functions route files map to
 * static paths; the confirm contract therefore takes booking_id in the body.
 *
 * Preview: payments are disabled — confirmHold sets payment_status='paid'
 * as a free lock-in with no charge. Fires booking.confirmed webhook and
 * logs a mock session-pass email.
 */
import {
  checkRateLimit,
  confirmHold,
  mockEmail,
  resolveCaller,
} from "../../_core/booking";
import { first } from "../../_core/db";
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { fireWebhook } from "../../_core/webhooks";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env, ip } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  const caller = await resolveCaller(env.db, request, ip);
  const gate = await checkRateLimit(env.db, caller.hash, "write", caller.keyed);
  if (!gate.allowed) {
    return apiError(429, "rate_limited", "Rate limit exceeded. Try again soon.", {
      retryAfter: gate.retryAfterS,
    });
  }

  let body: { booking_id?: unknown; hold_secret?: unknown };
  try {
    body = (await request.json()) as { booking_id?: unknown; hold_secret?: unknown };
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }
  const bookingId = typeof body.booking_id === "string" ? body.booking_id : "";
  const holdSecret = typeof body.hold_secret === "string" ? body.hold_secret : "";
  if (!bookingId || !holdSecret) {
    return apiError(400, "missing_params", "booking_id and hold_secret are required.");
  }

  const result = await confirmHold(env.db, bookingId, holdSecret);
  if (result.status === "confirmed" && result.access_token) {
    const row = await first(
      env.db,
      "SELECT email, booking_date, time_slot FROM appointments WHERE id = ? LIMIT 1",
      bookingId,
    );
    mockEmail("session-pass", row ? String(row["email"] ?? "") : "", {
      booking_id: bookingId,
      pass_url: `/pass/${result.access_token}`,
      date: row ? String(row["booking_date"] ?? "") : "",
      time_slot: row ? String(row["time_slot"] ?? "") : "",
    });
    await fireWebhook(env.db, "booking.confirmed", {
      booking_id: bookingId,
      date: row ? String(row["booking_date"] ?? "") : "",
      time_slot: row ? String(row["time_slot"] ?? "") : "",
    });
  }

  return json({
    booking_id: result.booking_id,
    status: result.status,
    ...(result.access_token ? { access_token: result.access_token, pass_url: `/pass/${result.access_token}` } : {}),
    ...(result.status === "confirmed"
      ? { note: "Locked in free — payments are disabled in this preview." }
      : {}),
  });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
