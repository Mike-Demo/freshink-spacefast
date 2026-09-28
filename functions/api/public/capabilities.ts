/**
 * GET /api/public/capabilities — capability catalog: protocols, tools,
 * rate limits, webhook events, and preview constraints for agent builders.
 */
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { PREVIEW_BASE_URL } from "../../_core/studio";
import { TIME_SLOTS } from "../../_core/studio";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");
  return json({
    name: "freshink-preview",
    demo: true,
    base_url: PREVIEW_BASE_URL,
    protocols: ["mcp", "rest", "sse", "webhooks"],
    mcp_endpoint: "/api/public/mcp",
    rest: {
      studio: "GET /api/public/studio",
      availability: "GET /api/public/availability?from=&to=",
      create_hold: "POST /api/public/holds",
      confirm_hold: "POST /api/public/holds-confirm",
      booking_status: "GET /api/public/bookings?id=",
      agent_keys: "POST /api/public/agent-keys",
      webhooks: "POST|GET|DELETE /api/public/webhooks",
      events: "GET /api/public/events",
      pass: "POST /api/public/pass",
      openapi: "GET /api/public/openapi.json",
    },
    tools: ["get_studio_info", "list_open_times", "hold_slot", "get_booking_status"],
    time_slots: [...TIME_SLOTS],
    timezone: "America/Chicago",
    hold_minutes: 15,
    reschedule: { max: 3, cutoff_hours: 24 },
    rate_limits: {
      anonymous: { reads_per_minute: 60, writes_per_hour: 5 },
      keyed: { reads_per_minute: 600, writes_per_hour: 30 },
    },
    authentication: {
      agent_keys: "X-API-Key header (self-service at POST /api/public/agent-keys)",
      hold: "hold_secret in checkout URL",
      pass: "access_token in pass URL",
    },
    webhook_events: ["hold.created", "booking.confirmed"],
    constraints: [
      "Payments are disabled in this preview — bookings lock in free.",
      "Email is mocked (console log only). SMS is simulated.",
      "All data is synthetic demo data; the studio address is fictional.",
      "hold.expired webhook is advertised but never fired (as in the source).",
    ],
  });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
