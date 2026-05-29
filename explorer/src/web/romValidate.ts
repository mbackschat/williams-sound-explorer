/**
 * Tiered validation for user-uploaded Williams sound ROMs.
 *
 * The app no longer ships the copyrighted ROM bytes — the user supplies their
 * own (see romStore.ts / onboarding.ts).  Each upload is dropped onto a slot
 * that fixes the game (Defender vs Stargate are both 2 KB and otherwise
 * indistinguishable), then validated into one of three tiers:
 *
 *   ok     — SHA-1 is in the known-good allowlist → confidently the real ROM.
 *   warn   — unknown SHA-1 but structurally a valid <game> sound ROM (right
 *            size + plausible 6802 vectors) → accepted, but the explorer's
 *            analysis (labels, genealogy, golden fixtures) may not line up.
 *   reject — wrong size or the reset/IRQ vectors don't point into ROM.
 *
 * Pure module (only `crypto.subtle`), so the size/vector/tier logic is
 * unit-testable in Node without IndexedDB or a DOM.
 */
import type { GameKind } from "../board/soundboard.ts";

export type RomTier = "ok" | "warn" | "reject";

export interface RomValidation {
  tier: RomTier;
  game: GameKind;
  /** Hex SHA-1 of the trimmed bytes ("" when rejected before hashing). */
  sha: string;
  /** Exact-size bytes to store (only meaningful when tier !== "reject"). */
  bytes: Uint8Array;
  /** Human-readable message for the onboarding tier feedback. */
  message: string;
}

/**
 * Per-game ROM geometry — mirrors the memory map in
 * `board/soundboard.ts` (defender/stargate map at $F800 for 2 KB, robotron at
 * $F000 for 4 KB).  Kept here as plain data so this module stays dependency-light.
 */
const GEOMETRY: Record<GameKind, { size: number; base: number }> = {
  defender: { size: 0x800, base: 0xF800 },
  stargate: { size: 0x800, base: 0xF800 },
  robotron: { size: 0x1000, base: 0xF000 },
};

/**
 * Known-good SHA-1s.  Extensible — add hashes here as working variant dumps
 * are confirmed and they'll validate as `ok` instead of `warn`.
 *   defender: MAME production dump + this project's from-source build (2-byte
 *             revision delta, see docs/pipeline/vasm_install_notes.md).
 */
export const KNOWN_GOOD_SHA1: Record<GameKind, ReadonlySet<string>> = {
  defender: new Set([
    "ceb0d18483f0691978c604db94417e6941ad7ff2", // MAME production
    "db679d0ad588c951de8bd25088e7fff7e883942d", // from-source build
  ]),
  stargate: new Set(["9c4334ac3ff15d94001b22fc367af40f9deb7d57"]),
  robotron: new Set(["15afefef11bfc3ab78f61ab046701db78d160ec3"]),
};

const GAME_LABEL: Record<GameKind, string> = {
  defender: "Defender",
  stargate: "Stargate",
  robotron: "Robotron",
};

/** Exact ROM length for a game (2048 or 4096 bytes). */
export function expectedSize(game: GameKind): number {
  return GEOMETRY[game].size;
}

/**
 * Trim a uniform trailing pad (all `0x00` or all `0xFF`) down to the exact
 * ROM size.  Returns the exact-size view, or null if the file is shorter than
 * expected or padded with non-uniform bytes.  `SoundBoard` rejects any
 * non-exact length, so this guards that contract.
 */
export function trimTrailingPadding(bytes: Uint8Array, expected: number): Uint8Array | null {
  if (bytes.length === expected) return bytes;
  if (bytes.length < expected) return null;
  const tail = bytes.subarray(expected);
  const pad = tail[0]!;
  if (pad !== 0x00 && pad !== 0xFF) return null;
  for (const b of tail) {
    if (b !== pad) return null;
  }
  return bytes.subarray(0, expected);
}

/**
 * Sanity-check the 6802 hardware vectors that live in the last 8 bytes of the
 * image: IRQ (offset size-8) and RESET (offset size-2) must point into the
 * ROM's address range.  A wrong/garbage file almost never satisfies this.
 * `bytes` must already be the exact ROM size.
 */
export function checkVectors(bytes: Uint8Array, game: GameKind): boolean {
  const { size, base } = GEOMETRY[game];
  if (bytes.length !== size) return false;
  const word = (off: number): number => (bytes[off]! << 8) | bytes[off + 1]!;
  const inRange = (v: number): boolean => v >= base && v <= base + size - 1;
  const irq = word(size - 8); // $FFF8
  const reset = word(size - 2); // $FFFE
  return inRange(irq) && inRange(reset);
}

/** Hex SHA-1 of `bytes` via the Web Crypto API (needs a secure context). */
export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("ROM validation needs a secure context (https or localhost)");
  }
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-1", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validate an uploaded file for a given game slot.  Returns the tier plus the
 * exact-size bytes to store (for ok/warn).
 */
export async function validateRom(game: GameKind, raw: Uint8Array): Promise<RomValidation> {
  const label = GAME_LABEL[game];
  const expected = expectedSize(game);
  const trimmed = trimTrailingPadding(raw, expected);
  if (!trimmed) {
    return {
      tier: "reject",
      game,
      sha: "",
      bytes: raw,
      message: `Wrong size for ${label} — expected ${expected} bytes, got ${raw.length}.`,
    };
  }
  if (!checkVectors(trimmed, game)) {
    return {
      tier: "reject",
      game,
      sha: "",
      bytes: trimmed,
      message: `Doesn't look like a ${label} sound ROM — the 6802 reset/IRQ vectors don't point into ROM.`,
    };
  }
  const sha = await sha1Hex(trimmed);
  if (KNOWN_GOOD_SHA1[game].has(sha)) {
    return { tier: "ok", game, sha, bytes: trimmed, message: `Recognized ${label} sound ROM.` };
  }
  return {
    tier: "warn",
    game,
    sha,
    bytes: trimmed,
    message: `Accepted ${label} ROM, but unrecognized dump — sounds should match; labels / analysis may not line up.`,
  };
}
