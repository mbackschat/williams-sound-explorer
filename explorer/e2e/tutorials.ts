/**
 * Capture/verify manifest — one entry per MANUAL.md tutorial, plus per-engine
 * showcase panels.  This file is the single source of truth: the Playwright
 * driver in `capture.ts` loops over it to BOTH verify the click-path still
 * works (`assert`) AND produce the illustrative image (`shot`).  Edit a
 * tutorial here and both update together.
 *
 * Selectors used are the app's existing stable IDs / data-attrs — see
 * `src/web/main.ts`.  Nothing here is allowed to depend on ROM *bytes*;
 * the screenshots show the explorer's own visualisations only.
 */

export type GameKind = "defender" | "stargate" | "robotron";

/** A single UI action. The driver understands this fixed vocabulary. */
export type Step =
  | { fireChip: string } //            click #cmdChips button.chip[data-cmd=XX] (uppercase hex)
  | { speed: "1" | "0.25" | "0.1" | "0.01" } // click button[data-speed=…]
  | { click: string } //               click any selector
  | { select: [sel: string, value: string] } // set a <select> value + fire change
  | { fill: [sel: string, value: string] } //  set a text <input> value + fire input
  | { hover: string } //               move the mouse over a selector (publishes the INSPECT cursor)
  | { openSection: string } //          open the <details> containing this selector
  | { scrubTo: number } //              set #scrubPos to a 0..1 fraction (deterministic freeze)
  | { waitMs: number }; //              settle delay (let a canvas fill / animation advance)

/** A single post-condition. DOM/text by default; one weak pixel probe. */
export type Assert =
  | { recorded: true } //               #scrubReadout left the "no recording yet" state
  | { text: [sel: string, exact: string] }
  | { textContains: [sel: string, sub: string] }
  | { cmdInfoContains: string } //      shorthand for #cmdInfo textContains
  | { hasClass: [sel: string, cls: string] }
  | { markerCountAtLeast: number } //   #scrubMarkers child count
  | { canvasNonBlank: string }; //      element is not a uniform fill (range of a colour channel)

/** Where the screenshot comes from: an element clip, the viewport, or the whole page. */
export type Shot =
  | { clip: string; file: string } //   element-clip screenshot (a single panel)
  | { viewport: true; file: string } // the visible window (interface-tour overview / navigation)
  | { fullPage: true; file: string }; // the entire scrollable page (the full UI map)

export interface Entry {
  id: string; //                        also the MANUAL anchor it illustrates
  game: GameKind;
  steps: Step[];
  readyWhen?: Assert; //                gate before asserting/capturing (default: none)
  assert?: Assert[];
  shot: Shot; //                        → repo-relative path
}

/** Clip the whole `section.panel` wrapping a live-grid canvas (includes its label). */
const panel = (canvasId: string) => `section.panel:has(#${canvasId})`;
/** Clip a per-engine pane (canvas + title). */
const enginePane = (engine: string) => `section.engine-view-pane[data-engine="${engine}"]`;
const img = (name: string) => `docs/img/manual/${name}.png`;

export const tutorials: Entry[] = [
  // ── Tutorial 1: hear your first sound — the noisy LITE oscilloscope ──
  {
    id: "tut-01-first-sound",
    game: "defender",
    // 1× (not slow-mo): the scope shows only the last ~10.7 ms, so dense LFSR
    // noise only fills it at full speed — and we must grab it mid-sound (LITE is
    // ~700 ms; the worklet goes silent, hence flat, once it ends).
    steps: [{ speed: "1" }, { fireChip: "11" }, { waitMs: 150 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "LITE" }, { canvasNonBlank: "#earCanvas" }],
    shot: { clip: panel("earCanvas"), file: img("tut-01-first-sound") },
  },

  // ── Tutorial 2: slow-mo LITE — the LFSR broadband sweep in the spectrogram ──
  {
    id: "tut-02-slowmo-lfsr",
    game: "defender",
    steps: [{ speed: "0.1" }, { fireChip: "11" }, { waitMs: 5500 }],
    readyWhen: { recorded: true },
    assert: [
      { cmdInfoContains: "LITE" },
      { text: ["#pauseState", "running"] },
      { canvasNonBlank: "#spectroCanvas" },
    ],
    shot: { clip: "#spectroCanvas", file: img("tut-02-slowmo-lfsr") },
  },

  // ── Tutorial 3: the byte tape — every DAC write as a coloured cell (HBDV) ──
  {
    id: "tut-03-byte-tape",
    game: "defender",
    steps: [{ speed: "0.1" }, { fireChip: "01" }, { waitMs: 2500 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "HBDV" }, { canvasNonBlank: "#eyeCanvas" }],
    shot: { clip: panel("eyeCanvas"), file: img("tut-03-byte-tape") },
  },

  // ── Tutorial 4: the tape scrubber — markers + a frozen replay frame (SAW) ──
  {
    id: "tut-04-scrubber",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1D" }, { waitMs: 2000 }, { click: "#scrubStart" }, { scrubTo: 0.5 }],
    readyWhen: { recorded: true },
    assert: [{ markerCountAtLeast: 1 }, { hasClass: ["#scrubStart", "active"] }, { canvasNonBlank: "#variCanvas" }],
    shot: { clip: "details:has(#scrubMarkers)", file: img("tut-04-scrubber") },
  },

  // ── Tutorial 5: the stage swimlane — which ROM routine wrote each sample (HBDV) ──
  {
    id: "tut-05-swimlane",
    game: "defender",
    steps: [{ speed: "0.1" }, { fireChip: "01" }, { waitMs: 2500 }],
    readyWhen: { recorded: true },
    assert: [{ canvasNonBlank: "#swimlaneCanvas" }],
    shot: { clip: panel("swimlaneCanvas"), file: img("tut-05-swimlane") },
  },

  // ── Tutorial 6: freeze the LFSR — the Pattern-3 toggle row, Freeze LFSR active ──
  {
    id: "tut-06-freeze-lfsr",
    game: "defender",
    steps: [
      { click: '#engineToggleRow label:has-text("Freeze LFSR")' },
      { speed: "0.1" },
      { fireChip: "11" },
      { waitMs: 1500 },
    ],
    readyWhen: { recorded: true },
    assert: [{ hasClass: ['#engineToggleRow label:has-text("Freeze LFSR")', "active"] }, { canvasNonBlank: "#spectroCanvas" }],
    shot: { clip: "section.engine-view-info", file: img("tut-06-freeze-lfsr") },
  },

  // ── Tutorial 7: what-if slider — force LOPER on the VARI pane (yellow row) ──
  {
    id: "tut-07-param-slider",
    game: "defender",
    steps: [
      { speed: "0.25" },
      { fireChip: "1D" },
      { waitMs: 1500 },
      { click: '.param-row:has-text("LOPER") .param-force-cb' },
    ],
    readyWhen: { recorded: true },
    assert: [{ hasClass: ['.param-row:has-text("LOPER")', "forced"] }, { canvasNonBlank: "#variCanvas" }],
    shot: { clip: enginePane("vari"), file: img("tut-07-param-slider") },
  },

  // ── Tutorial 8: cross-game A/B — Defender 01 vs Stargate 01 diff ──
  {
    id: "tut-08-ab-diff",
    game: "defender",
    steps: [
      { openSection: "#abRun" },
      { select: ["#abGameA", "defender"] },
      { fill: ["#abCmdA", "01"] },
      { select: ["#abGameB", "stargate"] },
      { fill: ["#abCmdB", "01"] },
      { click: "#abRun" },
      { waitMs: 500 },
    ],
    readyWhen: { textContains: ["#abSummary", "%"] },
    assert: [{ textContains: ["#abSummary", "%"] }, { canvasNonBlank: "#abCanvas" }],
    shot: { clip: panel("abCanvas"), file: img("tut-08-ab-diff") },
  },

  // ── Tutorial 9: genealogy — the sound family tree ──
  {
    id: "tut-09-genealogy",
    game: "defender",
    steps: [{ openSection: "#genealogyList" }, { waitMs: 300 }],
    shot: { clip: "#genealogyList", file: img("tut-09-genealogy") },
  },

  // ── Tutorial 10: step through — fire LITE, pause, read the Code panel ──
  {
    id: "tut-10-step",
    game: "defender",
    steps: [{ speed: "0.1" }, { fireChip: "11" }, { waitMs: 300 }, { click: "#pause" }, { click: "#step" }],
    readyWhen: { recorded: true },
    assert: [{ text: ["#pauseState", "paused"] }, { textContains: ["#codePanel", "PC="] }],
    shot: { clip: panel("codePanel"), file: img("tut-10-step") },
  },

  // ── Tutorial 11: causal hover — hover the spectrogram, read the INSPECT line ──
  {
    id: "tut-11-causal-hover",
    game: "defender",
    steps: [{ speed: "0.1" }, { fireChip: "11" }, { waitMs: 5000 }, { hover: "#spectroCanvas" }, { waitMs: 300 }],
    readyWhen: { recorded: true },
    assert: [{ textContains: ["#codePanel", "INSPECT"] }],
    shot: { clip: panel("codePanel"), file: img("tut-11-causal-hover") },
  },

  // ── Tutorial 12: combine toggles — Robotron HBDV with WVDECA skipped ──
  {
    id: "tut-12-combine",
    game: "robotron",
    steps: [
      { click: '#engineToggleRow label:has-text("Skip WVDECA")' },
      { speed: "0.1" },
      { fireChip: "01" },
      { waitMs: 2500 },
    ],
    readyWhen: { recorded: true },
    assert: [{ hasClass: ['#engineToggleRow label:has-text("Skip WVDECA")', "active"] }, { canvasNonBlank: "#wavetableCanvas" }],
    shot: { clip: enginePane("gwave"), file: img("tut-12-combine") },
  },

  // ── Engine showcases (Defender samples per docs/web-capture.md) ──
  {
    id: "engine-gwave",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "0A" }, { waitMs: 1500 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "SV3" }, { canvasNonBlank: "#wavetableCanvas" }],
    shot: { clip: enginePane("gwave"), file: img("engine-gwave") },
  },
  {
    id: "engine-fnoise",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "16" }, { waitMs: 1500 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "THRUST" }, { canvasNonBlank: "#fnoiseCanvas" }],
    shot: { clip: enginePane("fnoise"), file: img("engine-fnoise") },
  },
  {
    id: "engine-scream",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1A" }, { waitMs: 1500 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "SCREAM" }, { canvasNonBlank: "#screamCanvas" }],
    shot: { clip: enginePane("scream"), file: img("engine-scream") },
  },
  {
    id: "engine-vari",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1F" }, { waitMs: 1500 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "QUASAR" }, { canvasNonBlank: "#variCanvas" }],
    shot: { clip: enginePane("vari"), file: img("engine-vari") },
  },
  {
    id: "engine-organ",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1B" }, { waitMs: 2000 }],
    readyWhen: { recorded: true },
    assert: [{ cmdInfoContains: "ORGANT" }, { canvasNonBlank: "#organCanvas" }],
    shot: { clip: enginePane("organ"), file: img("engine-organ") },
  },

  // ── Interface tour (§2): viewport / full-page shots, not single panels ──

  // #1 — the default two-column layout at a glance (controls + live grid left, engines + spectrogram right).
  {
    id: "ui-overview",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1D" }, { waitMs: 2500 }],
    readyWhen: { recorded: true },
    assert: [{ canvasNonBlank: "#spectroCanvas" }],
    shot: { viewport: true, file: img("ui-overview") },
  },

  // #2 — navigating the columns: with the left column sticky, the Ear oscilloscope
  //      (left) and the active GWAVE pane (right) sit in the same band — fire a GWAVE
  //      sound and the two read side by side across the columns.
  {
    id: "ui-navigate-columns",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "01" }, { waitMs: 1500 }], // HBDV → GWAVE pane active on the right
    readyWhen: { recorded: true },
    assert: [{ canvasNonBlank: "#wavetableCanvas" }, { canvasNonBlank: "#earCanvas" }],
    shot: { viewport: true, file: img("ui-navigate-columns") },
  },

  // #3 — the whole scrollable UI top-to-bottom in one image (the full map).
  {
    id: "ui-full-map",
    game: "defender",
    steps: [{ speed: "0.25" }, { fireChip: "1D" }, { waitMs: 2500 }],
    readyWhen: { recorded: true },
    assert: [{ canvasNonBlank: "#spectroCanvas" }],
    shot: { fullPage: true, file: img("ui-full-map") },
  },
];
