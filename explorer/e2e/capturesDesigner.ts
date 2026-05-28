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
 * `.designer-copy` populates only once it resolves; the GWAVE pre-populated
 * rows (`.designer-item[data-cmd='XX'][data-kind='gwave']`) are available
 * as soon as `populateProject` runs in `loadEngineRom`, which is part of
 * the lazy-import boot).
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

  // GWAVE override flow (Phase 5 step 1+2): enter Design, pick BBSV ($05)
  // from the "Override GWAVE:" select.  The slot is added and selected, the
  // GWAVE editor shows the 9 SVTAB sliders **plus the click-to-draw
  // waveform canvas** (Step 2) below them, with a "Shared by" line listing
  // the other editable GWAVE commands that point at the same WAVE#.
  {
    id: "designer-gwave-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave']" }, // pre-populated $05 BBSV row
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
      { click: ".designer-item[data-cmd='05'][data-kind='gwave']" }, // pre-populated $05 BBSV row
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

  // Step 4 — "+ New waveform" creates a user-added waveform at idx 7 and
  // points the slot's WAVE# at it.  Verifies the relocated GWVTAB path
  // works end-to-end (the offline audition renders, so customRom.ts is
  // patching LDX #GWVTAB + writing the new table correctly).
  {
    id: "designer-gwave-added-waveform",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave']" }, // pre-populated $05 BBSV row
      { waitMs: 600 },
      { click: ".designer-wfcanvas-add" },           // + New waveform
      { waitMs: 600 },
    ],
    assert: [{ canvasNonBlank: ".designer-scope" }],
    shot: { clip: "#designer-root", file: img("designer-gwave-added-waveform") },
  },

  // Designer polish: "↻ Reset record" reverts a tweaked VARI slot's record
  // to its start bytes.  Smoke walks: copy SAW → tweak slider → click Reset
  // → assert status line confirms the revert + audition still renders.
  {
    id: "designer-vari-reset-record",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { select: [".designer-copy", "0"] },           // copy Defender SAW → first slot
      { waitMs: 600 },
      // Drag the first VARI slider away from the start record — `fill` works
      // on range inputs the same way (`.value = X` + `input` event).
      { fill: [".designer-fields .param-row:nth-child(1) .param-slider", "200"] },
      { waitMs: 250 },
      { click: ".designer-record-reset" },           // ↻ Reset record
      { waitMs: 600 },
    ],
    // After Reset, the button is disabled again (record === start), and the
    // scope replays from the start record.  Together: the reset path is
    // wired end-to-end.  (The auto-replay's "Edited — N ms." overwrites the
    // transient "Reverted" status message ~130 ms after the click, so we
    // check the button state, not the status text.)
    assert: [
      { disabled: ".designer-record-reset" },
      { canvasNonBlank: ".designer-scope" },
    ],
    shot: { clip: "#designer-root", file: img("designer-vari-reset-record") },
  },

  // Phase 6.2 .bin roundtrip — full UI loop: edit BBSV → ↓ .bin → ↑ .bin →
  // status reports "Imported" with the reconstructed edit.  Verifies the
  // download + upload buttons wire through to buildEdited / importBinAsProject
  // end-to-end.  The headless test (`tests/projectFromBin.test.ts`) is the
  // exhaustive correctness gate; this smoke catches UI-wiring regressions.
  {
    id: "designer-bin-roundtrip",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave']" }, // select BBSV
      { waitMs: 400 },
      // Edit the first GWAVE slider (GECHO) so the .bin diverges from base.
      { fill: [".designer-fields-gwave .param-row:nth-child(1) .param-slider", "5"] },
      { waitMs: 200 },
      // ↓ .bin → save to a temp file.  Uses the bar's `↓ .bin` button.
      { expectDownload: ["button[title^='Download your custom ROM']", "/tmp/wsed-roundtrip.bin"] },
      { waitMs: 200 },
      // ↑ .bin → re-upload that file.  Hits the hidden file input directly
      // (the visible `↑ .bin` button only clicks() the input behind it).
      { uploadFile: [".designer-import-bin", "/tmp/wsed-roundtrip.bin"] },
      { waitMs: 800 },
    ],
    assert: [
      // Status line confirms the import reconstructed an edit; the scope
      // still draws (the imported project auto-selects slot 0 + replays).
      { textContains: [".designer-status", "Imported"] },
      { canvasNonBlank: ".designer-scope" },
    ],
    shot: { clip: "#designer-root", file: img("designer-bin-roundtrip") },
  },

  // Designer polish: × Remove drops a user-added waveform and re-clamps any
  // slot's WAVE# that pointed at it (back to stock $06).  Click-path also
  // verifies the ROM-space indicator stays present + the project recovers.
  // (No shipped illustration — purely a regression smoke for the polish pass.)
  {
    id: "designer-gwave-remove-waveform",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave']" }, // pre-populated $05 BBSV row
      { waitMs: 600 },
      { click: ".designer-wfcanvas-add" },           // + New waveform → idx 7
      { waitMs: 600 },
      { click: ".designer-wfcanvas-remove" },        // × Remove
      { waitMs: 600 },
    ],
    // The slot survives, the ROM-space indicator is still drawn, and the
    // scope still renders (we're back on a stock-pointed BBSV).
    assert: [
      { canvasNonBlank: ".designer-scope" },
      { hasClass: [".designer-rom-space", "designer-bar-label"] },
    ],
    shot: { clip: "#designer-root", file: img("designer-gwave-remove-waveform") },
  },
];
