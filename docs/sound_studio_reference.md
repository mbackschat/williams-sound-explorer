# Defender Sound Studio — Prior-Art Reference

> Summary of what to learn from msarnoff's *Defender Sound Studio* (`zapspace.net/defender_sound/`) — the closest existing browser-based exploration tool. Use as input for your own design. Full deep-dive: `research/findings_sound_studio.md`.

## What it is

A browser-only re-implementation of Defender's 2 KB sound ROM in plain JavaScript, with tweakable parameters per sound, oscilloscope, FFT, and a JSON preset import/export. Daniel Lopez / msarnoff, December 2020. Released alongside the original `defender.asm` disassembly and `defender.js` source. Robotron is **not** covered — only Defender.

Live URLs:
- App: <https://zapspace.net/defender_sound/>
- Help: <https://zapspace.net/defender_sound/help.html>
- Engine source: <https://zapspace.net/defender_sound/defender.js>
- Annotated disassembly: <https://zapspace.net/defender_sound/defender.asm>

## How it's built

**Not** a 6800 emulator. Each ROM subroutine is **hand-translated to a JavaScript class** with `setup()` / `synthOne()` / `synthAll()` / `runtimeStats()` methods. The 6800 control flow is preserved literally — every original instruction has a cycle-count annotation passed to a `DacSampler.wait(N)` call:

```javascript
// FA1E: F7 04 00      stb  $0400  ; 5~
this.dacSampler.wait(5);
```

So output timing is cycle-faithful even though there's no instruction-decode loop. Sample-and-hold resampling (`DacSampler`) carries the 894 kHz CPU pace down to 48 kHz (or whatever the AudioContext default is).

Audio path: handler → `DechunkedStream` (×2-1 normalisation, optional DC blocker) → `DechunkedStreamMixer` (limiter: none/clip/sine/tanh/atan) → `ScriptProcessorNode` → `AudioContext.destination`. The `ScriptProcessorNode` is deprecated but works; runs on the main thread.

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

## What's worth copying

1. **`DacSampler`** — fractional zero-order-hold resampler that lets each routine declare per-instruction cycle costs via `wait(N)`. The single most important piece of plumbing.
2. **Handler class shape**:
   ```
   class Handler {
     setup(params)
     synthOne(outArray) → returns -1 when finished
     synthAll(outArray) → bulk render
     runtimeStats() → { phase, lfsr, stage, … }
   }
   ```
   Pull-driven, polyphony-friendly, has a built-in introspection surface.
3. **Original-ROM presets as plain JS arrays**, exposed as numeric inputs. UX clarity: "this is what the ROM was actually telling the sound CPU to do".
4. **`<a href="defender.asm">`** + **per-instruction asm cite comments** in the JS. Tiny but powerful for learners.
5. **Tooltip-text style** — concise, in-place help.
6. **Polyphony / DC-block / limiter** toggles as optional mixer controls.

## What's missing (where your explorer wins)

1. **DAC byte stream view** — the actual 0..255 bytes being written. The Studio shows only the resampled, normalised, DC-blocked float output.
2. **Cycle / wait-tick timing trace** (swimlane) correlating sample-emit events to the original `defender.asm` line.
3. **Phase accumulator / state trace** per handler — `aliasedSweep.risePhase` over time, `humanoidFall`'s four `(incrementer, phase)` pairs, Handler A's current position in the period-offset curve.
4. **LFSR state graphic** — 16-bit register drawn as bits, with the tap network visualised. The Studio prints `g_lfsr.toString(2)` but doesn't draw anything.
5. **Envelope/decay overlay** — original ROM waveform plotted alongside the in-place-decayed RAM working copy. Watch the envelope physically subtract.
6. **Animated period-curve playhead** — Handler A highlights the static selected slice but never animates the playhead through it.
7. **Spectrogram synced to algorithmic stages** — annotate the FFT waterfall with `stageId` transitions ("now in stage_slideDacToRandom").
8. **Command-code dispatch UI** — type `$13` → routes to `playerShoot`, shows the dispatch table from `defender.asm` `$FCE7..$FD0E`.
9. **Comparison view** — diff two parameter sets' waveforms / spectra side by side.
10. **MAME-comparable golden output** — embed reference recordings, support per-sample diff.
11. **Preset diff** — show what's been changed vs. the loaded preset.
12. **No Robotron** — Studio is Defender-only.

## Things to do differently

| Studio choice | Better choice for explorer |
|---|---|
| `ScriptProcessorNode` (main-thread, deprecated) | `AudioWorklet` — off-main-thread, jitter-free |
| `g_sampleRate` inherited from AudioContext default | Pin explicitly to 48000 (configurable) |
| Real-time pull-driven generation | `OfflineAudioContext` render path for full-buffer visualisation + playback |
| `<input type="number">` for every parameter | Slider + numeric input pair, "knob" feel |
| Whole `dan/*` ad-hoc GUI framework (~16k lines) | Modern stack (Svelte/Solid + a small canvas helper) |
| Parameter changes apply on next Play | Hot-swap when feasible (most sounds < 1 s anyway) |
| Hand-port every routine to JS | Cycle-accurate 6800 emulator → both ROMs work unchanged |

## Concrete code patterns to reuse

### The DacSampler (paraphrased)

```javascript
class DacSampler {
  constructor(inputTickRate, outputSampleRate) {
    this.ratio = outputSampleRate / inputTickRate;
    this.unrenderedTicks = 0;
    this.value = 0;  // current DAC byte, [0,1]
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

### The Galois LFSR (paraphrased)

```javascript
let g_lfsr = 0x3c00;  // 16-bit, seeded from ROM
function clockLFSR() {
  const low = g_lfsr & 0xFF;
  const bit = ((low >> 3) ^ low) & 1;  // tap at bits 0 & 3 of low byte
  g_lfsr = (g_lfsr >> 1) | (bit << 15);
  return bit;
}
```

### The subtractive envelope (paraphrased)

```javascript
function applyDecay(original, working, decay) {
  for (let i = 0; i < working.length; i++) {
    working[i] = (working[i] - (original[i] >> 4) * decay) & 0xFF;  // 8-bit wrap!
  }
}
```

The `& 0xFF` wrap is the source of the "math-error" timbre shift in late echoes — preserve it.

## Cross-references

- Raw deep-dive (every URL, line range, code excerpt): `research/findings_sound_studio.md`
- The explorer architecture you build: `docs/explorer_architecture.md`
- The synthesis primitives the Studio implements: `docs/synthesis_techniques.md`
