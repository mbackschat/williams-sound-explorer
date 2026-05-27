import { describe, expect, it } from "vitest";
import {
  CCR_BITS,
  CCR_RESERVED_MASK,
  CCR_RESET,
  ccrHas,
  ccrSet,
  setNZ8,
  setNZ16,
} from "../src/cpu/flags.ts";

describe("CCR flag helpers", () => {
  it("reset state has I=1, reserved bits set, others clear", () => {
    expect(ccrHas(CCR_RESET, CCR_BITS.I)).toBe(true);
    expect(ccrHas(CCR_RESET, CCR_BITS.N)).toBe(false);
    expect(ccrHas(CCR_RESET, CCR_BITS.Z)).toBe(false);
    expect(ccrHas(CCR_RESET, CCR_BITS.V)).toBe(false);
    expect(ccrHas(CCR_RESET, CCR_BITS.C)).toBe(false);
    expect(ccrHas(CCR_RESET, CCR_BITS.H)).toBe(false);
    expect(CCR_RESET & CCR_RESERVED_MASK).toBe(CCR_RESERVED_MASK);
  });

  it("ccrSet sets and clears individual bits, preserves reserved bits", () => {
    let c = 0;
    c = ccrSet(c, CCR_BITS.C, true);
    expect(ccrHas(c, CCR_BITS.C)).toBe(true);
    expect(c & CCR_RESERVED_MASK).toBe(CCR_RESERVED_MASK);

    c = ccrSet(c, CCR_BITS.C, false);
    expect(ccrHas(c, CCR_BITS.C)).toBe(false);
    expect(c & CCR_RESERVED_MASK).toBe(CCR_RESERVED_MASK);
  });

  describe("setNZ8", () => {
    it("sets Z=1 only when result is zero", () => {
      expect(ccrHas(setNZ8(0, 0x00), CCR_BITS.Z)).toBe(true);
      expect(ccrHas(setNZ8(0, 0x01), CCR_BITS.Z)).toBe(false);
      expect(ccrHas(setNZ8(0, 0xFF), CCR_BITS.Z)).toBe(false);
    });

    it("sets N=1 when bit 7 of result is set", () => {
      expect(ccrHas(setNZ8(0, 0x7F), CCR_BITS.N)).toBe(false);
      expect(ccrHas(setNZ8(0, 0x80), CCR_BITS.N)).toBe(true);
      expect(ccrHas(setNZ8(0, 0xFF), CCR_BITS.N)).toBe(true);
    });

    it("masks the result to 8 bits (so 0x100 reads as zero)", () => {
      expect(ccrHas(setNZ8(0, 0x100), CCR_BITS.Z)).toBe(true);
    });
  });

  describe("setNZ16", () => {
    it("sets Z=1 only when 16-bit result is zero", () => {
      expect(ccrHas(setNZ16(0, 0x0000), CCR_BITS.Z)).toBe(true);
      expect(ccrHas(setNZ16(0, 0x0001), CCR_BITS.Z)).toBe(false);
      expect(ccrHas(setNZ16(0, 0xFFFF), CCR_BITS.Z)).toBe(false);
    });

    it("sets N=1 when bit 15 of result is set", () => {
      expect(ccrHas(setNZ16(0, 0x7FFF), CCR_BITS.N)).toBe(false);
      expect(ccrHas(setNZ16(0, 0x8000), CCR_BITS.N)).toBe(true);
    });
  });
});
