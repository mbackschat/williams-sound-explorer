# Reference Audio Acquisition Plan

> How to obtain reference recordings of every sound effect in Defender, **Defender II** (= Stargate), and Robotron. These recordings serve two purposes: (1) a "ground truth" the user can A/B against the emulator, (2) a regression-test surface so emulator drift is detectable.

## Naming note: Defender II = Stargate

The arcade game **Stargate** (Williams, 1981) was renamed **Defender II** for several home/console releases. The sound ROM is `VSNDRM2.SRC` in `research/williams-soundroms/`. When the user says "Defender II", they mean the same sounds as arcade Stargate. There is no separate Defender II ROM.

---

## Three viable paths

### Path A — MAME `-wavwrite` audio capture *(fastest, lowest fidelity for isolation)*

Run MAME against each game with audio capture on:

```bash
mame defender -wavwrite defender_session.wav
mame stargate -wavwrite stargate_session.wav
mame robotron -wavwrite robotron_session.wav
```

Then play through enough gameplay to trigger every sound, and post-process to isolate individual effects (silence-detection + manual labelling).

**Pros**
- Works immediately if MAME is installed and ROMs are available.
- Audio is bit-faithful to the emulator's view of the sound board.
- One command, no code to write.

**Cons**
- Output is **mixed** — game music, multiple effects overlapping, background drones. Isolating a single sound means hunting through several minutes of gameplay.
- Requires playing the game well enough to trigger rare sounds (e.g., extra-life jingle, smart-bomb, hyperspace).
- Some sounds (the test/utility ones like Defender's `$0A` SV3) are never triggered by gameplay.
- Needs ROM binaries (legal status varies; ROMs ship outside MAME).

**Best for**: a quick "vibe-check" reference for the most common sounds. Not suitable as the complete corpus.

### Path B — Assemble + drive sound CPU directly *(cleanest, the foundation of the explorer)*

1. **Assemble** the three `.SRC` files into binary ROMs:
   ```bash
   # Approximate; the historicalsource repo includes build scripts in some forks
   asm6800 -o defender_sound.bin VSNDRM1.SRC
   asm6800 -o stargate_sound.bin VSNDRM2.SRC
   asm6800 -o robotron_sound.bin VSNDRM3.SRC
   ```
2. **Write a driver** that runs a 6800 emulator with the sound ROM, simulates a main-CPU PIA write of each command code 0x00..0x3F in turn, waits for the sound to complete (or hits a fixed timeout), captures all `STAA $0400` writes, resamples to 48 kHz, and writes a WAV.
3. **Output**: one WAV per command code per game, e.g. `defender_$13_player_shoot.wav`, `robotron_$1A_scream.wav`. Total: ~32 + ~32 + ~64 = **128 files**.

**Pros**
- Each effect is **isolated** — clean, named, length-bounded.
- Reproducible — re-run the driver, get byte-identical output.
- 100% coverage including the never-triggered-in-gameplay sounds.
- Becomes the foundation for the explorer (the 6800 emulator is Phase 1 of `explorer_architecture.md`).
- No ROM binary download — assemble from cloned source.

**Cons**
- Requires writing the 6800 emulator and driver (~500–800 LOC).
- "Sound completion" detection is fuzzy — some routines loop forever and rely on a new IRQ to stop them; pick a sensible timeout (e.g. 3 seconds) or detect the `BRA *` idle pattern.

**Best for**: the canonical reference set. This is the right long-term answer.

### Path C — Bulk-render via Defender Sound Studio *(Defender only, easy if scripted)*

Daniel Lopez's [Defender Sound Studio](https://zapspace.net/defender_sound/) already renders every Defender preset in JS. With a headless browser and a script, you could programmatically:
1. Load the studio page.
2. For each of the 9 handler tabs × N presets, click "Play" and record the audio output.
3. Save labelled WAVs.

**Pros**: zero new code on the synthesis side. Pre-validated audio.

**Cons**:
- **Defender only** — Stargate and Robotron aren't covered.
- The studio's resampler picks up the AudioContext default rate (varies by host), so output is host-dependent.
- Some sounds in the studio (the "Unidentified" presets) aren't in the gameplay-reachable set anyway.

**Best for**: a quick Defender-only sanity check while Path B is being built.

---

## Recommended approach

**Short term (this week)**: Path A. Capture three MAME sessions. Manually extract a handful of the iconic sounds (heartbeat, lander die, scream, hyperspace, smart bomb). Total: ~15 named WAVs, ~30 min of work.

**Medium term (when the emulator works)**: Path B. Once Phase 1 of the explorer architecture exists, write a 200-line driver around it that loops command codes 0x00..0x3F, dumps WAVs, names them from the catalogue tables. Total: a full 128-WAV reference corpus.

**Stretch**: Path C to validate the Defender subset of Path B against an independent implementation.

---

## File layout proposal

```
reference_audio/
├── defender/
│   ├── 01_heartbeat_distorto.wav
│   ├── 02_start_swell.wav
│   ├── ...
│   ├── 13_player_shoot.wav
│   ├── 1A_scream.wav
│   └── metadata.json          # cmd → name → file → duration → params snapshot
├── stargate/                  # = Defender II
│   ├── 01_heartbeat.wav
│   └── ...
├── robotron/
│   ├── 01_heartbeat.wav
│   ├── 1A_scream.wav
│   ├── 1B_organ_ninth.wav    # Beethoven 9th — the iconic wave-start
│   ├── 3A_crowd_roar.wav
│   └── ...
└── README.md
```

Naming convention: `<hex_cmd>_<snake_case_name>.wav`. Hex command first sorts naturally and makes the link to the catalogue trivial.

WAV format: **48 kHz, 16-bit mono, PCM**. Matches the AudioWorklet output. No compression — these are reference grade.

---

## Sources for prerecorded audio (incomplete; supplemental only)

Already identified and unlikely to fully replace Paths A/B:

| Source | Coverage | Quality | Notes |
|---|---|---|---|
| The Sounds Resource — Robotron | partial Robotron | OGG/MP3 lossy | <https://sounds.spriters-resource.com/arcade/robotron2084/> |
| Archive.org Williams Arcade Classics | all three games | low-fi (Tiger Electronics port) | Not the real arcade audio — *do not use as reference* |
| YouTube playlists | varies | lossy + ambient noise | Cross-reference only |

**No comprehensive named-effect pack exists publicly** for any of the three games. This is a real gap in the community; producing Path B would itself be a contribution worth publishing.

---

## What I can do for you right now

I can't run MAME or assemble ROMs in this conversation (no MAME binary, no assembler installed, ROMs not present). But I can:

1. **Write the driver script** (Path B) once you've decided on the host language for the explorer (TypeScript? JavaScript? Rust+WASM?) — that decision lives in `docs/explorer_architecture.md`'s "Implementation phases" section.
2. **Write a MAME capture script** (Path A) — a shell wrapper that runs MAME with the right flags and post-processes the WAV by silence-detection. Useful if you want to start with iconic-sound captures today.
3. **Catalogue every sound by hex code and human name** for both Defender and Robotron — already done in `docs/defender_sound_catalogue.md` and `docs/robotron_sound_catalogue.md`. Stargate's catalogue isn't written yet; ~250 lines of source-line analysis would produce it.

Pick what you want first and I'll execute.

---

## Cross-references

- The catalogues that name every sound: `docs/defender_sound_catalogue.md`, `docs/robotron_sound_catalogue.md`
- The emulator that powers Path B: `docs/explorer_architecture.md` Phase 1
- The pedagogical use of reference audio: `docs/pedagogical_design.md` "Reference-audio integration"
- The source-level basis for Stargate (a catalogue file doesn't exist yet): `research/williams-soundroms/VSNDRM2.SRC`
