# Explorer Architecture — Williams Defender/Robotron Sound Effects Visualizer

> Sketch of the browser-based explorer you want to build. Goal: deeply understand how each sound effect works via visualization and slow animations. Both Defender and Robotron, same UI, same engine.

## North-star principle

Every variable that affects what you hear should be **visible, named, and animatable** at human-scale (1×, 1/10×, 1/100×, single-step). The product is "a microscope for a sound chip", not "a synthesizer".

## Two architectural options (pick one)

| Option | What it is | Pros | Cons |
|---|---|---|---|
| **A. CPU emulator** | Implement a 6800/6808 in JS/TS. Run unmodified ROM. Capture every `STAA $0400`. | Bit-accurate. Both ROMs work unchanged. Future-proof for Stargate/Joust too. Cycle-accurate by definition. | Need ~600 LOC of CPU emulation. Less direct path to "what stage am I in" labels. |
| **B. Hand-ported routines** (Studio's approach) | Translate each ROM subroutine to JS. Cycle-cost annotations carry timing. | Easier to instrument internal state. Each handler is small and readable. | Doubles the work: every Robotron sound has to be re-ported. Drift risk between ROM and JS. |

**Recommendation: A, augmented with a label map.** Build the 6800 emulator, but annotate the .SRC files into a `(addr_range → human_label)` table. At each instruction, the explorer knows both "what assembly is executing" AND "what conceptual stage we're in" (e.g. `GWAVE inner loop`, `WVDECA decaying byte 27`, `LFSR clocking`). You get both bit-accuracy and stage-level introspection.

## Layered architecture

Two complementary views: how the code is **layered in the source tree** (what may depend on what), and how it's **split across threads** at runtime.

### Source-code layering — headless core, browser on top (enforced)

The source tree is a **headless core** with a **browser layer** built on top, and a one-way dependency rule.

- **Headless core** — `cpu/`, `board/`, `synth/`, `engine/` (the realtime CPU+DAC driver, per-engine state, history rings, scrubber math), and `data/protocol.ts` (the shared `StateSnapshot` + worklet-message contract). Pure logic: **no DOM, no Web Audio, no Node**. The exact same modules run in the Node test suite / WAV CLI *and* inside the AudioWorklet.
- **Browser layer** — `web/` (the `WilliamsSoundHost`, the worklet entry, `main.ts` + its `ui/` controllers, onboarding, the IndexedDB ROM store, the JSON loaders) and `viz/` (the canvas panels). DOM / Web Audio / IndexedDB / fetch live here and **only** here.
- **Node-only** — `node/` (`rom.ts`, `runnerNode.ts`): `node:fs` loaders for the CLI + tests; never bundled into the browser.

**The dependency arrow points one way: browser → core, never the reverse.** The core imports nothing from `web/`, `viz/`, or `node/`. That separation is what lets one engine power both the offline renderer and the live worklet, and keeps the audio thread free of Node-isms.

**It's enforced, not conventional.** `explorer/tsconfig.core.json` compiles the headless layers with `lib: ["ES2022"]` and `types: []` (no DOM, no Node types), run as the second half of `npm run typecheck`. A stray `document` / `fetch` / `import.meta.env` in a core file — or a core→browser import — fails the build. (The concrete file tree + per-module notes live in [`explorer_implementation.md` §Source layout](explorer_implementation.md).)

### Runtime layering — threads

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Layer (browser, main thread)                                │
│  • Game/Sound picker • Speed slider • Step button • Play/Stop   │
│  • Visualization panels (one per concern)                       │
│  • Parameter editor (read-only by default)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MessagePort
┌─────────────────────────▼───────────────────────────────────────┐
│  Visualization Snapshot Store (main thread)                     │
│  • Decimated frames of {dac_byte, ram[$00..$7F], pc, stage_label,│
│    lfsr_state, gwave_state, ...} keyed by cycle count           │
│  • Ring buffer of last N seconds at decimated rate              │
│  • Indexed for scrubbing                                        │
└─────────────────────────▲───────────────────────────────────────┘
                          │ per-N-cycle snapshots
┌─────────────────────────┴───────────────────────────────────────┐
│  AudioWorklet (audio thread, off-main)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  6800/6808 CPU core (cycle-accurate, 894.886 kHz)         │  │
│  │  • Registers: A, B, X, SP, PC, CCR                        │  │
│  │  • Bus: RAM[128B] + ROM[2KB or 4KB] + PIA[4B]            │  │
│  │  • Instruction decoder (~197 single-byte opcodes)         │  │
│  │  • Cycle counter                                          │  │
│  └────────────┬──────────────────────────────────────────────┘  │
│               │ tap STAA $0400 writes                           │
│  ┌────────────▼──────────────────────────────────────────────┐  │
│  │  DAC tap + DacSampler (zero-order-hold resampler)         │  │
│  │  894 kHz CPU clock → 48 kHz Web Audio output              │  │
│  └────────────┬──────────────────────────────────────────────┘  │
│               │                                                 │
│  ┌────────────▼──────────────────────────────────────────────┐  │
│  │  Single-pole biquad LPF (~10 kHz, Q≈0.7)                  │  │
│  │  Optional toggle: "raw DAC" vs "post-LPF"                 │  │
│  └────────────┬──────────────────────────────────────────────┘  │
└───────────────┼─────────────────────────────────────────────────┘
                ▼
         AudioContext.destination → speakers
```

The CPU runs inside the AudioWorklet so audio never glitches. The Worklet posts decimated state snapshots (e.g. every 64 CPU cycles) back to the main thread for visualization. Speed control = "how many CPU cycles per AudioWorklet block" — when slowed to 1/100×, the same number of Worklet blocks consume 1/100 the CPU cycles, so audio plays at 1/100 pitch (acceptable for learning).

## Sound program lifecycle

```
1. User picks game (Defender / Robotron) → load ROM into emulator.
2. User picks sound (by command code 0x00..0x3F, with human-readable name).
3. Emulator does fake "main CPU" PIA write: writes command byte to Port B,
   strobes CA1 → IRQ to the 6808.
4. Emulator runs at chosen speed until either:
   - the sound completes naturally (handler exits to BRA *), or
   - the user sends a new command, or
   - the user presses Stop.
5. Decimated snapshots stream to UI; visualizations animate in lockstep with audio.
```

## Visualization layers (one per primitive)

Each layer renders to its own `<canvas>` and is driven by snapshot data. Layers are independent, can be toggled on/off, and share a time axis (CPU cycle count).

| Layer | Shows | Active when |
|---|---|---|
| **Oscilloscope** | Last N samples of DAC output (8-bit raw + post-LPF overlay) | Always |
| **Spectrum** | FFT magnitude or scrolling spectrogram | Always |
| **Cycle/Stage swimlane** | Horizontal bands of which stage is executing over time | Always |
| **PC trace** | Current program counter, label, source line | Always |
| **RAM heatmap** | 128 bytes as 16×8 grid, brightness = recent write activity | Always |
| **Wavetable view** | LUT bytes as bar chart; current `X` highlighted; original-LUT and decayed-LUT overlaid | When GWAVE active |
| **LFSR register** | 16 bits as glowing cells; tap arrow XORing; output bit highlighted | When any noise routine active |
| **Phase accumulator(s)** | Polar rotation + linear sawtooth for each voice's TIMER/FREQ pair | When SCREAM / PLAY active |
| **VARI state** | Two side-by-side bars (LOPER, HIPER) with deltas; resulting square waveform | When VARI / SP1 / MOSQTO active |
| **FNOISE walk** | DAC value as moving point chasing the target line; slope flicker when DSFLG | When FNOISE / THRUST / CANNON active |
| **Popcount/ORGAN** | 8 oscillator bits + 8 phase counters; popcount LED bar | When ORGAN active |
| **Frequency pattern** | Pattern bytes as step graph; playhead; `FOFSET` offset shown | When GWAVE pattern walking |
| **Envelope/decay** | Original vs working-copy LUT diff; wrap events flashed red | When WVDECA active |

Every visualization receives `{snapshot, prev_snapshot, dt_cycles}` and interpolates between snapshots for smoothness.

## Speed control

Three orthogonal axes the user might want:

1. **Time scale**: how fast the CPU emulator runs relative to the audio thread. 1× = realtime audio. 1/10× = audio pitched down 10× (still listenable, slower). 1/100× = mostly silent but visualizations are 100× slower. Single-step = one CPU instruction per click.
2. **Snapshot decimation**: how often state snapshots are posted to the UI. Default: every 64 cycles. Range: every 1 cycle (deep zoom) to every 1024 (low overhead).
3. **Spectrogram window**: FFT length. 256 (fast) to 4096 (high-resolution).

## UI sketch

```
┌─────────────────────────────────────────────────────────────────┐
│  [Defender ▼] [$01 Heartbeat distorto ▼] [▶ Play] [⏸] [⏭ Step]  │
│  Speed: ━━━━●━━━━━━ 1/10×   Snapshots: every 64 cycles          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────┐ ┌──────────────────────────┐  │
│  │  Oscilloscope (DAC + LPF)    │ │  Spectrogram             │  │
│  │  ╱╲    ╱╲    ╱╲    ╱╲        │ │  ░▒▓█▓▒░                 │  │
│  └──────────────────────────────┘ └──────────────────────────┘  │
│  ┌──────────────────────────────┐ ┌──────────────────────────┐  │
│  │  Wavetable (GS72, len 72)    │ │  LFSR (16-bit Galois)    │  │
│  │  original ▒▒▒▒▒  decayed     │ │  [0011 1100 0000 0000]   │  │
│  │  X →     ●                   │ │  tap: bits 0⊕3           │  │
│  └──────────────────────────────┘ └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Stage swimlane                                          │   │
│  │  [GWLD][WVTRAN][WVDECA][GWAVE inner ─────────────────]   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  RAM (read-only) │ Pattern (HBDSND) │ Source (1158: ...) │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## State you need to track (the snapshot schema)

```typescript
interface Snapshot {
  cpu_cycle:          number;        // absolute since sound start
  pc:                 number;        // 6800 PC
  source_line:        number;        // resolved from PC + .SRC label map
  stage_label:        string;        // human, e.g. "GWAVE inner loop"
  
  regs: { a: number; b: number; x: number; sp: number; ccr: number; };
  
  ram:                Uint8Array;    // 128 B snapshot
  
  // Per-engine derived state (only one is non-null at a time)
  gwave?: {
    wave_index:       number;        // 0..6 (Defender) or 0..10 (Robotron)
    waveform_orig:    Uint8Array;    // ROM
    waveform_curr:    Uint8Array;    // RAM after WVDECA
    sample_index:     number;        // X
    gper:             number;
    pattern_index:    number;
    pattern_bytes:    Uint8Array;
    fofset:           number;
    echo:             number;
  };
  
  lfsr?:              number;        // 16-bit
  lfsr_bit_out?:      0 | 1;
  
  vari?: {
    loper: number; hiper: number;
    lodt: number; hidt: number;
    lomod: number; swpdt: number;
    phase_in_high: boolean;
  };
  
  fnoise?: {
    dac_curr: number; target: number;
    fhi: number; flo: number; fmax: number;
    dsflg: boolean; fdflg: boolean;
  };
  
  scream?: { voices: { freq: number; timer: number; }[]; };
  
  organ?: {
    oscil_mask: number; counter: number;
    popcount: number; current_note: number;
  };
  
  dac_byte:           number;        // most recent value written to $0400
  output_sample:      number;        // post-resampler, post-LPF, [-1, +1]
}
```

## Implementation phases

> Status authority is [`../plans/done/explorer.md`](../../plans/done/explorer.md) (all phases ✅ complete); this lists the phasing as architectural context.

A pragmatic phasing — each phase produces something demoable.

**Phase 1 — silent emulator** *(✅ DONE)* — 6800 CPU core, RAM, ROM, PIA wired through IRQ, offline WAV exporter. Deliverable: an audible `out/defender_11_lite.wav` rendered from the original 1980 ROM bytes.

**Phase 2 — audio out** *(✅ DONE)* — AudioWorklet wrapper, DacSampler (894 kHz → 48 kHz), single-pole biquad, speed presets + pause + single-step + Step→DAC / Step→IRQ + tape-loop scrubber (Pattern 11). Deliverable: live in-browser playback at `localhost:5173`.

**Phase 3 — visualization v0** *(✅ DONE)* — three-panel triangle (Pattern 1), dual-trace oscilloscope, scrolling FFT spectrogram with AC-coupling, DAC byte tape with PC capture (Pattern 2), stage swimlane backed by assembler-derived label map.

**Phase 4 — per-engine introspection** *(✅ DONE)* — all 6 engine slots wired (LFSR / VARI / GWAVE / FNOISE / SCREAM / ORGAN), per-engine canvas views, Pattern 3 freeze toggles, Pattern 8 causal hover trace (spectrogram + byte tape → INSPECT line). Five golden fixtures.

**Phase 5 — Robotron + cross-game** *(✅ DONE)* — Robotron engines wired with per-game zero-page specs, A/B diff (Pattern 6), genealogy view (Pattern 7), per-game label maps (181 / 179 / 364 labels).

**Phase 6 — pedagogy + polish** *(✅ DONE)* — all 12 UX patterns shipped.  Patterns 4 (SCREAM + ORGAN voice-mute Build-up/Tear-down), 5 (parameter-override sliders), 9 (annotated explainer cards — 63 routine cards, source-of-truth `docs/explainer_cards.md`), 10 (listen-then-look quiz), 12 (hide-help toggle).  Plus: RAM heatmap viz, scrub-mode RAM time-travel, ORGANT `$1B` auto-pulse + ORGANN `$1C` 4-byte picker (Defender), MAME ROM-equivalence audit (Stargate + Robotron byte-identical to MAME's bundled dumps; Defender within 2 hand-patched bytes), bulk audio corpus + `tools/refresh_corpus.sh`, MANUAL.md user manual.

Per-phase patterns table is in `docs/pedagogical_design.md` §Implementation priority.

## File layout

The concrete, current source tree (every file + a one-line note) is maintained in
**[`explorer_implementation.md` §Source layout](explorer_implementation.md)** — the home for
implementation state.  The *conceptual* layering (headless core vs browser, the one-way
dependency rule, and the `tsconfig.core.json` enforcement) is in §Layered architecture above.

## Open design questions

1. **Where do the ROM bytes come from?** The `historicalsource/williams-soundroms` repo contains *source*, not *binaries*. You'll need to assemble it (`vasm` or `asm6800`) to produce ROMs — or grab them from MAME (legally complicated). Assembly is the clean path; document it in the project README later.
2. **How do you build the `addr_range → label` map?** From the .SRC file's labels and line numbers. A simple offline script can produce a JSON map at build time.
3. **What's the slow-mode strategy?** Two options: (a) slow audio playback (1/100× pitch), (b) decouple — render audio at 1×, pause it, animate visualizations 100× slower from cached snapshots. (b) is better UX; recommend that.
4. **AudioWorklet support?** Required browser features: AudioWorklet (all evergreens), MessagePort, OfflineAudioContext for full-buffer rendering of selected stretches. Should run on Chrome/Firefox/Safari 14+.

## Cross-references

- The hardware to emulate: `docs/sound_hardware_model.md`
- The primitives to visualize: `docs/synthesis_techniques.md`
- Per-sound parameters: `docs/defender_sound_catalogue.md`, `docs/robotron_sound_catalogue.md`
- Prior-art reference: `docs/sound_studio_reference.md`
- Raw source line numbers for the label-range map: `research/findings_defender_sound.md`, `research/findings_robotron_sound.md`
