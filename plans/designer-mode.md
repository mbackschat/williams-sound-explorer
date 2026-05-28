# Sound Designer — consolidated plan

> Single source of truth for the **Sound Designer mode** work — v1 (shipped), the audition-transport refinements (shipped), the Custom-ROM design discussion, the dispatcher spike, and the v-next roadmap. Consolidates and supersedes the transient harness plan `~/.claude/plans/logical-weaving-axolotl.md`.
>
> Companions: **`docs/designer_implementation.md`** (curated impl state), **`MANUAL_DESIGNER.md`** (top-level user manual), **`research/findings_designer_feasibility.md`** (raw ROM-level findings). This file is the *plan/decision log*; those are the living references.

## Status at a glance (2026-05-28)

| Phase | What | State |
|---|---|---|
| 1 | Designer **v1** — VARI editor (copy + modify existing) | ✅ shipped & verified |
| 2 | Audition **transport** redesign (Play/Pause/Loop/Source/Diff, auto-replay, playhead) + param-panel layout | ✅ shipped & verified |
| — | Custom-ROM **model** discussion ("where are my items?") | ✅ decided (v1 = override-in-place; true Custom ROM = v-next) |
| — | Dispatcher **spike** (can we add new VARI command slots?) | ✅ done — one-byte unlock proven |
| 3a | **Custom-ROM image builder** (`engine/customRom.ts`, headless) | ✅ built & tested |
| 3b | **Custom-ROM Designer UI** (own item list: copy-from-any-game + new) | ✅ built & verified |
| 4 | **Open in Explore** (live audition via Explore's worklet + dynamic Custom switcher entry) | ✅ shipped & smoke-tested |
| 5 | **GWAVE editor** — full editing of all bytes the GWAVE kernel reads (SVTAB record + GWVTAB waveforms + GFRTAB pitch patterns), in 3 steps | ✅ all 3 steps shipped |
| 5b | **Adding new waveforms** (extending GWVTAB via `LDX #GWVTAB` repoint + relocation into the free RADIO/ORGAN region) | ✅ shipped 2026-05-28 |
| 5b.polish | **× Remove** waveform + **ROM-space indicator** + **↻ Reset record** (closes the add/edit/remove triad; surfaces the layout budget *before* a build throws) | ✅ shipped 2026-05-28 |
| 6.1 | **"Fork-the-game" pre-populated item list** — *New Project* opens with every editable command pre-loaded; stock-vs-edited dot indicator; sparse on disk | ✅ shipped 2026-05-28 |
| 6.2 | **Download + Upload `.bin`** — closes the copy → modify → download → MAME → upload → modify loop | ✅ shipped 2026-05-28 (v1 full fidelity) |
| 7 | **LFSR editor** (LITE / APPEAR / TURBO / LAUNCH …) — third engine, parameter patches in caller immediates | 📋 planned (research done — see § Phase 7) |
| 8 | **FNOISE editor** (BG1 / THRUST / CANNON / HBOMB) — fourth engine, dual-path build (Robotron FNTAB table + Defender/Stargate inline immediates) | 📋 planned (research done — see § Phase 8) |
| 9 | **RADIO editor** ($18 — 16-byte wavetable + phase-accum) — fifth engine; closes Defender-parity gap with Sound Studio's *Sweeps* tab | 📋 planned (needs spike — see § Phase 9) |

Through Phase 3a is committed on `main`; Phase 3b (the own-item-list UI + `CustomProject` store) and its doc sweep are uncommitted in the working tree.

## Foundations (the two facts everything rests on)

1. **A Williams sound is *data*, not bespoke code.** For the data-driven engines (VARI/GWAVE/LFSR/FNOISE) a command is a fixed-stride parameter record a shared engine kernel consumes — authoring a VARI sound = writing 9 bytes, **no in-browser 6800 assembler**. (Per-engine taxonomy + evidence: `research/findings_designer_feasibility.md`.)
2. **The emulator already runs raw ROM bytes.** `runSoundWithRom(game, romBytes, cmd)` (`explorer/src/engine/runner.ts`) renders any command from a `Uint8Array`. Feed it an *edited* image and the custom sound renders through the exact offline pipeline `web/ui/wavExport.ts` uses.

---

## Phase 1 — Designer v1 (VARI editor) — ✅ SHIPPED

**Scope (locked):** engine = **VARI only**; capability = **copy-and-modify an existing command**; the Designer is a **separate top-level mode** that does **not** clutter the Explore UI; the project is the **only saveable** artifact.

**Locked architectural decisions:**
- **Separate mode, Explore UI untouched.** One header `Explore | Design` toggle; Design renders into its own `#designer-root` (Explore's `#pageLayout` hidden). The designer module is lazily imported (own JS+CSS chunk).
- **No 4th `GameKind`.** Project = `{ baseGame, edits }`; audition runs **offline** via `runSoundWithRom(baseGame, editedBytes, cmd)`. Avoids threading `"custom"` through glossary / labelMap / zeroPageMap / romValidate / onboarding / switcher / QuizPanel.
- **Recipe, not bytes.** Saved artifact is a JSON recipe (parameter edits over a base game) in IndexedDB — **zero copyrighted ROM bytes persisted**. JSON export/import falls out for free.

**Delivered:**
- Headless core `explorer/src/engine/variEdit.ts` — `VVECT_BASE` (defender `$FD76`, stargate `$FD3C`, robotron `$FC08`; stride 9), `VARI_FIELDS` (8 logical fields; SWPDT is 16-bit big-endian @5–6), `variCommandsFor`, `readVariRecord`, `patchVariRecord`, `getField`/`setField`, `VariRecipe`, `applyRecipe`. DOM-free (in the `tsconfig.core.json` gate).
- Browser `explorer/src/web/designer/` — `designerMode.ts` (orchestrator), `variEditor.ts` (slider panel, reuses the `.param-row` pattern), `audition.ts` (render + play + scope/diff), `designerStore.ts` (IndexedDB CRUD + JSON export/import), `designer.css`. Toggle in `web/ui/modeToggle.ts`; wired in `index.html` + one line in `web/main.ts`.

**VVECT record (verified vs `VSNDRM*.SRC`):** `[0]LOPER [1]HIPER [2]LODT [3]HIDT [4]HIEN [5–6]SWPDT(BE) [7]LOMOD [8]VAMP`. Editable commands → row: D/S `$1D→0 $1E→1 $1F→2`; Robotron adds `$3F→5`. (SP1/CABSHK row 3 excluded — bespoke caller code.)

**Tests:** `variEdit.test.ts` (21, incl. a golden assertion reading real SAW bytes), `designerStore.test.ts` (7, JSON round-trip + validation). Full suite **413**; typecheck passes full + core gate.

---

## Phase 2 — Audition transport refinements — ✅ SHIPPED

Four issues found in use, all fixed and verified (Playwright smoke + screenshots):

1. **Param panel layout** — the shared `.param-row` is a 4-column grid (checkbox/label/slider/value); the designer rows have no checkbox, so the label overlapped the slider and the value flew to the far right. Fixed with a designer-specific 3-column grid packed left.
2. **Pause** — was overloaded on Play (and ambiguous vs. Original). Now a **dedicated `⏸ Pause`** (idle-disabled, Pause↔Resume); `▶ Play` = restart from top.
3. **Diff** — was a sticky one-shot. Now a **toggle** that overlays original (grey ghost) + divergence (red) behind the live trace, without interrupting audio.
4. **Loop + auto-replay** — `🔁 Loop` (native `AudioBufferSource.loop`); editing a slider **auto-replays** the edited sound (debounced ~130 ms); `Source: ⟨Edited│Original⟩` toggle replaces the standalone Original button → instant A/B by ear. A **playhead** sweeps the scope synced to playback and freezes on Pause (context-clock suspend).

Final transport: **Play · Pause · Loop · Source(Edited│Original) · Diff · Reset · Vol** + auto-replay-on-edit + moving playhead.

---

## The Custom ROM model — discussion & decisions

**v1 reality:** a project *overrides* the base game's existing VARI slots in place, so the "Sound:" list is the base game's commands; the ones you've edited wear a green ● — those ● commands **are** your custom items. There is no separate list because v1 doesn't **add** sounds, it **replaces** parameters at existing command codes.

**The user's vision (the goal):** a Custom ROM with **its own item list** — copy VARI sounds **from any game** (e.g. 2 from Defender + 3 from Robotron), modify them, **and add brand-new ones**, each in its own named slot. "Base ROM" becomes just *"which game's VARI engine to run on."*

**Why that's feasible (VARI):** a VARI record is *fully* portable — the kernel is the same algorithm in all three games, so copying across games is just copying 9 bytes (proof: Robotron `MOSQTO` ≡ Defender `QUASAR`, byte-identical). So a Custom ROM = one base game's **VARI engine code** (reused, read-only) + **a custom `VVECT` table** + **a dispatcher exposing your codes**.

**The only real gate:** where the sounds *live* — each needs a command code routed to VARI. That's the dispatcher, which is hardcoded. → spiked next.

---

## Dispatcher spike — ✅ done (2026-05-28)

**Question:** can we add new VARI command slots to a base image with byte patches only (no assembler)?

**Defender dispatch is a clean linear top band** (`VSNDRM1.SRC` IRQ ~909–953): after `ANDA #$1F` (5-bit mask) and `DECA`, any `A > $1B` → VARI with `VVECT row = A − $1C`. So the *only* cap on reachable rows is the mask.

**Result — essentially one byte:**
- The mask `COMA;ANDA #$1F` (`43 84 1F`) sits **uniquely at ROM `$FCBD`**. Patching the operand **`$1F → $3F`** unlocks command codes `$20–$3F`, all routing to VARI with `row = (cmd−1) − $1C` → **~33 new slots**, bounded only by `VVECT` table space.
- **Verified:** with that byte patched and `QUASAR`'s record copied into `VVECT` row 4, command `$21` rendered **byte-for-byte identical** to native `$1F` QUASAR (5512 DAC events, 2 363 696 cyc); `$21` on the unpatched ROM plays a different (GWAVE) sound — i.e. the patch created the slot. (Spike via `runSoundWithRom` + `renderDacEvents` sample-equality; throwaway script, removed.)
- For many slots: relocate `VVECT` (default `$FD76`, followed by `RADSND` + ORGAN tunes) into free ROM space and repoint `VARILD`'s `LDX #VVECT` immediate (`CE FD 76`).
- **Recommended base = Defender / Stargate** (clean `A−$1C`). Robotron is 6-bit already but special-cases `$3F` (`SUBA #$39`) and uses a `JMPTBL` pointer table — less linear to grow.

Byte-level detail: `research/findings_designer_feasibility.md`.

---

## Phase 3 (v-next) — the true Custom ROM

Delivers the user's vision: a Custom ROM with its own named item list, sounds copied from any game and/or newly created.

**Build order:**
1. ✅ **Done — image build** (`engine/customRom.ts`, headless, TDD): `buildCustomRom(baseRom, game, slots)` emits a runnable image — widen the command mask only when a slot code exceeds `$1F`, then extend `VVECT` **in place** (the 2 KB ROMs are too densely packed to relocate — longest free run is 5 bytes), `row = code − $1D`. Capacity (extend over RADIO/ORGAN, stop before `GWVTAB`): **23** rows Defender, **30** Stargate; Defender/Stargate only (Robotron's dispatch is non-linear). 9 tests assert each slot's command renders its record on the real ROMs. The earlier "relocate + `VARILD` repoint" idea proved unnecessary.
2. ✅ **Done — Designer UI for the own-item-list:** engine-base picker (Defender/Stargate), the item list (+New, +Copy-from-any-game, rename, remove; auto command codes `$1D`+), edit the selected sound, audition/A/B (Edited vs Start) + Diff via `buildCustomRom`, save/open/export/import. New `CustomProject` shape (`designerStore.ts`) with legacy v1 auto-conversion. Audition/transport reuse Phases 1–2.

**Recipe shape (v-next):** grows from `{ baseGame, edits }` to a slot list (`{ engineBase, slots: [{ code, name, record }] }`); still JSON, still zero ROM bytes.

**Boundaries / out of scope (for now):**
- Clean for **VARI-only**. Cross-engine (GWAVE/SCREAM/ORGAN) is a further step: GWAVE needs its `GWVTAB`/`GFRTAB` tables copied along; SCREAM has no record (not data-authorable); ORGAN is code-as-data. The base ROM already *contains* all six engines' code, so engines are present — but per-engine complexity remains.
- Genuinely novel synthesis (new DSP) needs an assembler — out of scope.

**Other fast-follows:** ~~live-worklet audition (pause/step/scrub on the custom ROM)~~ ✅ done 2026-05-28 — shipped as **Open in Explore** (the custom ROM is pushed into Explore's existing worklet via `host.loadCustomRom`; a dynamic **✎ Custom: ⟨name⟩** entry in `#gameSwitcher` shows which ROM is loaded; details in `docs/designer_implementation.md` § *Open in Explore*); ~~a MANUAL/README screenshot via the `e2e/` capture harness~~ ✅ done 2026-05-28 (`designer-overview` + `designer-audition-explore` entries in `explorer/e2e/tutorials.ts`, embedded in `MANUAL_DESIGNER.md` + `README.md`); **GWAVE editor — see Phase 5 below**.

---

## Phase 5 — GWAVE editor (full byte-level editing, in 3 steps)

Delivers full editing of every byte the GWAVE kernel reads: the SVTAB parameter record, the GWVTAB waveform bytes, and the GFRTAB pitch-pattern bytes. The 3 steps each ship a coherent commit and advance toward the final shape — no "stopping-point MVP" that ships less than the full editor.

**Model — "override in place":** a GWAVE slot picks an *override target* (an existing GWAVE command, e.g. Defender `$05 BBSV`) and replaces that command's bytes in the custom ROM. Firing the overridden code in Explore plays your edit. **GWAVE slots coexist with VARI slots in one project** via a discriminated union `slot.kind: "vari" | "gwave"`; legacy projects auto-migrate. **Robotron unlocks** as an engine base for GWAVE (patching SVTAB in place needs no dispatcher widen).

**Why "in place" rather than "own item list with new codes" (the VARI model):** GWAVE has no equivalent of VARI's 5→6-bit mask widen — its dispatch is a hardcoded branch tree (per-code) on Defender/Stargate and a JMPTBL on Robotron, so unlocking new GWAVE codes is dispatcher-patch work, not data extension. Adding new codes is a v-future item (see deferrals below).

**Steps:**

1. ✅ **SVTAB record editing — done 2026-05-28.** Headless: `engine/gwaveEdit.ts` with `SVTAB_BASE` per game (Defender `$FEEC`, Stargate `$FEEA`, Robotron `$FE45`), `SVTAB_STRIDE=7`, `GWAVE_FIELDS` (9 logical fields after unpacking the GECHO/GCCNT and GECDEC/WAVE# nybble pairs), `gwaveCommandsFor`, `readGWaveRecord`, `patchGWaveRecord`. Extended `engine/customRom.ts` to accept `CustomSlot = VariSlot | GwaveSlot` and patch SVTAB rows in place for GWAVE. Browser: `web/designer/gwaveEditor.ts` (9-row slider panel with WAVE# as a 0–6 select) + `designerMode.ts` extensions (`Override GWAVE:` dropdown; per-slot editor swap by kind; mixed item-list rendering — yellow `$XX VARI` vs purple `$XX GWAVE` items). `designerStore.ts` `CustomProject.slots` is now a discriminated union; v1 and v2 on-disk shapes auto-migrate. Audition + Open-in-Explore work transparently for both kinds; the F3 custom-chip overlay names the overridden code. **+29 tests** (23 gwaveEdit + 6 customRom GWAVE + GWAVE/discriminated additions to designerStore), 459 total.
2. ✅ **Editable waveform canvas (GWVTAB bytes) — done 2026-05-28.** Below the SVTAB sliders, a 280×100 canvas shows the resolved bytes of the slot's current `WAVE#` (override if present, else stock from base ROM); click-and-drag draws byte values 0..255 cell-by-cell. Lengths don't change → no pointer rebase. Sharing caveat surfaced in UI as *"Shared by: $XX NAME, $YY NAME — your edits affect every one."* (driven by `waveformUsers`); per-idx **Reset to stock** button. `engine/gwaveEdit.ts` gained `GWVTAB_BASE` per game, `STOCK_WAVE_LENGTHS`/`STOCK_WAVE_SAMPLE_OFFSETS`/`STOCK_WAVE_NAMES`, `readWaveform`, `patchWaveform`, `waveformUsers`. `engine/customRom.ts` `buildCustomRom` now takes `options?: { waveformOverrides?: Record<number, number[]> }`; a project with only waveform overrides (no slots) is allowed. `CustomProject.waveformOverrides?: Record<number, number[]>` added to `designerStore.ts` with JSON round-trip + validation. **+20 tests** (479 total).
3. ✅ **Editable pitch-pattern canvas (GFRTAB bytes) — done 2026-05-28.** A second click-to-draw canvas (teal) below the waveform canvas shows the resolved bytes at the slot's current `(PATOFF, PATLEN)`. Drawing emits `onPatternDraw(offset, bytes)`; the host writes those into `project.patternOverrides[offset]` (keyed by GFRTAB offset, value bytes write at that offset for `bytes.length` bytes). Patterns are byte-addressed so overlap is real — the "Shared by" line lists editable commands whose pattern range overlaps the slot's. `engine/gwaveEdit.ts` gained `GFRTAB_BASE` per game, `gfrtabMaxEnd(game)`, `readPattern` / `patchPattern` / `patternUsers`. `engine/customRom.ts` `BuildOptions.patternOverrides?: Record<number, number[]>` applies after waveform overrides (last write wins on overlap). `CustomProject.patternOverrides?` added to the saved-project schema with JSON round-trip + validation. **+20 tests** (499 total).

**Across all 3 steps:** test suite stays green at every commit; `MANUAL_DESIGNER.md` + `docs/designer_implementation.md` get incremental updates; the `e2e/` capture harness gains a GWAVE entry by Step 1 and is refreshed at Step 3.

**Why these 3 steps can ship without pointer rebase:** none of them changes table *lengths* — no new waveforms, no new patterns, no length changes for existing ones — so SVTAB byte-6 pattern offsets and the GWVTAB walk positions stay valid. The custom ROM only ever rewrites bytes in place at the addresses the base ROM was already using.

---

## Phase 6 — "Fork-the-game" workflow (planned)

The motivating observation: the Designer's stated intention is **"make new sounds for the games"**, but its on-boarding asks you to *assemble* a custom bank from an empty list — which reads as "build something new". Most users want to *fork* the game's existing sound bank, modify a few sounds, and take the result out. Two changes deliver that mental model end-to-end without touching the storage architecture (the sparse JSON recipe stays the saved artefact — zero copyrighted ROM bytes persisted, unchanged from Phase 1's lock).

### 6.1 Pre-populated item list

**Today (empty start):** *New Project → Defender* gives you an empty item list and three call-to-actions ("+ New VARI" / "Copy VARI:" / "Override GWAVE:"). The first slot needs a deliberate action; the user invents what they want to build.

**Phase 6.1 (populated start):** *New Project → Defender* pre-populates the item list with **every editable command from the engine base**, each tagged **"stock"** until you edit it. For Defender that's:
- GWAVE overrides for `$01 HBDV` … `$0D ED17` (13 items)
- VARI starters for `$1D SAW` / `$1E FOSHIT` / `$1F QUASAR` (3 items)

Stargate: same shape, same 16 items. Robotron: all 14 GWAVE override targets + the existing VARI `$3F MOSQTO` (but VARI slots stay locked there — its non-linear dispatcher is still v-future). Total ~15–16 pre-filled items per game.

The user clicks a stock row to edit it (sliders populate from the base ROM's bytes; nothing changes on disk yet). A row marked **stock** doesn't contribute to the saved recipe (no delta from base); editing it flips it to **edited** and from that point it's persisted. **+ New VARI** and the override / copy controls stay available for users who *do* want to add new sounds beyond the stock list. New visual treatment for stock-vs-edited rows: a dot indicator + colour, mirroring Explore's command-chip greying.

**Schema impact: none.** `CustomProject.slots` already supports the right shapes (VARI and GWAVE). Whether a slot is "edited" is `!recordsEqual(slot.record, slot.start)` — already used by the **↻ Reset record** button. Persisted projects stay sparse: serialisation filters out unchanged slots so the on-disk JSON keeps its "diff from base" shape (a freshly-populated project that's never been edited → empty `slots: []`, identical to today's empty project).

**buildCustomRom impact: none.** Unedited stock slots are a no-op (their record equals the base ROM's bytes; `patchGWaveRecord` / VVECT-extend overwrite with what's already there). The build doesn't need to learn about "stock vs edited" — that's purely a UX distinction.

**UI deliverables:**
- Pre-populate `project.slots` on *New Project*, sourced from `gwaveCommandsFor(game) + variCommandsFor(game)`.
- Per-slot **stock / edited** state derived live from `recordsEqual(record, start)`; visible in the row (dot + label colour) and in the item count (`(VARI 1 edited / 16 total)`).
- On save / export: `slots: project.slots.filter((s) => !recordsEqual(s.record, s.start))` — the wire shape stays sparse.

### 6.2 Download custom ROM as `.bin`

The Designer already builds a complete `Uint8Array` ROM image internally (`buildEdited()` in `designerMode.ts` — feeds Explore's worklet on **Open in Explore**). Phase 6.2 exposes it as a download.

**UI deliverables:**
- A `↓ Custom ROM (.bin)` button in the header, next to the existing `↓ Export JSON` / `↑ Import JSON` pair.
- Click: `buildEdited()` → `Blob` → `<a download>.click()` (same pattern as the JSON export, ~10 LOC).
- Filename: `{projectName}_{engineBase}.bin` (e.g. `MyDefender_defender.bin`).
- Disclaimer alongside the button (tooltip + a small inline note): *"This file contains the original Williams ROM bytes with your edits applied. For your own use — don't redistribute."*

**The .bin loads in MAME** (and any other 6802-cabinet emulator) by replacing the `defender_sound.bin` / `stargate_sound.bin` / `robotron_sound.bin` in the relevant MAME ROM set. That's the **loop close**: edit in WSED → play in MAME → real cabinet (if you build the EPROM). The JSON recipe stays the *shareable* artefact (zero ROM bytes, safe to publish); the `.bin` stays the *runnable* one.

### Why the storage model stays sparse

The on-disk artefact stays **`{ engineBase, slots: [edited deltas] }`** even after Phase 6 — both for the locked legal/copyright reason (zero ROM bytes persisted, set in Phase 1) and for the practical one (a delta is portable across base-ROM versions; a snapshot wouldn't be). The "fork-the-game" feeling is purely a UX rendering of the same underlying data: the populated list shows you the *base + your deltas*, every row is editable, but on disk we only store the deltas.

This is the architectural inversion of how Phase 6 would have been done with the wrong design: "store the whole bank, diff at build time". We do it the other way ("store the diff, render the whole bank at view time"), which is cheaper, smaller, and copyright-safe.

### Scope estimate

- 6.1 (pre-populated item list + stock/edited UX): ~3 hours including tests + smoke + doc sweep.
- 6.2 (.bin download + disclaimer): ~30 min.
- Combined commit, single doc sweep pass: ~3.5 hours.

### Out of scope (still)

- **Storing ROM bytes in the recipe** — locked-out in Phase 1; #3 of the "fork-the-game" interpretations (the user surfaced it explicitly to ask if it was the intent — it isn't, and it shouldn't be).
- **Editing non-data-driven engines (SCREAM / ORGAN / RADIO / NOISE / FNOISE / HYPER)** — bespoke code per sound, not data-authorable. Stock entries in the populated list for those engines would only be **viewable** (their command code + name shown for context), not editable. Decision pending — easier to *omit* them from the populated list than to render them as locked rows; revisit if users ask.

---

---

## Phase 7 — LFSR editor (planned)

The third engine: the LFSR noise family that produces **LITE** (lightning), **APPEAR** (enemy-appear descent), **TURBO** (turbo burst), and Robotron's **LAUNCH**. Same architectural pattern as VARI + GWAVE — override-in-place editor — but with one structural twist: **parameters are immediate operands in caller code, not in a parameter table**.

### Foundations (verified — see `research/findings_designer_feasibility.md` § LFSR)

- All three games share the kernel shape `LITEN` / `NOISE` (Robotron renames `NOISE` to `MOISE` in source).
- Per-sound callers (`LITE` / `APPEAR` / `TURBO` / `LAUNCH`) pre-load the kernel's working registers via 2–4 `LDAA/LDAB/LDX #<imm>` writes, then `BRA` into the kernel.
- The "record" is a virtual one: a logical set of fields the editor reads from / writes to specific operand bytes at known caller addresses.
- Caller addresses are per-game (Defender/Stargate share; Robotron's are different). All addresses already documented in the explorer's label-map JSON (`{game}_labelmap.json`).

### Per-sound record layouts

| Caller (cmd → label) | Defender / Stargate addr | Robotron addr | Editable fields |
|---|---|---|---|
| `$11 LITE` | `$F88C` | `$F55A` | `DFREQ`, `LFREQ_start`, `CYCNT` |
| `$15 APPEAR` | `$F894` | `$F562` | `DFREQ`, `LFREQ_start`, `CYCNT` |
| `$14 TURBO` | `$F8CD` | `$F59B` | `CYCNT_NFFLG`, `DECAY`, `NFRQ1_hi`, `NFRQ1_lo`, `NAMP` |
| `$39 LAUNCH` (Robotron only) | — | `$F550` | `DFREQ`, `LFREQ_start`, `CYCNT` |

(Robotron's wider catalogue also routes `$2C..$3E` through JMPTBL to additional SCREAM/SING variants — those are out of LFSR scope.)

### Build order

1. **Headless core** (`explorer/src/engine/lfsrEdit.ts`, TDD):
   - `LFSR_RECORD_LAYOUT: Record<GameKind, Record<number, FieldDescriptor[]>>` — per-game, per-cmd field map (offset within the caller's instruction sequence, signed flag, displayable max).
   - `lfsrCommandsFor(game)` — returns `[{ cmd, label, callerAddr }]`.
   - `readLfsrRecord(rom, game, cmd)` / `patchLfsrRecord(rom, game, cmd, fields)`.
   - Unit tests: golden bytes for LITE / APPEAR / TURBO / LAUNCH read against the real ROMs; round-trip; out-of-range guards.

2. **`buildCustomRom` extension** (`explorer/src/engine/customRom.ts`):
   - Add `kind: "lfsr"` to `CustomSlot`. Build flow: locate caller, write each field's bytes at its operand offset. No table relocation, no mask widening (LFSR codes are in the JMPTBL middle band, already wired).
   - Tests: round-trip on the real ROMs; ensure the unedited path is byte-identical to the base.

3. **Designer UI** (`explorer/src/web/designer/lfsrEditor.ts` + wiring in `designerMode.ts`):
   - Per-sound slider panel (each sound has a *different* set of fields — the editor renders only the fields its caller actually sets).
   - Pre-populate the item list with `$11 LFSR LITE` / `$14 LFSR TURBO` / `$15 LFSR APPEAR` (+ Robotron's `$39 LAUNCH`); same stock/edited dot indicator as Phase 6.1.
   - Audition / Open-in-Explore / ↓ .bin / ↑ .bin all work transparently — the build path is the only place that branches by kind.
   - Smoke capture: `designer-lfsr-overview` mirroring the existing GWAVE one.

### Scope estimate

- Phase 7.1 (headless + tests): ~2 h.
- Phase 7.2 (customRom integration): ~1 h.
- Phase 7.3 (Designer UI + smoke + doc sweep): ~3 h.
- **Total: ~6 h** end-to-end including the doc sweep + capture refresh.

### Out of scope

- Adding *new* LFSR command codes (same dispatcher constraint as Phase 5 GWAVE — would need code injection, not data patching). Override-in-place only.
- Editing the LFSR's tap-network polynomial (it's a global instruction sequence shared by every LFSR/NOISE/FNOISE sound — changing taps would affect them all uniformly and isn't a useful per-sound knob).

---

## Phase 8 — FNOISE editor (planned)

The fourth engine: filtered noise (slope-limited DAC walk). Sounds: **BG1** (background drone), **THRUST**, **CANNON**, plus Robotron's **HBOMB**. **The interesting part — this engine has split authorability across games:**

- **Robotron** has a clean **`FNTAB` data table** at `$F785` with 4 records of 6 bytes each — fully data-driven, identical shape to VARI's `VVECT` and GWAVE's `SVTAB`. Source comments on CANTB literally say *"DEFENDER SND #$17"*, confirming Robotron's authors extracted the parameters from Defender's inline code into a table.
- **Defender / Stargate** have the same parameters but **inline** in the caller code (same shape as LFSR — `LDAA/LDAB/LDX #<imm>` before `BRA FNOISE`).

Both paths land at the same kernel (`FNOISE` `$F930` Defender/Stargate, `$F7B3` Robotron via `FNLOAD` `$F7A5`).

### Foundations (verified — see `research/findings_designer_feasibility.md` § FNOISE)

**FNTAB record layout (Robotron, 6 bytes):**

| Offset | Field | Meaning |
|---|---|---|
| 0 | `DSFLG` | Distortion flag (0 = clean, 1 = AND with LFSR HI for instantaneous chaos) |
| 1 | `LOFRQ` | Initial lower-frequency latch |
| 2 | `FDFLG` | Frequency-decay flag |
| 3 | `FMAX` | Initial max slope per walk step |
| 4 | `SAMPC` hi | Sample count (16-bit BE) between LFSR redraws |
| 5 | `SAMPC` lo | ↑ |

**Defender/Stargate inline (per-caller):**

| Caller | Editable bytes |
|---|---|
| `$0F BG1` | DSFLG only (rest inherits prior register state — partial editability) |
| `$16 THRUST` | DSFLG, FMAX |
| `$17 CANNON` | DSFLG, SAMPC_hi, SAMPC_lo, FDFLG, FMAX |

### Build order

1. **Headless core** (`explorer/src/engine/fnoiseEdit.ts`, TDD):
   - Per-game branch: Robotron uses `FNTAB_BASE = $F785` + stride 6 (clean indexed read/write); Defender/Stargate use a per-caller operand-offset table.
   - Common surface: `readFnoiseRecord(rom, game, cmd)` / `patchFnoiseRecord(rom, game, cmd, fields)` return / accept the 6 logical fields regardless of game.
   - `fnoiseCommandsFor(game)` — returns `[{ cmd, label, recordKind: "table" | "inline" }]`.
   - Unit tests: byte-for-byte read on each game's stock ROM; round-trip; the FNTAB table vs inline-code paths produce identical logical records for sounds shared between Defender and Robotron (e.g. THRUST `$16`).

2. **`buildCustomRom` extension**:
   - Add `kind: "fnoise"` to `CustomSlot`. Build branches on game: write FNTAB record on Robotron; rewrite caller-code immediates on Defender/Stargate.
   - **Robotron unlocks HBOMB** (`$3E`) — no Defender/Stargate equivalent, since `FNTAB[HBMBTB]` is Robotron-only. The editor surfaces HBOMB only on Robotron engine base.
   - Tests: cross-game equivalence for THRUST `$16` — editing the *same logical record* on Defender vs Robotron produces semantically identical sound output (their kernels are byte-identical).

3. **Designer UI** (`explorer/src/web/designer/fnoiseEditor.ts`):
   - 6 sliders for the logical record. On Defender/Stargate's BG1 (inline, partial editability), the sliders for inherited fields are disabled with a tooltip ("This field inherits prior CPU state on Defender/Stargate; only Robotron's BG1 lets you set it explicitly. Switch engine base to edit.").
   - Pre-populate the item list with the per-game set: BG1 / THRUST / CANNON on all games; HBOMB on Robotron only.
   - Same stock/edited dot indicator as Phase 6.1.
   - Smoke captures: `designer-fnoise-overview` + `designer-fnoise-cross-game` (round-trip THRUST between Defender and Robotron).

### Scope estimate

- Phase 8.1 (headless dual-path core): ~3 h (Robotron table easy; Defender/Stargate inline-immediate scan + tests).
- Phase 8.2 (customRom integration): ~1 h.
- Phase 8.3 (Designer UI + smoke + doc sweep): ~3 h.
- **Total: ~7 h** end-to-end.

### Out of scope

- Adding new FNOISE codes (same blocker as GWAVE — dispatcher widen needed, not on roadmap).
- Editing the global LFSR taps that drive the random redraws (shared with LFSR — same out-of-scope reasoning).

---

## Engine coverage vs. Sound Studio (Defender)

The Defender Sound Studio's 9 UI tabs include **6 editable tabs** that cover **5 engines** in WSED's taxonomy — the Studio splits LFSR across three tabs (Square noise / Player shoot / Sweeps' wavetable variant) where WSED groups them under one LFSR editor.

| Engine | Studio tab(s) | WSED today | After Phases 7+8 | After Phase 9 |
|---|---|---|---|---|
| GWAVE | G-wave | ✅ | ✅ | ✅ |
| VARI | Pulses | ✅ | ✅ | ✅ |
| FNOISE | Smooth noise | ❌ | 📋 Phase 8 | 📋 Phase 8 |
| LFSR | Square noise + Player shoot (same kernel) | ❌ | 📋 Phase 7 | 📋 Phase 7 |
| **RADIO** ($18) | **Sweeps** (2 fields + 16-cell wavetable canvas) | ❌ | ❌ — still a gap | 📋 **Phase 9** |
| SCREAM | (parameterless tab — same blocker for both) | ❌ — needs assembler | ❌ | ❌ |
| HYPER | (parameterless tab — same blocker for both) | ❌ — needs assembler | ❌ | ❌ |
| ORGAN pitch | n/a | ❌ — self-modifying code | ❌ | ❌ |

**Per-engine score:** Studio 5, WSED today 2 → after Phases 7+8 = 4 → after Phase 9 = **5 (parity on Defender)**.

WSED's edge throughout: spans **3 games**, runs the **actual ROMs** on a cycle-accurate emulator (Studio is Defender-only and a hand-port), and pairs Design with a separate Explore mode + a `.bin` roundtrip the Studio doesn't have.

---

## Phase 9 — RADIO editor (planned, needs feasibility spike)

The fifth and final engine in the data-driven set. Closes the per-engine Defender-parity gap with the Sound Studio's *Sweeps* tab.

### What RADIO is

A 16-byte wavetable phase-accumulator: `RADSND` holds 16 unsigned 8-bit samples (Defender `RADSND` = `8C 5B B6 40 BF 49 A4 73 73 A4 49 BF 40 B6 5B 8C` — half-period of a complex shape, mirrored). `(TEMPA:TEMPX+1)` is a 16-bit accumulator; each iteration adds the "freq" (held in TEMPX). The fractional part's low nybble of TEMPA indexes the LUT. When the accumulator's high byte carries, `TEMPX++` (pitch climbs). Terminates when `TEMPX` wraps to 0. Result: rising whistled-noise texture — Defender's "credit accepted" / hyperspace whoosh.

Reference: `research/findings_defender_sound.md` § 2.5 RADIO (lines 430–452 in `VSNDRM1.SRC`).

### Pre-spike plan

1. **Spike** (~1 h):
   - Locate `RADIO`'s entry routine + the `RADSND` wavetable address in each game (Defender / Stargate; Robotron has `$30 STRT` which uses a similar shape — verify whether it shares RADSND or has its own).
   - Identify the editable parameters: the 16 wavetable bytes are obviously editable; the initial freq, initial accumulator, and any rate constants are likely inline immediates in the caller (same shape as LFSR).
   - Write byte-level findings into `research/findings_designer_feasibility.md` § RADIO (mirror the LFSR + FNOISE section format).

2. **Headless core** (`explorer/src/engine/radioEdit.ts`, ~1.5 h):
   - `RADSND_BASE: Record<GameKind, number>`, stride 16.
   - `readRadioWaveform` / `patchRadioWaveform`.
   - Per-game record layout for the caller-side immediates (initial freq, etc.).
   - Unit tests: golden bytes against real ROMs; round-trip.

3. **`buildCustomRom` extension** (~30 min):
   - Add `kind: "radio"` to `CustomSlot`. Patches RADSND bytes + caller immediates.

4. **Designer UI** (`explorer/src/web/designer/radioEditor.ts`, ~2.5 h):
   - Click-to-draw 16-cell wavetable canvas (same machinery as the GWAVE waveform canvas — reuse the `designer-wfcanvas-*` styling).
   - 2–3 sliders for the initial-freq / rate parameters.
   - Pre-populate the item list with `$18 RADIO RADSND` (one slot per game where available).
   - Smoke capture: `designer-radio-overview`.

5. **Doc sweep + commit** (~30 min).

**Total: ~6 h** end-to-end including the spike + doc sweep + capture refresh.

### Out of scope

- HYPER ($19) — the Studio's *Insert credit* tab is parameterless; the ROM has no preset record for it. Same blocker for WSED.
- SCREAM ($1A) — same.
- ORGAN tunes ($1B/$1C) — the 4-byte-per-note `ORGTAB` data IS editable in principle, but per-note *pitch* is realised by self-modifying RAM code (`RDELAY`). Editing tunes without editing pitches is a half-feature; full pitch editing needs an in-browser 6800 assembler we deliberately don't ship.

After Phase 9, **every Williams Defender engine that has a parameter record in the ROM is editable in WSED**.

---

## Deferred to v-future (recorded here so the trade-off is visible):

- ~~**Adding new waveforms (extending GWVTAB).**~~ ✅ **Shipped 2026-05-28** — see Phase 5b row above. The exact mechanic the feasibility analysis predicted: `LDX #GWVTAB` operand patched at the single CE-opcode site per game (Defender `$FBA8`, Stargate `$FB7E`, Robotron `$FA03`), new GWVTAB byte-built in `engine/gwaveEdit.ts` (`buildExtendedGwvtab`), laid out right after the VVECT extent in the free RADIO/ORGAN region. `CustomProject.addedWaveforms?: number[][]` (idx 7..15), capped at 9 entries. Layout overflow throws "Won't fit" with a byte-overrun count.
  - **Polish, 2026-05-28:** **× Remove** waveform (drops the entry, re-clamps every GWAVE slot's WAVE# via `reclampWaveformIdxAfterRemoval` — at→stock `$06`, above→`w-1`, below→untouched) + **ROM-space indicator** (`· ROM X/Y B (N free)` next to the item count; yellow under 20 B free, red when over; backed by new headless `computeBudget` in `engine/customRom.ts` so the indicator and the "Won't fit" guard share one source of truth) + **↻ Reset record** in the editor label row (per-slot `record ← start` revert; works for both VARI + GWAVE; disabled until edited). +12 tests, 532 total. Capture entries `designer-gwave-remove-waveform` + `designer-vari-reset-record`.
- ~~**Adding new GWAVE command codes.**~~ **Dropped 2026-05-28 after a dispatcher spike re-evaluation.** The plan's earlier framing ("Robotron uses JMPTBL and is actually easier — just append a JMPTBL entry") conflated two things: Robotron's JMPTBL band is the *middle* band (LFSR/SCREAM/etc), not GWAVE. Robotron's GWAVE dispatch is *already* wired for the upper half (commands `$20..$2B` → SVTAB rows `$0F..$1A`, all populated), so there are **no free command codes on Robotron** — every code in `$01..$3F` is a live sound, so "adding" one is just override-in-place (which we already do).

  On Defender / Stargate the path is real but substantial: the dispatcher's GWAVE branch is `CMPA #$C; BHI IRQ10` (dense, no spare BLS slot), so adding new GWAVE-bound codes requires (a) a JMP-to-free-ROM **trampoline** (~20 bytes, replacing 3 bytes at `IRQ20`'s entry to redirect codes `$20..$3F` through a sub-band check before VARI), (b) **SVTAB relocation** into the same free RADIO/ORGAN region (SVTAB sits at `$FEEC` followed by GWAVE pattern data; can't extend in place), and (c) a new `LDX #SVTAB` repoint per game (mirror of the `LDX #GWVTAB` patch from Phase 5b).

  Cost: ~6–8 hours; the trampoline + relocated SVTAB compete for the same 215-byte Defender free region that VVECT extension + relocated GWVTAB already share — adding new codes meaningfully tightens the budget. Value: niche (the override-in-place mechanic already lets users author a new sound that *plays on an existing trigger*; the "want a new code too" need is narrow). The Phase 6 "fork-the-game" workflow delivers most of the practical "make new sounds for the games" value without this complexity. **Not on the roadmap.**

**Docs — compare to the existing Sound Designer — ✅ done (2026-05-28):** `MANUAL_DESIGNER.md` has a "How it compares to the original Sound Designer" table, and `README.md` carries a condensed summary. The brief: **compare features + approach against msarnoff's Defender Sound Studio** (`docs/sound_studio_reference.md`): what we match (tweakable original presets, oscilloscope/FFT, JSON import/export, per-handler tooltips) vs. where we differ — real cycle-accurate emulator running the **actual ROMs** (not a per-routine JS hand-port), **all three games** (Studio is Defender-only), **data-driven authoring** (edit the parameter record; no assembler), the true Custom ROM with its own item list, and the visualizations the Studio lacks (DAC byte tape, swimlane, LFSR/state traces, RAM heatmap, A/B diff). Add a condensed version of that comparison to **`README.md`**.

---

## References

- Code: `explorer/src/engine/variEdit.ts`, `explorer/src/web/designer/*`, `explorer/src/web/ui/modeToggle.ts`.
- Docs: `docs/designer_implementation.md`, `MANUAL_DESIGNER.md` (user manual), `docs/00_INDEX.md` (project state).
- Research (private): `research/findings_designer_feasibility.md`, `research/findings_{defender,robotron}_sound.md`.
- Prior art: `docs/sound_studio_reference.md` (+ `research/findings_sound_studio.md`).
