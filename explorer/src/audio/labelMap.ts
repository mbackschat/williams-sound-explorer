/**
 * Label-map loader + resolver (Step 3.4).
 *
 * `tools/build_labelmap.py` parses the vasm listing of each sound ROM into a
 * sorted-by-addr list of `{addr, label, src_line}` triples shipped at
 * `/data/{game}_labelmap.json`.  This module:
 *
 *   1. Fetches each game's map (tolerant of missing files — yields an empty
 *      resolver so the explorer stays usable even if generation skipped).
 *   2. Builds a binary-search resolver: `resolve(pc) → entry | null`.
 *
 * Resolution semantics: a label's effective range runs from `labels[i].addr`
 * up to `labels[i+1].addr - 1`, so any PC inside a routine resolves to the
 * routine's entry point.  PCs below the first label or above ROM-end return
 * `null` (the swimlane shows them as "unmapped").
 *
 * The resolver also exposes `offsetOf(pc)` (= `pc - entry.addr`), which lets
 * tooltips render "LITEN+7" style displacements.
 */
import type { GameKind } from "../board/soundboard.ts";

export interface LabelEntry {
  /** ROM address where the label starts. */
  addr: number;
  /** Label name as it appears in the original `.SRC` file. */
  label: string;
  /** Line number in the `.SRC` file (1-based) where the label is defined. */
  src_line: number | null;
}

export interface ResolvedLabel extends LabelEntry {
  /** PC offset within the label's range (`pc - addr`). */
  offset: number;
}

export interface LabelMap {
  /** Per-game sorted (ascending addr) label arrays. */
  defender: LabelEntry[];
  stargate: LabelEntry[];
  robotron: LabelEntry[];
  /** Source filename per game (e.g. "VSNDRM1.SRC") — used in tooltips. */
  sources: Record<GameKind, string>;
}

interface RawFile {
  game: string;
  source: string;
  labels: LabelEntry[];
}

const DEFAULT_SOURCES: Record<GameKind, string> = {
  defender: "VSNDRM1.SRC",
  stargate: "VSNDRM2.SRC",
  robotron: "VSNDRM3.SRC",
};

/**
 * Fetch every game's label map in parallel.  Each missing/malformed file
 * silently degrades to an empty list — the explorer remains functional.
 */
export async function loadLabelMaps(
  baseUrl = `${import.meta.env.BASE_URL}data`,
): Promise<LabelMap> {
  const games: GameKind[] = ["defender", "stargate", "robotron"];
  const results = await Promise.all(
    games.map(async (g) => {
      try {
        const res = await fetch(`${baseUrl}/${g}_labelmap.json`);
        if (!res.ok) return null;
        return (await res.json()) as RawFile;
      } catch {
        return null;
      }
    }),
  );
  const out = emptyLabelMap();
  for (let i = 0; i < games.length; i++) {
    const game = games[i]!;
    const raw = results[i];
    if (!raw || !Array.isArray(raw.labels)) continue;
    // Trust the file is sorted (Python script enforces it) but re-sort
    // defensively — search relies on monotonic order.
    const labels = raw.labels.slice().sort((a, b) => a.addr - b.addr);
    out[game] = labels;
    if (raw.source) out.sources[game] = raw.source;
  }
  return out;
}

export function emptyLabelMap(): LabelMap {
  return {
    defender: [],
    stargate: [],
    robotron: [],
    sources: { ...DEFAULT_SOURCES },
  };
}

/**
 * Resolve a PC to the label whose range contains it.  Pure binary search
 * over the per-game sorted-by-addr list.  Returns null when no label is
 * defined at or before the PC (e.g., PC = 0x0000 before any code ran).
 */
export function resolve(
  map: LabelMap,
  game: GameKind,
  pc: number,
): ResolvedLabel | null {
  const labels = map[game];
  if (!labels.length) return null;
  // Find the largest i with labels[i].addr <= pc.
  let lo = 0;
  let hi = labels.length - 1;
  if (pc < labels[0]!.addr) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (labels[mid]!.addr <= pc) lo = mid;
    else hi = mid - 1;
  }
  const entry = labels[lo]!;
  return { ...entry, offset: pc - entry.addr };
}

/** Human-readable "LITEN+7" style tag.  Empty offset omits the `+0`. */
export function formatLabel(entry: ResolvedLabel): string {
  return entry.offset === 0 ? entry.label : `${entry.label}+${entry.offset}`;
}
