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
 * `.designer-copy` and `.designer-gwave-override` selects populate only
 * once they resolve).
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

  // GWAVE override flow (Phase 5 step 1): enter Design, pick BBSV ($05) from
  // the "Override GWAVE:" select.  The slot is added and selected, the GWAVE
  // editor shows (with PATLEN/PATOFF/WAVE# sliders), and the audition scope
  // renders BBSV via the offline custom-ROM pipeline.
  {
    id: "designer-gwave-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { select: [".designer-gwave-override", "5"] }, // $05 = BBSV
      { waitMs: 800 }, // editor switch + offline render
    ],
    assert: [{ canvasNonBlank: ".designer-scope" }],
    shot: { clip: "#designer-root", file: img("designer-gwave-overview") },
  },

  // GWAVE Open-in-Explore handoff: same starting state, then Open in Explore.
  // The custom ROM patches SVTAB[$05] with the user's edited bytes; firing
  // $05 in Explore plays the override (not stock BBSV).  Verifies the F3
  // custom-chip overlay names the slot at $05 and Cmd hex = "05".
  {
    id: "designer-gwave-audition-explore",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { select: [".designer-gwave-override", "5"] },
      { waitMs: 600 },
      { click: ".designer-open-explore" },
      { waitMs: 2500 },
    ],
    readyWhen: { recorded: true },
    // #cmd is an <input> so its value isn't visible to textContent; the
    // visual screenshot is the verification for that field.  We assert the
    // custom-ROM is the active switcher entry + spectrogram is populated.
    assert: [
      { hasClass: [".game-pick-custom", "active"] },
      { canvasNonBlank: "#spectroCanvas" },
    ],
    shot: { viewport: true, file: img("designer-gwave-audition-explore") },
  },
];
