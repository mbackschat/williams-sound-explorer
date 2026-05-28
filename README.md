# Williams Sound Explorer and Designer

<h1 align="center">
  <a href="https://mbackschat.github.io/williams-sound-explorer/">▶ RUN IN YOUR BROWSER →</a>
</h1>

<p align="center">
  <a href="https://mbackschat.github.io/williams-sound-explorer/">
    <img alt="Run the Williams Sound Explorer now" src="https://img.shields.io/badge/run%20now-mbackschat.github.io%2Fwilliams--sound--explorer-ff4500?style=for-the-badge&labelColor=000000">
  </a>
</p>

<p align="center">
  <em>No install. You supply your own Williams sound ROMs (read in your browser, never uploaded), then explore the algorithms at slow motion. Works in Chrome and Firefox.</em>
</p>

![status](https://img.shields.io/badge/status-feature--complete-brightgreen) ![tests](https://img.shields.io/badge/tests-545%20%2F%20545-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue) [![Run in browser](https://img.shields.io/badge/run-in%20browser-blueviolet)](https://mbackschat.github.io/williams-sound-explorer/)

The **Williams Sound Explorer and Designer** (**WSED**) is a browser tool for the arcade **sound effects** of **Defender** (1980), **Stargate / Defender II** (1981), and **Robotron 2084** (1982). Every sound on those cabinets is a tiny program running on a Motorola 6802 that streams bytes to an 8-bit DAC. WSED emulates that sound CPU and makes the algorithms **visible** (oscilloscope, spectrogram, DAC byte-tape, per-engine state, RAM heatmap) and **audible** at human-scale time — from 1× down to single-instruction stepping — and lets you **design your own** sounds (Design mode). Drive it by mouse or keyboard — `Space` fires, `1`–`4` set speed, `←/→` scrub or single-step, `G` cycles game, and `?` lists every shortcut.

<p align="center">
  <img alt="The Williams Sound Explorer running Defender's SAW: two-column layout with playback controls and the live grid on the left; engine views, spectrogram, and RAM heatmap on the right" src="docs/img/readme/hero.png" width="100%">
</p>

<p align="center">
  <img alt="Slow-motion playback: the oscilloscope, 6800 disassembly, DAC byte-tape, and routine swimlane animating together" src="docs/img/readme/demo.gif" width="378"><br>
  <em>Defender's descending SAW at ¼× — the oscilloscope, live 6800 disassembly, DAC byte-tape, and routine swimlane update in lockstep.</em>
</p>

> ⚠️ **You must supply your own ROMs.** This project does **not** include the Williams sound ROMs — they are © Williams Electronics. On first run the app asks you to upload them; the files stay in your browser (IndexedDB) and are never sent anywhere. See [Supplying ROMs](#supplying-roms).

## Quick start

```bash
cd explorer
npm install
npm run dev          # → http://localhost:5173
```

On first run an **onboarding screen** asks for the Williams *sound* ROM of each game. Drop a file on a slot — the app validates it (size + 6802 vectors + a SHA-1 allowlist) and stores it locally. The explorer works with **as few as one** ROM; games without one stay locked until you add them.

## Supplying ROMs

The sound ROM for each game is a small chip image (2 KB for Defender/Stargate, 4 KB for Robotron). Obtain them from a source you're entitled to use:

- a **MAME romset** you are licensed to use (the sound ROM is inside the game's zip — the app verifies it and tells you which game it is), or
- a **dump from your own board**, or
- **build them from source** (see below).

Nothing is uploaded; ROMs live only in your browser's IndexedDB. Use **Remove** on a slot to delete one.

## Building ROMs from source (optional)

The assemble-from-source toolchain is included, but the **Williams sound source is not** (it is copyrighted). To rebuild the ROMs yourself:

1. Obtain the Williams sound source and place it at `research/williams-soundroms/` (`VSNDRM1.SRC` … for Defender/Stargate/Robotron).
2. Install the `vasm` 6800 assembler — see [`docs/vasm_install_notes.md`](docs/vasm_install_notes.md).
3. Run `tools/build_roms.sh` → produces `research/roms/*_sound.bin`.
4. `cd explorer && npm run dev:roms` copies them into the gitignored `public/roms/` so the app auto-loads them and skips onboarding.

## What's inside

| Path | What |
|---|---|
| `explorer/` | The TypeScript app (Vite + plain TS + canvas). 6802 emulator, PIA, synth, AudioWorklet pipeline, all the visualizations. |
| `tools/` | Assembler toolchain (`build_roms.sh`, preprocessor) + data generators (glossary, label map, explainer cards, zero-page map). |
| `docs/` | Curated reference: hardware model, the 8 synthesis primitives, per-game command catalogues, pedagogical design, architecture. Start at [`docs/00_INDEX.md`](docs/00_INDEX.md). |
| [`MANUAL.md`](MANUAL.md) | Explorer manual — 12 tutorials + interface tour. |
| [`MANUAL_DESIGNER.md`](MANUAL_DESIGNER.md) | Designer manual — build your own custom sound ROM (Design mode). |

## Sound Designer

Beyond exploring, the app has a separate **Design** mode (the **Explore | Design** toggle in the header) for building your **own custom ROM** of VARI sounds: pick an engine base, copy any game's sound or add a new one into your own named list, edit its 9-byte parameter record with sliders, audition + A/B, and save as a JSON recipe (no ROM bytes). Hit **▶ Open in Explore** to push your custom ROM into Explore's live worklet — pause/step/scrub on your own sound, with every Explore visualisation pointed at it. See [`MANUAL_DESIGNER.md`](MANUAL_DESIGNER.md).

<p align="center">
  <img alt="Design mode with Defender SAW copied into the item list, the 8-slider VVECT parameter panel on the left, audition scope on the right, and the Play/Pause/Loop/Source/Diff transport at the bottom" src="docs/img/manual/designer-overview.png" width="820">
</p>

## How it compares

Most tools for these sounds either *play* them (emulators) or *document* them (disassemblies); a couple let you *tweak* them. **WSED** sets out to do all of it — emulate the real hardware, make every layer visible at human-scale time, and let you design new sounds — across all three games.

### vs. MAME & arcade emulators

[MAME](https://www.mamedev.org/) emulates the whole cabinet (main CPU, video, and the sound board) for faithful play and preservation — it's the gold standard for *accuracy*, and WSED uses MAME's output as a golden reference for its regression tests. But MAME is a black box for *understanding*: you hear the result, you can't watch the 6802 execute, see the DAC byte stream, tell which ROM routine is running, or inspect an engine's internal state — and there's no slow-motion, no single-instruction stepping, and no way to edit a sound. WSED runs the same sound CPU but surfaces all of that and slows it to a crawl. → [`docs/reference_audio_plan.md`](docs/reference_audio_plan.md)

### vs. Defender Sound Studio (msarnoff, 2020)

The closest peer: [Defender Sound Studio](https://zapspace.net/defender_sound/), a browser tool by Daniel Lopez (msarnoff) that lets you pick a Defender sound, tweak its parameters, and hear it, with an oscilloscope/FFT and JSON preset import/export. WSED deliberately reuses two of its good ideas — labelled parameter controls with tooltips, and JSON import/export — but differs in five ways:

**By design:**

- **Real ROM, not a re-implementation.** The Studio is a hand-written JavaScript port of each routine; WSED runs the **actual ROM bytes** on a cycle-accurate 6802 emulator, so it's bit-faithful and any valid ROM works unchanged.
- **Three games, not one.** Defender only, vs. WSED's Defender + Stargate + Robotron.
- **Explore + Design, not just tweak.** WSED has a separate **Explore** mode (DAC byte-tape, routine swimlane, LFSR/engine state, RAM heatmap, spectrogram, scrubber, single-step) — and the Designer's **Open in Explore** + **↓ .bin** push your custom ROM into Explore's live pipeline or MAME respectively. The Studio is play-and-tweak only.
- **`.bin` round-trip.** WSED's Designer downloads a runnable custom ROM you can load in MAME or burn to EPROM, and uploads it back to keep editing. The Studio's saved artefact is a JSON preset that stays in the browser.

**Current state (editor coverage):**

The Studio's 9 UI tabs edit **6 of Defender's data-driven sound engines** today (the other 3 are parameterless in the ROM). WSED currently edits **2 of those engines (VARI + GWAVE)** but across all three games; **LFSR and FNOISE editors are planned next** (research done — see `plans/designer-mode.md` Phases 7 + 8), at which point editor coverage matches the Studio's, with WSED still running the actual ROMs over three games rather than a hand-port over one.

→ [`docs/sound_studio_reference.md`](docs/sound_studio_reference.md); the full feature-by-feature table is in [`MANUAL_DESIGNER.md`](MANUAL_DESIGNER.md).

### vs. disassemblies & write-ups

[Computer Archeology](https://computerarcheology.com/Arcade/Defender/SoundHardware.html), [ZEN Instruments](http://zeninstruments.blogspot.com/2020/02/williams-defender-sound-disassembly.html), and [Nameless Algorithm](https://namelessalgorithm.com/defender/) offer excellent *static* documentation — annotated source listings and prose explaining how the routines work. WSED stands on their shoulders (and links them), but makes the same code **audible, animated at human-scale time, and editable** rather than read-only. → links in [`docs/00_INDEX.md`](docs/00_INDEX.md)

## Development

```bash
cd explorer
npm test             # Vitest
npm run typecheck    # strict tsc --noEmit
npm run build        # production bundle → explorer/dist  (no ROM bytes)
```

## License

MIT — see [`LICENSE`](LICENSE). The MIT license covers the explorer app, the build tooling, and the documentation. It does **not** cover the Williams sound ROMs (© Williams Electronics, not included), nor the third-party `vasm` assembler and npm dependencies, which keep their own licenses.

The names *Defender*, *Stargate*, *Robotron 2084*, and *Williams* are used descriptively to identify the games whose sound code is analyzed here; no affiliation or endorsement is implied.
