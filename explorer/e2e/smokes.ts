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
  // Fire-button "sounding now" hint: fire SAW at ¼× (so the sound is still
  // producing output — the trailing segment stays open — well past the assert),
  // then verify #fire gains the `.firing` glow class while it stays enabled.
  // Regression guard for liveSoundActive() + the renderState toggle.
  {
    id: "fire-firing-hint",
    game: "defender",
    steps: [
      { speed: "0.25" },
      { fireChip: "1D" }, // SAW (VARI) — long enough to still be sounding at assert
      { waitMs: 400 }, // let a snapshot with the open segment arrive
    ],
    readyWhen: { recorded: true },
    assert: [
      { hasClass: ["#fire", "firing"] }, // glows while sounding (button stays enabled in code — never re-fire-blocked)
    ],
    shot: { clip: "#fire", file: "out/smokes/fire-firing-hint.png" },
  },
];
