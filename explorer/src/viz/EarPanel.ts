/**
 * Ear panel — oscilloscope of the most recent audio output samples.
 *
 * Reads `snapshot.lastSamples` (default 512 floats ≈ 10.7 ms at 48 kHz) and
 * draws them as a centred line over the canvas width.  The output is the
 * post-LPF DAC stream, so this is exactly what the speaker is reproducing.
 *
 * Visual conventions used by all three Step-3.1 panels:
 *   • Centre line is `y = 0` (silence).
 *   • Top half ⇒ positive DAC values (≥ $80); bottom half ⇒ negative.
 *   • Cursor is implicit: the rightmost sample is "now", so the panel
 *     scrolls every snapshot.
 *
 * Pattern 1 lives here as a 1-line dependency: it just renders whatever
 * the worklet last produced.  When scrubbing, the worklet is filling from
 * the history ring → these are the *scrub-replay* samples → the same panel
 * works for both live and scrub modes, no special branching.
 */
import type { StateSnapshot } from "../data/protocol.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const GRID_COLOR = "#2a2f37";
const AXIS_COLOR = "#3a4252";
const RAW_COLOR = "#3a5868";
const TRACE_COLOR = "#a9dc76";
const BG_COLOR = "#0c0e12";

export class EarPanel implements VizPanel {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("EarPanel: 2D context unavailable");
    this.ctx = ctx;
    this.sizeForDpr();
    this.drawEmpty();
    attachResizeRedraw(canvas, () => {
      this.sizeForDpr();
      if (this.lastSnapshot) this.update(this.lastSnapshot);
      else this.drawEmpty();
    });
  }

  /** Match the canvas drawing buffer to its CSS size × devicePixelRatio. */
  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 320;
    const cssH = this.canvas.clientHeight || 120;
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
    this.drawGrid();
  }

  private drawGrid(): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    // Vertical grid lines at quarters.
    for (let i = 1; i < 4; i++) {
      const x = Math.floor((w * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Centre axis.
    ctx.strokeStyle = AXIS_COLOR;
    const mid = Math.floor(h / 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const samples = snapshot.lastSamples;
    const raw = snapshot.lastRawSamples;
    if (!samples || samples.length === 0) return;
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // Clear + redraw grid.
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    this.drawGrid();

    const xStep = w / (samples.length - 1);
    const yScale = h / 2 - 2;
    const yCentre = h / 2;

    // Raw DAC trace (drawn first, dimmer, behind).  Shows the stair-step
    // input to the LPF — sharp transitions are visibly attenuated by the
    // smoothed green trace overlaid on top.
    if (raw && raw.length === samples.length) {
      ctx.strokeStyle = RAW_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < raw.length; i++) {
        const x = i * xStep;
        const y = yCentre - raw[i]! * yScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Post-LPF trace.  Map sample value ∈ [-1, +1] to canvas y, centre = h/2.
    ctx.strokeStyle = TRACE_COLOR;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = i * xStep;
      const y = yCentre - samples[i]! * yScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Tiny legend in the top-right.
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = TRACE_COLOR;
    ctx.fillText("post-LPF", w - 54, 4);
    ctx.fillStyle = RAW_COLOR;
    ctx.fillText("raw DAC", w - 54, 16);
  }
}
