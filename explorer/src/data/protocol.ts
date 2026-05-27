/**
 * Shared data contract between the headless engine, the AudioWorklet, and the
 * browser/viz layer.
 *
 * These types are pure data shapes — no DOM, no Web Audio, no `fetch`.  They
 * live here (not in `worklet.ts`) so that:
 *   - the headless engine can produce `EngineSlots` / `StateSnapshot` without
 *     importing a browser module, and
 *   - the viz panels can consume `StateSnapshot` without reaching into the
 *     `AudioWorkletProcessor` module for a type.
 *
 * The engine-state interfaces below were previously duplicated in both
 * `engineState.ts` (producer) and `worklet.ts` (consumer); they are now defined
 * once, here.  `ScrubLoopMode` / `SoundSegment` (owned by the realtime driver)
 * and `EngineToggleKey` (owned by the toggle module) are re-exported so every
 * consumer of the snapshot contract has a single import site.
 */
import type { Disassembly } from "../cpu/disasm.ts";
import type { GameKind } from "../board/soundboard.ts";
import type { HistoryRange } from "../engine/dacHistory.ts";
import type { ScrubLoopMode, SoundSegment } from "../engine/realtimeRunner.ts";
import type { EngineToggleKey } from "../engine/engineToggles.ts";

export type { ScrubLoopMode, SoundSegment, EngineToggleKey };

// ─── Engine-state slot shapes ─────────────────────────────────────────────────

export interface LfsrState {
  /** 16-bit shift register value (HI:LO). */
  state: number;
  /** The bit just shifted out (= LO & 1 — rotated into the DAC carry). */
  bitOut: 0 | 1;
  /** Frequency divider (LFREQ); decremented per output sample. */
  lfreq: number;
  /** Outer-loop cycle counter (CYCNT). */
  cycnt: number;
}

export interface VariState {
  loper: number; hiper: number;
  locnt: number; hicnt: number;
  lodt: number;  hidt: number;
  lomod: number; hien: number;
}

export interface GWaveState {
  echo: number;
  gccnt: number;
  gecdec: number;
  gdfinc: number;
  gdcnt: number;
  gwfrm: number;
  prdeca: number;
  gwfrq: number;
  gper: number;
  gecnt: number;
  fofset: number;
  /** Live wavetable RAM copy (72 bytes).  Mutates per WVDECA. */
  waveTable: Uint8Array;
  /** Current sample cursor = X − GWTAB base, or -1 when X is outside the table. */
  sampleIndex: number;
}

/**
 * SCREAM (Robotron) — 4 detuned voices summed at the DAC, each storing a
 * `{freq, timer}` pair in zero-page RAM at STABLE..STABLE+7.
 *
 * Pedagogically: the canonical Robotron "scream" sound has each voice
 * decaying at a different rate; watching the 4 amplitude bars drift apart
 * is the whole point.
 */
export interface ScreamState {
  /** Per-voice `(freq, timer)` pairs, oldest→newest by voice index. */
  voices: { freq: number; timer: number }[];
}

/**
 * FNOISE — filtered-noise engine used for cannon, thrust, BG1 (background
 * music 1) and similar percussion-y sounds across all three games.  A
 * 16-bit FHI:FLO frequency accumulator slopes up then back down between
 * 0 and FMAX, with DSFLG enabling random-distortion modulation along the
 * way.  SAMPC counts down samples remaining.
 */
export interface FNoiseState {
  /** FMAX — peak frequency this run is allowed to reach. */
  fmax: number;
  /** FHI:FLO — current 16-bit frequency accumulator value. */
  freq: number;
  /** SAMPC — 16-bit sample countdown (sound ends when this hits 0). */
  sampc: number;
  /** FDFLG — non-zero = decreasing (slope down); 0 = increasing. */
  fdflg: number;
  /** DSFLG — non-zero = distortion (random-driven HI byte). */
  dsflg: number;
}

/**
 * ORGAN (Robotron — also used on Defender, but Robotron's implementation is
 * the canonical multi-voice one).  An oscillator bitmask, a duration counter,
 * and the RDELAY scratchpad (60 bytes of self-modifying delay table).
 */
export interface OrganState {
  /** DUR ($12:$13) — 16-bit note duration counter. */
  dur: number;
  /** OSCIL ($14) — bitmask of active oscillators (popcount = number of voices). */
  oscil: number;
  /** Number of active oscillators (cached popcount of `oscil`). */
  oscilCount: number;
  /** Live snapshot of the 60-byte RDELAY scratchpad ($15..$50). */
  rdelay: Uint8Array;
}

export interface EngineSlots {
  lfsr?: LfsrState;
  vari?: VariState;
  gwave?: GWaveState;
  scream?: ScreamState;
  organ?: OrganState;
  fnoise?: FNoiseState;
}

// ─── Worklet message protocol ─────────────────────────────────────────────────

export type WorkletInMsg =
  | { type: "load"; game: GameKind; rom: ArrayBuffer }
  | { type: "fire"; cmd: number }
  | { type: "stop" }
  | { type: "speed"; value: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "step" }
  | { type: "step-dac" }
  | { type: "step-irq" }
  | { type: "scrub-start"; cycle: number; speed: number }
  | { type: "scrub-pos"; cycle: number }
  | { type: "scrub-speed"; value: number }
  | { type: "scrub-end"; resume?: boolean }
  | { type: "scrub-loop"; mode: ScrubLoopMode }
  | { type: "reset-recording" }
  | { type: "engine-toggle"; key: EngineToggleKey; value: boolean }
  | { type: "param-override"; addr: number; value: number | null }
  | { type: "snapshot" };

/** Plain CPU + DAC + disassembly snapshot transferable across the worklet boundary. */
export interface StateSnapshot {
  pc: number;
  a: number;
  b: number;
  x: number;
  sp: number;
  ccr: number;
  cycles: number;
  paused: boolean;
  scrubbing: boolean;
  scrubCycle: number;
  scrubSpeed: number;
  recorded: HistoryRange;
  lastDac: number;
  disassembly: Disassembly;
  /** Most recent audio output samples (oldest → newest).  Size = `outputRingSize` (default 512). */
  lastSamples: Float32Array;
  /** Pre-LPF raw DAC values, sample-for-sample aligned with `lastSamples`. */
  lastRawSamples: Float32Array;
  /** Recent `fire(cmd)` events with detected end cycles — for scrubber markers. */
  segments: SoundSegment[];
  /** Current scrub loop policy. */
  scrubLoopMode: ScrubLoopMode;
  /**
   * Most recent DAC events for the byte-tape panel — three parallel arrays
   * `{cycles, values, pcs}` with `count` entries (oldest first).  The
   * `windowStart` / `windowEnd` bounds tell the panel which cycle range to
   * map the full canvas width to (centred on the scrub head when scrubbing,
   * right-aligned at "now" when live).
   */
  recentDacEvents: {
    cycles: Float64Array;
    values: Uint8Array;
    pcs: Uint16Array;
    count: number;
    windowStart: number;
    windowEnd: number;
  };
  /** Zero-page RAM (128 bytes) for the RAM heatmap viz (Step 6.6). */
  ramSnapshot: Uint8Array;
  /** Per-cell last-write cycle stamp (length 128) — heat decay metric. */
  ramLastWrite: Uint32Array;
  /** For step-dac / step-irq: whether the predicate fired before the cycle budget ran out. */
  reached?: boolean;
  /** For step-dac / step-irq: cycles consumed by this step. */
  stepCycles?: number;
  /**
   * Per-engine derived state — populated only when the CPU's PC is inside a
   * known engine's address range.  At most one slot is non-undefined.
   */
  lfsr?: LfsrState;
  vari?: VariState;
  gwave?: GWaveState;
  scream?: ScreamState;
  organ?: OrganState;
  fnoise?: FNoiseState;
}

export type WorkletOutMsg =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "state"; snapshot: StateSnapshot };
