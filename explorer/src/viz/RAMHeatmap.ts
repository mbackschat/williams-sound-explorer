/**
 * RAM heatmap viz (Step 6.6).
 *
 * 128 zero-page cells laid out as a 16-column × 8-row grid (one row per
 * high-nibble $00..$70).  Each cell carries:
 *   • value text — the current byte at that address ($00..$FF).
 *   • heat backdrop — red intensity proportional to how recently the cell
 *     was last written.  Heat = max(0, 1 − cyclesSince/DECAY_CYCLES), so a
 *     just-written cell is bright red and a cell that hasn't moved in 1 s
 *     is back to neutral.
 *
 * The view is purely a read-only mirror of the snapshot's ramSnapshot +
 * ramLastWrite arrays — no separate state of its own beyond the canvas.
 *
 * Address layout (left-to-right, top-to-bottom):
 *
 *   00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F
 *   10 11 12 13 14 15 16 17  18 19 1A 1B 1C 1D 1E 1F
 *   …
 *   70 71 72 73 74 75 76 77  78 79 7A 7B 7C 7D 7E 7F
 *
 * Hover tooltip shows `$AA = $VV · last write N cycles ago`.
 */
import type { StateSnapshot } from "../data/protocol.ts";
import type { GameKind } from "../board/soundboard.ts";
import {
  describeCell,
  emptyZeroPageMap,
  type EngineTag,
  type ZeroPageMap,
} from "../web/zeroPageMap.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const GRID_COLOR = "#1f2228";
const COLD_COLOR = "#1f2228";
const HOT_COLOR = "#ff6188";
const COLS = 16;
const ROWS = 8;
const CELLS = COLS * ROWS;
/** Heat fully decays after ~1 second at the 6802's bus clock. */
const DECAY_CYCLES = 894_886; // 1 s @ Williams clock

const HEX = (n: number, w = 2): string =>
  (n & 0xFF).toString(16).toUpperCase().padStart(w, "0");

/** Linear interp two #rrggbb colors at t∈[0,1]. */
function lerpColor(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const r = Math.round(pa[0]! + (pb[0]! - pa[0]!) * t);
  const g = Math.round(pa[1]! + (pb[1]! - pa[1]!) * t);
  const bl = Math.round(pa[2]! + (pb[2]! - pa[2]!) * t);
  return `rgb(${r},${g},${bl})`;
}

export class RAMHeatmap implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastSnapshot: StateSnapshot | undefined;
  private tooltip: HTMLDivElement | undefined;
  /** Cell rectangles in CSS px — used by mousemove for hit testing. */
  private cellRects: { x: number; y: number; w: number; h: number }[] = [];
  /** Zero-page cell descriptors (loaded async; empty until then). */
  private zeroPageMap: ZeroPageMap = emptyZeroPageMap();
  private gameGetter: () => GameKind = () => "defender";

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("RAMHeatmap: 2D context unavailable");
    this.ctx = ctx;
    this.sizeForDpr();
    this.drawIdle();
    attachResizeRedraw(canvas, () => {
      this.sizeForDpr();
      if (this.lastSnapshot) this.update(this.lastSnapshot);
      else this.drawIdle();
    });
    this.installHover();
  }

  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 480;
    const cssH = this.canvas.clientHeight || 220;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawIdle(): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("Init the worklet to see RAM heatmap", 10, 22);
  }

  /** Supply the loaded zero-page descriptors + a getter for the active game. */
  setZeroPageMap(map: ZeroPageMap, gameGetter: () => GameKind): void {
    this.zeroPageMap = map;
    this.gameGetter = gameGetter;
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    this.draw(snapshot);
  }

  /**
   * Active engine for cell-name disambiguation — same priority order as the
   * engine-view dispatch in main.ts (LITE's LFSR included, since it owns
   * overlay cells even though it has no canvas pane).
   */
  private activeEngine(s: StateSnapshot): EngineTag | "" {
    if (s.scream) return "scream";
    if (s.organ) return "organ";
    if (s.gwave) return "gwave";
    if (s.fnoise) return "fnoise";
    if (s.vari) return "vari";
    if (s.lfsr) return "lfsr";
    return "";
  }

  private draw(s: StateSnapshot): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Header: cycle + a one-line legend.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    const hottest = this.hottestCell(s);
    const headerY = 12;
    ctx.fillText(
      hottest >= 0
        ? `RAM · zero-page ($00..$7F) · hot: $${HEX(hottest)}`
        : "RAM · zero-page ($00..$7F) · cold",
      8,
      headerY,
    );

    // Column header row showing the low-nibble (0..F).
    const top = 22;
    const left = 32; // room for the row labels ($00, $10, …)
    const gridW = w - left - 6;
    const gridH = h - top - 6;
    const cellW = gridW / COLS;
    const cellH = gridH / ROWS;
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (let c = 0; c < COLS; c++) {
      ctx.fillText(HEX(c, 1), left + cellW * (c + 0.5), top - 4);
    }
    ctx.textAlign = "left";

    // Row labels + cells.
    this.cellRects = new Array(CELLS);
    const ramS = s.ramSnapshot;
    const lastW = s.ramLastWrite;
    const now = s.cycles;
    for (let r = 0; r < ROWS; r++) {
      const y = top + r * cellH;
      ctx.fillStyle = SUB_COLOR;
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(`$${HEX(r << 4)}`, 2, y + cellH * 0.65);
      for (let c = 0; c < COLS; c++) {
        const addr = (r << 4) | c;
        const x = left + c * cellW;
        const value = ramS[addr] ?? 0;
        const written = lastW[addr] ?? 0;
        const ago = written > 0 ? now - written : Number.POSITIVE_INFINITY;
        const heat = ago === Number.POSITIVE_INFINITY
          ? 0
          : Math.max(0, 1 - ago / DECAY_CYCLES);
        // Cell background — heat blends cold → hot.
        ctx.fillStyle = heat > 0 ? lerpColor(COLD_COLOR, HOT_COLOR, heat) : COLD_COLOR;
        ctx.fillRect(x, y, cellW - 1, cellH - 1);
        // Value text — only render if cell is wide enough.
        if (cellW > 18) {
          ctx.fillStyle = value === 0 ? "#5a5e68" : (heat > 0.4 ? "#1a1a1d" : TEXT_COLOR);
          ctx.font = "10px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(HEX(value), x + cellW / 2, y + cellH * 0.7);
        }
        this.cellRects[addr] = { x, y, w: cellW - 1, h: cellH - 1 };
      }
    }
    ctx.textAlign = "left";

    // Frame.
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, gridW - 1, gridH - 1);
  }

  /** Index of the cell with the highest heat, or -1 if everything is cold. */
  private hottestCell(s: StateSnapshot): number {
    let best = -1;
    let bestAgo = DECAY_CYCLES + 1;
    for (let i = 0; i < CELLS; i++) {
      const w = s.ramLastWrite[i] ?? 0;
      if (w === 0) continue;
      const ago = s.cycles - w;
      if (ago < bestAgo) { bestAgo = ago; best = i; }
    }
    return best;
  }

  // ---- hover tooltip ----------------------------------------------------

  private installHover(): void {
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseleave", () => this.hideTooltip());
  }

  private ensureTooltip(): HTMLDivElement {
    if (!this.tooltip) {
      const el = document.createElement("div");
      el.style.cssText = `
        position: fixed; pointer-events: none; display: none;
        background: #11141a; border: 1px solid #2a2f37; border-radius: 3px;
        color: #d1d4dc; font: 11px ui-monospace, monospace;
        padding: 4px 7px; z-index: 100; white-space: nowrap;
      `;
      document.body.appendChild(el);
      this.tooltip = el;
    }
    return this.tooltip;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.lastSnapshot) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    for (let i = 0; i < this.cellRects.length; i++) {
      const r = this.cellRects[i];
      if (!r) continue;
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        this.showTooltipFor(i, e.clientX, e.clientY);
        return;
      }
    }
    this.hideTooltip();
  }

  private showTooltipFor(addr: number, clientX: number, clientY: number): void {
    const s = this.lastSnapshot!;
    const value = s.ramSnapshot[addr] ?? 0;
    const lastW = s.ramLastWrite[addr] ?? 0;
    const ago = lastW > 0 ? s.cycles - lastW : -1;
    const agoMs = ago >= 0 ? (ago / 894.886).toFixed(1) : null;
    const line1 = ago < 0
      ? `$${HEX(addr)} = $${HEX(value)} · never written this session`
      : `$${HEX(addr)} = $${HEX(value)} · last write ${agoMs} ms ago`;

    // Second line: what the cell *is*, resolved against the active engine so
    // overlaid addresses ($13 = GECHO / LOPER / DECAY / …) name the meaning
    // that's actually running right now.
    const cell = describeCell(
      this.zeroPageMap,
      this.gameGetter(),
      addr,
      this.activeEngine(s),
    );

    const tt = this.ensureTooltip();
    tt.replaceChildren();
    tt.appendChild(document.createTextNode(line1));
    if (cell) {
      const tag = cell.engine ? ` (${cell.engine})` : "";
      const reused = cell.overlapCount > 1 ? ` · reused by ${cell.overlapCount}` : "";
      const desc = cell.desc ? ` — ${cell.desc}` : "";
      const l2 = document.createElement("div");
      l2.style.cssText = "margin-top: 2px; color: #9098a6;";
      l2.textContent = `${cell.name}${tag}${desc}${reused}`;
      tt.appendChild(l2);
    }
    tt.style.display = "block";
    tt.style.left = `${clientX + 12}px`;
    tt.style.top = `${clientY + 12}px`;
  }

  private hideTooltip(): void {
    if (this.tooltip) this.tooltip.style.display = "none";
  }
}
