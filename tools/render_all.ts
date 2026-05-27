#!/usr/bin/env -S npx tsx
/**
 * Bulk renderer — loops every command in every game's glossary and writes
 * the explorer's WAV output to `out/corpus/{game}/{XX_ROUTINE}.wav`.
 *
 * Used as the source set for the MAME cycle-accuracy diff and as a quick
 * offline browsable corpus.  Each render runs the offline `runSoundWithRom`
 * (not the realtime worklet) for determinism + speed.
 *
 * Special handling:
 *   • $1B ORGANT (all games): fired as a two-step sequence [$1B, $01]
 *     so the tune actually plays.  See MANUAL.md for the user-facing notes.
 *   • $1C ORGANN: skipped.  Stargate/Robotron are gutted; Defender wants a
 *     4-byte protocol that requires runtime data the bulk corpus can't
 *     meaningfully supply.
 *   • $00 NOP: skipped (silence by design).
 *   • Non-terminating sounds (SCREAM, BG loops) capped at 5 s of CPU time.
 *
 * Usage:
 *   npx tsx tools/render_all.ts              # render all 3 games
 *   npx tsx tools/render_all.ts defender     # render one game
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { SoundBoard, type GameKind } from "../explorer/src/board/soundboard.ts";
import { bootToIdle, tick } from "../explorer/src/runner.ts";
import { loadROM } from "../explorer/src/board/rom.ts";
import { renderDacEvents } from "../explorer/src/synth/DacSampler.ts";
import { applyLpf } from "../explorer/src/synth/lpf.ts";
import { encodeWav } from "../explorer/src/synth/wav.ts";

const SAMPLE_RATE = 48000;
const CPU_HZ = 894_886;
const MAX_RUN_CYCLES = CPU_HZ * 5;          // 5 s cap for non-terminating sounds
const SEQUENCE_GAP_CYCLES = CPU_HZ / 25;    // 40 ms between sequenced fires
const IDLE_STREAK = 6;

const ALL_GAMES: GameKind[] = ["defender", "stargate", "robotron"];

interface GlossaryEntry {
  name: string;
  routine: string;
  engine: string;
  blurb?: string;
}
type GameGlossary = Record<string, GlossaryEntry>;
type Glossary = Partial<Record<GameKind, GameGlossary>>;

/**
 * Run a command sequence offline.  Each non-final command runs for
 * `SEQUENCE_GAP_CYCLES` (long enough for the IRQ handler to service it);
 * the final command runs until idle re-detected OR `MAX_RUN_CYCLES`.
 */
function runSequence(game: GameKind, rom: Uint8Array, commands: number[]) {
  const board = new SoundBoard(game, rom);
  const cpu = bootToIdle(board, { idleStreakRequired: IDLE_STREAK });
  const startCycles = cpu.cycles;
  board.pia.dacEvents.length = 0;

  for (let i = 0; i < commands.length; i++) {
    board.pia.setCommand(commands[i]! & 0x3F);
    const isLast = i === commands.length - 1;
    const budget = isLast ? MAX_RUN_CYCLES : SEQUENCE_GAP_CYCLES;
    const segStart = cpu.cycles;
    let lastPc = -1;
    let same = 0;
    while (cpu.cycles - segStart < budget) {
      tick(cpu, board);
      if (isLast) {
        if (cpu.pc === lastPc) {
          same++;
          if (same >= IDLE_STREAK && !board.pia.isIRQPending()) break;
        } else {
          same = 0;
          lastPc = cpu.pc;
        }
      }
    }
  }
  return { events: board.pia.dacEvents, cycles: cpu.cycles - startCycles };
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function commandsForRender(cmd: number, _game: GameKind): number[] | null {
  if (cmd === 0x00) return null;             // silence
  if (cmd === 0x1C) return null;             // ORGANN — Stargate/Robotron gutted, Defender needs 4-byte data
  if (cmd === 0x1B) return [0x1B, 0x01];     // ORGANT — fire arm + tune 1 (PHANTOM / FIFTH)
  return [cmd];
}

async function renderOne(
  game: GameKind,
  cmd: number,
  routine: string,
  rom: Uint8Array,
  outDir: string,
): Promise<{ ok: boolean; reason?: string; bytes?: number; secs?: number }> {
  const sequence = commandsForRender(cmd, game);
  if (sequence === null) {
    return { ok: false, reason: "skipped (silence / arm-only-with-data)" };
  }

  const result = runSequence(game, rom, sequence);
  if (result.events.length === 0) {
    return { ok: false, reason: "no DAC events" };
  }

  const samples = renderDacEvents(result.events, {
    totalCycles: result.cycles,
    targetRate: SAMPLE_RATE,
  });
  applyLpf(samples, { cutoffHz: 10000, sampleRate: SAMPLE_RATE });
  const wav = encodeWav(samples, SAMPLE_RATE);

  const hex = cmd.toString(16).toUpperCase().padStart(2, "0");
  const filename = `${hex}_${safeName(routine)}.wav`;
  const out = `${outDir}/${filename}`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, wav);
  return { ok: true, bytes: wav.length, secs: samples.length / SAMPLE_RATE };
}

async function renderGame(game: GameKind, glossary: GameGlossary, outRoot: string) {
  console.log(`\n[${game}] ${Object.keys(glossary).length} catalogue entries`);
  const rom = await loadROM(game);
  const outDir = `${outRoot}/${game}`;

  let ok = 0, skipped = 0, empty = 0;
  const entries = Object.entries(glossary)
    .map(([k, v]) => ({ cmd: parseInt(k, 16), routine: v.routine || "unknown" }))
    .filter((e) => Number.isFinite(e.cmd))
    .sort((a, b) => a.cmd - b.cmd);

  for (const { cmd, routine } of entries) {
    const hex = cmd.toString(16).toUpperCase().padStart(2, "0");
    process.stdout.write(`  $${hex} ${routine.padEnd(8)} `);
    const r = await renderOne(game, cmd, routine, rom, outDir);
    if (r.ok) {
      console.log(`✔ ${r.secs!.toFixed(2)} s, ${(r.bytes! / 1024).toFixed(1)} KiB`);
      ok++;
    } else if (r.reason === "no DAC events") {
      console.log(`∅ ${r.reason}`);
      empty++;
    } else {
      console.log(`— ${r.reason}`);
      skipped++;
    }
  }
  console.log(`  → ${ok} rendered, ${empty} silent, ${skipped} skipped`);
}

async function main(): Promise<void> {
  const argGame = process.argv[2];
  const games: GameKind[] = argGame
    ? [argGame as GameKind]
    : ALL_GAMES;
  if (argGame && !ALL_GAMES.includes(argGame as GameKind)) {
    console.error(`unknown game "${argGame}" (expected: ${ALL_GAMES.join(" | ")})`);
    process.exit(2);
  }

  const glossaryJson = await readFile(
    "explorer/public/data/glossary.json",
    "utf8",
  );
  const glossary = JSON.parse(glossaryJson) as Glossary;

  const outRoot = "out/corpus";
  console.log(`output → ${outRoot}/{game}/{XX_ROUTINE}.wav`);

  for (const game of games) {
    const g = glossary[game];
    if (!g) {
      console.warn(`(no glossary for ${game})`);
      continue;
    }
    await renderGame(game, g, outRoot);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
