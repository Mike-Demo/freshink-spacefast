/**
 * GET /api/public/bookings?id= — booking status by id.
 *
 * Query-param style (no dynamic [id] segment) per the CEO Owl routing
 * pattern. Returns public fields only; hold_secret is never exposed.
 */
import { checkRateLimit, getBookingStatus, publicBooking, resolveCaller } from "../../_core/booking";
import { first } from "../../_core/db";
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env, ip } = await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");

  const caller = await resolveCaller(env.db, request, ip);
  const gate = await checkRateLimit(env.db, caller.hash, "read", caller.keyed);
  if (!gate.allowed) {
    return apiError(429, "rate_limited", "Rate limit exceeded. Try again soon.", {
      retryAfter: gate.retryAfterS,
    });
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return apiError(400, "missing_params", "id is required.");
  const status = await getBookingStatus(env.db, id);
  if (status === "not_found") return apiError(404, "not_found", "No booking with that id.");

  const row = await first(env.db, "SELECT * FROM appointments WHERE id = ? LIMIT 1", id);
  if (!row) return apiError(404, "not_found", "No booking with that id.");
  const out = publicBooking(row);
  out["status"] = status; // lazy expiry applied
  return json(out);
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
