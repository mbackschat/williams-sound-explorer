# Williams Sound Designer — Manual

> How to build your own custom sound ROM in the explorer's **Design** mode (the companion to the explorer's [`MANUAL.md`](MANUAL.md)). For *how it's built*, see [`docs/designer_implementation.md`](docs/designer_implementation.md).

## What it is

A Williams arcade sound isn't a sample or an FM patch — it's a tiny **parameter record** that a shared synthesis engine reads. The VARI engine, for instance, turns just **nine bytes** into a swept variable-duty square wave (that's the whole of SAW, FOSHIT, QUASAR…). Design mode lets you do what Sam Dicker did when building a new Williams game: **assemble your own list of VARI sounds** — copy any game's sound as a starting point or add a new one, edit its parameter record, hear it, and save it as a custom ROM.

This covers the **VARI** engine.

## Getting in

At the top of the page there's an **Explore | Design ✎** switch. Click **Design**. (Explore mode is completely unchanged — Design is a separate surface.)

You need a **Defender or Stargate ROM** loaded — your custom ROM runs on one of their VARI engines. (If you also have the Robotron ROM, you can copy *its* VARI sounds too.) ROMs are added on the Explore onboarding screen.

## The workflow

1. **Engine** — pick **Defender** or **Stargate**: which VARI engine your custom ROM runs on. (A record copied from any game plays the same — the engine is identical across games.)
2. **Build your list — "Your sounds":**
   - **+ New** adds a sound (seeded from the base game's SAW as a starting point).
   - **+ Copy from…** adds a sound copied from any loaded game's VARI catalogue — `SAW` / `FOSHIT` / `QUASAR` (Defender/Stargate), `MOSQTO` (Robotron), and so on.
   - Each sound has a **name** (click to rename) and is auto-assigned a command code (`$1D`, `$1E`, …) by list order. **✕** removes one. You can hold up to **23** sounds on a Defender engine, **30** on Stargate.
   - Click a sound to select and edit it.
3. **Edit the parameter record** — drag the eight sliders. Hover each label:
   - **LOPER / HIPER** — the low- and high-cycle periods; together they set the duty cycle and pitch.
   - **LODT / HIDT** — how fast each period sweeps (signed).
   - **HIEN** — the threshold where the sweep stops.
   - **SWPDT** — a 16-bit countdown before the low-modulation kicks in.
   - **LOMOD** — added to the low period once the sweep finishes (signed).
   - **VAMP** — output amplitude.
4. **Audition** — the transport:
   - **▶ Play** plays the selected sound from the top; **⏸ Pause** holds / **▶ Resume** (sounds can run several seconds).
   - **🔁 Loop** repeats continuously — edits update the loop live, so you can tweak-and-listen hands-free.
   - **Source: ⟨Edited │ Start⟩** A/Bs your edits against the sound's starting point (its record when copied/created); flip it mid-playback to compare by ear.
   - **⇄ Diff** toggles an overlay of the starting point (grey) + divergence (red) behind the live trace, without interrupting audio.
   - A **playhead** sweeps the scope in time with playback and freezes on Pause; **editing any slider auto-replays** so you hear each change immediately.
   (Audition runs the actual custom ROM image through the real emulator offline — what you hear is faithful. Very long sounds are capped at 5 seconds.)
5. **Save / share** —
   - Name the project and click **Save** — it persists in your browser (IndexedDB) and reappears in **Open**.
   - **⬇ JSON** downloads the project as a recipe; **⬆ JSON** loads one back. The file holds only your sounds' names + parameter values — **no copyrighted ROM bytes** — so it's safe to share, and it's reconstituted against your own base ROM.

## Good first experiments

- **+ Copy from… Defender SAW**, then raise **LOPER** a lot → the zap stretches longer and drops in pitch (you'll hit the 5 s cap).
- Copy SAW twice; on one, swap **HIDT** between small and large → changes how fast it sweeps. A/B them by selecting each.
- Use **Source ⟨Edited│Start⟩** + **Diff** to see exactly how far your edits moved a sound from where it started.

## How it compares to the original "Sound Designer"

The closest prior art is msarnoff's **[Defender Sound Studio](https://zapspace.net/defender_sound/)** (2020) — see [`docs/sound_studio_reference.md`](docs/sound_studio_reference.md). It pioneered the idea of *tweak a Williams sound's parameters in the browser and hear it*, and we deliberately reuse two of its good ideas: **labelled parameter controls with in-place tooltips**, and **JSON preset import/export**. Where this mode differs:

| | Defender Sound Studio (2020) | Design mode here |
|---|---|---|
| **How sounds run** | each ROM routine hand-ported to JavaScript | the **real ROMs** on a cycle-accurate 6802 emulator (bit-faithful) |
| **Games** | Defender only | Defender, Stargate, **and** Robotron |
| **What you make** | tweak one handler's existing preset | your **own custom ROM** — copy/new VARI sounds in your **own named item list**, at **new command codes** |
| **Editing** | numeric inputs + tooltips | sliders + tooltips (same idea) |
| **Comparing** | — | **A/B** (Edited vs Start) + a visual **Diff** overlay |
| **Seeing** | oscilloscope + FFT | + DAC byte-tape, routine swimlane, LFSR/engine state, RAM heatmap, spectrogram, scrub, single-step (in Explore) |
| **Saving** | JSON preset | JSON recipe — **zero ROM bytes**, reconstituted against your own ROM |

In short: the Studio *tweaks* one game's existing sounds with a JS re-implementation; this builds a **new custom ROM** of sounds across all three games on the actual emulated hardware.

## Limits

VARI only, on a **Defender/Stargate** engine base. You can't yet copy/edit the other engines (GWAVE wavetables, SCREAM, ORGAN tunes), use Robotron as the engine base, or pause/step the live CPU on a custom sound — those are planned follow-ups (see [`docs/designer_implementation.md`](docs/designer_implementation.md)).
