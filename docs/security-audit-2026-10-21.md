# Security audit triage — 2026-10-21

Parent: https://github.com/Mike-Demo/freshink-spacefast/issues/1

This is the fallback backlog because this session cannot create GitHub issues.
The five sections below provide exact issue titles and ready-to-file bodies.
No remediation has been implemented and no application code or deployed endpoint
was executed or probed. Findings retain the parent audit's classifications:
four confirmed (one high, three medium), three needs-validation leads, no rejected
candidates. Static evidence does not establish that exploitation occurred.

## Priority and grouping

| Order | Confirmed finding | Risk and fix-size rationale |
| --- | --- | --- |
| 1 | High: repeat confirmation exposes the pass credential | Anonymous callers with a booking ID can obtain authority to confirm attendance or reschedule, subject to existing booking constraints. Public webhook registration supplies IDs. Omitting credentials on repeat confirmation and suppressing repeat side effects is a small, localized fix. |
| 2 | Medium: ID-only booking details expose client PII | Anonymous callers can obtain names, pronouns and appointment metadata using IDs collected through webhooks. A minimal ID/status response is a small fix, though checkout/pass consumers must be checked. |
| 3 | Medium: unbounded webhook registration and delivery | No booking ID or API key is needed to register slow receivers. Every subsequent hold/confirmation incurs sequential outbound work, affecting other users and cost. Admission limits are small changes; bounding or decoupling delivery requires broader lifecycle work. |
| 4 | Medium: unlimited agent-key minting bypasses per-caller budgets | Any caller with a syntactically valid email can reset per-key budgets. This enables sustained abuse, but does not bypass the separate studio-wide active pending agent-hold cap. Durable identity/activation and shared-budget changes are broader than the fixes above. |

Keep four remediation issues: these are distinct root causes, not one shared
implementation defect. The first two share a booking-authorization theme but
affect different endpoints and require separate fixes. Unauthenticated webhook
registration supplies IDs for both disclosures; removing that source alone does
not make booking IDs authorization credentials. Agent-key issuance undermines
per-key limits, so webhook admission must not rely only on a freshly minted key.
Address items 1–2 first; items 3–4 can proceed in parallel. IP-based mitigations
must account for the unresolved ingress-header lead, not assume trusted headers.

## Ready-to-file issue 1

### Title

`[security][high] Prevent credential disclosure on repeat hold confirmation`

### Body

Parent audit: https://github.com/Mike-Demo/freshink-spacefast/issues/1

**Fingerprint:** `freshink-confirmhold-returns-access-token-without-secret-for-confirmed`

**Priority:** 1. Confirmed high. A caller with a booking ID and any nonempty
`hold_secret` can retrieve an already-confirmed booking's `access_token`.
Unauthenticated webhook subscribers can collect booking IDs, reducing the
practical barrier. The token authorizes attendance confirmation and rescheduling
under the existing booking rules.

**Evidence (repository paths relative to the parent repository):**

- [`functions/api/public/holds-confirm.ts:42–48`](../functions/api/public/holds-confirm.ts#L42-L48) requires only nonempty strings before calling `confirmHold`.
- [`functions/_core/booking.ts:500–514`](../functions/_core/booking.ts#L500-L514) returns the token for confirmed rows before comparing the secret.
- [`functions/_core/booking.ts:525–537`](../functions/_core/booking.ts#L525-L537) clears `hold_secret` on confirmation.
- [`functions/api/public/holds-confirm.ts:49–71`](../functions/api/public/holds-confirm.ts#L49-L71) repeats mock-email and webhook delivery and includes the token/pass URL in the response.

**Root cause:** The confirmed-state early return bypasses the capability check;
confirmation also deletes the secret needed to authenticate a later retry.

**Smallest fix:** Return only `booking_id` and `status` on repeat confirmations;
never return `access_token` or a pass URL on that path. Emit confirmation email
and webhook only for the actual pending-to-confirmed transition. Preserve the
first valid confirmation's token response. If credential-bearing retries are
required instead, retain a verifiable hold credential and authenticate before
returning a token; existing confirmed rows with NULL secrets must fail closed.
Simply moving the comparison cannot authenticate those rows.

**Acceptance checks for the remediation:**

- [ ] Arbitrary, empty or missing secrets never disclose a confirmed booking's token or pass URL.
- [ ] A valid pending hold still confirms and returns its pass; invalid/expired holds retain their protections.
- [ ] Repeat confirmation does not resend email or webhook; concurrent retries do not duplicate transition side effects.
- [ ] Review REST/MCP consumers of `confirmHold` for compatibility.

## Ready-to-file issue 2

### Title

`[security][medium] Remove client details from ID-only booking lookup`

### Body

Parent audit: https://github.com/Mike-Demo/freshink-spacefast/issues/1

**Fingerprint:** `freshink-public-booking-pii-disclosure-by-id-only`

**Priority:** 2. Confirmed medium. An anonymous caller knowing a booking ID can
read client name, pronouns, appointment date/slot, status, payment status, source,
reschedule count and creation time. IDs are not necessarily private: public
webhook registration enables collection from `hold.created` events.

**Evidence:**

- [`functions/api/public/bookings.ts:16–33`](../functions/api/public/bookings.ts#L16-L33) applies a rate limit and ID lookup, but no booking credential check.
- [`functions/_core/booking.ts:562–578`](../functions/_core/booking.ts#L562-L578) includes client-identifying data in `publicBooking`.
- [`functions/api/public/holds.ts:70–75`](../functions/api/public/holds.ts#L70-L75) broadcasts IDs; [`functions/api/public/webhooks.ts:33–88`](../functions/api/public/webhooks.ts#L33-L88) allows public registration.

**Root cause:** The detail endpoint treats knowledge of the identifier as
authorization and uses a serializer that includes personal information.

**Smallest fix:** Reduce the unauthenticated ID-only response to `booking_id`
and `status`, matching the MCP status lookup. Do not include name, pronouns or
other detail metadata on that path. If detailed lookup remains necessary,
require a matching hold secret for pending bookings or access token for confirmed
bookings, and update affected checkout/pass consumers.

**Acceptance checks for the remediation:**

- [ ] An ID-only request returns no client details, including when made with an unrelated agent key.
- [ ] If retained, credentialed details reject missing, wrong and unrelated booking credentials.
- [ ] Checkout/pass consumers and pending/expired status behavior remain functional.
- [ ] Fix this endpoint independently of webhook admission controls.

## Ready-to-file issue 3

### Title

`[security][medium] Bound webhook registration and delivery amplification`

### Body

Parent audit: https://github.com/Mike-Demo/freshink-spacefast/issues/1

**Fingerprint:** `freshink-unbounded-webhook-subscriptions-delivery-amplification`

**Priority:** 3. Confirmed medium. Anyone can create unlimited subscriptions
without authentication or rate limits. Slow attacker receivers multiply outbound
work and latency for subsequent users' hold/confirmation requests.

**Evidence:**

- [`functions/api/public/webhooks.ts:33–88`](../functions/api/public/webhooks.ts#L33-L88) validates URL/events and inserts subscriptions without caller resolution, rate limiting or quotas.
- [`functions/_core/webhooks.ts:32–63`](../functions/_core/webhooks.ts#L32-L63) loads all subscriptions and awaits matching deliveries sequentially, each with an eight-second timeout.
- [`functions/api/public/holds.ts:70–75`](../functions/api/public/holds.ts#L70-L75) and [`functions/api/public/holds-confirm.ts:61–65`](../functions/api/public/holds-confirm.ts#L61-L65) await delivery in booking requests.

**Root cause:** Unbounded subscription admission feeds unbounded sequential
delivery on the synchronous booking request path.

**Smallest fix:** Apply the existing `checkRateLimit` write gate to subscription
creation using a trusted client-IP identity, regardless of any supplied API key.
Cap total stored subscriptions and active delivery subscriptions, including
existing rows. Move delivery off the booking request path with bounded workers,
or bound per-event fan-out and total delivery time, not just each receiver's
timeout. Enforce quotas atomically so parallel registrations cannot exceed them.
Do not rely solely on per-key limits while unlimited key issuance remains open.

**Acceptance checks for the remediation:**

- [ ] Repeated/parallel anonymous registrations are throttled and storage/delivery caps hold.
- [ ] Slow/failing receivers cannot multiply booking response latency without a total bound.
- [ ] Legitimate matching events retain signed delivery with bounded resource use.
- [ ] Keep arbitrary-destination SSRF as a separate unconfirmed runtime-egress lead.

## Ready-to-file issue 4

### Title

`[security][medium] Prevent agent-key minting from resetting caller budgets`

### Body

Parent audit: https://github.com/Mike-Demo/freshink-spacefast/issues/1

**Fingerprint:** `freshink-unlimited-agent-key-minting-defeats-rate-limits`

**Priority:** 4. Confirmed medium. Any syntactically valid email can mint
unlimited keys without ownership proof. Each key starts new per-caller read,
write and agent-hold counters; the studio-wide active pending agent-hold cap
remains separate and is not bypassed by this finding.

**Evidence:**

- [`functions/api/public/agent-keys.ts:16–53`](../functions/api/public/agent-keys.ts#L16-L53) issues keys with only email syntax validation and no issuance controls.
- [`functions/_core/booking.ts:794–820`](../functions/_core/booking.ts#L794-L820) uses each key's hash as caller identity.
- [`functions/_core/booking.ts:702–725`](../functions/_core/booking.ts#L702-L725) keys rate counters by `caller_hash`; [`functions/_core/booking.ts:411–436`](../functions/_core/booking.ts#L411-L436) does likewise for caller hold budgets but separately enforces the studio cap.

**Root cause:** Freely mintable credentials are treated as independent budget
identities, with neither issuance limits nor a verified shared principal.

**Smallest fix:** Rate-limit issuance by trusted client IP with the existing
write gate, cap keys per normalized email, and require email ownership
verification before activating the keyed tier. Enforce write and hold budgets
against a stable, non-mintable principal alongside `caller_hash`, so new keys
cannot reset those budgets. Issuance throttling alone is only partial mitigation;
do not grant keyed privileges merely for claiming an email address.

**Acceptance checks for the remediation:**

- [ ] Repeated/parallel issuance respects per-IP and per-email caps even with rotating supplied keys.
- [ ] Unverified keys cannot obtain keyed privileges.
- [ ] Multiple keys for one verified principal share write/hold budgets.
- [ ] Anonymous limits, legitimate activation/rotation and the studio-wide cap remain effective.

## Ready-to-file issue 5

### Title

`[security][needs-validation] Audit leads to validate`

### Body

Parent audit: https://github.com/Mike-Demo/freshink-spacefast/issues/1

These are leads, not confirmed findings. No severity is assigned. The missing
facts below reproduce the complete missing-fact statements available in the
parent; its trailing explanatory text is truncated with ellipses. No omitted
text is inferred. Obtain platform guarantees or use an explicitly authorized,
isolated validation environment; do not probe production or real internal
services. Record evidence and disposition for each lead before promoting it.

- [ ] **Check-then-insert hold creation and reschedule concurrency**
  - Fingerprint: `freshink-double-booking-check-then-insert-race`
  - Claimed root cause: `createHold` checks then inserts, and `reschedule` checks then updates, without a unique constraint backing the slot guard.
  - Source pointers: [`functions/_core/booking.ts:393–467`](../functions/_core/booking.ts#L393-L467), [`functions/_core/booking.ts:644–660`](../functions/_core/booking.ts#L644-L660).
  - **Exact missing fact:** Whether the SpaceFast functions runtime and env.DB layer permit two concurrent invocations to interleave between createHold conflict SELECT and its INSERT, including invocation concurrency and transaction and isolation semantics of the DB binding.
  - Validation: Establish those guarantees for both creation and rescheduling; if needed, use controlled concurrent requests against disposable data. Record whether conflicting writes can both commit.

- [ ] **Webhook server-side fetch destination reachability**
  - Fingerprint: `freshink-webhook-subscription-ssrf-server-fetch`
  - Claimed root cause: URL validation checks only HTTP(S) scheme; delivery follows default redirects without screening private, loopback or link-local destinations.
  - Source pointers: [`functions/api/public/webhooks.ts:44–53`](../functions/api/public/webhooks.ts#L44-L53), [`functions/_core/webhooks.ts:49–63`](../functions/_core/webhooks.ts#L49-L63).
  - **Exact missing fact:** Whether the SpaceFast functions runtime outbound fetch can reach private, loopback, or link-local addresses such as 169.254.169.254, 127.0.0.1, or RFC1918 hosts, i.e. the platform egress policy and whether fetch to non-public destinations is blocked by the runtime.
  - Validation: Obtain platform egress policy, including redirect/DNS enforcement. Any authorized tests must use controlled destinations rather than actual metadata or private services.

- [ ] **Anonymous caller identity and ingress forwarding headers**
  - Fingerprint: `freshink-x-forwarded-for-spoofable-anonymous-identity`
  - Claimed root cause: `resolveCaller` hashes the IP returned by `getClientIp`, which falls back to the first `X-Forwarded-For` value when `cf-connecting-ip` is absent.
  - Source pointers: [`functions/_core/request.ts:28–33`](../functions/_core/request.ts#L28-L33), [`functions/_core/booking.ts:817–820`](../functions/_core/booking.ts#L817-L820).
  - **Exact missing fact:** Whether the SpaceFast ingress always sets cf-connecting-ip on function requests and strips or overwrites client-supplied X-Forwarded-For.
  - Parent qualification: If it does both, the X-Forwarded-For fallback is unreachable with attacker-controlled values; if it does neither, anonymous caller identity is fully spoofable.
  - Validation: Establish trusted-header behavior for every supported ingress path, including missing/spoofed headers and mixed cases. Record whether a caller can change the effective anonymous identity.
