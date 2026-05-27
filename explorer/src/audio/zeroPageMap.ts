/**
 * Zero-page cell descriptors for the RAM-heatmap tooltip.
 *
 * Data comes from `tools/build_zeropage.py` → `public/data/{game}_zeropage.json`
 * (one entry per RMB-declared cell, carrying name / description / span / the
 * engine that overlays it).  Because every engine `ORG LOCRAM`-overlays its
 * working set onto the same addresses, a single cell can have up to six
 * meanings — `describeCell()` resolves the right one from the active engine.
 */
import type { GameKind } from "../board/soundboard.ts";

export type EngineTag = "lfsr" | "vari" | "gwave" | "fnoise" | "scream" | "organ";

/** One RMB-declared zero-page cell. */
export interface ZeroPageCell {
  addr: number;
  span: number;
  name: string;
  desc: string;
  engine: EngineTag | null;
  region: "global" | "engine" | "overlay";
}

/** Per-game index: address → the cell entries that cover it (with byte offset). */
interface GameZeroPage {
  byAddr: Map<number, { cell: ZeroPageCell; offset: number }[]>;
}

export interface ZeroPageMap {
  games: Record<GameKind, GameZeroPage>;
}

/** What the tooltip needs to render one cell's meaning. */
export interface ResolvedCell {
  /** Cell name, with `+offset` appended for an interior byte of a span. */
  name: string;
  desc: string;
  engine: EngineTag | null;
  region: ZeroPageCell["region"];
  /** Number of distinct interpretations sharing this address (overlay depth). */
  overlapCount: number;
}

interface RawFile {
  game: string;
  source: string;
  cells: ZeroPageCell[];
}

function emptyGame(): GameZeroPage {
  return { byAddr: new Map() };
}

export function emptyZeroPageMap(): ZeroPageMap {
  return {
    games: {
      defender: emptyGame(),
      stargate: emptyGame(),
      robotron: emptyGame(),
    },
  };
}

/** Expand each cell across `[addr, addr+span)` into the per-address index. */
export function indexCells(cells: ZeroPageCell[]): GameZeroPage {
  const byAddr = new Map<number, { cell: ZeroPageCell; offset: number }[]>();
  for (const cell of cells) {
    const span = Math.max(1, cell.span | 0);
    for (let offset = 0; offset < span; offset++) {
      const a = cell.addr + offset;
      let bucket = byAddr.get(a);
      if (!bucket) {
        bucket = [];
        byAddr.set(a, bucket);
      }
      bucket.push({ cell, offset });
    }
  }
  return { byAddr };
}

/**
 * Fetch every game's zero-page map in parallel.  A missing/malformed file
 * degrades to an empty index — the heatmap simply shows no cell name.
 */
export async function loadZeroPageMaps(baseUrl = `${import.meta.env.BASE_URL}data`): Promise<ZeroPageMap> {
  const games: GameKind[] = ["defender", "stargate", "robotron"];
  const results = await Promise.all(
    games.map(async (g) => {
      try {
        const res = await fetch(`${baseUrl}/${g}_zeropage.json`);
        if (!res.ok) return null;
        return (await res.json()) as RawFile;
      } catch {
        return null;
      }
    }),
  );
  const out = emptyZeroPageMap();
  for (let i = 0; i < games.length; i++) {
    const raw = results[i];
    if (!raw || !Array.isArray(raw.cells)) continue;
    out.games[games[i]!] = indexCells(raw.cells);
  }
  return out;
}

/**
 * Resolve `addr` to a single best interpretation for `game`, biased toward
 * `activeEngine` when the cell is overlaid.  Returns undefined for addresses
 * with no declared cell.
 *
 * Priority: active-engine match → a canonical-engine entry → first entry.
 */
export function describeCell(
  map: ZeroPageMap,
  game: GameKind,
  addr: number,
  activeEngine: EngineTag | "",
): ResolvedCell | undefined {
  const entries = map.games[game]?.byAddr.get(addr);
  if (!entries || entries.length === 0) return undefined;

  let chosen = entries[0]!;
  if (entries.length > 1) {
    const byActive = activeEngine
      ? entries.find((e) => e.cell.engine === activeEngine)
      : undefined;
    const byEngineRegion = entries.find((e) => e.cell.region === "engine");
    chosen = byActive ?? byEngineRegion ?? entries[0]!;
  }

  const { cell, offset } = chosen;
  return {
    name: offset > 0 ? `${cell.name}+${offset}` : cell.name,
    desc: cell.desc,
    engine: cell.engine,
    region: cell.region,
    overlapCount: entries.length,
  };
}
