/**
 * Stage swimlane — "which routine is running" (Step 3.4).
 *
 * Each DAC event in `snapshot.recentDacEvents` carries the CPU's PC at the
 * moment of the write.  Resolving PC → label via the label-map JSON groups
 * events by routine; rendered as horizontal lanes across the same
 * `windowStart` / `windowEnd` timeline the byte tape uses.
 *
 * Lane assignment is deterministic by first-appearance order (top = first
 * label seen in the window) — that keeps the lane index of a routine stable
 * across the lifetime of a single window while still leaving room for new
 * routines lower on the canvas.
 *
 * No new worklet protocol — the panel reads everything from the existing
 * snapshot fields.  PC during silent stretches isn't sampled here (Step 3.4
 * design Option (b)): the swimlane shows lanes only when sound is being
 * produced, which is exactly when the pedagogical question "which routine
 * is currently running?" is interesting.
 */
import type { StateSnapshot } from "../audio/worklet.ts";
import type { VizPanel } from "./types.ts";
import type { LabelMap } from "../audio/labelMap.ts";
import type { GameKind } from "../board/soundboard.ts";
import { resolve, formatLabel } from "../audio/labelMap.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const HEAD_COLOR = "#ffd866";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const GRID_COLOR = "#1a1d24";

/**
 * Stable colour ramp keyed by lane index — golden-angle stepping keeps
 * adjacent lanes well-separated.  Saturation kept moderate so the eye
 * is drawn to value transitions, not the colour.
 */
function laneColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 65%, 55%)`;
}

interface LaneSegment {
  startCycle: number;
  endCycle: number;
  label: string;
  src_line: number | null;
  addr: number;
}

interface Lane {
  label: string;
  segments: LaneSegment[];
  color: string;
}

interface CellExtent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  seg: LaneSegment;
}

export class StageSwimlane implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tooltipEl: HTMLDivElement;
  private getGame: () => GameKind;
  private labelMap: LabelMap;
  private cellExtents: CellExtent[] = [];
  private sourceName = "";
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement, labelMap: LabelMap, getGame: () => GameKind) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("StageSwimlane: 2D context unavailable");
    this.ctx = ctx;
    this.labelMap = labelMap;
    this.getGame = getGame;
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "swimlane-tooltip";
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

  /** Swap the label map after async load (called by main.ts). */
  setLabelMap(map: LabelMap): void {
    this.labelMap = map;
    this.sourceName = map.sources[this.getGame()] ?? "";
  }

  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 320;
    const cssH = this.canvas.clientHeight || 140;
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
    ctx.fillText("Stage swimlane — fire a sound", 8, 16);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const game = this.getGame();
    this.sourceName = this.labelMap.sources[game] ?? "";
    const ev = snapshot.recentDacEvents;
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Same window-bounds derivation as EyePanel — keeps the two panels
    // visually aligned even when bumping into stale-worklet fallbacks.
    const FALLBACK_WINDOW = 224_000;
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

    // Resolve every event to a label, then collapse consecutive same-label
    // events into one segment per lane.  Lane assignment is by first
    // appearance order in the window.
    const lanes: Lane[] = [];
    const laneIndex = new Map<string, number>();
    this.cellExtents = [];

    let curLabel: string | null = null;
    let curStart = 0;
    let curAddr = 0;
    let curSrcLine: number | null = null;
    let unresolvedCount = 0;

    const flush = (endCycle: number): void => {
      if (curLabel == null) return;
      let idx = laneIndex.get(curLabel);
      if (idx === undefined) {
        idx = lanes.length;
        laneIndex.set(curLabel, idx);
        lanes.push({ label: curLabel, segments: [], color: laneColor(idx) });
      }
      lanes[idx]!.segments.push({
        startCycle: curStart,
        endCycle,
        label: curLabel,
        src_line: curSrcLine,
        addr: curAddr,
      });
    };

    for (let i = 0; i < ev.count; i++) {
      const cycle = ev.cycles[i]!;
      const pc = ev.pcs[i]!;
      const resolved = resolve(this.labelMap, game, pc);
      if (!resolved) {
        unresolvedCount++;
        // Still close out the current segment so unresolved gaps don't bleed
        // a label across them.
        if (curLabel != null) {
          flush(cycle);
          curLabel = null;
        }
        continue;
      }
      if (resolved.label !== curLabel) {
        if (curLabel != null) flush(cycle);
        curLabel = resolved.label;
        curStart = cycle;
        curAddr = resolved.addr;
        curSrcLine = resolved.src_line;
      }
    }
    // Final flush — extend through window end.
    if (curLabel != null) {
      flush(windowEnd);
    }

    // Header.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    const spanMs = (span / 894_886) * 1000;
    const headerY = 12;
    const headerLeft = `${lanes.length} routines · ${ev.count} events · ${spanMs.toFixed(0)} ms`;
    ctx.fillText(headerLeft, 8, headerY);
    if (unresolvedCount > 0) {
      ctx.fillStyle = "#c47b7b";
      ctx.fillText(`${unresolvedCount} unmapped`, w - 110, headerY);
    }

    if (lanes.length === 0) {
      ctx.fillStyle = SUB_COLOR;
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("(no events in window)", 8, 32);
      // Draw head indicator so the empty-state still hints at timeline.
      this.drawHead(snapshot, windowStart, windowEnd, pxPerCycle, 18, h - 8);
      return;
    }

    // Lane layout — fixed lane height with a ceiling so giant windows stay
    // legible.  Reserve 80 px for the label gutter on the left.
    const gutterW = 88;
    const top = 20;
    const bottom = h - 6;
    const usable = Math.max(20, bottom - top);
    const laneH = Math.min(22, Math.max(10, Math.floor(usable / lanes.length)));
    const plotW = w - gutterW - 4;

    // Lane separators + gutter labels.
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, monospace";
    for (let i = 0; i < lanes.length; i++) {
      const y = top + i * laneH;
      ctx.strokeStyle = GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(gutterW, y + laneH);
      ctx.lineTo(w, y + laneH);
      ctx.stroke();
      ctx.fillStyle = lanes[i]!.color;
      ctx.fillText(lanes[i]!.label, 6, y + laneH - 4);
    }

    // Draw segments.
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]!;
      const y = top + i * laneH + 2;
      const segH = Math.max(4, laneH - 4);
      ctx.fillStyle = lane.color;
      for (const seg of lane.segments) {
        const x0raw = (seg.startCycle - windowStart) * pxPerCycle;
        const x1raw = (seg.endCycle - windowStart) * pxPerCycle;
        const x0 = Math.max(0, x0raw);
        const x1 = Math.min(plotW, x1raw);
        if (x1 <= 0 || x0 >= plotW) continue;
        const drawX = gutterW + x0;
        const drawW = Math.max(1, x1 - x0);
        ctx.fillRect(drawX, y, drawW, segH);
        this.cellExtents.push({
          x0: drawX,
          x1: drawX + drawW,
          y0: y,
          y1: y + segH,
          seg,
        });
      }
    }

    this.drawHead(snapshot, windowStart, windowEnd, pxPerCycle, top, top + lanes.length * laneH, gutterW);
  }

  private drawHead(
    snapshot: StateSnapshot,
    windowStart: number,
    windowEnd: number,
    pxPerCycle: number,
    yTop: number,
    yBot: number,
    gutterW = 0,
  ): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth - gutterW - 4;
    const headCycle = snapshot.scrubbing ? snapshot.scrubCycle : windowEnd;
    const xRaw = (headCycle - windowStart) * pxPerCycle;
    const x = gutterW + Math.max(0, Math.min(w, xRaw));
    ctx.fillStyle = HEAD_COLOR;
    ctx.fillRect(x - 1, yTop, 2, Math.max(2, yBot - yTop));
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.cellExtents.length === 0) {
      this.tooltipEl.style.display = "none";
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let hit: CellExtent | undefined;
    for (const c of this.cellExtents) {
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) {
        hit = c;
        break;
      }
    }
    if (!hit) {
      this.tooltipEl.style.display = "none";
      return;
    }
    const seg = hit.seg;
    const durMs = ((seg.endCycle - seg.startCycle) / 894_886) * 1000;
    const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, "0");
    const tag = formatLabel({ ...seg, offset: 0 });
    const srcLine = seg.src_line != null && this.sourceName
      ? `<br><span style="color:${SUB_COLOR}">${this.sourceName}:</span>${seg.src_line}`
      : "";
    this.tooltipEl.innerHTML =
      `<strong>${tag}</strong>  <span style="color:${SUB_COLOR}">@$${hex(seg.addr)}</span>` +
      `<br><span style="color:${SUB_COLOR}">cycles </span>${seg.startCycle.toLocaleString()} – ${seg.endCycle.toLocaleString()}` +
      `<br><span style="color:${SUB_COLOR}">dwell </span>${durMs.toFixed(1)} ms` +
      srcLine;
    this.tooltipEl.style.display = "block";
    this.tooltipEl.style.left = `${e.clientX + 12}px`;
    this.tooltipEl.style.top = `${e.clientY + 12}px`;
  };

  private onMouseLeave = (): void => {
    this.tooltipEl.style.display = "none";
  };
}
