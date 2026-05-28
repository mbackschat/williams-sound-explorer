# Designer mode — implementation state

> Home for the **Sound Designer** mode's implementation (module map, decisions, the VARI/VVECT reference, recipe schema, tests). This plays the role `explorer_implementation.md` plays for the explorer; read it first when resuming Designer work. User-facing how-to lives in [`MANUAL_DESIGNER.md`](../MANUAL_DESIGNER.md); the raw "why this is even possible" findings live in the private `research/findings_designer_feasibility.md`.

## What it is

A **separate top-level mode** (Explore ↔ Design toggle in the header) for building a **custom ROM with its own item list** of **VARI** sounds: pick an *engine base* (Defender or Stargate), then copy any game's VARI sound or add a new one into your list, edit each one's 9-byte parameter record with labelled sliders, audition, A/B against its starting point, and save. Sounds map to command codes `$1D`+ by list order; the runnable image is reconstituted from the user's base ROM (`buildCustomRom`) and runs through the real emulator unchanged.

**Scope:** engine = **VARI only**; engine base = **Defender/Stargate** (Robotron's dispatch is non-linear). Capacity 23 (Defender) / 30 (Stargate) sounds. Live worklet pause/step/scrub on a custom ROM ships via the **Open in Explore** handoff (the custom ROM is pushed into Explore's existing worklet; see [Audition handoff](#open-in-explore--live-worklet-audition-via-explore) below). Other engines (GWAVE/SCREAM/ORGAN) and Robotron as engine base remain fast-follows (see end).

**History:** v1 shipped first as *override-in-place* (edit a base game's existing VARI commands, marked ●). The user-chosen direction superseded it with the own-item-list model above; legacy v1 projects auto-convert on load (`designerStore.ts`).

## The two facts it rests on

1. **A Williams sound is *data*, not bespoke code.** A VARI command is just a 9-byte record in the ROM's `VVECT` table that the shared VARI engine kernel consumes — so "designing" one means rewriting 9 bytes, **no in-browser assembler**. (Full taxonomy + evidence: `research/findings_designer_feasibility.md`.)
2. **The emulator already runs raw ROM bytes.** `runSoundWithRom(game, romBytes, cmd)` (`engine/runner.ts`) renders any command from a `Uint8Array`. Feed it an *edited* image and the custom sound renders through the exact offline pipeline `web/ui/wavExport.ts` uses.

## Key decisions

- **Separate mode, zero Explore-UI change.** The only addition to the Explore surface is the header mode toggle; Design renders into its own `#designer-root` (Explore's `#pageLayout` is hidden, untouched). The designer module is **lazily imported** on first switch to Design (own JS+CSS chunk), so Explore's initial bundle is unaffected.
- **No 4th `GameKind`.** The custom project is `{ baseGame, edits }`; audition runs **offline** via `runSoundWithRom(baseGame, editedBytes, cmd)` — the edited image is base-game bytes with 9 VVECT bytes rewritten, so `SoundBoard`'s size check passes and the base game's memory layout/decoders apply. This avoids threading `"custom"` through glossary / labelMap / zeroPageMap / romValidate / onboarding / the switcher / QuizPanel.
- **Recipe, not bytes.** The saveable artefact is a JSON recipe (parameter edits over a base game), persisted to IndexedDB — **no copyrighted ROM bytes are ever stored**, consistent with the locked user-supplied-ROM decision. The runnable image is reconstituted from the user's base ROM at load. JSON export/import falls out for free.
- **Audition = offline render + play**, through a dedicated `AudioContext`/`AudioBufferSource` (separate from the Explore worklet host). Transport: **Play** (restart) · dedicated **Pause/Resume** (context suspend/resume) · **Loop** · **Source ⟨Edited│Original⟩** toggle (instant A/B) · **Diff** overlay toggle · auto-replay on edit · a playhead synced to playback. For *live* pause/step/scrub on the custom ROM, the **▶ Open in Explore** button pushes the built image into Explore's existing worklet (`host.loadCustomRom` posts the worklet's existing `load` message with the custom bytes; the runner reboots in place, no new audio graph). Avoids the 4th-GameKind decision and reuses every Explore visualisation for free.

## Module map

Headless (DOM-free, in the `tsconfig.core.json` gate):
- `explorer/src/engine/variEdit.ts` — the pure ROM-patch core: `VVECT_BASE`, `VVECT_STRIDE`, `VARI_FIELDS`, `variCommandsFor`, `readVariRecord`, `patchVariRecord`, `getField`/`setField`, `VariRecipe`, `applyRecipe`.
- `explorer/src/engine/customRom.ts` — **v-next** custom-ROM image builder: `buildCustomRom(baseRom, game, slots)` + `maxSlots`/`VARI_CMD_BASE`. Given VARI slots `{ code, record }`, emits a runnable image (widen the command mask if any code > `$1F`; extend `VVECT` in place; `row = code − $1D`). Defender/Stargate only. (Tests: `tests/customRom.test.ts`.)

Browser (`explorer/src/web/`):
- `designer/designerMode.ts` — `mountDesigner(root, ctx)`: the orchestrator (engine-base picker, the **item list** with +New / +Copy-from-any-game / rename / remove, editor on the selected sound, audition via `buildCustomRom`, transport with Edited/Start A/B + Diff, save/open/export/import). Imports `designer.css`.
- `designer/variEditor.ts` — `buildVariEditor(onChange)`: the 8-field slider panel (reuses the explore `.param-row` markup/CSS).
- `designer/audition.ts` — offline render + playback transport: `renderSound`, `playSamples(samples, vol, loop)`, `pauseResume`/`stopPlayback`/`setLoop`, `playbackState`/`playbackProgress`/`onPlaybackState`, `drawWaveform`/`drawDiff`/`drawPlayhead`/`durationMs`.
- `designer/designerStore.ts` — `CustomProject` IndexedDB CRUD (`listProjects`/`getProject`/`saveProject`/`deleteProject`) + pure `exportJson`/`importJson` (validated), and **legacy v1 recipe conversion** on load. Dedicated DB `williams-sound-designer` (decoupled from `romStore`).
- `designer/designer.css` — scoped styling (lazy-loaded with the module).
- `ui/modeToggle.ts` — `initModeToggle(ctx)`: the Explore↔Design toggle + lazy mount.
- Wiring: `index.html` adds the `.mode-bar` toggle + empty `#designer-root`; `web/main.ts` calls `initModeToggle(ctx)` alongside the other controllers.

**Audition handoff** (Open in Explore):
- `web/host.ts` — `loadCustomRom(game, rom: Uint8Array)`: posts the existing worklet `{type:"load", game, rom}` with the custom bytes. Worklet reboots its `RealtimeRunner` in place; audio graph untouched.
- `web/main.ts` — `auditionCustomRom(spec)` (exposed via `AppContext`): if the worklet isn't already on `spec.baseGame`, switches first; then calls `host.loadCustomRom` and `fire(spec.cmd)`. Tracks `customRomActive` + creates a dynamic **`.game-pick-custom`** entry in `#gameSwitcher` on first call (purple **✎ Custom: ⟨name⟩**); its click handler re-runs `spec.rebuild()` to pick up Design-mode edits made since the last hand-off. Clicking any base-game button clears `customRomActive` and reloads the stock ROM.
- `web/ui/modeToggle.ts` + `AppContext.switchToExploreMode()` — Design's button calls this after the audition is queued, which clicks `#modeExplore` and shows the explore layout.

## VARI / VVECT reference

`VVECT` table start (record stride = 9 bytes), from the label-map JSON:

| Game | VVECT base |
|---|---|
| Defender | `$FD76` |
| Stargate | `$FD3C` |
| Robotron | `$FC08` |

ROM array offset = `(VVECT_BASE + row*9) − (0x10000 − rom.length)` (ROM occupies the top of the 64K space).

**9-byte record layout** (verified against `VSNDRM*.SRC`; SAW = `$40 01 00 10 E1 00 80 FF FF`, whose `$0080` SWPDT proves the 16-bit field is big-endian, hi@5/lo@6):

| Byte | Field | Notes |
|---|---|---|
| 0 | LOPER | low-cycle period |
| 1 | HIPER | high-cycle period |
| 2 | LODT | low-period sweep delta (signed) |
| 3 | HIDT | high-period sweep delta (signed) |
| 4 | HIEN | high-end threshold |
| 5–6 | SWPDT | sweep-duration countdown, 16-bit **big-endian** |
| 7 | LOMOD | low-modulation (signed) |
| 8 | VAMP | amplitude / DAC level |

**Editable commands → VVECT row** (`SP1`/`CABSHK` at row 3 is excluded — it has bespoke caller code that recomputes LOPER per trigger, so it is not pure-data-authorable):

| Game | Commands |
|---|---|
| Defender / Stargate | `$1D` SAW→0, `$1E` FOSHIT→1, `$1F` QUASAR→2 |
| Robotron | the above **+** `$3F` MOSQTO→5 |

## Recipe (saved project) schema — `CustomProject`

```jsonc
{
  "name": "my game",
  "engineBase": "defender",        // defender | stargate (which VARI engine runs)
  "slots": [                       // ordered → command codes $1D, $1E, …
    { "name": "Thunder",
      "record": [64,1,0,16,225,0,128,255,255],   // current 9 bytes
      "start":  [64,1,0,16,225,0,128,255,255] }  // starting point (for A/B)
  ],
  "createdAt": 0, "updatedAt": 0
}
```

`importJson` validates: engine base is Defender/Stargate, `slots.length ≤ maxSlots(engineBase)`, each slot has a name + a 9-byte record (0..255). A legacy v1 recipe (`{ baseGame, edits }`) is converted to slots (each edited command → a named slot).

## Tests

- `explorer/tests/variEdit.test.ts` (21) — VVECT addresses vs the label-map JSON; read/patch round-trips; `getField`/`setField` big-endian SWPDT; `applyRecipe` idempotent + order-independent; a golden assertion reading SAW's real bytes from the dev Defender ROM.
- `explorer/tests/gwaveEdit.test.ts` (35) — SVTAB + GWVTAB addresses vs the label-map JSON; nybble-packed `getField`/`setField`; read/patch round-trips for SVTAB *and* waveform bytes; `waveformUsers` against the real Defender ROM (every reported user has the right WAVE# nybble; no command listed under more than one idx); golden assertion reading HBDV's real bytes.
- `explorer/tests/customRom.test.ts` (~19) — validation guards (hermetic) + behavioural proof on the real ROMs that each slot's command renders its record (VARI mask-widen path, GWAVE SVTAB-in-place path, mixed builds), plus Phase 5 step 2 waveform overrides (override-only builds, mixed-with-slot builds, byte-level read-back). Compares **DAC value sequences** (record-determined, command-code-independent).
- `explorer/tests/designerStore.test.ts` (~17) — `CustomProject` JSON round-trip + validation: VARI slots, GWAVE slots (round-trip + Robotron-base + duplicate-target rejection + non-editable target rejection), v1 + v2 on-disk migrations, and `waveformOverrides` (round-trip, absent field, malformed/range rejection, standalone-no-slots projects).
- Full suite: **479 tests**; `npm run typecheck` passes both the full project and the DOM-free core gate (`variEdit.ts`/`gwaveEdit.ts`/`customRom.ts` stay headless).
- Browser-flow regression coverage lives in the Playwright capture manifests (`explorer/e2e/capturesDesigner.ts`); see `docs/web-capture.md`. Transient flow smokes go to `explorer/e2e/smokes.ts` per the CLAUDE.md convention.

## Open in Explore — live-worklet audition via Explore

The in-Design audition is offline (render → buffer → play). For *live* pause/step/scrub + every Explore visualisation on the custom ROM, the **▶ Open in Explore** button hands the audition to Explore's worklet rather than duplicating it inside Design:

```
Design mode                              AppContext                Explore (main.ts)
─────────                                ──────────                ──────────────────
buildCustomRom(slots) → bytes ──── auditionCustomRom(spec) ──→ switchToGame(baseGame) if needed
                                                                host.loadCustomRom(bytes)   // worklet posts {type:"load"}
                                                                host.fire(spec.cmd)         // play the selected slot
                                                                ensureCustomSwitcherBtn()   // dynamic ✎ Custom entry
                                  ←── switchToExploreMode() ── click #modeExplore
                                                                user lands in Explore, custom ROM running
```

Why this shape:
- **Reuses the worklet's existing `load` protocol.** The worklet already rebuilds its `RealtimeRunner` on every `{type:"load"}` — sending the custom bytes is a one-line addition (`host.loadCustomRom`), no new messages, no graph rebuild.
- **No 4th `GameKind`.** Explore stays pointed at the base game's glossary / labelmap / zero-page metadata; the worklet just runs the swapped bytes. Custom slots at codes `≥ $20` aren't in Explore's chip row, so Design fires them directly via `host.fire(cmd)` instead of expecting a chip-click.
- **Visible source.** The dynamic `.game-pick-custom` entry in `#gameSwitcher` (purple, prefixed with `✎`) tells the user which ROM the worklet is *actually* running — base game vs. their custom image. Clicking a base game button reloads the stock ROM and clears `customRomActive`; clicking the Custom entry re-runs the project's rebuild closure (edits made in Design since the last hand-off are picked up).

## GWAVE editor — Phase 5 step 1 (shipped)

GWAVE slots **override an existing GWAVE command's 7-byte SVTAB record in place** (the model differs from VARI because GWAVE has no spare command codes — its dispatcher is a hardcoded branch tree). A project can mix VARI new-sound slots (yellow `$XX VARI`) and GWAVE override slots (purple `$XX GWAVE`) freely. Robotron unlocks as an engine base for GWAVE-only projects: in-place SVTAB patching needs no dispatcher widen.

**Module map (additions in this step):**

- `engine/gwaveEdit.ts` — `SVTAB_BASE` per game (Defender `$FEEC`, Stargate `$FEEA`, Robotron `$FE45`), `SVTAB_STRIDE=7`, `GWAVE_FIELDS` (9 logical fields, nybble-aware), `gwaveCommandsFor` ($01..$0D editable on every game), `readGWaveRecord`, `patchGWaveRecord`, `getField`/`setField`.
- `engine/customRom.ts` — `CustomSlot` is now a discriminated union `VariSlot | GwaveSlot`. `buildCustomRom` partitions, applies VARI extensions, then patches SVTAB rows in place for GWAVE. Robotron is supported for GWAVE-only builds.
- `web/designer/gwaveEditor.ts` — 9-row slider panel mirroring `variEditor.ts` (WAVE# is a `0..6` select with named labels: GS2 / GSSQ2 / GS1 / GS12 / GSQ22 / GS72 / GS1.7).
- `web/designer/designerMode.ts` — `Override GWAVE:` select in the items header (greys out codes already taken); slot-kind-aware editor swap + item-list rendering; engine-base picker accepts Robotron (with VARI controls gated off there). `.designer-new` class added so capture-harness reset can click it.
- `web/designer/designerStore.ts` — `CustomProject.slots` is a `(VariCustomSlot | GwaveCustomSlot)[]` discriminated union; legacy v1 (`{ baseGame, edits }`) and v2 (no-`kind` slots) both auto-migrate as VARI on load.

**Schema (Step 1):** GWAVE slots carry `{ kind: "gwave", name, record, start, targetCmd }`. The `targetCmd` is the base game's command code being overridden ($01..$0D). VARI slots stay `{ kind: "vari", name, record, start }`.

**Editing reach:** Step 1 makes every byte of SVTAB editable (the 9 logical fields). Step 2 adds editable **waveform bytes** (GWVTAB) via a click-to-draw canvas. Step 3 (still pending) adds editable **pitch-pattern bytes** (GFRTAB).

**Tests:** `gwaveEdit.test.ts` (35, incl. golden assertions reading real HBDV bytes + verifying the 7 stock waveforms' length/offset layout against the dev Defender ROM), `customRom.test.ts` (10 GWAVE-related: SVTAB override, mixed VARI+GWAVE, Robotron GWAVE, no-mask-touch when only GWAVE present, malformed/non-editable rejection, waveform overrides, mixed VARI+GWAVE+waveform), `designerStore.test.ts` (GWAVE round-trip, Robotron base, duplicate-target rejection, v2 migration, waveformOverrides round-trip / validation / standalone). Full suite **479**.

**Capture entries (`e2e/capturesDesigner.ts`):** `designer-gwave-overview` (item list with a `$05 GWAVE` slot + the SVTAB editor panel + the Step 2 waveform canvas + "Shared by" line + offline-rendered scope) and `designer-gwave-audition-explore` (Open-in-Explore handoff; the custom-ROM SVTAB override at $05 plays in Explore with the chip-row overlay).

## GWAVE editor — Phase 5 step 2 (shipped)

Adds a **click-to-draw waveform canvas** below the SVTAB sliders. The canvas shows the resolved bytes for the slot's current `WAVE#`: the project's override if any, else the base ROM's stock GWVTAB entry. Drawing emits an `onWaveformDraw(idx, bytes)` callback that the host writes into `project.waveformOverrides[idx]`; the audition auto-replay picks it up.

**Sharing semantics surfaced in the UI:** the 7 stock waveforms are referenced by index, not per-command — so editing GS1 (idx 2) affects every command whose SVTAB byte-1 low-nybble = 2. The canvas label includes a *"Shared by: $XX NAME, $YY NAME — your edits affect every one."* line driven by `waveformUsers(baseRom, game, idx)`; a *"Reset to stock"* button reverts the override for that index. No copy-on-edit in this step — that would require GWVTAB extension and is part of the v-future *new waveforms* item.

**Module additions:**

- `engine/gwaveEdit.ts` gains `GWVTAB_BASE` per game, `STOCK_WAVE_LENGTHS` (`[8, 8, 16, 16, 16, 72, 16]`), `STOCK_WAVE_SAMPLE_OFFSETS` (derived from the lengths, verified against the real Defender ROM: `[1, 10, 19, 36, 53, 70, 143]`), `STOCK_WAVE_NAMES` (GS2 / GSSQ2 / GS1 / GS12 / GSQ22 / GS72 / GS1.7), `readWaveform`, `patchWaveform` (length must match stock), and `waveformUsers` (drives the "Shared by" UI).
- `engine/customRom.ts` `buildCustomRom` gains an `options?: { waveformOverrides?: Record<number, number[]> }` parameter; overrides apply after VARI/GWAVE slot work, in place at each waveform's existing offset. A build with only waveform overrides (no slots) is permitted — it's a valid project that retunes the base game's existing GWAVE timbre.
- `web/designer/gwaveEditor.ts` gains a canvas with mouse-down/move/up drawing, a label showing the current `idx NAME (N bytes) [· edited]`, the "Shared by" line, and a Reset-to-stock button. The host wires three callbacks: slot-record edit (existing), `onWaveformDraw(idx, bytes)`, `onWaveformReset(idx)`.
- `web/designer/designerMode.ts` adds `refreshWaveformCanvas()` that resolves bytes (override or stock) + `sharedBy` users + an `isOverridden` flag, and threads `project.waveformOverrides` through `buildEdited()`'s `buildCustomRom` options.
- `web/designer/designerStore.ts` `CustomProject.waveformOverrides?: Record<number, number[]>` (optional); legacy v1/v2 shapes import without it (no migration needed — the field is absent for older projects). JSON round-trip + validation (idx range, byte-length, byte-range).

**Tests added by Step 2:** 12 new in `gwaveEdit.test.ts` (constants + readWaveform/patchWaveform/waveformUsers), 4 in `customRom.test.ts` (waveform-only build, mixed-with-slot build, error paths), 4 in `designerStore.test.ts` (round-trip, absent field, malformed, standalone). **+20 tests**, 479 total.

**Why these byte edits don't break pointers:**
- GWLD2/3 walks GWVTAB by `length+1` bytes per record. Since `length` is unchanged, the walk lands at the same position for every idx.
- SVTAB byte-6 (pattern offset into GFRTAB) doesn't touch GWVTAB — so it's irrelevant here.

## GWAVE editor — Phase 5 step 3 (shipped)

Adds a second click-to-draw canvas below the waveform canvas: the **pitch-pattern canvas**. It shows the resolved bytes at the slot's current `(PATOFF, PATLEN)` — the project's override if any, else the base ROM's bytes — and emits `onPatternDraw(offset, bytes)` per stroke. The host writes those into `project.patternOverrides[offset]` and rebuilds the custom ROM.

**Sharing semantics surfaced in the UI:** patterns are *byte-addressed*, not index-addressed — SVTAB byte-6 (`PATOFF`) is a raw GFRTAB offset and byte-5 (`PATLEN`) the read length, so two commands' pattern ranges may overlap. The canvas's *"Shared by:"* line is driven by `patternUsers(baseRom, game, offset, length)` and lists every editable command whose range overlaps the slot's (excluding the slot's own `targetCmd`). A *"Reset to stock"* button clears the project's override at that `PATOFF`. When `PATLEN = 0` (no pitch sweep) the canvas renders an empty-state hint.

**Module additions:**

- `engine/gwaveEdit.ts` gains `GFRTAB_BASE` per game (Defender `$FF55`, Stargate `$FF53`, Robotron `$FF02`), `gfrtabMaxEnd(game)` (largest safe offset+length, stopping before the 6802 reset vector at `$FFFE`), `readPattern` / `patchPattern` (any length 1..255 in GFRTAB bounds), and `patternUsers(offset, length)` (overlap-not-equality — drives the "Shared by" warning).
- `engine/customRom.ts` `BuildOptions` gains `patternOverrides?: Record<number, number[]>` (key = GFRTAB offset; value's length = how many bytes to write; overlapping overrides apply in iteration order, last write wins). Builds with only pattern overrides (no slots) are allowed.
- `web/designer/gwaveEditor.ts` gains a second canvas (teal vs the waveform's purple), a *Pitch pattern — PATOFF $XX / PATLEN N · edited* label, the "Shared by" line, and a Reset-to-stock button. New API: `setPattern(bytes, sharedBy, isOverridden)`, `currentPatternOffset()`, `currentPatternLength()`.
- `web/designer/designerMode.ts` adds `refreshPatternCanvas()` that resolves bytes (override or stock — with a partial-override fallback that fills any uncovered tail from base when the user changed `PATLEN` after editing), computes `sharedBy` excluding the slot's `targetCmd`, and threads `project.patternOverrides` through `buildEdited()`'s `buildCustomRom` options.
- `web/designer/designerStore.ts` `CustomProject.patternOverrides?: Record<number, number[]>` with JSON round-trip + validation (offset 0..255, length 1..255 in-bounds, byte range).

**Tests added by Step 3:** 11 new in `gwaveEdit.test.ts` (GFRTAB constants vs the label-map JSON, golden BBSV/HBDV pattern bytes against the real Defender ROM, readPattern/patchPattern bounds, `patternUsers` overlap correctness), 4 in `customRom.test.ts` (pattern-only build, mixed VARI+GWAVE+waveform+pattern, error paths), 5 in `designerStore.test.ts` (round-trip, absent field, malformed/range, standalone, mixed). **+20 tests**, 499 total.

**Why these byte edits don't break pointers (step 3):**
- `PATLEN` (SVTAB byte 5) is **not** modified by this step — kernel reads still consume exactly the bytes the user drew.
- Patterns can be edited at *any* `(offset, length)` valid in GFRTAB, but the bytes are written *at the existing offset*. No relocation; the dispatcher and SVTAB pointers are untouched.

## Fast-follows (not yet built)

- **Adding new waveforms / new GWAVE codes** — both feasible, deferred to v-future (see `plans/designer-mode.md` § Phase 5 deferrals for the feasibility analysis).
- **Robotron as engine base for VARI** — its non-linear dispatch (`JMPTBL` pointer table + the `$3F` `SUBA #$39` special-case) needs different patching than the Defender/Stargate linear band. (GWAVE on Robotron *is* supported now since it's in-place SVTAB patching.)
- **SCREAM / novel synthesis** — SCREAM has no preset record (not data-authorable); ORGAN tunes are editable but realised via self-modifying code. Genuinely new DSP needs an assembler — out of scope.

## The true Custom ROM (shipped) — how it works

**The model.** A Custom ROM with **its own item list**: copy VARI sounds **from any game** (e.g. some from Defender, some from Robotron), modify them, **and add brand-new ones** — each in its own named slot. The "engine base" is just *"which game's VARI engine to run on."* (This superseded the original v1 *override-in-place* model.)

**Why it's feasible.** A VARI sound is *fully* defined by its 9-byte `VVECT` record, and the VARI kernel is the same algorithm in all three games, so a record is **portable** — copying across games is just copying 9 bytes (proof: Robotron's `MOSQTO` record is byte-identical to Defender's `QUASAR`). So a Custom ROM = one base game's **VARI engine code** (reused, read-only) + **a custom `VVECT` table** (records from anywhere, or new) + **a dispatcher that exposes your command codes**. No assembler.

**The dispatcher gate — spiked and confirmed (2026-05-28).** Defender's IRQ dispatch is a clean linear range: after the `ANDA #$1F` command mask and the `DECA`, any value `> $1B` routes to VARI with `VVECT row = A − $1C`. So the *only* thing capping VARI at 3 reachable rows is the 5-bit mask. Spike result on the real Defender ROM:
- The mask `COMA;ANDA #$1F` sits uniquely at ROM **`$FCBD`**; patching the operand **`$1F → $3F`** (one byte) unlocks command codes `$20–$3F`, all routing to VARI with `row = (cmd−1) − $1C` → **~33 extra slots**, bounded only by `VVECT`-table space.
- Verified: with that one byte patched and `QUASAR`'s record copied into `VVECT` row 4, command **`$21` plays that sound byte-for-byte identically** to the real `$1F` (5512 DAC events, 2 363 696 cycles), while `$21` on the unpatched ROM plays a different (GWAVE) sound — i.e. the patch is what unlocked the new slot.
- The shipped builder (`customRom.ts`) **extends `VVECT` in place** rather than relocating: the 2 KB ROMs have no free region (longest constant-byte run is 5 bytes), so the table grows over the disposable RADIO/ORGAN tables and stops before `GWVTAB` (capacity 23 Defender / 30 Stargate). No `VARILD` repoint needed.

**Recommended base = Defender (or Stargate).** Its VARI dispatch is a clean `A − $1C`, so widening the mask linearly exposes rows. Robotron is 6-bit already but special-cases `$3F` (`SUBA #$39`) and routes part of the space through a `JMPTBL` pointer table — less linear, so messier to grow. Raw byte-level mechanics: `research/findings_designer_feasibility.md`.

**Boundaries.** Clean for **VARI-only**. Cross-engine mixing (GWAVE/SCREAM/ORGAN into the same custom ROM) is a further step: GWAVE also needs its `GWVTAB`/`GFRTAB` tables copied along; SCREAM has no record (not data-authorable); ORGAN is code-as-data. The base ROM already *contains* all six engines' code, so engines are present — but per-engine authoring complexity remains.

**Build order:** (1) ✅ **done** — `engine/customRom.ts` productizes the image build (`buildCustomRom`), tested. The base ROMs are densely packed (longest constant-byte run is 5 bytes — no room to relocate `VVECT`), so the table is **extended in place** over the disposable RADIO/ORGAN tables, capped before the GWAVE tables: capacity **23 rows** Defender (`$FD76`→`GWVTAB $FE4D`), **30 rows** Stargate (`$FD3C`→`GWVTAB $FE4B`); the mask is only widened when a slot code exceeds `$1F`. (2) ✅ **done** — the Designer UI is the own-item-list model (`designerMode.ts` + `CustomProject` in `designerStore.ts`): engine-base picker, +New / +Copy-from-any-game / rename / remove, auto command codes, audition/A/B via `buildCustomRom`, save/export.
