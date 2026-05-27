/**
 * A/B diff view (Step 5.3 / Pattern 6).
 *
 * Picks two `(game, cmd)` pairs and runs each offline via the same
 * `runSound()` the WAV exporter uses, then renders the two byte streams
 * as parallel coloured-cell tapes with a divergence band between them.
 *
 * Pedagogical payoff: comparing Defender HBDV vs Robotron HBDV shows that
 * the two engines emit identical DAC bytes on identical cycles (modulo a
 * tiny boot offset on Robotron) — the wave shape and timbre are LITERALLY
 * shared across games.  Equally instructive when they diverge: Defender's
 * LITE vs Robotron's APPEAR share an algorithm but with different LFREQ
 * seeds, which the diff band exposes byte-by-byte.
 *
 * No DOM events beyond two `<select>`s + a button to run.  Renders into
 * one canvas; the parent section drives layout.
 */
import type { GameKind } from "../board/soundboard.ts";
import { runSoundWithRom, type RunSoundResult } from "../engine/runner.ts";
import { loadRomFromUrl } from "../web/romFetch.ts";
import { attachResizeRedraw } from "./resizeObserver.ts";

const BG_COLOR = "#0c0e12";
const TEXT_COLOR = "#d1d4dc";
const SUB_COLOR = "#9098a6";
const DIFF_COLOR = "#ff6188";
const MATCH_COLOR = "#3a3a3f";

/** Palette identical to EyePanel's so the eye reads "same byte" as "same colour". */
function buildBytePalette(): string[] {
  const out: string[] = new Array(256);
  for (let v = 0; v < 256; v++) {
    const n = (v - 0x80) / 0x80;
    let r: number;
    let g: number;
    let b: number;
    if (n <= 0) {
      const t = Math.max(0, 1 + n);
      r = Math.round(40 * t);
      g = Math.round(80 + 140 * t);
      b = Math.round(200 - 80 * t);
    } else {
      const t = n;
      r = Math.round(40 + 215 * t);
      g = Math.round(220 - 100 * t);
      b = Math.round(120 - 120 * t);
    }
    out[v] = `rgb(${r}, ${g}, ${b})`;
  }
  return out;
}
const PALETTE = buildBytePalette();

export interface ABDiffPick {
  game: GameKind;
  cmd: number;
  label?: string;
}

interface ABDiffOptions {
  /** Container that holds the canvas + summary line. */
  container: HTMLElement;
  /** Canvas the rendered diff is drawn into. */
  canvas: HTMLCanvasElement;
  /** Summary text element (span). */
  summary: HTMLElement;
}

export class ABDiff {
  private readonly opts: ABDiffOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private lastA: RunSoundResult | undefined;
  private lastB: RunSoundResult | undefined;
  private lastPicks: { a: ABDiffPick; b: ABDiffPick } | undefined;
  /** Per-game ROM cache so repeated comparisons don't re-fetch. */
  private readonly romCache = new Map<GameKind, Uint8Array>();

  constructor(opts: ABDiffOptions) {
    this.opts = opts;
    const ctx = opts.canvas.getContext("2d");
    if (!ctx) throw new Error("ABDiff: 2D context unavailable");
    this.ctx = ctx;
    this.sizeForDpr();
    this.drawIdle();
    attachResizeRedraw(opts.canvas, () => {
      this.sizeForDpr();
      if (this.lastA && this.lastB && this.lastPicks) this.render();
      else this.drawIdle();
    });
  }

  private async getRom(game: GameKind): Promise<Uint8Array> {
    const cached = this.romCache.get(game);
    if (cached) return cached;
    const rom = await loadRomFromUrl(game);
    this.romCache.set(game, rom);
    return rom;
  }

  /** Forget a cached ROM (e.g. after the user replaces/removes it). */
  clearRomCache(game?: GameKind): void {
    if (game) this.romCache.delete(game);
    else this.romCache.clear();
  }

  /** Run both sounds and re-render.  Called from a button click. */
  async runAndRender(a: ABDiffPick, b: ABDiffPick): Promise<void> {
    this.opts.summary.textContent = `Running ${describe(a)} vs ${describe(b)}…`;
    // ROMs come from the user-supplied store — a missing one throws; tell the
    // user which game to upload rather than failing silently.
    let romA: Uint8Array;
    let romB: Uint8Array;
    try {
      romA = await this.getRom(a.game);
    } catch {
      this.opts.summary.textContent = `Upload ${a.game}'s sound ROM to compare it.`;
      this.drawIdle();
      return;
    }
    try {
      romB = await this.getRom(b.game);
    } catch {
      this.opts.summary.textContent = `Upload ${b.game}'s sound ROM to compare it.`;
      this.drawIdle();
      return;
    }
    // Both runs are synchronous CPU loops — no real reason to use Promise.all,
    // but keeping the structure parallel-friendly for future async hooks.
    const ra = runSoundWithRom(a.game, romA, a.cmd);
    const rb = runSoundWithRom(b.game, romB, b.cmd);
    this.lastA = ra;
    this.lastB = rb;
    this.lastPicks = { a, b };
    this.render();
  }

  private sizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.opts.canvas.clientWidth || 640;
    const cssH = this.opts.canvas.clientHeight || 200;
    this.opts.canvas.width = Math.round(cssW * dpr);
    this.opts.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawIdle(): void {
    const { ctx } = this;
    const w = this.opts.canvas.clientWidth;
    const h = this.opts.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SUB_COLOR;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText("Pick two (game, cmd) pairs and click Compare.", 8, 18);
  }

  private render(): void {
    if (!this.lastA || !this.lastB || !this.lastPicks) return;
    const { ctx } = this;
    const w = this.opts.canvas.clientWidth;
    const h = this.opts.canvas.clientHeight;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const ea = this.lastA.events;
    const eb = this.lastB.events;
    // Window spans from cycle 0 to the longer of the two runs (so both tapes
    // share a common timeline).  Each cell's width is proportional to dwell
    // time — same convention as EyePanel.
    const endCycle = Math.max(
      ea.length ? ea[ea.length - 1]!.cycle : 0,
      eb.length ? eb[eb.length - 1]!.cycle : 0,
    );
    const span = Math.max(1, endCycle);
    const pxPerCycle = w / span;

    const margin = 14;
    const labelW = 84;
    const bandH = 26;
    const gap = 6;
    const aTop = 24;
    const diffTop = aTop + bandH + gap;
    const diffH = 10;
    const bTop = diffTop + diffH + gap;

    // Captions.
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(`A: ${describe(this.lastPicks.a)}  · ${ea.length} events · ${(this.lastA.cycles / 894_886 * 1000).toFixed(0)} ms`, margin, 14);
    ctx.fillText(`B: ${describe(this.lastPicks.b)}  · ${eb.length} events · ${(this.lastB.cycles / 894_886 * 1000).toFixed(0)} ms`, margin, bTop + bandH + 14);

    // Tape A.
    this.drawTape(ea, margin + labelW, aTop, w - margin - (margin + labelW), bandH, pxPerCycle);
    this.drawTape(eb, margin + labelW, bTop, w - margin - (margin + labelW), bandH, pxPerCycle);
    ctx.fillStyle = SUB_COLOR;
    ctx.fillText("tape A", margin, aTop + bandH - 8);
    ctx.fillText("tape B", margin, bTop + bandH - 8);
    ctx.fillText("diff",   margin, diffTop + diffH - 1);

    // Divergence band — at each pixel, sample the cycle, find the event in
    // each stream covering that cycle (ZOH), and colour the cell red if
    // they differ, dim grey if they match.
    const stats = { sameCells: 0, diffCells: 0, firstDivergenceCycle: -1 };
    const plotLeft = margin + labelW;
    const plotW = w - margin - plotLeft;
    for (let px = 0; px < plotW; px++) {
      const cycle = px / pxPerCycle;
      const va = valueAt(ea, cycle);
      const vb = valueAt(eb, cycle);
      const same = va === vb;
      if (same) stats.sameCells++;
      else {
        stats.diffCells++;
        if (stats.firstDivergenceCycle < 0) stats.firstDivergenceCycle = cycle;
      }
      ctx.fillStyle = same ? MATCH_COLOR : DIFF_COLOR;
      ctx.fillRect(plotLeft + px, diffTop, 1, diffH);
    }

    // Summary line.
    const ratio = stats.diffCells / Math.max(1, stats.sameCells + stats.diffCells);
    const firstDivMs = stats.firstDivergenceCycle >= 0
      ? `, first divergence at ${(stats.firstDivergenceCycle / 894_886 * 1000).toFixed(1)} ms`
      : "";
    this.opts.summary.textContent =
      `${(100 - ratio * 100).toFixed(1)}% identical across the window (${ea.length} vs ${eb.length} events${firstDivMs})`;
  }

  private drawTape(events: { cycle: number; value: number }[], x: number, y: number, w: number, h: number, pxPerCycle: number): void {
    const { ctx } = this;
    ctx.fillStyle = MATCH_COLOR;
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      const cStart = e.cycle;
      const cEnd = i + 1 < events.length ? events[i + 1]!.cycle : e.cycle + 1000;
      const x0 = x + cStart * pxPerCycle;
      const x1 = x + cEnd * pxPerCycle;
      if (x1 < x || x0 > x + w) continue;
      const drawX0 = Math.max(x, x0);
      const drawX1 = Math.min(x + w, x1);
      const cellW = Math.max(1, drawX1 - drawX0);
      ctx.fillStyle = PALETTE[e.value]!;
      ctx.fillRect(drawX0, y, cellW, h);
    }
  }
}

/** ZOH lookup — value at `cycle` from the most recent event with cycle ≤ target. */
function valueAt(events: { cycle: number; value: number }[], cycle: number): number {
  if (events.length === 0) return 0x80;
  if (cycle < events[0]!.cycle) return 0x80;
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (events[mid]!.cycle <= cycle) lo = mid;
    else hi = mid - 1;
  }
  return events[lo]!.value;
}

function describe(p: ABDiffPick): string {
  const cmd = `$${p.cmd.toString(16).toUpperCase().padStart(2, "0")}`;
  const label = p.label ? `·${p.label}` : "";
  return `${p.game} ${cmd}${label}`;
}

