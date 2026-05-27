/**
 * VARI engine view (Step 4.2 — Pattern: per-engine introspection).
 *
 * Two horizontal countdown bars (LOCNT and HICNT, each filled relative to
 * its initial period LOPER / HIPER) sit above a duty-cycle preview that
 * draws one period of the resulting asymmetric square wave at the current
 * LOPER:HIPER ratio.  Below the preview, a tiny readout shows the live
 * sweep parameters LODT / HIDT / LOMOD / HIEN.
 *
 * Pedagogically this surfaces the two things SAW makes audible:
 *   1. The *asymmetry* — LOPER vs HIPER decides the duty cycle, not
 *      "pitch".
 *   2. The *sweep* — each cycle iteration applies LODT/HIDT/LOMOD, so the
 *      bars and preview animate even when the period stays constant
 *      (you can watch the timbre slide).
 *
 * The panel is fed by `snapshot.vari`; when undefined it shows an idle
 * caption so the layout doesn't jump as sounds start / stop.
 */
import type { StateSnapshot, VariState } from "../audio/worklet.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const LOPER_COLOR = "#78dce8";
const HIPER_COLOR = "#a9dc76";
const HEAD_COLOR = "#ffd866";
const PREVIEW_COLOR = "#ffd866";
const GRID_COLOR = "#1f2228";

const HEX2 = (n: number): string =>
  (n & 0xFF).toString(16).toUpperCase().padStart(2, "0");

export class VARIView implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Cached last snapshot so resize can repaint with live state. */
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("VARIView: 2D context unavailable");
    this.ctx = ctx;
    this.sizeForDpr();
    this.drawIdle();
    attachResizeRedraw(canvas, () => {
      this.sizeForDpr();
      if (this.lastSnapshot) this.update(this.lastSnapshot);
      else this.drawIdle();
    });
  }

  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 320;
    const cssH = this.canvas.clientHeight || 160;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawIdle(message = "VARI not currently running — fire $1D / $1E / $1F"): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(message, 8, 18);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const v = snapshot.vari;
    if (!v) {
      // Keep last state; see ORGANView for the rationale.
      return;
    }
    this.drawState(v);
  }

  resetIdle(): void {
    this.drawIdle();
  }

  private drawState(v: VariState): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const margin = 10;
    const labelW = 60;
    const barLeft = margin + labelW;
    // 2×2 grid (Phase 5+ layout) makes panels half-width; the count/period
    // numeric tail used to live to the right of the bars but now overlays
    // the right end of the bar itself to keep the bar wide enough to read.
    const barRight = w - margin;
    const barW = Math.max(20, barRight - barLeft);

    // LOCNT / LOPER countdown bar.
    const barY1 = 22;
    const barY2 = 50;
    const barH = 14;

    this.drawCountdownBar(
      barLeft, barY1, barW, barH,
      v.locnt, v.loper, "LO", LOPER_COLOR, margin, labelW,
    );
    this.drawCountdownBar(
      barLeft, barY2, barW, barH,
      v.hicnt, v.hiper, "HI", HIPER_COLOR, margin, labelW,
    );

    // Duty-cycle preview: one period of the square wave with LOPER:HIPER
    // ratio mapped to the canvas width.
    const previewTop = 72;
    const previewBot = h - 38;
    const previewH = Math.max(20, previewBot - previewTop);
    this.drawDutyCyclePreview(margin, previewTop, w - 2 * margin, previewH, v);

    // Sweep parameters readout (LODT/HIDT/LOMOD/HIEN).
    const sweepY = h - 18;
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    const sweepLine =
      `LODT=${signedHex(v.lodt)}  HIDT=${signedHex(v.hidt)}  ` +
      `LOMOD=${signedHex(v.lomod)}  HIEN=$${HEX2(v.hien)}`;
    ctx.fillText(sweepLine, margin, sweepY);
  }

  private drawCountdownBar(
    x: number, y: number, w: number, h: number,
    count: number, period: number,
    label: string, color: string,
    margin: number, labelW: number,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`${label}`, margin, y + h - 3);
    ctx.fillStyle = "#11141a";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // Fill proportion: (period - count) / period — i.e. how far through
    // this half we are.  Guard for period == 0 (silent / loader pre-fill).
    if (period > 0) {
      const elapsed = Math.max(0, Math.min(period, period - count));
      const fillW = (elapsed / period) * w;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, fillW, h);
      // Initial-period tick (the right edge already represents it; draw a
      // little marker just to anchor the eye).
      ctx.fillStyle = HEAD_COLOR;
      ctx.fillRect(x + w - 1, y, 1, h);
    }
    // Numeric tail — overlaid on the bar's right edge with a dark backdrop
    // so it reads against any fill colour.  Keeping the value visible without
    // claiming horizontal space matters more in the 2×2 grid layout.
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    const text = `${count}/${period}`;
    const textW = ctx.measureText(text).width;
    const padX = 4;
    ctx.fillStyle = "rgba(12,14,18,0.75)";
    ctx.fillRect(x + w - textW - padX * 2, y + 1, textW + padX * 2, h - 2);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(text, x + w - textW - padX, y + h - 3);
  }

  private drawDutyCyclePreview(
    x: number, y: number, w: number, h: number, v: VariState,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = "#11141a";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const total = v.loper + v.hiper;
    if (total <= 0) {
      ctx.fillStyle = SUB_COLOR;
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("duty preview unavailable (period=0)", x + 6, y + h - 6);
      return;
    }
    const loW = (v.loper / total) * (w - 4);
    const hiW = (v.hiper / total) * (w - 4);
    const padX = x + 2;
    const top = y + 4;
    const bot = y + h - 4;
    const mid = (top + bot) / 2;

    // Low half (DAC low rail).
    ctx.strokeStyle = PREVIEW_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, bot);
    ctx.lineTo(padX + loW, bot);
    ctx.lineTo(padX + loW, top);
    ctx.lineTo(padX + loW + hiW, top);
    ctx.lineTo(padX + loW + hiW, mid);
    ctx.stroke();

    // Caption.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    const duty = ((v.hiper / total) * 100).toFixed(0);
    ctx.fillText(`duty ${duty}%  ·  period ${total} (LO=${v.loper}, HI=${v.hiper})`, x + 6, y + h - 5);
  }
}

function signedHex(v: number): string {
  if (v < 0) return `-$${HEX2(-v)}`;
  return `+$${HEX2(v)}`;
}
