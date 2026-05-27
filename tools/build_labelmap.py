#!/usr/bin/env python3
"""Parse vasm listing files into per-game label maps consumed by the explorer.

Input:  tools/build/VSNDRM{1,2,3}.lst  (produced by tools/build_roms.sh via `vasm -L`)
Output: explorer/public/data/{defender,stargate,robotron}_labelmap.json

Schema:
    {
      "game":   "defender",
      "source": "VSNDRM1.SRC",
      "labels": [
        { "addr": 0xF801, "label": "SETUP",       "src_line": 170 },
        { "addr": 0xF88C, "label": "LITE",        "src_line": 250 },
        ...
      ]   // sorted ascending by addr; each label's effective lane runs
          // from labels[i].addr up to labels[i+1].addr - 1
    }

A label maps to its source line via a two-step scan:
  1. The "Symbols by name:" footer gives (label -> absolute addr).  Only
     A:HHHH (absolute) entries are taken; E:HHHH (equates / register
     addresses) are skipped.
  2. The body lines (`SS:AAAA HEXBYTES \t LINENO: SOURCE`) give the first
     line number at which each address emits a byte.  We pick the smallest
     line number for each addr.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "tools" / "build"
OUT = REPO / "explorer" / "public" / "data"

GAMES = [
    # (listing stem,        source basename, game key,    rom_lo,   rom_hi)
    ("VSNDRM1",             "VSNDRM1.SRC",   "defender",  0xF800, 0xFFFF),
    ("VSNDRM2",             "VSNDRM2.SRC",   "stargate",  0xF800, 0xFFFF),
    ("VSNDRM3",             "VSNDRM3.SRC",   "robotron",  0xF000, 0xFFFF),
]

# Body line: "SS:AAAA HEXBYTES...\tLINENO: SOURCE"
BODY_RE = re.compile(r"^[0-9A-Fa-f]{2}:([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]+\s*\t\s*(\d+):")
# Symbol table entry: "LABEL    A:AAAA" or "LABEL    E:HHHH" (with whitespace)
SYM_RE = re.compile(r"^(\S+)\s+([AE]):([0-9A-Fa-f]+)\s*$")


def parse_listing(lst_path: Path, rom_lo: int, rom_hi: int) -> tuple[dict[int, int], dict[str, int]]:
    """Return (addr -> first source line) and (label -> addr) from a vasm listing."""
    addr_to_line: dict[int, int] = {}
    label_to_addr: dict[str, int] = {}
    in_symtab = False

    with lst_path.open() as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not in_symtab:
                if line.strip() == "Symbols by name:":
                    in_symtab = True
                    continue
                m = BODY_RE.match(line)
                if m:
                    addr = int(m.group(1), 16)
                    src_line = int(m.group(2))
                    # Keep the earliest line that emits a byte at this address.
                    if addr not in addr_to_line or src_line < addr_to_line[addr]:
                        addr_to_line[addr] = src_line
            else:
                m = SYM_RE.match(line)
                if not m:
                    continue
                label, kind, hex_addr = m.group(1), m.group(2), m.group(3)
                if kind != "A":
                    continue  # skip EQU constants / register addresses
                addr = int(hex_addr, 16)
                if not (rom_lo <= addr <= rom_hi):
                    continue  # skip labels outside ROM (e.g., CKORG below the ROM image)
                label_to_addr[label] = addr

    return addr_to_line, label_to_addr


def build_map(lst_path: Path, source_name: str, game: str, rom_lo: int, rom_hi: int) -> dict:
    addr_to_line, label_to_addr = parse_listing(lst_path, rom_lo, rom_hi)

    labels = []
    for label, addr in label_to_addr.items():
        src_line = addr_to_line.get(addr)
        # For labels that aren't directly at the start of a byte (e.g., aliases
        # whose addr only appears mid-instruction), fall back to the nearest
        # earlier address that does emit a byte — keeps every label resolvable.
        if src_line is None:
            for probe in range(addr, max(rom_lo - 1, addr - 8), -1):
                if probe in addr_to_line:
                    src_line = addr_to_line[probe]
                    break
        labels.append({"addr": addr, "label": label, "src_line": src_line})

    labels.sort(key=lambda e: (e["addr"], e["label"]))
    return {"game": game, "source": source_name, "labels": labels}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for stem, source, game, rom_lo, rom_hi in GAMES:
        lst = BUILD / f"{stem}.lst"
        if not lst.exists():
            # No vasm listing (private source absent, e.g. a clean public CI
            # checkout) — keep the committed {game}_labelmap.json untouched.
            print(f"skip {game}: no {lst.name} — keeping committed {game}_labelmap.json", file=sys.stderr)
            continue
        data = build_map(lst, source, game, rom_lo, rom_hi)
        out_path = OUT / f"{game}_labelmap.json"
        with out_path.open("w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"→ {out_path.relative_to(REPO)}  {len(data['labels'])} labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
