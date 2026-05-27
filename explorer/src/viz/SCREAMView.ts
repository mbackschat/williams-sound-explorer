/**
 * SCREAM engine view (Step 5.1 — Robotron-only).
 *
 * Renders the 4 detuned voices as a column of paired bars per voice:
 *   • FREQ bar  — voice's pitch/period byte.  Wider = lower pitch.
 *   • TIMER bar — voice's current decay timer.  Shrinks toward 0.
 *
 * Plus a small dot-trail "phase wheel" per voice (visualised as a moving
 * tick along an arc) — the most pedagogically obvious way to see the
 * voices drifting out of sync as their TIMER values decay at different
 * rates.  The composite waveform at the DAC is the sum of these four
 * voices, so a glance at the bars + arcs makes "where the scream comes
 * from" immediate.
 *
 * When `snapshot.scream` is undefined the panel shows an idle caption.
 */
import type { StateSnapshot, ScreamState } from "../data/protocol.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const GRID_COLOR = "#1f2228";
const VOICE_COLORS = ["#78dce8", "#a9dc76", "#ffd866", "#ff6188"];

const HEX = (n: number): string =>
  (n & 0xFF).toString(16).toUpperCase().padStart(2, "0");

export class SCREAMView implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("SCREAMView: 2D context unavailable");
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
    ctx.fillText("SCREAM not currently running — fire Robotron $1A", 8, 18);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const s = snapshot.scream;
    if (!s) {
      // Keep last state; see ORGANView for the rationale.
      return;
    }
    this.drawState(s);
  }

  resetIdle(): void {
    this.drawIdle();
  }

  private drawState(s: ScreamState): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const margin = 8;
    const captionY = 12;
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`SCREAM · ${s.voices.length} voices`, margin, captionY);

    // Layout: each voice gets a horizontal "row" with a phase wheel on the
    // left + two bars (FREQ and TIMER) to the right.
    const top = 20;
    const rowGap = 4;
    const rowH = Math.max(20, Math.floor((h - top - 6) / s.voices.length) - rowGap);
    const wheelW = 36;
    const labelW = 22;
    const barLeft = margin + wheelW + labelW + 6;
    // 2×2 grid (Phase 5+ layout) makes panels half-width; right-edge hex
    // values now overlay the bars themselves with a dark backdrop.
    const barRight = w - margin;
    const barW = Math.max(20, barRight - barLeft);

    for (let i = 0; i < s.voices.length; i++) {
      const v = s.voices[i]!;
      const color = VOICE_COLORS[i % VOICE_COLORS.length]!;
      const rowY = top + i * (rowH + rowGap);
      const midY = rowY + rowH / 2;

      // Phase wheel — a circular outline + a tick at the angle implied by
      // TIMER / FREQ (where the voice is in its cycle).  TIMER == 0 → 0°,
      // TIMER == FREQ → 360°.
      const cx = margin + wheelW / 2;
      const r = Math.min(wheelW, rowH) / 2 - 2;
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, midY, r, 0, Math.PI * 2);
      ctx.stroke();
      const phase = v.freq > 0 ? (v.timer / v.freq) : 0;
      const angle = -Math.PI / 2 + Math.min(1, phase) * Math.PI * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, midY);
      ctx.lineTo(cx + Math.cos(angle) * r, midY + Math.sin(angle) * r);
      ctx.stroke();

      // Voice label.
      ctx.fillStyle = color;
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`v${i}`, margin + wheelW + 2, midY + 4);

      // FREQ bar — wider = higher freq cell value.  Half-height (top half).
      const halfH = (rowH - 4) / 2;
      const freqW = Math.round((v.freq / 0xFF) * barW);
      ctx.fillStyle = color;
      ctx.fillRect(barLeft, rowY + 2, freqW, halfH);
      // TIMER bar — half-height bottom; bright while >0, dim when at 0.
      const timerW = Math.round((v.timer / 0xFF) * barW);
      ctx.fillStyle = v.timer === 0 ? "#3a3a3f" : color;
      ctx.fillRect(barLeft, rowY + 2 + halfH, timerW, halfH);

      // Bar frame.
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(barLeft + 0.5, rowY + 2.5, barW - 1, rowH - 5);
      // Mid divider between FREQ + TIMER halves.
      ctx.beginPath();
      ctx.moveTo(barLeft, rowY + 2 + halfH);
      ctx.lineTo(barLeft + barW, rowY + 2 + halfH);
      ctx.stroke();

      // Values overlaid on the bar right edge with a dark backdrop so they
      // remain legible regardless of bar colour / fill width.
      ctx.font = "10px ui-monospace, monospace";
      const freqText = `$${HEX(v.freq)}`;
      const timerText = `$${HEX(v.timer)}`;
      const padX = 3;
      const freqTextW = ctx.measureText(freqText).width;
      const timerTextW = ctx.measureText(timerText).width;
      ctx.fillStyle = "rgba(12,14,18,0.78)";
      ctx.fillRect(barLeft + barW - freqTextW - padX * 2, rowY + 2, freqTextW + padX * 2, halfH);
      ctx.fillRect(barLeft + barW - timerTextW - padX * 2, rowY + 2 + halfH, timerTextW + padX * 2, halfH);
      ctx.fillStyle = TEXT_COLOR;
      ctx.fillText(freqText, barLeft + barW - freqTextW - padX, rowY + 2 + halfH - 2);
      ctx.fillText(timerText, barLeft + barW - timerTextW - padX, rowY + rowH - 4);
    }
  }
}
