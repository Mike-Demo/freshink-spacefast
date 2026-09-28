/**
 * GET /api/public/events — SSE availability feed (simplified).
 *
 * Sends an availability snapshot (next 14 days, elapsed same-day slots
 * excluded) plus studio info, then closes. No infinite stream, no
 * heartbeat — the preview needs no long-lived connections.
 */
import { checkRateLimit, chicagoToday, listOpenTimes, resolveCaller } from "../../_core/booking";
import { apiError, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { STUDIO_INFO } from "../../_core/studio";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

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

  const today = chicagoToday();
  const availability = await listOpenTimes(env.db, today, addDays(today, 13));

  const events = [
    { event: "studio_info", data: { name: STUDIO_INFO.name, demo: true, timezone: STUDIO_INFO.timezone } },
    { event: "availability_snapshot", data: availability },
    { event: "end", data: { note: "Snapshot complete; reconnect for a fresh snapshot." } },
  ];
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "close",
    },
  });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
