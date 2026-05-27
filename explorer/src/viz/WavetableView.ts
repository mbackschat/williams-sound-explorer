/**
 * GWAVE wavetable view (Step 4.3).
 *
 * The Williams wavetable engine keeps a 72-byte RAM copy of one of seven
 * waveforms at zero-page `$24..$6B`.  GPLAY reads through it with the X
 * register; WVDECA mutates the bytes in place per echo to produce the
 * characteristic decaying timbre.  This panel draws the live RAM copy as
 * a column of bright bars plus a yellow cursor at the current sample
 * position.
 *
 * The field readouts (GPER / GECHO / GECNT / GWFRM / GWFRQ / FOFSET / GDFINC /
 * PRDECA / GECDEC) are *not* drawn on the canvas — they live in the two HTML
 * `.gwave-readout` rows around it (in index.html) so each field name is a
 * clickable glossary term-link, exactly like VARI's LOPER/HIPER.  This panel
 * just fills the value `<span data-gw="…">`s each frame; the canvas is bars +
 * cursor only.
 *
 * Pedagogical payoff:
 *   • The bar chart *is* the waveform — what HBDV is reproducing right now.
 *   • Watching it shrink across echoes makes WVDECA's role visible.
 *   • The cursor sweeps left-to-right at GPER speed; slowing the worklet
 *     makes the per-sample read obvious.
 *
 * When no GWAVE sound is running the panel shows an idle caption.
 */
import type { StateSnapshot, GWaveState } from "../audio/worklet.ts";
import type { VizPanel } from "./types.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const SUB_COLOR = "#9098a6";
const BAR_COLOR = "#a9dc76";
const MID_RAIL_COLOR = "#2a2f37";
const CURSOR_COLOR = "#ffd866";

const HEX = (n: number, w: number): string =>
  n.toString(16).toUpperCase().padStart(w, "0");

export class WavetableView implements VizPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastSnapshot: StateSnapshot | undefined;
  /** Value `<span data-gw="key">` elements in the surrounding `.gwave-readout` rows. */
  private readonly readout: Record<string, HTMLElement> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("WavetableView: 2D context unavailable");
    this.ctx = ctx;
    // Cache the readout value spans from the enclosing pane (defensive — the
    // canvas still works if the HTML rows are absent).
    const pane = canvas.closest("section");
    if (pane) {
      for (const el of Array.from(pane.querySelectorAll<HTMLElement>("[data-gw]"))) {
        if (el.dataset.gw) this.readout[el.dataset.gw] = el;
      }
    }
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

  private setGw(key: string, text: string): void {
    const el = this.readout[key];
    if (el) el.textContent = text;
  }

  private resetReadout(): void {
    this.setGw("cursor", "—");
    this.setGw("gper", "$00");
    this.setGw("gecho", "○");
    this.setGw("gecnt", "0");
    this.setGw("gwfrm", "$0000");
    this.setGw("gwfrq", "$0000");
    this.setGw("fofset", "+$00");
    this.setGw("gdfinc", "+$00");
    this.setGw("prdeca", "$00");
    this.setGw("gecdec", "$00");
  }

  private drawIdle(message = "GWAVE not currently running — fire $01 (HBDV) etc."): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "12px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(message, 8, 18);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const g = snapshot.gwave;
    if (!g) {
      // Keep last state; see ORGANView for the rationale.
      return;
    }
    this.drawState(g);
  }

  resetIdle(): void {
    this.resetReadout();
    this.drawIdle();
  }

  private drawState(g: GWaveState): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // Update the HTML readout rows (field names there are term-links).
    this.setGw("cursor", g.sampleIndex >= 0 ? String(g.sampleIndex) : "—");
    this.setGw("gper", `$${HEX(g.gper, 2)}`);
    this.setGw("gecho", g.echo ? "●" : "○");
    this.setGw("gecnt", String(g.gecnt));
    this.setGw("gwfrm", `$${HEX(g.gwfrm, 4)}`);
    this.setGw("gwfrq", `$${HEX(g.gwfrq, 4)}`);
    this.setGw("fofset", signed(g.fofset));
    this.setGw("gdfinc", signed(g.gdfinc));
    this.setGw("prdeca", `$${HEX(g.prdeca, 2)}`);
    this.setGw("gecdec", `$${HEX(g.gecdec, 2)}`);

    // Canvas: bars + cursor only.  Small top inset leaves room for the cursor's
    // value bubble; the readout text lives in the HTML rows outside the canvas.
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    const barTop = 18;
    const barBot = h - 6;
    const barH = Math.max(20, barBot - barTop);
    const midY = (barTop + barBot) / 2;

    // Mid-rail reference line.
    ctx.strokeStyle = MID_RAIL_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Bars: one per sample, full canvas width.  Centre at mid-rail; positive
    // values grow up, negative grow down.
    const n = g.waveTable.length;
    const pad = 6;
    const plotLeft = pad;
    const plotRight = w - pad;
    const plotW = Math.max(20, plotRight - plotLeft);
    const barStride = plotW / n;
    const barW = Math.max(1, barStride - 1);

    ctx.fillStyle = BAR_COLOR;
    for (let i = 0; i < n; i++) {
      const v = g.waveTable[i]!;
      // (v - 128) / 128 → [-1, +1].  Multiply by half barH for amplitude.
      const norm = (v - 0x80) / 0x80;
      const amp = norm * (barH / 2);
      const x = plotLeft + i * barStride;
      if (amp >= 0) {
        ctx.fillRect(x, midY - amp, barW, amp);
      } else {
        ctx.fillRect(x, midY, barW, -amp);
      }
    }

    // Cursor — yellow vertical bar at the current sampleIndex, value bubble above.
    if (g.sampleIndex >= 0 && g.sampleIndex < n) {
      const cx = plotLeft + g.sampleIndex * barStride + barW / 2;
      ctx.fillStyle = CURSOR_COLOR;
      ctx.fillRect(cx - 1, barTop, 2, barH);
      const v = g.waveTable[g.sampleIndex]!;
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`$${HEX(v, 2)}`, cx, barTop - 2);
      ctx.textAlign = "left";
    }
  }
}

function signed(v: number): string {
  if (v < 0) return `-$${(-v).toString(16).toUpperCase().padStart(2, "0")}`;
  return `+$${v.toString(16).toUpperCase().padStart(2, "0")}`;
}
