/**
 * /api/public/webhooks — webhook subscription management.
 *
 * - POST   { url, events[] }        -> subscribe; returns { id, url, events, secret, manage_token }
 *                                      (raw secret + manage_token shown ONCE)
 * - GET    ?manage_token=           -> list subscriptions (secrets never returned)
 * - DELETE ?manage_token=&id=       -> delete (id also accepted in a JSON body)
 *
 * Deliveries: POST signed JSON with X-FreshInk-Signature (HMAC-SHA256 hex)
 * and X-FreshInk-Event headers. Best-effort; receivers' failures are logged.
 */
import { all, newId, randomHex, run, type SpacefastDb } from "../../_core/db";
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { KNOWN_EVENTS } from "../../_core/webhooks";

async function requireManageToken(
  db: SpacefastDb,
  manageToken: string | null,
): Promise<Record<string, unknown>[]> {
  if (!manageToken) throw Object.assign(new Error("manage_token is required."), { httpStatus: 401, code: "unauthorized" });
  const rows = await all(
    db,
    "SELECT id, url, events, created_at FROM webhook_subscriptions WHERE manage_token = ?",
    manageToken,
  );
  if (rows.length === 0) {
    throw Object.assign(new Error("Unknown manage_token."), { httpStatus: 401, code: "unauthorized" });
  }
  return rows;
}

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  const url = new URL(request.url);

  if (request.method === "POST") {
    let body: { url?: unknown; events?: unknown };
    try {
      body = (await request.json()) as { url?: unknown; events?: unknown };
    } catch {
      return apiError(400, "invalid_json", "Request body must be JSON.");
    }
    const target = typeof body.url === "string" ? body.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return apiError(400, "invalid_url", "url must be a valid absolute URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return apiError(400, "invalid_url", "url must use http or https.");
    }
    const events = Array.isArray(body.events)
      ? body.events.filter((e): e is string => typeof e === "string")
      : [];
    if (events.length === 0 || !events.every((e) => (KNOWN_EVENTS as readonly string[]).includes(e))) {
      return apiError(
        400,
        "invalid_events",
        `events must be a non-empty array of: ${KNOWN_EVENTS.join(", ")}.`,
      );
    }

    const id = newId();
    const secret = randomHex(16);
    const manageToken = `fmt_${randomHex(24)}`;
    await run(
      env.db,
      `INSERT INTO webhook_subscriptions (id, url, secret, manage_token, events, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      target,
      secret,
      manageToken,
      JSON.stringify(events),
      new Date().toISOString(),
    );
    return json(
      {
        id,
        url: target,
        events,
        secret,
        manage_token: manageToken,
        note: "secret and manage_token are shown only once. Deliveries are signed with X-FreshInk-Signature (HMAC-SHA256 hex).",
      },
      201,
    );
  }

  if (request.method === "GET") {
    const manageToken = url.searchParams.get("manage_token");
    try {
      const rows = await requireManageToken(env.db, manageToken);
      return json({
        subscriptions: rows.map((row) => ({
          id: String(row["id"]),
          url: String(row["url"]),
          events: JSON.parse(String(row["events"] ?? "[]")) as string[],
          created_at: String(row["created_at"]),
        })),
      });
    } catch (error) {
      const e = error as { httpStatus?: number; code?: string; message?: string };
      return apiError(e.httpStatus ?? 500, e.code ?? "internal_error", e.message ?? "Error.");
    }
  }

  if (request.method === "DELETE") {
    const manageToken = url.searchParams.get("manage_token");
    let id = url.searchParams.get("id");
    if (!id) {
      try {
        const body = (await request.json()) as { id?: unknown };
        if (typeof body.id === "string") id = body.id;
      } catch {
        // fall through to the missing-id error
      }
    }
    if (!id) return apiError(400, "missing_params", "id is required (query param or JSON body).");
    try {
      await requireManageToken(env.db, manageToken);
    } catch (error) {
      const e = error as { httpStatus?: number; code?: string; message?: string };
      return apiError(e.httpStatus ?? 500, e.code ?? "internal_error", e.message ?? "Error.");
    }
    await run(
      env.db,
      "DELETE FROM webhook_subscriptions WHERE manage_token = ? AND id = ?",
      manageToken,
      id,
    );
    return json({ deleted: true, id });
  }

  return apiError(405, "invalid_request", "Method not allowed.");
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
