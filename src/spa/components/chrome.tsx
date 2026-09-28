import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate, useRoute } from "../router";

/** Sticky banner shown on every page — preview provenance is never out of view. */
export function PreviewBanner(): ReactElement {
  return (
    <div className="preview-banner" role="note" aria-label="Preview build notice">
      <span className="dot" aria-hidden="true" />
      <span>Preview build — synthetic data only</span>
      <span className="dot" aria-hidden="true" />
    </div>
  );
}

export function BrandMark(): ReactElement {
  return (
    <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M17 6 C 21 12, 23 16, 23 21 A 6 6 0 1 1 11 21 C 11 16, 13 12, 17 6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="21.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }): ReactElement {
  const route = useRoute();
  const navigate = useNavigate();
  const current = route?.name ?? "";
  const go = (path: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    navigate(path);
  };
  return (
    <>
      <PreviewBanner />
      <header className="site-header">
        <a className="brand" href="/" onClick={go("/")}>
          <BrandMark />
          <span>
            <span className="brand-name">Fresh Ink</span>
            <br />
            <span className="brand-sub">Preview studio</span>
          </span>
        </a>
        <nav className="nav-links" aria-label="Site">
          {[
            ["home", "Book", "/"],
            ["agents", "Agents", "/agents"],
            ["licenses", "Licenses", "/licenses"],
          ].map(([name, label, path]) => (
            <a key={name} href={path} className={current === name ? "active" : ""} onClick={go(path)}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main className="page">{children}</main>
      <footer className="site-footer">
        <div className="inner">
          <span>
            Fresh Ink Preview Studio — an isolated demo. Synthetic data; payments disabled.
          </span>
          <span className="mono small">
            <a href="/health" onClick={go("/health")}>status</a>
            {" · "}
            <a href="/llms.txt">llms.txt</a>
            {" · "}
            <a href="/sitemap.xml">sitemap</a>
          </span>
        </div>
      </footer>
    </>
  );
}

/** Countdown to an ISO expiry timestamp. */
export function Countdown({ expiresAt }: { expiresAt: string }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const label = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  if (remaining <= 0) return <span className="countdown urgent">00:00 — expired</span>;
  return (
    <span className={`countdown${remaining < 3 * 60000 ? " urgent" : ""}`}>{label}</span>
  );
}

export function CodeBlock({ code, label }: { code: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="copy-btn"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(code)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Fictional-address card with the required DEMO badge. */
export function StudioCard({ name, address }: { name: string; address: string }): ReactElement {
  return (
    <div className="card tint">
      <h3 style={{ marginBottom: "0.3rem" }}>
        {name}
        <span className="demo-badge">Demo</span>
      </h3>
      <p className="small" style={{ marginBottom: 0 }}>
        {address}
        <br />
        <span className="muted">Fictional address — this studio does not exist.</span>
      </p>
    </div>
  );
}
