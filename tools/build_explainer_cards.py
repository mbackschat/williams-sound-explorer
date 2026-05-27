#!/usr/bin/env python3
"""
Build per-routine explainer-card JSON files from the single markdown source
at ``docs/explainer_cards.md``.

**The markdown is the source of truth.**  Edit it, then re-run this script
(or ``npm run dev`` / ``npm run build``, which invoke it via ``prepare:public``).
The JSONs in ``explorer/public/data/explainer/`` are derived artefacts —
fast to regenerate, committed so a fresh clone works without running the
tool, but should never be hand-edited.

Source format (one section per routine):

    ## ROUTINE_KEY — Title

    **Engine:** ENGINE · **Games:** game1, game2, game3

    > One- or two-sentence TL;DR.

    ### How it works

    Paragraph 1.

    Paragraph 2.

    ### What to watch

    - bullet 1
    - bullet 2

    ### Key code paths

    - bullet 1

    ### See also

    - [link text](url)

``ROUTINE_KEY`` is the lookup key the runtime uses to fetch a card; it
must match the routine name surfaced by the glossary (after sanitisation —
see ``sanitise_routine``).  Multiple games' commands can map to the same
key when they share a routine (e.g. LITE is shared across all three games).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "explainer_cards.md"
OUT_DIR = ROOT / "explorer" / "public" / "data" / "explainer"


def sanitise_routine(raw: str) -> str:
    """Normalise a glossary `routine` field into a card-file key.

    The glossary uses some compound / decorated forms:
      - "SP1 / CABSHK"  → "SP1"        (take the first segment before `/` or space)
      - "BON2 / BONV"   → "BON2"
      - "PERK$$"        → "PERK"       (strip non-alphanumeric tail)
      - "(silence)"     → ""           (no card)

    The runtime applies the same function before fetching, so a single
    `LITE.json` covers Defender's `$11`, Stargate's `$11`, Robotron's `$11`.
    """
    first = re.split(r"[ /]+", raw.strip(), 1)[0]
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "", first)
    return cleaned.upper()


def parse_cards(text: str) -> list[dict[str, Any]]:
    """Parse the markdown source into a list of card dicts.

    Returns one dict per ``## ROUTINE — title`` section, with the JSON
    fields the runtime expects (``title``, ``engine``, ``games``,
    ``tldr``, ``how``, ``watch``, ``code``, ``see``) plus a ``_key``
    field carrying the routine-key for the output filename.
    """
    # Drop everything before the first level-2 heading (the preamble /
    # author guidance).  Then split into one block per ## section.
    body = re.split(r"^## ", text, flags=re.MULTILINE)
    cards: list[dict[str, Any]] = []
    for section in body[1:]:
        card = parse_section(section)
        if card:
            cards.append(card)
    return cards


def parse_section(section: str) -> dict[str, Any] | None:
    lines = section.split("\n")
    header = lines[0].strip()
    # Header is "ROUTINE_KEY — Rest of title" (em-dash) or "ROUTINE - Rest" (ascii)
    m = re.match(r"^(\S+)\s*[—-]\s*(.+?)\s*$", header)
    if not m:
        print(f"WARN: skipping section with malformed header: {header!r}", file=sys.stderr)
        return None
    key = m.group(1)
    title = f"{key} — {m.group(2)}"
    body = "\n".join(lines[1:])

    # Metadata line:  **Engine:** X · **Games:** Y, Z
    engine = ""
    games: list[str] = []
    meta = re.search(
        r"\*\*Engine:\*\*\s*([^·\n]+?)(?:\s*·\s*\*\*Games:\*\*\s*([^\n]+))?\s*$",
        body,
        flags=re.MULTILINE,
    )
    if meta:
        engine = meta.group(1).strip()
        games_str = (meta.group(2) or "").strip()
        if games_str:
            games = [g.strip() for g in games_str.split(",") if g.strip()]

    # TL;DR — one or more lines starting with `>`, ending at the first blank line.
    tldr_lines: list[str] = []
    collecting = False
    for line in body.split("\n"):
        if line.startswith(">"):
            tldr_lines.append(line.lstrip("> ").rstrip())
            collecting = True
        elif collecting and not line.strip():
            break
    tldr = " ".join(tldr_lines).strip()

    # ### subsections — extract content between this heading and the next ### / end.
    def extract(title_re: str) -> str:
        pat = rf"###\s+{title_re}\s*\n(.*?)(?=\n### |\Z)"
        m = re.search(pat, body, flags=re.DOTALL)
        return (m.group(1).strip() if m else "")

    def bullets(title_re: str) -> list[str]:
        block = extract(title_re)
        return [
            line[2:].strip()
            for line in block.split("\n")
            if line.startswith("- ")
        ]

    how = extract(r"How it works")
    watch = bullets(r"What to watch")
    code = bullets(r"Key code paths?")
    see = bullets(r"See also")

    return {
        "_key": key,
        "title": title,
        "engine": engine,
        "games": games,
        "tldr": tldr,
        "how": how,
        "watch": watch,
        "code": code,
        "see": see,
    }


def main() -> int:
    if not SOURCE.exists():
        print(f"FATAL: source not found: {SOURCE}", file=sys.stderr)
        return 2
    text = SOURCE.read_text(encoding="utf-8")
    cards = parse_cards(text)
    if not cards:
        print(f"FATAL: no cards parsed from {SOURCE}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Wipe existing JSONs so a renamed/deleted card in the .md is reflected.
    for old in OUT_DIR.glob("*.json"):
        old.unlink()

    keys_written = set()
    for c in cards:
        key = sanitise_routine(c.pop("_key"))
        if not key:
            print(f"WARN: empty key after sanitisation, skipping: {c['title']!r}", file=sys.stderr)
            continue
        if key in keys_written:
            print(f"WARN: duplicate key {key!r} — overwriting earlier card", file=sys.stderr)
        keys_written.add(key)
        path = OUT_DIR / f"{key}.json"
        path.write_text(
            json.dumps(c, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    print(f"wrote {len(keys_written)} explainer cards → {OUT_DIR.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
