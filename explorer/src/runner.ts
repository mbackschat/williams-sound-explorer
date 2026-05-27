/**
 * High-level run loop helpers for the Williams sound CPU + board.
 *
 * `step(cpu, bus)` (in `cpu/m6800.ts`) is the bare CPU primitive — one
 * instruction at a time, no peripheral awareness.  Everything that wraps it
 * for the explorer lives here:
 *
 *   • `tick(cpu, board)` — synchronise the PIA's IRQ line onto the CPU,
 *     then step one instruction.  The unit the audio worklet calls in a loop.
 *   • `bootToIdle(board)` — reset the CPU and run until SETUP finishes (the
 *     `BRA *` idle loop).  Returns the live CPU state.
 *   • `runSound(game, cmd, opts)` — boot a fresh ROM, fire a single 6-bit
 *     command via the PIA, run until the IRQ handler returns to idle (or a
 *     timeout).  Returns the recorded `DACEvent[]` stream.
 */
import { createCPU, reset, step } from "./cpu/m6800.ts";
import type { CPUState } from "./cpu/types.ts";
import { SoundBoard, type GameKind } from "./board/soundboard.ts";
import type { DACEvent } from "./board/pia.ts";
// NOTE: this module is browser-safe.  The Node-only `runSound()` (which
// loads ROMs from `node:fs`) lives in `runnerNode.ts`; the browser path
// uses `runSoundWithRom()` with bytes fetched via `loadRomFromUrl()`.

/**
 * Sync interrupts from the board, then advance the CPU by one instruction.
 * Returns the cycles consumed by the instruction (or the interrupt vectoring).
 */
export function tick(cpu: CPUState, board: SoundBoard): number {
  board.syncInterrupts(cpu);
  return step(cpu, board);
}

/**
 * Boot a board: reset the CPU and step until the SETUP routine reaches the
 * `BRA *` idle loop.  Returns the live CPU.
 *
 * "Idle" detection: the same PC for `idleStreakRequired` consecutive
 * single-step calls.  Set higher to be more conservative.
 */
export function bootToIdle(
  board: SoundBoard,
  opts: { maxSteps?: number; idleStreakRequired?: number } = {},
): CPUState {
  const cpu = createCPU();
  board.cpu = cpu;
  reset(cpu, board);
  const max = opts.maxSteps ?? 2000;
  const streak = opts.idleStreakRequired ?? 4;
  let lastPc = -1;
  let same = 0;
  for (let i = 0; i < max; i++) {
    step(cpu, board);
    if (cpu.pc === lastPc) {
      same++;
      if (same >= streak) return cpu;
    } else {
      same = 0;
      lastPc = cpu.pc;
    }
  }
  throw new Error(`bootToIdle: CPU did not enter idle within ${max} steps`);
}

/**
 * Run one sound to completion (or timeout).
 *
 * Sequence:
 *   1. Boot the ROM through SETUP → idle.
 *   2. Inject the 6-bit `cmd` into the PIA (which raises CA1 → IRQ).
 *   3. Sync-step until the CPU re-enters the idle `BRA *` (i.e., the IRQ
 *      tail has finished and dispatched back to wait), or `maxCycles` ticks
 *      have elapsed.
 *   4. Return the recorded DAC byte stream.
 *
 * `maxCycles` is a CPU-cycle budget, not an instruction count — at the real
 * 894886 Hz bus clock, 5 s of audio is ~4.5M cycles.
 */
export interface RunSoundResult {
  events: DACEvent[];
  /** Total CPU cycles consumed. */
  cycles: number;
  /** True if the run terminated cleanly (idle detected), false if timed out. */
  reachedIdle: boolean;
  /** The board (kept for further inspection or replay). */
  board: SoundBoard;
  /** The CPU state at termination. */
  cpu: CPUState;
}

/**
 * Run one sound given pre-loaded ROM bytes (browser-safe).  See
 * `runnerNode.ts` for the Node convenience wrapper that calls `loadROM()`.
 */
export function runSoundWithRom(
  game: GameKind,
  rom: Uint8Array,
  cmd: number,
  opts: { maxCycles?: number; idleStreakRequired?: number } = {},
): RunSoundResult {
  const board = new SoundBoard(game, rom);
  const cpu = bootToIdle(board, { idleStreakRequired: opts.idleStreakRequired });
  const startCycles = cpu.cycles;
  const cycleBudget = opts.maxCycles ?? 894_886 * 5; // 5 s default
  const streak = opts.idleStreakRequired ?? 6;

  // Fire the command.  Drop any DAC events that snuck in during boot
  // (there shouldn't be any — SETUP doesn't touch the DAC — but be defensive).
  board.pia.dacEvents.length = 0;
  board.pia.setCommand(cmd & 0x3F);

  let lastPc = -1;
  let same = 0;
  while (cpu.cycles - startCycles < cycleBudget) {
    tick(cpu, board);
    if (cpu.pc === lastPc) {
      same++;
      if (same >= streak && !board.pia.isIRQPending()) {
        // Idle re-detected AND no fresh command pending → sound is done.
        return {
          events: board.pia.dacEvents,
          cycles: cpu.cycles - startCycles,
          reachedIdle: true,
          board,
          cpu,
        };
      }
    } else {
      same = 0;
      lastPc = cpu.pc;
    }
  }
  return {
    events: board.pia.dacEvents,
    cycles: cpu.cycles - startCycles,
    reachedIdle: false,
    board,
    cpu,
  };
}
