/**
 * Per-request context for SpaceFast function routes.
 * Adapted from CEO Owl's functions/_core/request.ts.
 *
 * FreshInk preview has no session auth (no SESSION_SECRET): booking flows
 * are gated by per-hold `hold_secret` and per-booking `access_token`;
 * agent API keys are self-service. The DB binding is the only env required.
 */
import { ensureSchema, seedIfEmpty, type SpacefastDb } from "./db";

export interface CoreEnv {
  db: SpacefastDb;
}

export interface CoreContext {
  env: CoreEnv;
  /** Caller IP as resolved from proxy headers, or "unknown". */
  ip: string;
}

/** The context object the SpaceFast runtime passes alongside the request. */
export interface RouteContext {
  request: Request;
  params: Record<string, string | string[] | undefined>;
  env: Record<string, unknown>;
}

export function getClientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export async function initRequest(request: Request, context: RouteContext): Promise<CoreContext> {
  const rawDb = context.env["DB"];
  if (!rawDb || typeof (rawDb as { prepare?: unknown }).prepare !== "function") {
    throw new Error("The database binding (env.DB) is not configured for this space.");
  }
  const db = rawDb as SpacefastDb;
  await ensureSchema(db);
  await seedIfEmpty(db);
  return { env: { db }, ip: getClientIp(request) };
}
