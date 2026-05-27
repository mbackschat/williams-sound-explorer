/**
 * Tiered ROM validation (upload flow).  Pure size/vector logic runs anywhere;
 * the SHA-1 / `validateRom` tier tests need Web Crypto (Node ≥20 exposes it)
 * and are guarded with `it.runIf`.  The "ok" tier is checked against the real
 * from-source `tools/defender_sound.bin` when present (cf. zeroPageMap.test.ts).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import {
  KNOWN_GOOD_SHA1,
  checkVectors,
  expectedSize,
  trimTrailingPadding,
  validateRom,
} from "../src/audio/romValidate.ts";

const REPO = pathResolve(__dirname, "../..");
const hasCrypto = !!globalThis.crypto?.subtle;

/** A structurally-valid Defender image (2 KB, vectors pointing into ROM). */
function validDefender(): Uint8Array {
  const b = new Uint8Array(0x800);
  b[0x7F8] = 0xF8; b[0x7F9] = 0x00; // IRQ  → $F800
  b[0x7FE] = 0xF9; b[0x7FF] = 0x00; // RESET → $F900
  return b;
}

describe("expectedSize", () => {
  it("is 2 KB for defender/stargate, 4 KB for robotron", () => {
    expect(expectedSize("defender")).toBe(2048);
    expect(expectedSize("stargate")).toBe(2048);
    expect(expectedSize("robotron")).toBe(4096);
  });
});

describe("trimTrailingPadding", () => {
  it("passes an exact-size image through", () => {
    const b = new Uint8Array(2048);
    expect(trimTrailingPadding(b, 2048)!.length).toBe(2048);
  });
  it("trims a uniform 0x00 or 0xFF trailing pad", () => {
    const zero = new Uint8Array(2048 + 16); // zeros by default
    expect(trimTrailingPadding(zero, 2048)!.length).toBe(2048);
    const ff = new Uint8Array(2048 + 16).fill(0xFF, 2048);
    expect(trimTrailingPadding(ff, 2048)!.length).toBe(2048);
  });
  it("rejects a short file", () => {
    expect(trimTrailingPadding(new Uint8Array(2000), 2048)).toBeNull();
  });
  it("rejects a non-uniform (real-data) tail", () => {
    const b = new Uint8Array(2048 + 4);
    b[2050] = 0x42; // tail isn't all one pad byte
    expect(trimTrailingPadding(b, 2048)).toBeNull();
  });
});

describe("checkVectors", () => {
  it("accepts vectors that point into ROM", () => {
    expect(checkVectors(validDefender(), "defender")).toBe(true);
  });
  it("rejects vectors that point outside ROM", () => {
    const b = validDefender();
    b[0x7F8] = 0x00; b[0x7F9] = 0x00; // IRQ → $0000, out of $F800..$FFFF
    expect(checkVectors(b, "defender")).toBe(false);
  });
  it("rejects a wrong-size buffer", () => {
    expect(checkVectors(new Uint8Array(2000), "defender")).toBe(false);
  });
});

describe("validateRom tiers", () => {
  it("rejects a wrong-size upload", async () => {
    const v = await validateRom("defender", new Uint8Array(1024));
    expect(v.tier).toBe("reject");
  });
  it("rejects a right-size file with bad vectors", async () => {
    const v = await validateRom("defender", new Uint8Array(2048)); // all-zero vectors
    expect(v.tier).toBe("reject");
  });
  it.runIf(hasCrypto)("warns on a structurally-valid but unknown dump", async () => {
    const v = await validateRom("defender", validDefender());
    expect(v.tier).toBe("warn");
    expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(v.bytes.length).toBe(2048); // trimmed-to-exact, safe for SoundBoard
  });
  it.runIf(hasCrypto && existsSync(pathResolve(REPO, "research/roms/defender_sound.bin")))(
    "recognizes the real Defender ROM as ok",
    async () => {
      const bytes = new Uint8Array(readFileSync(pathResolve(REPO, "research/roms/defender_sound.bin")));
      const v = await validateRom("defender", bytes);
      expect(v.tier).toBe("ok");
      expect(KNOWN_GOOD_SHA1.defender.has(v.sha)).toBe(true);
    },
  );
});
