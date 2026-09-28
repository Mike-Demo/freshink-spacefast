/**
 * POST /api/public/agent-keys — self-service API key minting.
 *
 * Body: { email, label? }.
 * Returns { api_key: "fk_..." } — the raw key is shown ONCE; only its
 * sha256 hex is stored (agent_api_keys.key_hash).
 * Keyed callers get the higher rate-limit tier (600 reads/min, 30 writes/hour).
 */
import { sha256Hex } from "../../_core/booking";
import { newId, randomHex, run } from "../../_core/db";
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "POST") return apiError(405, "invalid_request", "Method not allowed.");

  let body: { email?: unknown; label?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; label?: unknown };
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return apiError(400, "invalid_email", "A valid email address is required.");
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : null;

  const apiKey = `fk_${randomHex(24)}`; // 48 hex chars after the prefix
  const keyHash = await sha256Hex(apiKey);
  await run(
    env.db,
    `INSERT INTO agent_api_keys (id, key_hash, email, label, last_used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    newId(),
    keyHash,
    email,
    label,
    new Date().toISOString(),
  );

  return json(
    {
      api_key: apiKey,
      email,
      label,
      note: "This is the only time the raw key is shown. Send it as the X-API-Key header.",
    },
    201,
  );
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
