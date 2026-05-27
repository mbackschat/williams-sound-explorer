/**
 * Code panel — current 6800 instruction + register dump.
 *
 * This is the textual sibling of Ear / Eye.  We render into a `<pre>`
 * rather than a canvas because monospace text aligned in columns is
 * exactly what we want for a register dump + disassembly line.  The
 * "shared cursor" hint here is the cycle count — it advances live, freezes
 * on pause, and reflects the *live* CPU cycle even while scrubbing (the
 * scrub cycle goes in the Eye panel; the CPU cycle stays here so the user
 * can see that the CPU is genuinely frozen during scrub).
 */
import type { StateSnapshot } from "../audio/worklet.ts";
import type { VizPanel } from "./types.ts";
import { formatDisassembly } from "../cpu/disasm.ts";
import type { LabelMap } from "../audio/labelMap.ts";
import type { GameKind } from "../board/soundboard.ts";
import { resolve as resolveLabel, formatLabel } from "../audio/labelMap.ts";

/** Pattern 8 — what the user is currently hovering across panels. */
export interface InspectCursor {
  /** CPU cycle at the hover point. */
  cycle: number;
  /** PC at-or-before that cycle from the DAC history's pc ring; undefined when the inspect target is silent / before any sound. */
  pc: number | undefined;
  /** Where the cursor originated, for the readout (e.g. "spectrogram", "byte tape"). */
  source: string;
}

const HEX = (n: number, w: number): string =>
  n.toString(16).toUpperCase().padStart(w, "0");

export class CodePanel implements VizPanel {
  private inspect: InspectCursor | null = null;
  private labelMap: LabelMap | undefined;
  private getGame: (() => GameKind) | undefined;
  private lastSnapshot: StateSnapshot | undefined;

  constructor(private readonly el: HTMLPreElement) {}

  setLabelMap(map: LabelMap, getGame: () => GameKind): void {
    this.labelMap = map;
    this.getGame = getGame;
  }

  /**
   * Set or clear the inspect cursor (Step 4.5 / Pattern 8).  Pass null to
   * clear.  We immediately re-render with the cached last snapshot so the
   * highlight appears the instant the user hovers — no need to wait for
   * the next snapshot tick.
   */
  setInspectCursor(cursor: InspectCursor | null): void {
    this.inspect = cursor;
    if (this.lastSnapshot) this.update(this.lastSnapshot);
  }

  update(snapshot: StateSnapshot): void {
    this.lastSnapshot = snapshot;
    const s = snapshot;
    const ccr = s.ccr;
    const flag = (bit: number, ch: string): string =>
      ccr & bit ? ch : ch.toLowerCase();
    const flags =
      flag(0x20, "H") + flag(0x10, "I") + flag(0x08, "N") +
      flag(0x04, "Z") + flag(0x02, "V") + flag(0x01, "C");
    const status = s.scrubbing
      ? `scrubbing @${s.scrubSpeed.toFixed(2)}×`
      : s.paused ? "paused" : "running";
    const lines: string[] = [];
    // Pattern 8 — inspect cursor takes top billing when the user is hovering
    // somewhere with a known historical PC, so the connection from "this
    // moment in audio" → "this routine + source line" is unmissable.
    if (this.inspect) {
      lines.push(this.formatInspectLine(this.inspect), "");
    }
    lines.push(
      `${formatDisassembly(s.disassembly)}`,
      `A=${HEX(s.a, 2)}  B=${HEX(s.b, 2)}  X=${HEX(s.x, 4)}  SP=${HEX(s.sp, 4)}`,
      `PC=${HEX(s.pc, 4)}  CCR=${HEX(s.ccr, 2)} [${flags}]`,
      `cycles=${s.cycles.toLocaleString()}    ${status}`,
    );
    // Step 4.1: when the snapshot carries an engine slot, append it as a
    // raw readout.  Proper per-engine viz panels (LFSR ring, GWAVE wavetable
    // bar chart, etc.) land in Phase 4.2+; this is the verification surface
    // that the slots actually populate.
    if (s.lfsr) {
      const { state, bitOut, lfreq, cycnt } = s.lfsr;
      lines.push("", "LFSR: " +
        `state=${HEX(state, 4)}  bit=${bitOut}  ` +
        `LFREQ=${HEX(lfreq, 2)}  CYCNT=${HEX(cycnt, 2)}`);
    }
    if (s.vari) {
      const { loper, hiper, locnt, hicnt } = s.vari;
      lines.push("", "VARI: " +
        `LOPER=${HEX(loper, 2)}  HIPER=${HEX(hiper, 2)}  ` +
        `LOCNT=${HEX(locnt, 2)}  HICNT=${HEX(hicnt, 2)}`);
    }
    if (s.gwave) {
      const { echo, gper, gecnt, fofset, gwfrm, sampleIndex } = s.gwave;
      lines.push("", "GWAVE: " +
        `GPER=${HEX(gper, 2)}  GECHO=${echo ? "•" : "○"}  GECNT=${HEX(gecnt, 2)}  ` +
        `FOFSET=${fofset >= 0 ? "+" : ""}${fofset}  ` +
        `GWFRM=${HEX(gwfrm, 4)}  X→tab=${sampleIndex >= 0 ? sampleIndex : "—"}`);
    }
    if (s.fnoise) {
      const { fmax, freq, sampc, fdflg, dsflg } = s.fnoise;
      lines.push("", "FNOISE: " +
        `FMAX=${HEX(fmax, 2)}  FREQ=${HEX(freq, 4)}  ` +
        `SAMPC=${HEX(sampc, 4)}  ` +
        `slope=${fdflg ? "↓" : "↑"}  ` +
        `dist=${dsflg ? "•" : "○"}`);
    }
    this.el.textContent = lines.join("\n");
  }

  /** Render the inspect cursor as a single-line readout for the Code panel. */
  private formatInspectLine(c: InspectCursor): string {
    const pcStr = c.pc !== undefined ? `$${HEX(c.pc, 4)}` : "(silent)";
    let label = "";
    if (c.pc !== undefined && this.labelMap && this.getGame) {
      const resolved = resolveLabel(this.labelMap, this.getGame(), c.pc);
      if (resolved) {
        const src = this.labelMap.sources[this.getGame()] ?? "";
        const srcRef = resolved.src_line != null && src
          ? `  ${src}:${resolved.src_line}`
          : "";
        label = `  ${formatLabel(resolved)}${srcRef}`;
      }
    }
    return `INSPECT [${c.source}]  cycle=${c.cycle.toLocaleString()}  PC=${pcStr}${label}`;
  }
}
