# Pedagogical Design — How to Actually Explain These Sounds

> Design principles and concrete UX patterns for a Williams sound explorer whose purpose is **understanding**, not playing. The user wants to grok the algorithms — this doc proposes how to make that happen.

## The problem

A Williams sound effect is **a program** running on a tiny computer. Existing tools (Defender Sound Studio, sound rippers, YouTube playlists) show you the output and *maybe* parameters. They don't show you:

- which line of code is executing right now
- which 8-bit value is being written to the DAC at this exact moment
- which bits of the LFSR just flipped
- which sample of the 72-byte wavetable the read pointer is sitting on
- why a harmonic just appeared in the spectrum

To really understand, you need to see the **algorithm running**, not just hear its output. This doc proposes the design language.

---

## Five design principles

### 1. Multiple representations of the *same instant*

At every paused moment, show the same point in time from at least three angles:
- **Ear** — what the speaker is doing right now
- **Eye** — the waveform / spectrum / state
- **Code** — the assembly line currently executing (or about to)

Switching attention between these is what builds understanding. Force the coupling visually: when you scrub a timeline, all three update in lockstep.

### 2. Time as a manipulable variable

Real-time is 894886 cycles/sec. Useless for learning anything but feel. Provide a continuous speed dial:

| Speed | Use | Audio | Visual |
|---|---|---|---|
| **1×** | "How does it sound?" | Real pitch | Blurred motion |
| **1/4×** | "How does it evolve?" | Pitched down, listenable | Visible motion |
| **1/10×** | "How does each iteration work?" | Sub-audible drone | Clear per-iteration |
| **1/100×** | "What happens between two samples?" | Silent / clicks | Microscope: every byte |
| **Single-step** | "What does this instruction do?" | One click per step | Inspect everything |

Below 1/4×, the audio becomes sub-audible — but the *visualization* now operates at human attention speeds. This is the explorer's superpower.

### 3. Audible probing — click anything, hear it

Every visual element should be *audible* in isolation:

- Click a single DAC byte on the byte-stream view → hear that one click
- Solo a single voice of SCREAM → hear just that voice
- Solo a single bit of the ORGAN oscillator mask → hear just that voice
- Mute the LFSR (force C=0) → hear the underlying signal without noise
- Mute the WVDECA decay → hear the un-enveloped tone
- Mute the GFRTAB sweep (freeze pattern at byte 0) → hear the static pitch

This is the synthesizer's "solo" button promoted into a *learning* tool. You hear contributions one at a time.

### 4. Build-up *and* tear-down

Two complementary entry points:

- **Build-up** (constructive): Start from silence, add primitives one at a time. "Here's the GS72 sine wave. Now add the GFRTAB pitch pattern. Now add WVDECA envelope. Now add echo iteration. → That's HBDV."
- **Tear-down** (analytic): Start from the finished sound, mute pieces one at a time. "Here's HBDV. Mute the echoes — now you hear one pass. Freeze the pattern at byte 0 — now you hear a single sustained pitch. Mute the envelope — now you hear the raw waveform."

Same algorithm, two routes in. Build-up teaches *composition*; tear-down teaches *anatomy*.

### 5. Causality is always visible

When something interesting happens in the output, the cause should be one click away. Hover a spike in the spectrum → highlight the assembly line that produced it. Hover an envelope dip → highlight the `WVDECA` iteration that caused it. Hover a noise burst → highlight the LFSR clock that produced it.

The traditional model is "output is opaque; trust the engineer." The pedagogical model is "every effect has a visible cause."

---

## Twelve concrete UX patterns

Each one is a discrete feature that can be designed and built independently. Ordered roughly by "easy and obvious" → "novel and powerful".

### Pattern 1: The three-panel triangle

Always-visible top of the page: **ear · eye · code**. Three panels that share a timeline cursor. Scrub or play, all three update together.

```
┌─────────────────────────────────────────────────────────┐
│  EAR                EYE                  CODE           │
│  ┌─────────────┐    ┌─────────────────┐  ┌────────────┐ │
│  │ ╱╲    ╱╲    │    │ wavetable cursor│  │ GWAVE:     │ │
│  │   ╲  ╱  ╲   │    │ LFSR bits       │  │   LDAA ,X  │ │
│  │    ╲╱    ╲  │    │ envelope decay  │  │   STAA $400│ │
│  └─────────────┘    └─────────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────┘
```

This is the foundational layout. Everything else lives below.

### Pattern 2: The DAC byte tape

Show the actual byte sequence written to `$0400` as a horizontal "tape" — one cell per byte, labelled with the value. The tape head sits at "now". At slow speeds, you literally watch each value scroll past.

This is *the* signal the speaker reproduces. Most tools show only the post-LPF float waveform — but the byte tape is what the program *actually* wrote. Showing both side-by-side (raw bytes underneath, reconstructed waveform overhead) makes the LPF tangible.

### Pattern 3: Solo / mute / freeze controls per primitive

For each engine, expose toggle buttons that mute or freeze its contributing primitive:

| Engine | Toggles |
|---|---|
| GWAVE | freeze pattern step • mute echo iterations • disable WVDECA • set FOFSET=0 |
| VARI | freeze LOPER sweep • freeze HIPER sweep • disable LOMOD drift |
| LFSR noise | force C=0 (noise off) • force C=1 (full noise) • freeze LFSR clock |
| FNOISE | force slope = FMAX (no random) • disable DSFLG distortion • freeze target |
| SCREAM | solo / mute each of 4 voices • freeze FREQ decrement |
| ORGAN | solo / mute each of 8 oscillator bits |

This is principle #3 (audible probing) made concrete.

### Pattern 4: Build-up and tear-down tracks  *(shipped — Step 6.1)*

A guided "voice by voice" assembly so each layer is audible as it enters / leaves. As shipped, the first realisation is on **SCREAM (Robotron `$1A`)** — the most spectacular fit, since SCREAM is 4 detuned voices summed at the DAC and the cascade still chains naturally when individual voices are silenced:

```
Build-up:  fire $1A with v0..v3 muted    →
           +v0 after 700 ms                ▶ Listen
           +v1 after 700 ms                ▶ Listen
           +v2 after 700 ms                ▶ Listen
           +v3 after 700 ms                ▶ Listen — full SCREAM

Tear-down: fire $1A with all voices on   →
           −v3 after 700 ms, −v2, −v1, −v0
```

Implementation: 4 PC-gated TIMER-write toggles (`screamMuteVoice0..3`) in `audio/engineToggles.ts`. CLR ,X at SCREAM entry already zeros each voice's TIMER cell; subsequent writes are dropped while the toggle is on, so `ADDA TIMER,FREQ` stays positive → BPL skips ADDB → that voice contributes nothing. FREQ is left alone so the cascade keeps chaining voice → voice. UI lives inside the SCREAM engine pane: 4 voice checkboxes + Build-up ↑ / Tear-down ↓ / ■ buttons; the sequencer auto-switches to Robotron and fires `$1A` on click.

Extending this idea: **ORGAN voice mute landed too** (Step 6.1+, same UI shape).  ORGAN's polyphony lives in the `OSCIL` bitmask — 8 bits, popcount = voice count.  Eight `organMuteVoice0..7` toggles AND-mask OSCIL on every CPU write while PC is inside ORGAN's address range, clearing the bits the user has muted.  Sequencer fires `$1B + $02` (NINTH = Beethoven's 9th on Robotron), then flips OSCIL bits one at a time so the user hears the popcount technique build the chord up voice-by-voice (or strip it down).  GWAVE's echo loop already had per-pass `gwaveSkipDecay`; HBDV's per-primitive composition (the original example above) remains a future target.

### Pattern 5: What-if parameter sliders

Every per-sound parameter (e.g., `GECHO`, `GCCNT`, `WAVE#`, `PRDECA`, `GDFINC`) gets a slider. Move the slider → instantly hear and see the result. Each parameter shows its **original ROM value** with a "reset to original" arrow. Modifying ROM is what synth-design playgrounds let you do; in our context, the framing is "discover what each byte controls."

### Pattern 6: A/B diff mode

Pick two sounds (e.g., HBDV vs HBEV, or Defender's HBDV vs Robotron's HBDV). Display side-by-side:
- The raw SVTAB bytes diffed (highlighted where they differ)
- The waveforms overlaid
- The spectrograms stacked

Same algorithm + small differences = focused learning of which parameter does what.

### Pattern 7: Genealogy view

Show explicit lineage. CANTB in Robotron has the comment "DEFENDER SND #$17" — verbatim reuse. HBDV exists in both ROMs. Many GFRTAB patterns are shared.

A simple ancestry graph:

```
Defender $17 CANNON (FNOISE/CANTB)
   ├── Stargate $17 CANNON (verbatim copy)
   └── Robotron $17 CANNON (verbatim copy + comment)

Defender HBDV ─── identical SVTAB ─── Robotron HBDV
```

Hover any node → A/B view (Pattern 6) auto-populated.

### Pattern 8: Causal hover trace

Hover anywhere on the spectrum → highlight in the code panel the section that produced that frequency. Hover a moment in the waveform → highlight which DAC byte at which cycle. Hover an LFSR bit-flip → highlight the assembly that clocked it.

Implementation: every snapshot stores `{cpu_cycle, pc, dac_byte, ...}`. Hovering computes the nearest snapshot and projects its `pc` into the source.

### Pattern 9: Annotated explainer cards  *(shipped — Step 6.3)*

Each sound has a curated explanation panel. Written for a reader who knows what sine waves are but not 6800 assembly. **All 63 catalogued routines have cards** — source of truth is `docs/explainer_cards.md` (one `## ROUTINE — Title` section each), and `tools/build_explainer_cards.py` emits the per-routine JSON.  Source format: routine-keyed JSON at `explorer/public/data/explainer/{ROUTINE}.json` with fields `tldr / how / watch / code / see`.  Tiny built-in markdown subset (`` `code` ``, `**bold**`, `[text](url)`) for inline formatting.  `viz/ExplainerCard.ts` loads the card on every user-driven fire via `loadExplainerForCmd(cmd)`.

Example for SCREAM:

> ### Why does SCREAM sound the way it does?
>
> SCREAM is **four square-wave voices** added together. Each voice has its own phase counter (`TIMER`) that increments by its own frequency (`FREQ`) every sample. When a phase counter wraps past 128, the voice contributes to the output.
>
> The four voices play with **exponentially decreasing amplitudes** — voice 0 contributes 128, voice 1 contributes 64, voice 2 contributes 32, voice 3 contributes 16. This makes higher voices act as harmonic shimmer rather than independent tones.
>
> Every 256 samples, every voice's frequency drops by 1, sliding the whole chord downward. When a voice's frequency reaches 0x37 (55), the next voice is seeded with frequency 0x41 (65) — slightly detuned from where the dying voice started. This creates the **swarming-echoes** effect.
>
> The sound ends when all four voices reach frequency 0.

This is the actual pedagogical payload. The visualization without explanation is just lights moving.

### Pattern 10: Listen-then-look exercises  *(shipped — Step 6.4)*

Optional "test yourself" mode. Pick a random sound. Play it. Show 6 candidate engines (LFSR / GWAVE / VARI / FNOISE / SCREAM / ORGAN). User picks one. Reveal the correct answer + offer a link into the Pattern 9 explainer card.

Implementation: `viz/QuizPanel.ts` mounts a collapsible right-column section.  Pool ≈ 96 entries drawn from the glossary (across all three games, filtered to the 6 canonical synthesis engines).  Each question fires the sound via a `fireRaw` callback that *skips* the auto-explainer-card load (would reveal the answer), then waits for the user's MCQ click before revealing.  Per-session score in the header.

Surprise-driven learning beats reference-doc learning. People remember what they predicted wrong.

### Pattern 11: Tape-loop scrubbing

Drag a horizontal scrubber across a recorded sound. Like Ableton's playhead but at micro-scale. Audio plays at scrub speed (drag fast = fast-forward, drag slow = sub-audible). The DAC tape (Pattern 2) moves with you. Visualization animates in reverse if you scrub backward.

This is "tape head as a manipulable tool" — make the time axis a physical object.

### Pattern 12: The "no-explanation Friday" toggle  *(shipped — Step 6.5)*

A user-controlled overlay: turn ON to show all explanations, turn OFF to see only the raw visualizations. Force yourself to reason from the data without the cards. Then turn explanations back on and check.

This isn't a feature people typically build — but it's the difference between *learning* and *memorizing*.

Implementation: the header **Hide help** toggle adds / removes `body.hide-help`.  CSS hides `.help-text` paragraphs, `details.help` collapsibles, `#cmdInfo`'s engine blurb, the Glossary section, term-link styling (no underline, no colour), and the SCREAM "checked = muted" hint.  What stays: button labels, hex values, segment markers, every canvas-based viz, the log.  Preference persists to localStorage as `williams-sound-explorer.hide-help`.

---

## Difficulty levels (optional scaffolding)

If you want guided tours, three tiers:

- **Curious** — three-panel triangle only. No code panel. Sliders are pre-set to ROM defaults; explainer cards always visible. Hover-trace disabled.
- **Hobbyist** — full UI, explainer cards collapsible. Sliders unlocked. A/B mode and Genealogy enabled.
- **Engineer** — code panel always visible, single-step on, snapshot decimation = 1 (every cycle). RAM heatmap on. Disassembly cross-referenced.

Default to **Hobbyist**. Don't force tiers.

---

## Reference-audio integration *(considered; not built — superseded)*

An early idea was to ship a captured reference WAV per sound and show it as a fourth panel (*ear · eye · code · reference*) so the user could A/B the live emulator against a real-cabinet recording. **This was never built**, and the approach is superseded: the explorer treats the assembled-from-source ROMs as ground truth (byte-identical to MAME's production dumps for Stargate + Robotron; a documented 2-byte source-revision delta for Defender — see `vasm_install_notes.md`), and fidelity/regression are guarded by the golden DAC fixtures in `explorer/tests/golden/` plus ear + spectrogram checks. No real-cabinet recordings ship in the repo. The shipped panels are *ear · code · eye · swimlane*, not four-with-reference.

`docs/reference_audio_plan.md` records the (unexecuted) reference-audio acquisition options.

---

## Non-goals (clarity by exclusion)

To keep scope manageable, this explorer is *not*:

- a sound editor / synth playground (changing parameters is for *learning*, not for *making music*)
- a cabinet emulator (no video, no game logic, no joystick — just the sound CPU)
- a MIDI / DAW (no piano roll, no tempo grid)
- a documentation hub for *all* Williams sound boards (D8224 family only — Defender/Stargate/Robotron, plus Joust as a stretch)

If a feature doesn't help someone understand how the sound works, cut it.

---

## Implementation priority

Pair this with `docs/explorer_architecture.md`'s 6-phase plan. The pedagogical patterns slot in as follows:

| Phase | Pedagogical patterns activated | Status |
|---|---|---|
| 1 — silent emulator | (none — no UI yet) | ✅ |
| 2 — audio out | Pattern 11 (basic tape-loop) for QA | ✅ |
| 3 — visualization v0 | Patterns 1, 2 (triangle, DAC byte tape) | ✅ |
| 4 — per-engine introspection | Patterns 3, 8 (solo/mute, causal hover) | ✅ |
| 5 — Robotron | Patterns 6, 7 (A/B diff, genealogy) | ✅ |
| 6 — comparison + polish | Patterns 4, 5, 9, 10, 12 + RAM heatmap | **All ✅** |

The first three patterns are the *minimum viable understanding tool*. The rest deepen it.

**All 12 patterns shipped.**  The original pedagogical vision is delivered.

---

## Cross-references

- Engine specifics: `docs/synthesis_techniques.md`
- Per-sound parameters: `docs/defender_sound_catalogue.md`, `docs/robotron_sound_catalogue.md`
- The architecture this feeds into: `docs/explorer_architecture.md`
- Reference-audio strategy: `docs/reference_audio_plan.md`
- Prior art that did *not* do most of this: `docs/sound_studio_reference.md`
