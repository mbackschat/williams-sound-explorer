/**
 * Browser-side ROM loader (Step 5.3 — A/B diff; also WAV export).
 *
 * The app no longer ships ROM bytes — they come from the user-supplied store
 * (IndexedDB).  This now delegates to `romStore.loadRomBytes`, which reads the
 * stored ROM (falling back to a gitignored `/roms/<game>_sound.bin` for local
 * dev).  Kept as a thin wrapper so existing callers (ABDiff, WAV export) are
 * unchanged.  The Node-only `rom.ts` (`node:fs`) stays separate; the worklet
 * receives bytes via the `load` message.
 */
import type { GameKind } from "../board/soundboard.ts";
import { loadRomBytes } from "./romStore.ts";

/**
 * ROM bytes for `game` as a fresh `Uint8Array`, from the user-supplied store.
 * `_baseUrl` is accepted for backward compatibility but ignored (the store's
 * dev fallback hardcodes `/roms`).  Throws if no ROM is available — callers
 * should guard game availability first (see the switcher guards in main.ts).
 */
export async function loadRomFromUrl(game: GameKind, _baseUrl = "/roms"): Promise<Uint8Array> {
  return loadRomBytes(game);
}
