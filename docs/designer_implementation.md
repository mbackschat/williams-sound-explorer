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

Adds a **pitch-pattern canvas** as a third sibling to the SVTAB sliders and the waveform canvas (3-column grid: sliders | waveform | pitch — see § *Phase 5 layout redesign* below). It shows the resolved bytes at the slot's current `(PATOFF, PATLEN)` — the project's override if any, else the base ROM's bytes — and emits `onPatternDraw(offset, bytes)` per stroke. The host writes those into `project.patternOverrides[offset]` and rebuilds the custom ROM.

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

## Phase 5 layout redesign (shipped 2026-05-28)

The original Designer layout dedicated half the screen to a tall audition scope and stacked the SVTAB sliders / waveform canvas / pitch canvas vertically — pushing the transport row below the viewport fold on a 1080-tall window, so `▶ Open in Explore` needed a scroll to reach. The redesign:

- **`▶ Open in Explore` lives in the sticky transport row** at the right end. (We tried the header bar briefly during the redesign — user feedback was that it belongs visually with the audition controls; the sticky transport already guarantees it stays in view.)
- **3-column edit row for GWAVE**: sliders | waveform canvas | pitch canvas, sized so each canvas column can grow up to ~600 px (gives ~2.4 px/cell at the worst v-future case of a 255-byte waveform — still drawable). VARI slots show only the sliders column.
- **Audition scope is now a thin full-width strip** (120 px tall) below the edit row, replacing the half-screen tall right column. The trace is a static offline render anyway — a strip is plenty.
- **Sticky single-row transport** at the bottom of `#designer-root` (`position: sticky; bottom: 0;`): Play · Pause · Loop · Source · Diff · Vol, glued to the viewport bottom when the editor exceeds window height.
- **`gwaveEditor.ts` API split**: `slidersEl` / `waveformPanelEl` / `patternPanelEl` instead of a single combined `el`, so the host (`designerMode.ts`) can place the three panels independently in the grid. Internal canvas resolution bumped to 1200×200 for crisp rendering at the larger CSS widths.

Result on a 1920×1080 viewport: the entire editor — header + items + 3-column edit row + audition strip + transport — fits with no scroll. Tests + capture entries are unchanged (the manifest entries assert *behaviour*, not pixel layout); `designer-gwave-overview.png` and `designer-gwave-audition-explore.png` were regenerated.

## Phase 5b — Adding new waveforms (shipped 2026-05-28)

Beyond the 7 stock waveforms, a project can carry up to **9 user-added waveforms** (idx 7..15 — the rest of the WAVE# nybble's range). When `addedWaveforms` is non-empty the builder **relocates the whole GWVTAB** into the free RADIO/ORGAN region of the ROM and **repoints `LDX #GWVTAB`** to that fresh address — a single 2-byte operand patch per game. Stock-idx overrides (Step 2) are folded into the relocated table so the in-place patch path doesn't double-write.

**Headless additions** (`engine/gwaveEdit.ts`):
- `LDX_GWVTAB_LOC` — the CPU address of the `CE` opcode whose operand is GWVTAB (Defender `$FBA8`, Stargate `$FB7E`, Robotron `$FA03`). Located by scanning each ROM for `CE <hi> <lo>` where `<hi><lo>` is `GWVTAB_BASE`; exactly one match per game.
- `DEFAULT_NEW_WAVE_LENGTH = 16` — matches the most-used stock size.
- `MAX_WAVE_IDX = 15` — the WAVE# nybble's range.
- `buildExtendedGwvtab(rom, game, stockOverrides, addedWaves)` — emits the new GWVTAB byte sequence: stock 7 (with overrides applied) followed by user-added entries (each `[length, …samples]`). Tests cover identity (stock-only round-trip), overrides, appended waves, and the length/byte/range guards.
- `extendedGwvtabSize(addedWaves)` — pre-flight size in bytes; `159 + sum(1 + addedWaves[k].length)`.

**Custom-ROM builder** (`engine/customRom.ts`):
- `BuildOptions.addedWaveforms?: number[][]` — ordered list mapped to idx 7..15. Capped at 9 (`WAVE#` is a 4-bit nybble). Empty/absent = the in-place Step 2 patch path stays; *any* entry = relocation path activates.
- Relocation layout: VVECT first (extent = `max(27, (maxRow+1)*9)`); new GWVTAB right after. Free region = `GWVTAB_BASE[game] - VVECT_BASE[game]` (215 bytes on Defender, 271 on Stargate, 298 on Robotron). Throws `"Won't fit …"` with the overrun byte count if exceeded.
- `LDX #GWVTAB` operand at `LDX_GWVTAB_LOC[game] + 1` is rewritten in place; one CE-opcode site per game (verified golden test).

**Schema** (`web/designer/designerStore.ts`):
- `CustomProject.addedWaveforms?: number[][]` — top-level ordered list. JSON round-trip + validation: at most 9 entries, each 1..255 bytes in 0..255 range. v1/v2/v3 on-disk shapes import without the field (`undefined`).

**Designer UI** (`web/designer/gwaveEditor.ts` + `designerMode.ts`):
- **+ New waveform** button under the waveform canvas — appends a 16-byte sine-seed wave, switches the slot's `WAVE#` to it, refreshes the canvas. Hidden when `addedWaveforms.length === 9` (cap reached).
- `setMaxWaveIdx(maxIdx)` clamps the `WAVE#` slider's `max` attribute to the existing wave count so the user can only pick indices that exist.
- Canvas label distinguishes stock (`Waveform — 4 GSQ22 (16 bytes)`) from user-added (`Waveform — 7 user-added (16 bytes) · user-added`).
- WAVE# slider readout shows `7 (user-added)` for added indices.

**Tests added by Phase 5b:** 10 new in `gwaveEdit.test.ts` (constants + `buildExtendedGwvtab` identity / overrides / appended / rejection + `extendedGwvtabSize`), 5 in `customRom.test.ts` (LDX patch present/absent / idx 7 reads user bytes / mixed with VARI / "won't fit" overrun / nybble cap), 5 in `designerStore.test.ts` (round-trip, absent, malformed, standalone, kitchen-sink with all four override channels). **+20 tests**, 520 total.

**Capture entry:** `designer-gwave-added-waveform` exercises **+ New waveform** in the GWAVE override flow and shoots `#designer-root` — the slot's WAVE# is at 7, the canvas reads "user-added (16 bytes)", and the audition replays a non-stock trace.

**Why these byte+code edits don't break pointers:**
- Stock GWVTAB stays untouched if `addedWaveforms` is empty (in-place Step 2 path).
- When relocated, **only `LDX #GWVTAB`'s operand changes** (one instruction patched); SVTAB, GFRTAB, and every other ROM pointer are untouched.
- VVECT extension still works alongside relocation (rows-required + new-GWVTAB-size budget checked together — the builder throws cleanly when both want to grow beyond the free region).

## Phase 5b polish — × Remove + ROM-space indicator + ↻ Reset record (shipped 2026-05-28)

Three follow-ups on Phase 5b closing the add/edit/remove triad, surfacing the layout budget *before* a build throws, and adding a commit-able revert for the parameter record:

**× Remove waveform** — a per-added-wave button next to **Reset to stock** and **+ New waveform** in the waveform-canvas panel. Visible only when the canvas is on a user-added idx (≥ 7); hidden on stock waves where Reset already covers "undo my edit". The headless half is `reclampWaveformIdxAfterRemoval(record, removedIdx)` in `engine/gwaveEdit.ts` — pure SVTAB-byte-1 nybble math used to fix up every GWAVE slot whose `WAVE#` pointed at the dropped entry:

| Slot's `WAVE#` was… | After removing idx `R` |
|---|---|
| `== R` | reset to stock `$06` (last stock; safe default) |
| `> R`  | decremented by 1 (entries above `R` shift down) |
| `< R`  | untouched |

Status line reports "Removed user-added waveform idx N. K slots re-clamped." so the user sees the cascade without surprise. **+6 tests** in `gwaveEdit.test.ts` (at-/above-/below-the-removed-idx, immutability, stock-idx rejection, malformed record).

**ROM-space indicator** — `· ROM X/Y B (N free)` shown next to the `(VARI N/M)` item count in the items-section header. `data-state` drives the colour: **ok** (≥ 20 B free), **tight** (< 20 B), **over** (the build will throw "Won't fit"). Tooltip carries the byte-by-byte detail (VVECT extent + relocated GWVTAB or just VVECT when no added waveforms). The math is `computeBudget(game, slots, options)` in `engine/customRom.ts` — same arithmetic the "Won't fit" guard uses, factored into a pure function so the indicator and the error stay in lockstep. **+6 tests** in `customRom.test.ts` (per-game free regions, empty floor, VARI extent, relocated GWVTAB, overrun reporting, agreement with `buildCustomRom`'s guard).

**↻ Reset record** — a compact button at the right end of the editor's label row (works for both VARI and GWAVE; both slot shapes already carry `{ record, start }`). Clicking it does `slot.record = [...slot.start]`, pushes the start bytes back into the active editor via `setRecord`, and fires `onEditorChange` so the auto-replay + scope refresh kick in. Disabled when `record === start` so the row stays calm until you actually edit; refreshed on every editor change and slot select. Owned by `designerMode.ts` (single button + handler covers both kinds via the shared label row); no separate editor API additions. Distinct from the per-canvas **Reset to stock** buttons — *those* clear `waveformOverrides[idx]` or `patternOverrides[offset]`; **↻ Reset record** only touches the slot's slider bytes. Capture smoke `designer-vari-reset-record` exercises the copy → tweak → reset round-trip and asserts the button disables on Reset (`disabled` is a new manifest assertion type in `e2e/manifest.ts`).

Together: **+12 tests**, 532 total. Capture entries `designer-gwave-remove-waveform` (Add → Remove → re-clamp) and `designer-vari-reset-record` (tweak → Reset → disabled).

## Phase 6.1 — Pre-populated item list ("fork-the-game" UX) (shipped 2026-05-28)

The Designer's empty-list onboarding suggested "build something new" when most users want to *fork the game's existing sound bank*, modify a few sounds, and take the result out. Phase 6.1 closes that gap as a UX change only — the storage architecture (sparse JSON recipe, zero copyrighted ROM bytes persisted) is unchanged.

**On entry, the list is pre-populated.** *New Project → Defender* fills `project.slots` with every editable command from the engine base: 13 GWAVE rows (`$01..$0D`) + 3 VARI rows (`$1D..$1F`). Stargate matches; Robotron has 13 GWAVE rows (no VARI — non-linear dispatcher is still v-future). Each row tagged **stock** until you edit it (record === start) — visible as a grey dot + dimmed name; flips to **edited** (green dot + full-strength name) when its bytes diverge.

**Sparse on disk.** The on-disk JSON / IndexedDB shape stays a delta: stock rows are dropped on save / export (`projectForPersist` filter); `populateProject` reconstructs them from the base ROM on open. A freshly-populated, untouched project saves as `slots: []` — identical to today's empty-project recipe.

**Helpers added (in `designerMode.ts`, browser-side):**
- `populateProject(p, baseRom)` — idempotent canonical-order rebuild. GWAVE block (sorted by `targetCmd` asc) first, then VARI stock rows 0..2, then user-added VARI rows 3+. Preserves existing slots; inserts missing stocks. Called from `loadEngineRom`, `newBtn` handler, and `setEngine` (after dropping the previous game's stocks).
- `projectForPersist(p)` — returns a shallow copy with stock slots filtered out. Used by save + JSON export.
- `isStockSlot(slots, i, game)` — `record === start` AND the slot sits at a stock identity position (any GWAVE in the editable set; VARI-index ≤ 2).
- `recordsEqualStatic(a, b)` — byte-wise array equality (module-level helper; the in-`mountDesigner` `recordsEqual` is unchanged and still used by the **↻ Reset record** path).

**UI changes:**
- Item list rows carry `data-stock="1"` for stock rows + `data-cmd` (uppercase hex) + `data-kind` for stable e2e selectors.
- Each row prefixed with a 8×8 px dot: grey `#4a5260` for stock, green `#a9dc76` for edited.
- × Remove button hidden on stock rows (a re-populate would just re-add them; ↻ Reset record on the editor is the way to undo).
- Item count reads `(N edited / M total)` — replaces the old `(VARI X/Y)` capacity readout, which was misleading when stocks were always present.
- "Override GWAVE:" dropdown removed entirely — the populated list already contains every editable GWAVE row, so the dropdown's role (picking a code to override) collapses into "click the existing row".
- `+ New VARI` now names new slots `My $XX` (using the auto-assigned code) so user-added rows read as user-authored next to the stock SAW / FOSHIT / QUASAR names.
- On engine switch (Defender → Stargate / Robotron), stock slots are dropped before populate so the new game's bytes fill the rows fresh. Edited + user-added slots survive. The VARI-count guards (`setEngine`) now count only non-stock VARI so the existing pre-populated 3 don't block a switch.

**Capture updates:** designer captures that used `.designer-gwave-override` now click the populated row via `.designer-item[data-cmd='XX'][data-kind='gwave']`.

**Tests:** existing 532 tests stay green (no headless changes). The `recordsEqualStatic` / `isStockSlot` helpers are exercised through the e2e captures + the designer mode's render path.

## Fast-follows (not yet built)

- **Adding new GWAVE command codes** — feasible but higher risk; needs a per-game dispatcher spike (branch-tree injection on Defender/Stargate; JMPTBL append on Robotron). See `plans/designer-mode.md` § Phase 5 deferrals for the feasibility analysis.
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
