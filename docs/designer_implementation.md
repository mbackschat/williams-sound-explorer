# Designer mode — implementation state

> Home for the **Sound Designer** mode's implementation (module map, decisions, the VARI/VVECT reference, recipe schema, tests). This plays the role `explorer_implementation.md` plays for the explorer; read it first when resuming Designer work. User-facing how-to lives in [`designer_guide.md`](designer_guide.md); the raw "why this is even possible" findings live in the private `research/findings_designer_feasibility.md`.

## What it is

A **separate top-level mode** (Explore ↔ Design toggle in the header) for building a **custom ROM with its own item list** of **VARI** sounds: pick an *engine base* (Defender or Stargate), then copy any game's VARI sound or add a new one into your list, edit each one's 9-byte parameter record with labelled sliders, audition, A/B against its starting point, and save. Sounds map to command codes `$1D`+ by list order; the runnable image is reconstituted from the user's base ROM (`buildCustomRom`) and runs through the real emulator unchanged.

**Scope:** engine = **VARI only**; engine base = **Defender/Stargate** (Robotron's dispatch is non-linear). Capacity 23 (Defender) / 30 (Stargate) sounds. Other engines (GWAVE/SCREAM/ORGAN), Robotron as engine base, and live worklet step/scrub are fast-follows (see end).

**History:** v1 shipped first as *override-in-place* (edit a base game's existing VARI commands, marked ●). The user-chosen direction superseded it with the own-item-list model above; legacy v1 projects auto-convert on load (`designerStore.ts`).

## The two facts it rests on

1. **A Williams sound is *data*, not bespoke code.** A VARI command is just a 9-byte record in the ROM's `VVECT` table that the shared VARI engine kernel consumes — so "designing" one means rewriting 9 bytes, **no in-browser assembler**. (Full taxonomy + evidence: `research/findings_designer_feasibility.md`.)
2. **The emulator already runs raw ROM bytes.** `runSoundWithRom(game, romBytes, cmd)` (`engine/runner.ts`) renders any command from a `Uint8Array`. Feed it an *edited* image and the custom sound renders through the exact offline pipeline `web/ui/wavExport.ts` uses.

## Key decisions

- **Separate mode, zero Explore-UI change.** The only addition to the Explore surface is the header mode toggle; Design renders into its own `#designer-root` (Explore's `#pageLayout` is hidden, untouched). The designer module is **lazily imported** on first switch to Design (own JS+CSS chunk), so Explore's initial bundle is unaffected.
- **No 4th `GameKind`.** The custom project is `{ baseGame, edits }`; audition runs **offline** via `runSoundWithRom(baseGame, editedBytes, cmd)` — the edited image is base-game bytes with 9 VVECT bytes rewritten, so `SoundBoard`'s size check passes and the base game's memory layout/decoders apply. This avoids threading `"custom"` through glossary / labelMap / zeroPageMap / romValidate / onboarding / the switcher / QuizPanel.
- **Recipe, not bytes.** The saveable artefact is a JSON recipe (parameter edits over a base game), persisted to IndexedDB — **no copyrighted ROM bytes are ever stored**, consistent with the locked user-supplied-ROM decision. The runnable image is reconstituted from the user's base ROM at load. JSON export/import falls out for free.
- **Audition = offline render + play**, through a dedicated `AudioContext`/`AudioBufferSource` (separate from the Explore worklet host). Transport: **Play** (restart) · dedicated **Pause/Resume** (context suspend/resume) · **Loop** · **Source ⟨Edited│Original⟩** toggle (instant A/B) · **Diff** overlay toggle · auto-replay on edit · a playhead synced to playback. Still **no live-worklet step/scrub** on the custom ROM (that remains a fast-follow).

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
- `explorer/tests/customRom.test.ts` (9) — validation guards (hermetic) + behavioural proof on the real ROMs that each slot's command (incl. high codes needing the mask patch) renders its record; compares **DAC value sequences** (record-determined, command-code-independent).
- `explorer/tests/designerStore.test.ts` (7) — `CustomProject` JSON round-trip + validation + the v1→slots migration.
- Full suite: **422 tests**; `npm run typecheck` passes both the full project and the DOM-free core gate (`variEdit.ts` + `customRom.ts` stay headless).
- Throwaway Playwright smokes (removed after running, not CI) verified each milestone end-to-end — latest: engine picker, +New / +Copy-from-any-game, rename, audition, auto codes `$1D/$1E`, save → reload → reopen persistence, zero console errors.

## Fast-follows (not yet built)

- **Live-worklet audition** — pause/step/scrub on the custom ROM (heavier; drifts toward a 4th-GameKind wiring).
- **GWAVE editor** — adds editable waveform (`GWVTAB`) + period-curve (`GFRTAB`) byte tables; the point to revisit msarnoff's `WavetableWithSlider` interaction live.
- **Robotron as engine base** — its non-linear dispatch (`JMPTBL` pointer table + the `$3F` `SUBA #$39` special-case) needs different patching than the Defender/Stargate linear band.
- **SCREAM / novel synthesis** — SCREAM has no preset record (not data-authorable); ORGAN tunes are editable but realised via self-modifying code. Genuinely new DSP needs an assembler — out of scope.
- A MANUAL/README screenshot via the `e2e/` capture harness, plus the feature/approach comparison vs. msarnoff's Sound Studio (in `designer_guide.md` + a README summary — see `plans/designer-mode.md`).

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
