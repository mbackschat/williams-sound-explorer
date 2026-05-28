# Sound Designer mode — user guide

> How to author your own Williams sound in the explorer's **Design** mode. For *how it's built*, see [`designer_implementation.md`](designer_implementation.md).

## What it is

A Williams arcade sound isn't a sample or an FM patch — it's a tiny **parameter record** that a shared synthesis engine reads. The VARI engine, for instance, turns just **nine bytes** into a swept variable-duty square wave (that's the whole of SAW, FOSHIT, QUASAR…). Design mode lets you do exactly what Sam Dicker did when building a new Williams game: take an engine, fill in its parameter record, and listen.

v1 covers the **VARI** engine, by **copying an existing sound and modifying it**.

## Getting in

At the top of the page there's an **Explore | Design ✎** switch. Click **Design**. (Explore mode is completely unchanged — Design is a separate surface.)

You need at least one **base ROM** loaded. If you've already used Explore, your ROMs are there; if not, switch to Explore, add a sound ROM via the onboarding screen, then come back.

## The workflow

1. **Base ROM** — pick Defender, Stargate, or Robotron. (Games you haven't loaded a ROM for are locked.) Your custom sound is built on top of this game's engine code.
2. **Sound** — pick a VARI command to start from: `$1D SAW`, `$1E FOSHIT`, `$1F QUASAR` (and `$3F MOSQTO` on Robotron). This copies the original's parameter record into the editor.
3. **Edit the parameter record** — drag the eight sliders. Hover each label for what it does:
   - **LOPER / HIPER** — the low- and high-cycle periods; together they set the duty cycle and pitch.
   - **LODT / HIDT** — how fast each period sweeps (signed).
   - **HIEN** — the threshold where the sweep stops.
   - **SWPDT** — a 16-bit countdown before the low-modulation kicks in.
   - **LOMOD** — added to the low period once the sweep finishes (signed).
   - **VAMP** — output amplitude.
   A sound you've changed gets a green ● in the picker.
4. **Audition** —
   - **▶ Play** renders your edited sound and plays it.
   - **▶ Original** plays the unedited version for comparison.
   - **⇄ Diff** overlays edited (green) over original (grey) on the scope and shades where they differ (red).
   - **⟲ Reset** discards your edits to this sound.
   (Audition renders offline through the real emulator — the exact same engine the explorer plays, so what you hear is faithful. Very long edits are capped at 5 seconds.)
5. **Save / share** —
   - Give the project a **name** and click **Save** — it persists in your browser (IndexedDB) and reappears in the **Open** dropdown.
   - **⬇ JSON** downloads the project as a recipe file; **⬆ JSON** loads one back. The file contains only your parameter values — **no copyrighted ROM bytes** — so it's safe to share. Re-opening it reconstitutes the sound against your own base ROM.

## Good first experiments (start from SAW on Defender)

- Raise **LOPER** a lot → the sound stretches longer and drops in pitch (you'll hit the 5 s cap).
- Swap **HIDT** between small and large → changes how fast the zap sweeps.
- Push **VAMP** down → quieter; the waveform shrinks on the scope.
- Set everything close to QUASAR's values and diff against the real QUASAR to see how few bytes separate two "different" arcade sounds.

## Limits (v1)

Only VARI, and only by editing the four existing VARI commands. You can't yet add a brand-new command code, edit the other engines (GWAVE wavetables, SCREAM, ORGAN tunes…), or pause/step the custom sound — those are planned follow-ups (see [`designer_implementation.md`](designer_implementation.md)).
