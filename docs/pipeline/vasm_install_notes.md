# vasm Install + Williams Sources — Complete Build Notes

> Record of building **vasm 2.0e** from source on macOS, then iteratively bridging the 1980–1982 Williams Motorola-dialect sources to vasm-oldstyle via a Python preprocessor and an output-format workaround. **All three sound ROMs (Defender, Stargate, Robotron) now assemble cleanly** with valid vectors via `tools/build_roms.sh`.

## Result summary

| ROM | File | Size | Vectors | Status |
|-----|------|-----:|---|---|
| Defender (VSNDRM1) | `tools/defender_sound.bin` | 2048 B | IRQ=`$FCB6` RESET=`$F801` | 2-byte source-rev delta vs MAME |
| Stargate / Defender II (VSNDRM2) | `tools/stargate_sound.bin` | 2048 B | IRQ=`$FC8C` RESET=`$F801` | ✓ **byte-identical to MAME** |
| Robotron (VSNDRM3) | `tools/robotron_sound.bin` | 4096 B | IRQ=`$FB11` RESET=`$F01D` | ✓ **byte-identical to MAME** |

Single command rebuilds all three: `tools/build_roms.sh`.  Verify against MAME's production ROM dumps with `tools/verify_roms.sh`.

Defender's 2-byte delta lives in two locations: the checksum byte at `$F800` (ours `$FE`, ROM `$FF`) and one byte inside `ORGTAB` at `$FDB6` (ours `$8A`, ROM `$8B`).  Both come from the cloned `VSNDRM1.SRC` being a slightly different revision than the ROM that physically shipped — not a tooling bug.  Documented as a known caveat; the assembler is otherwise correct (Stargate + Robotron prove this).

### Root-cause analysis of the 2-byte delta

A scan of all FDB / FCB expressions across the three sources for values that would differ between integer and floating-point evaluation found four such expressions: one in Defender (`(TFS/PHANC/1*1)*2` at line 1023, lands at ROM `$FDB6`), and two each in Stargate and Robotron (FIFTH + NINTH tune-duration arithmetic).  But Stargate's and Robotron's assembled bins are byte-identical to MAME's production ROM dumps under **integer** math.  So the production assembler used integer math, not float.  The Defender `$FDB6` byte (`$8B` in production vs `$8A` ours) is therefore **not** explained by a different assembler tool — it's a post-assembly hand-patch.

The checksum byte at `$F800` has no balance relationship to the rest of the ROM (Defender's full ROM sums mod 256 to non-zero values in both ours and MAME).  So it's also a literal source-level value, not derived.

Conclusion: the production Defender ROM has **two hand-patched bytes** versus the cloned `VSNDRM1.SRC`.  Most plausible story — Sam Dicker assembled the ROM, listened to the PHANTOM organ tune, decided FS1's duration was one sample too short, manually nudged `$FDB6` from `$8A` to `$8B`, and updated the checksum byte accordingly.  The cloned source preserves the *pre-patch* revision.

If a byte-identical Defender build were ever needed (it isn't — the explorer's tests + emulator validate against MAME-equivalent Stargate + Robotron + ear-check on Defender), a `tools/defender_patches` lookup table could apply the two known production bytes post-assembly.  Not implemented; the cloned source is treated as authoritative for "what the developer wrote" while the production ROM is authoritative for "what shipped."

## Tooling versions

- **vasm 2.0e** (Volker Barthelmann, 2002-2026)
- **vasm 6800/6801/68hc11 backend 0.5** (Esben Norby, 2013-2021)
- **vasm oldstyle syntax 0.22** (Frank Wille, 2002-2026)
- **vasm binary output 2.3e**

Source tarball: <http://sun.hasenbraten.de/vasm/release/vasm.tar.gz> (598 KB, dated 2026-02-25).

## Install on macOS

No Homebrew formula exists. Build from source:

```bash
mkdir -p tools/vasm-build && cd tools/vasm-build
curl -fsSL -o vasm.tar.gz http://sun.hasenbraten.de/vasm/release/vasm.tar.gz
tar xzf vasm.tar.gz && cd vasm
make CPU=6800 SYNTAX=oldstyle           # produces vasm6800_oldstyle (~5 sec)
cp vasm6800_oldstyle ../../             # install into project's tools/
```

Tooling needed: Apple Clang from Xcode CLT, GNU Make 3.81+. Build emits a few stylistic warnings in `vobjdump.c` (irrelevant to the assembler).

`WebFetch` cannot reach `sun.hasenbraten.de` because it forces HTTPS upgrade and the site is HTTP-only — use `curl` instead.

## The complete Williams → vasm dialect bridge

The Williams sources were written for Motorola's 1980-era MACRO80 / AS assembler. vasm-oldstyle handles most of the syntax but trips on **19 distinct dialect quirks** (the original 17 plus two found while validating against MAME's production ROM dumps). Fifteen are handled by `tools/williams_preproc.py` (the preprocessor), three are vasm command-line flags, and one is an output-format workaround in the build script.

### Flags passed to vasm

| Flag | Purpose |
|---|---|
| `-Fsrec` | Motorola SREC output (tolerates Robotron's section overlap — see fix #17) |
| `-ast` | `*` at column 1 is a comment |
| `-unsshift` | unsigned right-shift semantics (so `>>` matches Motorola `!>`) |

### Dialect items the preprocessor rewrites

| # | Williams form | Symptom in raw vasm | Preprocessor action |
|---|---|---|---|
| 1 | `*` full-line comment | (`-ast` handles it) | — |
| 2 | tab-separated trailing comment, no `;`<br>e.g. `LDAA #5\tCYCLES PER FRAME` | "unknown mnemonic" | Insert `\t; ` before the trailing comment field |
| 3 | space-separated trailing comment inside operand field<br>e.g. `LDAA #RADSND/$100 SOUND TABLE` | "trailing garbage" / unknown mnemonic | Split operand on first whitespace; rest becomes `;` comment |
| 4 | listing pseudo-ops `NOGEN NAM OPT TTL …` | "unknown mnemonic" | Comment out the line with leading `*` |
| 5 | `END CKSUM` directive (Motorola end-of-program) | "unknown mnemonic" | Same — treat `END` as listing pseudo-op |
| 6 | `END` used as a **label** (Robotron) | conflicts with vasm `END` directive | Rename label and references to `XEND` |
| 7 | `LABEL EQU *` (snapshot PC) then `ORG LABEL` | "expression must be constant" | For `LOCRAM` specifically: track PC through the RAM section and emit a literal `LOCRAM EQU $XX`. Other `EQU *` sites become bare labels (which works for non-`ORG` references). |
| 8 | multi-`ORG` overlay (`ORG LOCRAM` six times for RAM overlays) | "sections must not overlap" | **Rewrite the entire RAM-declaration section** as `LABEL EQU $XX` constants tracked by the preprocessor. Suppress the `ORG LOCRAM` directives entirely. The symbolic addresses still resolve correctly; vasm sees zero overlapping sections. |
| 9 | Motorola operators `!>`, `!<`, `!.`, `!+`, `!^` | "unknown mnemonic" / parse error | Substitute with `>>`, `<<`, `&`, `|`, `^` |
| 10 | `$` inside identifiers (Robotron: `C$FRQ`, `PERK$$`, `SND1$$`) | tokeniser splits on `$` (hex prefix) | Replace `(?<=\w)\$+` with `_` per `$` |
| 11 | bare `,X` or `,Y` (zero-offset indexed) | "missing operand" | Substitute with `0,X` / `0,Y` |
| 12 | bare `X` or `Y` as operand (Williams shorthand for `0,X` / `0,Y` on `LDAA X` etc) | "undefined symbol <X>" | Substitute `X` → `0,X` and `Y` → `0,Y` when standing alone as the entire operand |
| 13 | inherent-mode 6800 mnemonics followed by trailing comment text<br>e.g. `NEGB NEGATE` (NEGB takes no operand; NEGATE is comment) | "illegal operand types" | Hard-coded list of 47 inherent mnemonics (`NEGB`, `PSHA`, `RTS`, …); operand-position text is reinterpreted as comment |
| 14 | `ORG LOCRAM+1` (overlay reset to LOCRAM **plus an offset**) | section starts at `$13+1` — overlaps the LOCRAM section vasm already emitted, AND silently dropped the `+1` so every RAM cell from there down was off by one | Recognise `LOCRAM±N`, parse the `±N` numeric offset, suppress the `ORG` directive (RAM mode), and set `pc = LOCRAM_value + offset` so subsequent `RMB`-as-`EQU` emits at the correct address. **Dropping the offset was the root cause of Robotron's 3812-byte mismatch against MAME's production ROM dump (closed 2026-05-26).** |
| 15 | `RMB <symbol>` (e.g. `RMB WVELEN` where `WVELEN EQU 72`) | preprocessor can't compute the RAM-byte advance because the count is symbolic, so PC tracking stalls and subsequent `LABEL RMB N` declarations get emitted as actual bytes at low addresses | **Pre-scan pass** before the main pass: read every `LABEL EQU <number>` and store in a Python dict. `parse_num()` consults this dict when the operand isn't a literal |
| 16 | `RMB <expression>` (e.g. `RMB 2*ECHOS`) | same symptom as #15, but the operand is a multi-token expression a flat dict-lookup can't resolve | **Mini expression evaluator** inside `parse_num()`: transform `$NN` hex literals to Python's `0xNN` form, then `eval()` with the EQU symbol table as `globals` (sandboxed: no `__builtins__`). Handles `+`, `-`, `*`, `/`, parens, bitwise ops |
| 17 | Robotron's main section overruns the vector area by 3 bytes (vasm `fatal error 3001: sections must not overlap`) | the original Williams assembler produced exactly 4096 bytes; vasm makes 4099. Almost certainly traceable to two `LDAA X` (Motorola zero-offset shorthand) lines that vasm compiles as 2-byte indexed (`A6 00`) but the original assembler may have compiled as 1-byte | **Output-format workaround**: `-Fsrec` writes a sparse Motorola-S address-keyed file *despite* the warning. The build script parses the SREC into a `{addr: byte}` dict where later writes overwrite earlier — so the vector section's bytes at `$FFF8-$FFFA` cleanly overwrite the spurious 3 bytes. Resulting ROM matches the original exactly (verifiable: `(C)1982 WILLIAMS ELEC` ASCII at `$F001`) |
| 18 | `FCC "(C)1982 WILLIAMS ELECTRONICS"` (Motorola form-constant-string with **internal spaces**) | The preprocessor's line tokenizer captured operand as `"(C)1982` (split at first whitespace) and the rest as a `;`-comment, so vasm emitted only the first 8 bytes and then a comment. The ROM had `v(C)1982\t; WILLI…` where production has `v(C)1982 WILLI…`, cascading into 93% of Robotron's bytes shifting | Extend `LINE_LABEL` / `LINE_NOLABEL` regex with a `"[^"]*"|'[^']*'` alternative inside the operand sub-pattern so quoted strings are kept whole. (No escape-sequence support; the Williams source has no escapes.) |
| 19 | Leading-zero decimal literals (`09` meaning decimal 9) inside FCB operand lists | vasm-oldstyle interprets any leading-zero number as octal: silently for `00`..`07`, but `08` / `09` trigger `warning 2001: trailing garbage in operand` and emit just the `0`. Robotron's `STRT FCB $13,$10,$00,$FF,$00,09,…` produced `…$00 $00` instead of `…$00 $09` — the last remaining mismatch after #14 + #18 | Strip leading zeros from decimal tokens in `fix_operand` via a boundary-aware regex (`LEADING_ZERO_DEC`). `$09` hex literals are untouched (negative lookbehind on `$`); `0,X` indexed operands are preserved by the comma boundary |

Use the unified script:

```bash
tools/build_roms.sh
```

It preprocesses each `.SRC`, assembles with `vasm -Fsrec`, parses the SREC into an address-keyed byte map, extracts the canonical ROM range (`$F800-$FFFF` for Defender/Stargate, `$F000-$FFFF` for Robotron), and writes the final binary. Total time: ~1 second for all three games.

## Notable findings about the Williams source files

Dimensions emerged through the build attempts:

### Structural

- All three sources begin with **fixed RAM declarations** (`ORG 0` + `RMB`) used purely to assign symbolic addresses to zero-page variables — these emit zero bytes in the final ROM but vasm-bin still considered them overlapping sections. The preprocessor turns the RAM block into pure `EQU` constants.
- `LOCRAM` is the only symbol that's actually used as the operand of `ORG` (re-bound six times for the engine-specific RAM overlays). Other "snapshot" labels (`TMPRAM`, `SRMEND`, `VVECT`, `GWVTAB`, …) are only used as forward-referenced data addresses — bare-label form works fine.
- `CKORG=$F700` is a separate **diagnostic checksum block** that ships outside the runtime ROM. vasm emits it into the binary; we discard it by taking only the last 2048 / 4096 bytes.

### Authors' stylistic differences

- **Sam Dicker (Defender, 1980)**: tab-aligned columns, plain mnemonics, no use of `$` in identifiers, NOGEN + NAM at the top. Source is the cleanest of the three.
- **Eugene "Phred" Jarvis + Dicker (Stargate, 1981)**: 95 % byte-identical to Defender (see `docs/stargate_sound_catalogue.md`); refactors note constants into explicit equates (`D2 EQU $7C1D` etc.), adds Close-Encounters / "NINTH" tunes.
- **Jarvis + Dicker + Pfeiffer + Kotlarik + … (Robotron, 1982)**: heaviest use of `$`-in-identifier symbols (`C$FRQ`, `PERK$$`, `SND1$$`, `FREQ1$`). Uses `LDAA X` shorthand (Motorola zero-offset indexed). Defines a label named `END`. Has additional engine families (SING, PLAY, CDR) that the earlier ROMs lacked.

### Quirks of vasm-oldstyle vs Motorola AS

- vasm requires `;` for trailing comments — Motorola AS treated anything after the operand column as a comment.
- vasm doesn't accept `EQU *` as a constant expression in `ORG` — Motorola AS did.
- vasm requires explicit `0,X` for zero-offset indexed — Motorola AS accepted `LDAA X` or `LDAA ,X` as shorthand.
- vasm uses `END` as a directive; can't be used as a label.
- vasm's sections must not overlap — multi-ORG to the same address (Williams' RAM overlay pattern) fails outright.

## Chronology of fixes (how we got from "1 error" to "all three ROMs")

Roughly the order in which the dialect items were discovered and added to the preprocessor / build script. Each item's number matches the table above.

1. **#4 listing directives, #1 `*` comment** — first try with raw vasm. Added `-ast` and the `SKIP_OPS` filter.
2. **#2 tab-trailing comments** — `LABEL\tMNEM\tOP\tCOMMENT` parsed as `MNEM = COMMENT`. Insert `; ` before tail.
3. **#7 `EQU *` for `LOCRAM`** — "expression must be constant" on `ORG LOCRAM`. Track PC through the RAM section, emit `LOCRAM EQU $XX` as a literal.
4. **#8 multi-`ORG` overlay** — "sections must not overlap" because Williams uses `ORG LOCRAM` six times for engine-specific RAM views. Solution: rewrite the entire RAM-declaration block into `EQU` constants; suppress the `ORG LOCRAM` lines.
5. **#9, #11, #12 Motorola ops + `$`-in-identifiers + `,X` zero-offset** — added together after Robotron started compiling: `!>` → `>>` etc., `(?<=\w)\$+` → `_`, `,X` → `0,X`.
6. **#5 `END` directive, #6 `END` as label, #13 inherent mnemonics** — Robotron-only quirks discovered as later errors. Drop the `END CKSUM` directive, rename `END`-label to `XEND`, recognise the 47 inherent 6800 mnemonics and treat their operand position as comment.
7. **#3 space-separated trailing comment inside operand field** — `LDAA #RADSND/$100 SOUND TABLE` — split operand on first internal whitespace.
8. **`(?<=\w)\$+`** (not just `\$`) — needed for `PERK$$`, `SND1$$` where re.sub left a residual `$` after the first substitution.
9. **#10 bare `X` / `Y` as operand** — `NOISLD LDAA X` was being read as "load A from symbol named X". Substitute `X` / `Y` → `0,X` / `0,Y` when standing alone.
10. **High vs low symbolic ORGs** — `ORG ROM` (high) was being suppressed alongside `ORG LOCRAM` (low). Distinguish: only suppress when the operand resolves into the RAM-overlay pattern.
11. **#14 `LOCRAM+1`** — Robotron has one `ORG LOCRAM+1` next to its 14 `ORG LOCRAM`s. Extend suppression to match `LOCRAM`-based expressions, not just the bare token.
12. **#15 RMB with symbolic count** — `RMB WVELEN` made PC tracking bail and subsequent RMBs got emitted as actual bytes at low addresses. Added a pre-pass that builds an EQU symbol table from the source itself.
13. **#16 RMB with expression count** — `RMB 2*ECHOS` (STABLE = SCREAM voice table) still failed because the pre-pass only handles single tokens. Added a minimal Python `eval()` expression evaluator with the symbol table as globals.
14. **#17 Robotron's 3-byte section overlap** — even with the preprocessor fully correct, Robotron's compiled output extends 3 bytes into the vector range. Switched the output format from `-Fbin` to `-Fsrec`; the build script parses the SREC, letting later vector-section writes overwrite the spurious 3 bytes.

After step 14: **all three ROMs build via a single `tools/build_roms.sh` invocation** in ~1 second total, with vectors validated.

## Files added by this install

```
tools/
├── vasm-build/                  # extracted vasm source + intermediates (~10 MB, can delete)
├── vasm6800_oldstyle            # the installed assembler (312 KB)
├── williams_preproc.py          # the dialect bridge (Python 3, ~310 LOC)
├── build_roms.sh                # unified preprocess + assemble + extract pipeline
├── build/                       # intermediates (per-game .s68, .s19, .log)
│   ├── VSNDRM1.s68
│   ├── VSNDRM1.s19              # Motorola SREC (sparse) output
│   ├── VSNDRM1.log
│   └── … (same for VSNDRM2/3)
├── defender_sound.bin           # ✓ 2048 B
├── stargate_sound.bin           # ✓ 2048 B
├── robotron_sound.bin           # ✓ 4096 B (with `(C)1982 WILLIAMS ELEC` at $F001)
└── mwenge_vsndrm1.src           # reference: mwenge's pre-patched Defender source
```

## Cross-references

- The audio-pipeline plan that needs these ROM binaries: `docs/assemble_drive_pipeline.md`
- mwenge's pre-patched Defender source proving the vasm approach works: <https://github.com/mwenge/defender/blob/master/src/vsndrm1.src>
- The Williams source files: `research/williams-soundroms/VSNDRM{1,2,3,4}.SRC`
