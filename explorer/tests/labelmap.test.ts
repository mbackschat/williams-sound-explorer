/**
 * Label map tests (Step 3.4).
 *
 * Two layers:
 *   1. The generated `{game}_labelmap.json` files (output of
 *      `tools/build_labelmap.py`) — verify known labels exist at the
 *      expected addresses and the array is sorted by addr.
 *   2. The TypeScript `resolve()` binary search — covering hits, boundary
 *      conditions (before-first label, exactly-at, between labels, after
 *      last), and empty maps.
 *
 * If the generated JSON files are missing, the first describe-block is
 * skipped (pre-build state) but the resolver tests still run against
 * hand-rolled fixtures.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import {
  loadLabelMaps,
  emptyLabelMap,
  resolve,
  formatLabel,
  type LabelMap,
  type LabelEntry,
} from "../src/web/labelMap.ts";

const REPO = pathResolve(__dirname, "..");

function readMap(game: string): { game: string; source: string; labels: LabelEntry[] } | null {
  const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("Generated label-map JSON files", () => {
  const defender = readMap("defender");
  const stargate = readMap("stargate");
  const robotron = readMap("robotron");

  const ready = defender && stargate && robotron;

  it.runIf(ready)("defender includes LITE/LITEN/SETUP at the expected addresses", () => {
    const byLabel = new Map(defender!.labels.map((e) => [e.label, e]));
    expect(byLabel.get("SETUP")?.addr).toBe(0xF801);
    expect(byLabel.get("LITE")?.addr).toBe(0xF88C);
    expect(byLabel.get("LITEN")?.addr).toBe(0xF89E);
    // IRQ handler routine + IRQ vector both exist.
    expect(byLabel.get("IRQ")?.addr).toBe(0xFCB6);
    expect(byLabel.get("IRQV")?.addr).toBe(0xFFF8);
    // Source-line annotations are populated.
    expect(byLabel.get("LITE")?.src_line).toBeTypeOf("number");
  });

  it.runIf(ready)("stargate labels live inside 0xF800..0xFFFF", () => {
    for (const e of stargate!.labels) {
      expect(e.addr).toBeGreaterThanOrEqual(0xF800);
      expect(e.addr).toBeLessThanOrEqual(0xFFFF);
    }
    // SETUP is the reset target for Stargate too.
    const byLabel = new Map(stargate!.labels.map((e) => [e.label, e]));
    expect(byLabel.get("SETUP")?.addr).toBe(0xF801);
  });

  it.runIf(ready)("robotron labels live inside 0xF000..0xFFFF", () => {
    for (const e of robotron!.labels) {
      expect(e.addr).toBeGreaterThanOrEqual(0xF000);
      expect(e.addr).toBeLessThanOrEqual(0xFFFF);
    }
  });

  it.runIf(ready)("every game's label array is sorted ascending by addr", () => {
    for (const m of [defender!, stargate!, robotron!]) {
      for (let i = 1; i < m.labels.length; i++) {
        expect(m.labels[i]!.addr).toBeGreaterThanOrEqual(m.labels[i - 1]!.addr);
      }
    }
  });

  it.runIf(ready)("each game records its source filename", () => {
    expect(defender!.source).toBe("VSNDRM1.SRC");
    expect(stargate!.source).toBe("VSNDRM2.SRC");
    expect(robotron!.source).toBe("VSNDRM3.SRC");
  });

  it.runIf(ready)("loadLabelMaps via fetch shim accepts the parsed files", async () => {
    // Stand in for fetch — return the on-disk JSON.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const m = url.match(/(defender|stargate|robotron)_labelmap\.json$/);
      if (!m) return { ok: false } as unknown as Response;
      const game = m[1]!;
      const p = pathResolve(REPO, `public/data/${game}_labelmap.json`);
      const text = readFileSync(p, "utf8");
      return {
        ok: true,
        json: async () => JSON.parse(text),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const map = await loadLabelMaps();
      expect(map.defender.length).toBeGreaterThan(50);
      expect(map.sources.defender).toBe("VSNDRM1.SRC");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("resolve() binary search", () => {
  function fixture(): LabelMap {
    const m = emptyLabelMap();
    m.defender = [
      { addr: 0xF800, label: "RESET", src_line: 10 },
      { addr: 0xF801, label: "SETUP", src_line: 12 },
      { addr: 0xF88C, label: "LITE", src_line: 250 },
      { addr: 0xF89E, label: "LITEN", src_line: 265 },
      { addr: 0xFCB6, label: "IRQ", src_line: 909 },
    ];
    return m;
  }

  it("returns null for PC below the first label", () => {
    const m = fixture();
    expect(resolve(m, "defender", 0x0000)).toBeNull();
    expect(resolve(m, "defender", 0xF7FF)).toBeNull();
  });

  it("returns null on empty map", () => {
    const empty = emptyLabelMap();
    expect(resolve(empty, "defender", 0xF801)).toBeNull();
  });

  it("resolves a PC exactly at a label's addr with offset 0", () => {
    const m = fixture();
    const r = resolve(m, "defender", 0xF88C);
    expect(r?.label).toBe("LITE");
    expect(r?.offset).toBe(0);
    expect(r?.src_line).toBe(250);
  });

  it("resolves a PC mid-routine to the enclosing label", () => {
    const m = fixture();
    const r = resolve(m, "defender", 0xF8A0);
    expect(r?.label).toBe("LITEN");
    expect(r?.offset).toBe(0xF8A0 - 0xF89E);
  });

  it("resolves PCs above the last label to that last label", () => {
    const m = fixture();
    const r = resolve(m, "defender", 0xFFFF);
    expect(r?.label).toBe("IRQ");
    expect(r?.offset).toBe(0xFFFF - 0xFCB6);
  });

  it("returns null for an unfamiliar game with no labels", () => {
    const m = fixture();
    expect(resolve(m, "stargate", 0xF801)).toBeNull();
  });

  it("formatLabel collapses offset 0 to just the label", () => {
    expect(formatLabel({ addr: 0xF89E, label: "LITEN", src_line: 1, offset: 0 })).toBe("LITEN");
    expect(formatLabel({ addr: 0xF89E, label: "LITEN", src_line: 1, offset: 7 })).toBe("LITEN+7");
  });
});

describe("loadLabelMaps — failure modes", () => {
  it("degrades gracefully when every fetch fails", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false } as unknown as Response)) as typeof fetch;
    try {
      const map = await loadLabelMaps();
      expect(map.defender).toEqual([]);
      expect(map.stargate).toEqual([]);
      expect(map.robotron).toEqual([]);
      expect(map.sources.defender).toBe("VSNDRM1.SRC"); // fallback default
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("survives malformed JSON", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response)) as typeof fetch;
    try {
      const map = await loadLabelMaps();
      expect(map.defender).toEqual([]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
