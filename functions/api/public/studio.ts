/**
 * GET /api/public/studio — static studio info (synthetic demo data).
 */
import { apiError, json, withErrors } from "../../_core/http";
import { initRequest, type RouteContext } from "../../_core/request";
import { STUDIO_INFO } from "../../_core/studio";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");
  return json({ ...STUDIO_INFO });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
