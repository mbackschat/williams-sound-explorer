<!--
  Williams Sound Explainer Cards — single-source markdown.

  *This file is the source of truth.*  The per-routine JSON files at
  `explorer/public/data/explainer/*.json` are generated artefacts —
  rebuild them with `python3 tools/build_explainer_cards.py` (also
  invoked by `npm run dev` / `npm run build` via `prepare:public`).
  Never hand-edit the JSONs.

  ### Format

  Each card is one `## ROUTINE_KEY — Title` section.  The parser uses:

  - `## ROUTINE_KEY — Title`  → first whitespace-delimited token is the
    lookup key (matches the glossary's `routine` field after stripping
    decorations like `$$` or `/CABSHK`).
  - `**Engine:** X · **Games:** g1, g2, g3` → metadata.
  - `> ...` (one or more lines)  → TL;DR.
  - `### How it works` … `### What to watch` … `### Key code paths` …
    `### See also` → body sections.  Bullet lists are `- …`.

  Inline markdown the runtime renders: `` `code` ``, `**bold**`,
  `[label](url)`.  Nothing else.

  Order below: engines first (LFSR → GWAVE → VARI → FNOISE → SCREAM →
  ORGAN), then Robotron-specific multi-osc engines (PLAY, SING),
  then hand-coded specials, then control commands.
-->

# Williams Sound Explainer Cards

The 6800 sound CPU has a small library of engines.  Each card below
explains one routine — *what* algorithm runs and *why* it sounds the
way it does.  See [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md)
for the engine-level survey and the per-game catalogues for byte-level
preset data.

---

## LITE — Lightning sweep

**Engine:** LFSR · **Games:** defender, stargate, robotron

> A 16-bit linear-feedback shift register clocked at LFREQ rate. Its bottom bit drives the DAC's MSB, producing broadband white-noise that sweeps as LFREQ decays.

### How it works

An LFSR is the simplest noise source a CPU can implement: a shift register where a feedback bit (computed by XORing two specific taps) gets shoved into the high end as the rest shifts down. With a well-chosen tap pattern the register cycles through 2^16 − 1 distinct states before repeating, which is long enough to *sound* random.

LITE keeps the shift register at `$09/$0A` (HI/LO). Every iteration it computes the feedback bit, shifts, and writes the bottom bit of the result to the DAC's most-significant bit. So the speaker swings between roughly +full and 0 at a rate set by `LFREQ` — the cycle-counter that controls how often the LFSR advances.

`LFREQ` itself decays over the course of the sound (the iconic 'pitch dropping' part of the lightning sweep). When `CYCNT` runs out, the sound ends and the CPU returns to its `BRA *` idle.

### What to watch

- Code panel's `LFSR:` line — shows the 16-bit register `state`, the just-output `bitOut`, the `lfreq` divider, and `cycnt` (outer counter).
- Spectrogram — broadband noise sweep upward as `LFREQ` decreases.
- Byte tape — every DAC write is `$00` or `$FF` (pure ±full), nothing in between.

### Key code paths

- `LITE` at `$F88C` (Defender) / `$F55C` (Robotron) — entry point: arm the LFSR and set initial `LFREQ`/`CYCNT`.
- `LITEN` — inner loop that decrements `LFREQ` and shifts the register on each pass.
- Source: `VSNDRM1.SRC:250` (Defender), `VSNDRM3.SRC:828` (Robotron).

### See also

- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §LFSR-noise
- [MANUAL.md](../../MANUAL.md#tutorial-2--slow-down-lite-watch-the-lfsr-shift) Tutorial 2 — slow down LITE
- [MANUAL.md](../../MANUAL.md#tutorial-6--freeze-the-lfsr-whats-noise-without-the-shift) Tutorial 6 — Freeze the LFSR

---

## TURBO — Bright LFSR burst

**Engine:** LFSR · **Games:** defender, stargate, robotron

> Same LFSR engine as LITE, but a *short* burst with a higher initial `LFREQ` — produces a bright, fading noise transient. Used for turbo-boost / weapon-charging UI events.

### How it works

TURBO and LITE share the LFSR inner loop; what differs is the initial parameter setup. TURBO starts with a small `LFREQ` (higher LFSR clock rate → brighter noise) and a smaller `CYCNT` (shorter total duration). The result is a brief "psh!" rather than LITE's full sweep.

### What to watch

- Code panel's `LFSR:` line — same shift-register readout as LITE.
- `LFREQ` and `CYCNT` start lower than LITE — note the smaller numbers.
- Spectrogram — a brief broadband transient instead of a long sweep.

### Key code paths

- `TURBO` entry sets `LFREQ` / `CYCNT` to its preset values then falls through to LITE-style inner loop.

### See also

- **LITE** — canonical LFSR card.
- **APPEAR** — third LFSR variant.

---

## APPEAR — Enemy-appear descent

**Engine:** LFSR · **Games:** defender, stargate, robotron

> LFSR-noise with a *descending* clock — `LFREQ` increases over the sound's lifetime, so the noise pitch *falls*. The "uh-oh, something just spawned" cue.

### How it works

The LFSR generates the same broadband noise as LITE, but APPEAR's outer loop steers `LFREQ` upward (longer period between shifts → lower-frequency noise). Where LITE's pitch *rises* over time, APPEAR's *drops*. Same engine, opposite ramp direction.

### What to watch

- Spectrogram — descending broadband noise vs LITE's ascending.
- `LFREQ` *increasing* over time (look at the Code panel's LFSR line).

### Key code paths

- `APPEAR` entry, then shared LFSR inner loop.

### See also

- **LITE** — canonical LFSR card.
- **TURBO** — short, bright variant.

---

## LAUNCH — LFSR launch sweep

**Engine:** LFSR · **Games:** robotron

> Robotron's own LFSR sweep — distinct preset from LITE / TURBO / APPEAR. The "vehicle launch" cue.

### How it works

Robotron's LFSR ranges around `$F55C..$F59D`, slightly different addresses from Defender but the same algorithm. LAUNCH picks a particular `LFREQ` / `CYCNT` combination that produces a distinctively-pitched whoosh — the game uses it for the bonus-vehicle launch sequence.

### What to watch

- Code panel's `LFSR:` line.
- Compare against LITE: same engine, different sweep envelope.

### Key code paths

- `LAUNCH` entry at the LFSR jump-table entry for `$39`; shares the LITE inner loop.
- Source: `VSNDRM3.SRC` (Robotron).

### See also

- **LITE** — canonical LFSR card.
- **APPEAR / TURBO** — other LFSR variants.

---

## HBDV — Heartbeat distorto

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> A 72-byte wavetable read repeatedly through a pitch pattern, with each echo iteration self-decaying via `WVDECA`. The iconic low pulsing 'heartbeat' that opens Defender.

### How it works

GWAVE is the most elaborate of Williams' engines: a programmable wavetable synthesiser with pitch sequencing, echo decay, and frequency offset. `HBDV` (Heartbeat distorto) configures it with a particular preset — a low square-ish wavetable, a pitch pattern (`HBDSND`) that drops the pitch step by step across each beat, and a non-trivial `GECHO` count so the pulse repeats while `WVDECA` halves the wavetable's amplitude each pass.

The inner loop walks the X register through `GWTAB` ($24..$6B = 72 bytes of live wavetable RAM), writing each byte to the DAC. The *speed* of that walk is set by `GPER` (period). After each pass through the table, `GWAVE` decrements `GECNT`; when zero, it runs `WVDECA` which shifts every wavetable byte right by one — so the next echo plays the same shape but half-amplitude. That's the 'distorto' decaying character.

The pitch pattern (`HBDSND`) is a sequence of single-byte values added to `FOFSET` each iteration; those values are step *deltas* in the lookup into the master frequency table `GFRTAB`. So the pitch isn't directly the bytes — it's an index advance per beat.

### What to watch

- GWAVE engine view — 72-bar wavetable bar chart with yellow cursor on the live sample index. Watch the bars *decay* each echo as WVDECA shifts them right.
- `GPER` (period), `GECHO` (echo iterations remaining), `FOFSET` (current pitch offset).
- Spectrogram — characteristic 'pulsing' harmonic stack at the heartbeat rate.

### Key code paths

- `GWLD` — loader: copies the preset's parameter block from `GFRTAB`/`HBDSND` etc. into the GWAVE zero-page cells.
- `GWAVE` (`$FB81` Defender / `$F9DE` Robotron) — main loop: walk wavetable, write DAC, count echoes.
- `WVDECA` (`$FC87` Defender / `$FAE4` Robotron) — per-echo decay: shift every wavetable byte right.
- Source: `VSNDRM1.SRC:785` (Defender), `VSNDRM3.SRC:1581` (Robotron).

### See also

- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §GWAVE wavetable
- [MANUAL.md](../../MANUAL.md#tutorial-7--whatif-drag-a-parameter-slider) Tutorial 7 — drag a parameter slider
- [MANUAL.md](../../MANUAL.md#tutorial-12--combine-toggles--sliders--scrub) Tutorial 12 — toggle Skip WVDECA + scrub

---

## HBEV — Heartbeat echo

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> HBDV's quieter sibling — same wavetable engine, but a 4-echo (vs 8) variant on the GS72 sine instead of the GSQ22 square. A *softer*, more sustained heartbeat for less-tense moments.

### How it works

HBEV uses the same `GWAVE` engine as `HBDV` (heartbeat distorto) but with a different preset. Where HBDV picks the **GSQ22** wavetable (a 22-byte staircased square, which gives the punchy edge) and 8 echo iterations, HBEV picks **GS72** (a smooth 72-byte sine) and only 4 echoes. The pitch pattern is also half the size — `HBESND` is a 14-step pattern vs `HBDSND`'s 22 steps.

Net effect: same heartbeat *shape* (pulse → decay → silence), but smoother timbre and shorter total duration. A useful A/B comparison against HBDV in the explorer's diff view — only ~6 bytes differ in the preset, but the sound is meaningfully different.

### What to watch

- GWAVE engine view's wavetable bars — smooth bell-curve instead of HBDV's square steps.
- GECHO drops to 4 (vs HBDV's 8) — fewer pulses in the spectrogram.
- A/B diff against HBDV to see the preset deltas byte-for-byte (open the A/B section, fire HBDV vs HBEV).

### Key code paths

- `HBEV` preset at `VSNDRM1.SRC:1107` — `FCB $41,$45,0,0,0,15,HBESND-GFRTAB,6`.
- Same `GWLD` → `GWAVE` → `WVDECA` engine code as HBDV (see the HBDV card).

### See also

- **HBDV** — fire `$01` then `$06` to A/B them.
- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §GWAVE wavetable
- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §GWAVE presets — compare all 14 wavetable sounds

---

## STDV — Start fanfare swell

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> GWAVE preset for the wave-start fanfare: a rising-then-falling sine sweep on the GS72 wavetable, fewer echoes than HBDV but with a smoother attack envelope.

### How it works

Same GWAVE engine as HBDV — different preset bytes in `SVTAB`. STDV picks the smooth 72-byte sine wavetable (GS72) and a pitch pattern that climbs through the GFRTAB indices before falling back — the 'fanfare swell' arc.

The `FOFSET` modulator drives the rise-then-fall: each echo iteration adjusts the GFRTAB lookup index by a +N then -N delta sequence, so the *same* wavetable plays at progressively higher pitches before reversing.

### What to watch

- GWAVE wavetable view — bars stay smooth (sine) instead of stepping (HBDV's square).
- `FOFSET` ticking up then down across the echo iterations.
- Spectrogram — rising-then-falling pitch arc.

### Key code paths

- `STDV` preset in `SVTAB` (Defender). See `docs/defender_sound_catalogue.md` §GWAVE presets for the byte breakdown.
- Same `GWLD` → `GWAVE` engine code as HBDV.

### See also

- **HBDV** — canonical GWAVE card.
- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §GWAVE preset details

---

## DP1V — Sweep blip

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> Minimal GWAVE preset: a 1-byte pitch pattern (`DP1SND`) plus a constant +1 slide on every iteration. The short upward 'blip' that punctuates UI interactions.

### How it works

DP1V is the simplest possible GWAVE configuration that still sweeps. Where HBDV uses a 22-step pattern table and 8 echoes, DP1V has just **one byte** in its pattern and a tiny `GDFINC` (+1) that nudges the frequency offset up each iteration.

Result: a brief upward chirp. Useful as a 'something just happened' notifier — bonuses, level changes — without the dramatic envelope of HBDV.

### What to watch

- GWAVE pattern table — only 1 byte long; the engine cycles through it once per echo.
- `GDFINC` = +1 — the linear pitch climb.
- Total duration: tens of ms only.

### Key code paths

- `DP1V` preset + `DP1SND` 1-byte pattern in `SVTAB` (Defender).
- Same `GWAVE` engine code as HBDV.

### See also

- **HBDV** — canonical GWAVE card.
- **XBV** ($04) — similar simple climb but louder/longer.

---

## XBV — Extra-bonus climb

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> GWAVE square-wavetable preset with a per-echo +N pitch slide. The cascading 'climbing' sound when an extra bonus arrives — pitches stair-step upward across multiple echo iterations.

### How it works

XBV uses the same engine as HBDV but combines a *square* wavetable (GSQ22) with a *positive* `GDFINC` (frequency-delta increment). Each echo iteration nudges the pitch lookup higher, producing a stepped climb instead of a constant pitch.

The square wavetable gives it more harmonic content than DP1V's chirp — feels more 'celebratory' than 'notification'.

### What to watch

- Wavetable bars — square (stepped) profile, not sine.
- Pitch climbing through the spectrogram as each echo fires.

### Key code paths

- `XBV` preset in `SVTAB` (Defender).
- Same engine as HBDV / DP1V / STDV.

### See also

- **DP1V** — simpler 1-byte-pattern version of the same idea.
- **HBDV** — canonical GWAVE card.

---

## BBSV — Big-Ben chime

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> Sine wavetable + 15 echoes (the largest `GECHO` in any preset) + slow `WVDECA` decay. Produces the long, slowly-fading 'bell' sound — a literal Big Ben evocation.

### How it works

BBSV's distinctive feature is *15* echo iterations — `GECHO=15` in the preset, vs HBDV's 8. Each echo plays the same GS72 sine wavetable with `WVDECA` halving the amplitude. Half-amplitude per echo means after 15 echoes the level is 2^-15 = effectively silent.

The pitch pattern uses a small `FOFSET` modulation that creates a subtle 'bell partials' coloration as different harmonics of the sine fade at slightly different rates.

### What to watch

- GWAVE engine view's `GECNT` countdown — starts at 15 and counts down slowly.
- Wavetable bars halving each pass thanks to WVDECA.
- Try toggling **Skip WVDECA** (Pattern 3) — the chime sustains at full amplitude forever.

### Key code paths

- `BBSV` preset in `SVTAB` — `GECHO=15`.
- Same engine as HBDV.

### See also

- [MANUAL.md](../../MANUAL.md#tutorial-12--combine-toggles--sliders--scrub) Tutorial 12 — Skip WVDECA experiment.
- **HBDV** — canonical GWAVE card.

---

## PROTV — Protector death

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> GWAVE sine preset with `GDFINC` set negative — the frequency offset *decreases* each echo iteration, sliding the pitch downward. The sad-descent sound when your protector dies.

### How it works

Where most GWAVE sweep presets (XBV / DP1V) use a *positive* `GDFINC` to climb, PROTV uses a *negative* value (signed-byte form like `$FF` = −1). Each echo iteration drops the pitch a step, producing a descending sine arpeggio.

The GS72 sine wavetable keeps the timbre clean — appropriate for the melancholy intent.

### What to watch

- `GDFINC` displayed as a negative signed byte in the GWAVE engine view.
- Wavetable cursor walking the same sine each echo, but the *speed* (period) gets longer each pass.
- Spectrogram — descending pitch arc.

### Key code paths

- `PROTV` preset in `SVTAB` (Defender).

### See also

- **XBV / DP1V** — same engine, positive (ascending) GDFINC.
- **HBDV** — canonical GWAVE card.

---

## SPNRV — Spinner drip

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> Minimal GWAVE preset: `GPER=$40`, only 5 echo cycles. The brief tonal blip when you nudge the spinner — repeats fast enough to feel like a continuous interaction.

### How it works

SPNRV is engineered to fire *often* and *briefly*. Its `GPER` (period) is a single value of $40 — no pattern walking — and `GECHO=5` keeps total duration to a few tens of ms. The game CPU re-triggers it on every spinner tick during gameplay.

This is the GWAVE equivalent of a 'sample' — predictable, short, parameter-less.

### What to watch

- GWAVE engine view — `GPER=$40` stable across all 5 echoes, no FOFSET modulation.
- Stage swimlane — brief band of SPNRV that re-appears whenever the spinner is moved.

### Key code paths

- `SPNRV` preset in `SVTAB`.
- Often fired by spinner-handler code in the main game CPU.

### See also

- **SP1 / CABSHK** ($0E) — VARI-side spinner sound for the same gesture.
- **HBDV** — canonical GWAVE card.

---

## CLDWNV — Cool-down chirp

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> 3-echo GWAVE preset with a descending pitch pattern — the brief downward chirp marking 'something cooled down', typically a weapon ready-state.

### How it works

CLDWNV is the inverse of XBV: small `GECHO=3` and a *negative* `GDFINC` (or descending pattern bytes) for a quick downward sweep. Three echoes = three quick pitch steps before silence. Compact and unambiguous.

### What to watch

- GWAVE engine view's `GECNT` countdown — 3, 2, 1, then idle.
- Spectrogram — three descending steps.

### Key code paths

- `CLDWNV` preset in `SVTAB` (Defender).

### See also

- **PROTV** — similar descending profile but longer.
- **XBV** — the ascending counterpart.

---

## SV3 — Test/effect (rarely used)

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> A GWAVE preset in `SVTAB` that the catalogue marks as 'rarely used' — likely a developer test sound left in the ROM. Fires cleanly through the standard GWAVE engine.

### How it works

SV3 occupies command slot $0A but isn't referenced from documented main-CPU code paths. Its preset bytes are a generic GWAVE configuration — sine wavetable, moderate echo count, no exotic parameters. Probably an experimental variant from the development process that was kept around 'just in case'.

Firing it shows what a 'baseline' GWAVE sound looks like in the explorer without any of the distinctive shape that HBDV (echo decay) or XBV (climb) carry.

### What to watch

- All standard GWAVE engine indicators — wavetable bars, GECNT, FOFSET — nothing distinctive.

### Key code paths

- `SV3` preset in `SVTAB` (Defender).

### See also

- **HBDV** — canonical GWAVE card.
- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §Notable: dead/unused code

---

## ED10 — Experimental GWAVE sound #10

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> One of three 'ED' (experimental development) GWAVE presets — `ED10`, `ED12`, `ED17` — likely named for the developer's per-test-build sequence. Each is a GWAVE preset with a unique combination of wavetable + echoes + pattern.

### How it works

The Defender source contains three sounds named `ED10`, `ED12`, `ED17` — the numbers don't match command codes (ED10 lives at $0B, ED12 at $0C, ED17 at $0D). Best guess: these are 'experimental sound, build #10/#12/#17' — leftover test sounds that survived into the released ROM because changing the dispatch table would have shifted every command code.

Each has its own preset bytes in `SVTAB`; the engine code is the same GWAVE used by HBDV. Useful as A/B exploration material — fire each and compare what changes.

### What to watch

- Standard GWAVE indicators.

### Key code paths

- `ED10` preset in `SVTAB` (Defender).

### See also

- **ED12 / ED17** — companions.
- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §Notable: dead/unused code
- **HBDV** — canonical GWAVE card.

---

## ED12 — Experimental GWAVE sound #12

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> Second of three 'ED' experimental GWAVE presets. See **ED10** for the broader context — these are developer test sounds left in the released ROM.

### How it works

GWAVE preset with its own unique configuration in `SVTAB`. Engine code identical to HBDV; firing it explores a particular point in the GWAVE parameter space.

### What to watch

- Standard GWAVE indicators — see how ED12 differs from ED10 / ED17 in the engine view.

### Key code paths

- `ED12` preset in `SVTAB` (Defender).

### See also

- **ED10**, **ED17** — companions.
- **HBDV** — canonical GWAVE card.

---

## ED17 — Experimental GWAVE sound #17 (spinner-ish)

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> Third 'ED' experimental preset. The catalogue notes a 'spinner' character — possibly an alternate take on `SPNRV` (spinner drip) that didn't ship as the canonical version.

### How it works

GWAVE preset designed in the same vein as `SPNRV` — short, percussive, no pattern walking — but with different period / echo / wavetable choices. Useful for A/B against SPNRV to hear the parameter-space neighbourhood.

### What to watch

- Standard GWAVE indicators — compare against SPNRV in A/B.

### Key code paths

- `ED17` preset in `SVTAB` (Defender).

### See also

- **SPNRV** — the canonical spinner drip.
- **ED10 / ED12** — companion experimentals.

---

## BON2 — Bonus #2 (re-trigger optimised)

**Engine:** GWAVE · **Games:** defender, stargate, robotron

> A GWAVE preset specifically tuned for fast re-triggering — short, snappy, deterministic. Used when the game wants to *play it again* immediately if the player keeps banking bonuses.

### How it works

BON2 (also documented as `BONV`) is GWAVE with a small preset footprint: short `GECHO`, deterministic pitch pattern, minimal `WVDECA` impact. The point is consistency — the game CPU can fire it repeatedly without the player noticing 'previous one is still echoing'.

### What to watch

- Stage swimlane — re-fire `$12` rapidly and watch BON2 bands stack with minimal overlap.

### Key code paths

- `BON2` preset in `SVTAB`.

### See also

- **HBDV** — canonical GWAVE card.

---

## SAW — Descending saw

**Engine:** VARI · **Games:** defender, stargate, robotron

> A two-counter square-wave generator (`LOCNT`, `HICNT`) whose period shrinks each iteration, producing a downward-sweeping pitch. The simplest synthesiser on the board.

### How it works

VARI is just two CPU counters driving a square wave: when `LOCNT` underflows, the DAC flips to its low value; when `HICNT` underflows, it flips back to high. The *periods* of those counters (`LOPER` for low, `HIPER` for high) set the half-cycle durations. Equal LOPER/HIPER = symmetric square wave; unequal = duty-cycle skew.

SAW sets `LOPER=$40, HIPER=$01` at fire-time. The wide LOPER + tiny HIPER produces an asymmetric pulse: long low half, short high spike. Then a per-iteration *modulator* (`LOMOD` / `HIEN`) decrements `LOPER` slightly each cycle of the outer loop — so the pitch glides downward as `LOPER` shrinks toward `HIPER`.

For `LOPER = HIPER` you'd get a perfectly symmetric square at that period; the practical descending-saw effect comes from the asymmetric setup PLUS the period decay.

### What to watch

- VARI engine view — two countdown bars (LOCNT/LOPER and HICNT/HIPER) plus a one-period duty-cycle preview that's wide on one side, narrow on the other.
- `LOPER` slowly shrinking — drag the slider to override it (Pattern 5).
- Spectrogram — descending fundamental + harmonics characteristic of a swept square.

### Key code paths

- `VARILD` — preset loader (copies the SAW preset bytes into the VARI cells).
- `VARI` at `$F82A` (Defender) / `$F4F0` (Robotron) — the LOCNT/HICNT inner loop.
- Source: `VSNDRM1.SRC:194` (Defender VARILD), `VSNDRM1.SRC:208` (VARI inner loop).

### See also

- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §VARI duty-cycle square
- [MANUAL.md](../../MANUAL.md#tutorial-7--whatif-drag-a-parameter-slider) Tutorial 7 — drag the LOPER slider

---

## FOSHIT — Foe-hit (short VARI saw)

**Engine:** VARI · **Games:** defender, stargate, robotron

> Same engine as SAW, but `LOPER=$28` (vs SAW's $40) — narrower initial low-half period, higher fundamental, and a shorter cycle count. The brief 'hit confirmed' blip when you destroy an enemy.

### How it works

Comparing SAW and FOSHIT bytes side-by-side:

```
SAW    $40, $01, $00, $10, $E1, $00, $80, $FF, $FF
FOSHIT $28, $01, $00, $08, $81, $02, $00, $FF, $FF
```

Three meaningful deltas:

1. `LOPER` shrinks from $40 to $28 → fundamental jumps an octave-ish higher (smaller period = higher pitch).
2. The 4th byte (HIDT?) drops from $10 to $08 → faster per-iteration high-side decrement, so the sweep proceeds in *bigger* steps and the sound ends sooner.
3. The 5th byte (HIEN/HIEN-related) changes $E1 → $81 → the high bit set there changes the modulator's sign in the same way QUASAR does, but with the smaller LOPER it gives a different character: snappy, percussive, short.

Net: a high, short, sweeping 'pew' — appropriate for a per-kill blip where SAW's longer descent would feel wrong.

### What to watch

- VARI engine view — LOCNT bar smaller than for SAW, sound finishes faster.
- A/B diff vs SAW — see the 3-byte preset difference.

### Key code paths

- `FOSHIT` VARI preset at `VSNDRM1.SRC:1007`.
- Same `VARILD` / `VARI` engine code as SAW + QUASAR + CABSHK.

### See also

- **SAW** ($1D) — longer, lower variant. A/B against FOSHIT.
- **QUASAR** ($1F) — VARI with reverse polarity.
- **CABSHK** — fourth VARI preset, used internally by `SP1` (spinner).

---

## QUASAR — Reverse-polarity VARI zap

**Engine:** VARI · **Games:** defender, stargate, robotron

> VARI with `HIPER` initialised to `$81` (bit 7 set). That high bit flips the sweep direction in the period-modulator math — instead of ramping period *down* over time (like SAW), QUASAR ramps it *up*, giving an upward-bending zap.

### How it works

All four VARI presets share the same engine code; what they differ in is the parameter block in `VVECT`. Comparing SAW and QUASAR's first two bytes:

```
SAW    $40, $01, ...   ; LOPER=$40, HIPER=$01
QUASAR $28, $81, ...   ; LOPER=$28, HIPER=$81
```

`HIPER=$81` has bit 7 set. When the VARI modulator updates HIPER each outer iteration, it treats that high bit as a sign-like flag — the *direction* of the per-cycle period change is reversed. Net result: where SAW's period shrinks (frequency rises… wait, the catalogue says SAW *descends*, so period actually grows), QUASAR's period evolves in the opposite direction, giving the characteristic upward-bend 'zap' character.

The other deltas in the preset bytes (LODT/HIDT/HIEN/LOMOD modulator rates) further shape how steep the bend is.

### What to watch

- VARI engine view's HICNT/HIPER bar evolving opposite-to-SAW's pattern.
- Compare against SAW (`$1D`) in the A/B diff — both VARI, ~5 bytes of preset difference, very different timbre.
- Spectrogram — upward-bending pitch curve.

### Key code paths

- `QUASAR` VARI preset at `VSNDRM1.SRC:1008`.
- `VARILD` loader (`VSNDRM1.SRC:194`) copies the preset into the VARI cells.
- `VARI` inner loop (`VSNDRM1.SRC:208`) — shared with SAW / FOSHIT / CABSHK.

### See also

- **SAW** (`$1D`) — same engine, opposite sweep direction. A/B them to hear the polarity flip.
- **FOSHIT** (`$1E`) — third VARI preset, shorter version of SAW.
- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §VARI duty-cycle square

---

## SP1 — Spinner #1 / cabinet shake

**Engine:** VARI · **Games:** defender, stargate, robotron

> The fourth VARI preset (`CABSHK`), wrapped by a small dispatcher that *advances* the pitch each fire. Each time the player nudges the spinner, the sound starts one step higher than last time — the per-trigger pitch advance is what makes it feel responsive.

### How it works

SP1 isn't strictly a VARI preset on its own — it's a small dispatcher that uses the `CABSHK` VARI preset bytes but maintains state across fires. Each call increments a counter that shifts the starting `LOPER` upward by a fixed step.

The audible result: rapid spinner gestures produce a *rising* arpeggio of brief square-wave blips, not a single repeated tone. That's the difference between a 'lifeless' spinner sound and one that responds to player intention.

The 4th VARI preset (`CABSHK`) parameters at `VSNDRM1.SRC:1009`:

```
CABSHK $FF, $01, $00, $18, $41, $04, $80, $00, $FF
```

Wide LOPER ($FF = max), tiny HIPER ($01) — like SAW but bigger initial period.

### What to watch

- VARI engine view — LOCNT bar swings wide on first fire, then narrower on each subsequent fire as SP1's per-fire dispatcher steps up the starting period.
- Fire `$0E` rapidly to hear the rising arpeggio.

### Key code paths

- `SP1` dispatcher + `CABSHK` VARI preset at `VSNDRM1.SRC:1009`.
- Shares the `VARI` inner loop with SAW / FOSHIT / QUASAR.

### See also

- **SAW / FOSHIT / QUASAR** — the other VARI presets.
- **SPNRV** — GWAVE-side spinner sound (compare timbres).

---

## MOSQTO — Mosquito high tone

**Engine:** VARI · **Games:** robotron

> Robotron-only VARI preset with very small `LOPER` and `HIPER` — produces a high-pitched buzzing tone, the warning sound when a mosquito enemy approaches.

### How it works

MOSQTO sets both LOPER and HIPER to small values (high fundamental frequency), with a subtle modulator that makes the pitch wobble like an insect's flutter. Same VARI inner loop as SAW; differs only in the preset bytes.

### What to watch

- VARI engine view — both LOCNT and HICNT bars are short (high frequency).
- Spectrogram — high-pitched fundamental with subtle modulation.

### Key code paths

- `MOSQTO` VARI preset in Robotron's `VVECT`.
- Source: `VSNDRM3.SRC`.

### See also

- **SAW** — canonical VARI card.
- **FOSHIT / QUASAR** — Defender VARI variants.

---

## CANNON — Filtered-noise cannon

**Engine:** FNOISE · **Games:** defender, stargate, robotron

> A 16-bit frequency accumulator (`FHI:FLO`) sloped up then down between 0 and `FMAX`, with random-distortion modulation, gated by a sample countdown. The percussive cannon thump.

### How it works

FNOISE (filtered noise) is the percussion engine: cannon, thrust, BG1. A 16-bit accumulator at `$14:$15` (Defender) holds the current 'frequency' — actually a tick-rate for the DAC pulses. Each iteration adds or subtracts a small delta to the accumulator (controlled by `FDFLG`: 0 = sloping up, non-zero = sloping down), and when the high byte rolls past a threshold the DAC toggles.

`FMAX` is the *peak* the accumulator is allowed to reach — when `FHI` reaches `FMAX`, the engine flips `FDFLG` and starts sloping back down. Combined with `DSFLG` (distortion enable), the result is a rising-then-falling pitch swept *with* a noise component layered in — that's the 'thump-then-roar' of a cannon shot.

`SAMPC` counts down the total samples for the burst. When it underflows, the sound ends.

### What to watch

- FNOISE engine view — current `FREQ` bar relative to `FMAX` peak, `SAMPC` countdown bar, slope arrow (↑/↓), distortion LED (on/off).
- `FDFLG` flipping when `FREQ` reaches `FMAX` — that's the slope direction change.
- Spectrogram — single-pitch sweep upward + downward, broadened by the distortion if `DSFLG` is set.

### Key code paths

- `CANNON` at `$F920` (Defender) — preset loader: sets `FMAX`, initial `FHI:FLO`, `SAMPC`, `FDFLG=0`, `DSFLG`.
- `FNOISE` — generic inner loop reused by CANNON, THRUST, BG1.
- Source: `VSNDRM1.SRC:353` (Defender CANNON), `VSNDRM1.SRC:364` (FNOISE inner loop).

### See also

- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §FNOISE filtered noise
- Compare CANNON vs THRUST vs BG1 (all FNOISE presets) in the A/B diff

---

## THRUST — Ship-thruster whoosh

**Engine:** FNOISE · **Games:** defender, stargate, robotron

> FNOISE without distortion: a clean low-frequency noise drone. Defender's player-ship-thruster whoosh — fires repeatedly while the player holds thrust.

### How it works

THRUST shares its inner loop with `CANNON` and `BG1` — the FNOISE engine that runs the `FHI:FLO` accumulator → DAC ripple. But where `CANNON` enables `DSFLG` (random-distortion modulation, sets `FMAX`=$FF for a loud peak) and frames itself as a finite burst, THRUST is the *minimal* configuration: distortion off, low `FMAX`=3, no sample countdown — just a continuous-ish drone with mostly-zero high byte.

The game CPU re-fires `$16` every few frames while the thrust key is held, so what you hear is a *stuttered* drone — each fire is a fresh ~5 s decay (the explorer's render cap), but in the game new fires keep arriving so the drone sustains.

### What to watch

- FNOISE engine view — `FREQ` bar stays low (FMAX=3 is tiny), distortion LED **off**.
- Compare against CANNON: CANNON has the LED on and a high `FMAX`; THRUST does not.
- Spectrogram — broad low-frequency band, no upward sweep (since `FMAX` is low and reached almost immediately).

### Key code paths

- `THRUST` at `$F940` (Defender) — sets `DSFLG=0`, `B=3` (= `FMAX`), jumps to `FNOISE`.
- Shares `FNOISE` inner loop with `CANNON` and `BG1`.
- Source: `VSNDRM1.SRC:346`.

### See also

- **CANNON** — same engine with distortion on + bigger amplitude. Compare them via the A/B diff.
- **BG1** — another FNOISE preset, configured as a background loop.
- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §FNOISE

---

## BG1 — Background drone (engine layer)

**Engine:** FNOISE · **Games:** defender, stargate, robotron

> An FNOISE preset configured as a *background* loop — the IRQ handler polls `BG1FLG` after each command and re-enters the BG1 routine, keeping the drone sustained between sound-effect bursts. How Defender does 'continuous background music' without giving up the single sound CPU.

### How it works

FNOISE itself is a one-shot — it counts down `SAMPC` and ends. Continuous backgrounds are achieved by a control-flow trick: `BG1` sets `BG1FLG` non-zero so that the IRQ handler's tail (`IRQ3`) jumps back into `BG1` instead of spinning at `BEQ *` after each foreground sound finishes. So the engine drones for ~5 s, finishes, and would normally idle — but the IRQ tail keeps re-arming it.

The game CPU also fires `$10 BG2INC` periodically; each pulse ticks `BG2FLG` and (depending on the routine) modifies BG1's frequency parameters to ramp the drone's pitch upward over time — that's the 'tension rising' effect in Defender gameplay.

`$13 BGEND` is the off-switch: clears `BG1FLG` and `BG2FLG`, so the next IRQ-3 sees both at zero and reverts to the silent `BEQ *` idle.

### What to watch

- Stage swimlane — `BG1` band recurring at the bottom every IRQ tick.
- FNOISE engine view bars and slope LEDs.
- Try firing `$0F` (BG1), then `$10` a few times (BG2INC ratchets pitch up), then `$13` (BGEND) to silence.

### Key code paths

- `BG1` at `$F8A2` (Defender) — sets `BG1FLG`, configures FNOISE, then jumps to FNOISE inner loop.
- `IRQ3` exit path — checks `BG1FLG`/`BG2FLG`, re-enters BG1/BG2 if non-zero.
- Source: `VSNDRM1.SRC:338`.

### See also

- **BG2INC** (`$10`) — ratchets the BG drone pitch upward over time.
- **BGEND** (`$13`) — clears both BG flags.
- [MANUAL.md](../../MANUAL.md#common-pitfalls) — note that `$13` alone is silent (it just clears flags).

---

## BG2INC — Background tension ratchet

**Engine:** — · **Games:** defender, stargate, robotron

> Not an audible sound on its own — `$10` increments `BG2FLG` (and on Robotron, also touches a BG2-specific FNOISE preset). The cumulative effect over multiple fires: the BG1 drone climbs in urgency. Defender's wave-pressure-rising mechanic.

### How it works

The main game CPU fires `$10` every time the on-screen enemy count crosses a threshold. The sound CPU's handler increments `BG2FLG` (and on Robotron, also touches `FREQ1`/`FREQ2` cells used by a turbine-like FNOISE preset). Once `BG2FLG` is non-zero, the IRQ-3 tail switches from polling `BG1` to a more frenetic BG2 loop — same FNOISE engine, different parameters.

Fire `$10` a few times in a row and the drone audibly ramps up. Fire `$13` (`BGEND`) to silence both layers.

### What to watch

- Fire `$0F` first (BG1 drone), then `$10` repeatedly (1, 2, 3 times) — listen for the pitch / energy climbing.
- Stage swimlane — BG1 / BG2 bands alternating as the IRQ tail picks which to re-enter.

### Key code paths

- `BG2INC` increments `BG2FLG` (`VSNDRM1.SRC:666`).
- IRQ-3 tail's `BG1FLG`/`BG2FLG` check decides which background re-enters.

### See also

- **BG1** ($0F) — the drone that BG2INC modulates.
- **BGEND** ($13) — silence both layers.

---

## BGEND — End background

**Engine:** — · **Games:** defender, stargate, robotron

> Clears `BG1FLG` and `BG2FLG`. Silent on its own; *re-silences* the BG drones that BG1 / BG2INC armed earlier. Without this, the background never stops.

### How it works

`$13` is the only mechanism the main game CPU has for *ending* the background music — there's no time-based fade-out, no decay envelope. The sound CPU's `BGEND` handler simply zeroes the two flag cells, so the next IRQ-3 tail evaluation sees both at zero and reverts to the silent `BEQ *` idle.

If you fire `$13` without previously firing `$0F` (BG1) or `$10` (BG2INC), nothing audible happens — there are no flags to clear.

### What to watch

- Log line should report `Fired $13` but the explorer's render produces no DAC events (the corpus marks it `∅ no DAC events`).
- The audible test: fire `$0F`, hear the drone, then fire `$13` and confirm silence.

### Key code paths

- `BGEND` clears `BG1FLG` / `BG2FLG` (`VSNDRM1.SRC:659`).

### See also

- **BG1** ($0F) — the engine BGEND silences.
- **BG2INC** ($10) — the modulator BGEND also silences.

---

## HBOMB — H-bomb noise

**Engine:** FNOISE · **Games:** robotron

> Robotron's FNOISE preset for the big H-bomb explosion — long sustain, high `FMAX`, max distortion. Where CANNON is a percussive pop, HBOMB is a sustained roar that decays over seconds.

### How it works

Same FNOISE engine as CANNON; differs in preset bytes — bigger `SAMPC` (longer total duration), `FMAX` at max ($FF), `DSFLG` on (full distortion). The result is a long, broad noise-burst that *feels* like an explosion shockwave rather than CANNON's instant thump.

### What to watch

- FNOISE engine view — `SAMPC` countdown takes seconds to drain (vs CANNON's ~1 s).
- Distortion LED on; spectrogram shows broadband noise across the whole range.

### Key code paths

- `HBOMB` preset entry — sets FMAX=$FF, DSFLG on, SAMPC large; jumps to FNOISE.
- Source: `VSNDRM3.SRC` (Robotron).

### See also

- **CANNON** — short FNOISE burst.
- **THRUST** — quiet FNOISE drone.
- **CDR** — composite noise engine using parallel FNOISE-like oscillators.

---

## RADIO — Radio chatter

**Engine:** RADIO · **Games:** defender, stargate, robotron

> A 16-byte sample loop, read repeatedly and output to the DAC. Not a *synthesis* engine — actual sampled audio (a 16-byte LUT) played back at fixed rate. The intercom-static chatter Defender uses for cinematic moments.

### How it works

Unlike LFSR / VARI / GWAVE / FNOISE which *generate* samples algorithmically, RADIO simply loops over a small lookup table (`RADSND`) and writes each byte to the DAC. The 16 bytes (`$8C, $5B, $B6, $40, $BF, $49, $A4, $73, $73, $A4, $49, $BF, $40, $B6, $5B, $8C`) form a symmetric waveform that approximates radio-static-like noise when looped fast.

This is the closest thing to a 'sample' in the Williams sound ROM — and at 16 bytes, the smallest one possible.

### What to watch

- Byte tape — repeating 16-byte pattern visible as a steady cycle.
- Stage swimlane — single `RADIO` band for the duration.

### Key code paths

- `RADIO` routine + `RADSND` 16-byte LUT.
- Source: `VSNDRM1.SRC:1020` (`RADSND` LUT) and the RADIO routine entry.

### See also

- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §RADIO

---

## SCREAM — Death scream

**Engine:** SCREAM · **Games:** robotron

> Four detuned voices summed at the DAC. Each voice cascades into the next as its FREQ counts down to a trigger threshold — what you hear is voices entering one by one and decaying at slightly different rates.

### How it works

SCREAM (Robotron `$1A`) is a 4-voice additive synthesiser. The state lives at `STABLE` ($12) as 4 × (FREQ, TIMER) pairs. The inner loop walks all 4 voices each iteration: `TIMER += FREQ`; if the result is negative (bit 7 set), add an amplitude value to the output accumulator. After 4 voices, write the accumulated sum to the DAC.

Each voice's amplitude is *half* the previous one (`LSR TEMPA` shrinks the contribution per voice). So voice 0 contributes 128, voice 1 contributes 64, voice 2 contributes 32, voice 3 contributes 16 — the classic 'first voice dominates, others colour' arrangement.

The cascade: SCREAM starts with voice 0's FREQ at `$40` and the others at 0. Each outer-loop iteration the active voices' FREQ values are decremented (`DEC FREQ,X`). When a voice's FREQ reaches `$37`, it triggers the *next* voice by writing `$41` to its FREQ cell — so voice 1 starts a few hundred ms after voice 0, voice 2 a few hundred ms after that, etc. The 'swarm of detuned voices' effect.

### What to watch

- SCREAM engine view — four phase wheels (one per voice) + paired FREQ/TIMER bars. Watch the voices spawn one at a time.
- Try the **Build-up ↑** / **Tear-down ↓** sequencer in the SCREAM pane — mutes individual voices on a 700 ms timer so you can hear each contribution in isolation.
- Voice mute checkboxes — Pattern 4 control gates each voice's TIMER write so its `ADDA TIMER,FREQ` stays positive → no contribution to the DAC sum.

### Key code paths

- `SCREAM` at `$F87A` (Robotron) — preset init: zero all FREQ/TIMER, set voice 0's FREQ to `$40`.
- `SCREM3` — inner per-voice loop: TIMER += FREQ, BPL skip, ADDB TEMPA.
- `SCREM5..SCREM7` — outer per-voice loop: decrement each FREQ, trigger next voice if `FREQ == $37`.
- Source: `VSNDRM3.SRC:1290`.

### See also

- [docs/robotron_sound_catalogue.md](../catalogue/robotron_sound_catalogue.md) §SCREAM
- [MANUAL.md](../../MANUAL.md#tutorial-7--whatif-drag-a-parameter-slider) Tutorial 7 — Pattern 5 sliders
- Pattern 4 voice mute — turn voices on/off one at a time

---

## ORGANT — Organ tune (Beethoven's 9th on Robotron)

**Engine:** ORGAN · **Games:** defender, stargate, robotron

> An *arm-only* command — `$1B` decrements `ORGFLG` and RTSes; the tune actually plays on the *next* IRQ, which reads its command byte as the tune index. Robotron's tune 2 is Beethoven's 9th. The polyphony is bitmask-popcount across 8 oscillators.

### How it works

ORGAN is unusual in three ways.

First, it's a *two-step* command. Firing `$1B` doesn't play anything — it just decrements `ORGFLG`. The actual playback lives at the *top* of the IRQ handler: `LDAB ORGFLG; BEQ skip; JSR ORGNT1`. The next IRQ that arrives (any command) checks `ORGFLG`, sees it non-zero, and runs the tune player with that IRQ's command byte as the tune number. The explorer auto-pulses `[$1B, tune_index]` on a single click so a Fire on `$1B` actually plays the tune.

Second, the polyphony is *bitmask popcount*. Each note in `ORGTAB` has an `OSCIL` byte where each of 8 bits represents one oscillator voice. The inner loop (`ORGAN1`) reads `OSCIL`, computes its popcount, and writes that as the DAC output. So an 8-bit-set OSCIL = 8-voice loud chord; 1-bit-set = single soft voice. Six voices simultaneously from a single byte.

Third, the note tables use a *self-modifying scratchpad* (`RDELAY`, 60 bytes at `$15..$50` on Robotron). `ORGANL` (loader) writes a sequence of inline `NOP` and `JMP` opcodes into RDELAY before each note, then the inner loop literally *executes* RDELAY as code — the NOP count produces the per-sample delay (= pitch), the JMP terminates the run. Yes, code-as-data.

Robotron's `ORGTAB` has two tunes: FIFTH (Close Encounters 5-note motif) and NINTH (Beethoven's 9th — the wave-start jingle).

### What to watch

- ORGAN engine view — 8 LEDs showing the current OSCIL bitmask (popcount = audible voice count) + 60-byte RDELAY heatmap.
- DUR (16-bit duration counter) and OSCIL changing per note in the tune.
- **OSCIL voice mute checkboxes + Build-up / Tear-down** in the ORGAN pane — sequences voices on/off so you can hear the popcount-polyphony technique build the chord up bit by bit.
- Stage swimlane — alternating bands of `ORGNT4` (tune loop), `ORGANL` (per-note loader), `ORGAN1` (sample output).

### Key code paths

- `ORGANT` at `$F8C9` (Robotron) — literally `DEC ORGFLG; RTS`. See `MANUAL.md` 'Why $1B is special' for the IRQ trace.
- `ORGNT1` / `ORGASM` — IRQ-time tune kicker: reads tune index from A, walks ORGTAB to the right tune, loops through notes calling `ORGANL`.
- `ORGANL` — note loader: writes the per-note delay sequence into RDELAY (self-modifying code setup).
- `ORGAN1` — sample output: popcount OSCIL → DAC, jump through RDELAY for per-sample timing.
- Source: `VSNDRM3.SRC:1334` (Robotron).

### See also

- [MANUAL.md](../../MANUAL.md#why-1b-organt-is-special) — Why $1B is special (the arm-then-kick IRQ trace)
- [docs/robotron_sound_catalogue.md](../catalogue/robotron_sound_catalogue.md) §ORGAN tunes
- [docs/synthesis_techniques.md](../hardware/synthesis_techniques.md) §ORGAN popcount-polyphony

---

## ORGANN — Organ note (Defender only; multi-byte protocol)

**Engine:** ORGAN · **Games:** defender

> A *four-byte* command sequence. `$1C` alone just arms `ORGFLG = 3`; the next three IRQs deliver `osc-hi / osc-lo / note#` data bytes that build up the OSCIL bitmask + note. Lets Defender's main CPU compose ad-hoc organ notes outside the pre-built ORGTAB tunes. Gutted to a single `RTS` on Stargate and Robotron.

### How it works

Defender's `$1C` is `LDAA #3; STAA ORGFLG; RTS` — sets the flag and bails. The IRQ tail then takes a *different* branch in the ORG-flag check: positive ORGFLG → `JSR ORGNN1`, which DECs ORGFLG, shifts OSCIL left by 4 bits, and ORs in the latest command byte. After three more IRQs (each fed a data byte by the game CPU), ORGFLG hits 0 and ORGNN2 actually plays the assembled note via the same OSCIL+RDELAY engine that ORGANT uses.

The explorer's cmdInfo panel renders a small picker (osc / dly / note) on Defender so you can fire all 4 bytes in sequence with one click.

### What to watch

- ORGAN engine view's OSCIL byte building up over 3 successive IRQ ticks.
- Stage swimlane — three quick `ORGNN1` bands followed by ORGNN2 → ORGANL → ORGAN1.
- On Stargate / Robotron firing `$1C` is silent — the routine is a `RTS` placeholder.

### Key code paths

- `ORGANN` at the Defender ORGAN entry (`VSNDRM1.SRC:554`) — `LDAA #3; STAA ORGFLG; RTS`.
- `ORGNN1` / `ORGNN2` — the multi-IRQ note-builder.

### See also

- **ORGANT** ($1B) — sibling, plays pre-built tunes from ORGTAB.
- [MANUAL.md](../../MANUAL.md#common-pitfalls) — note that Stargate/Robotron `$1C` is gutted.

---

## HYPER — Hyperspace warp

**Engine:** (special) · **Games:** defender, stargate, robotron

> Not a generic-engine preset — a hand-coded PWM (pulse-width modulated) sweep with a hard-coded delay loop. The whoosh-bloop of the player using hyperspace to escape danger.

### How it works

Unlike most Defender sounds (which dispatch to one of the seven engines), HYPER is its own little ~30-instruction routine. It walks two counters: a `TEMPA` sweep target and an inline `DECB` delay loop that controls the per-cycle period. Each pass writes a fresh PWM value to the DAC, with the duty cycle determined by where `TEMPA` falls in its sweep.

The result is a clean, *non-noise*, *non-wavetable* warble that descends in pitch and then disappears — distinctive from anything the GWAVE / VARI / FNOISE / LFSR engines produce. This is what 'special-purpose code' looks like when the standard engines don't fit the brief.

### What to watch

- Stage swimlane — the whole sound lives inside the `HYPER` / `HYPER1..HYPER4` band — no engine slot populates because none of the engine-state extractors recognise these PC addresses.
- Spectrogram — descending fundamental that fades rapidly into silence.

### Key code paths

- `HYPER` at `$F8FA` (Defender) — main loop, sets `TEMPA` initial value.
- `HYPER1` / `HYPER2` / `HYPER3` / `HYPER4` — nested counters that produce the PWM ripple.
- Source: `VSNDRM1.SRC:456`.

### See also

- Compare against `LITE` (LFSR) and `SAW` (VARI) to hear what a special-purpose routine adds beyond the standard engines.
- [docs/defender_sound_catalogue.md](../catalogue/defender_sound_catalogue.md) §Special routines — HYPER, HBOMB, KNOCK, ZIREN, WHIST are all hand-coded.

---

## HUNV — 100-point rescue jingle (Robotron)

**Engine:** GWAVE · **Games:** robotron

> Bright climbing GWAVE preset celebrating a 100-point human rescue. Wavetable + ascending pattern, longer than DP1V but punchier than HBDV.

### How it works

GWAVE preset specific to Robotron's `$20` slot. Uses a square/sine hybrid wavetable and a short ascending pattern (`HBTSND`) — produces a confident "ding-dong-ding" sweep that signals "you saved someone, +100 points".

### What to watch

- GWAVE engine view — climbing pitch pattern, short total duration.
- Stage swimlane — single band of HUNV / GWLD / GWAVE.

### Key code paths

- `HUNV` preset in Robotron's `SVTAB` (line 2009 of `VSNDRM3.SRC`).

### See also

- **GDYUKV** ($28) — Family-rescue jingle, related-but-different.
- **HBDV** — canonical GWAVE card.

---

## SPD — Speedy GWAVE variant (Robotron)

**Engine:** GWAVE · **Games:** robotron

> Faster-than-HBDV GWAVE preset — same wavetable engine but configured for snappier per-echo timing. Used for spin/speed-related effects.

### How it works

GWAVE preset with smaller `GPER` (shorter wavetable walk period) so the playback rate is faster. Other parameters tuned to feel "speedier" — possibly a higher-pitched wavetable or a faster-decaying FOFSET modulation.

### What to watch

- GWAVE engine view — faster wavetable-cursor walk than HBDV.

### Key code paths

- `SPD` preset in Robotron's `SVTAB`.

### See also

- **HBDV** — canonical GWAVE card.

---

## SPNV — Spinner-alt GWAVE preset (Robotron)

**Engine:** GWAVE · **Games:** robotron

> Robotron alternative to `SPNRV` — different wavetable / period combination, used in some spinner contexts.

### How it works

GWAVE preset, short-echo, single-period — same family as SPNRV but with its own preset bytes. Useful as an A/B comparison against SPNRV to hear how two different parameter choices produce different perceived "spinner gestures".

### What to watch

- A/B vs SPNRV in the diff panel.

### Key code paths

- `SPNV` preset in Robotron's `SVTAB`.

### See also

- **SPNRV** — Defender's canonical spinner-drip preset.
- **HBDV** — canonical GWAVE card.

---

## STRT — Start (Robotron YUKSND)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset using the `YUKSND` pitch pattern — a custom multi-step climb. Plays at level start as the "go!" cue.

### How it works

GWAVE preset bytes: `FCB $13, $10, $00, $FF, $00, 09, YUKSND-GFRTAB` (Robotron `VSNDRM3.SRC:2012`). The 7th byte `YUKSND-GFRTAB` indexes into the master frequency table; YUKSND is a per-note delta sequence that the GWAVE engine walks through to produce a multi-step pitch climb. The 9-iteration echo count (the `09` byte) gives it more pulses than DP1V.

### What to watch

- GWAVE engine view — pattern walks through YUKSND deltas.

### Key code paths

- `STRT` preset at `VSNDRM3.SRC:2012`.

### See also

- **HBDV** — canonical GWAVE card.
- **GDYUKV** ($28) — another YUKSND-based preset.

---

## SP1V — Spinner-1 (Robotron, SP2SND)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset using the `SP2SND` pattern — Robotron's primary spinner-feedback sound. Different parameters from SPNV / SPNRV.

### How it works

GWAVE preset with `SP2SND` pitch table. SP1V is Robotron's main "spinner clicked" feedback — short, punchy, with a distinctive pitch envelope.

### What to watch

- GWAVE engine view's cursor walking SP2SND quickly.

### Key code paths

- `SP1V` preset in Robotron's `SVTAB`.

### See also

- **SPNV / SPNRV** — companion spinner-feedback presets.

---

## SSPV — Sub-spinner (Robotron)

**Engine:** GWAVE · **Games:** robotron

> A "soft spinner" GWAVE preset — even shorter than SPNV / SPNRV. Used for very-light interactions.

### How it works

GWAVE preset with minimal echo count and gentle wavetable. The shortest GWAVE preset in Robotron's catalogue.

### What to watch

- Total duration is the shortest of the Robotron spinner family.

### Key code paths

- `SSPV` preset in Robotron's `SVTAB`.

### See also

- **SPNV / SPNRV / SP1V** — full spinner family.

---

## BMPV — Bump (Robotron, BWSSND)

**Engine:** GWAVE · **Games:** robotron

> The "bump into a wall" sound — short percussive GWAVE preset using the `BWSSND` pitch pattern.

### How it works

GWAVE preset with `BWSSND` pattern — a 2-3 byte sequence designed to feel like a brief percussive thud. Echo count is small (3-4) so total duration is under 100 ms.

### What to watch

- Stage swimlane — single short band.

### Key code paths

- `BMPV` preset in Robotron's `SVTAB`.

### See also

- **HBDV** — canonical GWAVE card.

---

## WIRDV — Weirdo / electrode (Robotron)

**Engine:** GWAVE · **Games:** robotron

> Idiosyncratic GWAVE preset — uses a different wavetable + offset combination than the canonical presets, producing the "electrode hum" character. Catalogue note: `$0D` byte at the end (= 13 decimal).

### How it works

GWAVE preset with bytes `FCB $21, $30, $00, $FF, $00, 27, $0D`. The `$0D` final byte is unusual — different from the typical `XXXSND-GFRTAB` pattern. Possibly directly addresses a small constant pattern.

### What to watch

- GWAVE engine view's `FOFSET` and pattern walk — different shape than HBDV / STDV.

### Key code paths

- `WIRDV` preset in Robotron's `SVTAB`.

### See also

- **HBDV** — canonical GWAVE card.

---

## GDYUKV — Family-rescue jingle ("good yuk", Robotron)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset using `YUKSND` — the longer cousin of STRT. Plays when the player rescues an entire family of humans.

### How it works

Similar to STRT but with different initial parameters (longer duration, possibly higher pitch). The `YUKSND` pattern provides the rising motif; GWAVE renders it through the standard wavetable engine.

### What to watch

- Compare against STRT in the A/B diff — both use YUKSND but the surrounding preset bytes differ.

### Key code paths

- `GDYUKV` preset at `VSNDRM3.SRC:2017`.

### See also

- **STRT** ($23) — shorter sibling using the same YUKSND pattern.
- **HUNV** ($20) — 100-point single-rescue.

---

## BK8 — Back-8 cool-down (Robotron)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset with `COOLDN-GFRTAB` pattern — descending tones marking a cool-down period. Robotron's variant on Defender's `CLDWNV`.

### How it works

GWAVE preset bytes pointing at the `COOLDN` pattern in `GFRTAB`. Each echo iteration steps down through the pattern, producing a descending arpeggio similar to CLDWNV's shape.

### What to watch

- GWAVE engine view — descending pattern walk.

### Key code paths

- `BK8` preset in Robotron's `SVTAB`.

### See also

- **CLDWNV** ($09) — Defender's similar descending sound.

---

## SF10 — S/F 10 (Robotron, STDSND-based)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset using the `STDSND` pattern (39-step) — long, evolving timbre. Used for cinematic transitions.

### How it works

The 39-step `STDSND` is one of Robotron's longest pitch patterns. SF10 uses it with `$41, $02, $D0, $00, $00, 39, STDSND-GFRTAB` — short echoes per step but the pattern length itself gives the sound its multi-second character.

### What to watch

- GWAVE engine view — long pattern walk through STDSND.
- Spectrogram — extended evolving timbre.

### Key code paths

- `SF10` preset in Robotron's `SVTAB`.

### See also

- **STDV** ($02) — uses a shorter STDSND-like pattern.

---

## BIL30 — Bill 30 (Robotron, SPNSND-based)

**Engine:** GWAVE · **Games:** robotron

> GWAVE preset using `SPNSND` (the spinner-pattern table). Long, sustained tone used for in-game alerts.

### How it works

GWAVE preset `FCB $03, $15, $11, $FF, $00, 13, SPNSND-GFRTAB`. The 13-iteration echo count + SPNSND pattern produces a sustained alert-like tone.

### What to watch

- GWAVE engine view's `GECNT` counting through 13 echoes.

### Key code paths

- `BIL30` preset in Robotron's `SVTAB`.

### See also

- **HBDV** — canonical GWAVE card.

---

## SND2 — 3-oscillator preset VEC02 (Robotron)

**Engine:** PLAY · **Games:** robotron

> Robotron's `PLAY` engine driven with the `VEC02X` vector. PLAY is a 3-oscillator synthesiser unique to Robotron — three independent frequency counters summed at the DAC. SND2 plays the "vector 02" preset of this engine.

### How it works

The PLAY engine maintains three oscillator pairs `(FREQ_n, COUNTER_n)`. Each sample iteration: every counter advances by its FREQ; when a counter overflows it contributes a fixed amount to the DAC accumulator. The sum of the three contributions becomes the output sample.

`VEC02X` is a 6-byte parameter block defining the three (FREQ, COUNTER_init) pairs. PLAY engine code at `$F046` (per the Robotron labelmap).

### What to watch

- Three distinct pitches audible if the FREQ values are different — three-voice chord.
- Spectrogram — three formants visible simultaneously.

### Key code paths

- `SND2` dispatch entry → loads `VEC02X` and jumps to `PLAY`.
- `PLAY` at `$F046` (Robotron).

### See also

- **SND5 / THNDR / SND16 / SND17** — other PLAY presets.
- [docs/robotron_sound_catalogue.md](../catalogue/robotron_sound_catalogue.md) §PLAY 3-osc engine

---

## SND5 — 3-oscillator preset VEC05 (Robotron)

**Engine:** PLAY · **Games:** robotron

> Another PLAY engine preset. Different (FREQ, COUNTER) triplet than SND2 — different three-voice chord.

### How it works

Same PLAY engine as SND2; `VEC05X` provides the parameter block. The three oscillators produce a different harmonic combination than SND2's chord.

### What to watch

- A/B against SND2 — same engine, different chord.

### Key code paths

- `SND5` dispatch → `VEC05X` → `PLAY`.

### See also

- **SND2** — canonical PLAY card.
- **THNDR** — third PLAY preset.

---

## THNDR — "Thunder" 3-oscillator (Robotron)

**Engine:** PLAY · **Games:** robotron

> PLAY preset designed to evoke distant thunder — low-frequency oscillator dominant, with two slightly-detuned partials adding rumble. Uses `VEC*X` data of its own.

### How it works

The three PLAY oscillators are configured at very low frequencies — close-to-DC waveforms that produce a sub-bass rumble rather than discrete pitches. Slight detuning between the three creates a slow beating effect that mimics thunder rolling.

### What to watch

- Spectrogram — energy concentrated in the low-frequency band.
- All three oscillators audible but very close in pitch.

### Key code paths

- `THNDR` dispatch → its parameter block → `PLAY`.

### See also

- **SND2 / SND5 / SND16 / SND17** — other PLAY presets.

---

## SND16 — 3-oscillator preset VEC016 (Robotron)

**Engine:** PLAY · **Games:** robotron

> PLAY engine with the `VEC016X` parameter block — yet another three-oscillator chord configuration.

### How it works

Same PLAY engine as SND2 etc.; this preset's specific FREQ values give it a distinct character. Treat as another point in the PLAY parameter space.

### What to watch

- A/B against SND2 / SND5.

### Key code paths

- `SND16` dispatch → `VEC016X` → `PLAY`.

### See also

- **SND2** — canonical PLAY card.

---

## SND17 — 3-oscillator preset VEC017 (Robotron)

**Engine:** PLAY · **Games:** robotron

> PLAY engine with the `VEC017X` parameter block. Companion to SND16.

### How it works

Same PLAY engine; different (FREQ, COUNTER) triplet.

### What to watch

- A/B against SND2 / SND5 / SND16.

### Key code paths

- `SND17` dispatch → `VEC017X` → `PLAY`.

### See also

- **SND2** — canonical PLAY card.

---

## HSTD — SING engine with VEC08X + echoes (Robotron)

**Engine:** SING · **Games:** robotron

> Robotron's `SING` engine — a single-oscillator synth with envelope shaping, fed by a parameter vector. HSTD uses `VEC08X` and adds an echo / repeat structure.

### How it works

SING is conceptually simpler than PLAY: one oscillator at a time, but with a more elaborate envelope. Each preset (`VEC08X`, `VEC02X`, etc.) supplies frequency, amplitude, decay rate, and timing parameters. The SING engine code is at `$F349` (per the labelmap).

HSTD specifically adds echo behaviour — the same vector replays multiple times with diminishing amplitude.

### What to watch

- SING-engine state cells (if exposed).
- Spectrogram — single pitch with echo trail.

### Key code paths

- `HSTD` dispatch → `VEC08X` → `SING`.
- `SING` at `$F349` (Robotron).

### See also

- **ATARI / SIREN / ORRRR / PERK / SQRT** — other SING presets.

---

## ATARI — SING engine with VEC02X (Robotron)

**Engine:** SING · **Games:** robotron

> SING preset using `VEC02X` — possibly an homage to a specific Atari arcade sound (the name suggests so).

### How it works

Single-oscillator SING engine with the `VEC02X` parameter block. Different envelope / pitch shape than HSTD.

### What to watch

- SING engine readouts; A/B against HSTD.

### Key code paths

- `ATARI` dispatch → `VEC02X` → `SING`.

### See also

- **HSTD** — canonical SING card.

---

## SIREN — Looping SING (VEC03X → VEC04X) (Robotron)

**Engine:** SING · **Games:** robotron

> SING engine driven with *two* vectors in alternation — `VEC03X` then `VEC04X` then back. Produces the classic two-pitch air-raid siren wail.

### How it works

A small wrapper around SING that alternates between two parameter blocks on each cycle of the engine. The two vectors define the high and low pitches of the siren; the alternation rate sets the warble speed.

### What to watch

- Spectrogram — two pitches alternating in a continuous wail.
- Stage swimlane — repeating SIREN / SING band pairs.

### Key code paths

- `SIREN` dispatch + small alternation wrapper → `SING`.

### See also

- **ZIREN** ($3C) — different siren (air-raid alarm with glissando).

---

## ORRRR — SING engine with VEC05X (Robotron)

**Engine:** SING · **Games:** robotron

> SING preset producing a sustained vocal-ish "orrrr" sound — the name in the source is descriptive of the audible result.

### How it works

SING engine with `VEC05X` — particular envelope + pitch combination that approximates a sustained vocal vowel.

### What to watch

- Spectrogram — single formant cluster.

### Key code paths

- `ORRRR` dispatch → `VEC05X` → `SING`.

### See also

- **HSTD** — canonical SING card.

---

## PERK — SING with VEC06X + ECHO (Robotron)

**Engine:** SING · **Games:** robotron

> SING preset using `VEC06X` and the `ECHO` subroutine — produces a percussive "perky" sound. Source name `PERK$$` (the `$$` is reserved-flag decoration; explainer-card key is `PERK`).

### How it works

SING engine plus an echo wrapper that re-fires the vector with decay. Short fundamental + decaying repeats.

### What to watch

- Echo trails visible in the spectrogram.
- Stage swimlane — `PERK_` / `SING` / `ECHO` bands.

### Key code paths

- `PERK$$` dispatch → `VEC06X` → `SING` + `ECHO`.

### See also

- **HSTD** — canonical SING card.

---

## SQRT — Random-frequency SING zap (Robotron)

**Engine:** SING · **Games:** robotron

> SING engine with the frequency seeded from the LFSR random source — every fire produces a different pitch. The "zap" with unpredictable timbre.

### How it works

Before invoking SING, SQRT reads from the `RANDOM` cell (the LFSR's LO byte, conveniently a free random source) and uses it as the initial frequency. So each fire of `$34` gives a different note — useful for variety in what would otherwise be a repetitive enemy-zap sound.

### What to watch

- Fire SQRT several times in a row and listen to pitch variations.
- Code panel — check `RANDOM` ($06 on Robotron) cell at fire-time.

### Key code paths

- `SQRT` at `VSNDRM3.SRC:622`.

### See also

- **HSTD** — canonical SING card.
- **LITE** — the LFSR that SQRT borrows from.

---

## START — Electric buzzy drone (Robotron)

**Engine:** (special) · **Games:** robotron

> Hand-coded electric / static drone — neither GWAVE nor any standard engine. Plays at "round start" as a tense atmospheric layer.

### How it works

Custom routine that writes alternating high/low values to the DAC at a hand-tuned rate, with periodic interruptions producing the "static" character. Likely uses inline counters and small LUTs rather than one of the standard engines.

### What to watch

- Stage swimlane — `START` band only (no engine slot populates).
- Byte tape — distinctive alternating pattern unlike GWAVE wavetable reads.

### Key code paths

- `START` routine at Robotron's `$35` dispatch entry.

### See also

- **HYPER** — another hand-coded special routine on Defender.

---

## PLANE — Diving plane (incrementing FREQ1) (Robotron)

**Engine:** square · **Games:** robotron

> A single-square-wave oscillator with the `FREQ1` counter incrementing each iteration — so the pitch climbs continuously, then resets. The "diving plane" enemy's approach.

### How it works

PLANE drives a square wave whose period is `FREQ1`. Each outer iteration *increments* `FREQ1` so the period grows (= pitch drops). When `FREQ1` overflows, it wraps back and starts again — the cycle produces the iconic Doppler-effect diving curve.

This is closer in spirit to VARI than to GWAVE — a pure-CPU square wave with a single counter — but with the modulator going in the opposite direction (incrementing vs VARI's decrementing).

### What to watch

- Spectrogram — descending pitch sweep that wraps periodically.
- VARI engine view *won't* populate (different PC range), but the audible character is square-wave-driven.

### Key code paths

- `PLANE` routine at Robotron's `$36` entry.

### See also

- **SAW** — VARI's descending sweep (similar idea, different mechanics).

---

## KNOCK — KNKTAB-driven thud (Robotron)

**Engine:** KNOCK · **Games:** robotron

> A short percussive thud driven by the `KNKTAB` parameter table. Notable in the source: this routine **clobbers `SOUND+2` (PIA control register) directly** to bypass normal data-write path, then restores it on exit. The only routine that does this.

### How it works

KNOCK is unusual at the hardware level. At entry it writes `CLR SOUND+2`, which alters the PIA's port-B configuration. The routine then writes a sequence of bytes from `KNKTAB` (a small parameter table) to the DAC at a fixed rate — using the *altered* PIA state. At exit it restores `SOUND+2` to `#$80` (the normal config).

This trick exists because the standard data-write path adds a few cycles of overhead that throw off the timing of a very short percussive sample. By temporarily reconfiguring the PIA, KNOCK gets a faster write path — at the cost of correctly bracketing the PIA state.

The audible result: a quick, punchy "thunk" with no envelope decay.

### What to watch

- Stage swimlane — single `KNOCK` band, very short (< 100 ms).
- The PIA-control clobber is invisible from outside (the explorer doesn't model PIA-control register state changes for visualization).

### Key code paths

- `KNOCK` at the `$3B` dispatch entry (Robotron). `CLR SOUND+2` at entry; `STAA SOUND+2 / #$80` at exit.
- Source: `VSNDRM3.SRC:500-541` (`KNOCK` routine + `KNKTAB` pattern).

### See also

- [docs/robotron_sound_catalogue.md](../catalogue/robotron_sound_catalogue.md) §KNOCK — notes the PIA clobber.

---

## ZIREN — Air-raid siren / second-order glissando (Robotron)

**Engine:** ZIREN · **Games:** robotron

> Hand-coded *second-order* pitch glissando — the pitch's *rate of change* itself accelerates over time. Produces an air-raid siren that wails ever faster.

### How it works

Where a first-order glissando (like SAW or PROTV) changes pitch linearly, ZIREN's pitch-modulator state has its own acceleration term. Each iteration the *period delta* grows, so the pitch sweep gets steeper as time goes on.

The result is an air-raid-siren-style wail that doesn't just rise-fall — it rises faster and faster, producing the urgent escalating warning.

### What to watch

- Spectrogram — pitch curve that's not a straight line; the slope itself increases.
- Stage swimlane — single `ZIREN` band.

### Key code paths

- `ZIREN` at the `$3C` dispatch entry (Robotron). Special-purpose routine; no shared engine.

### See also

- **SIREN** ($31) — simpler two-pitch alternation.
- **WHIST** — companion specialty routine.

---

## WHIST — "OOOOH NOOOO" falling sine (Robotron)

**Engine:** WHIST · **Games:** robotron

> Hand-coded routine producing a descending sine-ish whistle — the comedic "ohhh nooo" sound when something bad happens. Possibly a riff on the falling-bomb-whistle trope.

### How it works

Custom routine that walks a sine-shape sample table while reducing the playback rate — sine pitch drops continuously. Possibly uses a per-iteration `LDX` into a small sine LUT with `GPER` slowly increasing.

### What to watch

- Spectrogram — descending pure tone.

### Key code paths

- `WHIST` at the `$3D` dispatch entry (Robotron).

### See also

- **PLANE** — similar descending tone but square-wave instead of sine.
- **PROTV** — GWAVE-side descending sound.

---

## CDR — Crowd Roar (Robotron's most elaborate routine)

**Engine:** (composite) · **Games:** robotron

> Two parallel noise oscillators (`CR1`, `CR2`) layered under a sliding referee-whistle sequencer. The whistle reads from an 8-step parameter DSL at `WS1`, where each step is 5 bytes `(WHIS, WFRQ2, DFRQ2, WCNT2, MINWIS)` and a zero terminates the sequence. By far the most software per ROM byte in either Williams sound ROM.

### How it works

CDR is a *small interpreted program* embedded in the ROM. At entry it points X at `WS1` (whistle params), saves to `PTRHI`, and calls `WISLD` (whistle loader) — which reads 5 bytes and configures the whistle oscillator's frequency / decay / counter / minimum. Then it seeds two parallel white-noise oscillators (`CR1` at low decay, `CR2` at upward-sweep) and calls `NINIT` / `NINIT2` to launch them.

The whistle oscillator advances through the WS1 table autonomously — when its current step finishes (counter underflow), it loads the next 5 bytes and the whistle changes pitch/duration smoothly. Eight steps + a `0` terminator = the characteristic 'stadium crowd roar with that wandering referee whistle on top' that Robotron uses for human-rescue moments.

The parameter DSL is the trick: instead of hand-coding each whistle note, the ROM stores them as data that the engine interprets at run time. This is the only Williams sound that has a *script*, not just a preset.

### What to watch

- Stage swimlane — alternating bands of `CDR`, `WISLD`, `NOISLD`, `NINIT`, `NINIT2` as the routine spins through its layers.
- RAM heatmap — the noise + whistle state at `$12..$1F` (Robotron layout) lights up rapidly.
- Spectrogram — two broad noise bands underneath a sliding higher-frequency formant (the whistle).

### Key code paths

- `CDR` entry at `$F84A` (Robotron) — sets up whistle + noise oscillators.
- `WS1` whistle param table at `VSNDRM3.SRC:928` — 8 × 5-byte steps + 0 terminator.
- `CR1` / `CR2` noise param blocks at `VSNDRM3.SRC:937–938`.
- Source: `VSNDRM3.SRC:916`.

### See also

- [docs/robotron_sound_catalogue.md](../catalogue/robotron_sound_catalogue.md) §CDR — full byte-level DSL description.
- [research/findings_robotron_sound.md](../../research/findings_robotron_sound.md) — line-by-line analysis of `WISLD` / `NOISLD` / `NINIT`.
