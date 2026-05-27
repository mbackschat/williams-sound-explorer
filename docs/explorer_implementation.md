# Explorer Implementation — Phases 1-6 (complete)

> What's actually built in `explorer/` as of 2026-05-26. Companion to `docs/explorer_architecture.md` (the design spine) — this one describes the **code that exists** rather than the future plan. Read this when starting a new session to get up to speed on the emulator.  Users should read `../MANUAL.md` first.

## Current state

**Phases 1-6 are COMPLETE — all 12 UX patterns shipped.**  Highlights: dual-trace oscilloscope, scrolling FFT spectrogram (with AC-coupling DC blocker upstream), DAC byte tape with PC capture, stage swimlane backed by an assembler-derived label map, **all six engine slots live** (LFSR / VARI / GWAVE / FNOISE / SCREAM / ORGAN) with per-engine viz panels, Pattern 3 freeze toggles, Pattern 4 SCREAM + ORGAN voice-mute + Build-up/Tear-down sequencer, Pattern 5 parameter-override sliders (VARI LOPER/HIPER), Pattern 6 A/B diff, Pattern 7 cross-game genealogy, Pattern 8 causal hover trace, **Pattern 9 annotated explainer cards** (`viz/ExplainerCard.ts` + 63 routine-keyed JSON cards covering every catalogued sound), **Pattern 10 listen-then-look quiz**, **Pattern 12 hide-help toggle**, **RAM heatmap viz** (16×8 zero-page grid, 1 s decay, engine-aware cell-name tooltip), **scrub-mode RAM time-travel** (`audio/ramHistory.ts` snapshots every ~512 cycles), responsive two-column layout with draggable splitter + sticky controls + per-game chip browser + segmented game switcher.

Two ways to hear a sound today:

```bash
# Offline (Node + WAV)
npx tsx tools/render_sound.ts defender 0x11 out/defender_11_lite.wav
open out/defender_11_lite.wav

# Real-time (browser + AudioWorklet)
cd explorer && npm run dev
# → open http://localhost:5173, pick a game, click a chip in Playback
```

| Metric | Value |
|---|---|
| TypeScript modules | ~50 (CPU 6, board 4, synth 3, audio 17, viz 17, + runner/runnerNode — incl. ramHistory, scrubTimeline, zeroPageMap, chipFilter, romStore, romValidate, onboarding, FNOISEView, resizeObserver, runnerNode, romFetch, ABDiff, Genealogy, SCREAMView, ORGANView, RAMHeatmap, ExplainerCard, QuizPanel, SCREAM + ORGAN voice-mute toggles, paramOverride wiring) |
| Implemented 6800 opcodes | ~160 (every addressing mode of every common op) |
| Test files | 24 |
| Tests passing | **367 / 367** |
| Strict-mode TypeScript errors | 0 |
| Round-trip time (LITE end-to-end, offline) | ~30 ms |
| WAV size (Defender LITE) | 67 KB, 0.70 s |
| Bundled worklet size | ~41 kB (esbuild, ES module) |
| Browser bundle (Vite production) | ~4 kB main + 41 kB worklet |

## Source layout

```
explorer/
├── package.json                    # Vite + esbuild + Vitest dev deps
├── tsconfig.json                   # strict; ES2022; allowImportingTsExtensions
├── vite.config.ts                  # dev server + production build
├── vitest.config.ts
├── index.html                      # Phase 2.1 browser harness
├── src/
│   ├── cpu/
│   │   ├── types.ts                # Bus, CPUState, readWord/writeWord
│   │   ├── flags.ts                # CCR bit constants + ccrSet/setNZ8/setNZ16
│   │   ├── alu.ts                  # 15 pure ALU primitives
│   │   ├── instructions.ts         # opcode dispatch table (~160 opcodes)
│   │   ├── disasm.ts               # Step 2.2+ disassembler (mnemonics + format)
│   │   └── m6800.ts                # CPU class: createCPU, reset, step, takeInterrupt
│   ├── board/
│   │   ├── pia.ts                  # MC6821 stub: DAC events, CA1-IRQ flag, setCommand
│   │   ├── soundboard.ts           # memory map per game + paramOverrides (Step 6.2)
│   │   ├── rom.ts                  # Node ROM loader (reads tools/*_sound.bin)
│   │   └── romFetch.ts             # Browser ROM loader (fetch /roms/*.bin) — Step 5.3
│   ├── synth/
│   │   ├── DacSampler.ts           # zero-order-hold 894886 Hz → target Hz
│   │   ├── lpf.ts                  # single-pole biquad (~10 kHz)
│   │   └── wav.ts                  # 16-bit PCM WAV encoder
│   ├── audio/                      # NEW in Phase 2.1
│   │   ├── realtimeRunner.ts       # Node-testable CPU+DAC realtime driver
│   │   ├── worklet.ts              # AudioWorkletProcessor wrapper
│   │   ├── worklet-globals.d.ts    # AudioWorkletProcessor / sampleRate decls
│   │   ├── host.ts                 # Main-thread WilliamsSoundHost
│   │   ├── glossary.ts             # Step 2.2+ glossary loader/lookup
│   │   ├── dacHistory.ts           # Step 2.3 DAC event ring buffer
│   │   ├── ramHistory.ts           # NEW: periodic CPU+RAM snapshots for scrub time-travel
│   │   ├── scrubTimeline.ts        # pure scrubber math: clip segments to the live ring range + compact-axis mapping
│   │   ├── labelMap.ts             # Step 3.4 label-map loader + PC resolver
│   │   ├── engineState.ts          # per-engine state populator — all six engines wired
│   │   ├── engineToggles.ts        # Step 4.4 Pattern 3 RAM-write gates
│   │   ├── zeroPageMap.ts          # RAM-heatmap cell descriptors loader + engine-aware resolver
│   │   ├── chipFilter.ts           # Try-list engine filter (legend swatches double as toggles)
│   │   ├── romStore.ts             # user-uploaded ROMs in IndexedDB + loadRomBytes (single ROM source)
│   │   ├── romValidate.ts          # tiered upload validation (size + 6802 vectors + SHA-1 allowlist)
│   │   ├── onboarding.ts           # first-run upload overlay (3 slots, drag-drop, tier feedback)
│   │   └── main.ts                 # HTML harness wiring
│   ├── viz/                        # Step 3.1+ visualisation panels
│   │   ├── types.ts                # VizPanel interface (update(snapshot))
│   │   ├── resizeObserver.ts       # NEW: shared ResizeObserver helper for canvases
│   │   ├── EarPanel.ts             # Dual-trace oscilloscope (raw DAC + LPF) — Step 3.2
│   │   ├── EyePanel.ts             # DAC byte tape (Step 3.3) — w/ Step 3.4 label tooltip
│   │   ├── CodePanel.ts            # Disassembly + register dump + engine-state readout
│   │   ├── Spectrogram.ts          # Step 3.2 — scrolling FFT via AnalyserNode
│   │   ├── StageSwimlane.ts        # Step 3.4 — which routine is running
│   │   ├── VARIView.ts             # Step 4.2 — VARI countdown bars + duty preview
│   │   ├── WavetableView.ts        # Step 4.3 — live GWAVE wavetable + cursor
│   │   ├── SCREAMView.ts           # Step 5.1 — 4 phase wheels + FREQ/TIMER bars
│   │   ├── ORGANView.ts            # Step 5.2 — OSCIL LEDs + RDELAY heatmap
│   │   ├── FNOISEView.ts           # Phase 6 — FNOISE frequency ramp + slope LED
│   │   ├── RAMHeatmap.ts           # Step 6.6 — 16×8 zero-page grid, cold→hot over 1 s decay; tooltip names each cell (engine-aware)
│   │   ├── ABDiff.ts               # Step 5.3 — two-tape diff with red divergence band
│   │   └── Genealogy.ts            # Step 5.4 — family chips that auto-fill A/B diff
│   ├── runner.ts                   # browser-safe: tick(), bootToIdle(), runSoundWithRom()
│   └── runnerNode.ts               # Node-only: runSound() wraps loadROM (split for Vite)
├── public/                         # NEW — served as static assets by Vite
│   ├── williams-sound-explorer-worklet.js   # generated by `build:worklet` (esbuild)
│   ├── roms/*.bin                  # gitignored DEV-ONLY fallback; opt-in `npm run dev:roms` (NOT prepare:public) — dist/ ships zero ROM bytes
│   ├── data/glossary.json          # generated by tools/build_glossary.py
│   ├── data/{defender,stargate,robotron}_labelmap.json  # generated by tools/build_labelmap.py
│   └── data/{defender,stargate,robotron}_zeropage.json  # generated by tools/build_zeropage.py
└── tests/
    ├── flags.test.ts               # CCR helpers
    ├── alu.test.ts                 # 15 ALU primitives, flag edge cases
    ├── opcodes.test.ts             # dispatch + addressing modes + branches
    ├── irq.test.ts                 # PIA→CPU IRQ delivery (happy/edge/mask/refire)
    ├── setup.test.ts               # boot all 3 ROMs through SETUP
    ├── runner.test.ts              # runSound() against Defender LITE + Stargate
    ├── synth.test.ts               # DacSampler + LPF
    ├── wav.test.ts                 # WAV header + payload encoding
    ├── golden.test.ts              # regression fixture for LITE
    ├── realtimeRunner.test.ts      # realtime CPU+DAC driver + step primitives
    ├── disasm.test.ts              # 6800 disassembler (Step 2.2+)
    ├── dacHistory.test.ts          # DAC ring buffer
    ├── labelmap.test.ts            # label-map JSON + resolver (Step 3.4)
    ├── engineState.test.ts         # per-engine state populator (Steps 4.1, 4.2, 4.3)
    ├── engineToggles.test.ts       # Pattern 3 freezes + Pattern 4 SCREAM voice mute (Steps 4.4, 6.1)
    ├── codePanelInspect.test.ts    # Pattern 8 inspect-cursor render (Step 4.5)
    ├── ramHistory.test.ts          # Periodic RAM-snapshot ring + scrub time-travel
    ├── scrubTimeline.test.ts       # Segment-clip + compact-axis math; wrapped-ring regression
    ├── paramOverride.test.ts       # Pattern 5 paramOverride bus + runner integration (Step 6.2)
    ├── ramHeatmap.test.ts          # SoundBoard.lastWriteCycle stamps + snapshot payload (Step 6.6)
    └── golden/
        ├── defender_11_lite.json   # 386 DAC events, locked baseline
        ├── defender_1D_saw.json    # SAW regression fixture (Step 4.2)
        ├── defender_01_hbdv.json   # HBDV / GWAVE regression fixture (Step 4.3)
        ├── defender_17_cannon.json # CANNON / FNOISE regression fixture (Phase 6)
        └── robotron_1A_scream.json # SCREAM regression fixture (Step 5.1, first 1 s)
```

External:
```
tools/
└── render_sound.ts                 # CLI: ROM + command → WAV
```

## Module dependency graph

```
                    ┌──────────────┐
                    │  flags.ts    │
                    │  (CCR bits)  │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       ┌─────────┐    ┌─────────┐   ┌──────────────┐
       │ alu.ts  │    │ types.ts│   │ instructions │
       │ (15 op) │    │ (Bus)   │   │ (~160 ops)   │
       └────┬────┘    └────┬────┘   └──────┬───────┘
            │              │               │
            └──────────────┴──┬────────────┘
                              ▼
                      ┌──────────────┐
                      │   m6800.ts   │
                      │ (CPU + step) │
                      └──────┬───────┘
                             │
        ┌────────────────────┼───────────────────┐
        ▼                    ▼                   ▼
   ┌──────────┐         ┌──────────┐       ┌──────────┐
   │ pia.ts   │         │soundboard│◄──────┤ runner.ts│
   │(MC6821)  │◄────────┤  (Bus)   │       │          │
   └──────────┘         └────┬─────┘       └────┬─────┘
                             │                  │
                        ┌────▼─────┐            │
                        │ rom.ts   │            │
                        │(Node FS) │            │
                        └──────────┘            │
                                                ▼
                                  ┌───────────────────────┐
                                  │ DacSampler / lpf / wav│
                                  └───────────────────────┘
```

Reading order for a new session: `flags` → `types` → `alu` → `instructions` → `m6800` → `pia` → `soundboard` → `runner` → `synth/*`.

## CPU emulator — design decisions

### Why a separate `alu.ts`

Every ALU operation (`aluAdd`, `aluSub`, `aluAnd`, `aluLsr`, …) is a **pure function** `(operand, ccr) → {result, ccr}` or `(a, m, c0, ccr) → {result, ccr}`. This separation pays off in three ways:

1. **Testability**: 31 of the 113 tests live in `alu.test.ts` and exercise the ALU directly. They don't need a CPU, a bus, or ROMs.
2. **Reuse across addressing modes**: `aluAdd` is used by 12 opcode handlers (ADDA/ADDB × imm/dir/ext/ind + ADCA/ADCB × imm/dir/ext/ind). Each handler is 3–5 lines.
3. **No surprise side effects**: ALU helpers can't accidentally touch CPU state.

### Why a flat opcode array (not a switch statement)

`OPCODES: (OpHandler | undefined)[]` of length 256. Lookup is `OPCODES[opcode]`. Compared to a switch:

- Faster in V8 (array indexing avoids the dispatch ladder).
- Easier to detect gaps: any unimplemented opcode is `undefined` and `step()` throws with a precise error.
- Easier to count: `OPCODES.filter(Boolean).length` tells you coverage.

### Cycle accounting

Each opcode handler returns its own cycle count to `step()`, which accumulates them onto `cpu.cycles`. Cycle counts come from the Motorola 6800 datasheet. Interrupts add 12 cycles (`takeInterrupt()`).

### IRQ delivery — the `tick()` pattern

The bare `step(cpu, bus)` is **peripheral-agnostic**: it has no knowledge of the PIA. To wire interrupts in, `SoundBoard.syncInterrupts(cpu)` propagates `pia.isIRQPending()` onto `cpu.irqPending` *before* each step. The `tick(cpu, board)` helper in `runner.ts` packages sync+step.

Rationale: keeping `step()` pure (just CPU + Bus) means we could later run the emulator against a completely different peripheral set without touching the CPU code. The peripheral coupling lives in `tick()` and `runner.ts`.

### Interrupt stack frame (verified by tests)

Per the Motorola 6800 datasheet, IRQ pushes (in this order, with SP descending):

```
push PCl, PCh, Xl, Xh, A, B, CCR
set I = 1
PC ← [vector]
```

So the resulting memory layout (from low to high address) is:

| Address | Byte |
|---|---|
| `SP+1` after push | CCR (with old I=0) |
| `SP+2` | B |
| `SP+3` | A |
| `SP+4` | Xh |
| `SP+5` | Xl |
| `SP+6` | PCh |
| `SP+7` | PCl |

`RTI` pops in reverse. Both paths are covered by `tests/irq.test.ts` and `tests/opcodes.test.ts`.

### Things deliberately *not* modelled

- **No NMI**, **no SWI handling beyond the vector push** (the 6800 NMI is reserved on Williams hardware for an on-board diagnostic switch we don't expose).
- **No HCF / undocumented opcodes** — they'd throw if encountered.
- **No sub-cycle bus timing** — cycle accuracy is per-instruction, not per-T-state. The sound ROMs don't depend on this.
- **No DAA** (decimal adjust) — Williams sound code doesn't use it.

## PIA (MC6821) model

`explorer/src/board/pia.ts` models *only* what the Williams sound code touches:

| Register | Address | Purpose |
|---|---|---|
| Port A data/DDR | `$0400` | DAC output when DDR_A is set; mode selected by CRA bit 2 |
| CRA | `$0401` | Port A control (bit 2 toggles DDR vs data) |
| Port B data/DDR | `$0402` | Command latch from "main CPU"; CRB bit 2 selects |
| CRB | `$0403` | Port B control |

**Side effects modelled:**
- Every write to Port A data is appended to `dacEvents[]` as `{cycle, value}`.
- `setCommand(byte)` (host-side API) latches `~byte & 0xFF` into Port B and raises an internal `ca1IRQPending` flag. The board's `syncInterrupts()` propagates that to the CPU.
- Reading Port B data **clears** the CA1 flag — modelling the real PIA's "read clears IRQ" behaviour. The Williams IRQ handler reads Port B to fetch the command, which naturally drops the IRQ line.

**Not modelled** (yet): CA2 strobe outputs, CB1/CB2 interrupt sources, the `IRQA`/`IRQB` flags exposed in the control registers' upper bits. None of these are read or set by Defender/Stargate/Robotron sound ROMs.

## Memory map (per-game)

| Range | Defender / Stargate | Robotron |
|---|---|---|
| `$0000–$007F` | internal RAM 128 B | internal RAM 128 B |
| `$0080–$00FF` | (unmapped, reads 0) | **external RAM 128 B (MC6810)** |
| `$0400–$0403` | PIA | PIA |
| `$8400–$8403` | PIA mirror (bit 15 ignored) | same |
| `$F000–$FFFF` | (ROM at $F800) | **program ROM 4 KB** |
| `$F800–$FFFF` | program ROM 2 KB | (within the 4 KB) |

Vectors live in the top 8 bytes of ROM: `$FFF8/9` IRQ, `$FFFA/B` SWI, `$FFFC/D` NMI, `$FFFE/F` RESET.

## Synth pipeline

```
runSound() → DACEvent[]  ─┐
                          ▼
            renderDacEvents()  ──► Float32Array (48 kHz)
                          │
                          ▼
                     applyLpf()  ──► smoothed Float32Array
                          │
                          ▼
                     encodeWav()  ──► 16-bit PCM RIFF/WAVE bytes
```

### Zero-order-hold resampler (`DacSampler.ts`)

CPU bus clock: **894 886 Hz**. WAV output: 48 000 Hz (configurable). Ratio: 1 output sample ≈ 18.6 input cycles.

The algorithm: walk through the sorted DAC event list; at each event, emit `Math.round(eventCycle × ratio) − samplesEmittedSoFar` samples of the *previous* DAC value, then adopt the new value. A trailing pass emits samples for the tail-cycles after the last event.

DAC byte → float mapping: `(value - 128) / 128`. So:
- `$00` → `-1.0`
- `$80` → `0.0`
- `$FF` → `+127/128 ≈ +0.992`

Asymmetric by 1 LSB, matching standard unsigned-8-bit PCM convention.

### Low-pass filter (`lpf.ts`)

Single-pole IIR (`y = α·x + (1−α)·y₋₁`), defaulting to 10 kHz cutoff at 48 kHz sample rate. Models the Williams sound board's 1458 op-amp I-to-V converter with feedback capacitor, per `docs/sound_hardware_model.md` "DAC and the analog tail". Soft 6 dB/octave roll-off — DAC stair-step aliasing still bleeds through, which is part of the iconic grit.

### WAV encoder (`wav.ts`)

44-byte RIFF/WAVE header + 16-bit signed little-endian PCM payload. Mono. No fancy chunks. Clamps out-of-range floats to `±1.0` before scaling to `int16`.

## Runner API (`runner.ts`)

| Function | Purpose |
|---|---|
| `tick(cpu, board)` | sync IRQ + step one instruction |
| `bootToIdle(board, opts?)` | reset and step until the CPU enters `BRA *` |
| `runSound(game, cmd, opts?)` | full pipeline: load ROM → boot → fire cmd → run to idle → return `DACEvent[]` |

`runSound` defaults:
- `maxCycles` = 5 seconds at 894 886 Hz = 4 474 430 cycles
- `idleStreakRequired` = 6 (same PC for 6 consecutive ticks AND no PIA IRQ pending → considered idle)

Return shape:
```typescript
interface RunSoundResult {
  events: DACEvent[];      // ordered (cycle, value) writes
  cycles: number;          // total CPU cycles from command fire to idle
  reachedIdle: boolean;    // false if maxCycles exhausted
  board: SoundBoard;       // for further inspection / replay
  cpu: CPUState;
}
```

## The render-sound CLI (`tools/render_sound.ts`)

```bash
npx tsx tools/render_sound.ts <game> <hex-cmd> <out.wav>

# examples:
npx tsx tools/render_sound.ts defender 0x11 out/defender_11_lite.wav
npx tsx tools/render_sound.ts stargate 0x11 out/stargate_11_lite.wav
```

Output:
```
[defender] running command 0x11…
  events: 386
  cycles: 624204 (≈698 ms)
  reachedIdle: true
✔ wrote out/defender_11_lite.wav — 65.4 KiB, 0.70 s
```

Notes:
- The script wraps everything in an `async main()` because `tsx` defaults to CJS at the project root and CJS doesn't support top-level await.
- `out/` is gitignored at the project root.
- The same CPU+PIA core also powers the AudioWorklet — this CLI is the Node sibling of `src/audio/realtimeRunner.ts`.

## Real-time pipeline (Phase 2.1)

The browser path replaces the offline `runSound() → renderDacEvents() → applyLpf() → encodeWav()` chain with an AudioWorklet that drives the CPU in lockstep with the audio sample clock.

### Module graph

```
       index.html
           │
           ▼
   src/audio/main.ts ──── DOM event wiring (Init / Fire / Speed / Mute)
           │
           ▼
   src/audio/host.ts ──── WilliamsSoundHost: AudioContext + AudioWorkletNode,
           │              fetches ROMs, postMessage({type:"load"|"fire"|…})
           │
       (postMessage)
           │
           ▼
   src/audio/worklet.ts ──── WilliamsSoundProcessor (audio thread)
           │
           ▼
   src/audio/realtimeRunner.ts ──── RealtimeRunner: Node-testable core
           │
           ▼
   src/cpu/* + src/board/*  ──── unchanged from Phase 1
```

`worklet.ts` is bundled by `npm run build:worklet` (esbuild) into `public/williams-sound-explorer-worklet.js` — a single ES module that the browser loads via `audioContext.audioWorklet.addModule("/williams-sound-explorer-worklet.js")`. Vite serves it from `public/` in dev mode and copies it to `dist/` for production.

### Message protocol

| Direction | Message | Effect |
|---|---|---|
| main → worklet | `{type:"load", game, rom: ArrayBuffer}` | Construct `RealtimeRunner`, boot to idle, reply with `{type:"ready"}` |
| main → worklet | `{type:"fire", cmd: number}` | Inject a 6-bit Williams command (raises CA1 → IRQ) |
| main → worklet | `{type:"speed", value: number}` | Set playback speed (>0) |
| main → worklet | `{type:"stop"}` | Mute — `process()` returns silence until next `load` |
| main → worklet | `{type:"pause"}` | Freeze CPU; output holds the LPF level |
| main → worklet | `{type:"resume"}` | Unfreeze CPU.  Host method is `unpause()` to avoid colliding with `AudioContext.resume()`. |
| main → worklet | `{type:"step"}` | Advance CPU by one instruction (only valid while paused) |
| main → worklet | `{type:"step-dac"}` | Advance until the next DAC write (Step 2.2+) |
| main → worklet | `{type:"step-irq"}` | Advance until the next IRQ handler entry (Step 2.2+) |
| main → worklet | `{type:"scrub-start", cycle, speed}` | Enter scrub mode (pauses CPU) at `cycle` with `speed` (signed) |
| main → worklet | `{type:"scrub-pos", cycle}` | Move the scrub head |
| main → worklet | `{type:"scrub-speed", value}` | Set scrub speed (negative = reverse) |
| main → worklet | `{type:"scrub-end", resume?}` | Exit scrub.  `resume:true` un-pauses CPU |
| main → worklet | `{type:"scrub-loop", mode}` | Set scrub loop policy: none / range / segment |
| main → worklet | `{type:"reset-recording"}` | Wipe the DAC history ring + segments + un-pause CPU |
| main → worklet | `{type:"snapshot"}` | Ask for a fresh state snapshot (no CPU advance) |
| worklet → main | `{type:"ready"}` | Sent after successful `load` |
| worklet → main | `{type:"error", message}` | Sent if any handler threw |
| worklet → main | `{type:"state", snapshot}` | Sent after every pause/resume/step* + on explicit `snapshot` requests |

The `rom` ArrayBuffer is transferred (zero-copy) by including it in the `postMessage` transfer list.

### RealtimeRunner (`src/audio/realtimeRunner.ts`)

The Node-testable core of the worklet. Owns the CPU + board + PIA + LPF state. Key methods:

- `bootToIdle()` — resets CPU and runs SETUP until the `BRA *` self-loop. Anchors `cycleAccumulator` to `cpu.cycles` so the audio wall clock starts at zero offset.
- `fire(cmd)` — forwards to `pia.setCommand(cmd & 0x3F)`. Thread-safe in the worklet (single-threaded JS).
- `setSpeed(s)` — multiplier > 0. Direct CPU-clock scaling: 0.5× means CPU advances at half rate per audio sample → audible pitch drops one octave (matches Step 2.2 intent).
- `pause()` / `resume()` / `isPaused()` (Step 2.2) — freeze and unfreeze the CPU. While paused, `fillBlock` emits the held LPF value for every sample — silence in the speaker, no click on resume. CPU + accumulator do not advance, so playback continues seamlessly when unpaused.
- `step()` (Step 2.2) — advance the CPU by exactly one instruction. Throws if not paused. Returns the cycle cost (2..12 on the 6800).
- `stepToNextDacWrite(maxCycles?)` (Step 2.2+) — advance until the next write to Port A. "The next moment of sound." Returns `{reached, cycles}`. The default 50 000-cycle budget is enough for typical inner loops; the UI can sense `reached: false` to indicate "no DAC writes within budget — fire something first."
- `stepToNextIrq(maxCycles?)` (Step 2.2+) — advance until PC re-enters the IRQ handler entry (read from `$FFF8`). One sound-engine "tick." Steps one instruction unconditionally first so we don't trip on the entry we're already at.
- `runUntil(predicate, maxCycles?)` (Step 2.2+) — the primitive both higher-level steppers share. Cycle-budgeted; re-anchors the audio wall clock after completion so resuming continues smoothly.
- `snapshot()` (Step 2.2+) — plain JSON CPU + DAC + disassembly state for the UI. Pure read: never touches the PIA (so the read-clears semantics of Port B are not triggered).
- `fillBlock(out: Float32Array)` — the hot path. Per output sample: bump `cycleAccumulator += cpuRate/sampleRate × speed`, step CPU until `cpu.cycles >= acc`, drain new DAC events, apply inline 1-pole LPF, write the sample. After the block, `splice` consumed events off `pia.dacEvents` to keep memory bounded. When paused, returns immediately after filling with the held value.

### Debugger primitives (Step 2.2 extras)

Single-stepping was made useful by adding three things on top of the basic `step()` from 2.2:

1. **Disassembler** (`src/cpu/disasm.ts`) — `disassemble(bus, pc)` returns `{address, bytes, mnemonic, operand, length, nextPc, target?}`. Knows every opcode implemented in `instructions.ts` (~160 of 256); unknown opcodes return `mnemonic: "???"` with length 1 so the caller can still advance. A parallel `MNEMONICS[]` table holds `{mnemonic, mode}` per opcode; modes are `inh / imm8 / imm16 / dir / ext / idx / rel`. The branch-mode resolver computes the absolute target address. `formatDisassembly(d)` produces the one-line `F800  8E 00 7F  LDS  #$007F` form. 15 tests in `tests/disasm.test.ts` cover every mode + the unknown path + the formatter.
2. **Semantic step modes** on `RealtimeRunner` (above) — `step / stepToNextDacWrite / stepToNextIrq`, all gated to paused mode.
3. **Live state readout in the UI** — after every step the worklet posts a `{type: "state", snapshot}` message containing `pc / a / b / x / sp / ccr / cycles / lastDac / disassembly`. The host fires a `StateListener` callback the harness uses to refresh the CPU-state panel. Three lines:

   ```
   F812  86 80     LDAA #$80
   A=80  B=00  X=007F  SP=0078  PC=F812  CCR=D0 [hInzvc]
   cycles=1,234,567    DAC=$7F (-0.008)    paused
   ```

This makes `Step ▸ / ▸ DAC / ▸ IRQ` genuinely useful: each click shows the next instruction the CPU will run, plus the registers and last DAC value. Without disassembly, single-stepping is mechanical advance with no insight; with it, you can watch the LFSR shift register turn over byte by byte and see exactly which `EORA` / `ROR` produced the next speaker swing.

### Glossary (Step 2.2 extras)

`tools/build_glossary.py` produces `explorer/public/data/glossary.json` with two layers:

1. **Per-game sound commands** parsed from the catalogue docs — each entry is `{name, routine, engine, blurb?}`. 128 entries total (Defender 32 + Stargate 32 + Robotron 64). Stargate inherits Defender's data with `$1B` (ORGANT) and `$1C` (ORGANN) overridden per `docs/stargate_sound_catalogue.md`.
2. **Engine / technique terms** — a hand-curated `TERMS` dict in the generator (sourced from `docs/synthesis_techniques.md` + `docs/sound_hardware_model.md`). Each entry is `{title, what, how, where}`. 41 entries: the six engines + LITEN, RADIO, HYPER, BG, plus hardware (DAC, PIA, IRQ, CA1, 6802, mid-rail, AC-coupling), technique (PWM, ZOH, LPF, phase accumulator, duty cycle, popcount, envelope), engine-state (WVDECA, OSCIL, GPER + the GWAVE fields GECHO / GECNT / GECDEC / GWFRM / GWFRQ / FOFSET / GDFINC / PRDECA, LOPER, HIPER), control-flow (BRA-self, SETUP, RTI), and analysis (FFT). Several (the six engine names, duty cycle, OSCIL, FFT, LOPER, HIPER, and the full GWAVE field set — GPER / GECHO / GECNT / GWFRM / GWFRQ / FOFSET / GDFINC / PRDECA / GECDEC in the GWAVE pane's readout rows) are wired as clickable `term-link`s in the engine-pane titles / param labels and the spectrogram. **Every `[data-term]` element also gets a one-line hover `title`** (the term's "what") via `annotateTermLinks()` in `main.ts`, run after the glossary loads + after each cmdInfo re-render.

The browser harness (`src/audio/glossary.ts` + `main.ts`):
- Fetches the JSON on load.
- **Command info panel** updates live as the user types a hex code: routine + engine + name + 1-line blurb. The engine name (e.g. "LFSR") is rendered as a `term-link` if a `TERMS` entry exists for it — click to reveal the explanation.
- **Quick-shortcut chips** (`11`, `15`, `1D`, …) with hover tooltips drawn from the same glossary.
- **Term list panel** at the bottom shows every term as a clickable button; clicking reveals a `WHAT / HOW / WHERE` popover.
- Re-renders on game-select change (Robotron has 32 additional codes beyond Defender / Stargate).

The glossary is regenerated by `prepare:public` so editing a catalogue doc or the `TERMS` dict is enough to refresh the in-browser data on the next `npm run dev`.

### Oscilloscope + Spectrogram (Step 3.2)

**EarPanel — dual trace.** Renders two lines on the same canvas: the raw pre-LPF DAC stair-step (dim cyan, drawn first) and the post-LPF signal (bright green, drawn on top). The user can literally see the LPF doing its job — sharp transitions in the raw line bend toward the smoothed green line.

The raw samples ride along in `snapshot.lastRawSamples`, a Float32Array sample-for-sample aligned with `lastSamples`. `RealtimeRunner` captures them in a parallel `rawRing` populated by every fill path; a single shared `writeRings(out, raw)` keeps the two buffers in lockstep.

**Spectrogram panel.** New `viz/Spectrogram.ts` is independent of the snapshot poll — it reads from a host-side `AnalyserNode` at requestAnimationFrame rate (vsync ~60 Hz) and paints a vertical column at the right edge each frame, with the rest of the canvas scrolled one pixel left via `drawImage(canvas, -1, 0)`.

- `AnalyserNode` parameters: `fftSize: 512` (= 256 frequency bins), `smoothingTimeConstant: 0.6`, `minDecibels: -90`, `maxDecibels: -10`. Taps the *post-DC-blocker* signal so it tracks what's actually audible (see below).
- Log-frequency y-axis: row→bin mapping is precomputed once via `Math.pow(maxBin/1, 1 - row/(H-1))`. Top of canvas = high frequency; bottom = low. Each octave gets equal vertical real estate.
- Magma-ish colour ramp built once at module load: dark blue → cyan → yellow → red. `getByteFrequencyData` returns 0..255 magnitudes that index into the palette.
- The spectrogram lives in a full-width panel at the top of the right column, below the Engine view (the live grid + swimlane are in the left column).

LITE's LFSR-noise sweep is clearly visible: a broadband region steadily climbing the y-axis over ~3 s as the LFSR period changes.

**DC-blocker (BiquadFilterNode, 5 Hz highpass).** Inserted between `gainNode` and the destination + analyser. Williams sounds often end on `DAC = $00` (full negative); without DC blocking the worklet held that constant DC forever after the sound ended, the analyser saw it as a low-frequency band, and the spectrogram scroll-painted endless horizontal lines. Real Williams hardware avoids this via its AC-coupling capacitor; we mirror that with a 5 Hz highpass — well below the audible band, no perceptible effect on the sounds themselves, but kills the persistent DC + sub-audible content.

Audio graph after this step:

```
AudioWorkletNode → GainNode → BiquadFilterNode (5 Hz HP) ─┬─► destination
                                                          └─► AnalyserNode
```

### Post-3.3 polish

A handful of UX + dev-workflow fixes after 3.3 landed:

**DAC byte tape — centred window in scrub mode.** Earlier the snapshot always sent `[head − 250 ms, head]` (backward-looking, matches the live "tape head at right edge" metaphor). Clicking a marker for an earlier segment moves the head to that segment's *start*, where the backward 250 ms is just silence — so the tape blanked out. Fix: snapshot now carries explicit `windowStart` / `windowEnd` bounds.
- Live: `[cpu.cycles − 250 ms, cpu.cycles]` (backward-looking, head at right edge).
- Scrub: `[scrubCycle − 125 ms, scrubCycle + 125 ms]` (centred, head as a thin tick in the middle).

The EyePanel reads these bounds from the snapshot and positions the tape-head indicator accordingly.

**EyePanel stale-worklet fallback.** If the worklet bundle wasn't rebuilt after a code change, the snapshot would arrive *without* `windowStart` / `windowEnd`. `undefined - undefined = NaN`, and every cell renders at NaN — the tape goes blank. EyePanel now detects missing bounds and synthesises sensible ones from the snapshot's head cycle (`scrubCycle` or `cpu.cycles`). The tape stays usable even with a stale worklet — but the *real* fix is auto-rebuild (below).

**Worklet auto-rebuild on save.** Pre-fix, `npm run dev` built the worklet bundle once at startup; subsequent edits to `worklet.ts` / `realtimeRunner.ts` / `dacHistory.ts` / etc. didn't reflect until you killed `npm run dev` and started it again. New scripts:
- `watch:worklet`: `esbuild --watch=forever` (the `=forever` is critical — plain `--watch` stops when stdin closes, which happens whenever the watcher is backgrounded).
- `dev`: now runs `prepare:public` + `build:worklet` once, then `concurrently --kill-others` spawns `watch:worklet` and `vite` together. Ctrl+C kills both cleanly via `concurrently`'s signal propagation.

So the dev loop is now: edit any worklet-side file → esbuild rebuilds the bundle in ~10 ms → reload the browser tab → fresh worklet.

**Fire button restyle.** The Fire button is the single most important action and was previously identical to all the other neutral-grey buttons. Now solid yellow (`#ffd866`), uppercase, bold, slightly larger padding, glow on hover. `Fire ⏸` sibling stays paired (outlined yellow on dark) but quieter so the eye lands on Fire first. Disabled state uses muted yellow-brown so it's still findable but obviously inactive.

### DAC byte tape (Step 3.3 / Pattern 2)

EyePanel rewritten as a scrolling tape of DAC writes. Each `STAA $0400` becomes one coloured cell whose width is proportional to the *dwell time* (cycles until the next write). Cells scroll right-to-left as new events arrive; the tape head is a thin yellow bar at the right edge.

**Colour ramp** is symmetric around the mid-rail:
- $00 (full negative) → cool blue
- $80 (mid-rail) → soft green
- $FF (full positive) → red

So a sound's character is visible at a glance — LITE's LFSR shows up as a stippled blue/red alternation; HBDV's heartbeat as broad bands; ORGAN as a smoother gradient over time.

**Hover any cell** → fixed-position tooltip with `$XX (normalised float) · cycle N · from PC $YYYY`. The PC is the value of `cpu.pc` at the moment the write happened — useful for "which routine produced this byte?" inspection. **As of Step 3.4** the tooltip additionally resolves PC → label + source-line via the loaded label map, appending e.g. `in LITEN+7 / VSNDRM1.SRC:436`.

**PC capture wiring**:
- `DACEvent` interface gained `pc?: number` (optional for backwards-compatible test fixtures).
- `PIA.write(offset, value, cycle, pc?)` records pc on Port-A writes.
- `SoundBoard.write` passes `cpu?.pc ?? 0`.
- `DacHistory.push(cycle, value, pc?)` stores it in a parallel `Uint16Array`.
- New `DacHistory.recent(n)` returns the last N events as three parallel typed arrays (`cycles: Float64Array`, `values: Uint8Array`, `pcs: Uint16Array`) for the tape panel to consume in one go.
- `snapshot.recentDacEvents` carries those arrays in every state message.
- Golden fixture re-seeded with the new pc field for the regression gate.

### Phase 5 — Robotron + A/B diff + Genealogy

Five things landed together as a single Phase 5 commit:

**SCREAM (Step 5.1).**  `$1A` exercises a 4-voice detuned-oscillator engine; each voice keeps a `{freq, timer}` pair at `STABLE+2v`.  `viz/SCREAMView.ts` draws per-voice paired bars (FREQ on top half, TIMER bottom) and a tiny phase-wheel showing where in its cycle each voice sits — the canonical "voices drift apart" effect is on screen.  Fourth golden fixture (`robotron_1A_scream.json`) captures the first 1 s of output; SCREAM doesn't terminate at the BRA-self idle on its own.  **SCREAM is in all three games** (born on Defender — see the per-game spec note below), so the pane animates on Defender/Stargate too: range `[F87A, F8CB)` STABLE=$12 on Robotron, `[F9F3, FA44)` STABLE=$13 on Defender/Stargate (a 2026-05 wiring pass).

**ORGAN (Step 5.2).**  Polyphonic synth — used most famously for the Beethoven 9th wave-start jingle.  Three pieces of state surfaced (Robotron addresses; Defender/Stargate overlay one cell higher — DUR=$13, OSCIL=$15, RDELAY=$16 — wired in the same 2026-05 pass so the pane animates on all three games):
- `OSCIL` at `$14` — 8-bit bitmask of active oscillators.  popcount = number of voices.
- `DUR` at `$12:$13` — 16-bit note-duration counter.
- `RDELAY` at `$15..$50` — 60 bytes of *self-modifying* delay scratchpad re-written by ORGANL each tune step.

`viz/ORGANView.ts` renders 8 LEDs (MSB-first, lit when the corresponding bit is set) above a colour-coded RDELAY heatmap.  ORGAN doesn't run from a single `fire(cmd)` — `$1B` only arms the tune; the ORGAN inner-loop ticks inside the IRQ handler between other sounds.  No golden fixture (impractical to capture); the populator is covered by a pure-reader test that pokes RAM directly.

**Per-game engine specs.**  Robotron's zero-page layout is completely different from Defender/Stargate's (the source was rewritten with its own EQUates):

| Cell | Defender / Stargate | Robotron |
|---|---|---|
| LO / HI (LFSR) | `$0A` / `$09` | `$06` / `$05` |
| LOPER / HIPER (VARI) | `$13` / `$14` | `$12` / `$13` |
| GECHO (GWAVE) | `$13` | `$12` |
| GPER (GWAVE) | `$21` | `$20` |
| GWTAB base | `$24` | `$23` |

`engineState.ts` was refactored from `{ENGINE}_RANGES` (just code ranges) to `{ENGINE}_SPECS` (range + per-cell addresses) so each game's layout can co-exist.  Same restructure cascaded into `engineToggles.ts` (Pattern 3 toggle gates now consult per-game `CELL_MAP`).

**A/B diff (Step 5.3 / Pattern 6).**  `viz/ABDiff.ts` runs `runSoundWithRom()` twice in the main thread (using browser-fetched ROMs from `loadRomFromUrl()`) and renders the two byte streams as parallel coloured tapes with a divergence band between them.  Pixels in the band flash red where the two streams disagree, dim grey where they match.  Summary line reports "X% identical" plus the cycle of first divergence.  `runner.ts` was split: browser-safe pieces stay there; the Node-only convenience `runSound()` (with `loadROM`) moved to `runnerNode.ts` so Vite doesn't trip over `node:fs` imports.

**Genealogy (Step 5.4 / Pattern 7).**  `public/data/genealogy.json` is a hand-curated table of cross-game families (LFSR / GWAVE / VARI / SCREAM / ORGAN) listing each family's members across games.  `viz/Genealogy.ts` renders chips per member; clicking a chip cycles it into slot A then B of the diff selectors; the family's "Compare ↔" button auto-loads the canonical pair and runs the diff.  No graph visualisation — the relationships are flat-by-engine and a list reads more clearly than a graph at this scale (5 families, 15 members total — the SCREAM and ORGAN families now span all three games, not just Robotron).

### Pattern 8 — causal hover trace (Step 4.5)

The connection from "this moment in audio" → "this routine + source line" in one move.  Two surfaces publish hover events:

- **Spectrogram canvas**: a parallel `Float64Array` ring (size = canvas width) records the CPU cycle for each column drawn at rAF rate.  `mousemove` translates mouse-X → "columns from right edge" → ring index → historical CPU cycle.  Decouples the mapping from vsync rate / pause / scrub: even during a frozen audio thread the column's cycle is whatever was true when it was drawn.
- **Byte tape (`EyePanel`)**: extended with `setHoverHooks()` so its existing per-cell hover handler also publishes the cell's cycle.  Cell-change throttled so intra-cell pixel motion doesn't churn the Code panel.

Both feed into a single `publishInspect(source, cycle)` sink in `main.ts` which:

1. Resolves cycle → PC via a client-side `pcByCycle` cache.  The cache accumulates fresh events from each snapshot's `recentDacEvents` (a ~250 ms window per snapshot at 10 Hz → ~60 s of history at 60 K event cap).  Cleared when the recording is reset.
2. Calls `codePanel.setInspectCursor({ cycle, pc, source })`.

The CodePanel renders an "INSPECT" line at the top when the cursor is set:
```
INSPECT [spectrogram]  cycle=12,345  PC=$F8A7  LITE0  VSNDRM1.SRC:268
```
… which is enough info to jump straight to the line of 6800 source that produced the sample under the mouse.  When the cursor is null (no hover), the line is absent and the panel renders normally.

PC=`(silent)` shows when no event-PC is cached at-or-before the hover cycle — happens for hovers before any sound has fired, or before the cache was warmed.

### Engine view — Pattern 3 toggles (Step 4.4)

Each toggle gates a single, surgical RAM write so the user can hear what happens when a piece of the synthesis algorithm is taken out of the loop:

| Toggle | What it does | Pedagogical effect |
|---|---|---|
| **Freeze LFSR** | Discards writes to `$09` / `$0A` | LITE becomes a periodic click train at LFREQ rate — proves the LFSR shift is what makes "noise" |
| **Freeze VARI period** | Discards writes to `$13` / `$14` | SAW becomes a steady square wave at fire-time duty cycle — disables the descending-pitch sweep |
| **Freeze GWAVE pitch** | Discards writes to `$21` (GPER) | HBDV's pattern-step pitch contour is bypassed |
| **Skip WVDECA** | Discards writes to `$24..$6B` when PC ∈ [WVDECA, WVDCX) | Wavetable doesn't decay across echoes — the heartbeat keeps full amplitude forever |

**Implementation.**  `src/audio/engineToggles.ts` exports a pure `shouldDiscardWrite(toggles, addr, game, pc)` predicate consulted from `SoundBoard.write()` immediately before each RAM byte goes through.  PIA writes are never gated (DAC + command latch are externally observable hardware behaviour, not engine state).  PC-gating uses the post-advance `cpu.pc`, which always lands 1-2 bytes after the writing instruction — still inside the same routine range.

**Protocol.**  New worklet message `{ type: "engine-toggle", key, value }`; runner method `setToggle(key, value)` writes through to `board.toggles`.  Host method `setEngineToggle(key, value)` posts the message.

**UI.**  The Engine view section starts with a row of labelled checkboxes built from `ENGINE_TOGGLE_META` (so adding a new toggle is one file).  Each checkbox's tooltip explains what it does; toggle clicks before Init are stashed locally and replayed once the host is ready.

### Engine view — Wavetable (Step 4.3)

GWAVE drives HBDV and the majority of melodic Defender/Stargate sounds.  `viz/WavetableView.ts` consumes `snapshot.gwave` and renders:

- **72 vertical bars** representing the live RAM wavetable at `$24..$6B`.  Each bar is centred on the mid-rail; values above $80 grow up, values below grow down — so a sine-shaped wave looks like a sine, not a stack of unsigned bytes.
- A **yellow cursor** at `sampleIndex` (= X − $24) marking where GPLAY is reading from right now.  A small `$XX` value bubble sits above the cursor.
- The field readouts are **HTML `.gwave-readout` rows** above + below the canvas (not canvas-drawn) so each field name is a clickable glossary **term-link** (like VARI's LOPER/HIPER), with `WavetableView` filling the `<span data-gw="…">` values each frame: caption row = cursor index, `GPER`, `GECHO` (● / ○), `GECNT`; footer row = `GWFRM`/`GWFRQ` pointers, signed `FOFSET`/`GDFINC`, `PRDECA`, `GECDEC`.

What makes the panel pedagogical: pause + single-step, and the cursor visibly advances one bar per `GPLAY` iteration; let an echo trigger and the bar heights visibly shrink as `WVDECA` mutates the RAM table in place.  The slowed (¹⁄₁₀×) playback exposes every sample readout as a discrete event.

Address range for dispatch: `[FB81, FCB6)` on Defender (GWLD → IRQ); `[FB57, FC8C)` on Stargate — Stargate's block sits ~42 bytes lower because of earlier-code drift, verified from the per-game label maps.

Same scrub caveat as VARI applies — the cursor and bars stop animating during scrub because RAM isn't time-travelled; the slot's identity is correctly recovered from the historical PC.

### Engine view — VARI duty-cycle bars (Step 4.2)

The first proper per-engine viz lives in a "Engine view" collapsible section at the top of the right column, above the spectrogram.  `src/viz/VARIView.ts` reads `snapshot.vari` (populated by `engineState.ts` while PC ∈ [F82A, F88C)) and draws:

- Two horizontal countdown bars — LOCNT filled against LOPER, HICNT filled against HIPER — with the live count / initial period printed next to each.
- A one-period duty-cycle preview rectangle: the bottom-then-top trace shows how the LOPER:HIPER ratio defines the asymmetric square wave that produces SAW's characteristic timbre.
- A small readout below: `LODT=±$XX  HIDT=±$XX  LOMOD=±$XX  HIEN=$XX` — the sweep parameters that move the bars between cycles.

When no VARI sound is running the panel shows a single idle caption (`VARI not currently running — fire $1D / $1E / $1F`).  The same shape is the template for upcoming Wavetable / SCREAM / ORGAN views.

**Scrub-mode caveat.**  During scrub the engine *identity* is recovered correctly (the historical PC at the head's cycle is used for dispatch) but the *values* — LOCNT / HICNT bars, LOPER / HIPER readouts — read live RAM, which is frozen at scrub-entry.  Bars therefore don't animate with the scrub head.  Full fix (per-IRQ-tick RAM snapshot ring) is tracked in §"Known caveats and deferred follow-ups".

### Stage swimlane + label map (Step 3.4)

Phase 3's closer. Adds a full-width panel below the spectrogram that shows **which ROM routine is running** over time — one horizontal lane per label seen in the current scrub window.

**Data flow.**

1. `tools/build_roms.sh` now invokes vasm with `-L tools/build/${src}.lst`, producing per-file listings whose terminating `Symbols by name:` section pairs each label with its absolute address.
2. `tools/build_labelmap.py` parses each `.lst` twice — once for the body (`SS:AAAA HEXBYTES \t LINENO: SOURCE` lines, giving `addr → first source line`) and once for the symbol table (`LABEL    A:AAAA` rows, giving `label → addr`). Only `A:` entries are kept; `E:` equates / register addresses are dropped. The result is written to `explorer/public/data/{defender,stargate,robotron}_labelmap.json` with the schema:
   ```json
   {
     "game": "defender",
     "source": "VSNDRM1.SRC",
     "labels": [
       { "addr": 63489, "label": "SETUP", "src_line": 170 },
       { "addr": 63628, "label": "LITE",  "src_line": 250 },
       { "addr": 63646, "label": "LITEN", "src_line": 265 },
       …
     ]
   }
   ```
   Counts as of this writing: Defender 181 labels, Stargate 179, Robotron 364.
3. The Python invocation runs inside `prepare:public` so dev/build flows pick it up automatically. Listing files are already covered by `.gitignore`'s `tools/build/`; generated JSON files are added under `explorer/.gitignore` as `public/data/*_labelmap.json`.
4. `src/audio/labelMap.ts` fetches all three JSON files in parallel, exposes a binary-search `resolve(map, game, pc) → { label, src_line, offset } | null`, and degrades silently to empty arrays when the static assets aren't there (so the explorer remains functional even before `prepare:public` has run once).

**Swimlane viz** (`src/viz/StageSwimlane.ts`).

- Implements the same `VizPanel` interface as Ear/Eye/Code.
- On every snapshot:
  - Pulls `snapshot.recentDacEvents.{cycles, pcs, count}` plus the same `windowStart` / `windowEnd` bounds the byte tape uses (so the two panels line up pixel-for-pixel).
  - Resolves every event's PC to a label via the cached label map, collapsing consecutive same-label events into one segment per lane.
  - Lane assignment is **first-appearance order** in the window — top lane = first routine seen — and lane colour comes from a golden-angle hue ramp keyed by lane index, so adjacent lanes are well-separated.
  - Left gutter (88 px) prints each lane's label in its own colour; main plot draws each segment as a coloured rectangle from `startCycle` to `endCycle`.
  - The yellow tape head marker (right edge in live mode, mid-canvas in scrub mode) is reused from the DAC tape conventions.
- Hover a segment → tooltip with label, $address, cycle range, dwell time in ms, and the source-file:line where the label is defined.

**Why this works pedagogically.** LITE in particular makes the dispatcher path visible: SETUP → IRQ entry → LITE → LITEN inner loop → IRQ tail → back to BRA self-loop, each as its own band. Combine with slow-mode (¹⁄₁₀₀×) playback and the user can literally *watch* the program counter move through the ROM as the speaker moves.

**Limitations.**  See §"Known caveats and deferred follow-ups" below — PC-only-at-DAC-write and self-modifying RAM ranges are documented there with their planned fixes.

### Live grid (Step 3.1 / Pattern 1, reorganised)

The primary live visualisation. Originally the 3-column "Ear · Eye · Code" triangle; the 2026-05 UI pass made it a responsive `.live-grid` (in the left column) and pulled the Stage swimlane in. **Ear** (the oscilloscope) spans the full width on top (`.live-span` → `grid-column: 1 / -1`); **Code**, **Eye**, and **Swimlane** flow below it at `auto-fit/minmax(300px)` (Code + Eye pair up at the usual left-column width, Swimlane wrapping below). Four panels share a single snapshot stream — reading order Ear, Code, Eye, Swimlane:

- **Ear** (`viz/EarPanel.ts`) — oscilloscope of `snapshot.lastSamples`. Centre line = silence; top/bottom = positive/negative DAC. Renders the same post-LPF signal the speaker is reproducing, so what you see matches what you hear. At default 512 samples = 10.7 ms window at 48 kHz, redrawn at the 10 Hz host poll rate.
- **Swimlane** (`viz/StageSwimlane.ts`) — moved here from the right column: one lane per ROM routine seen in the window, derived from the captured PC + assembler label map (see §Stage swimlane).
- **Eye** (`viz/EyePanel.ts`) — the DAC byte tape (Pattern 2, Step 3.3): one coloured cell per `$0400` write, hover for `{value, cycle, pc → label}` (see §DAC byte tape).
- **Code** (`viz/CodePanel.ts`) — replaces the old `<pre id="state">` block. Four-line readout: disassembled next instruction, A/B/X/SP, PC/CCR + flag letters (Hinzvc), cycles + status (running / paused / scrubbing @speed×).

**Shared `VizPanel` interface** (`viz/types.ts`):

```ts
interface VizPanel { update(snapshot: StateSnapshot): void; }
```

`main.ts` instantiates the three panels once at module load and pushes every received snapshot to all three. The "shared timeline cursor" is implicit — each panel reads `cycles` / `scrubCycle` from the same snapshot, so they advance together. Pausing and dragging the scrubber updates the Ear waveform, the Eye gauge, and the Code cycle counter in lockstep.

**`lastSamples` ring** (`audio/realtimeRunner.ts`):
- A `Float32Array(outputRingSize ?? 512)` ring tracks the most recent audio output samples written by any fill path (live, paused-with-queue, scrub).
- `snapshot()` linearises it as a fresh `Float32Array` (oldest → newest) so the Ear panel can plot it directly.
- ~1 KB per snapshot × 10 Hz = 10 KB/s message bandwidth — negligible.

**HTML grid** (`index.html`):

```
.live-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
```

Single-column under 900 px wide. Each `.panel` is a `<section>` with a small label + canvas (Ear, Eye) or `<pre>` (Code).

### Scrubber UX overhaul (post-3.2 polish)

The bare tape scrubber from Step 2.3 worked but had several rough edges in practice. The following changes (collectively) make it pleasant to use:

**Sound segments.** `RealtimeRunner` tracks a `SoundSegment[]` (last 128 fires).
- `fire(cmd)` opens a new segment at the current CPU cycle and closes any previously-active one.
- Segment closes when the DAC has been idle for ≥ 50 000 cycles (~50 ms) — heuristic for "the IRQ handler returned to BRA-self and the sound is over."
- Each segment is `{cmd, startCycle, endCycle | null}`.
- Snapshot exposes a defensive clone so the host can render markers without races.

**Loop modes.** `scrubLoopMode: "none" | "range" | "segment"` on RealtimeRunner.
- `none` — clamp at the recording boundary (original behaviour).
- `range` — wrap newest → oldest at the boundary (whole recording loops).
- `segment` — wrap within whichever segment the head is currently inside; falls back to range if outside any segment.
- The wrap math handles forward + reverse scrub speeds + arbitrary overshoot (so fast-scrub doesn't escape the loop).

**Markers on the slider.** An absolutely-positioned `.scrub-markers` overlay sits above the range slider. Each segment renders as:
- a **yellow start tick** with the hex code (`$11`, `$15`, …) shown as a label floating above it;
- a **thin gray end tick** at `segment.endCycle` so the boundary between sound and silence is visible.
The active marker (containing the scrub head) goes pink. Hover shows `$XX  ROUTINE — name` from the glossary. Click → `setScrubPosition(seg.startCycle)` + auto-switches loop to "segment" for instant repeat-listening.

**The "first marker is missing" fix.** `segment.startCycle` is the CPU cycle of `fire()`; `recordedRange().oldestCycle` is the *first DAC write* cycle, which comes ~12 cycles later (IRQ vector overhead). For the first segment that meant its start fell outside the slider's mapped range and the marker disappeared. The host now extends `recordedOldest` leftward to include the earliest segment's start cycle so the first marker always lives inside the band.

**▶/⏸ play-pause toggle.** Replaces the bare `⏸` preset. Remembers `lastNonZeroScrubSpeed` and toggles between freeze (speed 0) and that speed. Default first-press = +1 (forward). The label flips between ▶ and ⏸ so the user can resume without hunting for a play preset.

**Scrub starts FROZEN, not playing.** The Scrub button now starts the head at speed 0 instead of speed 1× forward. Means the user can click a marker or drag the slider without the head sliding out from under their cursor.

**⟲ Reset.** New host method + worklet message + UI button that wipes the DAC history ring + segment array + active segment + un-pauses the CPU + exits scrub mode. Critical detail: `resetRecording()` deliberately resumes live execution; otherwise post-scrub Reset → Fire silently freezes the CPU (Fire's IRQ arrives but the paused fillBlock never advances anything to service it).

**📍 Compact timeline mode (default).** Slider 0..100% now maps to *accumulated sound time* (sum of segment durations), not wall-clock. Idle gaps between sounds take 0% of the slider; markers sit back-to-back; navigating to a specific sound is one click. The toggle `📍 Compact / 📍 Real-time` flips the mapping; mapping is purely client-side via `cycleToCompactOffset` / `compactOffsetToCycle` helpers, no protocol changes.

**`🔁 Loop: off / range / segment`** cycling button — see "Loop modes" above. Clicking a marker auto-switches to "segment" mode.

**Inline explanation paragraph** under the scrubber covers all of the above so the user doesn't need to read this doc to figure out the controls.

**Mute button removed.** Old "Mute" set `active=false` on the worklet, which silently froze the CPU and had no resume path. The volume slider (with smooth-ramp via `setTargetAtTime`) is the proper way to attenuate.

### Tape-loop scrubber (Step 2.3 / Pattern 11)

Closes out Phase 2: pause the live CPU and drag through the recorded DAC history at any speed (forward, reverse, or frozen).

**Always-on DAC history.** `src/audio/dacHistory.ts` is a typed-array ring buffer that captures every Port-A write the CPU makes alongside its cycle timestamp and the producing instruction's PC. Both drain sites in `RealtimeRunner` (`fillBlock` and `syncAfterStep`) push into the history before discarding the live events array. Default capacity 50 000 events ≈ 90 s of LITE-density audio or ≈ 5 s of Robotron-density audio. Binary search on cycles (O(log n)) for ZOH `valueAt()` and `pcAt()` lookups. 16 dedicated tests in `tests/dacHistory.test.ts` cover empty, wrap, clamp-to-range, ZOH semantics, and a 10 k push + 10 k lookup stress.

**Ring-wrap + the scrubber.** Because the ring evicts oldest-first, on a long/dense recording `recordedRange().oldestCycle` advances *forward* past early segments whose sample data is gone. The segment list (markers) is bounded only by `MAX_SEGMENTS` (count), so it can outlive the ring. `main.ts` therefore clips the segment list to `[oldestCycle, newestCycle]` via `audio/scrubTimeline.ts` (`clipSegmentsToRange`) before it feeds the markers + compact-axis mapping — dropping fully-evicted segments and clamping a straddler's start up to `oldestCycle`. Without this the scrub thumb stranded mid-track at "0.0 ms" with phantom markers to its left (fixed 2026-05; regression-pinned in `tests/scrubTimeline.test.ts`). `scrubTimeline.ts` also holds the now-extracted, unit-tested compact-axis math (`compactDuration` / `cycleToCompactOffset` / `compactOffsetToCycle`) and `scrubReadout()`, which reports the head position in whichever axis the slider uses — sound-only elapsed in **compact** mode, wall-clock in **realtime**. (Reporting wall-clock in compact mode was a second bug: the slider's left edge is the first *sound*, which can be hundreds of ms after `oldestCycle` thanks to skipped pre-roll, so the readout showed e.g. "450.6 ms" at the far left instead of "0.0".)

**What scrub does NOT replay.**  Only the DAC byte stream is recorded; RAM is not.  So during scrub, the byte tape + audio + swimlane + engine-slot *identity* are all correct, but the Code panel's A/B/X registers and the engine slot's *values* stay frozen at the scrub-entry RAM state.  Same caveat applies everywhere live state is shown.  See §"Known caveats and deferred follow-ups" for the planned per-IRQ-tick RAM-snapshot ring fix.

**Scrub mode on `RealtimeRunner`.** When active:
- `paused = true` (the live CPU is frozen)
- `fillBlock` takes a different path (`fillBlockScrub`): for each output sample, look up the DAC byte at `scrubCycle` in the ring buffer, apply ZOH + the same per-sample LPF, then advance `scrubCycle += scrubSpeed × cyclesPerSample`. Negative `scrubSpeed` = reverse playback (the LFSR runs backward — the canonical Pattern 11 demo).
- Scrub position clamps to the recorded range; speeds work for any magnitude (the head saturates at oldest/newest).

API: `startScrub(cycle, speed)`, `setScrubPosition(cycle)`, `setScrubSpeed(value)`, `getScrubPosition()`, `isScrubbing()`, `recordedRange()`, `exitScrub({resume?})`.

**Worklet/host protocol.** Four new inbound messages: `{type:"scrub-start", cycle, speed}` / `{type:"scrub-pos", cycle}` / `{type:"scrub-speed", value}` / `{type:"scrub-end", resume?}`. The `state` snapshot now carries `scrubbing`, `scrubCycle`, `scrubSpeed`, and `recorded: HistoryRange` so the UI knows the scrubber's bounds.

**UI.** `<h2>Tape scrubber</h2>` section in `index.html`:
- **Scrub** button — enter scrub mode (starts at the oldest recorded cycle, speed 1×).
- **▶ Live** button — exit scrub and resume the CPU.
- Reverse/forward speed presets: `⏪ 1× / ⏪ ¼× / ⏸ / ¼× ⏩ / 1× ⏩`.
- Range slider 0..1000 mapped linearly to `[oldestCycle, newestCycle]`. Dragging posts `scrub-pos`.
- Readout shows `posMs / totalMs · speed×` while scrubbing, or `totalMs recorded · N events` while live.

**Snapshot polling.** Snapshots aren't auto-emitted during live playback (the worklet sends them only after pause / step / scrub events). `main.ts` adds a 10 Hz `setInterval` poll that requests a snapshot — keeps the CPU-state panel and the scrub readout moving continuously without flooding the message port.

### Audible step playback (post-2.2 fix)

By default a paused `fillBlock` emits the held LPF value (silent at the speaker). But the user can't *hear* a step happen — they advance the CPU and the speaker stays at DC. Fixed by adding a **playback queue** that captures the audio the just-stepped cycles would have produced:

- Every step (`step / stepToNextDacWrite / stepToNextIrq / runUntil`) calls `syncAfterStep`, which now renders the cycle range `[cycleAccumulator → cpu.cycles]` via the same ZOH + LPF pipeline as `fillBlock`, and appends the result to `playbackQueue`.
- Paused `fillBlock` drains the queue first, then falls back to held LPF silence.
- `resume()` discards the queue (audio continues fresh from the CPU's current position, not as a replay of stepped history).
- Hard cap of ≈1 second of queued audio (configurable via `sampleRate`) so a long Step→IRQ inside LITE can't queue a 13-second playback that never ends.

Net effect: clicking **▸ DAC** while paused plays a brief audible click corresponding to the next DAC write; clicking **▸ IRQ** plays a short burst (~1 s max) of what the next inter-IRQ interval would have sounded like.

### LPF model

The same single-pole `α = dt/(RC+dt)` formulation as `synth/lpf.ts`, but kept duplicated inline so the per-sample hot path stays tight. Alpha computed once in the constructor from `sampleRate` + `lpfCutoffHz`. State (`lpfY`) survives across blocks for continuity.

### Speed scaling vs snapshot decoupling

Step 2.2's verification says "slide speed → audio pitch drops audibly". Phase 2.1 implements this as direct CPU-clock scaling — the most natural interpretation, and the one that produces the most pedagogically interesting audio (LFSR clock becomes audible as a click train at 0.1×).

The "decoupled snapshot animation" approach from `docs/explorer_architecture.md` Open Question #3 is reserved for Phase 3+ visualisation, where audio plays at 1× and the visual layer animates at a slowed-down rate. For Phase 2 the slider is a CPU-clock multiplier.

### User-supplied ROMs

The app ships no copyrighted ROM bytes — the user supplies the Williams *sound* ROMs, stored locally in IndexedDB.  The pipeline:

- **`audio/romValidate.ts`** (pure) — `validateRom(game, bytes)` returns a tier: `ok` (SHA-1 in `KNOWN_GOOD_SHA1` — the 3 MAME production hashes + the from-source Defender build), `warn` (unknown SHA but right size + the 6802 reset/IRQ vectors at the top of the image point into ROM), or `reject`.  Trims uniform `0x00`/`0xFF` trailing padding to the exact size the `SoundBoard` constructor demands.
- **`audio/romStore.ts`** — raw-IndexedDB store (`get/put/has/list/delete`) keyed by game, plus `loadRomBytes(game)`: store first, else a gitignored `/roms/<game>_sound.bin` dev fallback (validated + seeded into the store), else throws.  This is the single ROM-bytes source; both browser entry points reroute through it — `WilliamsSoundHost.fetchRom` (host.ts) and `loadRomFromUrl` (board/romFetch.ts).  Each call returns a fresh copy, so transferring the buffer to the worklet never neuters a cached one.
- **`audio/onboarding.ts`** + the `#onboarding` overlay — three labeled slots (the slot fixes the game; Defender/Stargate are both 2 KB and otherwise indistinguishable), drag-drop / file-pick, per-slot tier feedback **with the SHA-1 shown** (so an unrecognized-but-working dump reveals its hash for the allowlist), Replace/Remove.  Emits a `rom-store-changed` window event.
- **`main.ts`** — `autoInit` seeds the dev fallback, then shows onboarding if no ROM is stored, else boots the first available game (preferring Defender).  `availableGames` (from `listRoms()`) drives the switcher's 🔒 locked state, guards `switchToGame`, and gates A/B-diff comparisons; the app runs with **as few as one** ROM.  `rom-store-changed` re-evaluates availability and clears the WAV-export + A/B ROM caches.

Tests: `tests/romValidate.test.ts` covers the pure size/vector/tier logic (SHA tiers guarded by `it.runIf(!!crypto.subtle)`, "ok" checked against the real `tools/defender_sound.bin` when present).  `romStore` needs IndexedDB, absent in the Node test env — covered by manual browser E2E.

### Build commands

```bash
cd explorer

npm run prepare:public  # build glossary/labelmap/explainer/zeropage JSON (no ROMs)
npm run dev:roms        # OPT-IN: cp ../tools/*_sound.bin → public/roms/ (dev fallback)
npm run build:worklet   # esbuild one-shot → public/williams-sound-explorer-worklet.js
npm run watch:worklet   # esbuild --watch=forever (used inside `dev`)
npm run dev             # prepare + build:worklet + concurrently(watch:worklet, vite)
npm run build           # prepare + build:worklet + vite build → dist/  (no ROM bytes)
```

`public/williams-sound-explorer-worklet.js` is gitignored (derived from `src/audio/worklet.ts`, rebuilt each run).  `public/roms/*.bin` is gitignored too but **not** produced by `prepare:public` — the app ships no ROM bytes; users upload their own (stored in IndexedDB, see §User-supplied ROMs).  `npm run dev:roms` is the opt-in local-dev fallback.

### Verifying in the browser

1. `cd explorer && npm run dev`
2. Open http://localhost:5173 in Chrome / Firefox / Safari.
3. Click **Init**. The harness fetches `roms/defender_sound.bin`, registers the worklet, and the log shows `Ready.`
4. Hex command field defaults to `11` (LITE). Click **Fire** — you should hear the Defender lightning sound in real time.
5. Slide **Speed** down to `0.1` and fire again — the LFSR clock becomes individually audible as a click train.
6. Click **Mute** to silence; **Dispose** to tear down the AudioContext.

Phase 2.2 will polish the speed slider (preset stops at 1×, 1/4×, 1/10×, 1/100×, single-step) and add a Pause/Step pair.

## Test surface

Per the "test thoroughly" rule (`memory/feedback_thorough_testing.md`):

| File | Coverage | Tests |
|---|---|---|
| `flags.test.ts` | CCR bit set/clear, NZ for 8 & 16 bit | 7 |
| `alu.test.ts` | every ALU primitive + edge cases (H/V/C boundary, $7F→$80 overflow, $80 negate, etc.) | 31 |
| `opcodes.test.ts` | dispatch + addressing modes + every branch family + stack ops + RTI | 30 |
| `irq.test.ts` | 4 families: happy / stack-frame / mask / refire — all 3 games | 11 |
| `setup.test.ts` | boots all 3 ROMs through SETUP to idle | 3 |
| `runner.test.ts` | LITE + APPEAR + silence + cross-game equivalence + delta-cycle invariants | 9 |
| `synth.test.ts` | DacSampler ZOH timing + LPF DC + Nyquist attenuation | 9 |
| `wav.test.ts` | header + payload + clamping | 3 |
| `golden.test.ts` | byte-identical regression for LITE | 1 (gate) |
| `realtimeRunner.test.ts` | live runner + step primitives + scrub + samples + segments + loop modes + reset | 54 |
| `disasm.test.ts` | 6800 disassembler: every addressing mode + known LITE-path opcodes + unknown-opcode handling + formatter | 15 |
| `dacHistory.test.ts` | DAC ring buffer: empty / no-wrap / wrap / clear / large-burst / 10 k binary-search stress | 16 |

The golden fixture (`tests/golden/defender_11_lite.json`) is the **regression gate**: any drift in CPU semantics, opcode encoding, PIA model, or dialect preprocessing breaks this test loudly. Seeded once, compared forever.

The `realtimeRunner.test.ts` "equivalence with offline render" test cross-checks that the realtime path produces a signal of roughly the same shape (RMS within `[0.5, 0.999]` for LITE) as the offline path — they aren't bit-identical (per-sample inline LPF vs. post-resample LPF) but should produce audibly equivalent results.

## Commands cheat-sheet

```bash
# Build the ROMs (idempotent, ~1 second)
tools/build_roms.sh

# Run all tests
cd explorer && npm test

# Strict typecheck
cd explorer && npx tsc --noEmit

# Render a WAV (offline ear-check workflow)
npx tsx tools/render_sound.ts defender 0x11 out/defender_11_lite.wav

# Real-time browser harness (Phase 2.1)
cd explorer && npm run dev    # → http://localhost:5173

# Production browser bundle (Phase 2.1)
cd explorer && npm run build  # → explorer/dist/

# Watch tests (TDD loop)
cd explorer && npm run test:watch
```

## Verified findings during implementation

Recorded here so future-me doesn't re-derive them:

1. **Defender's LITE produces exactly 386 DAC events over 624 204 cycles (~698 ms).** Locked as `tests/golden/defender_11_lite.json`.

2. **Defender vs Stargate LITE: value-identical bytes, but Defender starts 10 cycles *later*.** The two ROMs share the LITE engine byte-for-byte, but Defender's IRQ handler probes the (absent) talking ROM at `$EFFD`. That probe takes 10 CPU cycles. So the DAC byte values match exactly, the inter-event cycle deltas match exactly, but the *absolute* cycle offsets differ by a constant 10. This is empirically validated by `tests/runner.test.ts`.

3. **The IRQ handler's first instruction (`LDS #$007F`) resets SP to the top of RAM**, intentionally. Williams uses this as a hard reset of the call stack each IRQ — so any in-progress sound's stack frame is discarded. This was a surprise during test writing: "the CPU vectored but SP went *up* on the next tick" — that was the LDS, not an RTI.

4. **`tsx` defaults to CJS at the project root** (where there's no tsconfig). Top-level `await` requires either `"type": "module"` in a local package.json or wrapping in `async main()`. The render-sound CLI uses the latter.

5. **Browser default `AudioContext.sampleRate` is platform-dependent** (44.1 kHz on most macOS, 48 kHz on most Linux). The host pins to 48000 explicitly in `WilliamsSoundHost` to match Node-side render parity.

6. **LITE's RMS is ~0.98** at the speaker. LFSR-driven noise bounces 0x00↔0xFF (full DAC swing) at a rate well below the 10 kHz LPF cutoff, so the LPF can't smooth between transitions — only inside them. The realtime path matches the offline path here. (Adjusted the equivalence test threshold during Phase 2.1.)

7. **Post-sound silence is a DC level, not zero.** When LITE finishes and the IRQ handler returns to `BRA *`, the DAC holds at whatever value the last `STAA $0400` wrote. A real speaker doesn't reproduce DC, but our sample stream sits at that level until the next sound. The realtime test detects silence as *intra-block peak-to-peak < threshold*, not absolute value.

8. **Vite pulled forward from Phase 3.1 to Phase 2.1.** The AudioWorklet needs ES-module bundling that `tsx` cannot provide. Vite is now the default dev server; Step 3.1's "add Vite + canvas panels" reduces to "add canvas panels."

9. **AudioWorklet bundling: esbuild, not Vite plugins.** Vite has no first-class `?worklet` query as of v7. We pre-bundle `src/audio/worklet.ts` → `public/williams-sound-explorer-worklet.js` with esbuild (already a transitive dep), which produces a single self-contained ES module the browser can `addModule()` directly.

## What's built in Phase 6

Phases 1–6 are closed.  All six engines live (LFSR / VARI / GWAVE / FNOISE / SCREAM / ORGAN).  Phase-6 deliverables:

- **Step 6.1** — Build-up / tear-down (Pattern 4): SCREAM voice-mute toggles + 700 ms sequencer; ORGAN voice mute extension via `transformWriteValue()` AND-masking OSCIL bits.  Both sequencers run on **whichever game is loaded** — SCREAM/ORGAN are cross-game, so `engineToggles.ts`'s `CELL_MAP` and the `setToggle` OSCIL stomp carry per-game addresses (D/S STABLE=$13 / OSCIL=$15, Robotron $12 / $14).
- **Step 6.2** — What-if parameter sliders (Pattern 5): VARI LOPER/HIPER force-overrides.
- **Step 6.5** — No-explanation toggle (Pattern 12): `body.hide-help` CSS class, persisted to localStorage.
- **Step 6.3** — Annotated explainer cards (Pattern 9): `viz/ExplainerCard.ts` + **63 routine cards covering every catalogued sound**.  Source of truth: [`docs/explainer_cards.md`](../docs/explainer_cards.md) (one `## ROUTINE — Title` section per card).  `tools/build_explainer_cards.py` (auto-run via `prepare:public`) emits per-routine JSON to `explorer/public/data/explainer/`.  Loaded on every user-driven fire via `loadExplainerForCmd()`; runtime `sanitiseRoutine()` matches the tool's sanitisation so e.g. `"SP1 / CABSHK"` and `"PERK$$"` both resolve to single-key files.
- **Step 6.4** — Listen-then-look quiz (Pattern 10): `viz/QuizPanel.ts` — collapsible right-column section, random sound from a ~96-entry pool (6 canonical engines), MCQ engine-identification, reveal with link into the explainer card.  Closes Pattern 10 — **all 12 UX patterns now delivered**.
- **Step 6.6** — RAM heatmap: `SoundBoard.lastWriteCycle` + `viz/RAMHeatmap.ts` (16×8 grid, cold→hot over 1 s decay).  Hover tooltip names the cell's function via `tools/build_zeropage.py` → `{game}_zeropage.json` + `audio/zeroPageMap.ts`.  The 128-byte zero page is `ORG LOCRAM`-overlaid by every engine, so a single address (e.g. `$13`) maps to GECHO / LOPER / DECAY / FMAX / STABLE / DUR — `describeCell()` picks the meaning for the active engine and reports the overlap depth.
- **Auto-pulse for `$1B` ORGANT** — `fireUserCmd()` wraps Fire / chip clicks; arm-only audit confirmed only ORGANT and ORGANN qualify across all 3 ROMs.
- **FNOISE engine slot** wired (cannon / thrust / BG1) — `audio/engineState.ts` populator + `viz/FNOISEView.ts`.
- **Scrub-mode RAM time-travel** — `audio/ramHistory.ts` snapshots every ~512 cycles; engine views, wavetable, and heatmap all animate as the scrub head moves.
- **UI restructure** — two-column sticky layout with draggable splitter, segmented game switcher, per-game chip browser, responsive auto-fit engine grid, ResizeObservers on every canvas.  The **2026-05 UI pass** reworked the live area into a 2×2 grid (Ear · Code / Eye · Swimlane), made the spectrogram full-width with the RAM heatmap (open) directly below, paired Glossary + Explainer two-up, and moved the Log to the bottom of the left column (collapsed).
- **WAV export** — a `⬇ .wav` button next to Fire re-renders the current command offline in the browser (`runSoundWithRom` → `renderDacEvents` → `applyLpf` → `encodeWav` → `Blob` download), byte-identical to `tools/render_sound.ts`.  Inline in `main.ts`, no new module; works before Init.
- **MANUAL.md** — 12-tutorial user manual at repo root.

The CPU has enough opcodes for every sound brought up so far; if a new sound exercises a gap, `runSound` fails with "unimplemented opcode 0xXX at PC=…" and the gap is easy to plug.

**Phase 6 is fully shipped** — all 12 UX patterns delivered (see `docs/pedagogical_design.md` for the pattern roll-up).  Optional future polish: quiz tier 2/3 (toggle-aware + A/B variants), byte-level deep-dives for the deliberately-terse explainer cards (SV3, ED10/ED12/ED17).

## Known caveats and deferred follow-ups

A single canonical list of "things that work, but with a known limitation".  Anything here is a deliberate trade-off, not a bug.  Most are easy to fix once a consumer needs more — listed roughly by impact.

**Scrub mode time-travels engine-slot values** *(✅ FIXED — Phase 6 follow-on)*
~~Previously the engine-slot values were frozen at scrub-entry RAM; only the *identity* (which engine was running) was recovered via historical PC.~~  `audio/ramHistory.ts` is a parallel ring to `DacHistory` that captures zero-page RAM (`$00..$7F`) + the X register every ~512 CPU cycles.  Scrub mode binary-searches by cycle and feeds the snapshot to `engineStateForPc()` via a `ramOverride` parameter, so the engine-slot's *values* (LOCNT/HICNT bars, GWAVE wavetable, SCREAM voices, …) animate as the user drags the scrub head.

Default capacity: 10 000 snapshots × 128 bytes ≈ 1.3 MB → ~5.7 s of capture window at the default interval.  Scrubs older than that fall back to live RAM (slot still populates with current values).

**Still not time-travelled**: A/B/X/SP/CCR registers in the Code panel.  X *is* in the ramHistory snapshot but `CodePanel` reads it from the live `cpu.x` field, not from the engine slot.  Low-priority polish — fix when it becomes annoying.

**Stage swimlane samples PC only at DAC writes** *(Step 3.4 design — Option (b) chosen)*
Silent stretches inside a routine that aren't punctuated by DAC writes (e.g. GWAVE's per-sample wait loops, the SETUP boot sequence) leave no lane data.  For LITE / SAW this is invisible because the DAC moves often.  Once GWAVE + SCREAM land, sparse stretches will produce gappy swimlanes — at which point add a fixed-cycle PC ring buffer (Option (a) in the original plan) and have the swimlane prefer it over the DAC-event PC array.  New snapshot field, no protocol change.

**`engineState.ts` covers all six engines** *(Steps 4.1 / 4.2 / 4.3 / 5.1 / 5.2 + Phase 6 follow-on)*
LFSR (LITE), VARI (SAW), GWAVE (HBDV), SCREAM (4 voices), ORGAN (OSCIL/DUR/RDELAY), and FNOISE (filtered noise — cannon / thrust / BG1).  All wired on Defender + Stargate; Robotron's distinct zero-page layouts handled via per-game spec objects.

**Label map ignores self-modifying RAM ranges** *(Step 3.4 / Step 5.2 deferred)*
`build_labelmap.py` parses the vasm listing's symbol table at face value.  Robotron ORGAN's RDELAY scratchpad reuses one range with different meanings at different times — the swimlane lane name will be misleading there until 5.2 introduces a "dynamic label" mechanism (probably a small heuristic that detects writes to ROM-looking addresses and shows a special "self-modifying" lane).

**Robotron LFSR / VARI / GWAVE / SCREAM / ORGAN specs are wired** *(Step 5)*
Robotron's zero-page layout differs from Defender/Stargate (`LO/HI` at `$06/$05`, `LOPER/HIPER` at `$12/$13`, etc. — Robotron's source was rewritten with its own EQUates).  Per-engine specs in `engineState.ts` track each game's cell map.

**Pause holds the LPF level rather than DC-blocking the held DAC byte** *(Step 2.2)*
When the user hits Pause mid-sound the audio thread holds the *current LPF output* rather than the current raw DAC byte.  Click-free, but it does mean the DAC byte tape's last visible cell and the Ear panel's flat line at pause time are slightly offset in value.  Acceptable cosmetic gap; no plan to fix.

**Single-Step playback queue is capped** *(Step 2.2+)*
`step-irq` over a very long IRQ handler queues at most a few seconds of rendered audio — anything past that is silently truncated.  Big-IRQ engines (ORGAN with many voices) might hit this; if so, expand `playbackQueue` cap in `realtimeRunner.ts`.

## Cross-references

- The design spine: `docs/explorer_architecture.md`
- The pedagogical patterns these all serve: `docs/pedagogical_design.md`
- The Williams hardware being emulated: `docs/sound_hardware_model.md`
- The DSP primitives the sounds are built from: `docs/synthesis_techniques.md`
- Per-game catalogues for command-code lookups: `docs/{defender,stargate,robotron}_sound_catalogue.md`
- The live execution plan: `~/.claude/plans/goal-is-to-built-purrfect-river.md`
