/**
 * Outbound webhooks: POST signed JSON to subscriber URLs, best-effort.
 *
 * Signature: X-FreshInk-Signature = HMAC-SHA256 hex of the raw JSON body,
 * keyed by the subscription secret (Web Crypto). Event name in
 * X-FreshInk-Event. Delivery failures are logged, never thrown.
 *
 * Advertised events: hold.created, booking.confirmed.
 * (hold.expired is still not fired, as in the source — documented.)
 */
import { all, type SpacefastDb } from "./db";

export const KNOWN_EVENTS = ["hold.created", "booking.confirmed"] as const;

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fireWebhook(
  db: SpacefastDb,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await all(
    db,
    "SELECT id, url, secret, events FROM webhook_subscriptions",
  );
  const body = JSON.stringify({
    event,
    fired_at: new Date().toISOString(),
    data: payload,
  });
  for (const sub of subs) {
    let events: string[];
    try {
      events = JSON.parse(String(sub["events"] ?? "[]")) as string[];
    } catch {
      continue;
    }
    if (!events.includes(event)) continue;
    const url = String(sub["url"] ?? "");
    const secret = String(sub["secret"] ?? "");
    if (!url || !secret) continue;
    try {
      const signature = await hmacHex(secret, body);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FreshInk-Signature": signature,
          "X-FreshInk-Event": event,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.error(`webhook ${event} to ${url}: HTTP ${res.status}`);
      }
    } catch (error) {
      // Best-effort: a dead receiver must not break the booking flow.
      console.error(`webhook ${event} to ${url} failed:`, error);
    }
  }
}
