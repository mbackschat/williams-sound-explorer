/**
 * AudioWorkletProcessor for the Williams sound explorer.
 *
 * Lives in the audio thread.  Owns a `RealtimeRunner` and forwards control
 * messages from the main thread (`load`, `fire`, `stop`, `speed`).
 * `process()` is the audio-thread hot path — it just calls
 * `runner.fillBlock(output)` and returns.
 *
 * Message protocol (see also `host.ts`):
 *
 *   main → worklet                            response back
 *   --------------------------------------    -------------------
 *   { type: "load", game, rom: ArrayBuffer }  { type: "ready" }
 *   { type: "fire", cmd: number }             (none)
 *   { type: "stop" }                          (none)
 *   { type: "speed", value: number }          (none)
 *   anything that throws                      { type: "error", message }
 *
 * The processor is registered as "williams-sound-explorer-processor"; the host wires
 * an `AudioWorkletNode` of that name to the destination.
 *
 * NOTE: this file is loaded as a *separate* ES module by
 * `audioContext.audioWorklet.addModule(url)`.  It has its own module graph,
 * which is why we explicitly avoid any `node:*` imports here or anywhere
 * downstream (the `realtimeRunner` module tree is Node-free).
 */
/// <reference path="./worklet-globals.d.ts" />
import { RealtimeRunner } from "./realtimeRunner.ts";
import type { GameKind } from "../board/soundboard.ts";
import type { Disassembly } from "../cpu/disasm.ts";
import type { HistoryRange } from "./dacHistory.ts";
import type { ScrubLoopMode, SoundSegment } from "./realtimeRunner.ts";
import type { EngineToggleKey } from "./engineToggles.ts";

export type { ScrubLoopMode, SoundSegment } from "./realtimeRunner.ts";
export type { EngineToggleKey } from "./engineToggles.ts";

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

/** Per-engine state slot for the currently-running synthesis routine (Step 4.1). */
export interface LfsrState {
  state: number;
  bitOut: 0 | 1;
  lfreq: number;
  cycnt: number;
}

/** VARI duty-cycle square-wave engine state (Step 4.2). */
export interface VariState {
  loper: number;
  hiper: number;
  locnt: number;
  hicnt: number;
  lodt: number;
  hidt: number;
  lomod: number;
  hien: number;
}

/** GWAVE wavetable engine state (Step 4.3). */
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
  waveTable: Uint8Array;
  sampleIndex: number;
}

/** SCREAM (Robotron) — 4 detuned voices summed at the DAC (Step 5.1). */
export interface ScreamState {
  voices: { freq: number; timer: number }[];
}

/** FNOISE — filtered-noise engine (cannon / thrust / BG1) (Phase 6+). */
export interface FNoiseState {
  fmax: number;
  freq: number;
  sampc: number;
  fdflg: number;
  dsflg: number;
}

/** ORGAN (Robotron) — multi-voice oscillator with self-modifying RDELAY scratch (Step 5.2). */
export interface OrganState {
  dur: number;
  oscil: number;
  oscilCount: number;
  rdelay: Uint8Array;
}

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
   * known engine's address range.  At most one slot is non-undefined.  Other
   * engines (gwave / fnoise / scream / organ) will land in later Phase-4 /
   * Phase-5 steps as their sounds come online.
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

class WilliamsSoundProcessor extends AudioWorkletProcessor {
  private runner: RealtimeRunner | undefined;
  /** When false, `process()` emits silence regardless of CPU state. */
  private active = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletInMsg>) => {
      try {
        this.onMessage(e.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.port.postMessage({ type: "error", message } satisfies WorkletOutMsg);
      }
    };
  }

  private onMessage(msg: WorkletInMsg): void {
    switch (msg.type) {
      case "load": {
        const rom = new Uint8Array(msg.rom);
        this.runner = new RealtimeRunner(msg.game, rom, { sampleRate });
        this.runner.bootToIdle();
        this.active = true;
        this.port.postMessage({ type: "ready" } satisfies WorkletOutMsg);
        return;
      }
      case "fire":
        this.runner?.fire(msg.cmd);
        return;
      case "stop":
        // "Stop" means "go silent and do not consume CPU".  We don't tear
        // the runner down; the host can resume by sending another command
        // (which re-arms `active` via the next `load`, or just by mute UI).
        this.active = false;
        return;
      case "speed":
        this.runner?.setSpeed(msg.value);
        return;
      case "pause":
        this.runner?.pause();
        this.postSnapshot();
        return;
      case "resume":
        this.runner?.resume();
        this.postSnapshot();
        return;
      case "step": {
        if (!this.runner) return;
        const cycles = this.runner.step();
        this.postSnapshot({ reached: true, stepCycles: cycles });
        return;
      }
      case "step-dac": {
        if (!this.runner) return;
        const res = this.runner.stepToNextDacWrite();
        this.postSnapshot({ reached: res.reached, stepCycles: res.cycles });
        return;
      }
      case "step-irq": {
        if (!this.runner) return;
        const res = this.runner.stepToNextIrq();
        this.postSnapshot({ reached: res.reached, stepCycles: res.cycles });
        return;
      }
      case "scrub-start":
        this.runner?.startScrub(msg.cycle, msg.speed);
        this.postSnapshot();
        return;
      case "scrub-pos":
        this.runner?.setScrubPosition(msg.cycle);
        return;
      case "scrub-speed":
        this.runner?.setScrubSpeed(msg.value);
        return;
      case "scrub-end":
        this.runner?.exitScrub({ resume: msg.resume });
        this.postSnapshot();
        return;
      case "scrub-loop":
        this.runner?.setScrubLoop(msg.mode);
        return;
      case "reset-recording":
        this.runner?.resetRecording();
        this.postSnapshot();
        return;
      case "engine-toggle":
        this.runner?.setToggle(msg.key, msg.value);
        this.postSnapshot();
        return;
      case "param-override":
        this.runner?.setParamOverride(msg.addr, msg.value);
        this.postSnapshot();
        return;
      case "snapshot":
        this.postSnapshot();
        return;
    }
  }

  private postSnapshot(extra: { reached?: boolean; stepCycles?: number } = {}): void {
    if (!this.runner) return;
    const snap = this.runner.snapshot();
    this.port.postMessage({
      type: "state",
      snapshot: {
        ...snap,
        ...extra,
      },
    } satisfies WorkletOutMsg);
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (this.active && this.runner) {
      this.runner.fillBlock(out);
    } else {
      out.fill(0);
    }
    return true; // keep the processor alive
  }
}

registerProcessor("williams-sound-explorer-processor", WilliamsSoundProcessor);
