# Robotron 2084 — Sound Catalogue

> Every command code the Robotron sound ROM responds to. Robotron uses the same physical board as Defender (see `docs/sound_hardware_model.md`) but **doubles the ROM to 4 KB** and adds substantial new engines (GWAVE wavetable, SCREAM, ORGAN polyphony, CDR crowd-roar, PLAY 3-osc, SING). Full source-line detail: `research/findings_robotron_sound.md`.

The Robotron game CPU sends a **6-bit command** to PIA Port B; the IRQ handler keeps all 6 bits (`ANDA #$3F`) so the **full range $00..$3F is live** — twice as many sounds as Defender. After dispatch:

- `$01..$0D` → GWAVE engine via `SVTAB[0..12]`
- `$0E..$1C` → JMPTBL (15 mixed-engine entries — same labels as Defender)
- `$1D..$1F` → VARI engine via `VVECT[0..2]`
- `$20..$2B` → GWAVE extension via `SVTAB[15..26]` (12 more presets)
- `$2C..$3E` → JMPTB1 (19 specialty routines — PLAY, SING, KNOCK, ZIREN, WHIST, etc.)
- `$3F` → VARI extension (`VVECT[5]` = MOSQTO)

Total: **63 live command codes**, ≈ double Defender. Many `$01..$1F` entries are bit-identical to Defender (CANTB even has the comment "DEFENDER SND #$17").

## Master command table

| Cmd | Engine | Routine | Best-guess name |
|----:|--------|---------|-----------------|
| `$00` | — | (silence) | IRQ tail only |
| `$01` | GWAVE | HBDV | Heartbeat distorto *(Defender-compatible)* |
| `$02` | GWAVE | STDV | Start swell |
| `$03` | GWAVE | DP1V | Sweep blip |
| `$04` | GWAVE | XBV | Bonus climb |
| `$05` | GWAVE | BBSV | Big-Ben |
| `$06` | GWAVE | HBEV | Heartbeat echo |
| `$07` | GWAVE | PROTV | Spinner-protect |
| `$08` | GWAVE | SPNRV | Spinner drip |
| `$09` | GWAVE | CLDWNV | Cool-down |
| `$0A` | GWAVE | SV3 | (test) |
| `$0B` | GWAVE | ED10 | Ed 10 |
| `$0C` | GWAVE | ED12 | Ed 12 |
| `$0D` | GWAVE | ED17 | Ed 17 spinner |
| `$0E` | VARI | SP1 / CABSHK | Spinner #1 (per-trigger pitch) |
| `$0F` | FNOISE | BG1 | Background music start |
| `$10` | — | BG2INC | Wave-urgency ratchet |
| `$11` | LFSR | LITE | Lightning |
| `$12` | GWAVE | BON2 / BONV | Bonus #2 (laser-ball pickup) |
| `$13` | — | BGEND | End background |
| `$14` | LFSR | TURBO | Short noise burst |
| `$15` | LFSR | APPEAR | Enemy-appear descent |
| `$16` | FNOISE | THRUST | Thrust drone |
| `$17` | FNOISE | CANNON | Cannon *(verbatim from Defender)* |
| `$18` | RADIO | RADIO | 16-byte LUT |
| `$19` | HYPER | HYPER | PWM warp |
| `$1A` | SCREAM | SCREAM | **Human death cry** (4-voice additive) |
| `$1B` | ORGAN | ORGANT | Arm/kick tune (Beethoven 9th!) |
| `$1C` | ORGAN | ORGANN | RTS placeholder |
| `$1D` | VARI | SAW | Saw zap |
| `$1E` | VARI | FOSHIT | Foe-hit |
| `$1F` | VARI | QUASAR | Quasar |
| `$20` | GWAVE | HUNV | **100-point rescue jingle** |
| `$21` | GWAVE | SPD | Speedy variant |
| `$22` | GWAVE | SPNV | Spinner alt |
| `$23` | GWAVE | STRT | Start (YUKSND) |
| `$24` | GWAVE | SP1V | Spinner-1 (SP2SND) |
| `$25` | GWAVE | SSPV | Sub-spinner |
| `$26` | GWAVE | BMPV | Bump (BWS) |
| `$27` | GWAVE | WIRDV | Weirdo / electrode |
| `$28` | GWAVE | GDYUKV | **Family-rescue jingle** ("good yuk") |
| `$29` | GWAVE | BK8 | Back-8 cool-down |
| `$2A` | GWAVE | SF10 | S/F 10 |
| `$2B` | GWAVE | BIL30 | Bill 30 |
| `$2C` | PLAY | SND2 | 3-osc preset VEC02 |
| `$2D` | PLAY | SND5 | 3-osc preset VEC05 |
| `$2E` | PLAY | THNDR | "Thunder" 3-osc |
| `$2F` | SING | HSTD | Sing VEC08X + echoes |
| `$30` | SING | ATARI | Sing VEC02X |
| `$31` | SING | SIREN | Sing VEC03X→VEC04X looped |
| `$32` | SING | ORRRR | Sing VEC05X |
| `$33` | SING | PERK$$ | Sing VEC06X + ECHO |
| `$34` | SING | SQRT | Random-freq sing — zap |
| `$35` | — | START | "Electric" buzzy drone |
| `$36` | square | PLANE | Diving plane (incrementing FREQ1) |
| `$37` | PLAY | SND16 | 3-osc preset VEC016 |
| `$38` | PLAY | SND17 | 3-osc preset VEC017 |
| `$39` | LFSR | LAUNCH | Launch sweep |
| `$3A` | CDR | CDR | **Crowd roar** (dual noise + whistle) |
| `$3B` | KNOCK | KNOCK | KNKTAB-driven thud |
| `$3C` | ZIREN | ZIREN | Air-raid siren |
| `$3D` | WHIST | WHIST | "OOOOH NOOOO" falling sine |
| `$3E` | FNOISE | HBOMB | H-bomb noise |
| `$3F` | VARI | MOSQTO | Mosquito high tone |

## What's new in Robotron vs Defender

Twelve substantial additions:

1. **GWAVE wavetable engine** as the dominant engine — 27 presets in `SVTAB` (Defender has 14).
2. **High-resolution 72-byte sine** (`GS72`) and **biased 72-byte sine** (`HBPAT2`) — warmer musical timbres.
3. **New ORGAN tunes** — the ORGAN engine (bitfield-popcount polyphony, up to 8 voices from one byte) is *not* new: Defender already has it (`$1B` ORGANT / `$1C` ORGANN, playing PHANTOM / TACCATA). Robotron's addition is the tune table — most famously **Beethoven's 9th** as the wave-start jingle.
4. **Two parallel background slots** (BG1 = drone, BG2 = wave-urgency turbine) — Defender has one.
5. **SCREAM** — 4-voice additive death cry. Originally in Defender but Robotron's version adds the seed-detune on voice spawn for the swarm-of-echoes effect.
6. **CDR (Crowd Roar)** — sequenced noise+whistle engine with a small parameter DSL. Most elaborate routine in either ROM.
7. **B2 / laser-ball bonus** mechanic with B2FLG gating.
8. **Stack-unwind ECHO trick** — `PULA / PULA / RTS` escapes two nested calls without flag check.
9. **PLAY (3-osc)** engine — three square voices + one LFSR-noise channel, summed. Used for "thunder" and the SND2/5/16/17 family.
10. **SING (single-osc)** — square with separately swept frequency and inverting amplitude. Used for "ATARI", "SIREN", "ORRRR", "PERK", "SQRT".
11. **Specialty routines** — PLANE (descending square), ZIREN (second-order glissando), WHIST (falling sine), KNOCK (sequenced thud), LAUNCH (LFSR sweep).
12. **CANNON is byte-identical to Defender's** — the `CANTB FCB 1,0,1,$FF,3,$E8` parameter table has the comment `; DEFENDER SND #$17` at line 1158.

## No PCM / no speech

The arcade Robotron sound ROM is **purely algorithmic**. The largest "sample-like" object in the ROM is the 72-byte `HBPAT2` waveform — used by GWAVE with a per-sample timing delay, not streamed. There's no continuous-DAC playback loop, no `LDX #sample_start / loop: STA $0400 / INX / CPX #end / BNE loop` pattern.

The voice samples some players remember ("robotron!", "humanoid") come from **home ports** (Atari 7800, the post-2000 "Robotron: 2084" anthologies), not the original arcade. Williams' speech daughterboard (HC55516 CVSD) is supported on the connector but Robotron does not use it.

## GWAVE preset details (the headline engine)

Each is one row of `SVTAB` (7 bytes). Format identical to Defender (see `docs/defender_sound_catalogue.md`).

| Idx | Preset | Cmd | Wave | Echo | Pattern | Slide | Character |
|----:|--------|----:|------|-----:|---------|------:|-----------|
|  0 | HBDV  | $01 | GSQ22 | 8 | HBDSND | 0 | thumping heart *(Defender-compatible)* |
|  1 | STDV  | $02 | GS72 | 1 | STDSND swell | -1 | rising start |
|  2 | DP1V  | $03 | GS72 | 1 | 1-byte | +15 | blip |
|  3 | XBV   | $04 | GSSQ2 | 1 | SPNSND | +1 | climbing square |
|  4 | BBSV  | $05 | GS1 | 15 | BBSND | 0 | bell |
|  5 | HBEV  | $06 | GS72 | 4 | HBESND | 0 | soft heart |
|  6 | PROTV | $07 | GS72 | 2 | SPNSND | -1 | descending |
|  7 | SPNRV | $08 | GS2 | 1 | $40 | -3 | drip |
|  8 | CLDWNV| $09 | GSSQ2 | 3 | 3-step | +1 | cool-down |
|  9 | SV3   | $0A | GS72 | 0 | BBSND | +1 | brief |
| 10 | ED10  | $0B | GS12 | 15 | ED10FP | 0 | exp |
| 11 | ED12  | $0C | GS2 | 6 | ED13FP | 0 | exp |
| 12 | ED17  | $0D | GS1 | 1 | SPNR ×4 | -1 | exp |
| 13 | BONV  | $12 | GSSQ2 | 3 | BONSND | -1 | bonus chirp |
| 14 | TRBV  | (BG2) | GS1.7 | 1 | TRBPAT | -1 | turbine spool-up |
| **15** | **HUNV** | **$20** | (GS72) | (multi) | YUKSND | (sweep) | **100-pt rescue** |
| 16 | SPD   | $21 | (varies) | | | | speedy variant |
| 17 | SPNV  | $22 | (varies) | | | | spinner alt |
| 18 | STRT  | $23 | (varies) | | YUKSND | | start jingle |
| 19 | SP1V  | $24 | (varies) | | SP2SND | | spinner-1 |
| 20 | SSPV  | $25 | (varies) | | SSPSND | | sub-spinner |
| 21 | BMPV  | $26 | (varies) | | BWSSND | | bump |
| 22 | WIRDV | $27 | (varies) | | | | "weirdo" / electrode |
| 23 | GDYUKV| $28 | (varies) | | YUKSND | | **family rescue** |
| 24 | BK8   | $29 | (varies) | | | | back-8 cool-down |
| 25 | SF10  | $2A | (varies) | | | | start-distorto reuse |
| 26 | BIL30 | $2B | (varies) | | | | bill 30 |

For exact byte-by-byte parameter dumps of presets 15–26, see `research/findings_robotron_sound.md` §1 (SVTAB at file lines 1992–2020).

## ORGAN tunes (Robotron's signature)

Stored in `ORGTAB` (file lines 1881–1937):

| Tune | Name | Notes | Tempo |
|---:|---|---:|---|
| 1 | **FIFTH** | 8 (7×G2 + 1×EF1) | tempo divisor `FIF=6` |
| 2 | **NINTH** | ~40 — Beethoven's 9th theme | tempo divisor `NIN=5` |

The 9th plays at the start of every wave — *the* Robotron auditory signature. Each note is `(osc_mask, delay, duration_hi, duration_lo)` = 4 bytes. The popcount-polyphony technique means up to 8 voices play simultaneously from a single byte (see `docs/synthesis_techniques.md` §8).

**Why `$1B` doesn't play on a single fire** — and how the explorer makes it.  `ORGANT` is `DEC ORGFLG / RTS`; the tune plays inside the *next* IRQ which reads its command byte as the tune index.  Without a follow-up the CPU spins forever at `BEQ *` in IRQ3.  The explorer's `fireUserCmd()` auto-pulses `$01` (= FIFTH) 40 ms after every `$1B` arm; the arm-form picker that appears below the Cmd field lets you switch to NINTH.  Full pedagogical write-up: [MANUAL.md "Why $1B is special"](../../MANUAL.md#why-1b-organt-is-special).  `$1C` ORGANN is a `RTS` placeholder on Robotron — silent regardless of follow-ups.

## VARI presets

| Idx | Name | Cmd | LOPER | HIPER | Character |
|----:|------|----:|------:|------:|-----------|
| 0 | SAW    | $1D | $40 | $01 | descending saw |
| 1 | FOSHIT | $1E | $28 | $01 | foe-hit |
| 2 | QUASAR | $1F | $28 | $81 | reverse zap |
| 3 | CABSHK | (via SP1) | $FF | $01 | spinner pitch base |
| 4 | CSCALE | (internal) | | | scale |
| 5 | MOSQTO | $3F | (high) | (low) | mosquito |
| 6 | VARBG1 | (BG1 poll) | | | drone modulator |

## CDR (Crowd Roar) parameter recipe

CDR is essentially a small sound-script DSL. Its `WS1` table at file line 928 holds 8-step whistle sequences; each step is 5 bytes `(WHIS, WFRQ2, DFRQ2, WCNT2, MINWIS)` and the engine cycles through until a 0 terminator. Combined with two parallel noise oscillators (CR1, CR2 at file 937–938), it produces the "stadium roar with sliding referee whistle" effect.

The WIN main loop (file 1053–1066) calls TRIDR seven times per audio sample interleaved with noise updates — sample rate ~235 cy → ~3.8 kHz. Output: layered roar + whistle, both shifting over time.

## SING & PLAY engines

Both are square-wave engines with envelopes. Differences:

- **SING** = 1 voice, ~5–17 kHz sample rate, hand-tuned sync NOPs (file 681–685, 702–704, 712, 715). Used by: HSTD, ATARI, SIREN, ORRRR, PERK$$, SQRT.
- **PLAY** = 3 voices + 1 LFSR-noise voice, mixed. Per-voice envelope and pitch sweep. Used by: SND2, SND5, THNDR, SND16, SND17.

Both are loaded by copying 28-byte (PLAY) or 6-byte (SING) parameter blocks from ROM `VECnnX` tables.

## Notable trick: `KNOCK` overrides the PIA

KNOCK (`$3B`, file 500–541) writes `CLR SOUND+2` at entry — clobbering the PIA control register to bypass the normal data-write path — then walks through a parameter table KNKTAB. At exit it restores `STAA SOUND+2 / #$80`. This is the only routine that touches the PIA directly during sound output.

## Cross-references

- Full source-line catalogue with file:line cites: `research/findings_robotron_sound.md`
- Synthesis primitives explained: `docs/synthesis_techniques.md`
- Hardware: `docs/sound_hardware_model.md`
- Defender catalogue for comparison: `docs/defender_sound_catalogue.md`
