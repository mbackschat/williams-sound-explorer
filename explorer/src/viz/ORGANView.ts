/**
 * ORGAN engine view (Step 5.2 — Robotron's polyphonic synthesiser).
 *
 * Robotron's ORGAN engine plays melodic tunes (most famously the Beethoven
 * 9th wave-start jingle) by popcounting an 8-bit `OSCIL` mask to choose how
 * many oscillators contribute to the current note, and stepping a 60-byte
 * self-modifying `RDELAY` scratchpad on each tick.
 *
 * This panel surfaces:
 *   • OSCIL bitmask — 8 LEDs, one per oscillator bit; popcount = active voices.
 *   • DUR — 16-bit duration counter for the current note.
 *   • RDELAY heatmap — 60 cells colour-coded by byte value, so the user can
 *     literally see the scratchpad mutate as the tune progresses.
 *
 * RDELAY's caveat lives in §"Known caveats" of explorer_implementation.md:
 * label-map dispatch ignores its self-modifying nature.  The panel itself
 * just reads RAM, so it's correct regardless.
 */
import type { StateSnapshot, OrganState } from "../data/protocol.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const ACCENT = "#ffd866";
const ACTIVE = "#a9dc76";
const GRID_COLOR = "#1f2228";

const HEX = (n: number, w: number): string =>
  n.toString(16).toUpperCase().padStart(w, "0");

export class ORGANView implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ORGANView: 2D context unavailable");
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
    ctx.fillText("ORGAN not currently running — arm Robotron $1B (Beethoven 9th)", 8, 18);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const o = snapshot.organ;
    if (!o) {
      // Keep the last drawn state — the engine slot only populates while
      // PC is inside the ORGAN range, but ORGAN's tune-tick repeatedly
      // exits to IRQ3's `BEQ *` spin between notes.  Without sticky-hold
      // the canvas flickers between drawn state and the idle caption at
      // the snapshot rate.  resetIdle() on the next fire clears the hold
      // so stale state doesn't carry across sounds.
      return;
    }
    this.drawState(o);
  }

  resetIdle(): void {
    this.drawIdle();
  }

  private drawState(o: OrganState): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const margin = 8;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText(
      `ORGAN  ·  voices ${o.oscilCount}  ·  DUR $${HEX(o.dur, 4)}  ·  OSCIL $${HEX(o.oscil, 2)}`,
      margin, 14,
    );

    // OSCIL bitmask — 8 LEDs, bit 7 (MSB) on the left so the user reads it
    // like a binary number.
    const ledY = 22;
    const ledH = 12;
    const ledStride = 18;
    for (let i = 0; i < 8; i++) {
      const bit = 7 - i;
      const on = (o.oscil >> bit) & 1;
      const x = margin + i * ledStride;
      ctx.fillStyle = on ? ACTIVE : "#1a1d24";
      ctx.fillRect(x, ledY, ledStride - 4, ledH);
      ctx.strokeStyle = GRID_COLOR;
      ctx.strokeRect(x + 0.5, ledY + 0.5, ledStride - 5, ledH - 1);
      ctx.fillStyle = on ? "#1a1d24" : SUB_COLOR;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`b${bit}`, x + 1, ledY + ledH - 2);
    }
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`MSB-first  ·  popcount=${o.oscilCount}`, margin + 8 * ledStride + 6, ledY + ledH - 2);

    // RDELAY scratchpad — 60 byte cells in two rows.
    const heatTop = 50;
    const captionY = heatTop - 2;
    ctx.fillText("RDELAY scratchpad (self-modifying):", margin, captionY);
    const n = o.rdelay.length;
    const rows = 2;
    const perRow = Math.ceil(n / rows);
    const heatW = w - 2 * margin;
    const cellW = Math.max(2, Math.floor(heatW / perRow));
    const cellH = Math.max(12, Math.floor((h - heatTop - 18) / rows));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const v = o.rdelay[i]!;
      ctx.fillStyle = byteToHeat(v);
      ctx.fillRect(margin + col * cellW, heatTop + 4 + row * cellH, cellW - 1, cellH - 1);
    }

    // Footer note.
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`60 bytes @ $15..$50 — re-written by ORGANL each tune step`, margin, h - 4);
    void TEXT_COLOR; void ACCENT; // (kept for future styling)
  }
}

/** Map a byte value to a perceptual blue→green→yellow→red colour. */
function byteToHeat(v: number): string {
  const t = v / 255;
  if (t < 0.25) {
    const s = t / 0.25;
    return `rgb(${Math.round(40 + s * 40)}, ${Math.round(80 + s * 100)}, ${Math.round(180 - s * 80)})`;
  }
  if (t < 0.6) {
    const s = (t - 0.25) / 0.35;
    return `rgb(${Math.round(80 + s * 100)}, ${Math.round(180 + s * 40)}, ${Math.round(100 - s * 100)})`;
  }
  const s = Math.min(1, (t - 0.6) / 0.4);
  return `rgb(${Math.round(180 + s * 75)}, ${Math.round(220 - s * 120)}, 60)`;
}
