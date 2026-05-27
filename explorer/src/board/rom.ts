/**
 * Loader for the assembled Williams sound ROMs.
 *
 * The binaries live in `<repo>/research/roms/<game>_sound.bin` (the private
 * submodule) — produced by `tools/build_roms.sh`.  This loader is Node-only
 * (uses `fs`); the browser path reads user-uploaded bytes from IndexedDB.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { GameKind } from "./soundboard.ts";

/** Path to the repo root (the directory that contains `tools/` and `explorer/`). */
function repoRoot(): string {
  // This file is at explorer/src/board/rom.ts → three levels above is the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** Load the assembled ROM for `game` as a fresh `Uint8Array`. */
export async function loadROM(game: GameKind): Promise<Uint8Array> {
  const file = resolve(repoRoot(), "research", "roms", `${game}_sound.bin`);
  const buf = await readFile(file);
  return new Uint8Array(buf);
}
