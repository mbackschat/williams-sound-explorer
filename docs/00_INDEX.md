# Williams Defender / Robotron Sound — Documentation Index

> Start here. This index is the fast-lookup map across every document in `docs/` and the raw notes in `research/`. The goal of this project is to build a **browser-based sound-effects explorer** with deep visualization of Williams' 1980-1982 sound board (Defender, Robotron, and family).
>
> **If you're a user**: open [`../MANUAL.md`](../MANUAL.md) first — a tutorial-driven manual with twelve step-by-step explorations. For the **Design** mode (building your own custom sound ROM), see [`../MANUAL_DESIGNER.md`](../MANUAL_DESIGNER.md). The list below is the deep-docs reference.

## Read in this order

1. **Hardware** — `sound_hardware_model.md` — the 6802 sound board you'll emulate
2. **Primitives** — `synthesis_techniques.md` — the 8 DSP techniques every sound is built from
3. **Catalogues** — `defender_sound_catalogue.md` / `stargate_sound_catalogue.md` / `robotron_sound_catalogue.md` — every sound's command code + parameters
4. **Pedagogy** — `pedagogical_design.md` — *how to explain these sounds* — design principles + UX patterns
5. **Prior art** — `sound_studio_reference.md` — what zapspace's Defender Sound Studio teaches
6. **Architecture** — `explorer_architecture.md` — the 6-phase plan and snapshot schema
7. **Implementation** — `explorer_implementation.md` — **what's actually built** (Phases 1–6 done; all 12 UX patterns shipped)
8. **Reference audio** — `reference_audio_plan.md` — how to obtain WAVs of every effect

If you need only one document: read `explorer_implementation.md` (it links to everything else as you need it).

> **Naming note:** *Defender II* is the home/console name for arcade **Stargate** (1981). Same sounds.

---

## Document map

### `docs/` — curated reference

| File | Purpose | Length |
|---|---|---|
| **`00_INDEX.md`** | This file. Fast-lookup map. | — |
| **`sound_hardware_model.md`** | CPU, clock, RAM/ROM, DAC, PIA, filter, command latency, ISA notes. The model your emulator must implement. | ~180 lines |
| **`synthesis_techniques.md`** | The 8 DSP primitives every Williams sound uses, with cycle-count evidence and visualization angles. | ~220 lines |
| **`defender_sound_catalogue.md`** | All 31 Defender command codes, GWAVE/VARI/etc presets, game-side name mappings. | ~150 lines |
| **`stargate_sound_catalogue.md`** | Stargate (= Defender II). 95% byte-identical to Defender; only ORGAN tunes differ (FIFTH = CE3K motif, NINTH = original riff). | ~150 lines |
| **`robotron_sound_catalogue.md`** | All 63 Robotron command codes, including unique engines (ORGAN, SCREAM, CDR, PLAY, SING). | ~180 lines |
| **`pedagogical_design.md`** | **How to explain** the sounds. 5 design principles + 12 concrete UX patterns. Read this before building UI. | ~250 lines |
| **`sound_studio_reference.md`** | What msarnoff's Defender Sound Studio does, what to copy, what to do differently — plus a deep dive on its **editable surface** + **under-the-hood** (hand-ported JS classes, `wait(N)` cycle annotations, `DacSampler`) and **per-engine command-code case studies** ($0A GWAVE, $16 FNOISE, $1A SCREAM, $1F VARI, $1B ORGAN — what the Studio surfaces, what it does *not*, and how each edit propagates, each with a parameter table + pseudocode walkthrough). | ~485 lines |
| **`explorer_architecture.md`** | Architecture sketch — CPU emulator vs hand-port, layers, visualization spec, 6-phase plan. | ~200 lines |
| **`explorer_implementation.md`** | **What's actually built** in `explorer/`: module dependency graph, design decisions, runner API, real-time AudioWorklet pipeline, six engine slots + viz panels, live grid (Ear·Swimlane/Eye·Code), scrubber + RAM time-travel, A/B diff + Genealogy, label-map, parameter overrides, known caveats. Phases 1–6 covered (all 12 UX patterns). | ~900 lines |
| **`designer_implementation.md`** | **Sound Designer mode** implementation state: module map, locked decisions, the VARI/VVECT + GWAVE/SVTAB references + recipe schema, the fork-the-game UX, the `.bin` roundtrip pipeline, tests. (The designer analog of `explorer_implementation.md`.) The user-facing manual is top-level [`../MANUAL_DESIGNER.md`](../MANUAL_DESIGNER.md). | ~400 lines |
| **`web-capture.md`** | Playwright capture harness (`explorer/e2e/`) that verifies every MANUAL tutorial's click-path and emits the MANUAL/README screenshots + demo GIF. Local maintainer tool (no ROM bytes). | ~210 lines |
| **`explainer_cards.md`** | **Source of truth** for Pattern 9 annotated explainer cards.  One `## ROUTINE — Title` section per card; `tools/build_explainer_cards.py` emits per-routine JSON to `explorer/public/data/explainer/`.  All 63 catalogued routines covered. | ~1400 lines |
| **`reference_audio_plan.md`** | How to acquire WAV recordings of every effect (MAME, assemble-and-drive, prerecorded). | ~150 lines |
| **`assemble_drive_pipeline.md`** | The chosen audio strategy (Path B) — concrete build plan for assembler + 6800 emulator + driver. ~3-day project. | ~200 lines |
| **`vasm_install_notes.md`** | Low-level build-tooling install + dialect-bridging notes: 17-item fix table, chronology, structural findings. (Build pipeline itself documented privately.) | ~150 lines |
| **`defender_hardware_and_programming.md`** | (Pre-existing) Deep dive on Defender's **main** CPU + video pipeline. Background reading; sound is the small last section. | ~400 lines |

### `research/` — raw working notes (private)

The dense low-level working notes and their file map are kept in the access-restricted `research/` submodule (not part of public checkouts).  Contributors with access: see [`research/00_INDEX_research.md`](../research/00_INDEX_research.md).

---

## Fast-lookup tables

### "I need to know about X"

| Topic | Primary doc | Section / pointer |
|---|---|---|
| Sound CPU clock | `sound_hardware_model.md` | "TL;DR — eight numbers"; 894.886 kHz |
| PIA addresses | `sound_hardware_model.md` | Memory map; $0400 = DAC, $0402 = command |
| 6-bit command interface | `sound_hardware_model.md` | "The command path" |
| What sample rate to use | `sound_hardware_model.md` | "Choosing your sample-generation strategy" — varies per sound, 5–25 kHz typical |
| Post-DAC filter | `sound_hardware_model.md` | "DAC and the analog tail" — single-pole ~10 kHz |
| Latency main→DAC | `sound_hardware_model.md` | "The command path" — ~50 µs |
| Priority/preemption | `findings_hardware_extra.md` | §5 — new IRQ always wins, no queue |
| 6800 ISA quirks | `sound_hardware_model.md` | "The 6800/6802/6808 ISA" |
| GWAVE engine | `synthesis_techniques.md` | §1 |
| LFSR taps | `synthesis_techniques.md` | §2 — bits 0⊕3, period 65535 |
| Subtractive decay | `synthesis_techniques.md` | §3 — `working -= (orig>>4) * decay` & wrap |
| VARI / variable-duty | `synthesis_techniques.md` | §5 |
| FNOISE slope-walk | `synthesis_techniques.md` | §6 |
| SCREAM additive | `synthesis_techniques.md` | §7 |
| ORGAN popcount | `synthesis_techniques.md` | §8 — all three games (tunes differ) |
| Defender command codes | `defender_sound_catalogue.md` | "Master command table" |
| Stargate command codes | `stargate_sound_catalogue.md` | "Master command table" |
| Robotron command codes | `robotron_sound_catalogue.md` | "Master command table" |
| Stargate vs Defender (deltas only) | `stargate_sound_catalogue.md` | "What's different — the five real changes" |
| CE3K Fifth motif (FIFTH tune) | `stargate_sound_catalogue.md` | "Tune 1: FIFTH" |
| NINTH tune (Phred-original) | `stargate_sound_catalogue.md` | "Tune 2: NINTH" |
| Defender vs Robotron | `robotron_sound_catalogue.md` | "What's new in Robotron" |
| Beethoven 9th tune | `robotron_sound_catalogue.md` | "ORGAN tunes" |
| Speech samples? | `robotron_sound_catalogue.md` | "No PCM / no speech" — none in arcade ROM |
| Sound Studio prior art | `sound_studio_reference.md` | All |
| AudioWorklet vs ScriptProcessor | `sound_studio_reference.md` | "Things to do differently" |
| DacSampler algorithm | `sound_studio_reference.md` | "Concrete code patterns" |
| What to build, in what order | `explorer_architecture.md` | "Implementation phases" |
| Visualization layers | `explorer_architecture.md` | "Visualization layers" table |
| Snapshot data shape | `explorer_architecture.md` | "State you need to track" |
| Why traditional players are insufficient | `pedagogical_design.md` | "The problem" |
| Five design principles | `pedagogical_design.md` | "Five design principles" |
| Twelve concrete UX patterns | `pedagogical_design.md` | "Twelve concrete UX patterns" |
| Difficulty tiers | `pedagogical_design.md` | "Difficulty levels" |
| MAME wavwrite workflow | `reference_audio_plan.md` | "Path A" |
| Assemble + drive sound CPU | `reference_audio_plan.md` | "Path B" — recommended canonical path |
| Defender II = Stargate | `reference_audio_plan.md` | "Naming note" |
| Reference WAV file layout | `reference_audio_plan.md` | "File layout proposal" |
| Module dependency graph (explorer) | `explorer_implementation.md` | "Module dependency graph" |
| Why alu.ts is separate | `explorer_implementation.md` | "CPU emulator — design decisions" |
| PIA→CPU IRQ wiring (`tick()` pattern) | `explorer_implementation.md` | "IRQ delivery — the tick() pattern" |
| Interrupt stack frame layout | `explorer_implementation.md` | "Interrupt stack frame" |
| `runSound()` API | `explorer_implementation.md` | "Runner API" |
| `tools/render_sound.ts` CLI usage | `explorer_implementation.md` | "The render-sound CLI" |
| Test coverage summary | `explorer_implementation.md` | "Test surface" |
| Defender vs Stargate 10-cycle offset finding | `explorer_implementation.md` | "Verified findings" |
| What's deliberately NOT modelled | `explorer_implementation.md` | "Things deliberately not modelled" |

### Source-line citations

Detailed source-line indices into the sound routines are maintained with the private research notes, out of the public docs — see [`research/00_INDEX_research.md`](../research/00_INDEX_research.md) (contributors with submodule access only).

### "I need a URL"

| What | Where |
|---|---|
| Defender Sound Studio (live) | <https://zapspace.net/defender_sound/> |
| Defender Sound Studio source | <https://zapspace.net/defender_sound/defender.js> |
| Defender Sound Studio disasm | <https://zapspace.net/defender_sound/defender.asm> |
| MAME Williams driver | <https://github.com/mamedev/mame/blob/master/src/mame/williams/williams.cpp> |
| MAME 6800 core | <https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6800/m6800.cpp> |
| Computer Archeology Defender sound | <https://computerarcheology.com/Arcade/Defender/SoundHardware.html> |
| Nameless Algorithm Defender | <https://namelessalgorithm.com/defender/> |
| ZEN Instruments Defender disasm | <http://zeninstruments.blogspot.com/2020/02/williams-defender-sound-disassembly.html> |
| Sean Riddle Williams hardware | <https://seanriddle.com/willhard.html> |
| 6800 ISA reference | <https://www.8bit-era.cz/6800.html> |
| msarnoff HN comment | <https://news.ycombinator.com/item?id=41911575> |

---

## Project state (as of 2026-05-28)

- ✅ Source-level analysis complete for all four games (raw notes kept in the private `research/` submodule)
- ✅ Hardware model documented
- ✅ Synthesis primitives catalogued (8 techniques)
- ✅ Defender sound catalogue complete (31 commands)
- ✅ Robotron sound catalogue complete (63 commands)
- ✅ Defender Sound Studio analysed
- ✅ Explorer architecture sketched
- ✅ Pedagogical design principles + UX patterns documented
- ✅ Reference-audio acquisition strategy documented
- ✅ Path B audio-pipeline build plan documented in `assemble_drive_pipeline.md`
- ✅ Stargate (= Defender II) sound catalogue — analysed at source level, found to be 95% identical to Defender
- ✅ Build + verification tooling complete (details in the private research notes)
- ✅ **Phases 1 + 2 closed** — TypeScript 6800 emulator (~160 opcodes), AudioWorklet pipeline, speed presets + pause + single-step + Step→DAC/Step→IRQ, tape-loop scrubber, glossary, disassembler.  See `explorer_implementation.md` for the module map.
- ✅ **Phase 3 closed**: Stage swimlane + label map (`tools/build_labelmap.py` + per-game JSON), DAC byte tape with PC→label tooltip, three-panel triangle, oscilloscope + spectrogram (AC-coupled).
- ✅ **Phase 4 closed**: all six engine slots live (LFSR / VARI / GWAVE / FNOISE / SCREAM / ORGAN), per-engine viz panels (VARI bars, Wavetable, FNOISE, SCREAMView, ORGANView), Pattern 3 freeze toggles, Pattern 8 causal hover trace (spectrogram + byte tape → INSPECT line in Code panel).
- ✅ **Phase 5 closed**: Robotron engines + A/B diff + Genealogy.  `engineState.ts` refactored to per-game specs.  ROM-fetch split: `runner.ts` (browser-safe) + `runnerNode.ts` (Node-only) so Vite stops on `node:fs`.  Five golden fixtures.
- ✅ **Phase 6 done** (all 12 UX patterns delivered):
  - **Step 6.1 — Build-up / Tear-down (Pattern 4)**: 4 SCREAM voice-mute toggles (`screamMuteVoice0..3`) gating each voice's TIMER write (PC-gated to SCREAM); UI has 4 voice checkboxes + Build-up ↑ / Tear-down ↓ / ■ buttons that auto-switch to Robotron, fire `$1A`, and flip mutes on a 700 ms timer.
  - **Step 6.2 — parameter-override sliders (Pattern 5)**: `SoundBoard.paramOverrides` map; VARI pane has LOPER+HIPER force-sliders that pin the cell live.
  - **Step 6.5 — No-explanation toggle (Pattern 12)**: header "Hide help" toggles `body.hide-help`, hiding `.help-text` paragraphs / `details.help` / `#cmdInfo` / the Glossary section / term-link styling; persisted to localStorage.
  - **Step 6.6 — RAM heatmap**: `SoundBoard.lastWriteCycle: Uint32Array(256)` stamped on every successful write; snapshot exposes `ramSnapshot` + `ramLastWrite`; `viz/RAMHeatmap.ts` renders a 16×8 zero-page grid that cools over 1 s.  Hover tooltip names the cell's function via `tools/build_zeropage.py` → `{game}_zeropage.json` (`web/zeroPageMap.ts`), disambiguating overlaid cells by the active engine.
  - **Scrub-mode RAM time-travel**: `engine/ramHistory.ts` captures zero-page RAM + X every ~512 cycles into a 10 000-entry ring (~1.3 MB, ~5.7 s window).  Engine view bars + wavetable + RAM heatmap all animate during scrub.
  - **`$1B` ORGANT auto-pulse**: `fireUserCmd()` wraps every user-driven Fire (button / Fire⏸ / Try-chip).  For `$1B` it auto-pulses tune `$01` 40 ms after the arm so a single click plays the tune (PHANTOM on Defender, FIFTH on Stargate / Robotron).  Audit confirmed only ORGANT and ORGANN are arm-only across the 3 ROMs.  See [MANUAL.md "Why $1B is special"](../MANUAL.md#why-1b-organt-is-special).
  - **Step 6.3 — Annotated explainer cards (Pattern 9)**: **all 63 routines covered**.  Source-of-truth markdown at [`docs/explainer_cards.md`](explainer_cards.md); `tools/build_explainer_cards.py` (auto-run via `prepare:public`) emits per-routine JSON under `explorer/public/data/explainer/`.  `viz/ExplainerCard.ts` loads them on every fire.  Never hand-edit the JSONs.
  - **UI restructure**: segmented game switcher (no Init/Dispose), draggable two-column layout with sticky left + visualisation-heavy right, per-game chip browser auto-populated from the glossary (chips fire on click), responsive auto-fit engine grid, ResizeObserver on every canvas.
  - **MANUAL.md**: 12-tutorial user manual at repo root.
- ✅ **Step 6.4 — Listen-then-look quiz (Pattern 10)**: `viz/QuizPanel.ts` — random sound from a ~96-entry pool across the 6 canonical engines, MCQ engine-identification, reveal with link into the explainer card.  Closes Pattern 10 — **all 12 patterns delivered**.
- ✅ **2026-05 UI pass**: live area reworked into a 2×2 grid (Ear · Swimlane / Eye · Code); spectrogram full-width with the RAM heatmap (open) below it; Glossary + Explainer paired two-up; Log moved to the bottom of the left column (collapsed).  Added an offline **`⬇ .wav` export** (current command → download, inline in `main.ts`), grew the glossary to **41 terms** (term-links now also show a one-line hover tooltip), gave each Engine-view pane a title, and put explanatory tooltips on every Engine-view toggle / voice checkbox.
- ✅ **2026-05 user-supplied ROMs**: the app ships no copyrighted ROM bytes.  First-run onboarding takes uploads (validated by size + 6802 vectors + SHA-1 allowlist), stored in IndexedDB (`web/{romStore,romValidate,onboarding}.ts`); both ROM entry points (`host.fetchRom`, `loadRomFromUrl`) read through `loadRomBytes`.  Works with as few as one ROM — games without one are locked in the switcher.  `prepare:public` no longer copies ROMs (opt-in `npm run dev:roms` for local dev); `dist/` has zero ROM bytes.  Enables a clean MIT publish.
- ✅ **2026-05 source-layer split + DOM-free gate**: `explorer/src/` reorganised into **headless** (`cpu/`, `board/`, `synth/`, `engine/`, `data/`), **browser** (`web/`, `viz/`), and **Node-only** (`node/`) layers — the flat `audio/` grab-bag is gone.  The shared `StateSnapshot` / worklet-message / engine-state contract moved out of the browser `worklet.ts` into pure `data/protocol.ts` (deduping a copy that was drifting against `engineState.ts`).  New `explorer/tsconfig.core.json` (lib `ES2022` only, no DOM/Node types) compiles the headless layers and runs as the second half of `npm run typecheck`, so a stray `document`/`fetch`/`import.meta.env` or a `web/`→headless import now **fails the build**.  Pure relocation — 367 tests unchanged.
- ✅ **2026-05 `main.ts` decomposition + keyboard support**: the 1945-line `web/main.ts` god-module split −44% into focused `web/` modules + `web/ui/` per-feature controllers behind an `AppContext` facade (`els`, `format` (+tests), `appContext`, `organTunes`, and `ui/{layout,wavExport,abdiff,paramSliders,engineToggles,glossaryUi}`); the cohesive live-session core (boot/render/transport/scrubber) intentionally left in `main.ts`.  `index.html` slimmed −60% by extracting its inline `<style>` to `web/main.css`.  Added **keyboard shortcuts** (`web/ui/keyboard.ts` + a unit-tested pure `keymap.ts`; Space=fire, P=pause, 1–4=speed, arrows=nudge time/volume, G=game, `?`=overlay) and an **Enter-to-fire** on the cmd box.  385 tests.
- ✅ **2026-05 illustrated docs + web-capture harness**: a Playwright harness in `explorer/e2e/` drives the dev server and emits screenshots — `e2e/capture.ts` runs a 20-entry manifest (all 12 MANUAL tutorials + 5 per-engine showcase panels + 3 interface-tour shots), verifying each click-path and clipping its panel, while `e2e/readme.ts` produces the README hero + demo GIF.  Images live under `docs/img/` and are wired into MANUAL.md (§2 interface tour + §3 engine gallery + §4 tutorials) and README.md.  It's a local maintainer tool (consumes the dev-only user-supplied ROMs, emits no ROM bytes); design + how-to in [`web-capture.md`](web-capture.md).

- ✅ **2026-05 Sound Designer mode (v1)**: a separate **Explore ↔ Design** mode (lazily-mounted into `#designer-root`; Explore UI untouched) for authoring a **VARI** sound the way a Williams designer would — copy an existing VARI command ($1D SAW / $1E FOSHIT / $1F QUASAR; +$3F MOSQTO on Robotron), edit its 9-byte `VVECT` record with labelled sliders, audition (offline render + play), diff vs original, save/export.  Built on the finding that **a Williams sound is *data*, not bespoke code** (`research/findings_designer_feasibility.md`): no 4th `GameKind`, no live-worklet change — audition feeds an edited ROM image to `runSoundWithRom`.  Saved as a JSON **recipe** (parameter edits over a base game) — zero copyrighted bytes persisted.  New headless `engine/variEdit.ts` + `web/designer/*` + `web/ui/modeToggle.ts`.  +28 tests (413 total).  See **`designer_implementation.md`** / **`../MANUAL_DESIGNER.md`**.
- ✅ **2026-05-28 Designer → Custom ROM (own item list)**: the Designer's model became a **custom ROM with its own named item list** (superseding v1 override-in-place) — pick an engine base (Defender/Stargate), **copy any game's VARI sound or add a new one**, edit, audition with A/B (Edited vs Start) + Diff, save as a `CustomProject` JSON recipe (zero ROM bytes; legacy v1 recipes auto-convert).  Built on new headless `engine/customRom.ts` (`buildCustomRom` widens the command mask + extends `VVECT` in place — proven by a dispatcher spike: Defender mask `$FCBD` `$1F→$3F` unlocks ~33 VARI slots) + a reworked `web/designer/*`.  **422 tests**.  See **`plans/designer-mode.md`**.
- ✅ **2026-05-28 Designer → Open in Explore (live-worklet audition via Explore)**: a **▶ Open in Explore** button in Design pushes the built custom ROM into Explore's existing worklet (`host.loadCustomRom`), fires the selected slot, and flips to Explore — every Explore visualisation (oscilloscope, spectrogram, byte-tape, swimlane, RAM heatmap, code panel) plus pause/step/scrub run on the user's authored sound. A dynamic **✎ Custom: ⟨name⟩** entry in `#gameSwitcher` (purple) makes the running ROM source visible and rebuilds from current project state on click. No 4th `GameKind`. See **`designer_implementation.md`** § *Open in Explore*.
- ✅ **2026-05-28 GWAVE editor (Phase 5 step 1)**: Designer mode now supports a second engine — **GWAVE overrides**. A new slot kind picks an existing GWAVE command ($01..$0D) and rewrites its 7-byte SVTAB record in place. Mixed projects with VARI new-sounds *and* GWAVE overrides work; Robotron unlocks as an engine base (GWAVE patching is in-place, no dispatcher widen). New headless `engine/gwaveEdit.ts` + nybble-aware 9-field editor; `CustomProject.slots` is now a discriminated `VariSlot | GwaveSlot` (legacy v1/v2 shapes auto-migrate). **+29 tests** (459 total). Waveform-byte and pitch-pattern-byte canvases are Step 2 + Step 3 of Phase 5. See **`designer_implementation.md`** § *GWAVE editor*.
- ✅ **2026-05-28 GWAVE editor (Phase 5 step 2 — editable waveform canvas)**: Below the SVTAB sliders, a **click-to-draw waveform canvas** shows the resolved bytes of the slot's current `WAVE#` and writes user edits into a project-level `waveformOverrides`. Lengths don't change → no pointer rebase. The 7 stock waveforms (GS2 / GSSQ2 / GS1 / GS12 / GSQ22 / GS72 / GS1.7) are shared across whichever editable GWAVE commands point at them; the canvas surfaces this as **"Shared by: $XX NAME, …"** + a per-idx **Reset to stock** button. `engine/gwaveEdit.ts` gains `readWaveform` / `patchWaveform` / `waveformUsers` + GWVTAB layout constants; `engine/customRom.ts` `buildCustomRom` gains an `options.waveformOverrides` arg; `CustomProject.waveformOverrides?` added to the saved-project schema with full JSON round-trip + validation. **+20 tests** (479 total).
- ✅ **2026-05-28 GWAVE editor (Phase 5 step 3 — editable pitch-pattern canvas)**: A second click-to-draw canvas (teal) below the waveform canvas shows the resolved bytes at the slot's current `(PATOFF, PATLEN)` and writes user edits into a project-level `patternOverrides` (keyed by GFRTAB offset; value bytes write at that offset for `bytes.length` bytes). Patterns are byte-addressed so overlap is real — the canvas surfaces shared editable commands as **"Shared by: $XX NAME, … — your edits affect their pitch contour too."**. `engine/gwaveEdit.ts` gains `GFRTAB_BASE` per game + `readPattern` / `patchPattern` / `patternUsers`; `engine/customRom.ts` `buildCustomRom` gains an `options.patternOverrides` arg; `CustomProject.patternOverrides?` added with full JSON round-trip + validation. **+20 tests** (499 total). **GWAVE editor is now feature-complete** — every byte the kernel reads is editable. Adding *new* waveforms / new GWAVE codes remains a v-future item.
- ✅ **2026-05-28 Designer layout redesign**: `▶ Open in Explore` moved to the header bar (was below the fold on the old vertical-stack layout); 3-column GWAVE edit row (sliders | waveform | pitch) replaces the stacked layout; audition scope is now a thin full-width strip below the edit row; single-row transport sticks to the viewport bottom. Canvas columns can grow up to ~600 px each so v-future "new waveforms" / long PATLENs stay drawable. The full Designer surface fits in a 1920×1080 viewport with no scrolling. `gwaveEditor.ts` API split: `slidersEl` / `waveformPanelEl` / `patternPanelEl`. No tests change (entries assert behaviour, not pixel layout); designer screenshots regenerated.
- ✅ **2026-05-28 Adding new waveforms (Phase 5b — was v-future)**: a project can now carry up to **9 user-added waveforms** (idx 7..15, the rest of the WAVE# nybble). When present, the custom ROM **relocates the whole GWVTAB** into the free RADIO/ORGAN region and **repoints `LDX #GWVTAB`** — a single 2-byte operand patch per game (Defender `$FBA8`, Stargate `$FB7E`, Robotron `$FA03`). A new **+ New waveform** button in the Designer's waveform-canvas panel appends a 16-byte sine-seed wave and switches the slot's WAVE# to it; the builder throws a "Won't fit" error with byte overrun count when the layout exceeds free space. `CustomProject.addedWaveforms?: number[][]` with full JSON round-trip + validation. **+20 tests** (520 total). The deferred v-future item ships exactly as the feasibility analysis predicted. See **`designer_implementation.md`** § *Phase 5b*. See **`designer_implementation.md`** § *Phase 5 layout redesign*.
- ✅ **2026-05-28 e2e split — `tutorials.ts` → purpose-named capture manifests**: split the capture harness into `capturesExplorer.ts` (MANUAL.md illustrations), `capturesDesigner.ts` (MANUAL_DESIGNER.md illustrations), and `smokes.ts` (transient regression checks). Shared types in `manifest.ts`. `capture.ts` becomes a driver picking a manifest via `capture.ts <name>[:<id-substring>]`. Rationale: "tutorials" in an `e2e/` dir reads as "by hand", the opposite of automated Playwright entries; partitioning by purpose lets a designer dev re-run only the designer set, smokes never accumulate as stale tutorials, and the CLAUDE.md no-throwaway-smokes convention now resolves to "add to `smokes.ts`".
- ✅ **2026-05-28 Designer Phase 7 — LFSR editor (LITE / TURBO / APPEAR / LAUNCH)**: the third editable engine. LFSR slots **override an existing LFSR command in place**, but unlike VARI/GWAVE the parameters are **immediate operands in the caller's code**, not a ROM table — so the editor's "record" is a *virtual* per-command field list (LITE 2 fields, APPEAR/LAUNCH 3, TURBO 4 incl. a 16-bit NFRQ1) written to fixed operand offsets at known caller addresses. New headless `engine/lfsrEdit.ts` (+ `kind:"lfsr"` in `customRom.ts` + LFSR detection in `projectFromBin.ts` for full `.bin` roundtrip) + a per-command slider editor (shipped as `lfsrEditor.ts`, generalised to the shared `web/designer/fieldSliders.ts` in Phase 8) + populated-list / store / CSS wiring. LAUNCH ($39) is Robotron-only. **+34 tests (579 total)**; capture `designer-lfsr-overview`. See **`designer_implementation.md`** § *LFSR editor — Phase 7*.
- ✅ **2026-05-28 Designer Phase 8 — FNOISE editor (BG1 / THRUST / CANNON / HBOMB)**: the fourth editable engine, with a **split-personality** build. Robotron stores FNOISE parameters in a clean 6-byte `FNTAB` table at `$F785` (all 4 sounds, fully data-driven); Defender/Stargate bake them into caller-code immediates and only *partially* — CANNON is fully editable, THRUST exposes only FMAX, and BG1 has no patchable immediate (its DSFLG is a `CLRA`) so it's omitted on D/S. One headless `engine/fnoiseEdit.ts` branches by game behind a uniform per-command field list (DSFLG / LOFRQ / FDFLG / FMAX / SAMPC-16bit). `kind:"fnoise"` in `customRom.ts` + FNOISE detection in `projectFromBin.ts`; the LFSR slider editor was generalised into a shared `web/designer/fieldSliders.ts` (reused by both). HBOMB ($3E) is Robotron-only. **+30 tests (609 total)**; capture `designer-fnoise-overview`. See **`designer_implementation.md`** § *FNOISE editor — Phase 8*.
- 📋 **2026-05-28 Designer Phase 9 planned — RADIO editor**: `$18`, a 16-byte wavetable phase-accumulator. Needs a ~1 h feasibility spike (RADSND base per game + caller-immediate offsets) before coding. After it ships, WSED has Defender per-engine parity with msarnoff's Defender Sound Studio (GWAVE / VARI / LFSR / FNOISE / RADIO — 5 of 5 data-driven engines) while spanning 3 games and running the actual ROMs. SCREAM and HYPER stay un-editable in both tools — they have no preset record in the ROM and would need an in-browser 6800 assembler we deliberately don't ship. Plan: `plans/designer-mode.md` § Phase 9. Scope: ~6 h end-to-end.
- ✅ **2026-05-28 Designer Phase 6.2 — `.bin` roundtrip (download + upload)**: closes *edit → MAME → upload → edit*. `↓ .bin` emits the built ROM image as a downloadable file; `↑ .bin` reads such a file back, diffs against the user's base ROM in IndexedDB via new headless `engine/projectFromBin.ts` (`importBinAsProject`), and reconstructs the project deltas — full fidelity across all 6 detection paths (GWAVE row edits / stock VARI / extended VARI / waveform overrides / added waveforms / pattern overrides). Two small `buildCustomRom` changes for unambiguous reverse-engineering: skip the VARI fill (Phase 6.1 makes gaps impossible anyway), and zero-fill the GWVTAB tail after relocation (clean stop signal for added-waveform walk). New e2e vocabulary: `expectDownload` + `uploadFile`. +13 tests (545 total). Capture `designer-bin-roundtrip` covers the UI loop.
- ✅ **2026-05-28 Designer Phase 6.1 — "fork-the-game" pre-populated item list**: *New Project → Defender* now opens with every editable command already in the list (13 GWAVE + 3 VARI on Defender/Stargate, 13 GWAVE on Robotron). Each row tagged **stock** (grey dot, dimmed) or **edited** (green dot, bright) by `record === start`. Saved/exported recipes stay sparse — stock rows are reconstructed by `populateProject` on open, so zero copyrighted ROM bytes persist (the locked Phase 1 decision is unchanged). UX change only; no headless changes; 532 tests still green. New helpers in `designerMode.ts`: `populateProject`, `projectForPersist`, `isStockSlot`. The "Override GWAVE:" dropdown was removed — populated rows replace its role.
- ✅ **2026-05-28 Designer polish — × Remove + ROM-space indicator + ↻ Reset record**: closes the add/edit/remove triad on Phase 5b plus a per-slot revert for the parameter record. **× Remove** drops a user-added waveform and re-clamps every GWAVE slot whose `WAVE#` pointed at it (clamp to stock `$06` at-the-removed-idx; decrement by 1 above-the-removed-idx). **ROM-space indicator** (`· ROM X/Y B (N free)`) in the items-section header shows the layout budget *while* editing — yellow at < 20 B free, red when over — so users see headroom *before* the "+ New waveform" click is rejected. **↻ Reset record** in the editor label row reverts the slot's parameter record (slider values) to its starting bytes — works for both VARI and GWAVE; disabled until you actually edit. New headless `computeBudget(game, slots, options)` in `engine/customRom.ts` mirrors `buildCustomRom`'s overrun guard; new `reclampWaveformIdxAfterRemoval(record, removedIdx)` in `engine/gwaveEdit.ts`. New `disabled` assertion in the `e2e/manifest.ts` vocabulary. **+12 tests** (532 total). Capture entries `designer-gwave-remove-waveform` + `designer-vari-reset-record`.

## Suggested next concrete steps

**All 12 UX patterns from `docs/pedagogical_design.md` are delivered.** The **Sound Designer** ships with four engines (VARI + GWAVE + LFSR + FNOISE) across three games (Defender / Stargate / Robotron), a "fork-the-game" pre-populated item list, **Open in Explore** for live worklet audition, and a full `.bin` download/upload roundtrip for MAME / real-cabinet use.

**Designer next-up — planned phase** (see `plans/designer-mode.md`):

- **Phase 9 — RADIO editor** ($18). ~6 h including a feasibility spike. Closes Defender per-engine parity with msarnoff's Defender Sound Studio (5 of 5 data-driven engines).

**v-future (deferred / dropped):** Robotron as a VARI engine base (non-linear dispatcher); adding new GWAVE command codes (dropped after re-evaluation — see plan).

Other optional polish items:

- Quiz tier expansion — Tier 2 ("which freeze toggle silences this?") + Tier 3 ("A/B diff: what differs?").  Reuses Pattern 3 toggle metadata + Pattern 6 A/B engine.
- Source-line tightening in some explainer cards (a few cite approximate addresses; labelmap lookups can re-pin them).
- Bulk reference audio re-render (corpus is stale-ish since the ROM rebuild).
- Per-card byte-level deep-dives for routines marked "rarely used" (SV3, ED10–17) if a future contributor reverse-engineers them.
