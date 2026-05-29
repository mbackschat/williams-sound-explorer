# Stargate (Defender II) — Sound Catalogue

> Every command code the Stargate (= **Defender II**) 6800 sound ROM responds to. **TL;DR: Stargate is 95% byte-identical to Defender** — same physical board, same 9 engines, same dispatch table, same SVTAB/GFRTAB/GWVTAB/VVECT/RADSND/NOTTAB. Only **two ORGAN tunes** are different (and one is gutted), plus a louder ORGAN gain. This doc focuses on the **differences**; cross-reference `docs/defender_sound_catalogue.md` for the bulk of the catalogue. Full source-line detail: `research/findings_stargate_sound.md`.

## Naming

**Stargate** is the arcade title (Williams, September 1981, Eugene "Phred" Jarvis + Sam Dicker). **Defender II** is the home/console release name. Same game, same sound ROM. The source file is `VSNDRM2.SRC` — header reads `STARGATE SOUNDS REV. 1.0 Y PHRED 9/81`.

## Master command table — the deduplication chart

Stargate's command range is `$00..$1F` (5-bit mask), same as Defender. **30 of the 31 commands produce byte-identical audio to Defender's.** The two columns marked **`*`** are where Stargate genuinely differs.

| Cmd | Routine | Same as Defender? | Notes |
|----:|---------|:---:|---|
| `$00` | (silence) | ✓ | |
| `$01` | HBDV (heartbeat distorto) | ✓ | |
| `$02` | STDV (start swell) | ✓ | |
| `$03` | DP1V (sweep blip) | ✓ | |
| `$04` | XBV (bonus climb) | ✓ | |
| `$05` | BBSV (Big-Ben chime) | ✓ | |
| `$06` | HBEV (heartbeat echo) | ✓ | |
| `$07` | PROTV (Protector death) | ✓ | |
| `$08` | SPNRV (spinner drip) | ✓ | |
| `$09` | CLDWNV (cool-down) | ✓ | |
| `$0A` | SV3 (test) | ✓ | |
| `$0B` | ED10 (experimental) | ✓ | |
| `$0C` | ED12 (experimental) | ✓ | |
| `$0D` | ED17 (experimental) | ✓ | |
| `$0E` | SP1 (Spinner #1) | ✓ | |
| `$0F` | BG1 (background drone start) | ✓ | |
| `$10` | BG2INC (turbine ratchet) | ✓ | |
| `$11` | LITE (lightning) | ✓ | |
| `$12` | BON2 (Bonus #2) | ✓ | |
| `$13` | BGEND (end background) | ✓ | |
| `$14` | TURBO (noise burst) | ✓ | |
| `$15` | APPEAR (enemy appear) | ✓ | |
| `$16` | THRUST (thrust drone) | ✓ | |
| `$17` | CANNON (distorted boom) | ✓ | |
| `$18` | RADIO (chatter LUT) | ✓ | |
| `$19` | HYPER (warp PWM) | ✓ | |
| `$1A` | SCREAM (4-voice additive) | ✓ | reused for **Inviso** game event |
| `$1B` | ORGANT (tune arm) | **✗** | **new tunes** — see below |
| `$1C` | ORGANN (note arm) | **✗** | **gutted** — immediate `RTS`, silent |
| `$1D` | SAW (VARI) | ✓ | |
| `$1E` | FOSHIT (VARI) | ✓ | |
| `$1F` | QUASAR (VARI) | ✓ | |

### Implication for the explorer

For commands `$01..$1A` and `$1D..$1F` (30 codes), **reuse Defender's rendered audio and visualizations**. The synthesis engines, parameters, RAM overlays, and sample-rate behaviour are identical at the byte level. Building the Stargate catalogue is a relabel exercise, not a re-render exercise.

Only commands **`$1B` (ORGANT)** and **`$1C` (ORGANN)** need Stargate-specific handling.

## What's different — the five real changes

### 1. ORGANT `$1B` plays new tunes — "Fifth" and "Ninth"

Defender's ORGAN engine has two tunes built into ORGTAB: **Phantom** (3 notes) and **Taccata** (34 notes). Stargate replaces both with new tunes (file `VSNDRM2.SRC` lines 1023–1079).

#### Tune 1: FIFTH

The **Close Encounters of the Third Kind** five-note motif, voiced as a 7-note sequence: `G2 — rest — G2 — rest — G2 — rest — EF1 (long)`. Tempo divisor `FIF=6`. 7 notes × 4 bytes per note = 28 bytes of tune data.

Triggered by main CPU sending: `$1B` then `$01` (tune number 1).  **Explorer behaviour**: clicking the `$1B` chip auto-pulses `$01` 40 ms later so a single click plays FIFTH — see [MANUAL.md "Why $1B is special"](../../MANUAL.md#why-1b-organt-is-special) for the IRQ-handler trace.  Use the arm-form picker to switch to NINTH instead.

In-game use (informed guess): Stargate transit, Humanoid rescue, attract-mode jingle.

#### Tune 2: NINTH

A 42-note multi-octave figure that sweeps through D/A/E/F/G across four octaves. Tempo divisor `NIN=5`. Final note (`D1`) is a half-tempo sustained closing tone. Not a recognisable popular-music quote — likely a Phred-original baroque-organ-ish riff.

Triggered by main CPU sending: `$1B` then `$02`.

#### NMI demo

The sound CPU's self-test routine (NMI handler, file lines 942–945) **plays Tune 2 then Tune 1** as an audible diagnostic. Defender's NMI instead probed for an attached talking-ROM. Useful as a reference recording target — running diagnostics gives you both tunes for free.

### 2. ORGANN `$1C` is gutted to a single `RTS`

Defender used `$1C` to *arm* a 3-byte follow-on state machine (`ORGNN1..ORGNN4`) that let the main CPU specify a custom oscillator mask + delay + note number — i.e. play arbitrary single notes outside the ORGTAB tunes. **Stargate deletes the entire mechanism.** Command `$1C` immediately returns; no audio.

Implication: Stargate's main CPU can only invoke the two pre-built tunes, not author notes ad-hoc. Confirms that Phred kept ORGAN narrowly for the two stinger jingles.

### 3. ORGAN inner loop has one extra `ASLA` — 2× louder

Defender's `ORGAN1` inner loop does `ABA / ASLA × 4 / STAA SOUND` — scaling the popcount sum by 16. Stargate adds one more `ASLA` (file line 596), scaling by 32. Same sample period, same pitch — just louder DAC output for tunes.

Audible result: the FIFTH and NINTH play with more drive than Defender's tunes. Confirmable by ear in a side-by-side A/B test.

### 4. Talking-ROM hook removed

Defender's IRQ handler (Defender lines 930–933) had a probe: read `$EFFD`, check for opcode `$7E` (JMP), call into a speech ROM if present. Stargate removes the probe entirely. The `TALK` / `TALKD` equates remain in the source but no code path reaches them.

Implication: irrelevant for an emulator. Stargate has no speech daughterboard support.

### 5. Refactoring (code-level, not audible)

- `ORGNT1` is split into a reusable `ORGASM` subroutine that the NMI demo calls — purely a code-organisation change.
- `ORGANL` (the self-modifying RAM-code loader) has a subtle underflow fix: `SUBA #2 / BLS LD1` replaces Defender's `CMPA #0 / BEQ LD1`. Defender's version could fall through for delay=1; Stargate's correctly handles 0/1/2.
- The chromatic note constants (`D2 EQU $7C1D`, etc.) are factored out as named equates (file lines 970–1018) instead of inline `FCB` literals. Pure source-code refactor — same bit patterns.
- Defender's RELO relocator loop is removed (saves ~25 bytes for the new tunes).
- Checksum byte differs (`$DF` vs Defender's `$FE`) — different ROM contents.

## What about Stargate's new game events?

Stargate introduces enemies and mechanics absent from Defender: Yllabian Dogfighters, Mutants, Firebombers, Phred, Big Red, Munchies, the Inviso cloak, Stargate transits, Humanoid abduction/rescue. **None of these have new sound effects.** The main game CPU just maps each new event onto an existing pre-built command code from Defender's vocabulary. E.g. Inviso triggers `$1A` (SCREAM); Stargate transit triggers `$1B` ORGANT-FIFTH; etc.

This is a deliberate sequel-development shortcut. The audio team didn't author new effects; the game team picked from an existing menu.

## What's in source identically

For completeness, the byte-identical-to-Defender content is:
- All 9 synthesis engines (VARI, LITEN, NOISE, FNOISE, RADIO, HYPER, SCREAM, GWAVE, BG dispatch)
- 15 SVTAB GWAVE preset rows (`HBDV` through `TRBV`)
- 13 GFRTAB frequency patterns (`BONSND`, `HBTSND`, `SPNSND`, …)
- 7 GWVTAB waveform tables (`GS2`, `GSSQ2`, `GS1`, `GS12`, `GSQ22`, `GS72`, `GS1.7`)
- 4 VVECT VARI presets (`SAW`, `FOSHIT`, `QUASAR`, `CABSHK`)
- 16-byte `RADSND` LUT
- 12-byte `NOTTAB` chromatic delay table
- 6-byte LOCRAM overlay layouts (GWAVE/VARI/NOISE/FNOISE/SCREAM/ORGAN)
- IRQ dispatch logic (minus the two removed branches)
- Hardware setup (`SETUP`)
- Background loop pattern

If you have Defender's catalogue rendered, you have 95% of Stargate's for free.

## Reference-audio strategy

For Stargate's reference-audio corpus (`docs/reference_audio_plan.md` Path B), the cleanest split is:

| Files to render | Source |
|---|---|
| `01_heartbeat_distorto.wav` through `1A_scream.wav` (codes $01–$1A) | **Symlink to Defender's WAVs** |
| `1B_fifth.wav` | Render: assemble Stargate ROM, send `$1B`, then `$01` |
| `1B_ninth.wav` | Render: assemble Stargate ROM, send `$1B`, then `$02` |
| `1C_organn_silent.wav` | (Skip — silent stub) |
| `1D_saw.wav` through `1F_quasar.wav` | **Symlink to Defender's WAVs** |

Net new audio to render for Stargate: **2 WAVs** (FIFTH, NINTH). Plus a `README.md` in `reference_audio/stargate/` documenting the symlinks.

## Cross-references

- Full source-line catalogue with file:line cites: `research/findings_stargate_sound.md`
- The 95% shared catalogue: `docs/defender_sound_catalogue.md`
- Synthesis primitives explained: `docs/synthesis_techniques.md`
- Hardware (identical to Defender): `docs/sound_hardware_model.md`
- Robotron — the larger sequel with new engines: `docs/robotron_sound_catalogue.md`
