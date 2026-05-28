# Defender Sound Studio — Prior-Art Reference

> Summary of what to learn from msarnoff's *Defender Sound Studio* (`zapspace.net/defender_sound/`) — the closest existing browser-based exploration tool. Use as input for your own design. Full deep-dive: `research/findings_sound_studio.md`.
>
> **WSED vs. Studio — quick read:** today WSED edits **2 of the Studio's 6 editable engines** (VARI + GWAVE) but across **3 games** instead of 1, and runs the **actual ROMs** instead of a hand-port. **LFSR + FNOISE editors are planned next** (`plans/designer-mode.md` Phases 7 + 8 — research done, byte-level details in `research/findings_designer_feasibility.md`), which closes the per-engine gap. The full feature-by-feature table is in `MANUAL_DESIGNER.md` § *How it compares*.

## What it is

A browser-only re-implementation of Defender's 2 KB sound ROM in plain JavaScript, with tweakable parameters per sound, oscilloscope, FFT, and a JSON preset import/export. Daniel Lopez / msarnoff, December 2020. Released alongside the original `defender.asm` disassembly and `defender.js` source. Robotron is **not** covered — only Defender.

Live URLs:
- App: <https://zapspace.net/defender_sound/>
- Help: <https://zapspace.net/defender_sound/help.html>
- Engine source: <https://zapspace.net/defender_sound/defender.js>
- Annotated disassembly: <https://zapspace.net/defender_sound/defender.asm>

## How it's built

**Quick overview here; the full tutorial is in [§ Under the hood](#under-the-hood--how-an-edit-becomes-sound).** Three ideas explain the Studio's architecture:

1. **It is not a 6800 emulator.** Each ROM subroutine has been **hand-translated to a JavaScript class** — there is no instruction fetch/decode loop, no register file, no opcode dispatch.
2. **Timing is preserved by hand.** Every original 6800 instruction has a cycle-count annotation that the porter copied into a matching `DacSampler.wait(N)` call:

   ```javascript
   // FA1E: F7 04 00      stb  $0400  ; 5~
   this.dacSampler.wait(5);
   ```

   So output timing is cycle-faithful even though no instruction is being fetched at runtime. A small resampler called `DacSampler` carries the 894 kHz CPU pace down to whatever rate the AudioContext is running at (typically 48 kHz).
3. **Audio is delivered through a pull-driven pipeline on the main thread:** `handler → DechunkedStream (×2 − 1 normalise + optional DC blocker) → DechunkedStreamMixer (limiter: none/clip/sine/tanh/atan) → ScriptProcessorNode → AudioContext.destination`. The `ScriptProcessorNode` is deprecated but functional.

Each handler class exposes the same four-method interface — so the rest of the app can drive any sound the same way:

| Method | What it does |
|---|---|
| `setup(params)` | Copy the page's input fields into instance state (`this.lowPartLength`, `this.amp`, …). Called once per Play. |
| `synthOne(out)` | Append the next chunk of audio samples to `out`. Returns `-1` when the sound is finished. |
| `synthAll(out)` | Render the whole sound at once (used for offline export). |
| `runtimeStats()` | Return a small JS object — current phase, current LFSR value, current stage name — for live introspection in the UI. |

## Nine UI tabs map onto three dispatch handlers

The Defender ROM's IRQ dispatcher routes commands to one of three "handlers" (A, B, C); the Studio exposes those handlers plus six special-case Handler B paths as nine tabs (Alt+1..9):

| UI tab | Hotkey | Underlying ROM construct |
|---|---|---|
| G-wave | Alt+1 | Handler A (wavetable / period-curve, 15 presets) |
| Pulses | Alt+2 | Handler C (sliding pulse-train, 4 presets) |
| Smooth noise | Alt+3 | Handler B vectors 1,8,9 (LFSR-target slide) |
| Square noise | Alt+4 | Handler B vectors 3,7 (LFSR-toggled pulses) |
| Sweeps | Alt+5 | Handler B vector 10 (accelerating wavetable) |
| Player shoot | Alt+6 | Handler B vector 6 (decaying LFSR noise burst) |
| Insert credit | Alt+7 | Handler B vector 11 (hardcoded PWM sweep, no params) |
| Humanoid fall | Alt+8 | Handler B vector 12 (4-osc additive, no params) |
| Music | Alt+9 | Note-sequence player (`g_songs[]`) |

(Note: msarnoff's "Handler A/B/C" terminology is just the .asm dispatch routing, not the same as our `docs/synthesis_techniques.md` 1–8 primitive numbering. Cross-walk: Handler A ≈ wavetable+envelope, Handler B ≈ LFSR family, Handler C ≈ pulse-train.)

## What you can edit (the full editable surface)

The Studio exposes **one UI tab per ROM dispatch path**. Most tabs expose the corresponding routine's parameter record as **numeric inputs** — one input per byte of the record — each with an inline tooltip. Two tabs are deliberately bare ("just hit play") because the underlying routine has no parameters in the ROM either. The table below is the at-a-glance summary; the per-engine case studies further down go into depth.

| Studio tab | Underlying ROM construct | Numeric knobs | Editable canvases |
|---|---|---|---|
| **G-wave** | Handler A — wavetable + envelope | 12 fields (see [§ $0A](#0a--gwave-humanoid-scream)) | A wavetable canvas (one wave cycle, redrawable byte-by-byte) **and** a 160-byte period-offset-curve canvas (the pitch contour). |
| **Pulses** | Handler C — sliding pulse-train | 8 fields (see [§ $1F](#1f--vari-quasar)) | — |
| **Smooth noise** | Handler B vectors 1/8/9 — LFSR-target slide | 4 fields (see [§ $16](#16--fnoise-end-of-explosion)) | — |
| **Square noise** | Handler B vectors 3/7 — LFSR-toggled pulses | 3 fields: period, length, period-bend | — |
| **Sweeps** | Handler B vector 10 — accelerating wavetable | 2 fields: wrap-phase, final speed | One 16-cell wavetable canvas. |
| **Player shoot** | Handler B vector 6 — decaying LFSR noise burst | 3 fields: period, initial amplitude, decay speed | — |
| **Insert credit** | Handler B vector 11 — hardcoded PWM sweep | **none** ("just hit play") | — |
| **Humanoid fall** | Handler B vector 12 — 4-oscillator additive | **none** ("just hit play") — see [§ $1A](#1a--scream-4-oscillator-additive) | — |
| **Music** | bundled note songs (not in ROM dispatch) | A free-text score textarea (`timbre, pitch, duration` triplets) + polyphony toggle. | — |
| **(Settings)** | global mixer | Audio buffer size, output gain, polyphony, limiter (`none`/`clip`/`sine`/`tanh`/`atan`), DC-correction strength. | — |

**Why the editable knobs feel so direct.** Each preset in the Studio is stored as a JavaScript array of *the actual record* the Defender ROM fed its sound CPU. The N knobs of a tab map one-to-one to the N bytes of that record. So when you change "Low part length" in *Pulses* you are, conceptually, changing the same byte the ROM would have placed in zero-page RAM. The full list of variable names, ranges, and verbatim tooltips per knob is in `research/findings_sound_studio.md` §2.

## Under the hood — how an edit becomes sound

The Studio's architecture is small. Three ideas explain it: each routine became a JavaScript class, timing is faithful via manually-copied cycle counts, and audio is delivered through a deprecated but functional pull pipeline. Each is below.

### 1. Each ROM routine became a JavaScript class

The Studio is **not** an emulator. There is no 6800, no opcode dispatch, no register file. Instead, *every* routine in the original ROM was rewritten by hand as a JavaScript class with a small, uniform interface:

```js
class Handler {
  setup(params)        // copy the edited input numbers into this.* fields
  synthOne(out) → -1   // produce the next chunk of audio; returns -1 when done
  synthAll(out)        // produce the whole sound at once (offline use)
  runtimeStats() → {…} // live introspection — current phase, lfsr, stage, etc.
}
```

So **an edited parameter is just a JavaScript field**. When you change "Low part length" in the *Pulses* tab and press Play, the app builds a fresh `handlerC` instance and calls `setup()`, which copies your new value into `this.lowPartLength`. From that moment on, the new value is in effect.

The body of `synthOne()` is the routine's control flow rewritten as native JavaScript — with explicit `& 0xFF` and `& 0xFFFF` masks at the places where the original 6800 code would have wrapped naturally on 8-bit or 16-bit operations. That wrap matters: the late "math-error" timbre in echoing sounds is exactly the result of letting `(working_sample - decay) & 0xFF` go negative and wrap, on purpose.

### 2. Timing is faithful even without an instruction loop

This is the clever part. The Motorola 6800 reference manual gives a cycle count for every instruction (`LDAA #imm` = 2, `JSR` = 9, `BNE taken` = 4, etc.). The porter copied those cycle counts as comments *and* made a matching `dacSampler.wait(N)` call. So even though no instruction is being fetched at runtime, output samples land at the right moments:

```js
this.dacSampler.wait(13);              // ; 13~  (cycle count copied from the .asm)
let a = (this.dacValue & 0xFF) >> 3;
a ^= (g_lfsr & 0xFF);                  // the LFSR clock step, rewritten in JS
this.dacSampler.wait(12);              // ; 12~
```

`DacSampler` is the resampler at the heart of all this. It works like a *fractional zero-order-hold*:

- `wait(n)` — "n more 6800 cycles passed at the 3.579545 MHz crystal rate." The sampler just adds them to a running counter.
- `sample(newValue, out)` — "write `newValue` to the DAC right now." The sampler now figures out how many output samples (at `AudioContext.sampleRate × 4`, typically 192 kHz) correspond to the cycles that have been banked. It emits that many copies of the *previous* DAC value (matching how an R-2R ladder physically holds its last write until the next), then stores `newValue` as the new "previous".

You don't need to read every line of `DacSampler` to follow the rest of this document. Just keep these two equations in mind: **`wait(N)` = "time advances by N cycles"** and **`sample(v, out)` = "the DAC now reads `v`."**

### 3. The audio pipeline is pull-driven and runs on the main thread

```
[your edited input fields in the page]
              │
              ▼ Play button
        ┌───────────────┐
        │  handlerX     │   setup(params)   — copies fields into this.* once
        │  (fresh       │
        │   instance,   │   synthOne(out)   — appends floats; returns -1 when done
        │   each Play)  │
        └──────┬────────┘
               │
               ▼
       [DechunkedStream]      ×2 − 1  → range [-1, +1]; optional DC blocker
               │
               ▼
   [DechunkedStreamMixer]     limiter: none / clip / sine / tanh / atan
               │
               ▼
    [ScriptProcessorNode]     deprecated API; runs on the MAIN thread
               │
               ▼
  [AudioContext destination]  → speakers
```

Important consequences of this design:

- **No caching of in-flight audio.** Every Play press destroys the previous handler and constructs a new one from the current input values.
- **A parameter change is inert until the next Play.** There is no live hot-swap: if you change "Low part length" while a sound is playing, the playing sound finishes as-is and your change only takes effect the next time you press Play.
- **Main-thread audio.** `ScriptProcessorNode` is the deprecated predecessor of `AudioWorkletNode`; it still works, but heavy UI work on the same thread can produce audio glitches.
- **Polyphony is opt-in.** A checkbox in *Settings* lets multiple handlers run concurrently — unlike the original hardware, which was strictly monophonic.

(Line cites for any of the above: `research/findings_sound_studio.md` §3, §5, §6.)

## Command-code case studies — how each engine is treated and modified

The Studio's nine tabs are organised by *handler* (A/B/C). Each ROM command lands in exactly one tab — sometimes with full byte-level editability, sometimes with none at all. Five worked examples follow, one per engine our explorer's catalogue distinguishes. Each gives a quick "what you're hearing" intro, lists the editable parameters in a table, and walks through what actually happens between pressing Play and hearing the sound.

### $0A — GWAVE (Humanoid scream)

**What you're hearing.** Command $0A is the *humanoid scream* — the falling, decaying wail you hear when a humanoid is captured in Defender. The GWAVE engine that produces it is essentially a tiny **wavetable synth with an envelope and a pitch-contour player**: one cycle of a small wave (8–72 bytes) is played repeatedly, with a *pitch* read from a 160-byte curve and a *volume* that decays in stages.

**Studio tab.** *G-wave* (Handler A), preset 10 "Humanoid scream".

**The 12 editable fields.** These map one-to-one to the bytes of Handler A's preparation record in the ROM:

| Stage | Field | Range | What it does |
|---|---|---|---|
| Waveform | **Waveform index** | 0–6 | Selects one of 7 hardcoded wave shapes as the starting wave. |
| Waveform | (wavetable canvas) | 0–255 per cell | Or redraw the selected wave sample-by-sample. |
| Decay | **Initial decay amount** | −1…256 | How much to subtract from each sample on the *first* play. Large values wrap (mod 256) and produce the "math-error" timbre. |
| Period | **Base period** | unbounded | Starting pitch — smaller is higher-pitched (period = inverse of frequency). |
| Period | **Range start** | 0–159 | Where in the 160-byte pitch contour to begin. |
| Period | **Range length** | 0–160 | How many bytes of the contour to walk during one play. |
| Period | **Plays per period** | 1+ | How many times to play the wave before advancing one curve byte. |
| Period | (curve canvas) | 0–255 per cell | Redraw the pitch contour byte-by-byte. |
| Echo | **Echo count** | 1+ | Number of decayed echoes after the first play. |
| Echo | **Echo decay amount** | −1…256 | How much to fade each echo (same wrap caveat). |
| Repeat | **Number of repeats** | −1…256 | How many times to repeat the whole assembly (0 means 256). |
| Repeat | **Base-period nudge** | signed | Drift the base pitch between repeats. `0` disables repeats. |
| Code path | **Entry / Exit** | 0–2 / 0–1 | Minor jumps in the original ROM — only used by a few unidentified presets. |

**What happens when you press Play.**

```
[12 input fields + wavetable canvas + curve canvas]
              │
              ▼  Play
       handlerA = new HandlerA()
       handlerA.setup(...)
       │   - copy "handlerA_waveforms[Waveform index]" (or your edited canvas)
       │     into a RAM working copy
       │   - position the curve playhead at "Range start"
       │   - initialise echo + repeat counters
       ▼
       handlerA.synthOne(out)
         for each repeat (0 .. Number of repeats):
           for each play (0 .. Plays-per-period × Echo-count):
             for each byte of the working wave:
               dacSampler.sample(byte, out)             ← write the DAC
               dacSampler.wait(cycleCount)              ← from the .asm; sets pitch
             apply subtractive decay between echoes:
               working[i] -= (original[i] >> 4) * decayReps    ← signed subtract
               working[i] &= 0xFF                              ← the "math-error" wrap
             advance the curve playhead by 1 byte
           nudge the base period by "Base-period nudge"
```

`handlerA.runtimeStats()` returns `{ play, decayReps, periodCurvePos, … }` so you can watch the state evolve while the sound plays.

### $16 — FNOISE (end of explosion)

**What you're hearing.** Command $16 is the *end-of-explosion* tail — the breathy noise after player-death and smart-bomb sounds. Internally it is **smooth noise**: a 16-bit LFSR generates a random *target* byte, and the DAC value *slides smoothly* toward that target rather than jumping. The slide speed feels like the cutoff of a (cheap, integer-arithmetic) low-pass filter; smaller slide speed = wider, softer noise.

**Studio tab.** *Smooth noise* (Handler B vectors 1/8/9), preset "Explosion".

**The four editable controls.**

| Field | Range | What it does |
|---|---|---|
| **Length** | 1+ | How many random target bytes to generate before this pass ends. |
| **Slide speed** | −1…256 | How fast the DAC slides toward each new target. Smaller = slower slide = more low-pass-y. |
| **Randomize** | checkbox | If on, the slide speed jitters each step (the LFSR's high byte is AND-ed into it). |
| **Repeat-loop count** | −1…256 | How many full passes to run before the sound ends. |

**What happens when you press Play.**

```
[length, slide speed, randomize, repeat-loop count]
              │
              ▼  Play
       handler = new HandlerB_1_8_9()
       handler.setup({ length, slideSpeed, randomize, repeats })
       ▼
       handler.synthOne(out)

         loop "stage_slideDacToRandom":              ← a named state in the JS
           for i in 0 .. length:
             clock the LFSR once
                  ↑ uses the "funny" tap:
                    bit = (LFSR_low bit 0) XOR (DAC bit 3)
                    — the DAC value feeds back into the LFSR
             target = LFSR & 0xFF                    ← target byte for this step
             effective = slideSpeed
             if randomize:
               effective &= (LFSR >> 8) & 0xFF       ← jitter the cutoff
             while dac != target:
               dac = step_toward(dac, target, effective)
               dacSampler.sample(dac, out)
               dacSampler.wait(cycleCount)

         on repeat:
           slideSpeed = slideSpeed * 7 / 8           ← exactly 87.5%
           if slideSpeed == 0:
             end sound
           else:
             go back to "stage_slideDacToRandom"
```

The exact wording on the *Smooth noise* repeat-stage panel is verbatim: *"The initial slide speed is reduced to 87.5% of its previous value, and we go back to the beginning. The sound ends when the slide speed reaches zero."*

Two things worth noticing:

- The "funny" LFSR tap feeds the **DAC value's** bit 3 back into the LFSR — not just the LFSR's own taps. That coupling is why the noise's character changes as the DAC trajectory warps under the slide.
- There is **no clipping in the synth**. If a slide pushes the DAC past 0 or 255, it wraps mod-256. Soft saturation (if you want any) happens later, at the mixer's optional limiter stage.

### $1A — SCREAM (4-oscillator additive)

**What you're hearing.** This is the engine our explorer's taxonomy calls SCREAM — the layered, shouting sound. The Studio calls the same routine *Humanoid fall*. Internally it is **four 1-bit square-wave oscillators stacked into the same DAC**, each oscillator's frequency slowly sliding down toward zero. Oscillators are *spawned* over time, and the sound ends only when all four have wound down to silence.

**Studio tab.** *Humanoid fall* (Handler B vector 12).

**Editable controls.** *None.* The panel says, verbatim: *"No presets or parameters here! Just hit play."*

Why none? Because the porter chose not to expose any. Every constant of this algorithm — the seed value, the spawn rule, the four-pair fan-out — is **baked into the JavaScript source code**, not exposed as an input field. To change any of them you would have to edit the JavaScript, not just the page.

**What that fixed algorithm actually does.** The engine's state is **four `(incrementer, phase)` pairs** kept in working memory. Each pair is essentially one 1-bit square-wave oscillator: `incrementer` is its frequency (in funny units), `phase` is its phase accumulator.

```
Initial state:
  pair[0] = (incrementer = 0x40, phase = 0)    ← one oscillator at "frequency 64"
  pair[1..3] = inactive

Every output frame:
  dac = 0
  for k in 0..3 (if pair[k] is active):
    pair[k].phase = (pair[k].phase + pair[k].incrementer) & 0xFF
    if pair[k].phase has its sign bit set (phase ≥ 0x80):
      dac |= (0x80 >> k)                       ← OR a "1" into one of 4 stacked bits
  dacSampler.sample(dac, out)
  dacSampler.wait(cycleCount)

Every 256 frames (the "spawn / decay" tick):
  for k in 0..3 (if pair[k] is active):
    if pair[k].incrementer == 0x37:
      pair[k+1] = (incrementer = 0x41, phase = 0)   ← seed the next oscillator
    pair[k].incrementer -= 1
    if pair[k].incrementer == 0:
      mark pair[k] inactive
  if all 4 pairs inactive:
    end sound
```

The peak DAC value is `0x80 | 0x40 | 0x20 | 0x10 = 0xF0` — four 1-bit oscillators stacked into one 4-bit additive output. Notice the four constants that drive everything — `0x40` (initial frequency), `0x37` (spawn trigger), `0x41` (seed for the next pair), `4` (number of pairs) — and notice that none of them is an input on the page.

This is the canonical example of a routine that is *not* data-driven: changing it requires editing JavaScript.

### $1F — VARI (QUASAR)

**What you're hearing.** Command $1F is QUASAR — a sweeping, fizzing zap. The VARI engine is a *variable-duty-cycle square wave*: alternating low-level and high-level segments whose lengths drift over the sound's life. Two parameters set the duty cycle and pitch; two increments drift them; a second-stage drift can ramp them again before the sound finally ends.

**Studio tab.** *Pulses* (Handler C).

**The eight editable fields.**

| Stage | Field | Range | What it does |
|---|---|---|---|
| Pulse wave | **Amplitude** | 0–255 | Peak-to-peak amplitude of the pulse. |
| Pulse wave | **Low part length** | −1…256 | Number of ticks the DAC stays low each cycle. |
| Pulse wave | **High part length** | −1…256 | Number of ticks the DAC stays high each cycle. |
| Pulse wave | **Total length** | 0+ | Total number of pulse cycles before the next stage. |
| Change shape & repeat | **Low part length increment** | −256…256 | Per-cycle drift applied to *Low part length*. |
| Change shape & repeat | **High part length increment** | −256…256 | Per-cycle drift applied to *High part length*. |
| Change shape & repeat | **Repeats** | 1+ | How many times to run the train (with the drift) before the second stage. |
| Change shape & repeat, again | **Low part length increment 2** | −256…256 | A second-stage drift on *Low part length*; when the length finally reaches zero, the sound ends. `0` disables this stage. |

Those eight fields together let you morph the wave from one square shape into another over time. QUASAR's preset is just one combination of those eight bytes.

**A full edit-to-sound walkthrough.** Suppose you want to make QUASAR's low half shorter — change the duty cycle.

1. Open *Pulses* and click the QUASAR preset button. The eight input fields fill with QUASAR's record (`amp = 0xFF, lowLen = 0x28, highLen = 0x81, …`).
2. Change **Low part length** from `0x28` to `0x14` (the `handlerC_lowPartLength` input).
3. Press **Play**. The app does:

```
handlerC = new HandlerC()
handlerC.setup({
  amp = 0xFF, lowPartLength = 0x14, highPartLength = 0x81,
  totalLength = …, lowInc = …, highInc = …, repeats = …, lowInc2 = …
})
   → copies all eight fields into instance properties.

handlerC.synthOne(out)
   for r in 0 .. repeats:                          ← Stage 1: pulse train
     for c in 0 .. totalLength:
       dacSampler.sample(LOW_LEVEL,  out)            ← write low to the DAC
       dacSampler.wait(cycleCount × lowPartLength)   ← stay low for that long
       dacSampler.sample(HIGH_LEVEL, out)            ← write high
       dacSampler.wait(cycleCount × highPartLength)  ← stay high for that long
       lowPartLength  = (lowPartLength  + lowInc ) & 0xFF   ← per-cycle drift
       highPartLength = (highPartLength + highInc) & 0xFF
     if lowInc2 != 0:                              ← Stage 2: second drift
       lowPartLength = (lowPartLength + lowInc2) & 0xFF
       if lowPartLength == 0:
         break                                       ← sound ends
```

Each DAC value flows through `DacSampler` (which spaces it correctly using the per-line `wait(cycleCount)`), then `DechunkedStream` (×2 − 1 normalise + optional DC block), then the mixer (optional limiter), then the deprecated `ScriptProcessorNode`, then the speakers.

Because every byte of the preset is editable, you can morph QUASAR's record gradually toward FOSHIT's (another *Pulses* preset) — within the limits of the eight fields the porter chose to expose.

### $1B — ORGAN (ORGANT tune)

**What you're hearing.** ORGANT is Defender's *organ-tune trigger* — it asks the sound CPU to play a tune (a sequence of notes), not a single sound. In the real ROM, this is realised by a small interpreter that walks a tune table (`ORGTAB`, 4 bytes per note: oscillator mask, delay, duration) and, because the 6802 has no multiplier or fast divider, sets each note's pitch by **patching one byte of its own code at `RDELAY`** — i.e. self-modifying machine code.

**Studio tab.** *None, directly.* The Studio's `defender.asm` map labels post-`DECA` indices `$1A` and `$1B` as "silent?" — its authors did not surface this engine. The closest editable thing in the Studio is the **Music** tab, but Music plays the Studio's *own* bundled songs ("High score" = 3 notes, "Top score" = a longer score, both in `g_songs[]` in `defender.js`) using a *different* synth than the ROM's ORGAN engine.

**Editable surface (Music tab).** A textarea you type a score into — one note per line, three comma-separated numbers per note:

| Field | Meaning |
|---|---|
| **Timbre** | A 0–255 bitmask. Determines the note's *colour* (see how below). |
| **Pitch** | The note's *period* — smaller numbers sound higher-pitched. (Confusingly, "pitch" here is the inverse of perceived pitch.) |
| **Duration** | How long the note lasts. Affected by pitch — higher-pitched notes consume their duration faster. |

Plus a polyphony toggle in *Settings*.

**How a Music note becomes sound.**

```
[textarea: lines of timbre, pitch, duration]
            │
            ▼  Play
       song = new Song(parsedScore)
       song.synthOne(out)
         for each note in score:
           ticks = 0
           while not noteDone(note, ticks):
             g_12_phase = (g_12_phase + 1) & 0xFF       ← global tick counter
             phase     = g_12_phase & note.timbre       ← mask the timbre bits
             bitsSetCount = popcount(phase) * 16        ← 0, 16, 32, …, 128
             dacSampler.sample(bitsSetCount / 255, out) ← write to the DAC
             dacSampler.wait(note.pitch)                ← wait → controls pitch
             ticks += 1
```

The "timbre" is a **bit-popcount waveform generator**: each tick, you AND the running phase counter with the timbre bitmask, count the 1-bits in the result, and use that count (×16) as the DAC value. Different bitmasks (`0x01`, `0x03`, `0x0F`, `0xAA`, …) give different waveforms — a cheap chiptune palette.

**Why this is interesting in context.** The Studio's *Music* tab is a re-implementation of *a* chiptune note player, not a re-implementation of *Defender's* ORGAN engine. The original ROM's pitch mechanism — that self-modifying-code dispatch into `RDELAY` — was simply not ported. So if you want to play organ-style sounds in the Studio you write Music scores; you cannot edit the underlying ROM `ORGTAB`.

### What the five cases together reveal about the Studio's design

- **An edit only goes as deep as the hand-port goes.** GWAVE, FNOISE, and VARI are heavily editable because the Studio ported their parameterisations field-by-field. SCREAM has zero knobs because its algorithm was ported as a closed loop. ORGAN was not ported at all — the Music tab is a different sound source entirely.
- **The unit of "a sound" is a JS class, not a ROM record.** That is why some engines' records are surfaced *to-the-byte* (Handler A's 12-field preset; Handler C's 9-field) while others have no surface at all (`humanoidFall`) — it depended on whether the porter chose to expose them.
- **Timing always lives in the `wait(N)` annotations.** Every handler — even the parameterless `humanoidFall` — relies on those hand-counted cycle counts for duration and pitch.
- **A parameter change is inert until the next Play.** Each handler is built fresh from current inputs; there is no live hot-swap.

## What's worth copying

A short list of the Studio's load-bearing ideas — battle-tested across years of public use, worth lifting (or reaffirming when we've already mirrored them).

| Idea | What it is | Why it matters | WSED status |
|---|---|---|---|
| **`DacSampler`** | A fractional zero-order-hold resampler. Each routine declares its own per-instruction cycle costs via `wait(N)` and pushes a new DAC byte via `sample(v)`; the resampler stretches the irregular ROM tick stream to a fixed PCM rate. | Without it every routine would need its own resampler, or you'd quantise to one fixed tick rate and lose timing fidelity. The Studio's single most important piece of plumbing. | Replaced by the cycle-accurate emulator (WSED runs the 6802 directly, so DAC writes happen at their *real* cycles — no per-routine hand-port of `wait` calls). |
| **Handler class shape** | Per-sound class with four methods: `setup(params)` initialises state, `synthOne(out)` advances one DAC write (`-1` when done), `synthAll(out)` is a bulk-render convenience, `runtimeStats()` returns live introspection (`phase`, `lfsr`, `stage`, …). | Pull-driven (the audio thread asks for the next sample, not pushed by a timer), polyphony-friendly, and `runtimeStats` gives the UI a free instrumentation surface — every visualisation hangs off it. | Conceptually mirrored: WSED's engine snapshots (`engineState.ts` per-engine shape) are the `runtimeStats` equivalent, but driven by emulator state rather than per-handler bookkeeping. |
| **Presets as plain JS arrays** | Each preset's parameters live as a literal `[…]` next to the routine, exposed unchanged as numeric inputs. | UX clarity: *"this is what the ROM was actually telling the sound CPU to do."* No abstraction layer between the user and the ROM bytes. | Mirrored in the Designer's slider readouts (`$XX` next to every slider; copy-from-game seeds slot bytes from the real ROM record). |
| **Asm cite comments + linked source** | Every JS method comments the `defender.asm` line range it ports, and the UI links to a rendered HTML version of the disassembly. | Lets a learner pivot from the JS approximation to the original 6800 code in one click — closes the "where did this come from" gap. | Mirrored in spirit: WSED renders the actual ROM disassembly in the Code panel (Pattern 4) and steps through it line-by-line at real cycles. |
| **Tooltip-text style** | Per-parameter tooltips that explain the byte in plain language ("attack increment per tick") rather than the symbol name. | In-place help means no manual hunt for what a control does — discovery-by-hover. | Mirrored everywhere — `VARI_FIELDS.help` / `GWAVE_FIELDS.help` carry the tooltips, and the Explore force-sliders use the same pattern. |
| **Optional mixer controls** | Polyphony / DC-block / limiter toggles surfaced as opt-in checkboxes rather than always-on processing. | Lets a learner *hear* what each stage does by toggling it off. Pedagogy by ablation. | Partial: WSED's filter toggle (Pattern 7) is the same idea for the analog low-pass; we don't currently expose DC-block / limiter as toggles. |

## What's missing (where your explorer wins)

Capabilities the Studio lacks and WSED delivers. Each row is the kind of question a learner naturally reaches for once they outgrow "just play it" — and each answers *why* the explorer surface exists.

| Gap in the Studio | What it would let a learner do | How WSED fills it |
|---|---|---|
| **No DAC byte stream view.** The Studio shows the *resampled, normalised, DC-blocked float* output — what the speaker hears, not what the CPU wrote. | See the actual `0..255` bytes the 6802 stored to the DAC PIA, in order, with the real cycle gaps between writes. | The **DAC byte tape** (Pattern 1 / Eye-Swimlane). One cell per write, hex value above, cycle below. |
| **No timing trace.** The Studio's `wait(N)` calls are hand-counted at port time and never visible during playback. | Correlate each emitted DAC sample with the ROM instruction that wrote it. | The **Stage swimlane** (Pattern 8) lays the routine's run on a real-time axis, every IRQ tick labelled with the disassembled instruction range. |
| **No engine-state trace.** Live `phase`, `lfsr`, `stage` exist in `runtimeStats` but nothing draws them over time. | Watch a 16-bit LFSR's bit pattern rotate per tick; watch QUASAR's period sweep cross its `HIEN` threshold. | The per-engine view panes (`engine/state-*.ts`): LFSR drawn as 16 bit cells with the tap network shown; VARI's `LOPER`/`HIPER`/`SWPCT` plotted over the run. |
| **No envelope/decay overlay.** GWAVE pre-decays the in-RAM waveform; the Studio doesn't show original-vs-current. | Watch the subtractive envelope physically remove material per echo. | Built into the **GWAVE waveform-canvas** + envelope visualization — original (light grey) behind the decayed RAM copy. |
| **No animated period-curve playhead.** The Studio highlights the *selected* slice of Handler A's period table; it never animates the playhead sweeping through it during playback. | Watch a sweep enter its modulation region in real time. | The Designer's pitch-pattern canvas + scope playhead sync (Pattern 11) animate playback position synchronously. |
| **No spectrogram-stage annotations.** The FFT waterfall is unlabelled. | Read off when an additive scream transitioned from `stage_slideDacToRandom` to its tail. | WSED's spectrogram is tied to the disassembled-stage label-map so transitions are annotated in-band. |
| **No command-code dispatch UI.** The Studio routes by handler ID, not by the ROM's command code. | Type `$13`, see the dispatch table from `defender.asm $FCE7..$FD0E`, watch the IRQ route through the band-compare. | The **Command-code panel** (Pattern 4) shows the dispatcher band-compares + jump-table targets and highlights the live branch. |
| **No A/B comparison.** No way to diff two parameter sets' waveforms or spectra side by side. | Hear *and see* a 1-byte change. | The **Diff overlay** in the Designer transport + the dedicated **A/B Diff** visualiser. |
| **No MAME-comparable golden output.** No regression gate; correctness is by ear. | Catch a port regression sample-for-sample. | The golden DAC fixtures (`explorer/tests/golden/`) gate every commit; the bulk WAV corpus is browsable. |
| **No preset-diff readout.** No "this is what's changed since you loaded the preset". | See your edits at a glance without scrolling through every slider. | The Designer's **Source: Edited\|Start** A/B + the **↻ Reset record** affordance both surface "what's changed" — by ear and by revert. |
| **Defender only.** | Compare Defender SAW to Robotron MOSQTO directly. | All three games — Defender, Stargate, Robotron — share one explorer surface with a single switcher. |

## Things to do differently

Choices the Studio made that age has improved on, or that we'd skip for an explorer rather than a tweaker. The right column is what WSED actually does (mostly) — the table is the receipt, not the wish list.

| Studio choice | Better choice for explorer | What WSED actually does |
|---|---|---|
| `ScriptProcessorNode` (main-thread, deprecated) | `AudioWorklet` — off-main-thread, jitter-free | AudioWorklet, dedicated audio thread (`web/worklet.ts`) |
| `g_sampleRate` inherited from `AudioContext` default | Pin explicitly to 48000 (configurable) | Pinned to the AudioWorkletNode's negotiated rate (typically 48000), uniform across all sound rendering |
| Real-time pull generation only | `OfflineAudioContext` render path for full-buffer visualisation + playback | Offline render path (`runner.ts` → `renderDacEvents` → `applyLpf` → `wavExport.ts`) for WAV export *and* the Designer's offline audition |
| `<input type="number">` for every parameter | Slider + numeric readout, "knob" feel | `.param-row` (slider + hex readout + tooltip) is the only parameter control in the app |
| Whole `dan/*` ad-hoc GUI framework (~16k lines) | Modern stack (Svelte/Solid + a small canvas helper) | Plain TS + canvas only (no reactive framework — Phase 1 locked decision) |
| Parameter changes apply on next Play | Hot-swap when feasible | Live-edit replays the offline render (~130 ms debounce) on every slider tweak — most sounds re-render in under a second |
| Hand-port every routine to JS | Cycle-accurate 6800 emulator → both ROMs work unchanged | Real 6802 emulator in `cpu/` runs the unmodified ROM bytes; any valid ROM image works |

## Concrete code patterns to reuse

Three short patterns from the Studio that are general-purpose enough to lift verbatim into any 8-bit-DAC reverse-engineering project. Each is annotated with *what it solves* and *why this exact shape* — in case you adapt them for a different ROM.

### The DacSampler — irregular-tick to fixed-rate PCM

**What it solves.** The 6802 writes the DAC at whatever cycle the routine reached its `STAA DAC` — irregular, often non-uniform. Audio output needs a fixed sample rate (Web Audio's `AudioContext` rate is typically 44.1 / 48 kHz). The naive fix — quantise to the *highest* observed tick rate — wastes memory and still doesn't line up with the output. The Studio's `DacSampler` does it lazily: each routine declares its cycle cost via `wait(N)`, then writes a value via `sample(v)`. The sampler accumulates fractional ticks and emits exactly the right number of duplicated output samples per write (zero-order hold).

```javascript
class DacSampler {
  constructor(inputTickRate, outputSampleRate) {
    this.ratio = outputSampleRate / inputTickRate;
    this.unrenderedTicks = 0;
    this.value = 0;  // current DAC byte, normalised to [0, 1]
  }
  wait(n) { this.unrenderedTicks += n; }
  sample(newValue, outArray) {
    const out = Math.floor(this.unrenderedTicks * this.ratio);
    for (let i = 0; i < out; i++) outArray.push(this.value);
    this.unrenderedTicks -= out / this.ratio;
    this.value = newValue;
  }
}
```

**Why this shape.** `unrenderedTicks` is a `Number` not an integer, so the *fractional remainder* survives across `sample()` calls and never accumulates rounding error. The pattern is "every `wait(n)` is a promise, every `sample(v)` is its redemption" — separating the two means a routine can `wait` over a tight inner loop without flooding the output buffer until it's ready to emit. WSED replaces this with the real 6802 emulator's cycle counter (each `STAA DAC` carries the exact cycle it happened on), but for a *handler-port* project the `DacSampler` is the right shape.

### The Galois LFSR — Williams' noise generator

**What it solves.** Defender's noise engines (LFSR / FNOISE / NOISE) are driven by a 16-bit linear-feedback shift register whose tap network produces a 65 535-cycle pseudo-random sequence. The Studio runs the same algorithm in JS so the pseudo-random sequence is byte-identical to the ROM's — which is what makes Lightning *sound* like Lightning.

```javascript
let g_lfsr = 0x3c00;  // 16-bit, seeded from ROM
function clockLFSR() {
  const low = g_lfsr & 0xFF;
  const bit = ((low >> 3) ^ low) & 1;  // tap at bits 0 & 3 of the low byte
  g_lfsr = (g_lfsr >> 1) | (bit << 15);
  return bit;
}
```

**Why this shape.** *Galois*, not Fibonacci — the XOR happens during the shift, not after, which lets the CPU do it in two 6802 instructions (an `EOR` and a `ROR`). The tap positions (`bits 0 & 3` of the low byte) are the ROM's exact taps; changing them would produce a different — and audibly wrong — noise stream. WSED runs the same LFSR through the 6802 emulator's actual instructions, so the bit sequence is automatically correct.

### The subtractive envelope — GWAVE's "math-error" decay

**What it solves.** GWAVE plays the same waveform repeatedly with each repeat *quieter than the last*. Williams' programmers didn't have multiply / divide hardware, so the decay isn't a multiplicative amplitude scale — it's a subtraction: `working_sample -= (original_sample >> 4) * PRDECA`. The 8-bit wrap that happens when the subtraction goes negative is *not* a bug — it's the source of GWAVE's signature timbre shift in late echoes.

```javascript
function applyDecay(original, working, decay) {
  for (let i = 0; i < working.length; i++) {
    working[i] = (working[i] - (original[i] >> 4) * decay) & 0xFF;  // 8-bit wrap!
  }
}
```

**Why this shape.** The `& 0xFF` is load-bearing — without it, the working buffer would *clip* (go silent below zero) instead of *wrapping* (jump to 255), and the late-echo timbre would be wrong. Preserve the wrap when porting. WSED inherits this for free (the 6802 emulator's `SUB`/`SBC` instructions wrap natively), but a hand-port has to remember.

## Cross-references

- Raw deep-dive (every URL, line range, code excerpt): `research/findings_sound_studio.md`
- The explorer architecture you build: `docs/explorer_architecture.md`
- The synthesis primitives the Studio implements: `docs/synthesis_techniques.md`
