/**
 * GET /api/public/openapi.json — OpenAPI 3.1.0 spec for the public API.
 *
 * Hand-maintained. The time_slot enum carries the CORRECTED real six
 * slots (the source documented a stale ["9:00 AM","1:00 PM","5:00 PM"]).
 */
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { PREVIEW_BASE_URL, TIME_SLOTS } from "../../_core/studio";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");

  const server = PREVIEW_BASE_URL.replace(/\/$/, "");
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Fresh Ink Preview API",
      version: "1.0.0",
      description:
        "Demo booking API for the Fresh Ink Preview Studio. Synthetic data only; payments are disabled and bookings lock in free. All datetimes UTC; studio timezone America/Chicago.",
    },
    servers: [{ url: server }],
    paths: {
      "/api/public/studio": {
        get: {
          summary: "Studio info",
          responses: { "200": { description: "Static synthetic studio info." } },
        },
      },
      "/api/public/availability": {
        get: {
          summary: "Open dates and times",
          parameters: [
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
            {
              name: "time_slot",
              in: "query",
              schema: { type: "string", enum: [...TIME_SLOTS] },
            },
          ],
          responses: { "200": { description: "{ timezone, open: [{ date, times }] }" } },
        },
      },
      "/api/public/holds": {
        post: {
          summary: "Create a free 15-minute hold",
          parameters: [
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
            { name: "X-API-Key", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "phone", "email", "date", "time_slot"],
                  properties: {
                    name: { type: "string" },
                    phone: { type: "string" },
                    email: { type: "string", format: "email" },
                    date: { type: "string", format: "date" },
                    time_slot: { type: "string", enum: [...TIME_SLOTS] },
                    pronouns: { type: "string" },
                    idea_description: { type: "string" },
                    source: { type: "string", enum: ["web", "agent"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Hold created (pending, 15 min)." } },
        },
      },
      "/api/public/holds-confirm": {
        post: {
          summary: "Lock in a hold (free in preview)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["booking_id", "hold_secret"],
                  properties: {
                    booking_id: { type: "string" },
                    hold_secret: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "confirmed | expired" } },
        },
      },
      "/api/public/bookings": {
        get: {
          summary: "Booking status",
          parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Public booking fields; never exposes secrets." } },
        },
      },
      "/api/public/agent-keys": {
        post: {
          summary: "Mint an agent API key",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string", format: "email" }, label: { type: "string" } },
                },
              },
            },
          },
          responses: { "201": { description: "{ api_key } — raw key shown once." } },
        },
      },
      "/api/public/capabilities": {
        get: {
          summary: "Capability catalog",
          responses: { "200": { description: "Protocols, tools, rate limits, constraints." } },
        },
      },
      "/api/public/webhooks": {
        post: {
          summary: "Subscribe to webhook events",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "events"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    events: { type: "array", items: { type: "string", enum: ["hold.created", "booking.confirmed"] } },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "{ id, secret, manage_token } — shown once." } },
        },
        get: {
          summary: "List subscriptions",
          parameters: [{ name: "manage_token", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Subscriptions without secrets." } },
        },
        delete: {
          summary: "Delete a subscription",
          parameters: [
            { name: "manage_token", in: "query", required: true, schema: { type: "string" } },
            { name: "id", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "{ deleted: true }" } },
        },
      },
      "/api/public/events": {
        get: {
          summary: "SSE availability snapshot",
          responses: { "200": { description: "text/event-stream; snapshot then close." } },
        },
      },
      "/api/public/pass": {
        post: {
          summary: "Session-pass actions",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action", "access_token"],
                  properties: {
                    action: { type: "string", enum: ["confirm", "reschedule"] },
                    access_token: { type: "string" },
                    new_date: { type: "string", format: "date" },
                    new_time_slot: { type: "string", enum: [...TIME_SLOTS] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Attendance confirmation or reschedule result." } },
        },
      },
      "/api/public/mcp": {
        get: { summary: "MCP service info", responses: { "200": { description: "Service info JSON." } } },
        post: {
          summary: "MCP JSON-RPC endpoint",
          description:
            "initialize, notifications/initialized, ping, tools/list, tools/call. Batch arrays max 10. CORS *.",
          responses: { "200": { description: "JSON-RPC 2.0 response." } },
        },
      },
      "/api/health": {
        get: {
          summary: "Health check",
          responses: { "200": { description: "{ ok: true, preview: true }" } },
        },
      },
    },
  };
  return json(spec);
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
