import type { ReactElement } from "react";

const OSS: [string, string, string][] = [
  ["React", "MIT", "https://react.dev/"],
  ["React DOM", "MIT", "https://react.dev/"],
  ["Vite", "MIT", "https://vite.dev/"],
  ["@vitejs/plugin-react", "MIT", "https://github.com/vitejs/vite-plugin-react"],
  ["TypeScript", "Apache-2.0", "https://www.typescriptlang.org/"],
];

export function LicensesPage(): ReactElement {
  return (
    <div style={{ maxWidth: "44rem", margin: "0 auto" }}>
      <p className="kicker">Credits</p>
      <h1>Licenses</h1>
      <p className="lede">
        The Fresh Ink preview is a small static React app. Open-source components it ships with:
      </p>
      <div className="card">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>License</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {OSS.map(([name, license, url]) => (
              <tr key={name}>
                <td>{name}</td>
                <td><code>{license}</code></td>
                <td>
                  <a href={url} rel="noopener noreferrer">
                    {url.replace("https://", "")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Typeface</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          This preview uses system typefaces only — a serif display stack and the platform sans/mono
          fonts — so no webfont licenses apply.
        </p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Branding note</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          All artwork, the studio mark, and the studio address in this preview are synthetic placeholders
          created for the demo. No production brand assets are used.
        </p>
      </div>
    </div>
  );
}
