import { useEffect, useState, type ReactElement } from "react";

/** Preview status page — mirrors the shape the API health check returns. */
export function HealthPage(): ReactElement {
  const [api, setApi] = useState<"checking" | "ok" | "down">("checking");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/public/studio", { headers: { accept: "application/json" } })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setApi("ok");
          setDetail(`GET /api/public/studio → ${res.status}`);
        } else {
          setApi("down");
          setDetail(`GET /api/public/studio → ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setApi("down");
          setDetail(err instanceof Error ? err.message : "unreachable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <p className="kicker">Status</p>
      <h1>Preview health</h1>
      <div className="card">
        <table className="doc-table">
          <tbody>
            <tr>
              <td>SPA</td>
              <td><code>ok</code> — this page rendered</td>
            </tr>
            <tr>
              <td>Public API</td>
              <td>
                {api === "checking" && <code>checking…</code>}
                {api === "ok" && <code>ok</code>}
                {api === "down" && <code>down</code>}
                {detail && <span className="small muted"> · {detail}</span>}
              </td>
            </tr>
            <tr>
              <td>Data</td>
              <td><code>synthetic</code> — demo preview, payments disabled</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        The JSON health endpoint lives at <code className="inline">/api/public/health</code> on the
        Functions backend (preview-only).
      </p>
    </div>
  );
}

export function NotFoundPage(): ReactElement {
  return (
    <div className="center" style={{ maxWidth: "34rem", margin: "0 auto", padding: "3rem 0" }}>
      <p className="kicker">404</p>
      <h1>Nothing inked here</h1>
      <p className="lede">That page does not exist in this preview.</p>
      <a className="btn btn-primary" href="/">
        Back to booking
      </a>
    </div>
  );
}
