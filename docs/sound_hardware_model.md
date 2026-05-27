# Williams Sound Hardware Model

> Consolidated, citation-checked reference for the **Williams 6802 sound board** used by Defender, Stargate, Robotron and Joust (1980–1982). This is the model your browser explorer must implement. Source: `research/findings_hardware_extra.md` + the .SRC headers in `research/williams-soundroms/`.

## TL;DR — the entire model in eight numbers

| | |
|---|---|
| Sound CPU | **MC6808** (or MC6802, software-compatible) |
| Crystal | **3.579545 MHz** (NTSC colourburst) |
| Bus / instruction clock | **894.886 kHz** (crystal /4 inside the CPU) |
| RAM | **128 B** at `$0000–$007F` (internal to the 6802/6808) |
| ROM | **2 KB** at `$F800–$FFFF` (Defender / Stargate) **or 4 KB** at `$F000–$FFFF` (Robotron / Joust) |
| Command input | **6 bits** at PIA Port B `$0402` |
| DAC | **MC1408**, 8-bit, current-out, at PIA Port A `$0400` |
| Reconstruction filter | single-pole ~10–30 kHz (1458 op-amp I-to-V) |

There is **no hardware sample-rate divider**, **no priority table**, **no second voice**. Every sample is hand-written by the CPU at whatever loop rate the routine achieves. Sample rates vary per sound from ≈1.5 kHz (slow VARI/SING sweeps) to ≈30 kHz (tight LFSR loops). Typical: 5–25 kHz.

## Block diagram

```
    Main CPU side                       Sound board (own CPU, own ROM, own RAM)
    ─────────────                       ────────────────────────────────────
                                          ┌──────────────────────────────────┐
                                          │                                  │
     STAA $CC02     ────► PIA #1 port B ──┼──► PIA $0400-3                   │
     (6 bits)            (main board)     │     port B  (6-bit cmd in)       │
                                          │     CA1     ▲ (IRQ on rising)    │
                                          │             │                    │
                                          │            ┌┴────────┐           │
                                          │            │ MC6808  │           │
                                          │            │ 894 kHz │           │
                                          │            │ 128 B RAM│          │
                                          │            │ 2/4 KB ROM         │
                                          │            └────┬────┘           │
                                          │                 │ STAA $0400     │
                                          │     port A      ▼ (8 bits)       │
                                          │     ── 8 bits ──► MC1408 DAC     │
                                          │                       │          │
                                          │                       ▼          │
                                          │                   1458 op-amp    │
                                          │                       │          │
                                          │                       ▼          │
                                          │                  ~10 kHz LPF     │
                                          │                       │          │
                                          └───────────────────────┼──────────┘
                                                                  ▼
                                                              amplifier
                                                                  │
                                                                  ▼
                                                              speaker
```

## Memory map

| Range | Defender / Stargate | Robotron / Joust |
|---|---|---|
| `$0000–$007F` | RAM (128 B, internal to CPU) | RAM (128 B, internal) |
| `$0080–$00FF` | (unmapped) | **RAM (MC6810 chip, 128 B external)** |
| `$0400–$0403` | PIA (DAC + command) | PIA (DAC + command) |
| `$8400–$8403` | PIA mirror | PIA mirror |
| `$F800–$FFFF` | 2 KB program ROM | (extends down) |
| `$F000–$FFFF` | — | **4 KB program ROM** |
| `$FFF8/9` | IRQ vector | IRQ vector |
| `$FFFA/B` | SWI | SWI |
| `$FFFC/D` | NMI | NMI |
| `$FFFE/F` | Reset | Reset |

The 6802/6808 has only the IRQ vector wired meaningfully. NMI is reserved for the on-board diagnostic switch (see notes in both Defender's `NMI` and Robotron's `NMI` handlers).

## The command path (the only thing the main CPU does)

1. Main game CPU (6809) writes a 6-bit value (bits 0..5) to its PIA at `$CC02` (port B).
2. CA2 strobes; the latched byte appears at the sound board's PIA Port B (`$0402`), inverted by inversion buffers.
3. Rising CA1 on the sound-board PIA pulls **/IRQ** low on the 6808.
4. 6808's IRQ handler reads `$0402`, inverts (`COMA`), masks (`ANDA #$1F` or `#$3F`), and uses the value as a dispatch index.
5. Handler synthesises samples and writes them to `$0400` until the routine completes or a new IRQ pre-empts.

**No priority table, no queue, no scheduler.** New commands always win — the IRQ handler often `JMP`s into the new sound rather than `RTI`ing, discarding the previous sound's stack frame entirely. Command `$00` is conventionally silence.

End-to-end latency from `STAA $CC02` to first DAC sample of new sound: **~45–55 µs** (instruction-finish + IRQ stacking + dispatch + first DAC write). Well below one video frame.

## The DAC and the analog tail

- **MC1408** is an 8-bit *current-output* DAC. Its internal R-2R ladder converts the byte to a proportional current.
- A **1458 dual op-amp** (typical Williams configuration: -12 V / +5 V supplies) converts current to voltage and provides the dominant LPF pole via the feedback capacitor.
- The reconstruction filter is **single-pole, soft**, ≈10–30 kHz. Not a brick-wall — DAC stair-step alias bleeds through. This is part of the characteristic Defender / Robotron grit.

MAME does **not** model the post-DAC filter (no `FILTER_RC` or netlist), suggesting raw 8-bit playback is close enough to authentic. For an explorer that wants to sound "right", add a single-pole biquad at ~10 kHz, Q ≈ 0.7, after the resampler.

## Variations across the Williams library

| Item | Defender / Stargate ("early" sound board) | Robotron / Joust / Splat / Sinistar / Blaster ("late") |
|---|---|---|
| Board P/N | 1C-2001-137-4 (D-8121) | 1C-2001-146-6 (D-8224) |
| ROM | 2 KB (2716/2516) | 4 KB (2532) |
| External RAM | none | MC6810 at `$0080–$00FF` |
| CPU / Crystal / DAC / Filter | identical | identical |

The CVSD speech daughterboard (HC55516 + separate 6808) is **separate** and is used by Sinistar and Joust, **not** by Defender or Robotron. The famous "robotron!" / "humanoid" voice samples remembered from some Robotron home ports are **not** in the arcade ROM — Robotron 2084 has no digitised speech. (See `research/findings_robotron_sound.md` §6.)

## The 6800 / 6802 / 6808 ISA — what your emulator needs

The Williams sound ROMs are plain MC6800 assembly. 6802 and 6808 add no instructions, just integrate clock + 128 B RAM. About 197 single-byte opcodes (72 mnemonics).

Hot-path instructions to get right:
- `STAA $0400` — the DAC write. The only side-effect that produces sound.
- `LSR/ROR` — heavy use for both the LFSR and the GWAVE wave-decay loops. Carry-flag round-trip must be exact.
- `INX/DEX/CPX` — index-register loops are most of the inner-loop timing.
- `BNE/BMI/BPL/BCS` — branch cycle counts on the 6800 are uniform (4 cyc) regardless of taken/not-taken, simplifying timing emulation vs. 6502.
- `WAI` / NMI — used only in the diagnostic-mode path; can be ignored.

`DAA` is unused by Defender; safe to stub. There is no `DEY`/`INY` because there is no Y register on the 6800.

References:
- 6800 ISA table: <https://www.8bit-era.cz/6800.html>
- Datasheet: <https://datasheets.chipdb.org/Motorola/6800/mc6800_userman.pdf>
- MAME 6800 core: `src/devices/cpu/m6800/m6800.cpp`

## Choosing your sample-generation strategy

The hardware writes 1 byte per inner loop, so the "DAC sample rate" varies with the per-sound inner loop length. Three strategies:

1. **Cycle-accurate 6808 emulator + write capture.** Emulate the CPU at 894.886 kHz, log every `STAA $0400` with its CPU-cycle timestamp, resample to 48 kHz with zero-order-hold + single-pole LPF. Bit-accurate for both Defender (2 KB) and Robotron (4 KB) ROMs with no per-sound porting. **Recommended.**
2. **Hand-port each routine to JS** (Defender Sound Studio's approach). Faithful, simple, but only Defender done so far. Each Robotron routine has to be ported manually.
3. **Hybrid:** emulator for execution, but inject per-routine "what state are we in?" labels by tracking PC against label ranges from the .SRC files. Gives you cheap, accurate emulation **and** visualizable per-stage state.

Strategy 3 is what the explorer should build toward.

## Cross-references

- Raw hardware deep-dive: `research/findings_hardware_extra.md`
- Defender ROM facts at the source level: `research/findings_defender_sound.md` §0
- Robotron ROM facts at the source level: `research/findings_robotron_sound.md`, top
- The existing `defender_hardware_and_programming.md` covers the **main** Defender CPU side, not the sound board specifically — there is no overlap.
