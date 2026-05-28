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
    assert: [
      { canvasNonBlank: ".designer-scope" },
      // Keybinding discoverability: the Designer Play button names its key.
      { attrContains: [".designer-play", "title", "[Space]"] },
    ],
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

  // GWAVE editor view (Phase 5 step 1+2, Phase 6.1 pre-populated): enter Design,
  // click the pre-populated $05 BBSV row.  The GWAVE editor shows the 9 SVTAB
  // sliders **plus the click-to-draw waveform canvas** (Step 2) below them,
  // with a "Shared by" line listing the other editable GWAVE commands that
  // point at the same WAVE#.  ("Override GWAVE:" dropdown is gone since
  // Phase 6.1 — every editable GWAVE row is already in the populated list.)
  {
    id: "designer-gwave-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" }, // pre-populated $05 BBSV row
      { waitMs: 800 }, // editor switch + offline render
    ],
    assert: [
      { canvasNonBlank: ".designer-scope" },
      { textContains: [".designer-edit > .designer-edit-label", "GWAVE"] }, // the right editor is open
    ],
    shot: { clip: "#designer-root", file: img("designer-gwave-overview") },
  },

  // LFSR editor (Phase 7) — the populated list now carries the LFSR family
  // (LITE / TURBO / APPEAR; + LAUNCH on Robotron) as override-in-place rows.
  // Selecting TURBO ($14) shows its 4-field slider set (CYCNT/NFFLG, DECAY,
  // NFRQ1, NAMP) and an offline-rendered audition trace.  Verifies the
  // per-command slider rebuild + the lfsr build path render correctly.
  {
    id: "designer-lfsr-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='14'][data-kind='lfsr'] .designer-item-code" }, // pre-populated $14 TURBO row
      { waitMs: 800 }, // editor switch + offline render
    ],
    assert: [
      { canvasNonBlank: ".designer-scope" },
      { textContains: [".designer-edit > .designer-edit-label", "LFSR"] }, // the LFSR editor is open, not the default GWAVE row
    ],
    shot: { clip: "#designer-root", file: img("designer-lfsr-overview") },
  },

  // FNOISE editor (Phase 8) — the populated list carries THRUST + CANNON as
  // override-in-place rows on Defender (BG1 omitted — no patchable immediate;
  // Robotron adds BG1 + HBOMB via its FNTAB table). Selecting CANNON ($17)
  // shows its 4-field inline record (DSFLG, FDFLG, FMAX, SAMPC) + an
  // offline-rendered audition trace. Exercises the D/S inline build path.
  {
    id: "designer-fnoise-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='17'][data-kind='fnoise'] .designer-item-code" }, // pre-populated $17 CANNON row
      { waitMs: 800 },
    ],
    assert: [
      { canvasNonBlank: ".designer-scope" },
      { textContains: [".designer-edit > .designer-edit-label", "FNOISE"] }, // the FNOISE editor is open, not the default GWAVE row
    ],
    shot: { clip: "#designer-root", file: img("designer-fnoise-overview") },
  },

  // RADIO editor (Phase 9) — the single $18 RADIO row is in the populated list
  // on every game. Selecting it shows the hybrid editor: a FREQ slider + a
  // 16-cell click-to-draw wavetable canvas, with an offline-rendered audition
  // trace. Exercises the in-place FREQ-immediate + RADSND-LUT build path.
  {
    id: "designer-radio-overview",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='18'][data-kind='radio'] .designer-item-code" }, // pre-populated $18 RADIO row
      { waitMs: 800 },
    ],
    assert: [
      { canvasNonBlank: ".designer-scope" },
      { textContains: [".designer-edit > .designer-edit-label", "RADIO"] }, // the RADIO editor is open, not the default GWAVE row
    ],
    shot: { clip: "#designer-root", file: img("designer-radio-overview") },
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
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" }, // pre-populated $05 BBSV row
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
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" }, // pre-populated $05 BBSV row
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
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" }, // select BBSV
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
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" }, // pre-populated $05 BBSV row
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

  // Item-list close-up (MANUAL_DESIGNER illustration) — a tight clip of just the
  // populated list so the five engine colour-tags, the stock/edited dots, and
  // the 7-row column flow are legible (the full-root hero is too zoomed out).
  {
    id: "designer-item-list",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
    ],
    assert: [{ attrContains: [".designer-item[data-cmd='18'][data-kind='radio']", "data-kind", "radio"] }],
    shot: { clip: ".designer-items", file: img("designer-item-list") },
  },

  // Diff overlay (MANUAL_DESIGNER illustration) — select BBSV, make a large edit
  // (+ New waveform), toggle Diff on, and shoot the scope: the start (grey ghost)
  // + the divergence (red) sit behind the live trace. Illustrates the A/B + Diff
  // feature, which nothing else captures.
  {
    id: "designer-diff",
    game: "defender",
    steps: [
      { click: "#modeDesign" },
      { waitMs: 1500 },
      { click: ".designer-item[data-cmd='05'][data-kind='gwave'] .designer-item-code" },
      { waitMs: 600 },
      { click: ".designer-wfcanvas-add" }, // big edit so the diff is clearly visible
      { waitMs: 700 },
      { click: ".designer-diff" },          // toggle Diff overlay on
      { waitMs: 400 },
    ],
    assert: [
      { hasClass: [".designer-diff", "toggle-on"] },
      { canvasNonBlank: ".designer-scope" },
    ],
    shot: { clip: ".designer-edit", file: img("designer-diff") },
  },
];
