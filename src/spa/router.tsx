import { useCallback, useEffect, useMemo, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "agents" }
  | { name: "licenses" }
  | { name: "health" }
  | { name: "checkout"; id: string }
  | { name: "pass"; token: string };

export function parseRoute(pathname: string): Route | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/agents") return { name: "agents" };
  if (path === "/licenses") return { name: "licenses" };
  if (path === "/health") return { name: "health" };
  let m = /^\/checkout\/([^/]+)$/.exec(path);
  if (m) return { name: "checkout", id: decodeURIComponent(m[1] ?? "") };
  m = /^\/pass\/([^/]+)$/.exec(path);
  if (m) return { name: "pass", token: decodeURIComponent(m[1] ?? "") };
  return null;
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useRoute(): Route | null {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return useMemo(() => parseRoute(pathname), [pathname]);
}

export function useNavigate(): (path: string) => void {
  return useCallback(navigate, []);
}
