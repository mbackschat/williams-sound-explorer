#!/usr/bin/env python3
"""
Williams .SRC → vasm-oldstyle preprocessor.

Translates the 1980-1982 Williams sound-ROM source dialect (Motorola
MACRO80 / AS) into a form vasm-oldstyle accepts.  See
`docs/pipeline/vasm_install_notes.md` for the catalogue of dialect mismatches.

Usage:  python3 tools/williams_preproc.py INPUT.SRC > OUTPUT.s68
"""
import re
import sys

# Listing/metadata pseudo-ops we drop by `*`-commenting the line.
SKIP_OPS = {
    "NOGEN", "GEN", "NAM", "OPT", "TTL", "SUBTTL", "PAGE", "SPC",
    "LIB", "LIST", "NOLIST", "MLIST", "NOMLIST", "END",
}

# `EQU *` must become a literal for LOCRAM (used as ORG operand).
ORG_REQUIRED = {"LOCRAM"}

# 6800 mnemonics with no operand (inherent addressing).  When vasm sees one of
# these, any subsequent text on the line should be treated as a comment.
INHERENT = {
    "ABA", "ASLA", "ASLB", "ASRA", "ASRB", "CBA", "CLC", "CLI",
    "CLRA", "CLRB", "CLV", "COMA", "COMB", "DAA", "DECA", "DECB",
    "DES", "DEX", "INCA", "INCB", "INS", "INX", "LSRA", "LSRB",
    "NEGA", "NEGB", "NOP", "PSHA", "PSHB", "PULA", "PULB",
    "ROLA", "ROLB", "RORA", "RORB", "RTI", "RTS", "SBA", "SEC",
    "SEI", "SEV", "SWI", "TAB", "TAP", "TBA", "TPA", "TSTA",
    "TSTB", "TSX", "TXS", "WAI",
}

# Motorola expression operators -> vasm-oldstyle equivalents.
MOTOROLA_OPS = [
    ("!>", ">>"),   # unsigned right shift
    ("!<", "<<"),   # unsigned left shift
    ("!.", "&"),    # bitwise AND
    ("!+", "|"),    # bitwise OR
    ("!^", "^"),    # bitwise XOR
]

# `$` inside / trailing identifiers (Robotron: C$AMP, FREQ1$, PERK$1, PERK$$,
# SND1$, SND1$$) → `_`.  We need `\$+` so consecutive `$$` collapse to `__`
# instead of `_$` (re.sub's lookbehind sees the post-substitution char only on
# the next match if we don't group the whole run).
DOLLAR_IN_IDENT = re.compile(r"(?<=\w)\$+")

# `END` is a vasm directive.  Williams uses it as a label.  Rename to XEND.
END_LABEL = re.compile(r"\bEND\b")

# `,X` / `,Y` with no offset → `0,X` / `0,Y`.
ZERO_OFFSET = re.compile(r"(?<=^),([XY])\b|(?<=[\s(]),([XY])\b")

# Line tokenizer: optional column-1 label, then mnemonic, then optional
# whitespace-separated operand, then optional trailing comment.
#
# The operand sub-pattern accepts either a quoted string (e.g. FCC's
# `"(C)1982 WILLIAMS ELECTRONICS"`) or a normal non-whitespace token.
# Without the quoted alternative, internal spaces in the string would be
# mis-parsed as the comment delimiter and the FCC bytes would be wrong —
# which is exactly the bug that put Robotron's ROM 93% off from the real
# PCB dump.  No escape-sequence support inside strings (none are used in
# the Williams source).
LINE_LABEL = re.compile(
    r"^(?P<label>\S+)\s+(?P<mnem>\S+)"
    r'(?:\s+(?P<op>"[^"]*"|\'[^\']*\'|\S+))?'
    r"(?:\s+(?P<cmt>.+))?\s*$"
)
LINE_NOLABEL = re.compile(
    r"^\s+(?P<mnem>\S+)"
    r'(?:\s+(?P<op>"[^"]*"|\'[^\']*\'|\S+))?'
    r"(?:\s+(?P<cmt>.+))?\s*$"
)

_NUM_RE = re.compile(r"\$([0-9A-Fa-f]+)|([0-9]+)")

# Matches an all-decimal literal that starts with a leading zero, at a token
# boundary (not preceded by an identifier char, `$` hex marker, `'` char-lit
# marker, or another digit).  Used by fix_operand to strip those leading
# zeros before vasm misinterprets them as octal.
LEADING_ZERO_DEC = re.compile(r"(?<![A-Za-z_$'0-9])(0+[0-9]+)\b")


def parse_num(s, syms=None):
    """Parse a decimal/$hex literal, an identifier, or a simple expression.

    Expressions can use +, -, *, /, parens, and symbols defined in `syms`.
    Used to resolve RMB byte-counts like `RMB 2*ECHOS` so we can compute the
    correct zero-page address for each Williams RAM variable.
    """
    s = s.strip()
    m = _NUM_RE.fullmatch(s)
    if m:
        return int(m.group(1), 16) if m.group(1) is not None else int(m.group(2), 10)
    if syms and s in syms:
        return syms[s]
    if syms is None:
        return None
    # Try evaluating as a simple expression.  Convert `$XX` hex literals to
    # Python's `0xXX` syntax, then eval with the symbol table as the globals.
    py = re.sub(r"\$([0-9A-Fa-f]+)", r"0x\1", s)
    # only allow safe characters: digits, hex, identifiers, basic operators
    if not re.fullmatch(r"[\w\s+\-*/()xX&|^<>!.]+", py):
        return None
    try:
        return int(eval(py, {"__builtins__": {}}, syms))
    except Exception:
        return None


def prescan_equ(path):
    """Pre-pass: collect `LABEL EQU <number>` definitions into a symbol table.

    Only literal numeric values are captured.  Used so that subsequent RMB
    declarations with symbolic byte-counts (e.g. `RMB WVELEN`) can have their
    sizes resolved and converted to EQU constants.
    """
    syms = {}
    eq_re = re.compile(r"^\s*(\S+)\s+EQU\s+([^;]+?)(?:\s*;.*)?$", re.IGNORECASE)
    with open(path, "r", encoding="latin-1") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if line.lstrip().startswith("*"):
                continue
            m = eq_re.match(line)
            if not m:
                continue
            label, expr = m.group(1), m.group(2).strip()
            n = parse_num(expr)
            if n is not None:
                syms[label] = n
    return syms


def count_data_bytes(mn, op, syms=None):
    if mn == "RMB":
        return parse_num(op, syms)
    if mn == "FCB":
        return len([p for p in op.split(",") if p.strip()])
    if mn == "FDB":
        return 2 * len([p for p in op.split(",") if p.strip()])
    return None


def fix_operand(s: str) -> str:
    """Apply Motorola-operator and addressing-mode substitutions."""
    for old, new in MOTOROLA_OPS:
        s = s.replace(old, new)
    # zero-offset indexed at start of operand or after `(` / whitespace
    s = ZERO_OFFSET.sub(lambda m: "0," + (m.group(1) or m.group(2)), s)
    if s.startswith(",") and len(s) > 1 and s[1] in ("X", "Y"):
        s = "0" + s
    # Williams shorthand: bare `X` (or `Y`) as operand → `0,X` / `0,Y`.
    # (`LDAA X` meaning "LDAA 0,X" — Motorola indexed-with-zero-offset.)
    if s in ("X", "Y"):
        s = "0," + s
    # Strip leading zeros from decimal literals.  vasm-oldstyle treats any
    # number starting with `0` as octal — silently for valid octal digits,
    # with a "trailing garbage in operand" warning for 8/9.  The Williams
    # source uses leading zeros for visual alignment (e.g. STRT's `09`
    # meaning decimal 9), so we strip them before vasm sees them.  Only
    # touch all-digit tokens (so `$09` hex stays untouched, `0,X` indexed
    # mode is preserved by the comma boundary).
    s = LEADING_ZERO_DEC.sub(lambda m: m.group(1).lstrip("0") or "0", s)
    return s


def emit(label, mn, op, cmt):
    """Compose a vasm-compatible line."""
    parts = [label or ""]
    if mn:
        parts.append(mn)
    if op:
        parts.append(op)
    line = "\t".join(parts)
    if cmt:
        line += "\t; " + cmt
    return line


def transform_file(path):
    # Pre-pass: collect numeric EQU symbols so RMB sizes like `RMB WVELEN`
    # can resolve in pass 2.
    syms = prescan_equ(path)

    # PC tracking + RAM-section emulation.
    #
    # The Williams source describes its zero-page RAM via `ORG 0` then a
    # sequence of `LABEL RMB N` declarations, with multiple `ORG LOCRAM`
    # reset points for overlaid variable blocks (GWAVE, VARI, NOISE, …).
    # vasm-bin treats every ORG as a section and refuses overlap.
    #
    # We sidestep the whole problem: while in the RAM section (after a
    # low-address ORG and before the high-address code ORG), we emit each
    # `LABEL RMB N` as a `LABEL EQU $XX` constant and silently drop the
    # `ORG` directives.  The symbols still resolve to the right zero-page
    # addresses; vasm sees zero overlap.
    pc = None
    pc_known = False
    ram_mode = False     # True while inside the RAM-declaration section

    with open(path, "r", encoding="latin-1") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            nl = "\n"

            # `$` inside identifiers (Robotron) → `_`.  Hex literals untouched.
            line = DOLLAR_IN_IDENT.sub(lambda m: "_" * len(m.group()), line)
            # NOTE: END-label renaming happens AFTER parsing so we can
            # distinguish the END *directive* (drop) from END *label* (rename).

            # Blank or whitespace-only → keep
            if not line.strip():
                sys.stdout.write(line + nl)
                continue

            # Full-line `*` comment → keep
            if line.lstrip().startswith("*"):
                sys.stdout.write(line + nl)
                continue

            # Parse
            has_label = not line[0].isspace() if line else False
            m = (LINE_LABEL if has_label else LINE_NOLABEL).match(line)
            if not m:
                # couldn't parse — keep verbatim
                sys.stdout.write(line + nl)
                continue

            label = m.groupdict().get("label", "") or ""
            mn = m.group("mnem").upper() if m.group("mnem") else ""
            op = m.group("op") or ""
            cmt = m.group("cmt") or ""

            # Restore original case for mnemonic.  We uppered only for table
            # lookups; preserve source case for output.
            mn_out = m.group("mnem") or ""

            # Drop listing / END directives
            if mn in SKIP_OPS:
                sys.stdout.write("* " + line + nl)
                continue

            # Now safe to rename `END` as a label / reference (the END
            # directive has already been dropped above).
            if label == "END":
                label = "XEND"
            if op:
                op = END_LABEL.sub("XEND", op)

            # Inherent-mode mnemonic — operand position is actually the
            # start of the comment.
            if mn in INHERENT and op:
                cmt = (op + (" " + cmt if cmt else "")).strip()
                op = ""

            # ORG handling — also drives RAM-mode entry/exit.
            if mn == "ORG":
                n = parse_num(op)
                if n is not None:
                    pc = n
                    pc_known = True
                    # Enter RAM mode for low ORGs; exit for high ORGs.
                    if n < 0x1000:
                        ram_mode = True
                        # In RAM mode, suppress the ORG entirely; we emit pure
                        # EQU constants instead.
                        if cmt:
                            sys.stdout.write(f"* (suppressed ORG) ; {cmt}{nl}")
                        else:
                            sys.stdout.write(f"* (suppressed ORG){nl}")
                    else:
                        ram_mode = False
                        sys.stdout.write(emit(label, mn_out, op, cmt) + nl)
                    continue
                else:
                    # ORG <symbol> — distinguish ORG LOCRAM (overlay reset,
                    # always low) from ORG to a high-address symbol like
                    # ORG ROM ($F800) or ORG CKORG ($F700) which exits RAM mode.
                    #
                    # LOCRAM may appear as `LOCRAM`, `LOCRAM+1`, `LOCRAM-2`, etc.
                    # All such forms are low-address overlay resets — suppress.
                    op_base = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)", op)
                    base_sym = op_base.group(1) if op_base else ""
                    if ram_mode and base_sym in ORG_REQUIRED:
                        # Parse any `+N` / `-N` offset following the base
                        # symbol.  `ORG LOCRAM+1` (line 154 of VSNDRM3.SRC)
                        # means "reset PC to LOCRAM then add 1"; dropping
                        # the offset shifts every RAM cell downstream by 1
                        # and silently breaks the assembled binary for any
                        # instruction that addresses those cells in direct
                        # mode.  This was the second half of why Robotron's
                        # built ROM differed from the production dump
                        # (the first half was FCC strings; see LINE_LABEL).
                        offset = 0
                        rest = op[len(base_sym):]
                        if rest:
                            n = parse_num(rest.lstrip("+"), syms) if rest.startswith("+") else \
                                (-parse_num(rest.lstrip("-"), syms) if rest.startswith("-") else None)
                            if n is not None:
                                offset = n
                        if cmt:
                            sys.stdout.write(f"* (suppressed ORG {op}) ; {cmt}{nl}")
                        else:
                            sys.stdout.write(f"* (suppressed ORG {op}){nl}")
                        if _locram_pc:
                            pc = _locram_pc[0] + offset
                        continue
                    # Any other `ORG <symbol>` (ORG ROM, ORG CKORG, …) — pass
                    # through so vasm resolves it.  This is also the cue to
                    # leave RAM mode.
                    ram_mode = False
                    pc_known = False
                    sys.stdout.write(emit(label, mn_out, op, cmt) + nl)
                    continue

            # `EQU *` handling
            if mn == "EQU" and op == "*":
                if ram_mode and pc_known and pc is not None:
                    sys.stdout.write(f"{label}\tEQU\t${pc:X}{nl}")
                    if label in ORG_REQUIRED:
                        _locram_pc.clear()
                        _locram_pc.append(pc)
                elif label in ORG_REQUIRED and pc_known and pc is not None:
                    sys.stdout.write(f"{label}\tEQU\t${pc:X}{nl}")
                    _locram_pc.clear()
                    _locram_pc.append(pc)
                else:
                    # Outside RAM mode and not ORG-required → bare label
                    sys.stdout.write(f"{label}{nl}")
                continue

            # In RAM mode, convert LABEL RMB N → LABEL EQU $XX and advance PC.
            if ram_mode and mn == "RMB":
                n = parse_num(op, syms)
                if n is not None and pc_known and pc is not None:
                    if label:
                        sys.stdout.write(f"{label}\tEQU\t${pc:X}{nl}")
                    pc += n
                    continue
                # If we can't parse N, fall through (vasm will likely error)

            # Track PC through data pseudo-ops
            if pc_known and mn in {"RMB", "FCB", "FDB"}:
                delta = count_data_bytes(mn, op, syms)
                if delta is not None and pc is not None:
                    pc += delta
                else:
                    pc_known = False
            elif pc_known and mn and mn != "EQU":
                # any real instruction: we don't track its size
                pc_known = False

            # Apply operand fixes (operators, addressing)
            if op:
                op = fix_operand(op)

            sys.stdout.write(emit(label, mn_out, op, cmt) + nl)


# Module-level holder for the most recent LOCRAM snapshot value.
# Used so that `ORG LOCRAM` can re-snap PC to LOCRAM's value during overlays.
_locram_pc: list = []


def main():
    if len(sys.argv) != 2:
        print("usage: williams_preproc.py INPUT.SRC > OUTPUT.s68", file=sys.stderr)
        sys.exit(2)
    transform_file(sys.argv[1])


if __name__ == "__main__":
    main()
