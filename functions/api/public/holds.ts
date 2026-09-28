/**
 * POST /api/public/holds — create a free 15-minute hold on an open slot.
 *
 * Body: { name, phone, email, date, time_slot, pronouns?, idea_description?, source? }
 * Supports Idempotency-Key header (replays the stored response).
 * Fires the hold.created webhook (best-effort) and logs a mock hold email.
 */
import {
  checkRateLimit,
  createHold,
  mockEmail,
  resolveCaller,
  withIdempotency,
  type CreateHoldInput,
} from "../../_core/booking";
import { apiError, InputError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { fireWebhook } from "../../_core/webhooks";

interface HoldBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  date?: unknown;
  time_slot?: unknown;
  pronouns?: unknown;
  idea_description?: unknown;
  source?: unknown;
}

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env, ip } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  const caller = await resolveCaller(env.db, request, ip);

  let body: HoldBody;
  try {
    body = (await request.json()) as HoldBody;
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }

  const input: CreateHoldInput = {
    name: typeof body.name === "string" ? body.name : "",
    phone: typeof body.phone === "string" ? body.phone : "",
    email: typeof body.email === "string" ? body.email : "",
    date: typeof body.date === "string" ? body.date : "",
    time_slot: typeof body.time_slot === "string" ? body.time_slot : "",
    pronouns: typeof body.pronouns === "string" ? body.pronouns : undefined,
    idea_description: typeof body.idea_description === "string" ? body.idea_description : undefined,
    source: body.source === "agent" ? "agent" : "web",
  };
  const isAgent = caller.keyed || input.source === "agent";
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || null;

  let retryAfterS = 60;
  const makeHold = async (): Promise<Record<string, unknown>> => {
    const gate = await checkRateLimit(env.db, caller.hash, "write", caller.keyed);
    retryAfterS = gate.retryAfterS;
    if (!gate.allowed) {
      throw new InputError("rate_limited", "Rate limit exceeded. Try again soon.", 429);
    }
    const hold = await createHold(env.db, input, { callerHash: caller.hash, isAgent });
    mockEmail("hold-created", input.email, {
      booking_id: hold.booking_id,
      date: input.date,
      time_slot: input.time_slot,
    });
    await fireWebhook(env.db, "hold.created", {
      booking_id: hold.booking_id,
      date: input.date,
      time_slot: input.time_slot,
      source: isAgent ? "agent" : "web",
    });
    return {
      booking_id: hold.booking_id,
      status: "pending",
      hold_expires_in_minutes: 15,
      hold_expires_at: hold.hold_expires_at,
      checkout_url: `/checkout/${hold.booking_id}?s=${hold.hold_secret}`,
    };
  };

  try {
    const { response, replayed } = idempotencyKey
      ? await withIdempotency(env.db, idempotencyKey, caller.hash, makeHold)
      : { response: await makeHold(), replayed: false };
    return json(replayed ? { ...response, idempotent_replay: true } : response);
  } catch (error) {
    if (error instanceof InputError && error.code === "rate_limited") {
      return apiError(429, "rate_limited", `Rate limit exceeded. Try again in ${retryAfterS} seconds.`, {
        retryAfter: retryAfterS,
      });
    }
    throw error;
  }
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
