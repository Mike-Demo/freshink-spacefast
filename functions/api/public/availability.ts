/**
 * GET /api/public/availability?from=&to= — open dates/times.
 *
 * from/to are YYYY-MM-DD (max 31-day range; defaults to today + 13 days).
 * Elapsed same-day slots (America/Chicago) are excluded — the confirmed-bug
 * fix. Optional ?time_slot= filters to a single slot label.
 */
import { listOpenTimes, resolveCaller, checkRateLimit } from "../../_core/booking";
import { TIME_SLOTS } from "../../_core/studio";
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

  const url = new URL(request.url);
  const slotFilter = url.searchParams.get("time_slot");
  if (slotFilter && !(TIME_SLOTS as readonly string[]).includes(slotFilter)) {
    return apiError(
      400,
      "invalid_time_slot",
      `time_slot must be one of: ${TIME_SLOTS.join(", ")}.`,
    );
  }

  const result = await listOpenTimes(
    env.db,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  if (slotFilter) {
    result.open = result.open.map((day) => ({
      date: day.date,
      times: day.times.filter((t) => t === slotFilter),
    }));
  }
  return json(result);
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
