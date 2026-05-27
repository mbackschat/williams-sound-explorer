#!/usr/bin/env -S npx tsx
/**
 * Render a Williams sound command to a WAV file by running the emulator
 * end-to-end.
 *
 * Usage:
 *   npx tsx tools/render_sound.ts <game> <hex-cmd> <out.wav>
 *
 * Example:
 *   npx tsx tools/render_sound.ts defender 0x11 out/defender_11_lite.wav
 *
 * This is the **first ear-check** in the project: the output WAV plays in
 * any audio player and *should* sound like the original Williams arcade
 * effect, regenerated from the 1980 ROM by the TypeScript emulator.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { runSound } from "../explorer/src/node/runnerNode.ts";
import { renderDacEvents } from "../explorer/src/synth/DacSampler.ts";
import { applyLpf } from "../explorer/src/synth/lpf.ts";
import { encodeWav } from "../explorer/src/synth/wav.ts";
import type { GameKind } from "../explorer/src/board/soundboard.ts";

function usage(): never {
  console.error("usage: render_sound.ts <game> <hex-cmd> <out.wav>");
  console.error("       game: defender | stargate | robotron");
  console.error("       cmd:  0x00..0x3F (e.g. 0x11 for LITE)");
  process.exit(2);
}

async function main(): Promise<void> {
  const [, , gameArg, cmdArg, outArg] = process.argv;
  if (!gameArg || !cmdArg || !outArg) usage();

  const VALID_GAMES = ["defender", "stargate", "robotron"] as const;
  if (!(VALID_GAMES as readonly string[]).includes(gameArg)) usage();
  const game = gameArg as GameKind;
  const cmd = Number.parseInt(
    cmdArg.startsWith("0x") || cmdArg.startsWith("0X") ? cmdArg.slice(2) : cmdArg,
    16,
  );
  if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) usage();
  const out = outArg;

  console.log(`[${game}] running command 0x${cmd.toString(16).padStart(2, "0").toUpperCase()}…`);
  const result = await runSound(game, cmd);
  console.log(`  events: ${result.events.length}`);
  console.log(`  cycles: ${result.cycles} (≈${(result.cycles / 894886 * 1000).toFixed(0)} ms)`);
  console.log(`  reachedIdle: ${result.reachedIdle}`);
  if (result.events.length === 0) {
    console.log("  (no DAC writes — this command probably produces silence)");
  }

  const SAMPLE_RATE = 48000;
  const samples = renderDacEvents(result.events, {
    totalCycles: result.cycles,
    targetRate: SAMPLE_RATE,
  });
  applyLpf(samples, { cutoffHz: 10000, sampleRate: SAMPLE_RATE });

  const wav = encodeWav(samples, SAMPLE_RATE);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, wav);
  console.log(
    `✔ wrote ${out} — ${(wav.length / 1024).toFixed(1)} KiB, ${(samples.length / SAMPLE_RATE).toFixed(2)} s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
