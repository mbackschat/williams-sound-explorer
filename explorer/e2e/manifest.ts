/**
 * Shared capture-manifest types + selector helpers.
 *
 * Three sibling manifests build on these:
 *  - `capturesExplorer.ts` — illustrations for **MANUAL.md**.
 *  - `capturesDesigner.ts` — illustrations for **MANUAL_DESIGNER.md**.
 *  - `smokes.ts` — transient regression-only flows (no shipping screenshots).
 *
 * The driver in `capture.ts` selects one or all and loops over its entries,
 * for each one **verifying the click-path still works** (`assert`) AND
 * **producing the illustrative image** (`shot`). Selectors are the app's
 * existing stable IDs / data-attrs — see `src/web/main.ts`. Nothing in any
 * manifest is allowed to depend on ROM *bytes*; screenshots show the app's
 * own visualisations only.
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
  | { disabled: string } //             element's `disabled` property is true (button/input)
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
export const panel = (canvasId: string): string => `section.panel:has(#${canvasId})`;
/** Clip a per-engine pane (canvas + title). */
export const enginePane = (engine: string): string => `section.engine-view-pane[data-engine="${engine}"]`;
/** Repo-relative path of a screenshot under `docs/img/manual/`. */
export const img = (name: string): string => `docs/img/manual/${name}.png`;
