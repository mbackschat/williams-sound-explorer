/**
 * Capture manifest for the **Designer** docs (`MANUAL_DESIGNER.md` + the
 * Sound Designer section of `README.md`).
 *
 * Each entry both verifies a Designer-mode click-path stays working and
 * produces a screenshot embedded in the manual. These are *not* tutorials
 * — they're the canonical illustrations for the Designer's flows, kept
 * in sync with the docs by re-running this manifest after Designer changes.
 *
 *   npx tsx e2e/capture.ts designer
 *   npx tsx e2e/capture.ts designer:gwave        # filter by id substring
 *
 * Shared types + selector helpers live in `manifest.ts`. Explorer
 * illustrations live in `capturesExplorer.ts`; transient regression-only
 * flows go in `smokes.ts`.
 *
 * The first switch to Design lazy-imports the module, so each entry waits
 * long enough for it to mount AND for `refreshCopySources()` to finish
 * reading available ROMs (its `loadRomBytes` calls are async; the
 * `.designer-copy` select populates only once they resolve).
 */
import { type Entry, img } from "./manifest.ts";

export const entries: Entry[] = [
  // Designer overview: enter Design, copy Defender SAW as the first slot.
  // That auto-selects the slot, which reveals the editor + audition scope and
  // triggers the offline render (so .designer-scope is non-blank without
  // needing playback).
  {
    id: "designer-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 }, // lazy import + mount + copy-sources populate
      { select: [".designer-copy", "0"] }, // first source (Defender SAW)
      { waitMs: 600 }, // offline render → scope draws
    ],
    assert: [{ canvasNonBlank: ".designer-scope" }],
    shot: { clip: "#designer-root", file: img("designer-overview") },
  },

  // "Open in Explore" handoff: from the same starting state, click the
  // designer-open-explore button.  Lands us in Explore with the custom ROM
  // loaded into the worklet, the slot's command auto-fired, and a dynamic
  // "Custom: <name>" entry in the game switcher.
  {
    id: "designer-audition-explore",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { select: [".designer-copy", "0"] },
      { waitMs: 600 },
      { click: ".designer-open-explore" },
      { waitMs: 2500 }, // worklet boots custom ROM, fires $1D, populates panels
    ],
    readyWhen: { recorded: true },
    assert: [
      { hasClass: [".game-pick-custom", "active"] },
      { canvasNonBlank: "#spectroCanvas" },
    ],
    shot: { viewport: true, file: img("designer-audition-explore") },
  },
];
