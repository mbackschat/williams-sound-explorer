# Defender — Sound Catalogue

> Every command code the Defender 6802 sound ROM responds to, mapped to a synthesis engine, a human name, and the parameters that shape it. Pair with `docs/synthesis_techniques.md` for what the engines actually do. Full source-line details: `research/findings_defender_sound.md`.

The Defender game CPU sends a **6-bit command** (so values 0..63), but the IRQ handler masks to 5 bits: only `$00..$1F` are live. After a `DECA` step, the dispatcher routes to one of three regions:

- `$01..$0D` → GWAVE engine via `SVTAB` (13 wavetable presets)
- `$0E..$1C` → JMPTBL (15 entries, mixed engines)
- `$1D..$1F` → VARI engine via `VVECT` (3 variable-duty-square presets)

Total: **31 live command codes**.

## Master command table

| Cmd | Engine | Routine | Human name | Notes |
|----:|--------|---------|------------|-------|
| `$00` | — | (silence) | NOP | IRQ tail polls background |
| `$01` | GWAVE | HBDV | Heartbeat distorto | iconic low pulse |
| `$02` | GWAVE | STDV | Start fanfare swell | rising-then-falling sine |
| `$03` | GWAVE | DP1V | Sweep blip | 1-byte pattern + +1 slide |
| `$04` | GWAVE | XBV | Extra-bonus climb | square slide |
| `$05` | GWAVE | BBSV | Big-Ben chime | 15 echoes, sine bell |
| `$06` | GWAVE | HBEV | Heartbeat echo | 4-echo softer variant |
| `$07` | GWAVE | PROTV | Protector death | descending sine |
| `$08` | GWAVE | SPNRV | Spinner drip | single $40 period, 5 cyc |
| `$09` | GWAVE | CLDWNV | Cool-down chirp | 3-echo |
| `$0A` | GWAVE | SV3 | (test/effect) | rarely used |
| `$0B` | GWAVE | ED10 | Ed sound 10 | experimental |
| `$0C` | GWAVE | ED12 | Ed sound 12 | experimental |
| `$0D` | GWAVE | ED17 | Ed sound 17 | experimental spinner |
| `$0E` | VARI | SP1 / CABSHK | Spinner #1 | per-trigger pitch advance |
| `$0F` | FNOISE | BG1 | Background 1 start | persistent drone |
| `$10` | — | BG2INC | Background 2 advance | ratchet pitch up |
| `$11` | LFSR | LITE | Lightning | upward LFSR sweep |
| `$12` | GWAVE | BON2 / BONV | Bonus #2 | re-trigger optimised |
| `$13` | — | BGEND | End background | silences BG1/BG2 |
| `$14` | LFSR | TURBO | Turbo noise burst | bright fading |
| `$15` | LFSR | APPEAR | Enemy appear | falling LFSR |
| `$16` | FNOISE | THRUST | Thrust drone | gentle slope |
| `$17` | FNOISE | CANNON | Cannon | distorted, decaying |
| `$18` | RADIO | RADIO | Radio chatter | 16-byte LUT |
| `$19` | HYPER | HYPER | Hyperspace warp | PWM sweep |
| `$1A` | SCREAM | SCREAM | Death scream | 4-voice additive |
| `$1B` | ORGAN | ORGANT | Organ tune (arm) | next byte = tune #; see *Arm-only commands* below |
| `$1C` | ORGAN | ORGANN | Organ note (arm) | next 3 bytes = osc/dly/note; see *Arm-only commands* below |
| `$1D` | VARI | SAW | Descending saw | LOPER=$40 |
| `$1E` | VARI | FOSHIT | Foe-hit | shorter saw |
| `$1F` | VARI | QUASAR | Quasar zap | reverse polarity |

## In-game mapping (from disassembly comments)

The actual game command codes (before the IRQ-handler's `DECA`) are 1-based — the Defender game CPU sends `cmd+1`. msarnoff's annotated disassembly gives the player-meaningful names:

| Game-side code | Internal (post-DECA) | Effect |
|---:|---:|---|
| 1 | $0 | bomber die |
| 2 | $1 | *(not used by Defender)* |
| 3 | $2 | lander shoot |
| 4 | $3 | mutant shoot (angrier) |
| 5 | $4 | pod die |
| 6 | $5 | lander die |
| 7 | $6 | swarmer die |
| 8 | $7 | humanoid catch |
| 9 | $8 | mutant shoot |
| 10 | $9 | game start |
| 11 | $a | humanoid scream |
| 12 | $b | swarmer shoot |
| 13 | $c | *(robotron only — get human)* |
| 14 | $d | *(electric, not used)* |
| 15 | $e | thrust quiet |
| 16 | $f | *(quiet wobble, not used)* |
| 17 | $10 | mutant spawn |
| 18 | $11 | *(robotron bubble)* |
| 19 | $12 | silent stub |
| 20 | $13 | player shoot |
| 21 | $14 | lander spawn |
| 22 | $15 | thrust loud |
| 23 | $16 | end of explosion (player death, smart bomb) |
| 24 | $17 | *(robotron hiscore aliased sweep)* |
| 25 | $18 | insert credit |
| 26 | $19 | humanoid fall |
| 27 | $1a | silent stub |
| 28 | $1b | silent stub |
| 29 | $1c | *(robotron)* |
| 30 | $1d | extra life |
| 31 | $1e | boot / drop humanoid |

Note the lift: many codes were defined but never triggered by the Defender game CPU; they're reachable only by exhaustive enumeration. Some show up in later Williams ROMs unchanged (the "(robotron …)" labels).

## GWAVE preset details

Each GWAVE preset is one row of `SVTAB` (7 bytes) plus a frequency pattern (length-prefixed). Format:

```
byte 0  hi-nyb GECHO (#echoes)   lo-nyb GCCNT (cycles/pattern byte)
byte 1  hi-nyb GECDEC (echo decay)  lo-nyb wave# (GWVTAB index)
byte 2  PRDECA   pre-decay (one-shot)
byte 3  GDFINC   delta-freq per echo iteration (signed)
byte 4  GDCNT    delta-freq iteration count
byte 5  pattern length
byte 6  pattern start byte
```

| Preset | Wave | Echo | Pattern | Slide | Effect |
|---|---|---|---|---|---|
| `HBDV`  | GSQ22 (square) | 8 | HBDSND (22-step exp) | none | thumping heart |
| `STDV`  | GS72 (sine) | 1 | STDSND (39-step swell) | -1 | start "swell" |
| `DP1V`  | GS72 | 1 | 1-byte $08 | +1×15 | rising blip |
| `XBV`   | GSSQ2 | 1 | SPNSND (13-step) | +1 | climbing square |
| `BBSV`  | GS1 (sine) | 15 | BBSND `08 40…` | none | long bell |
| `HBEV`  | GS72 | 4 | HBESND (14-step) | none | softer heart |
| `PROTV` | GS72 | 2 | SPNSND | -1 | descending |
| `SPNRV` | GS2 | 1 | $40 | -3 | rapid drip |
| `CLDWNV`| GSSQ2 | 3 | `10 08 01` | +1 | cool-down |
| `SV3`   | GS72 | 0 | BBSND | +1 | brief blip |
| `ED10`  | GS12 (harm) | 15 | ED10FP | none | experimental |
| `ED12`  | GS2 | 6 | ED13FP | none | experimental |
| `ED17`  | GS1 | 1 | SPNR ×4 | -1×16 | experimental |
| `BONV` *(via $12)* | GSSQ2 | 3 | BONSND descending | -1 | bonus chirp |
| `TRBV` *(via BG2)* | GS1.7 | 1 | TRBPAT (V-shape) | -1×each BG2 tick | turbine spool-up |

## VARI preset details

Format: 9 bytes — `LOPER, HIPER, LODT, HIDT, HIEN, SWPDT_lo, SWPDT_hi, LOMOD, VAMP`.

| Name | LOPER | HIPER | LODT | HIDT | HIEN | SWPDT | LOMOD | VAMP | Character |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| SAW    | $40 | $01 | $00 | $10 | $E1 | $0080 | $FF | $FF | descending saw |
| FOSHIT | $28 | $01 | $00 | $08 | $81 | $0200 | $FF | $FF | foe-hit, shorter |
| QUASAR | $28 | $81 | $00 | $FC | $01 | $0200 | $FC | $FF | reverse zap |
| CABSHK | $FF | $01 | $00 | $18 | $41 | $0480 | $00 | $FF | cabin-shake (used by SP1) |

Sound `$0E` (SP1, "spinner") uses CABSHK but **recomputes LOPER on every trigger** from a wrap-counter `SP1FLG`, producing the spinner's evolving pitch.

## LFSR-noise routines

All share the global LFSR seeded with `$3C` at SETUP.

| Routine | DFREQ | CYCNT | Start LFREQ | Effect |
|---|---:|---:|---:|---|
| LITE (lightning) | +1 | 3 | $C0 | slow upward |
| APPEAR | -2 | $10 | $C0 | falling, long settle |
| TURBO | (NFFLG=$20 → freq sweeps) | $20 | NFRQ1=1 | bright noise fade |

## FNOISE (slope-limited) routines

| Routine | DSFLG | FMAX | SAMPC | FDFLG | Character |
|---|:-:|---:|---:|:-:|---|
| BG1 (background) | 0 | (low) | (med) | 0 | continuous drone |
| THRUST | 0 | 3 | (low) | 0 | gentle rumble |
| CANNON | **1** | $FF | 1000 | **1** | big distorted boom |

CANNON is the only Defender FNOISE that uses distortion mode (`DSFLG=1`) and amplitude decay (`FDFLG=1`).

## ORGAN tunes

Pre-stored in `ORGTAB`:

| Tune # | Name | Notes |
|---:|---|---|
| 1 | Phantom | 3 notes — TD/TCS/TFS (D, C#, F#) |
| 2 | Taccata | 34 notes — Bach-ish descending sequence |

The chromatic note delay table (`NOTTAB`) maps note enum to a NOP-count: AF=$47 (lowest), G=$04 (highest). Lower nop count = shorter sample period = higher pitch.

## Arm-only commands

`$1B` and `$1C` are the only two-step commands in Defender's dispatch table — they don't play a sound directly; they set a flag and RTS, and the tune / note actually plays inside the *next* IRQ which reads its command byte as the tune index (`$1B`) or as the first of three data bytes (`$1C`).

```text
ORGANT  DEC  ORGFLG    ; minus the organ flag
        RTS             ; ...and that's the whole routine
```

The actual playback lives at IRQ entry, *before* the command dispatch:

```text
IRQ:    LDAB ORGFLG
        BEQ  IRQ00     ; flag clear → skip
        BPL  IRQ0      ; flag positive (ORGANN armed) → DECA + JSR ORGNN1
        JSR  ORGNT1    ; flag negative (ORGANT armed) → play tune in A
```

**Explorer behaviour** (commit `56f8978`): clicking `$1B` in the UI auto-pulses `$01` (tune 1 = PHANTOM) 40 ms after the arm so a single click plays the tune.  The arm-form picker that appears under the Cmd field lets you choose tune 2 (TACCATA) instead.  `$1C` is **not** auto-pulsed — its true protocol is four bytes (arm + osc-hi + osc-lo + note#) and a fixed-default follow-up would just play noise.  See [MANUAL.md "Why $1B is special"](../MANUAL.md#why-1b-organt-is-special).  Audit confirmed these two are the only arm-only entries in `VSNDRM1.SRC` — every other command writes the DAC directly or runs as a self-sustaining background loop.

## Background system

Two slots, both controllable independently:

- **BG1** (cmd `$0F`): continuous filtered-noise drone. Heart of the game's tension. Re-entered every IRQ tail while `BG1FLG` is set.
- **BG2** (cmd `$10` to advance, `$13` to clear): a turbine sound built from GWAVE+TRBV with `FOFSET` shifted lower each `BG2INC`. As `BG2FLG` ratchets from 0 to 29 (`BG2MAX`), the turbine spools up.

Both are silenced by `$13` (BGEND).

## Notable: dead/unused code

- `HBTSND` pattern (14 bytes, exponential) is defined but never referenced by any SVTAB row. Likely an early draft of the heartbeat.
- `$0A` (SV3) and the `ED…` family are probably test sounds left in the ROM.

## Cross-references

- Full source-line catalogue: `research/findings_defender_sound.md`
- Synthesis primitives explained: `docs/synthesis_techniques.md`
- Hardware (CPU, DAC, PIA, clock): `docs/sound_hardware_model.md`
- Existing JS port of Defender sounds: `docs/sound_studio_reference.md`
