/**
 * Real-time CPU + DAC driver for the AudioWorklet.
 *
 * This is the Phase-2 sibling of `runner.ts` (which does an offline,
 * run-to-idle render).  The offline path treats the DAC stream as a complete
 * event list, resamples it as one buffer, then encodes WAV.  The realtime
 * path instead advances the CPU **just enough** to fill the next audio block
 * the audio thread asks for, applies the same DAC ZOH + 1-pole LPF inline,
 * and writes directly to the output `Float32Array`.
 *
 * Design notes:
 *
 * - The CPU's cycle counter is the source of truth for wall-clock time inside
 *   the worklet.  We keep a `cycleAccumulator` (float, fractional cycles per
 *   audio sample) that bumps by `(cpuRate / sampleRate) * speed` every output
 *   sample.  After each sample we step the CPU until `cpu.cycles >= target`,
 *   then sample the current DAC value.  Per-sample overshoot is bounded by
 *   the longest instruction (~12 cycles), so the long-term timing is exact.
 *
 * - Speed scaling is implemented audibly: at speed=0.5 the CPU runs at half
 *   rate, so DAC writes are spread over twice as many output samples, the
 *   pitch drops an octave.  This matches Step 2.2's intent ("slide speed →
 *   audio pitch drops audibly").  Decoupled snapshot animation (Phase 3+)
 *   is a separate concern handled in the visualisation layer.
 *
 * - DAC events recorded by the PIA are drained at the end of each block
 *   (`pia.dacEvents.splice(0, n)`), so memory stays bounded during long-
 *   running playback.  We only consult the event log to update
 *   `currentDacValue`; the CPU's cycle counter does all the time-keeping.
 *
 * - The LPF state survives across blocks (instance fields), so block
 *   boundaries do not introduce discontinuities.  The same `α = dt/(RC+dt)`
 *   formulation as `synth/lpf.ts` — kept duplicated rather than imported,
 *   because per-sample work needs to stay tight in the worklet hot path.
 *
 * - This file imports `cpu/*` and `board/*` only.  It does NOT import
 *   `board/rom.ts` (which reads from `node:fs`) — the worklet must be free
 *   of Node-isms.  ROM bytes are passed in by the host.
 */
import type { CPUState } from "../cpu/types.ts";
import { readWord } from "../cpu/types.ts";
import { createCPU, reset, step } from "../cpu/m6800.ts";
import { SoundBoard, type GameKind } from "../board/soundboard.ts";
import { disassemble, type Disassembly } from "../cpu/disasm.ts";
import { DacHistory, type HistoryRange } from "./dacHistory.ts";
import { RamHistory, RAM_HISTORY_DEFAULT_INTERVAL } from "./ramHistory.ts";
import { engineStateForPc, type EngineSlots } from "./engineState.ts";
import type { EngineToggleKey } from "./engineToggles.ts";

/** Scrub-mode loop policy at the recording boundary. */
export type ScrubLoopMode = "none" | "range" | "segment";

/** One fire-to-silence sound event tracked for the scrubber UI. */
export interface SoundSegment {
  /** 6-bit command byte that started this segment. */
  cmd: number;
  /** Cycle of the `fire(cmd)` call that opened the segment. */
  startCycle: number;
  /**
   * Cycle of the segment's effective end — i.e. the last DAC write before
   * a long enough idle gap.  `null` while the segment is still active.
   */
  endCycle: number | null;
}

/** Idle threshold for closing an open segment (≈ 50 ms at 894 886 Hz). */
const SEGMENT_IDLE_THRESHOLD = 50_000;
/** Soft cap on retained segments (oldest are dropped to keep memory bounded). */
const MAX_SEGMENTS = 128;

export interface RealtimeOptions {
  /** Output sample rate.  Defaults to 48000; AudioWorklet host passes the AudioContext rate. */
  sampleRate?: number;
  /** CPU bus clock.  Defaults to 894886 Hz (Williams). */
  cpuRate?: number;
  /** LPF cutoff in Hz.  Defaults to 10 kHz (the 1458 reconstruction filter). */
  lpfCutoffHz?: number;
  /** DAC history ring buffer size in events.  Defaults to 50 000. */
  historyCapacity?: number;
  /** Periodic CPU+RAM snapshot ring capacity.  Defaults to 10 000 entries. */
  ramHistoryCapacity?: number;
  /**
   * Size of the most-recent-output-samples ring buffer (for the oscilloscope
   * snapshot).  Default 512 ≈ 10.7 ms at 48 kHz — enough for a few LFSR
   * cycles in LITE.
   */
  outputRingSize?: number;
}

/**
 * A real-time CPU+DAC driver.  Construct once per playback session, call
 * `bootToIdle()` once, then drive playback by calling `fillBlock(out)` from
 * the audio thread.  Inject sound commands with `fire(cmd)` from any thread.
 */
export class RealtimeRunner {
  readonly board: SoundBoard;
  readonly cpu: CPUState;

  private readonly sampleRate: number;
  private readonly cpuRate: number;
  private readonly lpfAlpha: number;

  /** Per-sample IIR low-pass state — survives across blocks. */
  private lpfY = 0;
  /** Most recent DAC byte written by the CPU.  0x80 = mid-rail silence. */
  private currentDacValue = 0x80;
  /** Cursor into `pia.dacEvents` for the current block. */
  private eventCursor = 0;
  /** Fractional CPU-cycle target — drives the audio wall clock. */
  private cycleAccumulator = 0;
  /** Playback rate multiplier (1 = real time). */
  private speedFactor = 1;
  /** True once SETUP has reached BRA-self idle. */
  private booted = false;
  /** True while the CPU is frozen (audio output holds the LPF level). */
  private paused = false;
  /**
   * Audio queued during paused-mode steps.  Each `step / stepToDac /
   * stepToIrq` renders the cycles it just executed (with ZOH + LPF, same
   * pipeline as `fillBlock`) and appends to this buffer.  Paused `fillBlock`
   * drains it before falling back to held silence — so the user actually
   * *hears* what the CPU just did (click on Step→DAC, burst on Step→IRQ).
   *
   * `resume()` discards the queue (audio continues fresh from the CPU's
   * new position, not as a replay of stepped history).
   */
  private playbackQueue: Float32Array | null = null;
  private playbackOffset = 0;
  /** Hard cap on the playback queue length, in samples (≈ 1 second). */
  private readonly maxQueueSamples: number;

  /**
   * Always-on ring buffer of DAC writes.  Populated from every step that
   * drains the PIA's event log; the scrubber reads from it.
   */
  private readonly history: DacHistory;
  /** Periodic CPU + RAM snapshots so scrub mode can time-travel engine state. */
  private readonly ramHistory: RamHistory;
  /** Capture-every-N-cycles cadence for the RAM history. */
  private readonly ramInterval = RAM_HISTORY_DEFAULT_INTERVAL;
  /** Next cycle at which a RAM snapshot is due. */
  private nextRamCapture = 0;
  /** When set, `fillBlock` plays back history at this position + speed instead of running the CPU. */
  private scrubActive = false;
  /** Current cycle the scrub head is reading from. */
  private scrubCycle = 0;
  /** Signed speed multiplier for scrubbing — negative = reverse playback. */
  private scrubSpeed = 1;
  /** How the scrub head wraps at the recording boundary. */
  private scrubLoopMode: ScrubLoopMode = "none";

  /** Recent `fire(cmd)` events with their detected end cycles.  Caps at MAX_SEGMENTS. */
  private readonly segments: SoundSegment[] = [];
  /** Currently-open segment (no endCycle yet) or null. */
  private activeSegment: SoundSegment | null = null;
  /** Cycle of the most recent DAC write — used to detect segment end. */
  private lastDacWriteCycle = 0;

  /**
   * Ring buffer of the most recent output samples (the floats written to
   * `out` in fillBlock / fillBlockScrub).  Snapshot copies these out as a
   * linearised oldest→newest slice for the oscilloscope panel.
   */
  private readonly outputRing: Float32Array;
  private outputRingWrite = 0;
  /**
   * Parallel ring buffer of the *pre-LPF* DAC values normalised to [-1, +1]
   * — the raw stair-step that the LPF then smooths.  Lets the oscilloscope
   * draw both traces so the user can literally see what the LPF is doing.
   */
  private readonly rawRing: Float32Array;
  /** Scratch buffer reused by each fill path to stage raw values for `writeRings`. */
  private readonly rawScratch: Float32Array;

  constructor(game: GameKind, rom: Uint8Array, opts: RealtimeOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.cpuRate = opts.cpuRate ?? 894_886;
    const cutoff = opts.lpfCutoffHz ?? 10_000;
    const dt = 1 / this.sampleRate;
    const rc = 1 / (2 * Math.PI * cutoff);
    this.lpfAlpha = dt / (rc + dt);
    // One second of audio at the chosen rate — enough to hear the start of
    // a long burst (e.g. Step→IRQ inside LITE) without queuing forever.
    this.maxQueueSamples = this.sampleRate;
    this.history = new DacHistory(opts.historyCapacity ?? 50_000);
    this.ramHistory = new RamHistory(opts.ramHistoryCapacity ?? 10_000);
    const ringSize = opts.outputRingSize ?? 512;
    this.outputRing = new Float32Array(ringSize);
    this.rawRing = new Float32Array(ringSize);
    // Scratch for the per-fill raw values, big enough for any plausible
    // audio block size (WebAudio quantum is 128 samples).
    this.rawScratch = new Float32Array(Math.max(2048, ringSize));

    this.board = new SoundBoard(game, rom);
    this.cpu = createCPU();
    this.board.cpu = this.cpu;
  }

  /**
   * Append two freshly-filled buffers (LPF output + matching raw pre-LPF
   * values) into their rolling rings in lockstep.  Used by every fill
   * path so the rawRing always corresponds to the same N samples as the
   * outputRing.
   */
  private writeRings(outChunk: Float32Array, rawChunk: Float32Array): void {
    const ring = this.outputRing;
    const raw = this.rawRing;
    const ringLen = ring.length;
    const n = outChunk.length;
    if (n >= ringLen) {
      ring.set(outChunk.subarray(n - ringLen));
      raw.set(rawChunk.subarray(n - ringLen));
      this.outputRingWrite = 0;
      return;
    }
    const remaining = ringLen - this.outputRingWrite;
    if (n <= remaining) {
      ring.set(outChunk, this.outputRingWrite);
      raw.set(rawChunk, this.outputRingWrite);
      this.outputRingWrite = (this.outputRingWrite + n) % ringLen;
    } else {
      ring.set(outChunk.subarray(0, remaining), this.outputRingWrite);
      raw.set(rawChunk.subarray(0, remaining), this.outputRingWrite);
      ring.set(outChunk.subarray(remaining), 0);
      raw.set(rawChunk.subarray(remaining), 0);
      this.outputRingWrite = n - remaining;
    }
  }

  /**
   * PC to use for engine-state dispatch on a snapshot.  Live mode = the
   * actual cpu.pc; scrub mode = the historical PC at the scrub head's
   * cycle (via the DAC history's parallel pcs ring).  Falls back to the
   * live cpu.pc when the buffer has no event at-or-before the scrub head
   * (e.g. scrub head before any sound was fired).
   */
  private effectivePc(): number {
    if (!this.scrubActive) return this.cpu.pc;
    const histPc = this.history.pcAt(this.scrubCycle);
    return histPc ?? this.cpu.pc;
  }

  /** Linearise the chosen ring as a fresh Float32Array, oldest → newest. */
  private snapshotRing(ring: Float32Array): Float32Array {
    const ringLen = ring.length;
    const start = this.outputRingWrite;
    const out = new Float32Array(ringLen);
    if (start === 0) {
      out.set(ring);
    } else {
      out.set(ring.subarray(start), 0);
      out.set(ring.subarray(0, start), ringLen - start);
    }
    return out;
  }

  /**
   * Reset the CPU and step until the SETUP routine reaches its `BRA *` idle
   * loop.  Must be called once before the first `fillBlock`.
   */
  bootToIdle(opts: { maxSteps?: number; idleStreakRequired?: number } = {}): void {
    reset(this.cpu, this.board);
    const max = opts.maxSteps ?? 2000;
    const streak = opts.idleStreakRequired ?? 4;
    let lastPc = -1;
    let same = 0;
    for (let i = 0; i < max; i++) {
      step(this.cpu, this.board);
      if (this.cpu.pc === lastPc) {
        same++;
        if (same >= streak) {
          this.finishBoot();
          return;
        }
      } else {
        same = 0;
        lastPc = this.cpu.pc;
      }
    }
    throw new Error(`RealtimeRunner.bootToIdle: did not reach idle within ${max} steps`);
  }

  private finishBoot(): void {
    // Discard any DAC writes that happened during SETUP (there shouldn't be
    // any, but be defensive) and anchor the wall clock to the post-boot CPU
    // cycle count.
    this.board.pia.dacEvents.length = 0;
    this.eventCursor = 0;
    this.cycleAccumulator = this.cpu.cycles;
    this.currentDacValue = 0x80;
    this.lpfY = 0;
    this.playbackQueue = null;
    this.playbackOffset = 0;
    this.booted = true;
  }

  /**
   * Inject a 6-bit command (0..0x3F).  The PIA raises CA1 → the next
   * `fillBlock` call will see the IRQ flag and vector the CPU into the
   * sound's IRQ handler.  Also opens a new sound-segment marker for the
   * scrubber UI; if a previous segment was still open it gets closed at
   * its most recent DAC-write cycle.
   */
  fire(cmd: number): void {
    const cmd6 = cmd & 0x3F;
    this.closeActiveSegment();
    const seg: SoundSegment = {
      cmd: cmd6,
      startCycle: this.cpu.cycles,
      endCycle: null,
    };
    this.segments.push(seg);
    this.activeSegment = seg;
    // Trim from the front if we've exceeded the cap.
    if (this.segments.length > MAX_SEGMENTS) {
      this.segments.splice(0, this.segments.length - MAX_SEGMENTS);
    }
    this.board.pia.setCommand(cmd6);
  }

  /** Currently-tracked sound segments (last MAX_SEGMENTS fires). */
  getSegments(): readonly SoundSegment[] { return this.segments; }

  /** Close the active segment at the most recent DAC write (or current cycle). */
  private closeActiveSegment(): void {
    if (this.activeSegment === null) return;
    this.activeSegment.endCycle = Math.max(
      this.activeSegment.startCycle,
      this.lastDacWriteCycle,
    );
    this.activeSegment = null;
  }

  /**
   * Close the active segment if the DAC has been idle long enough.  Called
   * from each fill path after event drainage so segments end naturally
   * when the IRQ handler returns to `BRA *` and stops writing.
   */
  private maybeCloseSegmentOnIdle(): void {
    if (this.activeSegment === null) return;
    const idle = this.cpu.cycles - this.lastDacWriteCycle;
    if (idle >= SEGMENT_IDLE_THRESHOLD) {
      this.closeActiveSegment();
    }
  }

  /** Set playback speed.  1 = real time, 0.5 = half speed, 2 = double, … */
  setSpeed(s: number): void {
    if (!(s > 0)) throw new Error(`RealtimeRunner.setSpeed: speed must be > 0, got ${s}`);
    this.speedFactor = s;
  }

  /** Current playback speed multiplier. */
  getSpeed(): number { return this.speedFactor; }

  /**
   * Set or clear a Pattern 3 engine toggle (Step 4.4).  Writes through to
   * `board.toggles`; `SoundBoard.write()` consults the flags on every RAM
   * write to optionally suppress engine-state advances.
   *
   * Side-effect: for ORGAN voice mutes, also stomp the live OSCIL cell with
   * the AND-mask so the mute takes effect immediately — without this, the
   * engine keeps using the previous OSCIL value until the next note's CPU
   * write.  OSCIL lives at $14 on Robotron, $15 on Defender/Stargate (their
   * zero-page overlays differ); ORGAN exists on all three games.
   */
  setToggle(key: EngineToggleKey, value: boolean): void {
    this.board.toggles[key] = value;
    if (key.startsWith("organMuteVoice")) {
      const oscilAddr = this.board.game === "robotron" ? 0x14 : 0x15;
      let muteMask = 0;
      for (let i = 0; i < 8; i++) {
        if (this.board.toggles[`organMuteVoice${i}` as EngineToggleKey]) muteMask |= 1 << i;
      }
      this.board.ram[oscilAddr] = this.board.ram[oscilAddr]! & ~muteMask & 0xFF;
    }
  }

  /**
   * Set or clear a Pattern 5 parameter override (Step 6.2).  Pass `null` to
   * clear.  When set, the cell is immediately stomped in RAM so the next CPU
   * read picks up the override even before the CPU writes again.
   */
  setParamOverride(addr: number, value: number | null): void {
    const a = addr & 0xFF;
    if (value === null) {
      this.board.paramOverrides.delete(a);
      return;
    }
    const v = value & 0xFF;
    this.board.paramOverrides.set(a, v);
    // Stomp the current RAM so the engine immediately observes the override
    // on its next read (otherwise the value only kicks in when the CPU next
    // tries to WRITE to that cell — could be a few iterations away).
    this.board.write(a, v);
  }

  /**
   * Freeze the CPU.  Subsequent `fillBlock` calls hold the current LPF
   * output (no advance, no DAC drainage).  Useful for "pause" and for
   * inspecting CPU state between instructions via `step()`.
   */
  pause(): void { this.paused = true; }

  /**
   * Resume CPU execution.  Discards any queued step-playback audio so the
   * next `fillBlock` continues from the CPU's *current* position rather
   * than replaying historical stepped audio.
   */
  resume(): void {
    this.paused = false;
    this.playbackQueue = null;
    this.playbackOffset = 0;
  }

  // ---- scrub mode -------------------------------------------------------

  /** True while the scrubber is driving audio (CPU is frozen). */
  isScrubbing(): boolean { return this.scrubActive; }

  /** Recorded DAC-history range — used by the host to size the scrubber. */
  recordedRange(): HistoryRange { return this.history.range(); }

  /**
   * Enter scrub mode at `cycle` with playback speed `speed` (signed —
   * negative means reverse).  Also pauses the CPU (so live execution stops
   * while scrubbing).  No-op if there's no history to scrub through.
   */
  startScrub(cycle: number, speed = 1): void {
    if (this.history.size === 0) return;
    this.scrubActive = true;
    this.paused = true;
    this.playbackQueue = null;
    this.playbackOffset = 0;
    this.setScrubPosition(cycle);
    this.scrubSpeed = speed;
  }

  /** Move the scrub head to `cycle` (clamped to the history range). */
  setScrubPosition(cycle: number): void {
    const r = this.history.range();
    if (r.size === 0) {
      this.scrubCycle = 0;
      return;
    }
    if (cycle < r.oldestCycle) this.scrubCycle = r.oldestCycle;
    else if (cycle > r.newestCycle) this.scrubCycle = r.newestCycle;
    else this.scrubCycle = cycle;
  }

  /** Set scrub playback rate.  Negative = reverse, 0 = freeze the head. */
  setScrubSpeed(speed: number): void { this.scrubSpeed = speed; }

  /**
   * Set the scrub-mode loop policy.  "none" clamps at the recording
   * boundary; "range" wraps the whole oldest..newest range; "segment"
   * wraps within whichever segment the scrub head is currently inside
   * (and falls back to "range" if outside any known segment).
   */
  setScrubLoop(mode: ScrubLoopMode): void { this.scrubLoopMode = mode; }

  /** Current scrub loop mode. */
  getScrubLoop(): ScrubLoopMode { return this.scrubLoopMode; }

  /** Current scrub head position in CPU-cycle units. */
  getScrubPosition(): number { return this.scrubCycle; }

  /**
   * Exit scrub mode.  Optionally resumes live CPU execution; default keeps
   * the CPU paused so the user can decide.
   */
  exitScrub(opts: { resume?: boolean } = {}): void {
    this.scrubActive = false;
    if (opts.resume) {
      this.paused = false;
      this.playbackQueue = null;
      this.playbackOffset = 0;
    }
  }

  /**
   * Clear the DAC history ring + segments array.  Always restores live-CPU
   * playback: any scrub-mode or paused state is cleared so the user can
   * fire a new sound immediately afterwards.  (Without un-pausing here,
   * Reset → Fire silently freezes the CPU mid-IRQ — the message arrives
   * but `fillBlock` never advances anything to service it.)
   */
  resetRecording(): void {
    this.history.clear();
    this.ramHistory.clear();
    this.nextRamCapture = this.cpu.cycles;
    this.segments.length = 0;
    this.activeSegment = null;
    this.lastDacWriteCycle = this.cpu.cycles;
    this.scrubActive = false;
    this.scrubCycle = 0;
    this.paused = false;
    this.playbackQueue = null;
    this.playbackOffset = 0;
  }

  /** True while the CPU is frozen (paused). */
  isPaused(): boolean { return this.paused; }

  /**
   * Advance the CPU by exactly one instruction.  Only meaningful while
   * paused — call `fillBlock` otherwise.  Returns the cycle cost of the
   * instruction (typically 2..12 cycles on the 6800).
   *
   * Note: this advances `cpu.cycles` but does **not** advance the audio
   * `cycleAccumulator`, so resuming with `resume()` will keep the same
   * audio wall-clock relationship.  The CPU may have raced ahead of the
   * accumulator by a few cycles — `fillBlock` handles that gracefully (the
   * `while cpu.cycles < acc` loop is a no-op until the accumulator catches up).
   */
  step(): number {
    if (!this.booted) throw new Error("RealtimeRunner.step: bootToIdle() not called");
    if (!this.paused) throw new Error("RealtimeRunner.step: only valid while paused");
    this.board.syncInterrupts(this.cpu);
    const cycles = step(this.cpu, this.board);
    this.syncAfterStep();
    return cycles;
  }

  /**
   * Run the CPU while paused until `predicate` returns true OR `maxCycles`
   * is exhausted.  Returns the number of cycles consumed and whether the
   * predicate fired.  After completion the audio wall clock is re-anchored
   * to the CPU's new position (so resuming continues smoothly).
   *
   * NOTE: predicate is called after each instruction.  It cannot observe
   * mid-instruction state.
   */
  runUntil(
    predicate: (cpu: CPUState, board: SoundBoard) => boolean,
    maxCycles = 100_000,
  ): { reached: boolean; cycles: number } {
    if (!this.booted) throw new Error("RealtimeRunner.runUntil: bootToIdle() not called");
    if (!this.paused) throw new Error("RealtimeRunner.runUntil: only valid while paused");
    let consumed = 0;
    while (consumed < maxCycles) {
      this.board.syncInterrupts(this.cpu);
      consumed += step(this.cpu, this.board);
      if (predicate(this.cpu, this.board)) {
        this.syncAfterStep();
        return { reached: true, cycles: consumed };
      }
    }
    this.syncAfterStep();
    return { reached: false, cycles: consumed };
  }

  /**
   * Advance the CPU until the next write to the DAC (Port A).  Equivalent
   * to "play me the next sample"; the natural unit of a sound debugger.
   * Returns `reached: false` if no DAC write occurred within `maxCycles`
   * (e.g., the CPU is sitting in the BRA-self idle loop with no IRQ pending).
   */
  stepToNextDacWrite(maxCycles = 50_000): { reached: boolean; cycles: number } {
    const startLen = this.board.pia.dacEvents.length;
    return this.runUntil(
      () => this.board.pia.dacEvents.length > startLen,
      maxCycles,
    );
  }

  /**
   * Advance the CPU until it re-enters the IRQ handler (PC reaches the
   * address pointed to by the IRQ vector at $FFF8-$FFF9).  Useful for
   * stepping through the sound engine one IRQ "tick" at a time.
   *
   * Steps one instruction unconditionally first (to move off the current
   * IRQ entry if we happen to be sitting on it), then runs until the next
   * entry.
   */
  stepToNextIrq(maxCycles = 100_000): { reached: boolean; cycles: number } {
    if (!this.booted) throw new Error("RealtimeRunner.stepToNextIrq: bootToIdle() not called");
    if (!this.paused) throw new Error("RealtimeRunner.stepToNextIrq: only valid while paused");
    const irqTarget = readWord(this.board, 0xFFF8);
    // Move off the current spot so we don't trip on the entry we're already at.
    this.board.syncInterrupts(this.cpu);
    let consumed = step(this.cpu, this.board);
    if (this.cpu.pc === irqTarget) {
      this.syncAfterStep();
      return { reached: true, cycles: consumed };
    }
    while (consumed < maxCycles) {
      this.board.syncInterrupts(this.cpu);
      consumed += step(this.cpu, this.board);
      if (this.cpu.pc === irqTarget) {
        this.syncAfterStep();
        return { reached: true, cycles: consumed };
      }
    }
    this.syncAfterStep();
    return { reached: false, cycles: consumed };
  }

  /**
   * Re-anchor the audio wall clock to the CPU's new cycle count and drain
   * any pending DAC events into `currentDacValue`.  Also renders the audio
   * for the just-executed cycle range into the playback queue so paused
   * `fillBlock` calls can play back the click/burst the step produced.
   *
   * Called by every paused-mode step primitive (`step`, `stepToNextDacWrite`,
   * `stepToNextIrq`, `runUntil`).
   */
  private syncAfterStep(): void {
    const startCycle = this.cycleAccumulator;
    const endCycle = this.cpu.cycles;
    if (endCycle > startCycle) {
      this.renderStepAudio(startCycle, endCycle);
    }
    const events = this.board.pia.dacEvents;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      this.history.push(e.cycle, e.value, e.pc ?? 0);
      if (e.cycle > this.lastDacWriteCycle) this.lastDacWriteCycle = e.cycle;
    }
    events.length = 0;
    this.eventCursor = 0;
    this.cycleAccumulator = endCycle;
    this.maybeRamSnapshot();
    this.maybeCloseSegmentOnIdle();
  }

  /**
   * Capture zero-page RAM + X into the ram-history ring if we've crossed
   * the next-capture cycle.  Called from the live CPU step loop and from
   * `syncAfterStep` after paused-mode primitives.  Cheap: amortises to one
   * 128-byte memcpy per ~512 cycles.
   */
  private maybeRamSnapshot(): void {
    if (this.cpu.cycles < this.nextRamCapture) return;
    this.ramHistory.push(this.cpu.cycles, this.cpu.x, this.board.ram);
    this.nextRamCapture = this.cpu.cycles + this.ramInterval;
  }

  /**
   * Render the audio that *would* have played for the just-stepped cycle
   * range, and append it to the playback queue (with a hard cap of
   * ≈1 second so a single long burst can't queue indefinitely).
   *
   * Updates `lpfY` and `currentDacValue` to the values they have at the
   * END of the rendered range, so a subsequent step continues smoothly.
   */
  private renderStepAudio(startCycle: number, endCycle: number): void {
    const events = this.board.pia.dacEvents;
    const cyclesPerSample = this.cpuRate / this.sampleRate;
    const span = endCycle - startCycle;
    const numSamples = Math.max(1, Math.round(span / cyclesPerSample));
    const alpha = this.lpfAlpha;
    const oneMinusAlpha = 1 - alpha;

    const buf = new Float32Array(numSamples);
    let y = this.lpfY;
    let dac = this.currentDacValue;
    let cur = this.eventCursor;
    let acc = startCycle;
    for (let i = 0; i < numSamples; i++) {
      acc += cyclesPerSample;
      while (cur < events.length && events[cur]!.cycle <= acc) {
        dac = events[cur]!.value;
        cur++;
      }
      const x = (dac - 0x80) / 0x80;
      y = alpha * x + oneMinusAlpha * y;
      buf[i] = y;
    }
    this.lpfY = y;
    this.currentDacValue = dac;
    this.appendToQueue(buf);
  }

  /** Append a buffer to the playback queue, applying the per-instance cap. */
  private appendToQueue(buf: Float32Array): void {
    const cap = this.maxQueueSamples;
    if (this.playbackQueue === null) {
      // Truncate buf to the cap (keep the first `cap` samples — the start
      // of a burst is the most informative part).
      this.playbackQueue = buf.length <= cap ? buf : buf.subarray(0, cap);
      this.playbackOffset = 0;
      return;
    }
    const existing = this.playbackQueue.length - this.playbackOffset;
    const available = Math.max(0, cap - existing);
    if (available === 0) return; // already at cap, drop the new burst
    const take = Math.min(buf.length, available);
    const combined = new Float32Array(existing + take);
    combined.set(this.playbackQueue.subarray(this.playbackOffset), 0);
    combined.set(buf.subarray(0, take), existing);
    this.playbackQueue = combined;
    this.playbackOffset = 0;
  }

  /**
   * Read-only snapshot for the UI / host.  Pure: does not touch any
   * memory-mapped I/O (the disassembler only reads ROM and RAM, never the
   * PIA, so the read-clears semantics of Port B are not triggered).
   */
  snapshot(): {
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
    lastSamples: Float32Array;
    lastRawSamples: Float32Array;
    segments: SoundSegment[];
    scrubLoopMode: ScrubLoopMode;
    recentDacEvents: {
      cycles: Float64Array;
      values: Uint8Array;
      pcs: Uint16Array;
      count: number;
      windowStart: number;
      windowEnd: number;
    };
    /**
     * Zero-page RAM snapshot (Step 6.6) — 128 bytes copied out so the heatmap
     * viz can render every cell's current value.  In scrub mode this is the
     * historical RAM at the scrub head (via RamHistory).  Fresh copy per
     * snapshot so the host can't mutate our state.
     */
    ramSnapshot: Uint8Array;
    /**
     * Per-cell last-write cycle stamp (Step 6.6).  `lastWriteCycle[i]` =
     * CPU cycle of the most recent write to address `i`, or 0 if never
     * written this session.  Combined with the snapshot's `cycles` the
     * heatmap derives "cycles since this cell moved" → heat intensity.
     */
    ramLastWrite: Uint32Array;
  } & EngineSlots {
    return {
      pc: this.cpu.pc,
      a: this.cpu.a,
      b: this.cpu.b,
      x: this.cpu.x,
      sp: this.cpu.sp,
      ccr: this.cpu.ccr,
      cycles: this.cpu.cycles,
      paused: this.paused,
      scrubbing: this.scrubActive,
      scrubCycle: this.scrubCycle,
      scrubSpeed: this.scrubSpeed,
      recorded: this.history.range(),
      lastDac: this.currentDacValue,
      disassembly: disassemble(this.board, this.cpu.pc),
      lastSamples: this.snapshotRing(this.outputRing),
      lastRawSamples: this.snapshotRing(this.rawRing),
      // Shallow-clone segments so the receiver can't mutate our copy.
      segments: this.segments.map((s) => ({ ...s })),
      scrubLoopMode: this.scrubLoopMode,
      // Events in a fixed window for the byte-tape panel.  ~250 ms at
      // 894 886 Hz ≈ 224 000 cycles.
      //   • Live: backward-looking [now − 250 ms, now] — "show me what
      //     just happened up to the speaker's current position."
      //   • Scrub: CENTRED [head − 125 ms, head + 125 ms] — clicking the
      //     marker for an earlier sound puts the head at that segment's
      //     start, and a backward window would show only silence.  Centring
      //     lets the user see context before AND the sound about to play.
      //   The bounds travel with the events so the panel doesn't have to
      //   reconstruct them.
      recentDacEvents: (() => {
        const windowCycles = 224_000;
        let start: number;
        let end: number;
        if (this.scrubActive) {
          const half = windowCycles / 2;
          start = this.scrubCycle - half;
          end = this.scrubCycle + half;
        } else {
          start = this.cpu.cycles - windowCycles;
          end = this.cpu.cycles;
        }
        const slice = this.history.eventsInRange(start, end, 256);
        return { ...slice, windowStart: start, windowEnd: end };
      })(),
      // Zero-page RAM + per-cell last-write cycle (Step 6.6 — heatmap viz).
      // Scrub mode uses the historical RAM snapshot at the head's cycle so
      // the heatmap time-travels along with everything else.  The history
      // ring only retains the RAM bytes, not the per-cell write timestamps —
      // the heat decay is intentional, so reusing the live `lastWriteCycle`
      // table even in scrub mode is fine; the head's cycle subtracted from
      // those stamps still yields a meaningful "ago" reading.
      ramSnapshot: (() => {
        if (this.scrubActive) {
          const snap = this.ramHistory.at(this.scrubCycle);
          if (snap) return snap.ram.slice(0, 128);
        }
        return this.board.ram.slice(0, 128);
      })(),
      ramLastWrite: this.board.lastWriteCycle.slice(0, 128),
      // Per-engine state slots — populated only when PC is inside a known
      // engine's address range.  Three pieces of state need to time-travel
      // with the scrub head:
      //   • PC — looked up via DacHistory's parallel pcs array.
      //   • X register + zero-page RAM — looked up via RamHistory snapshots
      //     captured every ~512 cycles.  When scrubbing, both are fed
      //     through engineStateForPc() so the engine slot's *values*
      //     animate as the user drags the scrub slider.
      // Outside scrub mode (live playback / pause), the live cpu.x + board
      // RAM are used directly.
      ...((): EngineSlots => {
        const pc = this.effectivePc();
        if (this.scrubActive) {
          const snap = this.ramHistory.at(this.scrubCycle);
          if (snap) {
            return engineStateForPc(pc, this.board, snap.x, snap.ram);
          }
        }
        return engineStateForPc(pc, this.board, this.cpu.x);
      })(),
    };
  }

  /**
   * Drive the CPU forward and fill `out` with `out.length` audio samples.
   * Called from the AudioWorkletProcessor.process() hot path; keep it tight.
   *
   * Paused-mode behaviour: emits the held LPF value for every sample (no
   * CPU advance, no DAC drainage, no accumulator update).  This produces a
   * click-free hold — the LPF state at pause-time is exactly what plays
   * for the duration of the pause.
   */
  fillBlock(out: Float32Array): void {
    if (!this.booted) throw new Error("RealtimeRunner.fillBlock: bootToIdle() not called");

    if (this.scrubActive) {
      this.fillBlockScrub(out);
      return;
    }

    if (this.paused) {
      // Drain the step-playback queue first (Step→DAC click, Step→IRQ
      // burst).  Then hold the LPF level for the remainder of the block.
      let i = 0;
      if (this.playbackQueue !== null) {
        const remaining = this.playbackQueue.length - this.playbackOffset;
        const take = Math.min(remaining, out.length);
        out.set(
          this.playbackQueue.subarray(this.playbackOffset, this.playbackOffset + take),
          0,
        );
        this.playbackOffset += take;
        i = take;
        if (this.playbackOffset >= this.playbackQueue.length) {
          this.playbackQueue = null;
          this.playbackOffset = 0;
        }
      }
      if (i < out.length) out.fill(this.lpfY, i);
      // Raw trace during pause: held DAC value (or queue samples mirrored).
      // We don't preserve the per-sample raw counterpart of queued playback,
      // so during queue drain raw mirrors the LPF output — acceptable for
      // an inspection mode.  After the queue, raw is the constant held DAC.
      const raw = this.rawScratch.subarray(0, out.length);
      const heldRaw = (this.currentDacValue - 0x80) / 0x80;
      raw.set(out.subarray(0, i));
      raw.fill(heldRaw, i);
      this.writeRings(out, raw);
      return;
    }

    const cyclesPerSample = (this.cpuRate / this.sampleRate) * this.speedFactor;
    const board = this.board;
    const pia = board.pia;
    const cpu = this.cpu;
    const alpha = this.lpfAlpha;
    const oneMinusAlpha = 1 - alpha;
    const events = pia.dacEvents;

    let acc = this.cycleAccumulator;
    let dac = this.currentDacValue;
    let cur = this.eventCursor;
    let y = this.lpfY;
    const raw = this.rawScratch.subarray(0, out.length);

    for (let i = 0; i < out.length; i++) {
      acc += cyclesPerSample;
      // Advance CPU until cpu.cycles >= acc.  IRQ pickup happens at the
      // top of each step via syncInterrupts.
      while (cpu.cycles < acc) {
        board.syncInterrupts(cpu);
        step(cpu, board);
        // Periodic RAM snapshot capture for scrub-mode time travel.  Inlined
        // here rather than calling `maybeRamSnapshot` to keep this tight loop
        // free of method-call overhead — same logic.
        if (cpu.cycles >= this.nextRamCapture) {
          this.ramHistory.push(cpu.cycles, cpu.x, board.ram);
          this.nextRamCapture = cpu.cycles + this.ramInterval;
        }
      }
      // Drain any DAC events that have just become "the present" for this
      // sample.  Mostly there are zero or one; LFSR-driven sounds like LITE
      // can produce a few per sample at slow speeds.
      while (cur < events.length && events[cur]!.cycle <= acc) {
        dac = events[cur]!.value;
        cur++;
      }
      const x = (dac - 0x80) / 0x80;
      y = alpha * x + oneMinusAlpha * y;
      out[i] = y;
      raw[i] = x;
    }

    // Drain the events array up to the cursor so it doesn't grow unbounded.
    // Each drained event also lands in the history ring for the scrubber.
    if (cur > 0) {
      for (let j = 0; j < cur; j++) {
        const e = events[j]!;
        this.history.push(e.cycle, e.value, e.pc ?? 0);
        if (e.cycle > this.lastDacWriteCycle) this.lastDacWriteCycle = e.cycle;
      }
      events.splice(0, cur);
      cur = 0;
    }

    this.cycleAccumulator = acc;
    this.currentDacValue = dac;
    this.eventCursor = cur;
    this.lpfY = y;
    this.writeRings(out, raw);
    this.maybeCloseSegmentOnIdle();
  }

  /**
   * Scrub-mode `fillBlock`.  Doesn't touch the CPU — reads the DAC byte
   * that *was* in effect at each sample's scrub-cycle position from the
   * history ring, applies the same ZOH + LPF as live playback, then
   * advances the scrub head by `scrubSpeed × cyclesPerSample`.
   *
   * Speed can be negative (reverse playback — the LFSR runs backwards,
   * which is the Pattern-11 demo in `docs/pedagogical_design.md`).
   */
  private fillBlockScrub(out: Float32Array): void {
    const cyclesPerSample = this.cpuRate / this.sampleRate;
    const step = cyclesPerSample * this.scrubSpeed;
    const r = this.history.range();
    const alpha = this.lpfAlpha;
    const oneMinusAlpha = 1 - alpha;
    let y = this.lpfY;
    let cycle = this.scrubCycle;
    const raw = this.rawScratch.subarray(0, out.length);

    // Resolve loop bounds based on mode.  "segment" falls back to range if
    // the head isn't inside a known segment.
    let loopLo = r.oldestCycle;
    let loopHi = r.newestCycle;
    if (this.scrubLoopMode === "segment") {
      const seg = this.findSegmentAt(cycle);
      if (seg !== null && seg.endCycle !== null) {
        loopLo = seg.startCycle;
        loopHi = seg.endCycle;
      }
    }
    const loopActive = this.scrubLoopMode !== "none" && loopHi > loopLo;

    for (let i = 0; i < out.length; i++) {
      const dac = this.history.valueAt(cycle);
      const x = (dac - 0x80) / 0x80;
      y = alpha * x + oneMinusAlpha * y;
      out[i] = y;
      raw[i] = x;
      cycle += step;
      if (loopActive) {
        const span = loopHi - loopLo;
        if (cycle > loopHi) cycle = loopLo + ((cycle - loopLo) % span);
        else if (cycle < loopLo) cycle = loopHi - ((loopLo - cycle) % span);
      } else {
        if (cycle < r.oldestCycle) cycle = r.oldestCycle;
        else if (cycle > r.newestCycle) cycle = r.newestCycle;
      }
    }

    this.scrubCycle = cycle;
    this.lpfY = y;
    this.writeRings(out, raw);
  }

  /** Find the segment containing `cycle`, or null if none. */
  private findSegmentAt(cycle: number): SoundSegment | null {
    for (const s of this.segments) {
      const end = s.endCycle ?? Number.POSITIVE_INFINITY;
      if (cycle >= s.startCycle && cycle <= end) return s;
    }
    return null;
  }
}
