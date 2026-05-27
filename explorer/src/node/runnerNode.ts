/**
 * Node-only convenience that wraps `runSoundWithRom` with `loadROM` from disk.
 * Kept separate from `runner.ts` so the browser bundle never reaches
 * `node:fs` / `node:path` / `node:url` (used by `./rom.ts`).
 *
 * Importers:
 *   • `tools/render_sound.ts` — the WAV exporter CLI.
 *   • Vitest tests that exercise full sounds end-to-end.
 *   • `explorer/src/viz/ABDiff.ts` does NOT import this — it uses
 *     `loadRomFromUrl` + `runSoundWithRom` directly.
 */
import { runSoundWithRom, type RunSoundResult } from "../engine/runner.ts";
import { loadROM } from "./rom.ts";
import type { GameKind } from "../board/soundboard.ts";

export async function runSound(
  game: GameKind,
  cmd: number,
  opts: { maxCycles?: number; idleStreakRequired?: number } = {},
): Promise<RunSoundResult> {
  const rom = await loadROM(game);
  return runSoundWithRom(game, rom, cmd, opts);
}

// Re-export the result type for symmetry with the old `runner.ts` API.
export type { RunSoundResult };
