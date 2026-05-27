/**
 * Eye panel — DAC byte tape (Step 3.3 / Pattern 2).
 *
 * Each event from `snapshot.recentDacEvents` becomes a coloured cell.  Cell
 * width is proportional to dwell time (how long that byte was held until
 * the next write).  Colour ramp is symmetric around the mid-rail ($80):
 * blue for negative DAC values, green at zero, yellow→red for positive.
 *
 * The tape head is at the right edge of the canvas — newest events on the
 * right, scrolling left.  The "now" cycle is `snapshot.scrubCycle` while
 * scrubbing, otherwise `snapshot.cycles`.
 *
 * Hover any cell → tooltip showing `$XX  @cycle  pc=$YYYY`.  Source-line
 * resolution is deferred to Step 3.4 (needs the label-map JSON).
 *
 * Each draw resets a `cellStops` array that maps canvas X-pixels back to
 * event indices for the hover lookup.  Smarter than re-scanning the events
 * on every mouse move.
 */
import type { StateSnapshot } from "../data/protocol.ts";
import type { VizPanel } from "./types.ts";
import type { LabelMap } from "../web/labelMap.ts";
import type { GameKind } from "../board/soundboard.ts";
import { resolve, formatLabel } from "../web/labelMap.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

/** Pattern 8 hover hook — emits the cycle the user is pointing at. */
export interface EyeHoverHooks {
  onCycleHover?: (cycle: number) => void;
  onCycleLeave?: () => void;
}

const BG_COLOR = "#0c0e12";
const HEAD_COLOR = "#ffd866";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#abafb6";

/** Cells map a sub-pixel X range to an event index for hover lookup. */
interface CellExtent {
  x0: number;
  x1: number;
  eventIdx: number;
}

/** Colour palette around the mid-rail, built once. */
function buildBytePalette(): string[] {
  const out: string[] = new Array(256);
  for (let v = 0; v < 256; v++) {
    // -1 .. 0 .. +1
    const n = (v - 0x80) / 0x80;
    let r: number;
    let g: number;
    let b: number;
    if (n <= 0) {
      // Blue → cyan → soft green as we approach the mid-rail.
      const t = Math.max(0, 1 + n); // 0 at -1, 1 at 0
      r = Math.round(40 * t);
      g = Math.round(80 + 140 * t);
      b = Math.round(200 - 80 * t);
    } else {
      // Soft green → yellow → red moving above the mid-rail.
      const t = n; // 0..1
      r = Math.round(40 + 215 * t);
      g = Math.round(220 - 100 * t);
      b = Math.round(120 - 120 * t);
    }
    out[v] = `rgb(${r}, ${g}, ${b})`;
  }
  return out;
}
const BYTE_PALETTE = buildBytePalette();

export class EyePanel implements VizPanel {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tooltipEl: HTMLDivElement;
  private cellExtents: CellExtent[] = [];
  private lastEvents: { cycles: Float64Array; values: Uint8Array; pcs: Uint16Array; count: number } | undefined;
  private labelMap: LabelMap | undefined;
  private getGame: (() => GameKind) | undefined;
  private hoverHooks: EyeHoverHooks = {};
  private lastHoveredEventIdx: number | undefined;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("EyePanel: 2D context unavailable");
    this.ctx = ctx;
    // Lazily create a single absolutely-positioned tooltip element shared by
    // all hover events; keeps the DOM small and the layout stable.
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "eye-tooltip";
    this.tooltipEl.style.position = "fixed";
    this.tooltipEl.style.display = "none";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.background = "#11141a";
    this.tooltipEl.style.border = "1px solid #2a2f37";
    this.tooltipEl.style.padding = "0.3rem 0.5rem";
    this.tooltipEl.style.fontSize = "0.78rem";
    this.tooltipEl.style.color = TEXT_COLOR;
    this.tooltipEl.style.borderRadius = "3px";
    this.tooltipEl.style.zIndex = "1000";
    this.tooltipEl.style.whiteSpace = "nowrap";
    this.tooltipEl.style.fontFamily = "ui-monospace, monospace";
    document.body.appendChild(this.tooltipEl);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    this.sizeForDpr();
    this.drawEmpty();
    attachResizeRedraw(canvas, () => {
      this.sizeForDpr();
      if (this.lastSnapshot) this.update(this.lastSnapshot);
      else this.drawEmpty();
    });
  }

  /** Plumb the label map in once it's loaded (Step 3.4). */
  setLabelMap(map: LabelMap, getGame: () => GameKind): void {
    this.labelMap = map;
    this.getGame = getGame;
  }

  /** Register Pattern 8 (Step 4.5) hover hooks alongside the existing tooltip. */
  setHoverHooks(hooks: EyeHoverHooks): void {
    this.hoverHooks = hooks;
  }

  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 320;
    const cssH = this.canvas.clientHeight || 130;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawEmpty(): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText("DAC byte tape — fire a sound", 8, 16);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const ev = snapshot.recentDacEvents;
    this.lastEvents = ev;
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Window bounds come from the worklet when available — backward-looking
    // during live playback, centred on the scrub head while scrubbing.
    // Fallback: if the worklet is stale (older bundle without windowStart),
    // synthesise sensible bounds from current head + a fixed 250 ms window.
    // Without this, undefined arithmetic gives NaN and the tape goes blank.
    const FALLBACK_WINDOW = 224_000; // ~250 ms at 894 886 Hz
    const head = snapshot.scrubbing ? snapshot.scrubCycle : snapshot.cycles;
    const windowStart = typeof ev.windowStart === "number"
      ? ev.windowStart
      : snapshot.scrubbing
        ? head - FALLBACK_WINDOW / 2
        : head - FALLBACK_WINDOW;
    const windowEnd = typeof ev.windowEnd === "number"
      ? ev.windowEnd
      : snapshot.scrubbing
        ? head + FALLBACK_WINDOW / 2
        : head;
    const span = Math.max(1, windowEnd - windowStart);
    const pxPerCycle = w / span;

    const bandTop = 18;
    const bandBottom = h - 8;
    const bandH = Math.max(8, bandBottom - bandTop);

    this.cellExtents = [];
    if (ev.count > 0) {
      for (let i = 0; i < ev.count; i++) {
        const cStart = ev.cycles[i]!;
        // Cell extends to the next event's cycle, or to the window's end
        // for the final in-window event.
        const cEnd = i + 1 < ev.count ? ev.cycles[i + 1]! : windowEnd;
        if (cEnd <= cStart) continue;
        const x0 = (cStart - windowStart) * pxPerCycle;
        const x1 = (cEnd - windowStart) * pxPerCycle;
        if (x1 <= 0 || x0 >= w) continue;
        const drawX0 = Math.max(0, x0);
        const drawX1 = Math.min(w, x1);
        const cellW = Math.max(1, drawX1 - drawX0);
        ctx.fillStyle = BYTE_PALETTE[ev.values[i]!]!;
        ctx.fillRect(drawX0, bandTop, cellW, bandH);
        this.cellExtents.push({ x0: drawX0, x1: drawX0 + cellW, eventIdx: i });
      }
    }

    // Tape-head indicator.  Live = right edge; scrub = at the head's
    // actual cycle (mid-canvas for the centred window).
    const headCycle = snapshot.scrubbing ? snapshot.scrubCycle : windowEnd;
    const headX = Math.max(0, Math.min(w, (headCycle - windowStart) * pxPerCycle));
    ctx.fillStyle = HEAD_COLOR;
    ctx.fillRect(headX - 1, bandTop, 2, bandH);

    // Caption.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    const spanMs = (span / 894_886) * 1000;
    const mode = snapshot.scrubbing
      ? `scrub (head centred, ±${(spanMs / 2).toFixed(0)} ms)`
      : `live (last ${spanMs.toFixed(0)} ms)`;
    ctx.fillText(`${ev.count} events · ${mode}`, 8, 12);
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.lastEvents || this.cellExtents.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Binary search across cellExtents (they're sorted by x0).
    const cell = this.findCellAt(x);
    if (cell === undefined) {
      this.tooltipEl.style.display = "none";
      if (this.lastHoveredEventIdx !== undefined) {
        this.lastHoveredEventIdx = undefined;
        this.hoverHooks.onCycleLeave?.();
      }
      return;
    }
    const ev = this.lastEvents;
    const i = cell.eventIdx;
    const cycle = ev.cycles[i]!;
    // Pattern 8 — publish historical cycle alongside the tooltip.  Throttle
    // to "only on cell change" so the cross-panel inspect doesn't churn the
    // CodePanel on every pixel of intra-cell motion.
    if (this.lastHoveredEventIdx !== i) {
      this.lastHoveredEventIdx = i;
      this.hoverHooks.onCycleHover?.(cycle);
    }
    const value = ev.values[i]!;
    const pc = ev.pcs[i]!;
    const norm = ((value - 0x80) / 0x80).toFixed(3);
    const hex = (n: number, w: number): string =>
      n.toString(16).toUpperCase().padStart(w, "0");
    let labelLine = "";
    if (this.labelMap && this.getGame) {
      const resolved = resolve(this.labelMap, this.getGame(), pc);
      if (resolved) {
        const src = this.labelMap.sources[this.getGame()] ?? "";
        const srcRef = resolved.src_line != null && src
          ? `<br><span style="color:${SUB_COLOR}">${src}:</span>${resolved.src_line}`
          : "";
        labelLine = `<br><span style="color:${SUB_COLOR}">in </span>${formatLabel(resolved)}${srcRef}`;
      }
    }
    this.tooltipEl.innerHTML =
      `<strong>$${hex(value, 2)}</strong>  (${norm})<br>` +
      `<span style="color:${SUB_COLOR}">cycle </span>${cycle.toLocaleString()}<br>` +
      `<span style="color:${SUB_COLOR}">from PC </span>$${hex(pc, 4)}` +
      labelLine;
    this.tooltipEl.style.display = "block";
    this.tooltipEl.style.left = `${e.clientX + 12}px`;
    this.tooltipEl.style.top = `${e.clientY + 12}px`;
  };

  private onMouseLeave = (): void => {
    this.tooltipEl.style.display = "none";
    if (this.lastHoveredEventIdx !== undefined) {
      this.lastHoveredEventIdx = undefined;
      this.hoverHooks.onCycleLeave?.();
    }
  };

  /** Locate the cell whose x range contains `x`.  Linear scan — count is ≤ 256. */
  private findCellAt(x: number): CellExtent | undefined {
    for (const c of this.cellExtents) {
      if (x >= c.x0 && x <= c.x1) return c;
    }
    return undefined;
  }
}
