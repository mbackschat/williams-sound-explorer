/**
 * Try-list engine filter — pure show/hide logic.
 */
import { describe, expect, it } from "vitest";
import {
  CHIP_FILTER_KEYS,
  allEnabled,
  chipEngineKey,
  isChipVisible,
} from "../src/engine/chipFilter.ts";

describe("chipEngineKey()", () => {
  it("upper-cases a present engine attribute", () => {
    expect(chipEngineKey("gwave")).toBe("GWAVE");
    expect(chipEngineKey("LFSR")).toBe("LFSR");
  });

  it("maps a missing/empty engine to the NONE bucket", () => {
    expect(chipEngineKey(undefined)).toBe("NONE");
    expect(chipEngineKey(null)).toBe("NONE");
    expect(chipEngineKey("")).toBe("NONE");
  });
});

describe("isChipVisible()", () => {
  it("shows everything when all engines are enabled (default)", () => {
    const enabled = allEnabled();
    for (const key of CHIP_FILTER_KEYS) {
      expect(isChipVisible(key, enabled)).toBe(true);
    }
  });

  it("hides a chip whose engine has been toggled off", () => {
    const enabled = allEnabled();
    enabled.delete("SCREAM");
    expect(isChipVisible("SCREAM", enabled)).toBe(false);
    expect(isChipVisible("LFSR", enabled)).toBe(true);
  });

  it("the NONE bucket controls engine-less chips independently", () => {
    const enabled = allEnabled();
    enabled.delete("NONE");
    expect(isChipVisible("NONE", enabled)).toBe(false);
    // canonical engines unaffected
    expect(isChipVisible("ORGAN", enabled)).toBe(true);
  });

  it("hides everything when the set is empty", () => {
    const empty = new Set<string>();
    for (const key of CHIP_FILTER_KEYS) {
      expect(isChipVisible(key, empty)).toBe(false);
    }
  });

  it("an unknown engine key resolves to hidden unless explicitly enabled", () => {
    expect(isChipVisible("MYSTERY", allEnabled())).toBe(false);
  });
});

describe("allEnabled()", () => {
  it("returns an independent copy each call", () => {
    const a = allEnabled();
    a.delete("VARI");
    expect(allEnabled().has("VARI")).toBe(true);
  });

  it("contains exactly the seven filter keys", () => {
    expect(allEnabled().size).toBe(CHIP_FILTER_KEYS.length);
    expect(CHIP_FILTER_KEYS.length).toBe(7);
  });
});
