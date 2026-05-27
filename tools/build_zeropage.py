#!/usr/bin/env python3
"""Build per-game zero-page cell descriptors for the RAM-heatmap tooltip.

Input:
  • research/williams-soundroms/VSNDRM{1,2,3}.SRC  — the RMB declarations
    carry the cell *name*, *size*, inline *description*, and (via the
    `ORG LOCRAM[+N]` overlay structure) which engine reuses each address.
  • tools/build/VSNDRM{1,2,3}.lst                   — vasm has already
    resolved every label to its absolute zero-page address (overlaid cells
    show up as `E:00AA`).  We only trust the listing for the address; cell
    *membership* is driven by the `.SRC` (so EQU constants like FREQ / WVELEN,
    which also appear as `E:` entries, never leak in as fake cells).

Output: explorer/public/data/{defender,stargate,robotron}_zeropage.json

Why overlays matter: the Williams sound board only has 128 bytes of zero
page, so every engine `ORG LOCRAM`-overlays its working set on the same
addresses.  A single cell (e.g. $13) is GECHO for GWAVE, LOPER for VARI,
DECAY for the LFSR noise engine, …  The heatmap tooltip resolves the right
meaning from the *active* engine in the snapshot, falling back to listing
every interpretation.

Schema:
    {
      "game": "defender",
      "source": "VSNDRM1.SRC",
      "cells": [
        {"addr": 4,  "span": 1,  "name": "BG1FLG", "desc": "Background sound 1",
         "engine": null, "region": "global"},
        {"addr": 19, "span": 1,  "name": "GECHO",  "desc": "Echo flag",
         "engine": "gwave", "region": "engine"},
        {"addr": 19, "span": 1,  "name": "LOPER",  "desc": "Lo period",
         "engine": "vari",  "region": "engine"},
        ...
      ]   // one entry per RMB label; the runtime expands `span` across
          // [addr, addr+span) and indexes by address.
    }

`region`:  "global"  — pre-LOCRAM cell, single fixed meaning.
           "engine"  — overlay cell owned by one of the 6 canonical engines
                       (engine field set; the tooltip can auto-pick it).
           "overlay" — overlay cell from a block with no canonical engine
                       (PLAY / SING / sweep variants …); engine field null.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC_DIR = REPO / "research" / "williams-soundroms"
BUILD = REPO / "tools" / "build"
OUT = REPO / "explorer" / "public" / "data"

GAMES = [
    ("VSNDRM1", "defender"),
    ("VSNDRM2", "stargate"),
    ("VSNDRM3", "robotron"),
]

# Heatmap only renders the first 128 bytes of zero page.
ZP_HI = 0x7F

# Disjoint name signatures — a `ORG LOCRAM` block is tagged with the engine
# whose signature labels it contains.  Aligned with engineState.ts so the
# runtime's active-engine slot maps onto the right overlay block.
ENGINE_SIGS: dict[str, set[str]] = {
    "gwave": {"GECHO", "GWTAB", "GWFRM", "GPER"},
    "vari": {"LOPER", "HIPER", "LOCNT", "HICNT"},
    "lfsr": {"DECAY", "CYCNT", "LFREQ", "NFFLG"},
    "fnoise": {"FMAX", "FHI", "SAMPC", "FDFLG"},
    "scream": {"STABLE"},
    "organ": {"DUR", "OSCIL", "RDELAY"},
}

# `LABEL\tRMB\tSIZE\t[COMMENT]`
RMB_RE = re.compile(r"^([A-Za-z_$][\w$]*)\t+RMB\t+(\S+)(?:\t+(.*))?$")
# `\tORG\tTARGET` (leading label optional, but RAM ORGs have none here)
ORG_RE = re.compile(r"^\s*ORG\s+(\S+)", re.IGNORECASE)
# `LABEL\tEQU\tEXPR`
EQU_RE = re.compile(r"^([A-Za-z_$][\w$]*)\t+EQU\t+(\S+)")
# Listing symbol-table entry: `LABEL    A:HHHH` or `LABEL    E:HHHH`
SYM_RE = re.compile(r"^(\S+)\s+[AE]:([0-9A-Fa-f]+)\s*$")


def listing_addrs(lst_path: Path) -> dict[str, int]:
    """label -> absolute address, from the listing's symbol table."""
    out: dict[str, int] = {}
    in_symtab = False
    for raw in lst_path.read_text().splitlines():
        if not in_symtab:
            if raw.strip() == "Symbols by name:":
                in_symtab = True
            continue
        m = SYM_RE.match(raw)
        if m:
            out[m.group(1)] = int(m.group(2), 16)
    return out


def build_equ_ints(src_lines: list[str]) -> dict[str, int]:
    """Collect simple integer EQUs (used to evaluate RMB sizes like WVELEN)."""
    equ: dict[str, int] = {}
    for line in src_lines:
        m = EQU_RE.match(line)
        if m and m.group(2).isdigit():
            equ[m.group(1)] = int(m.group(2))
    return equ


def eval_size(expr: str, equ: dict[str, int]) -> int:
    """Evaluate an RMB size operand: int, EQU name, or `A*B`."""
    expr = expr.strip()
    if expr.isdigit():
        return int(expr)
    if expr in equ:
        return equ[expr]
    if "*" in expr:
        prod = 1
        for tok in expr.split("*"):
            tok = tok.strip()
            prod *= int(tok) if tok.isdigit() else equ.get(tok, 1)
        return prod
    return 1  # unknown form — treat as a single byte


def sentence_case(s: str) -> str:
    s = s.strip().rstrip(".")
    if not s:
        return ""
    return s[0].upper() + s[1:].lower()


def build_game(stem: str, game: str) -> dict:
    src_path = SRC_DIR / f"{stem}.SRC"
    lst_path = BUILD / f"{stem}.lst"
    src_lines = src_path.read_text().splitlines()
    equ = build_equ_ints(src_lines)
    addrs = listing_addrs(lst_path)

    # Walk the RAM declarations, partitioning into a "global" prefix and one
    # group per `ORG LOCRAM[+N]`.  Non-LOCRAM ORGs (CKORG / ROM) end the RAM.
    groups: list[list[dict]] = []
    current: list[dict] | None = None  # None until first RMB; the global group
    region = "global"
    started = False  # have we hit `ORG 0` / the first RMB yet?

    global_group: list[dict] = []
    for line in src_lines:
        org = ORG_RE.match(line)
        if org:
            target = org.group(1).upper()
            if target.startswith("LOCRAM"):
                region = "engine"  # provisional; finalised by signature
                current = []
                groups.append(current)
            elif target == "0":
                started = True
            else:
                # CKORG / ROM etc. — past zero-page RAM; stop collecting.
                current = None
                region = "done"
            continue
        # `LOCRAM\tEQU\t*` opens the first overlay block in VSNDRM1.
        if re.match(r"^LOCRAM\t+EQU", line):
            region = "engine"
            current = []
            groups.append(current)
            continue
        m = RMB_RE.match(line)
        if not m or region == "done":
            continue
        started = True
        name, size_expr, comment = m.group(1), m.group(2), m.group(3) or ""
        cell = {
            "name": name,
            "span": eval_size(size_expr, equ),
            "desc": sentence_case(comment),
        }
        (current if current is not None else global_group).append(cell)

    cells: list[dict] = []

    def emit(cell: dict, engine: str | None, region_tag: str) -> None:
        addr = addrs.get(cell["name"])
        if addr is None or addr > ZP_HI:
            return
        cells.append({
            "addr": addr,
            "span": cell["span"],
            "name": cell["name"],
            "desc": cell["desc"],
            "engine": engine,
            "region": region_tag,
        })

    for cell in global_group:
        emit(cell, None, "global")

    for group in groups:
        names = {c["name"] for c in group}
        engine = next(
            (eng for eng, sig in ENGINE_SIGS.items() if sig & names),
            None,
        )
        region_tag = "engine" if engine else "overlay"
        for cell in group:
            emit(cell, engine, region_tag)

    cells.sort(key=lambda c: (c["addr"], c["engine"] or "", c["name"]))
    return {"game": game, "source": f"{stem}.SRC", "cells": cells}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for stem, game in GAMES:
        lst = BUILD / f"{stem}.lst"
        src = SRC_DIR / f"{stem}.SRC"
        if not lst.exists() or not src.exists():
            # No listing / no Williams source (private, absent in a clean
            # public CI checkout) — keep the committed {game}_zeropage.json.
            print(f"skip {game}: source/listing absent — keeping committed {game}_zeropage.json", file=sys.stderr)
            continue
        data = build_game(stem, game)
        out_path = OUT / f"{game}_zeropage.json"
        with out_path.open("w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        engines = sorted({c["engine"] for c in data["cells"] if c["engine"]})
        print(f"→ {out_path.relative_to(REPO)}  {len(data['cells'])} cells  engines={engines}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
