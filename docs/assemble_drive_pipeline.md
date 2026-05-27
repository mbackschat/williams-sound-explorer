# Assemble + Drive Pipeline — Path B for Reference Audio

> Concrete build plan for producing the canonical reference-audio corpus (Defender / Stargate / Robotron, every command code). This is **Path B** from `docs/reference_audio_plan.md` — the path the user picked. Doubles as **Phase 1** of `docs/explorer_architecture.md` (the 6800 emulator the browser explorer also needs).

## Goal

Produce ~128 named WAV files — one per dispatched command code per game — captured from a cycle-accurate 6800 emulator running the assembled-from-source sound ROMs, with no game CPU and no MAME involved.

Output:
```
reference_audio/
├── defender/  01_heartbeat_distorto.wav … 1F_quasar.wav    (~31 files)
├── stargate/  01_… … XX_…                                    (~varies, TBD)
└── robotron/  01_heartbeat.wav … 3F_mosquito.wav            (~63 files)
```

Quality: 48 kHz, 16-bit mono PCM. Source-of-truth-clean — no game audio mixed in, no aliasing, post-LPF.

## Pipeline at a glance

```
   ┌──────────────────────────┐
   │ VSNDRM1.SRC (Defender)   │
   │ VSNDRM2.SRC (Stargate)   │
   │ VSNDRM3.SRC (Robotron)   │
   └────────────┬─────────────┘
                │ assembler (asm6800 or vasm_oldstyle)
                ▼
   ┌──────────────────────────┐
   │ defender_sound.bin   2KB │
   │ stargate_sound.bin   2KB │
   │ robotron_sound.bin   4KB │
   └────────────┬─────────────┘
                │
                ▼
   ┌──────────────────────────────────────────────────────────┐
   │ 6800 emulator (TypeScript)                               │
   │  • Cycle-accurate at 894.886 kHz                         │
   │  • RAM[128B] (+ MC6810 ext for Robotron) + ROM + PIA stub│
   │  • Captures every STAA $0400 with cycle timestamp        │
   └────────────┬─────────────────────────────────────────────┘
                │
                ▼
   ┌──────────────────────────────────────────────────────────┐
   │ Driver script (Node)                                     │
   │  • For game in {defender, stargate, robotron}:           │
   │      for cmd in 0x00..0x3F (or 0x1F):                    │
   │          load ROM, reset CPU                             │
   │          write cmd to PIA Port B, strobe CA1 → IRQ       │
   │          run until silence-or-timeout (≤ 5 s)            │
   │          dump DAC byte stream → resampler → LPF → WAV    │
   └────────────┬─────────────────────────────────────────────┘
                │
                ▼
   ┌──────────────────────────┐
   │ reference_audio/*/*.wav  │
   │ + metadata.json          │
   └──────────────────────────┘
```

## Component design

### 1. The assembler

The `.SRC` files are **Motorola-syntax 6800 assembly** (FCB / FDB / EQU / ORG conventions). Three candidate tools:

| Tool | Notes | Recommendation |
|---|---|---|
| **vasm (oldstyle syntax mode)** | Active, cross-platform, handles 6800 with `-mcpu=6800`. Available via Homebrew (`brew install vasm`) or build from source at <http://sun.hasenbraten.de/vasm/>. | **Pick this.** Most maintained. |
| `asm6800` (jhallen/exorsim) | Small, focused. C source; build once. | Backup if vasm choking on Williams syntax. |
| `as6 / as6800` (MAME's internal) | Bundled with some MAME forks. | Avoid — drags MAME build chain. |

Williams' code uses some Motorola-specific quirks (`!>` for right-shift, `FCB` / `FDB`, `EQU *` for "current address"). vasm handles all of these with `-Fbin -dotdir`.

**Build command** (per game):
```bash
vasm6800_oldstyle -Fbin -dotdir -o defender_sound.bin VSNDRM1.SRC
vasm6800_oldstyle -Fbin -dotdir -o stargate_sound.bin VSNDRM2.SRC
vasm6800_oldstyle -Fbin -dotdir -o robotron_sound.bin VSNDRM3.SRC
```

Expected output sizes: 2048, 2048, 4096 bytes (matching the original ROM chips).

### 2. The 6800 emulator (TypeScript)

This is the heart of both the audio pipeline *and* the browser explorer. Write it once, use it twice.

Module shape:

```
src/cpu/
├── m6800.ts          # CPU class — registers, fetch/decode/execute, cycle counter
├── instructions.ts   # opcode table — one function per opcode, returns cycles
├── flags.ts          # CCR helpers (H I N Z V C bits + math helpers)
└── tests/
    └── m6800.test.ts # opcode-level tests against a published golden trace
```

Key choices:

- **Cycle-accurate per-instruction**, not per-bus-cycle. The Williams sound ROMs only need PIA writes to be observed at the right cycle counts; sub-instruction bus timing isn't relevant.
- **`cycles_consumed` returned by each opcode function**. The emulator's `step()` returns the cycle count; the bus's `STAA $0400` write is recorded at `cpu.cycle_count` after the opcode completes.
- **PIA model is a stub**: write to `$0400` → emit a `dac_write(cycle, value)` event. Write to `$0402` → invoke the IRQ handler (set IRQ-pending flag, vector through `$FFF8`). No real 6821 emulation needed.
- **128 B internal RAM at `$0000–$007F`** (all games). **Plus** 128 B external at `$0080–$00FF` for Robotron only (handled by the bus map per game).
- **No NMI / SWI / WAI** in the audio pipeline — Williams sound code uses NMI for diagnostics only. Stub them.

LOC estimate:
- m6800.ts: ~200
- instructions.ts: ~400 (one entry per opcode, mostly small)
- flags.ts: ~80
- tests: ~150
- Total: **~830 LOC** of core, ~1 day of focused work.

### 3. The DAC byte capture + resampler

The CPU runs at 894.886 kHz. The output WAV needs to be at 48 kHz. Resampling strategy: **zero-order hold** (same as `DacSampler` in Defender Sound Studio).

```typescript
class DacCapture {
  private samples: number[] = [];   // 0..255 bytes captured
  private lastValue = 0x80;         // DAC idles at midpoint
  private lastCycle = 0;
  
  constructor(private inputRate = 894886, private outputRate = 48000) {}
  
  // Called by the bus whenever STAA $0400 fires
  onWrite(cycle: number, value: number) {
    // Emit zero-order-hold samples up to this cycle
    const samplesToEmit = Math.floor(
      (cycle - this.lastCycle) * this.outputRate / this.inputRate
    );
    for (let i = 0; i < samplesToEmit; i++) this.samples.push(this.lastValue);
    this.lastCycle += samplesToEmit * this.inputRate / this.outputRate;
    this.lastValue = value;
  }
  
  finalize(totalCycles: number): Float32Array {
    this.onWrite(totalCycles, this.lastValue);  // flush tail
    return new Float32Array(this.samples.map(b => (b - 128) / 127));
  }
}
```

After capture, apply a **single-pole biquad LPF** at ~10 kHz, Q=0.7 (matching the cabinet's 1458 op-amp roll-off — see `docs/sound_hardware_model.md`).

### 4. The driver script

```typescript
// src/tools/dump_reference_audio.ts (sketch)
import { M6800 } from '../cpu/m6800';
import { DacCapture } from '../synth/DacCapture';
import { lpf, writeWav } from '../util';
import * as fs from 'fs';
import * as path from 'path';

const GAMES = [
  { name: 'defender', rom: 'defender_sound.bin', romOrg: 0xF800, ramExt: false, range: 0x1F },
  { name: 'stargate', rom: 'stargate_sound.bin', romOrg: 0xF800, ramExt: false, range: 0x1F },
  { name: 'robotron', rom: 'robotron_sound.bin', romOrg: 0xF000, ramExt: true,  range: 0x3F },
];

const TIMEOUT_CYCLES = 894886 * 5;     // 5-second cap per sound
const SILENCE_CYCLES = 894886 * 0.3;   // 300 ms of no DAC writes = sound finished

for (const game of GAMES) {
  for (let cmd = 1; cmd <= game.range; cmd++) {
    const cpu = new M6800();
    cpu.loadRom(fs.readFileSync(`build/${game.rom}`), game.romOrg);
    if (game.ramExt) cpu.enableExtRam();
    cpu.reset();                       // runs SETUP, ends at "BRA *"
    cpu.runUntilIdle();                // idle = same-PC for 16 cycles
    
    const capture = new DacCapture();
    cpu.onDacWrite = (c, v) => capture.onWrite(c, v);
    
    // Simulate a main-CPU PIA write: byte at $0402, then CA1 strobe → IRQ
    cpu.writePIA(0x0402, cmd);
    cpu.triggerIRQ();
    
    // Run until silence-or-timeout
    let lastWriteCycle = cpu.cycle_count;
    while (cpu.cycle_count < TIMEOUT_CYCLES) {
      cpu.step();
      if (cpu.cycle_count - capture.lastWriteCycle > SILENCE_CYCLES) break;
    }
    
    const raw = capture.finalize(cpu.cycle_count);
    const filtered = lpf(raw, 48000, 10000, 0.7);
    const name = lookupName(game.name, cmd);   // from docs/*_sound_catalogue.md
    const filename = `${cmd.toString(16).padStart(2, '0').toUpperCase()}_${name}.wav`;
    writeWav(path.join('reference_audio', game.name, filename), filtered, 48000);
  }
}
```

**Edge cases:**
- Sounds that loop forever (`BG1` background drone, organ tunes): TIMEOUT_CYCLES caps them at 5 seconds. Acceptable for a reference clip.
- Sounds that need a second-command "stop" (BGEND `$13`): driver triggers $0F (start), records 3 s, then sends $13.
- Multi-byte arming sounds (Defender's `ORGANT` at `$1B` followed by tune number; `ORGANN` at `$1C` followed by 3 bytes): driver writes the additional bytes after the initial IRQ. Catalogue tells which.

### 5. Naming lookup

The hex-code → human-name mapping already exists in the catalogue docs. Extract once into a JSON for the driver:

```json
{
  "defender": {
    "01": "heartbeat_distorto",
    "02": "start_swell",
    ...
    "1A": "scream",
    "1D": "saw"
  },
  "stargate": { ... },   // pending Stargate catalogue
  "robotron": { ... }
}
```

This file can be generated by a small parser run against the `.md` catalogues.

## Build order

1. **Install vasm**, assemble all three `.SRC` files, verify byte sizes (2048, 2048, 4096).
2. **Write & test the 6800 emulator** (`src/cpu/`). Validate against a published golden opcode trace (e.g., from the 6800 datasheet or a unit-tested C reference). Run ~50 opcode-level unit tests.
3. **Bus + PIA stub**. Memory map per game. `dac_write` event emitter.
4. **DacCapture + LPF + writeWav**. Validate by emitting a 1 kHz square wave and checking the WAV header + spectrum.
5. **Driver script**. Loop once per game per command. Output filenames from a static `names.json`.
6. **Listen-test**. Compare a few outputs to YouTube reference recordings. Iterate on LPF cutoff if needed.

## Effort breakdown

| Component | Estimate |
|---|---|
| Install vasm + assemble three ROMs | 30 min (best case) — 4 h (if assembler chokes on Williams syntax and we need to write patches) |
| 6800 emulator core + opcode table | 1 day |
| Tests vs golden traces | half day |
| Bus + PIA stub | 2 h |
| DacCapture + LPF | 2 h |
| Driver script | 2 h |
| Listen-test + tuning | half day |
| **Total** | **~3 working days** |

## Risks

1. **Assembler compatibility**. Williams used Motorola's own AS68 / similar; the `.SRC` files have idioms (`!>1` for shift, label-prefixed comments, `EQU *`) that might not all map cleanly. Mitigation: if vasm fails, try `asm6800` from jhallen/exorsim. If both fail, hand-port the syntax.
2. **Sound completion detection**. Some routines never return — the original board relies on a new IRQ to terminate. The 300 ms silence + 5 s timeout heuristic catches most cases; verify with each game.
3. **PIA semantics**. The Williams sound ROM does configure the PIA in setup (CRA, CRB) and waits in `BRA *`. Make sure the stub responds plausibly to those configuration writes (no-op is fine, but document it).
4. **Robotron's MC6810**. External RAM at `$0080-$00FF` — easy to wire, easy to forget. Per-game bus map per `docs/sound_hardware_model.md`.

## Side effects (free wins from doing this)

Once Path B is built:
- ✅ Reference WAV corpus (the immediate goal).
- ✅ Phase 1 of the explorer is done (the 6800 emulator the browser app needs).
- ✅ A regression-test harness: any future emulator change can `diff` against the canonical WAVs.
- ✅ Bytes for a JS/WASM-bundled ROM-binary asset — the browser app can ship the assembled ROMs alongside the emulator instead of requiring users to bring their own.
- ✅ A reference data point for verifying the catalogue docs: any "we think this command does X" claim becomes auditable by listening to the WAV.

## Cross-references

- The audio strategy menu this is "Path B" within: `docs/reference_audio_plan.md`
- The wider explorer this becomes Phase 1 of: `docs/explorer_architecture.md`
- The hardware model the emulator implements: `docs/sound_hardware_model.md`
- The per-sound expectations to validate output against: `docs/defender_sound_catalogue.md`, `docs/robotron_sound_catalogue.md`, (forthcoming) `docs/stargate_sound_catalogue.md`
- Where the assembled ROM bytes will live: TBD (`build/` if at the repo root; or `src/data/` if bundled with the explorer)
