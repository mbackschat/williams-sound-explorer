/**
 * FNOISE engine view (Phase 6+).
 *
 * The filtered-noise engine drives cannon, thrust, BG1 (background music 1)
 * and similar percussion-y sounds across all three games.  It walks a
 * 16-bit FHI:FLO frequency accumulator up from 0 → FMAX, then back down,
 * with DSFLG enabling random-distortion modulation along the way.  SAMPC
 * counts down per output sample; sound ends at zero.
 *
 * Surfacing:
 *   • A horizontal bar for FHI:FLO filled relative to FMAX, with an arrow
 *     indicating slope direction (↑ during build-up, ↓ during fade-out).
 *   • A second bar for SAMPC (sample countdown).
 *   • Two small LEDs for FDFLG (slope direction) + DSFLG (distortion).
 *
 * Idle state: a caption pointing the user at cannon / thrust / BG1.
 */
import type { StateSnapshot, FNoiseState } from "../data/protocol.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const FREQ_COLOR = "#fc9867";    // FNOISE's engine colour (matches chip dot)
const SAMPC_COLOR = "#78dce8";
const GRID_COLOR = "#1f2228";
const LED_ON_COLOR = "#a9dc76";
const LED_OFF_COLOR = "#3a3a3f";

const HEX = (n: number, w: number): string =>
  n.toString(16).toUpperCase().padStart(w, "0");

export class FNOISEView implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("FNOISEView: 2D context unavailable");
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

  private drawIdle(): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("FNOISE not currently running — fire cannon / thrust / BG1.", 8, 18);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const fn = snapshot.fnoise;
    if (!fn) {
      // Keep last state; see ORGANView for the rationale.
      return;
    }
    this.drawState(fn);
  }

  resetIdle(): void {
    this.drawIdle();
  }

  private drawState(fn: FNoiseState): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const margin = 10;
    const labelW = 56;
    const padTop = 14;

    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = SUB_COLOR;
    const slopeArrow = fn.fdflg !== 0 ? "↓" : "↑";
    ctx.fillText(`FNOISE  ·  slope ${slopeArrow}  ·  distortion ${fn.dsflg !== 0 ? "ON" : "off"}`, margin, padTop);

    // FREQ bar (FHI:FLO vs FMAX peak).  fmax is the 8-bit peak; the
    // accumulator is 16-bit.  Normalise to (fmax << 8) so the bar fills
    // when freq has reached its theoretical maximum.
    const fmaxScaled = Math.max(1, fn.fmax << 8);
    const freqFrac = Math.min(1, fn.freq / fmaxScaled);
    const barTop1 = padTop + 12;
    const barH = 22;
    this.drawBar(
      margin, barTop1, w - margin * 2, barH, labelW,
      "FREQ", FREQ_COLOR, freqFrac,
      `$${HEX(fn.freq, 4)} / $${HEX(fmaxScaled, 4)}`,
    );

    // SAMPC bar — countdown.  No "max" to compare against, so use the
    // initial peak we've seen this run as the rail.  Simplest approach:
    // fill = sampc / 65535 (i.e., relative to the 16-bit ceiling); fine
    // for visual intuition since sampc is always set to some N at fire
    // time and decrements toward zero.
    const sampcFrac = Math.min(1, fn.sampc / 0xFFFF);
    const barTop2 = barTop1 + barH + 6;
    this.drawBar(
      margin, barTop2, w - margin * 2, barH, labelW,
      "SAMPC", SAMPC_COLOR, sampcFrac,
      `$${HEX(fn.sampc, 4)}  (${fn.sampc.toLocaleString()})`,
    );

    // Two LEDs along the bottom: FDFLG + DSFLG.
    const ledY = barTop2 + barH + 12;
    this.drawLed(margin, ledY, "FDFLG", fn.fdflg !== 0, "slope");
    this.drawLed(margin + 110, ledY, "DSFLG", fn.dsflg !== 0, "distortion");

    // Tail text — raw byte values for the engine-aware reader.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(
      `FMAX=$${HEX(fn.fmax, 2)}  FHI=$${HEX(fn.freq >> 8, 2)}  FLO=$${HEX(fn.freq & 0xFF, 2)}  ` +
      `SAMPC=$${HEX(fn.sampc, 4)}  FDFLG=$${HEX(fn.fdflg, 2)}  DSFLG=$${HEX(fn.dsflg, 2)}`,
      margin, h - 6,
    );
  }

  private drawBar(
    x: number, y: number, w: number, h: number, labelW: number,
    label: string, color: string, fraction: number, tail: string,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(label, x, y + h - 6);
    const barX = x + labelW;
    const barW = w - labelW;
    ctx.fillStyle = "#11141a";
    ctx.fillRect(barX, y, barW, h);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX + 0.5, y + 0.5, barW - 1, h - 1);
    const fillW = Math.max(1, fraction * barW);
    ctx.fillStyle = color;
    ctx.fillRect(barX, y, fillW, h);
    // Numeric tail overlaid on the bar right edge with a dark backdrop.
    ctx.font = "10px ui-monospace, monospace";
    const padX = 4;
    const tw = ctx.measureText(tail).width;
    ctx.fillStyle = "rgba(12,14,18,0.78)";
    ctx.fillRect(barX + barW - tw - padX * 2, y + 1, tw + padX * 2, h - 2);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(tail, barX + barW - tw - padX, y + h - 6);
  }

  private drawLed(x: number, y: number, label: string, on: boolean, caption: string): void {
    const { ctx } = this;
    ctx.fillStyle = on ? LED_ON_COLOR : LED_OFF_COLOR;
    ctx.fillRect(x, y, 12, 12);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 11, 11);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(label, x + 18, y + 10);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(caption, x + 56, y + 10);
  }
}
