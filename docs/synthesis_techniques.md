# Williams Sound — Synthesis Techniques

> The DSP primitives every Williams sound routine is built from. This is the conceptual layer your explorer should expose: every visualization corresponds to one of the variables tracked here. Each technique cites the .SRC line(s) where it actually appears.

There are **eight primitives**. Every Defender or Robotron sound is some combination of them — usually two or three at once.

| # | Primitive | What it is | Variables to visualize |
|---|---|---|---|
| 1 | Wavetable lookup + phase accumulator | Fixed waveform sampled at variable rate | LUT shape, phase, sample index |
| 2 | LFSR pseudo-random noise | 16-bit shift register, tap XOR | All 16 bits, tap network, output bit |
| 3 | Amplitude envelope (subtractive decay) | `working_sample -= (original_high_nibble * decay)` per echo iteration | Original LUT vs. RAM LUT, decay counter |
| 4 | Frequency pattern table | Sequence of "periods" played in order | Pattern bytes, current index, current freq |
| 5 | Variable-duty-cycle square (VARI) | Asymmetric square with independently-swept half-periods | LOPER, HIPER, both deltas, output |
| 6 | Slope-limited DAC walk (FNOISE) | DAC tracks toward a random target at limited slope | Current DAC, target, slope, distortion flag |
| 7 | Additive voices (SCREAM) | N phase accumulators summed with halved amps | Each voice's FREQ + TIMER, mixed output |
| 8 | Popcount polyphony (ORGAN) | popcount(counter & mask) << 5 | Counter bits, mask bits, popcount, output |

The rest of this doc walks through each.

---

## 1. Wavetable lookup + phase accumulator (GWAVE engine)

The most common engine in both ROMs.

```
state:  GWTAB[]      (length-prefixed waveform in RAM, ≤72 bytes)
        GPER         (period byte — wait this many decrements per sample)
        index (X)    (current sample read position)
        pattern[]    (frequency pattern, GFRTAB sub-range)
        FOFSET       (frequency-pattern offset; modulates pitch over time)

inner loop:
    for each pattern byte F:
        GPER = F + FOFSET
        for cycle = 1..GCCNT:
            for X = 0..len(GWTAB):
                wait GPER × 4 cycles                      ← pitch
                DAC ← GWTAB[X]                            ← waveform sample
```

**Where**: Defender lines 785–862; Robotron lines 1581–1659. Both ROMs use the same engine.

**Cycle-locked sample period** ≈ `36 + 4·GPER` cycles ("SYNC 36" annotation in both files). At 894 kHz:
- GPER=4 → 18.6 kHz; with GS72 (72-pt sine) → audible 258 Hz
- GPER=128 → 1.7 kHz; with GS2 (8-pt) → 213 Hz buzz

**Available LUTs** in ROM (Defender / Robotron):
- 8-pt sine (`GS2`), 16-pt sine (`GS1`), 72-pt smooth sine (`GS72`)
- 8-pt and 16-pt squares (`GSSQ2`, `GSQ22`, `GSQ2`)
- Harmonic mixes: 1st+2nd (`GS12`), 1+2+3+4 (`GS1234`, Robotron only)
- Low-amp sine (`GS1.7`)
- Robotron-only: `MW1` metallic, `HBPAT2` biased 72-pt sine

**Visualization angle**: animate `X` walking across the LUT once per audio cycle; show `GPER` as a dwell time. Slow it down 1000× and you can literally watch a sine wave being read.

---

## 2. LFSR pseudo-random noise

A 16-bit Galois-style LFSR shared globally across all noise routines. State lives at fixed RAM bytes:
- Defender: `$09` (HI) / `$0A` (LO), seeded with `$3C` at SETUP
- Robotron: `$05` / `$06`, both seeded at startup

**The update** (verbatim from both ROMs):

```asm
LDAA LO
LSRA            ; bit 0 → C
LSRA            ; bit 1 → C
LSRA            ; bit 2 → C, A now has bit 3 as bit 0
EORA LO         ; combine A bit 0 with LO bit 0
LSRA            ; XOR result → C
ROR HI          ; carry into HI bit 7
ROR LO          ; HI bit 0 cycles into LO bit 7
```

Taps: bits 0 and 3 of the low byte. Period: 65535.

**How noise routines use the output**:
- `LITEN` (lightning) — `COM SOUND` on the new C: DAC bit-toggle, audible as a sweeping square.
- `NOISE` / `MOISE` — `LDAA NAMP` if C=1 else `LDAA #0`, then `STAA SOUND`: asymmetric noise with controllable amplitude.
- `FNOISE` — use whole 16-bit word as the next "target" for the DAC slope walk.

**Visualization angle**: show the 16-bit register as a row of bits; animate one bit per LFSR clock; draw the tap arrow XORing into the carry. After ~65536 ticks the pattern repeats — you can show the period visually.

There's a second, fast LCG mixer for Robotron's PLAY voice 4 (lines 294–297): `ASLB / ADDB RANDOM / ADDB #$0B / STAB RANDOM`. Less interesting but worth surfacing if showing PLAY.

---

## 3. Subtractive amplitude envelope (WVDECA)

Instead of a multiplier, both ROMs decay a *copy* of the waveform in RAM. After each echo iteration:

```c
for i in 0..len(GWTAB):
    GWTAB[i] -= (original_high_nibble_at_i * decay_amount)
    GWTAB[i] &= 0xFF                            // 8-bit wrap
```

The byte wrap is intentional — large decays cause samples to wrap to high values, producing the "ethereal", "math-error" glitch that gives later iterations of the lander-die sound their unique character. msarnoff's help text:

> "Large values will cause wrap-around!"

**Where**: Defender 879–905, Robotron 1675–1701.

**Visualization angle**: keep the *original* ROM LUT visible alongside the RAM working copy. Each echo iteration, animate the RAM LUT pulling downward (or wrapping). At wrap-around moments, briefly flash the affected bytes red — that's the moment timbre goes weird.

---

## 4. Frequency pattern tables (GFRTAB)

A pattern is a small byte array; each byte is one "period" played for `GCCNT` cycles. By walking through a pattern you create melodic phrases or sweeps.

Examples (Defender):

| Pattern | Bytes | Effect |
|---|---|---|
| `SPNSND` (13) | `01 01 02 02 03 04 05 06 07 08 09 0A 0C` | climbing pitch — spinner |
| `BONSND` (13) | `A0 98 90 88 80 78 70 68 60 58 50 44 40` | descending — bonus |
| `STDSND` (39) | swells `01..50..01` | start fanfare |
| `HBDSND` (22) | `01 01 02 02 04 04 08 08 10 …` exponential | heartbeat |

Combined with `FOFSET` (a slowly-drifting bias added to each pattern byte) and `GDFINC` (delta-per-iteration), this is how slides, sweeps, and "alarm-getting-faster" effects are built.

**Visualization angle**: render the pattern as a step graph; animate a playhead through it; show `FOFSET` as a horizontal offset of the entire graph — when `GDFINC` is non-zero you watch the curve translate up or down between echoes.

---

## 5. Variable-duty-cycle square (VARI)

Asymmetric square wave with independent half-periods and three nested sweeps:

```
state:  LOPER, HIPER          ; low and high half-period durations
        LODT, HIDT            ; per-cycle deltas
        SWPDT                 ; 16-bit secondary-sweep counter
        LOMOD                 ; tertiary base-freq drift
        VAMP                  ; amplitude

inner:
    output high for HIPER cycles
    output low  for LOPER cycles
    HIPER += HIDT  every cycle
    LOPER += LODT  every cycle
    every SWPDT cycles: LOPER += LOMOD   (slowest drift)
    terminate when LOPER wraps to 0
```

**Where**: Defender 208–246, Robotron 778–816.

Each VARI preset (`VVECT`) is 9 bytes — the entire sound's character lives in those 9 numbers. Examples:

| Name | LOPER | HIPER | LODT | HIDT | HIEN | SWPDT | LOMOD | VAMP | Effect |
|---|---|---|---|---|---|---|---|---|---|
| `SAW` | $40 | $01 | $00 | $10 | $E1 | $0080 | $FF | $FF | descending saw |
| `FOSHIT` | $28 | $01 | $00 | $08 | $81 | $0200 | $FF | $FF | shorter |
| `QUASAR` | $28 | $81 | $00 | $FC | $01 | $0200 | $FC | $FF | reverse-zap |
| `CABSHK` | $FF | $01 | $00 | $18 | $41 | $0480 | $00 | $FF | spinner |
| `MOSQTO` (Robotron) | … | | | | | | | | high mosquito |

**Visualization angle**: draw LOPER and HIPER as side-by-side bars whose heights animate; show the resulting square wave with the duty cycle morphing in real time. This is *the* sound for understanding "pulse-width modulation as a single-axis sweep" because there are no hidden states.

---

## 6. Slope-limited DAC walk (FNOISE) — filtered noise

The DAC value walks *toward* a random target at a maximum slope; whenever it arrives, draw a new random target. The slope acts as a low-pass filter cutoff (high slope = bright, low slope = muffled).

```
state:  FHI, FLO        ; 16-bit slope (DAC units per sample)
        FMAX            ; slope ceiling (envelope)
        target          ; sampled from LFSR every SAMPC walk steps
        DSFLG           ; if set, AND random into slope each sample (distortion)
        FDFLG           ; if set, FMAX decays
        SAMPC           ; samples per target-resample

inner:
    if  DAC < target: DAC += slope (clamped to target)
    if  DAC > target: DAC -= slope (clamped)
    every SAMPC ticks: target = LFSR.next() & 0xFF
    if FDFLG: FMAX -= FMAX/8
    if DSFLG: slope ← slope AND LFSR.hi  (jagged distortion)
```

**Where**: Defender 364–426, Robotron 1178–1241.

Used by: BG1 (background drone), THRUST, CANNON, HBOMB. CANTB has the comment "DEFENDER SND #$17" in Robotron — explicit reuse.

**Visualization angle**: this is the most beautiful one to animate. Plot DAC vs. time, with the random target as a moving horizontal line that the DAC chases. When DSFLG is set, show slope flickering randomly each sample — the "distortion" becomes visually obvious.

---

## 7. Additive voices (SCREAM)

4 phase-accumulator voices summed via amplitude halving. Robotron's iconic death-cry.

```
state:  STABLE[0..3] = { (FREQ_i, TIMER_i) for each voice }

inner (per sample):
    out = 0
    amp = 0x80
    for i in 0..3:
        TIMER[i] += FREQ[i]
        if TIMER[i] wrapped (MSB flipped this step):
            out += amp
        amp >>= 1                  ; next voice gets half amplitude
    DAC ← out

outer (every 256 samples):
    for each voice: FREQ[i] -= 1   ; pitch slowly descends
    if FREQ[i] == 0x37:
        FREQ[i+1] = 0x41           ; seed a new echo voice
    end when all FREQs == 0
```

**Where**: Defender 475–515 (the original), Robotron 1290–1330 (refined version).

Voice 0 contributes max amplitude, voice 1 half, voice 2 quarter, voice 3 eighth — exponential echo decay built into the mixer. Voice spawning when prior voice hits $37 means later voices are slightly detuned, producing a chorusing swarm.

**Visualization angle**: four phase-accumulator wheels rotating at their FREQs; pulse a voice's wheel when it contributes; show the output sample as a stacked sum. Slow it to 1 fps and you can literally watch how four sawtooths sum to a shimmering chord.

---

## 8. Popcount polyphony (ORGAN engine — all three games)

The most unusual primitive. Up to 8 simultaneous square-wave voices encoded as a single 8-bit oscillator mask. The audio sample for each tick is computed as:

```c
output = popcount(counter & oscil_mask) << 5;
DAC ← output;
counter++;   // every sample
```

Each set bit of `oscil_mask` enables one square-wave voice running at a divider determined by which bit is set:
- bit 0 set → square wave at f_sample / 2
- bit 1 set → square wave at f_sample / 4
- bit 7 set → square wave at f_sample / 256

The pitch *between* notes is set by **self-modifying the inner loop**: each note patches a different count of NOP bytes into a RAM scratchpad (`RDELAY`), changing the sample period from ~70 to ~210 cycles in single-cycle increments.

**Where**: present in all three sound ROMs. Robotron 1376–1432 (ORGAN), 1334–1366 (driver), 1881–1937 (tune tables: Beethoven 5th + 9th); Defender ~519–638 (ORGANT/ORGANN/ORGANL/ORGAN1, tunes PHANTOM + TACCATA — see `research/findings_defender_sound.md` §2.8); Stargate is structurally identical (VSNDRM2) with Fifth/Ninth tunes. Only the *tune tables* differ between games — the popcount kernel is the same.

**Visualization angle**: 8 LEDs for the oscillator mask, 8 phase-counters underneath ticking at their divisor rates, sum displayed as the DAC value. The "Beethoven 9th" tune steps through ~40 notes — each note's mask is a different chord voicing. Excellent for explaining additive synthesis.

---

## Beyond the eight — special-purpose routines

A handful of routines don't fit cleanly into the eight categories but appear in both ROMs:

- **HYPER** — phase-modulated PWM sweep. Inner loop: `INCA; CMPA TEMPA; if equal COM SOUND`. The pulse width grows from 1/128 to 128/128 over 128 outer cycles → rising "warp" whoosh. (Defender 456–471, Robotron 1271–1286.)
- **RADIO** — 16-byte wavetable replay via fractional phase accumulator (Defender 430–452, Robotron 1245–1267). Closest the Williams board comes to PCM, but still wavetable.
- **PLAY** (Robotron 268–360) — 3 square-wave voices + 1 LFSR-noise voice with their own phase accumulators, polarity flips, and amplitude envelopes. The most complex routine. Used for "SND2", "SND5", "THNDR", "SND16", "SND17".
- **SING** (Robotron 668–718) — single-voice square with sweeping period and inverting amplitude. Used for "ATARI", "SIREN", "ORRRR", "PERK$$", "SQRT".
- **CDR** (Robotron 916–1135) — sequenced crowd-roar engine. Two parallel noise oscillators plus a triangle whistle stepping through an 8-entry table. Effectively a small sound-script DSL.
- **WHIST** (Robotron 461–487) — 64-byte sine LUT with falling phase increment. Bomb "ooohhh nooo".
- **KNOCK** (Robotron 500–541) — period-sequenced thud, takes direct control of PIA Port B mid-sound.
- **ZIREN** (Robotron 412–458) — second-order glissando, walks DAC 0↔0xE0 in $20 steps with a swept hold time and a swept-sweep.

These are described in detail with parameters in `research/findings_robotron_sound.md` §2.

---

## Cycle-counted timing — the "sync N" idiom

Williams programmers manually equalised branch paths so every sample takes the *same* number of cycles regardless of which branch is taken. Comments labelled `SYNC N` mark these places:

| Engine | File:Line | Sync target |
|---|---|---|
| GWAVE | both ROMs, line 819 / 1615 | 36 cyc/sample |
| SING | Robotron 681–685, 702–704, 712, 715 | 20 / 10 / 3 / variable |
| CDR | Robotron 995 | 23 cyc per sub-step |
| RADIO | Robotron 1255 | implicit |

For the explorer, mirror these explicitly: every sample-emitting code path must report the same per-sample cycle count to the resampler. This guarantees a clean output pitch.

---

## Cross-references

- Per-sound parameter tables: `docs/defender_sound_catalogue.md`, `docs/robotron_sound_catalogue.md`
- Raw ROM excerpts with line numbers: `research/findings_defender_sound.md`, `research/findings_robotron_sound.md`
- Visualization spec by primitive: `docs/explorer_architecture.md` §"Visualization layers"
