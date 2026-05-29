# Williams Defender / Robotron Sound — Documentation Index

> Start here. This index is the fast-lookup map across every document in `docs/` and the raw notes in `research/`. The goal of this project is to build a **browser-based sound-effects explorer** with deep visualization of Williams' 1980-1982 sound board (Defender, Robotron, and family).
>
> **If you're a user**: open [`../MANUAL.md`](../MANUAL.md) first — a tutorial-driven manual with twelve step-by-step explorations. For the **Design** mode (building your own custom sound ROM), see [`../MANUAL_DESIGNER.md`](../MANUAL_DESIGNER.md). The list below is the deep-docs reference.

## Read in this order

1. **Hardware** — [`hardware/sound_hardware_model.md`](hardware/sound_hardware_model.md) — the 6802 sound board you'll emulate
2. **Primitives** — [`hardware/synthesis_techniques.md`](hardware/synthesis_techniques.md) — the 8 DSP techniques every sound is built from
3. **Catalogues** — [`defender`](catalogue/defender_sound_catalogue.md) / [`stargate`](catalogue/stargate_sound_catalogue.md) / [`robotron`](catalogue/robotron_sound_catalogue.md) `_sound_catalogue.md` — every sound's command code + parameters
4. **Pedagogy** — [`design/pedagogical_design.md`](design/pedagogical_design.md) — *how to explain these sounds* — design principles + UX patterns
5. **Prior art** — [`design/sound_studio_reference.md`](design/sound_studio_reference.md) — what zapspace's Defender Sound Studio teaches
6. **Architecture** — [`implementation/explorer_architecture.md`](implementation/explorer_architecture.md) — the 6-phase plan and snapshot schema
7. **Implementation** — [`implementation/explorer_implementation.md`](implementation/explorer_implementation.md) — **what's actually built** (Phases 1–6 done; all 12 UX patterns shipped)
8. **Reference audio** — [`pipeline/reference_audio_plan.md`](pipeline/reference_audio_plan.md) — how to obtain WAVs of every effect

If you need only one document: read [`implementation/explorer_implementation.md`](implementation/explorer_implementation.md) (it links to everything else as you need it).

> **Naming note:** *Defender II* is the home/console name for arcade **Stargate** (1981). Same sounds.

---

## Document map

Curated reference, grouped into five subfolders. `README.md` (this file) is the map; it stays at `docs/` root.

### `hardware/` — the machine + DSP primitives

| File | Purpose | Length |
|---|---|---|
| **[`sound_hardware_model.md`](hardware/sound_hardware_model.md)** | CPU, clock, RAM/ROM, DAC, PIA, filter, command latency, ISA notes. The model your emulator must implement. | ~180 lines |
| **[`synthesis_techniques.md`](hardware/synthesis_techniques.md)** | The 8 DSP primitives every Williams sound uses, with cycle-count evidence and visualization angles. | ~220 lines |
| **[`defender_hardware_and_programming.md`](hardware/defender_hardware_and_programming.md)** | (Pre-existing) Deep dive on Defender's **main** CPU + video pipeline. Background reading; sound is the small last section. | ~400 lines |

### `catalogue/` — per-game command-code references ⚙ *consumed by `tools/build_glossary.py`*

| File | Purpose | Length |
|---|---|---|
| **[`defender_sound_catalogue.md`](catalogue/defender_sound_catalogue.md)** | All 31 Defender command codes, GWAVE/VARI/etc presets, game-side name mappings. | ~150 lines |
| **[`stargate_sound_catalogue.md`](catalogue/stargate_sound_catalogue.md)** | Stargate (= Defender II). 95% byte-identical to Defender; only ORGAN tunes differ (FIFTH = CE3K motif, NINTH = original riff). | ~150 lines |
| **[`robotron_sound_catalogue.md`](catalogue/robotron_sound_catalogue.md)** | All 63 Robotron command codes, including unique engines (ORGAN, SCREAM, CDR, PLAY, SING). | ~180 lines |

### `design/` — pedagogy, explainer content, prior art ⚙ *[`explainer_cards.md`](design/explainer_cards.md) consumed by `tools/build_explainer_cards.py`*

| File | Purpose | Length |
|---|---|---|
| **[`pedagogical_design.md`](design/pedagogical_design.md)** | **How to explain** the sounds. 5 design principles + 12 concrete UX patterns. Read this before building UI. | ~250 lines |
| **[`sound_studio_reference.md`](design/sound_studio_reference.md)** | What msarnoff's Defender Sound Studio does, what to copy, what to do differently — plus a deep dive on its **editable surface** + **under-the-hood** (hand-ported JS classes, `wait(N)` cycle annotations, `DacSampler`) and **per-engine command-code case studies** ($0A GWAVE, $16 FNOISE, $1A SCREAM, $1F VARI, $1B ORGAN — what the Studio surfaces, what it does *not*, and how each edit propagates, each with a parameter table + pseudocode walkthrough). | ~485 lines |
| **[`explainer_cards.md`](design/explainer_cards.md)** | **Source of truth** for Pattern 9 annotated explainer cards.  One `## ROUTINE — Title` section per card; `tools/build_explainer_cards.py` emits per-routine JSON to `explorer/public/data/explainer/`.  All 63 catalogued routines covered. | ~1400 lines |

### `implementation/` — how WSED is built

| File | Purpose | Length |
|---|---|---|
| **[`explorer_architecture.md`](implementation/explorer_architecture.md)** | Architecture sketch — CPU emulator vs hand-port, layers, visualization spec, 6-phase plan. | ~200 lines |
| **[`explorer_implementation.md`](implementation/explorer_implementation.md)** | **What's actually built** in `explorer/`: module dependency graph, design decisions, runner API, real-time AudioWorklet pipeline, six engine slots + viz panels, live grid (Ear·Swimlane/Eye·Code), scrubber + RAM time-travel, A/B diff + Genealogy, label-map, parameter overrides, known caveats. Phases 1–6 covered (all 12 UX patterns). | ~900 lines |
| **[`designer_implementation.md`](implementation/designer_implementation.md)** | **Sound Designer mode** implementation state: module map, locked decisions, the VARI/VVECT + GWAVE/SVTAB references + recipe schema, the fork-the-game UX, the `.bin` roundtrip pipeline, tests. (The designer analog of [`explorer_implementation.md`](implementation/explorer_implementation.md).) The user-facing manual is top-level [`../MANUAL_DESIGNER.md`](../MANUAL_DESIGNER.md). | ~400 lines |
| **[`web-capture.md`](implementation/web-capture.md)** | Playwright capture harness (`explorer/e2e/`) that verifies every MANUAL tutorial's click-path and emits the MANUAL/README screenshots + demo GIF. Local maintainer tool (no ROM bytes). | ~210 lines |

### `pipeline/` — getting + building reference audio, ROM tooling

| File | Purpose | Length |
|---|---|---|
| **[`reference_audio_plan.md`](pipeline/reference_audio_plan.md)** | How to acquire WAV recordings of every effect (MAME, assemble-and-drive, prerecorded). | ~150 lines |
| **[`assemble_drive_pipeline.md`](pipeline/assemble_drive_pipeline.md)** | The chosen audio strategy (Path B) — concrete build plan for assembler + 6800 emulator + driver. ~3-day project. | ~200 lines |
| **[`vasm_install_notes.md`](pipeline/vasm_install_notes.md)** | Low-level build-tooling install + dialect-bridging notes: 17-item fix table, chronology, structural findings. (Build pipeline itself documented privately.) | ~150 lines |

### `research/` — raw working notes (private)

The dense low-level working notes and their file map are kept in the access-restricted `research/` submodule (not part of public checkouts).  Contributors with access: see [`research/00_INDEX_research.md`](../research/00_INDEX_research.md).

---

## Fast-lookup tables

### "I need to know about X"

| Topic | Primary doc | Section / pointer |
|---|---|---|
| Sound CPU clock | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "TL;DR — eight numbers"; 894.886 kHz |
| PIA addresses | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | Memory map; $0400 = DAC, $0402 = command |
| 6-bit command interface | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "The command path" |
| What sample rate to use | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "Choosing your sample-generation strategy" — varies per sound, 5–25 kHz typical |
| Post-DAC filter | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "DAC and the analog tail" — single-pole ~10 kHz |
| Latency main→DAC | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "The command path" — ~50 µs |
| Priority/preemption | [`findings_hardware_extra.md`](../research/findings_hardware_extra.md) | §5 — new IRQ always wins, no queue |
| 6800 ISA quirks | [`sound_hardware_model.md`](hardware/sound_hardware_model.md) | "The 6800/6802/6808 ISA" |
| GWAVE engine | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §1 |
| LFSR taps | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §2 — bits 0⊕3, period 65535 |
| Subtractive decay | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §3 — `working -= (orig>>4) * decay` & wrap |
| VARI / variable-duty | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §5 |
| FNOISE slope-walk | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §6 |
| SCREAM additive | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §7 |
| ORGAN popcount | [`synthesis_techniques.md`](hardware/synthesis_techniques.md) | §8 — all three games (tunes differ) |
| Defender command codes | [`defender_sound_catalogue.md`](catalogue/defender_sound_catalogue.md) | "Master command table" |
| Stargate command codes | [`stargate_sound_catalogue.md`](catalogue/stargate_sound_catalogue.md) | "Master command table" |
| Robotron command codes | [`robotron_sound_catalogue.md`](catalogue/robotron_sound_catalogue.md) | "Master command table" |
| Stargate vs Defender (deltas only) | [`stargate_sound_catalogue.md`](catalogue/stargate_sound_catalogue.md) | "What's different — the five real changes" |
| CE3K Fifth motif (FIFTH tune) | [`stargate_sound_catalogue.md`](catalogue/stargate_sound_catalogue.md) | "Tune 1: FIFTH" |
| NINTH tune (Phred-original) | [`stargate_sound_catalogue.md`](catalogue/stargate_sound_catalogue.md) | "Tune 2: NINTH" |
| Defender vs Robotron | [`robotron_sound_catalogue.md`](catalogue/robotron_sound_catalogue.md) | "What's new in Robotron" |
| Beethoven 9th tune | [`robotron_sound_catalogue.md`](catalogue/robotron_sound_catalogue.md) | "ORGAN tunes" |
| Speech samples? | [`robotron_sound_catalogue.md`](catalogue/robotron_sound_catalogue.md) | "No PCM / no speech" — none in arcade ROM |
| Sound Studio prior art | [`sound_studio_reference.md`](design/sound_studio_reference.md) | All |
| AudioWorklet vs ScriptProcessor | [`sound_studio_reference.md`](design/sound_studio_reference.md) | "Things to do differently" |
| DacSampler algorithm | [`sound_studio_reference.md`](design/sound_studio_reference.md) | "Concrete code patterns" |
| What to build, in what order | [`explorer_architecture.md`](implementation/explorer_architecture.md) | "Implementation phases" |
| Visualization layers | [`explorer_architecture.md`](implementation/explorer_architecture.md) | "Visualization layers" table |
| Snapshot data shape | [`explorer_architecture.md`](implementation/explorer_architecture.md) | "State you need to track" |
| Why traditional players are insufficient | [`pedagogical_design.md`](design/pedagogical_design.md) | "The problem" |
| Five design principles | [`pedagogical_design.md`](design/pedagogical_design.md) | "Five design principles" |
| Twelve concrete UX patterns | [`pedagogical_design.md`](design/pedagogical_design.md) | "Twelve concrete UX patterns" |
| Difficulty tiers | [`pedagogical_design.md`](design/pedagogical_design.md) | "Difficulty levels" |
| MAME wavwrite workflow | [`reference_audio_plan.md`](pipeline/reference_audio_plan.md) | "Path A" |
| Assemble + drive sound CPU | [`reference_audio_plan.md`](pipeline/reference_audio_plan.md) | "Path B" — recommended canonical path |
| Defender II = Stargate | [`reference_audio_plan.md`](pipeline/reference_audio_plan.md) | "Naming note" |
| Reference WAV file layout | [`reference_audio_plan.md`](pipeline/reference_audio_plan.md) | "File layout proposal" |
| Module dependency graph (explorer) | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Module dependency graph" |
| Why alu.ts is separate | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "CPU emulator — design decisions" |
| PIA→CPU IRQ wiring (`tick()` pattern) | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "IRQ delivery — the tick() pattern" |
| Interrupt stack frame layout | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Interrupt stack frame" |
| `runSound()` API | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Runner API" |
| `tools/render_sound.ts` CLI usage | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "The render-sound CLI" |
| Test coverage summary | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Test surface" |
| Defender vs Stargate 10-cycle offset finding | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Verified findings" |
| What's deliberately NOT modelled | [`explorer_implementation.md`](implementation/explorer_implementation.md) | "Things deliberately not modelled" |

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

## Project status & roadmap

Project state, what's next, and the per-area roadmaps now live in **[`../plans/STATUS.md`](../plans/STATUS.md)** (the single source for plan/state). This file is the documentation **index/map** only.
