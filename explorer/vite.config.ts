import { defineConfig } from "vite";

/**
 * Vite config for the Williams sound explorer.
 *
 * Phase 2.1 is the first Vite usage in this project; the plan originally
 * deferred Vite to Phase 3.1, but it was pulled forward because the
 * AudioWorklet needs ES-module bundling that Node's tsx cannot provide on
 * its own.  This keeps the dev loop a single `npm run dev` command.
 *
 * The AudioWorklet (`src/audio/worklet.ts`) cannot be loaded as-is — it
 * imports the CPU/board/synth modules using `.ts` extensions and the browser
 * can't transform TypeScript on the fly.  Two routes:
 *
 *   (a) Pre-bundle the worklet with esbuild into `public/williams-sound-explorer-worklet.js`
 *       so the browser sees a single self-contained ES module.  We do this
 *       via the `build:worklet` npm script, run before `vite dev` and
 *       `vite build`.
 *   (b) Use a Vite plugin that recognises `?worklet` query strings.  We
 *       might revisit in Phase 3+, once the visualisation layer adds more
 *       moving parts.
 *
 * For Phase 2.1 the simpler (a) is more than enough.
 */
export default defineConfig({
  // Base path: "/" for local dev; the GitHub Pages workflow sets
  // VITE_BASE=/williams-sound-explorer/ so assets + runtime fetches resolve under the
  // project-pages subpath.  Runtime fetches use `import.meta.env.BASE_URL`.
  base: process.env.VITE_BASE || "/",
  // Resolve `.ts` extensions in imports — matches our tsconfig.
  resolve: {
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
  // Dev server lives in this folder; `public/` is served from `/`.
  publicDir: "public",
  server: {
    port: 5173,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
