/**
 * Capture/verify manifest — one entry per MANUAL.md tutorial (plus a few
 * README hero shots + the GIF).  This file is the single source of truth:
 * the Playwright driver in `capture.ts` loops over it to BOTH verify the
 * click-path still works (`assert`) AND produce the illustrative image
 * (`shot`).  Edit a tutorial here and both update together.
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
  | { openSection: string } //          open the <details> that contains this selector
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

export interface Entry {
  id: string; //                        also the MANUAL anchor it illustrates
  game: GameKind;
  steps: Step[];
  readyWhen?: Assert; //                gate before asserting/capturing (default: none)
  assert?: Assert[];
  shot: { clip: string; file: string }; // element-clip screenshot → repo-relative path
}

export const tutorials: Entry[] = [
  // ── Tutorial 2: slow-mo LITE — capture the LFSR sweep in the spectrogram ──
  {
    id: "tut-02-slowmo-lfsr",
    game: "defender",
    steps: [
      { speed: "0.1" }, //   slow first so the whole ~700 ms sound fills a ~7 s capture window
      { fireChip: "11" }, //  LITE (LFSR)
      { waitMs: 5500 }, //    near the end of the ~7 s slow playback → spectrogram nearly full
    ],
    readyWhen: { recorded: true },
    assert: [
      { cmdInfoContains: "LITE" },
      { text: ["#pauseState", "running"] },
      { canvasNonBlank: "#spectroCanvas" },
    ],
    shot: { clip: "#spectroCanvas", file: "docs/img/manual/tut-02-slowmo-lfsr.png" },
  },
];
