/**
 * GET/POST /api/public/mcp — hand-rolled MCP JSON-RPC 2.0 (Streamable HTTP).
 *
 * - GET  -> service info JSON.
 * - POST -> single or batch (max 10) JSON-RPC requests:
 *   initialize, notifications/initialized, ping, tools/list, tools/call.
 * - CORS `*` on every response.
 *
 * Tools: get_studio_info, list_open_times, hold_slot, get_booking_status.
 * Callers authenticate optionally via X-API-Key (self-service, minted at
 * POST /api/public/agent-keys); otherwise the caller is the hashed IP.
 */
import {
  checkRateLimit,
  createHold,
  getBookingStatus,
  listOpenTimes,
  mockEmail,
  resolveCaller,
  withIdempotency,
  type CreateHoldInput,
} from "../../_core/booking";
import { InputError, json, withErrors } from "../../_core/http";
import { initRequest, type CoreEnv, type RouteContext } from "../../_core/request";
import { PREVIEW_BASE_URL, STUDIO_INFO } from "../../_core/studio";
import { fireWebhook } from "../../_core/webhooks";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

function corsJson(body: unknown, status = 200): Response {
  return json(body, status, CORS);
}

function rpcError(id: unknown, code: number, message: string): Response {
  return corsJson({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function rpcResult(id: unknown, result: unknown): Response {
  return corsJson({ jsonrpc: "2.0", id, result });
}

/** MCP tool-call envelope: text content + structured content. */
function toolResult(payload: Record<string, unknown>, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function toolFailure(code: string, message: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return toolResult({ error: { code, message, ...(extra ?? {}) } }, true);
}

const TOOLS = [
  {
    name: "get_studio_info",
    title: "Get studio info",
    description:
      "Static info about the Fresh Ink Preview Studio: name, demo address (Saint Paul MN), hours, timezone (America/Chicago), session times, and how booking works. Payments are disabled in this preview; demo bookings are free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_open_times",
    title: "List open times",
    description:
      "List open booking dates and time slots between from and to (YYYY-MM-DD, max 31-day range; defaults to today through +13 days). Elapsed same-day slots (America/Chicago) are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD. Defaults to today." },
        to: { type: "string", description: "End date YYYY-MM-DD. Defaults to from + 13 days." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "hold_slot",
    title: "Hold a slot",
    description:
      "Create a free 15-minute hold on an open slot. Returns booking_id plus a checkout URL for the client to lock in the slot (free in this preview — no payment). The hold expires after 15 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Booking date YYYY-MM-DD. Required." },
        time_slot: { type: "string", description: "One of the six session slots. Required." },
        name: { type: "string", description: "Client name. Required." },
        email: { type: "string", description: "Client email. Required." },
        phone: { type: "string", description: "Client phone (at least 7 digits). Required." },
        pronouns: { type: "string", description: "Client pronouns. Optional." },
        idea: { type: "string", description: "Tattoo idea description. Optional." },
        idempotency_key: {
          type: "string",
          description: "Optional key to make the hold creation idempotent.",
        },
      },
      required: ["date", "time_slot", "name", "email", "phone"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_booking_status",
    title: "Get booking status",
    description:
      "Look up a booking by id. Returns pending, confirmed, expired, cancelled, or not_found (holds expire lazily after 15 minutes).",
    inputSchema: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "The booking id returned by hold_slot. Required." },
      },
      required: ["booking_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

async function callTool(
  env: CoreEnv,
  request: Request,
  ip: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const caller = await resolveCaller(env.db, request, ip);

  if (name !== "hold_slot") {
    const gate = await checkRateLimit(env.db, caller.hash, "read", caller.keyed);
    if (!gate.allowed) {
      return toolFailure("rate_limited", "Rate limit exceeded. Try again soon.", {
        retry_after_s: gate.retryAfterS,
      });
    }
  }
  let writeRetryAfterS = 60;

  try {
    if (name === "get_studio_info") {
      return toolResult({ ...STUDIO_INFO });
    }

    if (name === "list_open_times") {
      const from = typeof args["from"] === "string" ? args["from"] : undefined;
      const to = typeof args["to"] === "string" ? args["to"] : undefined;
      return toolResult(await listOpenTimes(env.db, from, to));
    }

    if (name === "get_booking_status") {
      const bookingId = typeof args["booking_id"] === "string" ? args["booking_id"] : "";
      if (!bookingId) return toolFailure("invalid_params", "booking_id is required.");
      return toolResult({ booking_id: bookingId, status: await getBookingStatus(env.db, bookingId) });
    }

    if (name === "hold_slot") {
      const input: CreateHoldInput = {
        name: typeof args["name"] === "string" ? args["name"] : "",
        phone: typeof args["phone"] === "string" ? args["phone"] : "",
        email: typeof args["email"] === "string" ? args["email"] : "",
        date: typeof args["date"] === "string" ? args["date"] : "",
        time_slot: typeof args["time_slot"] === "string" ? args["time_slot"] : "",
        pronouns: typeof args["pronouns"] === "string" ? args["pronouns"] : undefined,
        idea_description: typeof args["idea"] === "string" ? args["idea"] : undefined,
        source: "agent",
      };
      const idempotencyKey =
        typeof args["idempotency_key"] === "string" && args["idempotency_key"].length > 0
          ? args["idempotency_key"]
          : null;

      const doHold = async (): Promise<Record<string, unknown>> => {
        const gate = await checkRateLimit(env.db, caller.hash, "write", caller.keyed);
        writeRetryAfterS = gate.retryAfterS;
        if (!gate.allowed) {
          throw new InputError("rate_limited", "Rate limit exceeded. Try again soon.", 429);
        }
        const hold = await createHold(env.db, input, {
          callerHash: caller.hash,
          isAgent: true,
        });
        mockEmail("hold-created", input.email, {
          booking_id: hold.booking_id,
          date: input.date,
          time_slot: input.time_slot,
        });
        await fireWebhook(env.db, "hold.created", {
          booking_id: hold.booking_id,
          date: input.date,
          time_slot: input.time_slot,
          source: "agent",
        });
        return {
          booking_id: hold.booking_id,
          status: "pending",
          hold_expires_in_minutes: 15,
          hold_expires_at: hold.hold_expires_at,
          checkout_url: `/checkout/${hold.booking_id}?s=${hold.hold_secret}`,
          note: "Free demo booking — payments are disabled in this preview.",
        };
      };

      const result = idempotencyKey
        ? (await withIdempotency(env.db, idempotencyKey, caller.hash, doHold)).response
        : await doHold();
      return toolResult(result);
    }

    return toolFailure("unknown_tool", `Unknown tool: ${name}.`);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "tool_error";
    const message = error instanceof Error ? error.message : "Tool call failed.";
    const status = error instanceof Error && "status" in error ? Number((error as { status: unknown }).status) : 500;
    return toolFailure(code, message, status === 429 ? { retry_after_s: writeRetryAfterS } : undefined);
  }
}

/**
 * Handles one JSON-RPC object. Returns a Response, or null for
 * notifications (no id) which per spec produce no response.
 */
async function handleOne(
  env: CoreEnv,
  request: Request,
  ip: string,
  body: JsonRpcRequest,
): Promise<Response | null> {
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body.id ?? null, -32600, "Invalid Request: expected a JSON-RPC 2.0 object.");
  }
  const { id, method, params } = body;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    const res = rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "freshink-preview", version: "1.0.0" },
    });
    return isNotification ? null : res;
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return isNotification ? null : rpcResult(id, {});

  if (method === "tools/list") {
    return isNotification ? null : rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const p = (params ?? {}) as ToolCallParams;
    const name = typeof p.name === "string" ? p.name : "";
    if (!TOOLS.some((t) => t.name === name)) {
      return isNotification ? null : rpcError(id, -32602, `Unknown tool: ${name}.`);
    }
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    const result = await callTool(env, request, ip, name, args);
    return isNotification ? null : rpcResult(id, result);
  }

  return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}.`);
}

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env, ip } = await initRequest(request, context);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === "GET") {
    return corsJson({
      name: "freshink-preview",
      description:
        "Fresh Ink Preview Studio — demo booking MCP. Synthetic data only; payments are disabled.",
      protocol: "mcp",
      transport: "streamable-http",
      endpoint: "/api/public/mcp",
      tools: TOOLS.map((t) => t.name),
      website: PREVIEW_BASE_URL,
    });
  }
  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed.", code: "invalid_request" }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: request body must be JSON.");
  }

  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32600, "Invalid Request: empty batch.");
    if (body.length > 10) {
      return rpcError(null, -32600, "Invalid Request: batch limited to 10 requests.");
    }
    const responses: Response[] = [];
    for (const item of body) {
      const res = await handleOne(env, request, ip, (item ?? {}) as JsonRpcRequest);
      if (res) responses.push(res);
    }
    if (responses.length === 0) return new Response(null, { status: 204, headers: CORS });
    const payloads = await Promise.all(responses.map((r) => r.json()));
    return corsJson(payloads);
  }

  const res = await handleOne(env, request, ip, (body ?? {}) as JsonRpcRequest);
  return res ?? new Response(null, { status: 204, headers: CORS });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

