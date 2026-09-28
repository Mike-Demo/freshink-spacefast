# FreshInk (freshink.art) — SpaceFast Migration Contract

**Source repo:** `Mike-Demo/charm-project-place` (Lovable Cloud, TanStack Start + Supabase Postgres)
**Migration repo:** `Mike-Demo/freshink-spacefast` (created 2026-09-28, standalone repo)
**Migration branch:** `spacefast-migration`
**Preview space:** `freshink-preview` (to be created)
**Preview URL:** `https://freshink-preview.view.fast/` (expected)
**Date:** 2026-09-28

Full source inventory: [docs/inventory.md](./inventory.md).

---

## 1. What this migration is

An isolated, synthetic-data-only preview of FreshInk's booking system on SpaceFast. It proves the booking flow, availability engine, hold lifecycle, and public MCP/REST agent APIs work on SpaceFast Functions + D1/MySQL-shaped DB — without touching Lovable production, without real payments, without real emails/SMS, and without any production data.

**Non-goals (explicitly out of scope for the preview):**
- No production cutover. Lovable production (freshink.art) stays authoritative.
- No real Paddle wiring. No real email delivery. No real SMS.
- No admin ledger UI (deferred; data model kept).
- No AI concept-sketch generation (needs Lovable AI gateway).
- No file uploads / private tattoo-ideas bucket (deferred; idea text fields kept).
- No reminder cron (deferred; data model kept).

---

## 2. Source → SpaceFast mapping

### 2.1 Frontend: TanStack Start SSR → static React SPA

| Source route | Preview route | Notes |
|---|---|---|
| `/` (8-step booking wizard) | `/` | Port wizard to static SPA; hold creation via `POST /api/public/holds`; free lock-in via `POST /api/public/holds/{id}/confirm` |
| `/agents` | `/agents` | Agent docs; update MCP address to preview URL; keep config snippet + curl example |
| `/checkout/$id` | `/checkout/$id` | Shows hold details + **"Payments disabled in preview" interstitial** + free lock-in button |
| `/pass/$token` | `/pass/$token` | Session pass: booking details, .ics download (client-generated), attendance confirm, reschedule (max 3, 24h cutoff) |
| `/pass_/$token/confirm` | folded into `/pass/$token` | Attendance confirm action on the pass page |
| `/licenses` | `/licenses` | Credits page (drop Lovable-specific credits, keep typeface/OSS) |
| `/auth`, `/_authenticated/admin` | **dropped** | Admin ledger deferred; no auth UI in preview |
| `/projects`, `/projects/fresh-ink` | **dropped** | Lovable template boilerplate |
| `/lovable/email/transactional/preview` | **dropped** | Lovable scaffold |
| `/sitemap.xml` | `/sitemap.xml` | Static; lists `/`, `/agents`, `/licenses` only |
| `/health` | `/health` | Simple JSON health check (new, preview-only) |

SPA fallback via `_redirects` (same pattern as CEO Owl).

### 2.2 Backend: TanStack server functions + plpgsql → SpaceFast Functions

File layout (mirrors CEO Owl's `functions/`):

```
functions/
  _core/
    db.ts          # D1 wrapper + ensureSchema (all tables, idempotent DDL)
    booking.ts     # holds, availability, tokens, rate limits, idempotency
                   # (ports the 14 plpgsql functions' logic to TypeScript)
    http.ts        # json/apiError/withErrors (copy from CEO Owl)
    request.ts     # initRequest, CoreEnv, getClientIp (copy from CEO Owl)
    studio.ts      # static studio info, TIME_SLOTS, copy
    webhooks.ts    # outbound webhook signing/delivery (HMAC-SHA256 via Web Crypto)
  api/public/
    mcp.ts            # POST/GET /api/public/mcp (JSON-RPC: initialize, tools/list, tools/call)
    studio.ts         # GET /api/public/studio
    availability.ts   # GET /api/public/availability
    holds.ts          # POST /api/public/holds (create hold, idempotent)
    holds-confirm.ts  # POST /api/public/holds/{id}/confirm (free lock-in; route as holds/[id]/confirm.ts if dynamic segments work, else query param)
    bookings.ts       # GET /api/public/bookings/{id} (status)
    agent-keys.ts     # POST /api/public/agent-keys (self-service key minting)
    capabilities.ts   # GET /api/public/capabilities
    webhooks.ts       # POST/GET/DELETE /api/public/webhooks (subscribe/list/delete)
    events.ts         # GET /api/public/events (SSE snapshot; simplified: snapshot + close)
    openapi.ts        # GET /api/public/openapi.json (corrected: real 6-slot enum)
```

**Dynamic segments:** CEO Owl has no dynamic function routes. If SpaceFast Functions doesn't support `[id].ts`, use query params (`/api/public/bookings?id=...`) or a single `bookings.ts` that parses the path. The build agent must verify routing live and adapt.

### 2.3 Database: Supabase Postgres → D1/MySQL-shaped DB

Tables to create in `ensureSchema` (all `IF NOT EXISTS`):

- `appointments` — core booking table. Columns: id (uuid text PK), client_name, phone, email, booking_date (TEXT YYYY-MM-DD), time_slot (TEXT), status (TEXT: pending/confirmed/expired/cancelled), payment_status (TEXT: pending/paid/expired), hold_expires_at (TEXT ISO-8601 UTC), hold_secret (TEXT), access_token (TEXT UNIQUE), pronouns, idea_description, source (TEXT: web/agent), notes, reminder_sent_at, client_confirmed_at, reschedule_count (INT), rescheduled_at, created_at.
  - **Dropped columns:** `paddle_transaction_id` (no Paddle), `reference_image_path`/`concept_sketch_path`/`sketch_attempts` (no uploads), `day_of_sent_at`/`aftercare_sent_at`/`social_sent_at` (no lifecycle email), `sms_reminder_status`/`sms_reminder_at` (no SMS).
  - **Double-booking guard:** D1/MySQL has no partial unique indexes. Enforce in app code: before inserting a hold, `SELECT` for conflicting rows (`status IN ('pending','confirmed')` with `hold_expires_at > now()` for pending) on `(booking_date, time_slot)`; rely on the check-then-insert inside a single function invocation. Document the race as a known preview limitation.
- `blocked_slots` — id, blocked_date (TEXT), time_slot (TEXT NULL = whole day), reason.
- `agent_api_keys` — id, key_hash (sha256 hex), email, label, last_used_at.
- `agent_hold_log` — caller_hash, appointment_id, created_at.
- `api_rate_log` — caller_hash, bucket, created_at.
- `idempotency_keys` — key (TEXT PK), caller_hash, response (TEXT JSON), created_at.
- `webhook_subscriptions` — id, url, secret, manage_token, events (TEXT JSON array), created_at.
- `reminder_runs` — kept for schema completeness (no cron in preview): ran_at, skipped_reason, sent, suppressed, failed.
- `cron_tokens` — kept for schema completeness (unused in preview).
- `user_roles` — kept for schema completeness (no admin UI in preview).

**Timezone:** America/Chicago. D1 has no `timestamptz`/`at time zone`. All datetimes stored as ISO-8601 UTC strings; Chicago "today" and slot-elapsed checks computed in TypeScript via `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'`.

**IDs/tokens:** `crypto.randomUUID()` for ids; `crypto.getRandomValues` hex for hold_secret/access_token (32+ chars); sha256 hex via Web Crypto for key_hash.

### 2.4 Business logic ported from plpgsql (in `functions/_core/booking.ts`)

- `create_pending_appointment` → `createHold()`: validate name/phone/email; reject past dates; **reject elapsed same-day slots (America/Chicago)**; check blocked_slots; expire stale pendings on the same slot opportunistically; check double-booking; insert pending hold (15-min expiry); return `{id, hold_secret}`.
- `confirm_free_hold` → `confirmHold()`: verify hold_secret; reject if expired (mark expired); set confirmed/paid; clear hold_secret; fire `booking.confirmed` webhook (mocked email noted).
- `get_unavailable_slots` → `getUnavailableSlots()`: confirmed bookings + live pending holds + blocked_slots for date range.
- `get_booking_status` → `getBookingStatus()`: lazy expiry computation.
- `confirm_attendance`, reschedule (max 3, 24h cutoff) → pass-page actions.
- Rate limits: anonymous 60 reads/min + 5 writes/hour; keyed 600 reads/min + 30 writes/hour (caller = API key hash or hashed IP).
- Idempotency: `Idempotency-Key` header on hold creation; replay stored response.

---

## 3. What gets mocked (explicitly non-functional)

| Integration | Preview behavior | UI labeling |
|---|---|---|
| **Paddle payments** | **Completely removed.** No Paddle.js, no SDK, no webhook route. Holds lock in free via `confirmHold`. | Checkout page shows a prominent interstitial: "Payments are disabled in this preview. Bookings lock in free — no charge, no card." |
| **Email** (Lovable email-js) | **Mocked.** `sendEmail()` logs to console + records a `mock_emails` in-memory/DB row; nothing is sent. | Pass page notes "Email is mocked in this preview — your pass URL is shown on screen." |
| **SMS** (Twilio via Lovable gateway) | **Mocked as simulated** (same as source default). | Copy says "SMS reminders are simulated in this preview." |
| **AI sketch generation** | **Deferred.** Idea description text field kept; no image generation, no upload. | Idea step says "Reference photos and AI sketches are disabled in this preview." |
| **Reminder cron** | **Deferred.** No pg_cron; no `/hooks/send-reminders` route. Data model kept. | Not surfaced in UI. |
| **Outbound webhooks** | **Implemented** (simple fetch with HMAC-SHA256 signature, best-effort). Subscriptions stored in D1. `hold.created` and `booking.confirmed` fire. `hold.expired` still not fired (documented). | /agents docs note webhook behavior. |

**Test-mode copy fix:** All copy must say **preview/demo** — never "test mode" (which implied a live mode exists). llms.txt rewritten: "This is an isolated demo preview. Payments are disabled. All data is synthetic."

---

## 4. Bug fixes in the preview (vs source)

1. **Past/elapsed slots offered as bookable (confirmed bug):** `list_open_times`, `/api/public/availability`, and `/api/public/events` MUST filter out elapsed same-day slots (America/Chicago), not just past dates. Write-time rejection stays as defense-in-depth.
2. **Stale `openapi.json` slot enum:** correct to the real 6 slots (`10:00 AM, 11:30 AM, 1:00 PM, 2:30 PM, 4:00 PM, 6:30 PM`).
3. **Test-mode ambiguity:** rewrite all payment-adjacent copy to "preview — payments disabled, free demo bookings."

---

## 5. Auth strategy for preview

- **No user auth.** Booking flow is unauthenticated (holds gated by `hold_secret`, pass by `access_token`) — matches source.
- **No admin UI.** `user_roles` table exists but nothing reads it in the preview.
- **Agent API keys:** self-service minting at `POST /api/public/agent-keys` (`fk_` prefix, sha256 stored, raw shown once) — matches source. Rate-limit tiers by key vs anonymous.

---

## 6. SEO/AEO/static files

- `public/llms.txt` — rewritten for preview (demo data, payments disabled, MCP address = preview URL).
- `public/robots.txt` — allow all (preview is public) + sitemap ref to preview URL.
- `public/sitemap.xml` — static, 3 routes.
- `public/carbon.txt` — new, SpaceFast attribution (v0.5 format; upstreams: SpaceFast).
- `public/.well-known/agent.json` — agent card, preview URLs.
- `public/.well-known/mcp.json` — MCP discovery pointer → `/api/public/mcp`.
- JSON-LD LocalBusiness on `/` (synthetic studio data, clearly demo).
- **Every HTML response:** `noindex, nofollow` (preview-only).
- **Lite Analytics:** include the umami-lite tracker script (same as source: `https://umami-lite.view.fast/tracker.js`) with CSP allowlist — private analytics preserved.

---

## 7. Synthetic seed data (clearly labeled demo)

- Studio: "Fresh Ink Preview Studio" — **fictional** address in Saint Paul, MN (clearly marked DEMO in UI and API responses).
- Seed `blocked_slots`: 2–3 fake blocked dates (e.g. "Demo holiday").
- Seed 1–2 fake **confirmed** appointments (fictional names, `example.com` emails, 555 numbers) so availability isn't trivially empty — each with `notes = 'SYNTHETIC PREVIEW DATA'`.
- **Never** seed anything resembling real customer data. No real names, emails, or phone numbers.

---

## 8. Env vars (all unset in preview; documented for potential promotion)

| Var | Purpose | Preview value |
|---|---|---|
| `SESSION_SECRET` | Not needed (no cookie auth) | — |
| `STUDIO_NAME` etc. | Override studio info | unset; static defaults |
| (none required) | The preview runs with zero secrets | — |

If ever promoted beyond preview, it would need: real email provider (replace Lovable email-js), real SMS provider, Paddle credentials (if payments return), a cron scheduler for reminders, and object storage for uploads. **Promotion is NOT authorized.**

---

## 9. Verification plan (live, after publish)

1. Homepage loads (200), wizard renders, `noindex` present.
2. Availability API returns slots; **elapsed same-day slots excluded** (verify by checking today's listing after a slot time passes, or by unit reasoning + code review).
3. Create hold via `POST /api/public/holds` → 200 with `booking_id` + `checkout_url`.
4. Confirm hold via confirm endpoint → status `confirmed`.
5. Double-booking: second hold on same slot → 409 "just taken".
6. Expired hold: status returns `expired` after 15 min (or manipulate `hold_expires_at` in test).
7. MCP: `tools/list` → 4 tools; `tools/call` each: `get_studio_info`, `list_open_times`, `hold_slot`, `get_booking_status` → all succeed.
8. Checkout page shows payments-disabled interstitial.
9. SEO files: `/llms.txt`, `/sitemap.xml`, `/robots.txt`, `/carbon.txt`, `/.well-known/agent.json` → 200.
10. Reschedule + attendance confirm via pass token.
11. Webhook subscription + `hold.created` delivery (best-effort; use a test receiver like webhook.site manually if needed).

---

## 10. Migration repo branch strategy

- `main` of `Mike-Demo/freshink-spacefast`: empty/initial (repo created via API).
- All work on `spacefast-migration` branch, pushed via GitHub Git Data API (pattern from CEO Owl).
- Original repo `Mike-Demo/charm-project-place` `main`: **never touched**.
