> **ARCHIVED — completed.** This is the original machine-local execution plan
> (`~/.claude/plans/goal-is-to-built-purrfect-river.md`), moved in-repo on 2026-05-29.
> All of its phases shipped. Kept for the decision log + risk register; the live
> roadmap/status is now [`../STATUS.md`](../STATUS.md) + [`explorer.md`](explorer.md).

# Plan — Williams Defender / Stargate / Robotron Sound-Effects Explorer

## Context

The user wants a **browser-based explorer for the Williams arcade sound effects** of Defender (1980), Stargate / Defender II (1981), and Robotron 2084 (1982). The goal is *understanding* the sound algorithms — and **playing them aloud is a first-class requirement**, not a side-effect. Every sound on these cabinets is a tiny 6800 program; the explorer makes those programs visible *and audible* at human-scale time (1× down to single-step), with visualizations that expose phase accumulators, LFSR state, wavetable cursors, envelope decay, and the raw DAC byte stream.

> **Pivot per user feedback (plan v2):** the original v1 phasing put the first audible output at end of Phase 2. We've pulled the offline WAV render forward into Phase 1 so the *first ear-check happens immediately after Step 1.4*, before any browser/AudioWorklet plumbing. Phase 2 is now purely "real-time playback in the browser."

A lot of foundation work is already done:

- **All three sound ROMs are assembled cleanly** (`tools/{defender,stargate,robotron}_sound.bin`) via `tools/build_roms.sh` from the original Williams source, which had to be bridged through 17 distinct Motorola-dialect quirks (see `docs/pipeline/vasm_install_notes.md`).
- **12 design / catalogue / research docs** are written and indexed at `docs/README.md`. The pedagogical vision (5 principles + 12 UX patterns) lives in `docs/design/pedagogical_design.md`. The architectural spine (6 phases, snapshot schema) lives in `docs/implementation/explorer_architecture.md`.
- **TypeScript explorer scaffolding** is started at `explorer/`: package.json + tsconfig + Vitest, with a 21-opcode 6800 CPU core and a PIA / soundboard stub. The integration test boots all three ROMs through SETUP → BRA-self idle loop (`10 passed`).

This plan converts the existing docs into an executable roadmap and commits to specifics. It does **not** redesign anything that's already designed — it sequences.

## Decisions confirmed with the user

| Decision | Choice |
|---|---|
| UI framework | **Vite + plain TypeScript + canvas** (no reactive framework until Phase 4 if needed) |
| Deployment | **GitHub Pages** via Vite static build |
| ROM distribution | **Bundle** `*_sound.bin` in `explorer/public/roms/` |
| First sound to target | **LITE ($11) Lightning** — smallest opcode cone for end-to-end IRQ-driven sound |
| Snapshot decimation default | every 64 CPU cycles (≈14 kHz to UI) |
| Cycle-accuracy validation | ear + spectrogram for Phases 1–3, MAME DAC-diff before Phase 5 |
| Reference audio capture | defer to Phase B emulator-driven path; ad-hoc MAME captures only as A/B sanity checks |

## The roadmap

Six phases, 18 numbered steps. Each step has a concrete deliverable and a verification approach.

### Phase 1 — Get LITE making sound (offline WAV)

**Step 1.1 — Wire PIA IRQ into CPU** *(blocker for everything else; ~0.5 day)*
The PIA already exposes `isIRQPending()` (`explorer/src/board/pia.ts`) and the CPU has `irqPending` (`explorer/src/cpu/types.ts`), but they aren't connected. Wire `SoundBoard` (`explorer/src/board/soundboard.ts`) to propagate the PIA flag onto `cpu.irqPending` before each `step()`, and ensure Port-B reads clear it (the PIA already does this).
*Verify:* Vitest in `explorer/tests/irq.test.ts` — boot Defender to its `BRA *` idle loop, call `board.pia.setCommand($00)`, run a few steps, assert (a) CPU left the idle loop, (b) interrupt stack frame is well-formed (PC/X/A/B/CCR pushed in order), (c) PC lands at the IRQV target. Also assert the second call to `setCommand` re-fires.

**Step 1.2 — Expand opcode table for LITE** *(1–1.5 days)*
LITE (`$11`) exercises the LFSR-noise inner loop. Adding to `explorer/src/cpu/instructions.ts` — opcodes the LITE path needs, with per-opcode flag/cycle tests in the existing `tests/flags.test.ts` style:
- Logical / arithmetic: `EORA` (#/dir/ext/ind), `ANDA` (#/dir/ext/ind), `COMA`/`COMB`/`COM` mem, `ADDA`/`SUBA` (#)
- Shifts/rotates: `LSRA`/`LSRB`/`LSR` mem, `RORA`/`RORB`/`ROR` mem
- Tests / branches: `TST` (mem/A/B), full conditional branch set (`BEQ`/`BNE`/`BCC`/`BCS`/`BMI`/`BPL`/`BVC`/`BVS`)
- Counters: `DECA`/`DECB`/`DEC` mem, `INCA`/`INCB`/`INC` mem, `INX`/`DEX`/`CPX` (#/dir/ext)
- Stack / interrupt: `PSHA`/`PSHB`/`PULA`/`PULB`, `RTI`, `WAI`, `BSR`
*Verify:* ~70 datasheet-checked unit tests; CPU still throws on missing opcodes so any gap shows up immediately.

**Step 1.3 — Command-driven sound-completion harness** *(0.5 day)*
New `explorer/src/runner.ts`: `runSound(game, cmd, maxCycles): DACEvent[]` — boots ROM, fires `pia.setCommand(cmd)`, runs until either (a) PC re-enters the `BRA *` idle, or (b) `maxCycles` exceeded. Returns the `pia.dacEvents[]` array.
*Verify:* sound `$11` LITE on Defender produces a non-empty event stream within a known cycle budget; the IRQ stack-tail returns to `BRA *`.

**Step 1.4 — Golden DAC capture for LITE** *(0.5 day)*
Lock the `(cycle, value)` event log as a regression fixture: `explorer/tests/golden/defender_11_lite.json`.
*Verify:* Vitest snapshot match.

**Step 1.5 — DacSampler + LPF (offline, pure functions)** *(1 day)*
New `explorer/src/synth/DacSampler.ts` (zero-order-hold 894886 Hz → 48000 Hz, structurally identical to the `DacSampler` in `research/findings_sound_studio.md` §5.1) and `explorer/src/synth/lpf.ts` (single-pole biquad ~10 kHz, Q≈0.7, modelling the 1458 op-amp roll-off documented in `docs/hardware/sound_hardware_model.md`).
*Verify:* deterministic Vitest — feed the golden LITE stream, assert sample count = `cycles / (894886/48000)` ± 1, range inside [-1, +1], LPF DC response = 1.0.

**Step 1.6 — Node WAV exporter — *first ear-check*** *(0.5 day)*
New `tools/render_sound.ts` — writes `out/defender_11_lite.wav`. **This is the milestone moment**: open the file in any audio player and hear the Williams Defender lightning sound, generated from the original 1980 ROM running on your TypeScript emulator.
*Verify:* manual listen against a MAME `-wavwrite` of the same sound (Path A from `docs/pipeline/reference_audio_plan.md`). Spectrograms in Audacity should match within ear-tolerance.

**Phase 1 deliverable:** *an audible WAV file of LITE that you can play right now*, plus a JSON regression fixture for the underlying DAC byte stream.

### Phase 2 — Real-time playback in the browser

**Step 2.1 — AudioWorklet wrapper + message protocol** *(✅ DONE 2026-05-25)*
New `explorer/src/audio/{realtimeRunner,worklet,host,main}.ts` + Vite scaffold (pulled forward from Phase 3.1; the worklet needs ES-module bundling). Message protocol `{type: "load"|"fire"|"stop"|"speed", payload}`. CPU runs inside the worklet via a Node-testable `RealtimeRunner`; bundled to `public/williams-sound-worklet.js` via esbuild. Speed scaling implemented as direct CPU-clock multiplier — slowing audibly drops pitch and exposes the LFSR clock.
*Verified:* `npm run dev` → http://localhost:5173, Init → Fire 0x11 plays LITE in real time. 12 new Vitest tests in `realtimeRunner.test.ts` (boot silence, LITE fire, cycle accounting, speed scaling, DAC drainage, re-fire, offline equivalence). 125 / 125 passing total. Snapshot streaming deferred — wired on demand for Phase 3.

**Step 2.2 — Speed slider + Pause/Step** *(✅ DONE 2026-05-25)*
Preset speed buttons 1× / ¼× / ¹⁄₁₀× / ¹⁄₁₀₀× + continuous slider 0.01..2× + Pause (freezes CPU; output holds LPF level click-free) + Single-Step (advance one 6800 instruction while paused). Direct CPU-clock scaling — slowing audibly drops pitch, exposing the LFSR clock at 0.1× as a click train. The "decoupled snapshot" interpretation from Open Question #3 is deferred to Phase 3+; for Phase 2 the slider IS the CPU clock multiplier.
*Verified:* manual ear-check confirmed by user. 6 new tests in `realtimeRunner.test.ts` covering pause/resume/step/click-free hold.

**Step 2.2+ — Debugger primitives + glossary** *(✅ DONE 2026-05-25; not originally in the plan)*
User feedback after 2.2 land: "a single CPU instruction does not do much — show the actual instruction." Pulled three Phase-3-ish features forward to make Single-Step useful:
- **6800 disassembler** (`src/cpu/disasm.ts`) — mnemonic + addressing-mode table covering every implemented opcode, with `formatDisassembly()` producing `F800  8E 00 7F  LDS  #$007F` lines. 15 new tests.
- **Semantic step modes** on RealtimeRunner — `step / stepToNextDacWrite / stepToNextIrq`, all gated to paused mode, with `runUntil(predicate)` as the shared primitive. 7 new tests.
- **Live CPU-state readout in the UI** — disassembly + A/B/X/SP/PC/CCR flags + cycle count + DAC byte. Worklet posts `{type: "state", snapshot}` after every step.
- **Glossary panel** — `tools/build_glossary.py` parses the per-game catalogue docs into `explorer/public/data/glossary.json` (128 entries). UI shows live "what does $11 do?" tooltips next to the hex command field, plus hoverable shortcut chips.
*Verified:* 153 / 153 tests passing. Manual: typing `11` shows "LITE — Lightning (LFSR) — upward LFSR sweep"; Step ▸ DAC shows the line of 6800 code that just moved the speaker.

**Step 2.3 — Tape-loop scrubber (Pattern 11)** *(✅ DONE 2026-05-26)*
Always-on DAC-history ring buffer (50k events, ≈ 5s dense / 90s sparse). `RealtimeRunner.startScrub / setScrubPosition / setScrubSpeed / exitScrub` plus a `fillBlockScrub` path that doesn't touch the CPU — reads ZOH samples from the history at the scrub head and applies the same LPF as live playback. Negative speed = reverse playback (Pattern 11 demo). UI: range slider across the recorded cycle range + ⏪/⏸/⏩ speed presets + Live button to exit.
*Verified:* 41 tests in `realtimeRunner.test.ts` covering scrub start/clamp/speed/exit/recorded-range + 16 in `dacHistory.test.ts` for the ring buffer. 185 / 185 passing total. Manual: drag across LITE → audible playback; ⏪ presets play the LFSR backwards.

**Phase 2 deliverable:** ✅ Click Init → Fire → hear LITE in real-time → slow it down → Pause → step instruction-by-instruction → Scrub → drag through any recorded slice → play reverse. Pattern 11 live.

### Phase 3 — Visualization v0

**Step 3.1 — Vite scaffold + three-panel triangle (Pattern 1)** *(✅ DONE 2026-05-26)*
Vite scaffold was already in place from Phase 2.1, so 3.1 was just the three panels + shared cursor. `src/viz/{Ear,Eye,Code}Panel.ts` each implement a tiny `VizPanel` interface (`update(snapshot)`); `main.ts` dispatches every snapshot to all three. Ear = oscilloscope of `snapshot.lastSamples` (new 512-float ring in RealtimeRunner, default 10.7 ms window). Eye = horizontal DAC gauge with positive/negative fill from mid-rail, plus a cycle-cursor hint that switches between "live cycle" and "scrub cycle" based on snapshot state. Code = the existing register + disassembly readout, now inside the panel grid.
*Verified:* 188 / 188 tests passing (3 new for lastSamples). Manual: pausing + dragging the scrubber updates the Ear waveform, the Eye gauge needle, and the Code cycle counter in lockstep.

**Step 3.2 — Oscilloscope + Spectrogram** *(✅ DONE 2026-05-26)*
RealtimeRunner now records a parallel `rawRing` of pre-LPF sample values alongside the existing `outputRing`; both ride along in every snapshot as `lastSamples` and `lastRawSamples`. EarPanel renders both as a dual trace (raw = dim cyan stair-step, LPF = bright green smoothed line) so the LPF's role is visible. New `viz/Spectrogram.ts` is independent of the snapshot poll — it reads from a host-side AnalyserNode at rAF rate, scrolling right-to-left with a log-frequency y-axis + magma colour ramp. Added a 5 Hz `BiquadFilterNode` between gain → destination/analyser to model the Williams amp's AC-coupling (kills the persistent DC band the spectrogram was otherwise painting after sounds ended).
*Verified:* 198 / 198 tests passing. Manual: LITE's LFSR broadband sweep visible in the spectrogram; LPF smoothing visible in EarPanel; spectrogram goes dark after sounds end.

**Scrubber UX overhaul** *(✅ DONE 2026-05-26; not originally in the plan)*
Per user feedback the bare scrubber from 2.3 was hard to use. Added: per-fire sound segments with idle-detection close; hex-labelled markers + end-ticks on the scrub slider (click to jump + auto-loop); 3-mode loop (none / range / segment); ▶/⏸ play-pause toggle remembering last speed; Scrub-mode now starts FROZEN (head doesn't slide away); ⟲ Reset that un-pauses + wipes; default Compact timeline mode that skips inter-sound silence on the slider. Mute button removed (foot-gun). First-marker visibility fix (extended slider range leftward to include `fire()` cycle of earliest segment).

**Step 3.3 — DAC byte tape (Pattern 2)** *(✅ DONE 2026-05-26)*
EyePanel rewritten as a scrolling DAC byte tape: each `$0400` write is a coloured cell whose width = cycles-held-until-next-write; symmetric blue/green/yellow/red palette around the mid-rail. PIA now records the CPU's PC at every write (PIA.write extended to take pc; SoundBoard.write passes it; DACEvent + DacHistory store it; golden fixture re-seeded). Hover a cell → tooltip `$XX (norm) · cycle N · from PC $YYYY`. Source-line resolution deferred to Step 3.4.
*Verified:* 199 / 199 tests passing (+1 PC-capture test). At slow scrub speeds, each LITE LFSR cell is individually visible.

**Step 3.4 — Stage swimlane + label-map build script** *(✅ DONE 2026-05-26)*
`tools/build_roms.sh` now passes `-L tools/build/${src}.lst` to vasm for per-file listings. `tools/build_labelmap.py` parses each listing's symbol table (`A:HHHH` entries only) joined with the body's `addr → first_src_line` table into `explorer/public/data/{defender,stargate,robotron}_labelmap.json` (181/179/364 labels). `src/audio/labelMap.ts` exposes binary-search `resolve(pc) → { label, src_line, offset }`. `src/viz/StageSwimlane.ts` consumes the existing `snapshot.recentDacEvents` (option (b) — PC sampled at DAC writes only), resolves each event's PC to a label, collapses consecutive same-label events into segments per lane. EyePanel tooltip now appends `in {label}+{offset} / VSNDRM*.SRC:{line}`. PC-history ring buffer (option (a)) deferred — only matters if Phase 4 routines have long silent stretches.
*Verified:* 219 tests passing (+15 for label-map/resolver). Manual: LITE shows lanes SETUP → IRQ → LITE → LITEN → IRQ tail → BRA * as designed.

#### Step 3.4 design (resume-from-fresh-session ready)

**Where the address data comes from.** vasm doesn't currently dump a usable symbol table — the existing `tools/build/VSNDRM*.log` files are empty (`build_roms.sh` redirects stderr only and the assembler is quiet on success). Three viable paths, ranked easiest-first:

1. **Extend `build_roms.sh` with `vasm -Lns ...` listing output**, then have `build_labelmap.py` parse the listing. vasm's listing format is `ADDR  HEXBYTES  SOURCE`, with labels on column 1. Parse: for each line where col 1 starts with a non-whitespace identifier and ADDR is hex, emit `(LABEL, ADDR, source_line)`. Address ranges = each label spans from its address to the next-larger label's address. Robust + minimal changes.
2. Run vasm with `-symdebug=elf` and parse the symbol section (heavier — requires ELF parsing).
3. Pure Python mini-assembler over the `.SRC` files (hand-track each instruction's byte count). Most work; reinvents the wheel.

Go with option 1. Roughly:
```sh
"$VASM" -Fsrec -ast -unsshift -Lns "tools/build/${src}.lst" \
        -o "tools/build/${src}.s19" "tools/build/${src}.s68" ...
```
Then `tools/build_labelmap.py` parses the `.lst` for label/addr pairs and writes `explorer/public/data/{game}_labelmap.json`.

**Schema of the label map** (`{game}_labelmap.json`):
```json
{
  "game": "defender",
  "labels": [
    { "addr": "F800",   "label": "RESET",     "src_line": 17  },
    { "addr": "F803",   "label": "SETUP",     "src_line": 21  },
    { "addr": "F870",   "label": "MAINLOOP",  "src_line": 89  },
    { "addr": "F900",   "label": "IRQ_HANDLER", "src_line": 152 },
    { "addr": "FA10",   "label": "LITE",      "src_line": 411 },
    { "addr": "FA40",   "label": "LITEN",     "src_line": 433 },
    …
  ]
}
```
Each label's effective range = [`labels[i].addr`, `labels[i+1].addr - 1`]. Last label extends to `0xFFFF`. Host code resolves a given `pc` via binary search.

**Where the swimlane gets its time-series of PC.** Two options:
- (a) **Sample PC at fixed cycle intervals** (e.g., every 256 cycles ≈ 286 µs) into a new `pcHistory: PcHistory` ring buffer in `RealtimeRunner`, parallel to `DacHistory`. Capacity: ~10 000 samples = ~2.9 seconds of fine-grained history.
- (b) **Reuse DacHistory** — the panel uses each DAC event's already-captured `pc`. Cheap (no new ring), but PC is only sampled when the CPU writes the DAC. During silence the swimlane shows no data. Probably fine for the LITE pedagogical case — the user wants to see WHICH ROUTINE is running while sound is being made, which is exactly when DAC events fire.

Recommendation: start with (b) — minimum new wiring, validates the visualisation. If the swimlane feels gappy during silent stretches inside an IRQ handler (e.g., GWAVE's per-sample wait loops), promote to (a) in a follow-up.

**New viz module** `src/viz/StageSwimlane.ts` with the same `VizPanel` interface:
- Loads the per-game label map on construction (passed in by `main.ts`).
- On each `update(snapshot)`:
  - Pulls `snapshot.recentDacEvents` for time-positioned PC samples + same `windowStart`/`windowEnd` bounds the byte-tape already uses.
  - Resolves each PC to its label via the label map.
  - Renders horizontal bands: y-axis = label lane (one band per distinct label seen in the window), x-axis = time.  Each band is the union of `[event.cycle, next_event.cycle)` rectangles for events in that label.
  - Hover → tooltip with label + source-line + cycle range.
- Same hover-tooltip mechanism as `EyePanel` (single absolutely-positioned `<div>` on the body).

**Layout.** Add the swimlane as a new full-width panel under the spectrogram (mirroring how the spectrogram sits below the triangle). Section heading "Stage swimlane — which routine is running."

**Bonus: source-line resolution in the DAC byte tape tooltip.** Once the label map is available, the byte-tape's hover tooltip can resolve `pc → label + src_line` and show "from PC $FA47 (LITEN +7 in VSNDRM1.SRC:436)". One-line addition to `EyePanel.ts`'s hover handler.

**Build pipeline integration.**
- Add `build_labelmap.py` invocation to `prepare:public` in `package.json` (it depends on the `.lst` files from `tools/build/`, so it can run after `build_roms.sh` — or be called from inside it).
- Update `.gitignore` for `tools/build/*.lst` and the generated `public/data/*_labelmap.json`.
- `package.json`'s `prepare:public` becomes: `mkdir -p public/roms public/data && cp ../tools/*_sound.bin public/roms/ && python3 ../tools/build_glossary.py && python3 ../tools/build_labelmap.py`.

**Tests.**
- `tests/labelmap.test.ts` (or extend an existing test file): load each generated `{game}_labelmap.json`, verify it contains known labels (e.g. Defender has "LITE" + "LITEN" + "SETUP"), verify addresses are within the game's ROM range, verify the array is sorted ascending by addr.

**Acceptance.** Fire LITE in the browser. Stage swimlane shows bands at successive y-positions for `SETUP` → `IRQ_HANDLER` → `LITE` → `LITEN` → back through `IRQ_HANDLER` (tail) → `BRA *` idle. Visually confirms what `docs/catalogue/defender_sound_catalogue.md` describes about the dispatcher path.

**Phase 3 deliverable** *(✅ DONE 2026-05-26)*: *a working "see waveforms scrolling as audio plays" UI for LITE.* Patterns 1 and 2 fully live, plus the swimlane that ties DAC events back to their source routine.

### Phase 4 — Per-engine introspection

**Step 4.1 — Snapshot schema completion** *(✅ wired 2026-05-26; populator extended per-engine as sounds come online)*
New `src/audio/engineState.ts` dispatches by PC range and produces an `EngineSlots` partial that the runner spreads into `snapshot()`.  Currently populates only the **LFSR slot** (LITE on Defender + Stargate: state=HI:LO at $09:$0A, bit_out=LO&1, LFREQ at $19, CYCNT at $15).  Code panel renders the slot as a raw readout below the register dump.  `gwave` / `vari` / `fnoise` / `scream` / `organ` slots are stubbed in the architecture doc and will be added as their sounds come online (4.2 = VARI, 4.3 = GWAVE, 5.1 = SCREAM, 5.2 = ORGAN).
*Verified:* 8 new tests in `tests/engineState.test.ts` — idle = no slot, LITE fire populates lfsr matching the live RAM, slot clears once PC leaves the LITE range, Stargate behaves identically, pure `engineStateForPc` works standalone.

**Step 4.2 — Second sound: VARI/SAW ($1D)** *(✅ DONE 2026-05-26)*
Opcode coverage from Steps 1.2 / 2.2+ was already sufficient — SAW reached idle on the first `tools/render_sound.ts defender 0x1D` run.  `engineState.ts` extended with a `vari` slot (LOPER $13, HIPER $14, LODT $15, HIDT $16, HIEN $17, LOMOD $1A, LOCNT $1C, HICNT $1D — signed for deltas).  New `viz/VARIView.ts` mounts in a collapsible "Engine view" section: two countdown bars (LOCNT/LOPER and HICNT/HIPER) + one-period duty-cycle preview that updates in lockstep with the slot.  Second golden fixture seeded (`tests/golden/defender_1D_saw.json`).
*Verified:* 231 tests passing (+3 for VARI slot + golden SAW). Manual: firing $1D shows the bars sweeping and the duty preview's asymmetry shrinking as LOPER decays.

**Step 4.3 — Heartbeat HBDV ($01): GWAVE engine** *(✅ DONE 2026-05-26)*
GWAVE wired with no new opcodes needed (Step 1.2 covered the whole 6800 surface). `engineState.ts` extended with a `gwave` slot reading GECHO/GCCNT/GECDEC/GDFINC/GDCNT, GWFRM/GWFRQ as words, PRDECA, GPER/GECNT, signed FOFSET, plus the live 72-byte wavetable at `$24..$6B`.  `engineStateForPc(pc, board, x?)` now also takes the X register so the slot can expose `sampleIndex = (X − $24)` (negative when X points outside the table, e.g. during loader).  New `viz/WavetableView.ts` mounts in the existing Engine view section: 72 bars centred on mid-rail (positive grows up, negative grows down) with a yellow cursor at the live sample index + value bubble; caption shows GPER/GECHO/GECNT; footer shows GWFRM/GWFRQ/FOFSET/GDFINC/PRDECA/GECDEC.  Third golden fixture (`defender_01_hbdv.json`) seeded.
*Verified:* 238 tests passing (+7 for GWAVE slot + HBDV golden).  Ear-check on browser: HBDV's heartbeat audible at 1×, slows audibly at ¹⁄₁₀× with the cursor visibly stepping through the table.

**Step 4.4 — Solo / mute / freeze toggles (Pattern 3)** *(✅ DONE 2026-05-26)*
Implemented as a `shouldDiscardWrite()` predicate consulted by `SoundBoard.write()`.  Four surgical toggles, each gating one or two RAM addresses (optionally PC-gated): `lfsrFreeze` ($09/$0A), `variFreezePeriod` ($13/$14), `gwaveFreezePattern` ($21), `gwaveSkipDecay` ($24..$6B inside WVDECA range).  Plumbing: new `audio/engineToggles.ts` module, `SoundBoard.toggles` field, `RealtimeRunner.setToggle()`, worklet `engine-toggle` message, `host.setEngineToggle()`.  UI: a row of labelled checkboxes (built from `ENGINE_TOGGLE_META` so adding a new toggle stays one-file) sits at the top of the Engine view section; clicks before Init are stashed locally and replayed once the host is ready.
*Verified:* 252 tests (+14): the pure predicate's truth table, every toggle freezes its target cell, and a sanity-check pair confirms the same cell DOES drift when the toggle is off.  Manual: firing LITE with Freeze LFSR yields the same periodic click train forever; firing HBDV with Skip WVDECA holds the wavetable bars at full amplitude across echoes.

**Step 4.5 — Causal hover trace (Pattern 8)** *(✅ DONE 2026-05-26)*
Spectrogram tracks per-column CPU cycle in a parallel Float64Array (sized to canvas width) so mouseX → historical cycle is accurate independent of vsync rate / pause / scrub.  EyePanel publishes via `setHoverHooks()` (cell-change throttled so the cross-panel inspect doesn't churn on intra-cell motion).  Both feed into a single `publishInspect("source", cycle)` sink in `main.ts` that resolves cycle → PC via a client-side `pcByCycle` cache (accumulates from each snapshot's `recentDacEvents`; capped at 60 000 entries; cleared on recording reset), then sets the CodePanel's inspect cursor.  CodePanel renders `INSPECT [src]  cycle=N  PC=$YYYY  LABEL+offset  file.SRC:line` at the top when the cursor is set.
*Verified:* 258 tests passing (+6 codePanelInspect tests). Manual: firing LITE then hovering the spectrogram spike that just appeared shows `LITEN+7  VSNDRM1.SRC:268` in the Code panel; hovering a 5-second-old column resolves via the client-side cache.

**Phase 4 deliverable:** *scrubbable LITE + SAW + HBDV with solo/mute and causal hover.* Patterns 3 and 8 live.

### Phase 5 — Robotron + more engines *(✅ DONE 2026-05-26 — single commit)*

- **Step 5.1 — SCREAM ($1A) view** ✅. New `scream` slot (4 voices × {freq, timer}) + `viz/SCREAMView.ts` (phase wheels + paired FREQ/TIMER bars).  Golden fixture `robotron_1A_scream.json` captures the first 1 s (SCREAM doesn't terminate at idle).
- **Step 5.2 — ORGAN + RDELAY** ✅.  New `organ` slot (DUR, OSCIL bitmask, 60-byte RDELAY scratchpad) + `viz/ORGANView.ts` (8 LEDs + RDELAY heatmap).  No fire-and-capture golden — ORGAN runs inside the IRQ tune-tick, not from a single command; populator is covered by a pure-reader test that pokes RAM directly.  Self-modifying RDELAY handling deferred: today the heatmap just shows the current bytes; treating it as a dynamic label range in the swimlane is a follow-on.
- **Robotron engine specs** ✅ (prerequisite for SCREAM/ORGAN).  `engineState.ts` refactored from `{ENGINE}_RANGES` to per-game `{ENGINE}_SPECS` carrying both code ranges and zero-page cell addresses (Robotron's layout differs across the board — LO/HI at $06/$05 etc.).  Same restructure cascades into `engineToggles.ts`.
- **Step 5.3 — A/B diff (Pattern 6)** ✅.  `viz/ABDiff.ts`: two parallel byte tapes + red divergence band + "% identical" summary.  Browser-side: `runSoundWithRom()` (new in `runner.ts`) with ROMs from `loadRomFromUrl()` (new in `board/romFetch.ts`).  Node-only `runSound()` moved to `runnerNode.ts` so Vite stops tripping over `node:fs`.
- **Step 5.4 — Genealogy (Pattern 7)** ✅.  Hand-curated `public/data/genealogy.json` (5 families).  `viz/Genealogy.ts` renders chips that fill the A/B diff selectors + a per-family "Compare ↔" auto-fire button.  List shape, not graph — the relationships are flat-by-engine and a list reads more clearly at this scale.

**Phase 5 deliverable:** ✅.  All five Robotron-relevant engines wired (Robotron has SCREAM + ORGAN unique to itself; LFSR/VARI/GWAVE shared with Defender/Stargate at different addresses).  A/B diff + Genealogy live.  Patterns 6 and 7 done.  +6 new tests (264 total).

### Phase 6 — Pedagogy + polish *(in progress)*

- **Step 6.1 — Build-up / tear-down tracks (Pattern 4)** *(1 day, pending)*. Leverages Pattern 3 toggles.
- **Step 6.2 — What-if parameter sliders (Pattern 5)** *(✅ DONE 2026-05-26)*. `SoundBoard.paramOverrides` map intercepts writes; VARI pane has force-toggleable LOPER + HIPER sliders with per-game addresses.
- **Step 6.3 — Annotated explainer cards (Pattern 9)** *(2 days, writing-heavy, pending)*. JSON-authored content per sound.
- **Step 6.4 — Listen-then-look quiz (Pattern 10)** *(1 day, pending)*. Reuses Pattern 9 content.
- **Step 6.5 — "No-explanation" toggle (Pattern 12)** *(0.5 day, pending)*. Single global CSS class.
- **Step 6.6 — Single-instruction step + RAM heatmap + difficulty tiers** *(1 day, pending)*.

**Phase 6 follow-ons that landed alongside 6.2** (outside the original step list):
- **FNOISE engine slot + view** — closed the last "un-wired engine" caveat from Phases 4/5.  Adds fourth Defender golden fixture (CANNON).
- **Scrub-mode RAM time-travel** (`audio/ramHistory.ts`) — engine-view bars / wavetable / countdowns now animate as the user scrubs.  Closed the long-standing caveat.
- **UI restructure** — segmented game switcher, two-column sticky layout, draggable splitter, per-game chip browser (auto from glossary), responsive auto-fit engine grid, ResizeObserver on every canvas, MANUAL.md user manual.

**Phase 6 deliverable:** *a true learning tool.* Patterns 4, 5, 9, 10, 12 done.  Currently 5/12 patterns landed in Phase 6 (Pattern 5 from 6.2; Patterns 4/9/10/12/+RAM heatmap remain).

## Pattern → phase mapping (final)

| Pattern | Phase | Notes |
|---|---|---|
| 1 Three-panel triangle | 3 | scaffold (audio is already running) |
| 2 DAC byte tape | 3 | core |
| 3 Solo / mute / freeze | 4 | per-primitive toggles |
| 4 Build-up / tear-down | 6 | leverages Pattern 3 |
| 5 What-if parameter sliders | 6 | ROM-shadow RAM |
| 6 A/B diff | 5 | needs both ROMs |
| 7 Genealogy | 5 | data file + Pattern 6 view |
| 8 Causal hover trace | 4 | timeline + snapshot ring |
| 9 Explainer cards | 6 | writing |
| 10 Listen-then-look | 6 | uses cards |
| 11 Tape-loop scrubbing | 2 | live with the AudioWorklet |
| 12 "No-explanation" toggle | 6 | one CSS class |

## Critical files

**Existing (will be modified):**
- `explorer/src/board/soundboard.ts` — Step 1.1 IRQ propagation
- `explorer/src/cpu/m6800.ts` — referenced by Step 1.1 wiring
- `explorer/src/cpu/instructions.ts` — Steps 1.2, 4.2, 4.3 opcode additions
- `explorer/src/board/pia.ts` — already exposes `setCommand()`/`isIRQPending()`/`dacEvents`
- `docs/README.md` — update project state at end of each phase

**New (to be created), by phase:**
- Phase 1: `explorer/src/runner.ts`, `explorer/tests/irq.test.ts`, `explorer/tests/golden/defender_11_lite.json`, `explorer/src/synth/DacSampler.ts`, `explorer/src/synth/lpf.ts`, `tools/render_sound.ts`
- Phase 2: `explorer/src/audio/worklet.ts`, `explorer/src/audio/host.ts`, minimal HTML harness
- Phase 3: `explorer/vite.config.ts`, `explorer/index.html`, `explorer/src/main.ts`, `explorer/src/viz/{Oscilloscope,Spectrogram,DACTape,StageSwimlane}.ts`, `tools/build_labelmap.py`, `explorer/public/data/{game}_labelmap.json`
- Phase 4: `explorer/src/viz/{VARIView,WavetableView}.ts`, snapshot-completion in worklet
- Phase 5: `explorer/src/viz/{SCREAMView,ORGANView,ABDiff,Genealogy}.ts`, `explorer/public/data/genealogy.json`
- Phase 6: `explorer/src/viz/{BuildTearDown,Sliders,ExplainerCard,Quiz}.ts`, `explorer/public/data/explainer/{game}_{cmd}.md`

## Reuse from existing code

- `pia.setCommand(byte)` — fire-and-forget injection of a sound command (already implemented).
- `pia.dacEvents[]` — append-only log used by the snapshot pipeline (already implemented).
- `SoundBoard` (`explorer/src/board/soundboard.ts`) — already implements `Bus`; just needs IRQ wiring.
- `createCPU()` / `reset()` / `step()` (`explorer/src/cpu/m6800.ts`) — keep as-is; opcode table grows but this surface is stable.
- `tools/build_roms.sh` — re-runnable from source; the explorer's `public/roms/` is just `cp` from `tools/`.
- `docs/hardware/synthesis_techniques.md` — every visualization layer maps to one of the 8 primitives documented there; use the diagrams as the design source.

## Verification

Per-phase:
- **Phase 1**: `cd explorer && npm test` passes including the new IRQ test. Golden DAC stream matches a checked-in fixture. **`npx tsx tools/render_sound.ts defender 0x11 out/lite.wav` produces an audible WAV** — first ear-check happens here.
- **Phase 2**: `cd explorer && npm run dev` opens the harness in browser; pressing Play renders LITE in real time; speed slider + scrubber both work.
- **Phase 3**: full three-panel triangle is visible; the spectrogram shows the LITE LFSR sweep; all three panels move together when the playhead scrubs.
- **Phase 4**: scrub HBDV mid-sound, hover a spectrum spike → the source line for the `WVDECA` iteration that caused it lights up; toggle "freeze pattern" → sustained pitch.
- **Phase 5**: Beethoven 9th from Robotron's ORGAN engine plays correctly; A/B view shows Defender HBDV ≡ Robotron HBDV byte-for-byte; genealogy graph navigates to either.
- **Phase 6**: load any sound, hit "no-explanation" → predict the algorithm from data alone, toggle on → check.

**Cycle-accuracy gate before Phase 5:** run all `runSound(*)` outputs through a MAME capture and assert per-sample diff ≤ 1 LSB for at least one canonical sound per game.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|:-:|:-:|---|
| Cycle-accuracy drift vs MAME (`SYNC N` idioms in GWAVE/CDR/SING) | M | H | Per-opcode datasheet cycle tests; golden DAC regression gates every CPU PR; MAME diff gate before Phase 5 |
| Self-modifying code in ORGAN's RDELAY scratchpad | H | M | Treat as a dynamic label range; defer ORGAN to Phase 5.2 once basics stable |
| AudioWorklet quirks across Safari/Firefox | M | M | Test on all 3 early; Safari needs explicit `AudioContext.resume` after user gesture |
| Performance budget at 1× (CPU + snapshots + FFT) | M | M | Use native `AnalyserNode` for FFT; cap snapshot post rate; profile on mid-tier laptop |
| Slow-mode UX (sub-audible audio + sparse snapshots) | H | M | Decouple — render audio at 1×, animate cached snapshots at slowed rate (Option (b) from `docs/implementation/explorer_architecture.md` Open Questions) |
| Opcode long tail discovered late | M | M | CPU throws on missing opcode; add a pre-load static scan that walks reachable PCs to list gaps |
| Reference-audio licensing if Path A used heavily | L | M | Stick to Path B (emulator-rendered) as canonical; treat MAME captures as ephemeral A/B aids |

## CLAUDE.md update (to apply after exiting plan mode)

The current `CLAUDE.md` is a one-line pointer. Replace it with content that gives the next session full context in under 60 lines:

```markdown
# Williams Sound Explorer

A browser-based explorer for the Williams arcade sound effects of **Defender** (1980), **Stargate / Defender II** (1981), and **Robotron 2084** (1982). Goal: deeply *understand* the sound algorithms via visualization and slow-motion animations.

## Project layout

- `docs/` — curated reference (start at **`docs/README.md`**). Key reads:
  - `docs/hardware/sound_hardware_model.md` — the Williams 6802 sound board
  - `docs/hardware/synthesis_techniques.md` — the 8 DSP primitives every sound uses
  - `docs/design/pedagogical_design.md` — 5 design principles + 12 UX patterns
  - `docs/implementation/explorer_architecture.md` — 6-phase plan + snapshot schema
  - `docs/{defender,stargate,robotron}_sound_catalogue.md` — every command code
- `research/` — raw findings (Defender/Stargate/Robotron ROM deep-dives) + cloned ROM source
- `tools/` — assembler toolchain + assembled `*_sound.bin` (run `tools/build_roms.sh` to rebuild)
- `explorer/` — the TypeScript app (Vite + plain TS + canvas; tests via Vitest)

## Current state

- ✅ All three ROMs assemble cleanly via `tools/build_roms.sh`
- ✅ TypeScript scaffolding + 21 opcodes + boot test (all 3 ROMs reach `BRA *` idle)
- ⏳ Phase 1 nearly complete; **immediate next step is wiring PIA → CPU IRQ delivery** so a sound command can actually fire

## Live execution plan

The full roadmap (6 phases, 18 numbered steps, decisions made, risk register) is in `/Users/mbackschat/.claude/plans/goal-is-to-built-purrfect-river.md` — update it as work proceeds.

## Commands

- `tools/build_roms.sh` — reassemble all three ROMs from source
- `cd explorer && npm test` — Vitest (10 tests passing as of last session)
- `cd explorer && npx tsc --noEmit` — strict TypeScript check

## Decisions already made

- **UI**: Vite + plain TS + canvas (no reactive framework until Phase 4 if needed)
- **Deployment**: GitHub Pages via Vite static build
- **ROM distribution**: bundle in `explorer/public/roms/`
- **First sound to target end-to-end**: LITE ($11) Lightning
- **Snapshot rate**: every 64 CPU cycles
- **Validation**: ear + spectrogram for Phases 1–3; MAME DAC-diff before Phase 5
```

## Definition of done (overall)

The explorer is "done" when a non-engineer can:
1. Open the explorer in a browser, pick a sound, hear it at 1×.
2. Slow it down to 1/100× and *see* the LFSR bits flipping / the wavetable being read / the SCREAM voices drifting.
3. Toggle "freeze pattern" or "mute echoes" and hear what changes.
4. Hover a spike in the spectrogram and have the explorer tell them which line of 6800 code caused it.
5. Switch to Robotron and play HBDV side-by-side with Defender's HBDV (Pattern 6 + Genealogy).
6. Toggle off all explanations, predict the algorithm from data alone, then toggle them back on to check.

## Recommended immediate next step

**Phase 6 work that remains** — pedagogy + writing, ranked by value-per-effort:

1. **Step 6.3 / 6.4 — explainer cards + listen-then-look quiz (Patterns 9 + 10).**  Writing-heavy.  JSON-authored annotated commentary per sound; the quiz reuses the cards.  Biggest writing investment, highest pedagogical payoff.
2. **MAME cycle-accuracy gate** (deferred Phase 5 prerequisite).  Capture canonical sounds in MAME, diff against the explorer's WAV output, assert per-sample ≤ 1 LSB.  Mostly mechanical; ungated until someone wants the quality stamp.
3. **Bulk audio export** — render every command in every game's catalogue to WAV under `out/`.  Useful for offline browsing, regression diffs, and seeding an Audacity comparison library.

### Step 6.1 / 6.5 / 6.6 — DONE 2026-05-26

- **Step 6.1 (Build-up / Tear-down, Pattern 4).**  Added 4 SCREAM voice-mute toggles (`screamMuteVoice0..3`) — each PC-gated to the SCREAM range, discarding the matching voice's TIMER cell write.  CLR ,X at SCREAM entry zeroes the cell; subsequent writes are dropped so `ADDA TIMER,FREQ` stays positive → BPL skips ADDB → voice silent.  FREQ left alone so the cascade keeps chaining new voices.  UI: 4 voice checkboxes + Build-up ↑ / Tear-down ↓ / ■ buttons inside the SCREAM engine pane; sequencer auto-switches to Robotron, fires `$1A`, flips mutes one at a time on a 700 ms timer.  5 new tests.
- **Step 6.5 (No-explanation toggle, Pattern 12).**  Header button toggles `body.hide-help`; CSS hides `.help-text` paragraphs, `details.help` collapsibles, `#cmdInfo`, the Glossary section, term-link styling, and `.voice-hint`.  Preference persists to localStorage.
- **Step 6.6 (RAM heatmap).**  `SoundBoard.lastWriteCycle: Uint32Array(256)` stamped on every successful write.  Snapshot exposes 128-byte `ramSnapshot` + matching `ramLastWrite`; scrub mode pulls historical RAM via `RamHistory`.  `viz/RAMHeatmap.ts` renders a 16×8 grid, cells colour-interpolated cold→hot over a 1-second decay, value as 2-char hex, hover tooltip `$AA = $VV · last write N ms ago`.  8 new tests.

**Phase 2 done:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 2.1 → 2.2 → 2.3.
**Phase 3 done:** 3.1 → 3.2 → 3.3 → 3.4.
**Phase 4 done:** 4.1 → 4.2 → 4.3 → 4.4 → 4.5.
**Phase 5 done:** 5.1 → 5.2 → 5.3 → 5.4 (single commit).
**Phase 6 done so far:** 6.1 + 6.2 + 6.5 + 6.6 + FNOISE slot + scrub-RAM-time-travel + UI restructure + MANUAL.md.
**Up next:** 6.3 / 6.4 (explainer + quiz) OR MAME cycle-accuracy gate.

---

# Plan — User-uploaded ROMs + clean MIT publish (2026-05-27)

## Context

The repo bundles the Williams arcade sound ROMs — `tools/{defender,stargate,robotron}_sound.bin` are **tracked**, copied into `public/roms/` at build, and served by any GitHub Pages demo. Their source header says `*COPYRIGHT WILLIAMS ELECTRONICS 1980`; distributing the bytes (or a live demo that serves them) is copyright infringement. To publish under **MIT** cleanly, the app must stop shipping the ROMs and instead let the user **upload their own**, stored locally in the browser (IndexedDB). The app must work with **as few as one** ROM. Decided with the user: no download links (point at "your own MAME romset / dump / build from source"); **drop the `historicalsource` submodule** from the published repo but keep the build-from-source toolchain + docs; publish as a fresh single-commit (orphan) push so ROM bytes never appear in history.

Verified facts (file:line): ROM enters the browser at exactly two functions — `WilliamsSoundHost.fetchRom` (`explorer/src/audio/host.ts:323-330`, called by `init()` at `:128`, which transfers the buffer to the worklet; worklet consumes at `explorer/src/audio/worklet.ts:202-208`) and `loadRomFromUrl` (`explorer/src/board/romFetch.ts:20-26`, used by WAV export `main.ts:~537` and `ABDiff.getRom` `explorer/src/viz/ABDiff.ts:92-98`; Genealogy delegates to ABDiff). `runSoundWithRom` (`runner.ts:94`) + worklet + `SoundBoard` are pure byte-consumers. **`SoundBoard` throws if `rom.length !== romSize`** (`soundboard.ts:67-69`) → uploads must be trimmed to exact size (2048 defender/stargate, 4096 robotron; ranges `0xF800`/`0xF000`, `soundboard.ts:30-34`). From-source `tools/defender_sound.bin` SHA-1 = `db679d0ad588c951de8bd25088e7fff7e883942d` (2-byte delta vs MAME `ceb0d184…`). No existing IndexedDB; reuse `$()` (`main.ts:41-45`), `els` (`:47-111`), and the hide-help body-class+localStorage pattern (`:1747-1763`).

## A. New modules

- **`explorer/src/audio/romValidate.ts`** (pure; only `crypto.subtle`): tiered validation.
  - `KNOWN_GOOD_SHA1: Record<GameKind, Set<string>>` seeded with 4 hashes — MAME production `ceb0d184…`/`9c4334ac…`/`15afefef…` **plus** from-source defender `db679d0a…`. Extensible.
  - `expectedSize(game)` (2048/4096), `trimTrailingPadding(bytes, expected)` (exact→pass; longer with uniform `0x00`/`0xFF` tail→trim; shorter→null), `checkVectors(bytes, game)` (IRQ word at offset `len-8`, reset at `len-2`, both must be in `[base, base+len-1]` — mirrors `build_roms.sh:59`), `sha1Hex(bytes)`, `validateRom(game, bytes) → {tier:'ok'|'warn'|'reject', game, sha, bytes(trimmed), message}`. Order: trim→reject; vectors→reject; sha in allowlist→`ok` else `warn`.
- **`explorer/src/audio/romStore.ts`** (raw IndexedDB, no new dep): DB `williams-sound`, store `roms` keyed by game; record `{game, bytes:ArrayBuffer, sha, tier, storedAt}`. `getRom`(returns a fresh `.slice()` copy), `getStored`, `putRom`, `hasRom`, `listRoms`, `deleteRom`. Plus `loadRomBytes(game)`: try `getRom`; else dev-fallback `fetch('/roms/<game>_sound.bin')` → `validateRom` → `putRom` (seed) → return; else throw. (validation in its own module so the pure logic is node-testable; store depends on validate, no cycle.)

## B. Reroute the two entry points (with gitignored `/roms` dev fallback)

- `host.ts:323-330` `fetchRom` → `return (await loadRomBytes(game)).slice().buffer`. Keep signature; `init()`'s transfer (`:129`) unchanged. `romBaseUrl` option becomes vestigial — leave with a comment. Each load returns a fresh copy, so the worklet transfer never neuters a shared buffer (safe; note in comment).
- `romFetch.ts:20-26` `loadRomFromUrl` → `return loadRomBytes(game)` (keep name/signature; both callers unchanged).
- Cache invalidation: on ROM replace/remove, clear `exportRomCache` (`main.ts:~511`) and add/​call `ABDiff.clearRomCache(game)` (`ABDiff.ts:76`) via a `rom-store-changed` window event.

## C. Onboarding overlay + autoInit refactor

- **Markup** (`index.html`): full-screen `#onboarding` div as a child of `.page` just before `#pageLayout` (`:637`), `display:none` default (reuse `#termPopover` show/hide idiom). Three labeled slots (Defender/Stargate/Robotron), each = drop zone + hidden file input + tier-feedback line + Replace/Remove once filled. Copy: ROMs not bundled (legal); "stored locally, nothing uploaded"; "build from source via `tools/build_roms.sh`". **No download links.** Primary "Enter the explorer" enabled once ≥1 ROM stored.
- **`explorer/src/audio/onboarding.ts`**: `mountOnboarding`/`showOnboarding(game?)`/`hideOnboarding()`. On file chosen/dropped → `arrayBuffer()` → `validateRom` → ok/warn store via `putRom` (mark filled), reject shows ✗; emit `rom-store-changed`. Plain-TS DOM style (cf. `Genealogy.ts`).
- **autoInit refactor** (`main.ts:1180-1191`): make async — `seedDevFallbacks()` (try `loadRomBytes` per game, swallow failures → preserves one-click dev when local `/roms` present); `const ready = await listRoms()`; if empty → `showOnboarding()` and return (do NOT init a worklet for a ROM-less game — `fetchRom` would throw); else `selectedGame = ready.includes("defender") ? "defender" : ready[0]`, `refreshGameSwitcherUi()`, `await switchToGame(selectedGame)`. Keep the DOMContentLoaded/queueMicrotask wrapper.

## D. Availability-aware switcher + cross-game guards

- Module-level `availableGames = new Set<GameKind>()`, refreshed from `listRoms()` at boot and on `rom-store-changed`.
- `refreshGameSwitcherUi` (`main.ts:134-146`): missing game → `locked` class + "Upload <Game>'s ROM" title, stays **clickable** (not `disabled`).
- Click wiring (`:1156-1160`): available → `switchToGame`; missing → `showOnboarding(game)`.
- `switchToGame` (`:1117-1145`): early `if (!availableGames.has(game)) { showOnboarding(game); return; }` — protects every caller.
- `runVoiceSequence` (`:1580-1583`): if Robotron missing → log + `showOnboarding("robotron")` + return; disable the 6 sequencer buttons when Robotron absent.
- A/B + Genealogy: single chokepoint — wrap `ABDiff.getRom`/`runAndRender` (`ABDiff.ts:101-103`) so a missing-ROM throw from `loadRomBytes` becomes a friendly "Upload <Game>'s ROM to compare" in `abSummary`; optionally grey `<option>`s for missing games.

## E. Edge cases
SubtleCrypto needs a secure context (localhost + GitHub Pages https both qualify) — guard `sha1Hex` with a clear error if absent. Wrong-game-in-slot: size mismatch → reject; a 2KB Stargate dropped on Defender passes (indistinguishable) as `warn` (message explains). Always store **trimmed** bytes (SoundBoard exact-size contract). Replace/Remove per slot; removing the active game falls back to another available game or onboarding. Seed allowlist with both defender SHAs so a developer's own build reads `ok`.

## F. Tests (Vitest; cf. `tests/chipFilter.test.ts`, `tests/zeroPageMap.test.ts`)
`explorer/tests/romValidate.test.ts` — `expectedSize`, `trimTrailingPadding` (exact/pad/short), `checkVectors` (hand-built buffers in/out of range), `validateRom` tiers (ok via a seeded SHA / warn / reject), guarded by `it.runIf(!!globalThis.crypto?.subtle)`. `romStore` IDB path: **skip** (`describe.skipIf(typeof indexedDB === "undefined")`) — node env has no IndexedDB; cover via manual E2E. Assert trimmed length always == expectedSize (so SoundBoard won't throw).

## G. Clean MIT publish — one private submodule at `research/` (git steps user-run)

**All** copyrighted/sensitive material — the Williams source, the assembled ROM
bins, AND the raw `findings_*.md` — moves into ONE private repo mounted as a
submodule at `research/`.  Nothing is local-only; it all lives on GitHub (private).
The toolchain, docs, and explorer (the user's own work) stay public.  The full,
exact procedure is in **`PUBLISHING.md`** (committed at repo root) — summary:

1. **Done (local prep, in this repo):** ROM bins moved `tools/ → research/roms/`; every path updated (`build_roms.sh`, `verify_roms.sh`, `board/rom.ts`, `npm run dev:roms`, `romValidate.test.ts`); `prepare:public` no longer copies ROMs (`dist/` has zero ROM bytes); `research/` untracked from the public tree (becomes a submodule gitlink); `LICENSE` (MIT) + `README.md` (scope/NOTICE) added; `.gitignore` reverted so `research/`/`.gitmodules` are NOT ignored (submodule).  `tests/romValidate.test.ts` covers the pure validator.
2. **User runs (GitHub):** flatten the nested `williams-soundroms` submodule to plain files; create the PRIVATE repo `williams-sound-private` from `research/` (findings + source + roms) and push; `git submodule add <private-url> research` in the public repo.  Then **squash to a single commit** (orphan trick — loses history; back up first) and force-push to a fresh PUBLIC remote.  Pre-push check: `git ls-files | grep -Ei 'sound\.bin$|\.SRC$|findings_'` prints nothing (the `research/` submodule gitlink + `.gitmodules` are expected/OK).

Note: the verbatim-snippet **scrub of `research/findings_*` is moot** — those files are now private (in the submodule), not published.  `docs/design/explainer_cards.md` keeps a handful of small annotated `FCB` lines as fair-use commentary (optionally trimmable).

## H. Verification
- Dev **with** local `/roms`: `npm run dev` boots straight in (dev fallback seeds IDB), onboarding never shows; exercise all 3 games + A/B + genealogy + WAV export + SCREAM/ORGAN.
- Dev **without** `/roms` (clear `public/roms/` + delete IDB `williams-sound`): onboarding appears; upload only Robotron → boots Robotron, Defender/Stargate locked; clicking a locked game opens its slot; A/B with a locked game shows the upload prompt (no crash); SCREAM/ORGAN work.
- Tiers: production ROM → ✓; byte-tweaked (in-range vectors, unknown SHA) → ⚠ stored; garbage/wrong-size → ✗. Replace/Remove work; reload persists (IDB).
- `npm test` (romValidate passes, romStore skipped), `npm run build` (`find explorer/dist -name '*_sound.bin'` empty), `npm run preview` (onboarding shows).

## Critical files
New: `explorer/src/audio/{romStore,romValidate,onboarding}.ts`, `explorer/tests/romValidate.test.ts`, root `LICENSE` + `README.md`.
Modified: `explorer/src/audio/host.ts` (323-330), `explorer/src/board/romFetch.ts` (20-26), `explorer/src/audio/main.ts` (autoInit 1180-1191, switchToGame 1117-1145, refreshGameSwitcherUi 134-146, click wiring 1156-1160, runVoiceSequence 1580-1583, export cache ~511), `explorer/src/viz/ABDiff.ts` (getRom/cache 76/92-103), `explorer/index.html` (onboarding before #pageLayout 637; game-switcher 644-648), `explorer/package.json` (prepare:public 11), root `.gitignore`.

---

# Plan — enforce the headless / browser split (2026-05-27)

## Context

A source-organization review found the clean separation between headless logic and browser code is **correct at runtime but only conventional** — nothing prevents a regression. Evidence:

- **`audio/` is a flat grab-bag.** One directory holds the headless engine (realtimeRunner, engineState, engineToggles, scrubTimeline, dacHistory, ramHistory, chipFilter) next to browser code (host, worklet, main, onboarding, romStore, romValidate, romFetch) and three "straddler" loaders (glossary, labelMap, zeroPageMap) that mix a pure parse/lookup API with a `fetch` + `import.meta.env.BASE_URL` loader in one file.
- **The central data type lives in a browser module.** `StateSnapshot`, `WorkletInMsg`/`WorkletOutMsg`, and the six engine-state interfaces (Lfsr/Vari/GWave/Scream/FNoise/Organ) are defined in `audio/worklet.ts` (the `AudioWorkletProcessor` module) and imported by ~13 viz panels + host + main. Worse, the six engine-state interfaces are **duplicated** — defined again in `audio/engineState.ts` (core) — so the producer and consumer copies can silently drift.
- **Nothing enforces DOM-freeness.** One `tsconfig.json` with `lib:["ES2022","DOM"]`; a stray top-level `document.`/`fetch`/`import.meta.env` in a logic module would compile fine and only break the Node test suite at runtime. No ESLint.

Two reach-throughs were already fixed this session (quick wins, committed separately): `scrubTimeline` now type-imports `SoundSegment` from `realtimeRunner.ts` (its pure origin) instead of `host.ts`; and `romFetch.ts` moved `board/ → audio/` (it's browser glue over `romStore`), keeping `board/` pure.

**Intended outcome:** each layer gets its own directory, the shared data contract lives in a pure module, and a **DOM-free typecheck pass fails the build** if any logic module touches a browser global or imports a browser module — so the boundary can't quietly rot.

Verified facts (file:line): no core module imports from `worklet.ts` or `viz/` today (boundary is achievable without breaking edges). `runner.ts` imports only `cpu/` + `board/` (portable). `StateSnapshot` = `worklet.ts:118`; messages `worklet.ts:38/178`; engine-state ifaces `worklet.ts:59-110` **and** `engineState.ts:25-99` (dup); `ScrubLoopMode`/`SoundSegment` = `realtimeRunner.ts:51/54` (already core). Importers of moved code include tests (`realtimeRunner/engineState/engineToggles/dacHistory/ramHistory/scrubTimeline/labelmap/zeroPageMap/glossary/codePanelInspect/romValidate .test.ts`) and tools (`tools/render_sound.ts` → `runnerNode.ts`; `tools/render_all.ts` → `runner.ts`). esbuild worklet entry = `src/audio/worklet.ts` in `build:worklet`/`watch:worklet` (`package.json`).

## Target layout

`cpu/`, `synth/` unchanged (already pure). `viz/` stays put (already a cohesive all-browser dir; not a grab-bag). The work is breaking up `audio/`:

```
src/
  cpu/  synth/            unchanged (pure)
  board/                  pia, soundboard (pure)         ← rom.ts moves to node/
  engine/   NEW           realtimeRunner, engineState, engineToggles,
                          scrubTimeline, dacHistory, ramHistory, chipFilter, runner.ts
  data/     NEW           protocol.ts (StateSnapshot, Worklet messages, the 6 engine-state
                          ifaces, ScrubLoopMode, SoundSegment) + pure parse/lookup halves of
                          glossary / labelMap / zeroPageMap
  web/      NEW           host, worklet, worklet-globals.d.ts, main, onboarding,
                          romStore, romValidate, romFetch + glossaryLoader/labelMapLoader/zeroPageLoader
  viz/                    unchanged location; imports types from data/ (web→core, allowed)
  node/     NEW           rom.ts (was board/), runnerNode.ts   (Node-only, node:fs)
```

**Enforcement root** (must compile with no DOM, no Node, no Vite types) = `cpu/ board/pia.ts board/soundboard.ts synth/ engine/ data/`.

## Enforcement mechanism (dependency-free)

New `explorer/tsconfig.core.json`:
```jsonc
{ "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ES2022"], "types": [] },
  "include": ["src/cpu", "src/board/pia.ts", "src/board/soundboard.ts",
              "src/synth", "src/engine", "src/data"] }
```
`typecheck` → `tsc -p tsconfig.json && tsc -p tsconfig.core.json`. The second pass fails on any `document`/`window`/`fetch`/`indexedDB`/`crypto.subtle`/`import.meta.env` in a core file (no DOM/Vite lib resolves them) and, by following imports, on any core→web import (the web file uses DOM types and won't compile DOM-free). No new dependency. (ESLint `no-restricted-imports` is a possible later complement, deferred — costs a dep.)

## Rollout — each phase ends green (`npm run typecheck` + 367 tests)

1. **Extract `data/protocol.ts`.** Move `StateSnapshot`, `WorkletInMsg`/`WorkletOutMsg`, the six engine-state interfaces, `ScrubLoopMode`, `SoundSegment` into it. **Reconcile the duplicate engine-state defs** (worklet.ts vs engineState.ts — verify field-for-field they match; if the worklet/consumer copy has extra fields, that's the canonical one). Repoint `engineState`, `realtimeRunner`, `worklet`, `host`, `viz/*`, `main` to import from `data/protocol.ts`. Generalizes the scrubTimeline fix. (Type-only churn, no behavior change.)
2. **Split the straddler loaders.** `data/{glossary,labelMap,zeroPageMap}.ts` = types + `parse()` + lookup/resolve/summarize (take parsed data); `web/{glossary,labelMap,zeroPage}Loader.ts` = `fetch(import.meta.env.BASE_URL…)` → `parse()`. Relocate the existing pure tests to import from `data/`.
3. **Create `engine/`** — move the 7 logic files + `runner.ts`; update their imports + importers + the engine tests.
4. **Create `web/`** — move host, worklet, worklet-globals.d.ts, main, onboarding, romStore, romValidate, romFetch + the 3 loaders; update imports. **Update esbuild entry** `src/audio/worklet.ts` → `src/web/worklet.ts` in `build:worklet`/`watch:worklet`.
5. **Create `node/`** — move `rom.ts` (from board/) + `runnerNode.ts`; update `runner.test`/`setup.test`-style importers, `tools/render_sound.ts`, `tools/render_all.ts`, and the `dev:roms` path if needed.
6. **Add `tsconfig.core.json` + wire `typecheck`.** Run it; fix anything it surfaces (this is the payoff — boundary now compiler-enforced). `audio/` directory is gone.
7. **Doc sweep.** `docs/implementation/explorer_implementation.md` (source-layout tree + module counts + the layer description), `docs/README.md` (state), `docs/implementation/explorer_architecture.md`; **`CLAUDE.md`** is in scope here (new top-level dirs = durable orientation, plus a new locked convention: "logic stays DOM-free, enforced by `tsconfig.core.json`").

## Critical files

New: `explorer/tsconfig.core.json`, `explorer/src/data/{protocol,glossary,labelMap,zeroPageMap}.ts`, `explorer/src/web/{glossaryLoader,labelMapLoader,zeroPageLoader}.ts`.
Moved: `audio/{realtimeRunner,engineState,engineToggles,scrubTimeline,dacHistory,ramHistory,chipFilter}.ts` + `runner.ts` → `engine/`; `audio/{host,worklet,worklet-globals.d.ts,main,onboarding,romStore,romValidate,romFetch}.ts` → `web/`; `board/rom.ts` + `runnerNode.ts` → `node/`; the parse/lookup halves of the 3 loaders → `data/`.
Modified import specifiers: `viz/*` (StateSnapshot/engine-states from `data/protocol`), `tools/render_{sound,all}.ts`, `package.json` (`typecheck`, `build:worklet`, `watch:worklet`), all test files that import moved modules (mechanical).

## Verification

- `cd explorer && npm run typecheck` → **both** projects clean (the core project is the new gate; deliberately add a temporary `document` ref to an `engine/` file once to confirm it FAILS, then revert).
- `cd explorer && npm test` → 367/367 (relocations are import-path-only; no behavior change).
- `cd explorer && npm run build` (Vite + esbuild worklet from the new path) succeeds; `npm run dev` boots and a sound still plays (worklet bundle resolves), confirming the moved worklet entry works end-to-end.
- Spot-check no remaining `from ".../audio/..."` specifiers after the directory is removed (`grep -rn "audio/" explorer/src explorer/tests tools --include=*.ts`).
