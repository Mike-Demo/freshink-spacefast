import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Standalone SPA build for the FreshInk SpaceFast preview.
 *
 * Entry: spa.html -> src/spa/main.tsx. Output: dist-spa/.
 *
 * Everything under src/spa/ is written fresh for the preview (no Lovable,
 * Supabase, or server-only code anywhere in the bundle) — so no module
 * shims are needed.
 *
 * No `@tanstack/react-start` plugin is included — this is a plain
 * client-side React app.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(repoRoot, "src/spa") }],
  },
  build: {
    outDir: "dist-spa",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repoRoot, "spa.html"),
    },
  },
});
