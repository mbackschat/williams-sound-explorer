/**
 * Scrolling 2D FFT spectrogram.
 *
 * Reads byte-frequency data from the host's `AnalyserNode` at requestAnimation-
 * Frame rate (vsync ≈ 60 Hz, decoupled from the 10 Hz snapshot poll) and
 * paints it as a vertical column at the right edge of the canvas; the rest
 * of the image scrolls one pixel left per frame.  Log-frequency y-axis
 * (so bass takes more vertical real estate than the squeak band).  Colour
 * ramp is a perceptual dark→cyan→yellow→red mapping for byte magnitude.
 *
 * Lifecycle:
 *   • `mount(canvas, getAnalyser)` — starts the rAF loop.
 *   • Internally calls `getAnalyser()` each frame so an analyser created
 *     after the spectrogram is fine (it just shows silence until then).
 *   • No `update(snapshot)`: the spectrogram is fed by the audio thread
 *     via `AnalyserNode`, not the worklet snapshot stream — so it works
 *     during live playback, scrub, and even pause-with-DC-held (the
 *     AnalyserNode sees whatever the speaker is being told).
 */

import { attachResizeRedraw } from "./resizeObserver.ts";

type AnalyserGetter = () => AnalyserNode | undefined;
type CycleGetter = () => number;

/** Pattern 8 hover callbacks — emit historical cycle / clear cursor. */
export interface HoverHooks {
  onCycleHover?: (cycle: number) => void;
  onCycleLeave?: () => void;
}

/** 256-entry magma-ish lookup table built once. */
function buildPalette(): Uint8ClampedArray {
  const p = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // Piecewise: 0..0.25 dark→blue, 0.25..0.6 blue→cyan, 0.6..0.85 → yellow,
    // 0.85..1 → red.  Mix in linear sRGB-ish.
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.25) {
      const s = t / 0.25;
      r = 0; g = 0; b = Math.round(s * 80);
    } else if (t < 0.6) {
      const s = (t - 0.25) / 0.35;
      r = 0; g = Math.round(s * 180); b = Math.round(80 + s * 100);
    } else if (t < 0.85) {
      const s = (t - 0.6) / 0.25;
      r = Math.round(s * 255); g = Math.round(180 + s * 60); b = Math.round(180 - s * 180);
    } else {
      const s = (t - 0.85) / 0.15;
      r = 255; g = Math.round(240 - s * 200); b = 0;
    }
    p[i * 4 + 0] = r;
    p[i * 4 + 1] = g;
    p[i * 4 + 2] = b;
    p[i * 4 + 3] = 255;
  }
  return p;
}

const PALETTE = buildPalette();

export class Spectrogram {
  private ctx: CanvasRenderingContext2D | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private getAnalyser: AnalyserGetter | undefined;
  private getCycle: CycleGetter | undefined;
  private rafHandle: number | undefined;
  private freqData: Uint8Array<ArrayBuffer> | undefined;
  private colImage: ImageData | undefined;
  private height = 0;
  /** y-pixel index → frequency-bin index (precomputed log mapping). */
  private binForRow: Uint16Array | undefined;
  /**
   * Per-column cycle history (Pattern 8 — Step 4.5).  Indexed by
   * "columns from the right edge" (0 = newest, 1 = one frame older, …).
   * Filled on each rAF: we record the current CPU cycle for the column
   * about to be painted, then later mouseX translates to a column offset
   * which indexes back into this ring.  Decouples mouse-X → historical
   * cycle from any assumption about wall-clock vs vsync rate (which would
   * otherwise be wrong during pause / scrub).
   */
  private cycleRing: Float64Array | undefined;
  /** Insertion point in `cycleRing` (next column written goes here). */
  private cycleRingWritePos = 0;
  private hooks: HoverHooks = {};

  mount(
    canvas: HTMLCanvasElement,
    getAnalyser: AnalyserGetter,
    opts: { getCycle?: CycleGetter; hooks?: HoverHooks } = {},
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Spectrogram: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.getAnalyser = getAnalyser;
    this.getCycle = opts.getCycle;
    this.hooks = opts.hooks ?? {};
    this.sizeForDpr();
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (this.hooks.onCycleHover || this.hooks.onCycleLeave) {
      canvas.addEventListener("mousemove", this.onMouseMove);
      canvas.addEventListener("mouseleave", this.onMouseLeave);
    }
    // Resize → re-size + clear (the scroll buffer can't be preserved since
    // sizeForDpr() resets the imageData ring).  Brief blank moment is OK —
    // new columns repaint at ~60 Hz.
    attachResizeRedraw(canvas, () => {
      this.sizeForDpr();
      ctx.fillStyle = "#0c0e12";
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    });
    this.loop();
  }

  stop(): void {
    if (this.rafHandle !== undefined) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = undefined;
    }
  }

  private sizeForDpr(): void {
    if (!this.canvas || !this.ctx) return;
    // Use 1× scaling here intentionally — devicePixelRatio scaling makes
    // the scrolling drawImage(canvas, -1, 0) trick stretch fractionally,
    // smearing the column.  1:1 pixels keep each frame's column crisp.
    const cssW = this.canvas.clientWidth || 480;
    const cssH = this.canvas.clientHeight || 160;
    this.canvas.width = cssW;
    this.canvas.height = cssH;
    this.height = cssH;
    this.colImage = this.ctx.createImageData(1, cssH);
    // Cycle history sized to match canvas width — one entry per column.
    if (!this.cycleRing || this.cycleRing.length !== cssW) {
      this.cycleRing = new Float64Array(cssW);
      this.cycleRingWritePos = 0;
    }
    // Precompute log-frequency mapping in standard spectrogram orientation:
    // HIGH frequency at the TOP of the canvas, LOW at the BOTTOM.  Skip bin 0
    // (pure DC) since the DC-blocker upstream should kill it; bin 1 is the
    // first audible frequency (~94 Hz at 48 kHz / 512 FFT).  Each row's bin
    // is chosen on a log2 scale so every octave gets equal vertical pixels.
    const bins = (this.getAnalyser?.()?.frequencyBinCount) ?? 256;
    this.binForRow = new Uint16Array(cssH);
    const minBin = 1;
    const maxBin = bins - 1;
    for (let row = 0; row < cssH; row++) {
      // row 0 = top of canvas = highest frequency.
      const norm = 1 - row / Math.max(1, cssH - 1); // 1.0 at top, 0.0 at bottom
      const bin = Math.min(maxBin, Math.max(minBin,
        Math.round(minBin * Math.pow(maxBin / minBin, norm))));
      this.binForRow[row] = bin;
    }
  }

  private loop = (): void => {
    this.rafHandle = requestAnimationFrame(this.loop);
    if (!this.ctx || !this.canvas) return;
    const analyser = this.getAnalyser?.();
    if (!analyser) return;
    const bins = analyser.frequencyBinCount;
    if (!this.freqData || this.freqData.length !== bins) {
      // Explicit ArrayBuffer-backed view — getByteFrequencyData rejects the
      // ArrayBufferLike default that comes from `new Uint8Array(N)` in
      // recent lib.dom.d.ts versions.
      this.freqData = new Uint8Array(new ArrayBuffer(bins));
      // Rebuild row→bin map if bin count changed.
      this.sizeForDpr();
    }
    analyser.getByteFrequencyData(this.freqData);

    const w = this.canvas.width;
    const h = this.canvas.height;
    // Scroll the existing image one pixel to the left.
    this.ctx.drawImage(this.canvas, -1, 0);

    // Paint the new rightmost column.
    if (!this.colImage || !this.binForRow) return;
    const colData = this.colImage.data;
    for (let row = 0; row < h; row++) {
      const bin = this.binForRow[row]!;
      const v = this.freqData[bin]!;
      const o = v * 4;
      colData[row * 4 + 0] = PALETTE[o + 0]!;
      colData[row * 4 + 1] = PALETTE[o + 1]!;
      colData[row * 4 + 2] = PALETTE[o + 2]!;
      colData[row * 4 + 3] = 255;
    }
    this.ctx.putImageData(this.colImage, w - 1, 0);
    // Record the CPU cycle that produced this column.  Position advances
    // with the canvas's "scroll left + write right" so the newest column's
    // cycle is always at (writePos - 1) mod W.
    if (this.cycleRing) {
      const cycleNow = this.getCycle?.() ?? 0;
      this.cycleRing[this.cycleRingWritePos] = cycleNow;
      this.cycleRingWritePos = (this.cycleRingWritePos + 1) % w;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.canvas || !this.cycleRing || !this.hooks.onCycleHover) return;
    const rect = this.canvas.getBoundingClientRect();
    // Translate CSS pixels → canvas pixels (1:1 here per sizeForDpr).
    const x = Math.round(((e.clientX - rect.left) / rect.width) * this.canvas.width);
    if (x < 0 || x >= this.canvas.width) return;
    const w = this.cycleRing.length;
    // Most recent column written is at writePos - 1; map screen-x (0 left,
    // W-1 right = newest) → ring index.  `columnsFromRight = (W-1) - x`.
    const columnsFromRight = (w - 1) - x;
    const newestIdx = (this.cycleRingWritePos - 1 + w) % w;
    const idx = (newestIdx - columnsFromRight + w) % w;
    const cycle = this.cycleRing[idx]!;
    if (!Number.isFinite(cycle) || cycle === 0) return;
    this.hooks.onCycleHover(cycle);
  };

  private onMouseLeave = (): void => {
    this.hooks.onCycleLeave?.();
  };
}
