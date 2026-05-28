/**
 * Transient regression smokes — Playwright entries used to verify a flow
 * works *during feature work*, then deleted when the feature ships.
 *
 * Unlike `capturesExplorer.ts` / `capturesDesigner.ts`, entries here are
 * **not tutorials** and they don't produce screenshots that go into the docs.
 * Their `shot.file` should point under `out/smokes/` (gitignored) so the
 * artefact never leaks into the published docs/img/ tree. Per the CLAUDE.md
 * convention: this file is the home for what would otherwise be a throwaway
 * `smoke-*.ts` script in the repo root.
 *
 *   npx tsx e2e/capture.ts smokes              # run every smoke
 *   npx tsx e2e/capture.ts smokes:foo          # filter by id substring
 *
 * Conventions for adding an entry:
 *  - Prefer a short id describing the flow under test (e.g. `gwave-canvas-drag`).
 *  - `shot.file` MUST start with `out/smokes/` so it's gitignored.
 *  - **Delete the entry once the feature ships and its permanent illustration
 *    lives in `capturesExplorer.ts` / `capturesDesigner.ts`.**
 */
import { type Entry } from "./manifest.ts";

export const entries: Entry[] = [
  // (none today — add transient regression checks here while building a flow,
  // and remove them when the feature ships + its permanent capture lives in
  // capturesExplorer.ts or capturesDesigner.ts.)
];
