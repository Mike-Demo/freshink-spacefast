/**
 * POST /api/public/pass — session-pass actions, gated by access_token.
 *
 * Body: { action: "confirm" | "reschedule", access_token, new_date?, new_time_slot? }
 * - confirm    -> attendance confirmation (client_confirmed_at)
 * - reschedule -> move a confirmed booking (max 3, 24h cutoff, new slot must be open)
 */
import { checkRateLimit, confirmAttendance, reschedule, resolveCaller } from "../../_core/booking";
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";

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

  let body: {
    action?: unknown;
    access_token?: unknown;
    new_date?: unknown;
    new_time_slot?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }

  const action = typeof body.action === "string" ? body.action : "";
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) return apiError(400, "missing_params", "access_token is required.");

  if (action === "confirm") {
    const result = await confirmAttendance(env.db, accessToken);
    return json({ ...result, status: "confirmed" });
  }

  if (action === "reschedule") {
    const newDate = typeof body.new_date === "string" ? body.new_date : "";
    const newSlot = typeof body.new_time_slot === "string" ? body.new_time_slot : "";
    if (!newDate || !newSlot) {
      return apiError(400, "missing_params", "new_date and new_time_slot are required for reschedule.");
    }
    const result = await reschedule(env.db, accessToken, newDate, newSlot);
    return json({ ...result, status: "confirmed" });
  }

  return apiError(400, "invalid_action", 'action must be "confirm" or "reschedule".');
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
