import type { ReactElement } from "react";
import { CodeBlock } from "../components/chrome";

const ORIGIN = "https://freshink-preview.view.fast";
const MCP_URL = `${ORIGIN}/api/public/mcp`;

const SNIPPET = `{
  "mcpServers": {
    "fresh-ink-preview": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`;

const EXAMPLE_STUDIO = `curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_studio_info","arguments":{}}}'`;

const EXAMPLE_TIMES = `curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"list_open_times",
                 "arguments":{"from":"2026-10-01","to":"2026-10-07"}}}'`;

const EXAMPLE_HOLD = `curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"hold_slot",
                 "arguments":{"date":"2026-10-02",
                              "time_slot":"1:00 PM",
                              "name":"Alex Rivera",
                              "email":"alex@example.com",
                              "phone":"5550192834"}}}'`;

const EXAMPLE_STATUS = `curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call",
       "params":{"name":"get_booking_status",
                 "arguments":{"booking_id":"<booking_id>"}}}'`;

const TOOLS: [string, string][] = [
  ["get_studio_info", "Address, hours, session times, and how booking works."],
  ["list_open_times", "Open times between two dates (up to 31 days). Elapsed same-day slots are excluded."],
  ["hold_slot", "Holds a time for 15 minutes and returns a free lock-in link for the client."],
  ["get_booking_status", "Pending, confirmed, expired, or cancelled."],
];

export function AgentsPage(): ReactElement {
  return (
    <div style={{ maxWidth: "44rem", margin: "0 auto" }}>
      <p className="kicker">Field notes // agents</p>
      <h1>Book through your AI assistant</h1>
      <p className="lede">
        Assistants like ChatGPT and Claude can check open times and hold a session for their user through
        this preview MCP connector. The client locks the session in themselves through the hold link —
        free in this preview — then opens their session pass.
      </p>

      <div className="notice warn">
        <h3>Demo preview</h3>
        <p>
          Isolated demo. All data is synthetic, payments are disabled, and emails are mocked. Discovery:
          {" "}<code className="inline">{ORIGIN}/.well-known/mcp.json</code>
        </p>
      </div>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Connect</h3>
        <p className="small">Connector address (Streamable HTTP, no sign-in):</p>
        <CodeBlock code={MCP_URL} label="connector address" />
        <p className="small">Client config snippet:</p>
        <CodeBlock code={SNIPPET} label="config snippet" />
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Tools</h3>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map(([name, desc]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Example calls</h3>
        <p className="small">Studio info:</p>
        <CodeBlock code={EXAMPLE_STUDIO} label="get_studio_info example" />
        <p className="small">Open times:</p>
        <CodeBlock code={EXAMPLE_TIMES} label="list_open_times example" />
        <p className="small">Hold a slot (returns a lock-in link for the client):</p>
        <CodeBlock code={EXAMPLE_HOLD} label="hold_slot example" />
        <p className="small">Booking status:</p>
        <CodeBlock code={EXAMPLE_STATUS} label="get_booking_status example" />
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Prefer REST?</h3>
        <p className="small">Every MCP tool is also a plain HTTP endpoint, plus events and webhooks.</p>
        <table className="doc-table">
          <tbody>
            <tr><td><code>GET /api/public/studio</code></td><td>Studio info (demo-marked).</td></tr>
            <tr><td><code>GET /api/public/availability?from=&amp;to=</code></td><td>Open times, America/Chicago.</td></tr>
            <tr><td><code>POST /api/public/holds</code></td><td>Create a hold. Supports <code>Idempotency-Key</code>.</td></tr>
            <tr><td><code>POST /api/public/holds-confirm</code></td><td>Free lock-in: <code>{"{booking_id, hold_secret}"}</code>.</td></tr>
            <tr><td><code>GET /api/public/bookings?id=</code></td><td>Booking status.</td></tr>
            <tr><td><code>POST /api/public/pass</code></td><td>Pass actions: <code>confirm</code>, <code>reschedule</code>.</td></tr>
            <tr><td><code>GET /api/public/events</code></td><td>Availability snapshot stream (SSE).</td></tr>
            <tr><td><code>POST /api/public/webhooks</code></td><td>Subscribe to signed push events.</td></tr>
            <tr><td><code>POST /api/public/agent-keys</code></td><td>Optional API key for higher rate limits.</td></tr>
          </tbody>
        </table>
        <p className="small">Full spec:</p>
        <CodeBlock code={`${ORIGIN}/api/public/openapi.json`} label="OpenAPI spec URL" />
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Webhooks</h3>
        <p className="small">
          Subscribe with <code className="inline">POST /api/public/webhooks</code> (url, events). Deliveries
          are signed with HMAC-SHA256. Events fired in this preview:{" "}
          <code className="inline">hold.created</code> and <code className="inline">booking.confirmed</code>.
          Expiry events are not fired (documented preview limitation).
        </p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Rate limits</h3>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Caller</th>
              <th>Reads / min</th>
              <th>Writes / hour</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Anonymous</td><td>60</td><td>5</td></tr>
            <tr><td>API key</td><td>600</td><td>30</td></tr>
          </tbody>
        </table>
        <h3>Rules</h3>
        <ul className="tight">
          <li>Confirm name, email, phone, date, and time with the user before holding.</li>
          <li>Holds expire after 15 minutes if not locked in. Double-booking returns 409.</li>
          <li>Lock-in is free in this preview — there is no payment step.</li>
        </ul>
        <p className="small">
          Prefer the regular way? <a href="/">Book on the site</a>.
        </p>
      </section>
    </div>
  );
}
