/**
 * Zero-page descriptor tests (RAM-heatmap tooltip).
 *
 * Two layers, mirroring labelmap.test.ts:
 *   1. The generated `{game}_zeropage.json` files (output of
 *      `tools/build_zeropage.py`) — known cells exist at the right addresses,
 *      overlays carry every engine, addresses stay inside zero page.
 *   2. The pure `indexCells()` / `describeCell()` resolver — span expansion,
 *      active-engine disambiguation, offset naming, and miss handling.
 *
 * The JSON block is skipped (it.runIf) if the files haven't been built yet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import {
  describeCell,
  emptyZeroPageMap,
  indexCells,
  type ZeroPageCell,
  type ZeroPageMap,
} from "../src/web/zeroPageMap.ts";

const REPO = pathResolve(__dirname, "..");

function readZp(game: string): { game: string; source: string; cells: ZeroPageCell[] } | null {
  const p = pathResolve(REPO, `public/data/${game}_zeropage.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("Generated zero-page JSON files", () => {
  const defender = readZp("defender");
  const robotron = readZp("robotron");
  const ready = defender && robotron;

  it.runIf(ready)("defender has the expected global flags", () => {
    const byName = new Map(defender!.cells.map((c) => [c.name, c]));
    expect(byName.get("BG1FLG")?.addr).toBe(0x04);
    expect(byName.get("BG1FLG")?.region).toBe("global");
    expect(byName.get("ORGFLG")?.addr).toBe(0x08);
    // Random seed pair backing the LFSR engine lives in the global prefix.
    expect(byName.get("HI")?.addr).toBe(0x09);
    expect(byName.get("LO")?.addr).toBe(0x0A);
  });

  it.runIf(ready)("the overlaid $13 cell carries all six engine interpretations", () => {
    const at13 = defender!.cells.filter((c) => c.addr === 0x13);
    const engines = new Set(at13.map((c) => c.engine));
    for (const e of ["gwave", "vari", "lfsr", "fnoise", "scream", "organ"]) {
      expect(engines.has(e as ZeroPageCell["engine"])).toBe(true);
    }
    // GECHO (GWAVE) is one of them, with a human description.
    const gecho = at13.find((c) => c.name === "GECHO");
    expect(gecho?.engine).toBe("gwave");
    expect(gecho?.desc).toBe("Echo flag");
  });

  it.runIf(ready)("multi-byte cells record their span", () => {
    const byName = new Map(defender!.cells.map((c) => [c.name, c]));
    expect(byName.get("GWTAB")?.span).toBe(72); // WVELEN wavetable
    expect(byName.get("RDELAY")?.span).toBe(60);
    expect(byName.get("STABLE")?.span).toBe(8); // 2*ECHOS
  });

  it.runIf(ready)("every cell sits inside zero page with a positive span", () => {
    for (const file of [defender!, robotron!]) {
      for (const c of file.cells) {
        expect(c.addr).toBeGreaterThanOrEqual(0);
        expect(c.addr).toBeLessThanOrEqual(0x7F);
        expect(c.span).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it.runIf(ready)("records the source filename per game", () => {
    expect(defender!.source).toBe("VSNDRM1.SRC");
    expect(robotron!.source).toBe("VSNDRM3.SRC");
  });
});

describe("indexCells() span expansion", () => {
  it("expands a multi-byte cell across every address it covers", () => {
    const idx = indexCells([
      { addr: 0x24, span: 3, name: "GWTAB", desc: "Wave table", engine: "gwave", region: "engine" },
    ]);
    expect(idx.byAddr.get(0x24)?.[0]?.offset).toBe(0);
    expect(idx.byAddr.get(0x25)?.[0]?.offset).toBe(1);
    expect(idx.byAddr.get(0x26)?.[0]?.offset).toBe(2);
    expect(idx.byAddr.get(0x27)).toBeUndefined();
  });

  it("stacks every interpretation of an overlaid address", () => {
    const idx = indexCells([
      { addr: 0x13, span: 1, name: "GECHO", desc: "Echo flag", engine: "gwave", region: "engine" },
      { addr: 0x13, span: 1, name: "LOPER", desc: "Lo period", engine: "vari", region: "engine" },
    ]);
    expect(idx.byAddr.get(0x13)?.length).toBe(2);
  });
});

describe("describeCell() resolution", () => {
  function fixture(): ZeroPageMap {
    const m = emptyZeroPageMap();
    m.games.defender = indexCells([
      { addr: 0x04, span: 1, name: "BG1FLG", desc: "Background sound 1", engine: null, region: "global" },
      { addr: 0x13, span: 1, name: "GECHO", desc: "Echo flag", engine: "gwave", region: "engine" },
      { addr: 0x13, span: 1, name: "LOPER", desc: "Lo period", engine: "vari", region: "engine" },
      { addr: 0x24, span: 72, name: "GWTAB", desc: "Wave table", engine: "gwave", region: "engine" },
    ]);
    return m;
  }

  it("returns undefined for an address with no declared cell", () => {
    expect(describeCell(fixture(), "defender", 0x7E, "")).toBeUndefined();
  });

  it("returns undefined for a game with no map loaded", () => {
    expect(describeCell(fixture(), "robotron", 0x13, "")).toBeUndefined();
  });

  it("resolves a unique global cell directly", () => {
    const r = describeCell(fixture(), "defender", 0x04, "");
    expect(r?.name).toBe("BG1FLG");
    expect(r?.region).toBe("global");
    expect(r?.overlapCount).toBe(1);
  });

  it("picks the active engine's interpretation of an overlaid cell", () => {
    expect(describeCell(fixture(), "defender", 0x13, "gwave")?.name).toBe("GECHO");
    expect(describeCell(fixture(), "defender", 0x13, "vari")?.name).toBe("LOPER");
    // Either way the overlap depth is reported.
    expect(describeCell(fixture(), "defender", 0x13, "gwave")?.overlapCount).toBe(2);
  });

  it("falls back to an engine-region entry when no engine is active", () => {
    const r = describeCell(fixture(), "defender", 0x13, "");
    expect(r?.region).toBe("engine");
    expect(["GECHO", "LOPER"]).toContain(r?.name);
  });

  it("ignores an active engine that doesn't own the cell", () => {
    // organ isn't one of $13's interpretations here → still resolves to one.
    const r = describeCell(fixture(), "defender", 0x13, "organ");
    expect(["GECHO", "LOPER"]).toContain(r?.name);
  });

  it("names an interior byte of a span with +offset", () => {
    expect(describeCell(fixture(), "defender", 0x24, "gwave")?.name).toBe("GWTAB");
    expect(describeCell(fixture(), "defender", 0x30, "gwave")?.name).toBe(`GWTAB+${0x30 - 0x24}`);
  });
});
