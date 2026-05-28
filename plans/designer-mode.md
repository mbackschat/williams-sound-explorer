# Sound Designer — consolidated plan

> Single source of truth for the **Sound Designer mode** work — v1 (shipped), the audition-transport refinements (shipped), the Custom-ROM design discussion, the dispatcher spike, and the v-next roadmap. Consolidates and supersedes the transient harness plan `~/.claude/plans/logical-weaving-axolotl.md`.
>
> Companions: **`docs/designer_implementation.md`** (curated impl state), **`docs/designer_guide.md`** (user how-to), **`research/findings_designer_feasibility.md`** (raw ROM-level findings). This file is the *plan/decision log*; those are the living references.

## Status at a glance (2026-05-28)

| Phase | What | State |
|---|---|---|
| 1 | Designer **v1** — VARI editor (copy + modify existing) | ✅ shipped & verified |
| 2 | Audition **transport** redesign (Play/Pause/Loop/Source/Diff, auto-replay, playhead) + param-panel layout | ✅ shipped & verified |
| — | Custom-ROM **model** discussion ("where are my items?") | ✅ decided (v1 = override-in-place; true Custom ROM = v-next) |
| — | Dispatcher **spike** (can we add new VARI command slots?) | ✅ done — one-byte unlock proven |
| 3a | **Custom-ROM image builder** (`engine/customRom.ts`, headless) | ✅ built & tested |
| 3b | **Custom-ROM Designer UI** (own item list: copy-from-any-game + new) | ✅ built & verified |

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

**Other fast-follows:** live-worklet audition (pause/step/scrub on the custom ROM); a MANUAL/README screenshot via the `e2e/` capture harness; GWAVE editor (editable waveform/period-curve canvases — revisit msarnoff's `WavetableWithSlider` live then).

**Docs — compare to the existing Sound Designer — ✅ done (2026-05-28):** `docs/designer_guide.md` has a "How it compares to the original Sound Designer" table, and `README.md` carries a condensed summary. The brief: **compare features + approach against msarnoff's Defender Sound Studio** (`docs/sound_studio_reference.md`): what we match (tweakable original presets, oscilloscope/FFT, JSON import/export, per-handler tooltips) vs. where we differ — real cycle-accurate emulator running the **actual ROMs** (not a per-routine JS hand-port), **all three games** (Studio is Defender-only), **data-driven authoring** (edit the parameter record; no assembler), the true Custom ROM with its own item list, and the visualizations the Studio lacks (DAC byte tape, swimlane, LFSR/state traces, RAM heatmap, A/B diff). Add a condensed version of that comparison to **`README.md`**.

---

## References

- Code: `explorer/src/engine/variEdit.ts`, `explorer/src/web/designer/*`, `explorer/src/web/ui/modeToggle.ts`.
- Docs: `docs/designer_implementation.md`, `docs/designer_guide.md`, `docs/00_INDEX.md` (project state).
- Research (private): `research/findings_designer_feasibility.md`, `research/findings_{defender,robotron}_sound.md`.
- Prior art: `docs/sound_studio_reference.md` (+ `research/findings_sound_studio.md`).
