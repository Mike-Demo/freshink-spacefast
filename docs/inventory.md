# FreshInk (freshink.art) — SpaceFast Migration Inventory

**Repo:** `Mike-Demo/charm-project-place` (shallow clone at `source/`, read-only; single squashed commit in git history)
**Date:** 2026-09-28
**Live site:** https://freshink.art — AI-agent bookable tattoo studio (appointment-only custom linework, Saint Paul MN). Currently in free proof-of-concept mode.

---

## 1. Frontend framework and all routes

- **Framework: TanStack Start** (React 19 + TanStack Router + TanStack Query), Tailwind v4, shadcn/Radix UI components, Vite build. `package.json` name is `tanstack_start_ts`. Vite is configured with `@lovable.dev/vite-tanstack-config` (nitro build, Cloudflare target) and a custom server entry `src/server.ts` (SSR error wrapper).
- SSR: most pages render server-side; `_authenticated` subtree is client-only (`ssr: false`).

### Page routes (from `src/routes/`)

| Path | Purpose |
|---|---|
| `/` (`index.tsx`) | 8-step booking wizard (Name → Pronouns → Day → Date & Time → Phone → SMS verify (demo code) → Email → Idea (optional) → Review) + free lock-in |
| `/agents` | Docs page for AI agents (MCP connector address, config snippet, curl example) |
| `/auth` | Studio sign-in / sign-up (email+password) |
| `/_authenticated/admin` | Studio Ledger admin: booking list/search/filter, booking details sheet, block/unblock slots, idea review, reminder-run status, lifecycle email triggers |
| `/checkout/$id` | Agent-hold checkout page (`?s=<hold_secret>`); "Lock In My Slot" free lock-in |
| `/pass/$token` | Private session pass for a confirmed booking (`access_token`); calendar invite (.ics), attendance bar, reschedule |
| `/pass_/$token/confirm` | Client attendance confirmation ("I'm coming") |
| `/licenses` | Open-source/typeface/service credits page |
| `/projects` | Mike Demo project showcase (Lovable template page) |
| `/projects/fresh-ink` | Fresh Ink project detail |
| `/lovable/email/transactional/preview` | Email template preview (Lovable scaffold) |
| `/sitemap.xml` | Generated sitemap from route `staticData.sitemap` flags |

### API routes (all server handlers on TanStack Start)

| Path | Method | Purpose |
|---|---|---|
| `/api/public/mcp` | GET/POST/OPTIONS | Hand-rolled MCP JSON-RPC (Streamable HTTP): initialize, ping, tools/list, tools/call; batch arrays (max 10) |
| `/api/public/studio` | GET | Studio info JSON |
| `/api/public/availability` | GET | Open slots `?from=&to=` (max 31d), optional `?time_slot=` filter |
| `/api/public/holds` | POST | Create hold (idempotent via `Idempotency-Key` header); GET → 405 |
| `/api/public/bookings/$id` | GET | Booking status by UUID |
| `/api/public/agent-keys` | POST | Self-service API key minting (`{email, label?}`) |
| `/api/public/capabilities` | GET | Capability catalog + rate-limit/negotiation docs |
| `/api/public/events` | GET | SSE: availability snapshot + studio_pulse (pending holds) + heartbeat, then closes |
| `/api/public/webhooks` | POST/GET/DELETE | Subscribe/list/delete webhook subscriptions (manage via Bearer `manage_token`) |
| `/api/public/hooks/send-reminders` | POST | Day-before reminder run (Bearer cron token; gated to 9 AM America/Chicago; `?force=1` override) |
| `/api/public/payments/webhook` | POST | Paddle webhook (`?env=sandbox|live`, default **sandbox**) |
| `/api/public/openapi.json` | GET | OpenAPI 3.1.0 spec (hand-maintained, 181 lines) |
| `/api/public/$` | GET/POST/DELETE | Structured JSON 404 for unknown `/api/public/*` |
| `/api/sketch-concept` | POST | Image-edit proxy → Lovable AI gateway (concept sketches); quota-gated, origin-checked |

Server functions (TanStack `createServerFn`, called from client): `resolvePaddlePrice`, `confirmFreeHold`, `sendFreePassEmail`, `attachIdea`, `getIdeaByToken`, `sendLifecycleEmail` (admin+auth).

---

## 2. Booking flow end-to-end

**Web (human) flow** (`src/routes/index.tsx`, currently the only active flow):
1. 8-step wizard: name → pronouns → day-of-week preference → date+time (calendar grid from `get_unavailable_slots` RPC; `isSlotTaken`/`isSlotPast` disable taken/past slots) → phone → demo SMS 6-digit verification (client-side simulated) → email → tattoo idea (optional: description + reference photo upload) → review.
2. On submit: `holdAppointment` → RPC `create_pending_appointment` → returns `{id, hold_secret}`. **Payment is skipped entirely** — comment in code: *"Proof-of-concept: slots lock in for free — no checkout step."*
3. Immediately `confirmFreeHold(id, holdSecret)` → RPC `confirm_free_hold` → status `confirmed`, payment_status `paid`, hold cleared.
4. Optional `attachIdea` (idea description + reference image + concept sketch → Supabase Storage private bucket `tattoo-ideas`).
5. `sendFreePassEmail` → sends `session-pass` email template with private pass URL `/pass/<access_token>`.
6. UI polls `get_booking_status` (`waitForConfirmation`) and shows the pass details.

**Agent flow (MCP / REST / WebMCP):**
1. `get_studio_info` (or GET `/api/public/studio`) → address/hours/session times/how-it-works.
2. `list_open_times({from,to})` (or GET `/api/public/availability`) → open dates/times.
3. Confirm details with user → `hold_slot` (or POST `/api/public/holds`) → returns `booking_id` + `checkout_url` (`/checkout/<id>?s=<hold_secret>`), 15-min hold.
4. **The user (not the agent) opens the checkout URL** → "Lock In My Slot" → `confirmFreeHold` (free; the MCP tool text says "no payment").
5. `get_booking_status` (or GET `/api/public/bookings/<id>`, webhooks, SSE) to observe confirmation → session pass email sent.

---

## 3. Appointment/booking data model (`appointments` table)

| Column | Type / notes |
|---|---|
| `id` | uuid PK |
| `client_name`, `phone`, `email` | text; email lowercased at write |
| `booking_date` | date |
| `time_slot` | text (one of 6 labels, e.g. `"1:00 PM"`) |
| `status` | text: `pending` → `confirmed` / `expired` / `cancelled` (+ legacy `completed`) |
| `payment_status` | text: `pending` / `paid` / `expired` |
| `hold_expires_at` | timestamptz (15 min after hold creation) |
| `hold_secret` | text (per-hold secret, gates checkout lock-in) |
| `access_token` | text unique (per-booking pass/reschedule/confirm token) |
| `paddle_transaction_id` | text (set only by Paddle webhook path) |
| `pronouns` | text |
| `idea_description`, `reference_image_path`, `concept_sketch_path`, `sketch_attempts` | tattoo idea fields; paths in private storage |
| `source` | text: `'web'` (default) / `'agent'` |
| `notes` | text (freeform; QA "TEST BOOKING" markings lived here/manual edits) |
| `reminder_sent_at`, `client_confirmed_at`, `day_of_sent_at`, `aftercare_sent_at`, `social_sent_at` | lifecycle stage timestamps |
| `sms_reminder_status`, `sms_reminder_at` | `simulated` / `sent` / `failed` |
| `reschedule_count`, `rescheduled_at` | max 3 reschedules, 24h cutoff |
| `created_at` | timestamptz |

Unique partial index: `(booking_date, time_slot)` where `status NOT IN ('cancelled','expired')` — the double-booking guard.

---

## 4. Temporary holds

- Created by `create_pending_appointment` (SECURITY DEFINER plpgsql): validates name/phone/email, rejects past dates, rejects elapsed same-day slots (America/Chicago), checks `blocked_slots`, expires any stale pending rows on the same slot, then inserts `status='pending'`, `payment_status='pending'`, `hold_expires_at = now() + 15 minutes`, `hold_secret = gen_access_token()`.
- 15-minute expiry. Enforcement is **lazy** — there is no sweeper:
  - `get_booking_status` returns `'expired'` when `hold_expires_at <= now()` even if the row still says pending.
  - `create_pending_appointment` clears expired pendings on the same slot opportunistically.
  - `release_pending_appointment` RPC exists but is **dead code** — never called from the app.
  - No job emits the advertised `hold.expired` webhook (it is never fired anywhere).
- Concurrency guard: unique partial index + `unique_violation` → "That time was just taken."
- Agent-hold limits: max 5 holds/caller/hour (MCP path; the REST path uses rate limits instead), max 20 active pending agent holds studio-wide; logged to `agent_hold_log`.

---

## 5. Availability logic and timezone

- Source of truth: `get_unavailable_slots(p_from, p_to)` SQL function = confirmed/completed bookings + live pending holds (`hold_expires_at > now()`) + `blocked_slots`.
- **Studio timezone America/Chicago everywhere**: listings compute "today" via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })`; hold creation validates against `now() at time zone 'America/Chicago'` (migration 0013).
- TIME_SLOTS (fixed, 6/day): `10:00 AM, 11:30 AM, 1:00 PM, 2:30 PM, 4:00 PM, 6:30 PM`. `blocked_slots` can block a whole day (`time_slot IS NULL`) or a single slot.
- **Known bug (confirmed in code, see §16c):** the three *agent/public* availability paths — MCP `list_open_times`, `GET /api/public/availability`, `GET /api/public/events` — only skip dates `< today`. They do **not** filter out already-elapsed slots for the current day. The web UI does filter (`isSlotPast`), and `create_pending_appointment` rejects elapsed-slot holds at write time, but the public listings still advertise elapsed today-slots as open.
- Session length: 90 minutes (used by `.ics` generation).

---

## 6. Reminders / lifecycle emails

- **Day-before reminder** is automatic: pg_cron (scheduled in Lovable Cloud, **not** in repo SQL) calls `POST /api/public/hooks/send-reminders` at **14:00 and 15:00 UTC**; the handler runs only when Chicago time is 9:00–9:59 AM (`?force=1` overrides). Caller verified via `check_reminder_cron_token` against hashed token in `cron_tokens`.
- Run selects confirmed+paid bookings for tomorrow with `reminder_sent_at IS NULL` (max 200), attempts SMS (simulated — see §8), sends `session-reminder` template email, stamps `reminder_sent_at`; results logged to `reminder_runs` (`sent/suppressed/failed/sms_simulated`). Admin sees last run via `ReminderRunStatus` (stale warning after 26h).
- **Lifecycle stages** (admin-triggered via `sendLifecycleEmail` server fn, auth+admin check): reminder, day_of, aftercare, social → templates `session-reminder`, `session-day-of`, `session-aftercare`, `session-share`; timestamps in the matching `*_sent_at` columns. Idempotent per booking via keys like `reminder-auto-<id>`.
- **Session pass email**: sent on Paddle webhook (paid path) and via `sendFreePassEmail` (free path) → template `session-pass`, idempotency key `pass-<id>`, contains private `/pass/<access_token>` URL.
- **Attendance confirmation**: `/pass/<token>/confirm` → `confirm_attendance` → `client_confirmed_at`.

---

## 7. Webhooks

- **Inbound — Paddle:** `POST /api/public/payments/webhook?env=sandbox|live` (defaults to **sandbox**). Verifies `paddle-signature` via the Paddle Node SDK against `PAYMENTS_<ENV>_WEBHOOK_SECRET` (server env). On `TransactionCompleted`, confirms the appointment from `customData.appointmentId` (pending→confirmed/paid, stores `paddle_transaction_id`), fires `booking.confirmed` outbound webhook, sends the session-pass email. 400 on any verification failure.
- **Inbound — cron:** `POST /api/public/hooks/send-reminders` (Bearer token, hashed, in `cron_tokens`).
- **Outbound:** `notifyWebhooks(event, payload)` POSTs signed JSON (`X-FreshInk-Signature`: HMAC-SHA256 hex, `X-FreshInk-Event`) to subscriber URLs, best-effort. Advertised events: `hold.created` (fired on hold creation), `booking.confirmed` (fired on webhook confirm + free confirm), `hold.expired` (**advertised but never fired** — see §4). Subscriptions managed at `/api/public/webhooks` (self-serve POST → returns secret + manage_token shown once).

---

## 8. Email / SMS integration points

- **Email: Lovable managed email (`@lovable.dev/email-js`)** — `sendLovableEmail`, needs `LOVABLE_API_KEY` (+ optional `LOVABLE_SEND_URL`). Sender config baked in: from `Book your session <noreply@freshink.art>`, sender domain `notify.freshink.art`. Templates: 5 React-Email components (`session-pass`, `session-reminder`, `session-day-of`, `session-aftercare`, `session-share`) with HTML+plaintext render, idempotency keys, suppression handling (`recipient_suppressed` → `{sent:false}`).
- **SMS: NOT live.** `sendReminderSms` is a no-op unless `SMS_REMINDERS_ENABLED="true"` **and** `LOVABLE_API_KEY` **and** `TWILIO_API_KEY` **and** `TWILIO_FROM_NUMBER` are all set — then it posts via the **Lovable connector gateway** (`https://connector-gateway.lovable.dev/twilio/Messages.json`). Otherwise every SMS is "simulated" (logged, reminder email still sends). Reminder copy: `Fresh Ink reminder: your session is tomorrow at {slot}, {street}. Confirm: {url}. Reply STOP to opt out.`
- The web flow's SMS verification step is a **client-side demo** (generated code displayed on-page), not real SMS.

---

## 9. Paddle integration — CRITICAL

- **Client (`src/lib/paddle.ts`):** Loads `paddle.js` CDN, `Paddle.Environment.set(sandbox|production)`, `Paddle.Initialize({token})`, opens overlay checkout for price resolved by `resolvePaddlePrice`, `customData: {appointmentId}`, `successUrl: /?paid=<id>`. **These client functions (`openSlotCheckout`, `initializePaddle`) are DEAD CODE — nothing calls them.** The web flow calls `confirmFreeHold` instead. `PaymentTestModeBanner` (renders only when env = sandbox) is also never mounted.
- **Environment selection:** `getPaddleEnvironment()` returns `"sandbox"` iff `VITE_PAYMENTS_CLIENT_TOKEN` starts with `"test_"`, else **"live"**. So a single build-time env var decides live vs sandbox. The site copy consistently says test/free: llms.txt — *"The user pays a $1 test deposit"*; `/api/public/studio` + agent tool — *"Free while in proof of concept — the $1 donation to A Thousand Pansies returns at launch"*; checkout page — *"Free booking while in proof of concept — no payment needed."*
- **Server (`src/lib/paddle.server.ts`):** Paddle SDK calls go through the **Lovable connector gateway** (`https://connector-gateway.lovable.dev/paddle`) with `PADDLE_SANDBOX_API_KEY` / `PADDLE_LIVE_API_KEY` + `LOVABLE_API_KEY` headers. `resolvePaddlePrice` looks up price `external_id = "slot_lock_1usd"` ($1 slot-lock price) in the selected env; throws `"Price not found"` if missing.
- **QA context (from memory, 2026-09-25):** an earlier flow reached a Paddle overlay 3 times, each failing with "Something went wrong" (no charge occurred); the route appeared wired to Paddle **LIVE** despite test-mode copy; that payment step has since been removed in favor of the free lock-in path. The README (Lovable template boilerplate) also warns: *"The previously committed live payment client token must be manually rotated or revoked in the payment provider"* — but this repo's git history is a single squashed commit with placeholders only, so no real token exists in this repo's history. Conclusion: code cannot prove which Paddle env the deployed Lovable build used; the live-vs-sandbox question hinges on the Lovable env var value, which the code selects via the `test_` prefix rule. Either way, **no money path is reachable from the current web UI**; the webhook endpoint remains live server-side as a legacy hook.
- Likely causes of the QA checkout failure (from code): (a) env mismatch — token/environment pointing at one Paddle env while the `$1` price `slot_lock_1usd` existed only in the other → `resolvePaddlePrice` throws "Price not found" → checkout never opens cleanly; (b) `VITE_PAYMENTS_CLIENT_TOKEN` unset in the deployed build → "Payments are not configured"; (c) Lovable connector gateway keys (`PADDLE_*_API_KEY`/`LOVABLE_API_KEY`) missing; (d) webhook URL registered in Paddle dashboard without `?env=live` while transacting live (route defaults to sandbox → signature verification 400).

---

## 10. File uploads

- **Private bucket `tattoo-ideas`** (Supabase Storage; RLS policy "Admins read tattoo ideas", admin-role-gated SELECT on `storage.objects`). Contents: client-uploaded reference photos (`<appointmentId>/reference.{jpg|png|webp}`, ≤10 MB) and concept sketches (`<appointmentId>/concept-sketch.*`). Uploaded server-side via `attachIdea` (base64 data URLs, single-shot, only while hold is pending); admin views via 1-hour signed URLs (`signIdeaImage`, `getIdeaByToken`). Client can also browse concept sketches via `IdeaStep`/`IdeaGallery`; sketch *generation* streams through `/api/sketch-concept` (no orphan uploads — streams the edit response directly).
- PWA icons, textures, `og-card.jpg` are static files in `public/`.

---

## 11. Keys and environment config (names only — values never copied)

Build/public: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (+ `VITE_` twins), `VITE_PAYMENTS_CLIENT_TOKEN` (client token, `test_` prefix = sandbox else live).
Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_DB_MIGRATION_URL`, `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`, `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS`, `SMS_REMINDERS_ENABLED`, `TWILIO_API_KEY`, `TWILIO_FROM_NUMBER`, `PADDLE_SANDBOX_API_KEY`, `PADDLE_LIVE_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `PAYMENTS_LIVE_WEBHOOK_SECRET`.
App-issued secrets (stored hashed): `agent_api_keys.key_hash` (sha256; raw `fk_…` shown once), `webhook_subscriptions.secret` + `manage_token` (shown once), `cron_tokens.token_hash` (sha256), per-row `hold_secret` / `access_token` (random, plaintext in DB, gated by RLS).
**No secrets are committed in the repo** (scanned `src/`, `public/`, `drizzle/`, `supabase/`, docs; `.env.example` is placeholders only).

---

## 12. Auth model

- **Studio admin:** Supabase Auth (email+password, via Lovable Cloud `@lovable.dev/cloud-auth-js`) at `/auth`; `_authenticated` route guard redirects unauthenticated → `/auth`. Admin rights come from `user_roles` (`app_role` enum: only `'admin'`) checked via `has_role()`; **first admin self-claims** via `claim_admin()` RPC (refuses once any admin exists). Migration 0008 transfers admin to a specific user UUID (redacted values in file).
- **Server functions:** `requireSupabaseAuth` middleware (Authorization header → Supabase user); admin checks re-verified per call (`has_role`).
- **Agents/public API:** self-service API keys (`POST /api/public/agent-keys`, `fk_` prefix, sha256 hash stored; keyed callers get 600 reads/min, 30 writes/hour vs anonymous 60/min, 5/hour). MCP endpoint with no key falls back to hashed-IP identity. Cron hook uses its own hashed token in `cron_tokens`.
- **Hold/checkout:** `hold_secret` in the checkout URL gates lock-in; `access_token` gates pass/reschedule/confirm; reschedule max 3, closes 24h before session.
- Note: anonymous `anon` key can execute several SECURITY DEFINER RPCs (`create_pending_appointment`, `get_unavailable_slots`, `get_booking_status`, etc.) — intended, with input validation inside the functions.

---

## 13. Database schema (Supabase Postgres)

Migrations: `drizzle/migrations/0000–0013_*.sql` (0000 appointments/availability/admin roles; 0001 pronouns; 0002 slot-hold payments; 0003 deprecate direct booking; 0004 confirmed-booking fn; 0005 access-token/reschedule; 0006 idea fields; 0007 hold_secret + sketch quota; 0008 admin transfer; 0009 lifecycle stages; 0010 pg_cron + cron_tokens; 0011 reminder_runs + SMS columns; 0012 agent booking; 0013 free-hold confirm + Chicago same-day guard). `drizzle/schema.ts` is blank (auto-generated stub); `supabase/config.toml` exists; the actual pg_cron *schedule* lives in the Lovable Cloud dashboard, not in repo SQL.

Tables:
- `appointments` (see §3 for columns)
- `blocked_slots` (`id`, `blocked_date`, `time_slot` nullable = whole day, `reason`)
- `user_roles` (`user_id`, `role` = 'admin')
- `agent_api_keys` (`id`, `key_hash`, `email`, `label`, `last_used_at`) — **no migration DDL in repo** (created out-of-band; defined in `types.ts`)
- `agent_hold_log` (`caller_hash`, `appointment_id`)
- `api_rate_log` (`caller_hash`, `bucket`, `created_at`) — no migration DDL in repo
- `idempotency_keys` (`key`, `caller_hash`, `response` jsonb) — no migration DDL in repo
- `webhook_subscriptions` (`url`, `secret`, `manage_token`, `events[]`) — no migration DDL in repo
- `reminder_runs` (`ran_at`, `skipped_reason`, `sent`, `suppressed`, `failed`, `sms_simulated`)
- `cron_tokens` (`name`, `token_hash`)
- `sketch_usage` (`bucket_key`, `usage_day`, `uses`) — daily AI sketch quota via `consume_sketch_quota` RPC
- Storage: private bucket `tattoo-ideas` (RLS: admin-only read)
- Extensions used: `pg_cron`, `pg_net`, `pgcrypto`; Postgres-specific: plpgsql SECURITY DEFINER functions, partial unique indexes, `interval`, `timestamptz`, `gen_random_uuid`.

---

## 14. Public MCP (`/api/public/mcp`) — tool by tool

Hand-rolled JSON-RPC 2.0 (Streamable HTTP). Helpers in `src/lib/agent-booking.server.ts`. `GET` returns service info; `POST` handles single/batch JSON-RPC; CORS `*`.

1. **`get_studio_info`** — static data from `studio-location.ts` + `atelier.ts`: name, address, map URL, hours ("Appointment only"), timezone America/Chicago, session times, deposit copy ("Free while in proof of concept…"), how-it-works, website. Reads no DB.
2. **`list_open_times({from, to})`** — validates YYYY-MM-DD, max 31-day range; calls `get_unavailable_slots` RPC; filters out full-day blocks and past *dates* — **but NOT elapsed slots on the current day** (see §5/§16c). Returns `{timezone, open: [{date, times}]}`.
3. **`hold_slot({date, time_slot, name, email, phone, pronouns?, idea?, idempotency_key?})`** — validates inputs; optional idempotent replay via `idempotency_keys`; per-caller rate check (5 holds/hour) + studio-wide cap (20 active); calls `create_pending_appointment` RPC (which itself rejects past dates, blocked slots, and elapsed same-day slots); marks row `source='agent'`, saves idea, logs to `agent_hold_log`; fires `hold.created` webhook. Returns `{booking_id, status:'pending', hold_expires_in_minutes:15, checkout_url}`. **Hold text says "free while in proof of concept — no payment."**
4. **`get_booking_status({booking_id})`** — validates UUID; calls `get_booking_status` RPC; returns `pending|confirmed|expired|cancelled` (computes expiry lazily) or `not_found`.

Companion agent surfaces: REST API (`/api/public/*`, OpenAPI 3.1.0), SSE (`/api/public/events`), outbound webhooks, and WebMCP (`navigator.modelContext` tools registered on the booking page — same REST calls).

---

## 15. SEO / AEO files

- `public/llms.txt` — studio summary + all agent protocols/tools; ⚠️ says *"The user pays a $1 test deposit"* (outdated — currently free).
- `public/robots.txt` — allows all crawlers; sitemap reference to `https://freshink.art/sitemap.xml`.
- `public/carbon.txt` — carbon disclosure (v0.5, last_updated 2026-09-27; upstreams: lovable.dev shared-hosting, cloudflare CDN).
- `public/.well-known/agent.json` — agent card (name, protocols MCP/REST/SSE/Webhooks/WebMCP/llms.txt, capabilities, handoff, OpenAPI URL, contact studio@freshink.art); `public/.well-known/mcp.json` — MCP discovery pointer.
- `/sitemap.xml` — auto-generated from route `staticData.sitemap` flags (/, /agents, /licenses, /projects, /projects/fresh-ink included; checkout/pass/admin/auth excluded).
- JSON-LD on `/`: `TattooShop`-ish LocalBusiness block + WebSite block (address, geo, sameAs: GitHub/LinkedIn/X/Threads). Per-route literal-string meta (AGENTS.md rule: no shared metadata module).
- `public/manifest.webmanifest` — PWA (manifest-only, no service worker); splash screens + icons in `public/`.
- Analytics: **Umami Lite** tracker — `https://umami-lite.view.fast/tracker.js` preconnected/scripted in `__root.tsx` with CSP allowlist (`script-src` includes cdn.paddle.com and umami-lite.view.fast).

---

## 16. 2026-09-25 QA findings — verified against code

**(a) Paddle checkout "Something went wrong" (3x) — CONFIRMED as bypassed, cause identifiable.** The client Paddle functions (`openSlotCheckout`, `initializePaddle` in `src/lib/paddle.ts`) are now **dead code — called nowhere**. The web flow was changed to free lock-in (`confirmFreeHold`), with the comment *"Proof-of-concept: slots lock in for free — no checkout step."* So the broken Paddle path no longer exists in the UI. Likely cause at QA time (from the code paths): an environment mismatch — `resolvePaddlePrice` queries the Lovable connector gateway for price `external_id="slot_lock_1usd"` in whichever env `VITE_PAYMENTS_CLIENT_TOKEN` selects (`test_` → sandbox else live) and throws "Price not found" when the price doesn't exist in that env; also possible: token unset, gateway API keys missing, or webhook URL registered without `?env=live`. No charge ever occurred. The legacy `?paid=` success-param handler and the server webhook remain as residue.

**(b) "Site copy says test mode while wired to Paddle LIVE" — CONFIRMED mechanism, deploy-time value unknowable from repo.** Env selection is `getPaddleEnvironment()`: `"sandbox"` only when the deployed `VITE_PAYMENTS_CLIENT_TOKEN` starts with `test_`, otherwise **live** — while every piece of copy says test/free ("$1 test deposit" in llms.txt, "Free while in proof of concept" on-site/agent tools/checkout page). The repo contains no real token (single squashed commit; README's "previously committed live payment client token" warning is inherited Lovable-template boilerplate). The webhook route defaults `?env=sandbox` when the query param is absent. Net: the code *could* charge live cards while copy says test mode — but the current build has no reachable money path (see (a)), so the real-charge risk is currently moot, not resolved.

**(c) Past/elapsed slots offered as bookable — CONFIRMED.** MCP `list_open_times`, `GET /api/public/availability`, and `GET /api/public/events` skip dates `< today` but list **all six TIME_SLOTS for the current day**, including elapsed ones (e.g. 10:00 AM offered at 5 PM). The web UI filters these (`isSlotPast`), and `create_pending_appointment` rejects holds on elapsed slots ("That time has already passed today"), so a hold attempt fails — but the public listings still advertise them as open. Partially mitigated at write time, not at read time.

**(d) "Marked TEST BOOKING" — CONFIRMED as manual, not a code feature.** There is no test-booking flag, status, or distinguished handling in the code. QA test data used a fictional name ("Testy Testington"), a 555 number, `mdemop@mikedemo.com`, and an idea note marked as a QA test — distinguishable only by those content values plus the free-text `notes` column / Supabase-side edits. Nothing prevents a test booking from triggering real lifecycle emails, so test rows must be cleaned up (or the reminder job scoped) before launch.

---

## 17. Additional observations for the migration

- **Hard Lovable dependencies** (must be replaced): `@lovable.dev/email-js` (email delivery), `connector-gateway.lovable.dev` (Paddle API + Twilio SMS proxies), `ai.gateway.lovable.dev` (image-edit model `openai/gpt-image-2.5-sunburst`, keyed by `LOVABLE_API_KEY`), `@lovable.dev/cloud-auth-js` (Supabase Auth plumbing), Lovable pg_cron hosting (reminder schedule), `error-capture`/`lovable-error-reporting` (error telemetry to Lovable).
- **Doc drift bug:** `openapi.json` documents `/api/public/availability`'s `time_slot` enum as `["9:00 AM", "1:00 PM", "5:00 PM"]` — stale; real TIME_SLOTS are 10:00/11:30/1:00/2:30/4:00/6:30 PM.
- **Expiry/job gaps:** no sweeper for expired holds; `hold.expired` webhook advertised but never fired; `release_pending_appointment` dead.
- **D1/MySQL-shaped DB risks:** 14 plpgsql SECURITY DEFINER functions with business logic (holds, availability, tokens, quota, reminders-auth, reschedule, confirm) must be reimplemented in application code; partial unique index for double-booking; `timestamptz` + `interval` + `at time zone 'America/Chicago'` date math; pgcrypto token gen; out-of-band tables (`agent_api_keys`, `api_rate_log`, `idempotency_keys`, `webhook_subscriptions`) exist only in the live DB/`types.ts` — their DDL must be reconstructed.
- **SpaceFast Functions specifics:** all `node:crypto` usage (HMAC webhook signing, sha256 key hashes, random tokens) maps cleanly to Web Crypto; SSE stream + `ReadableStream` are fine; the TanStack Start server-function/RPC model needs a framework decision (port to SpaceFast Functions directly); Supabase Storage signed URLs need a storage replacement with private read + time-limited URLs; React-Email templates can render in any Node/edge runtime; 15-minute holds + cron need a scheduler (reminders: 14:00/15:00 UTC dual-ping, 9 AM Chicago gate); Lovable's `@react-email/render` depends on React — keep in mind for a non-React function runtime.
