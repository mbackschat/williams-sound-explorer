#!/usr/bin/env python3
"""
Build `explorer/public/data/glossary.json` from the per-game catalogue docs.

The catalogue master tables in `docs/{defender,robotron}_sound_catalogue.md`
follow a regular layout:

    | $XX | Engine | Routine | Name | Notes |

This script extracts one row per command code and emits a flat
`{ game: { "XX": { name, engine, routine, blurb } } }` JSON used by the
browser harness for glossary tooltips.  Stargate inherits from Defender
(byte-identical for 30 of 31 commands) with the two ORGAN entries overridden
to reflect the Stargate-specific changes documented in
`docs/stargate_sound_catalogue.md`.

Run:
    uv run tools/build_glossary.py
or:
    python3 tools/build_glossary.py
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Row regex.  Captures: cmd, engine, routine, name, [optional notes].
# Some cells contain *italics*, **bold**, `backticks` — we strip those when
# normalising.
ROW = re.compile(
    r"^\|\s*`?\$([0-9A-Fa-f]{1,2})`?\s*\|\s*"
    r"([^|]+?)\s*\|\s*"
    r"([^|]+?)\s*\|\s*"
    r"([^|]+?)\s*"
    r"(?:\|\s*([^|]*?)\s*)?"
    r"\|\s*$",
    re.MULTILINE,
)


def normalise(cell: str) -> str:
    s = cell.strip()
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    return s


def parse_catalogue(md: Path) -> dict[str, dict[str, str]]:
    text = md.read_text()
    start = text.find("## Master command table")
    if start == -1:
        raise RuntimeError(f"{md.name}: master table not found")
    section = text[start:]
    end = section.find("\n## ", 5)
    table = section[: end if end > -1 else len(section)]

    out: dict[str, dict[str, str]] = {}
    for m in ROW.finditer(table):
        code = m.group(1).upper().zfill(2)
        engine = normalise(m.group(2))
        routine = normalise(m.group(3))
        name = normalise(m.group(4))
        notes = normalise(m.group(5) or "")
        # Skip the markdown table separator row "|---|---|"
        if engine.startswith("---") or engine == "Engine":
            continue
        entry: dict[str, str] = {
            "name": name,
            "routine": routine,
            "engine": engine if engine != "—" else "",
        }
        if notes:
            entry["blurb"] = notes
        out[code] = entry
    if not out:
        raise RuntimeError(f"{md.name}: parsed 0 rows — table format changed?")
    return out


def build() -> dict:
    defender = parse_catalogue(ROOT / "docs/defender_sound_catalogue.md")
    robotron = parse_catalogue(ROOT / "docs/robotron_sound_catalogue.md")

    # Stargate inherits from Defender (byte-identical for 30/31 codes), with
    # the two ORGAN entries overridden per docs/stargate_sound_catalogue.md.
    stargate = {code: dict(v) for code, v in defender.items()}
    stargate["1B"] = {
        "name": "ORGANT — Stargate tune",
        "routine": "ORGANT",
        "engine": "ORGAN",
        "blurb": "Plays one of two new tunes: FIFTH (Close Encounters motif) or NINTH (a longer baroque-style figure). Defender's PHANTOM/TACCATA were replaced.",
    }
    stargate["1C"] = {
        "name": "ORGANN — gutted",
        "routine": "ORGANN",
        "engine": "ORGAN",
        "blurb": "Stub: immediate RTS, silent. Defender's per-note arm was removed.",
    }

    return {
        "defender": defender,
        "stargate": stargate,
        "robotron": robotron,
        "terms": TERMS,
    }


# ----------------------------------------------------------------------------
# Glossary of engine/technique names used throughout the catalogue + UI.
# Curated from docs/synthesis_techniques.md so each entry is short enough to
# fit in a tooltip but explains *why* the term matters here.
# ----------------------------------------------------------------------------

TERMS: dict[str, dict[str, str]] = {
    "GWAVE": {
        "title": "GWAVE — wavetable engine",
        "what": "Reads samples from a small ROM lookup table (sine, square, harmonic mix) in a phase-accumulator loop.",
        "how": "Inner loop walks an index X across a length-prefixed LUT, dwelling GPER cycles per sample. Frequency comes from a pattern table; envelopes come from RAM-copy decay (WVDECA).",
        "where": "Most reused engine on the board. Drives HBDV (heartbeat), STDV (start swell), bonus chimes, lander deaths, etc.",
    },
    "LFSR": {
        "title": "LFSR — linear-feedback shift register",
        "what": "A 16-bit pseudo-random bit generator: XOR taps on bits 0 and 3 feed back into the top, giving a 65 535-step repeating noise sequence.",
        "how": "On each clock the high byte rotates right through carry; the carry comes from XORing two low-byte bits. Noise routines feed the carry (or the whole word) to the DAC for sweeping noise.",
        "where": "LITE (lightning), APPEAR (enemy appear), TURBO (noise burst), and as the bit-source feeding NOISE/FNOISE.",
    },
    "LITEN": {
        "title": "LITEN — LFSR inner-loop helper",
        "what": "The shared LFSR-clock subroutine that LITE / APPEAR / TURBO call repeatedly.",
        "how": "Each call advances the 16-bit shift register once, leaves the new carry in C, and (in LITE's case) `COM SOUND` toggles the DAC byte.",
        "where": "Defender / Stargate / Robotron all share this routine. Centre of the lightning-style sounds.",
    },
    "VARI": {
        "title": "VARI — variable-duty-cycle square",
        "what": "Pitch-modulating square-wave engine. Two timers (LOPER, HIPER) set how long the DAC sits at each level.",
        "how": "Inner loop alternately holds the DAC high for HIPER counts, then low for LOPER counts. Both timers can ramp over the sound's lifetime to slide pitch + duty.",
        "where": "SAW (descending saw), FOSHIT (foe-hit), QUASAR (zap), spinner sounds, MOSQTO (Robotron).",
    },
    "FNOISE": {
        "title": "FNOISE — slope-limited filtered noise",
        "what": "DAC walk-toward-target noise. Each step nudges the DAC value by a small amount toward an LFSR-derived target, producing band-limited (gravelly, not bright) noise.",
        "how": "Read LFSR → target; step DAC by ±1 (or ±N) toward it; repeat. The slope limit kills the highest noise frequencies.",
        "where": "Thrust drone, cannon, background buzzes, BG1/BG2 droning.",
    },
    "RADIO": {
        "title": "RADIO — short LUT playback",
        "what": "A 16-byte table played back as DAC samples, looped. Sounds like clipped speech without actually being speech.",
        "how": "Sequential read of `RDPAT` (16 bytes) at a fixed sample rate; the discontinuities are the character.",
        "where": "Defender's $18 RADIO — the iconic 'something-is-happening' chatter.",
    },
    "HYPER": {
        "title": "HYPER — pulse-width-modulated sweep",
        "what": "PWM warp effect: the DAC alternates between two values at a rate that sweeps over time, creating a 'tearing-time' warble.",
        "how": "Two nested counters: outer one moves the inner one's threshold, varying the duty cycle from 0% to 100% and back.",
        "where": "Hyperspace warp ($19) in Defender / Stargate / Robotron.",
    },
    "SCREAM": {
        "title": "SCREAM — 4-voice additive synthesis",
        "what": "Four independent phase accumulators are summed per sample and the high byte is written to the DAC. Audibly: drifting, beating tones.",
        "how": "Four (phase, increment) pairs in RAM; each increment shifts pitch over the sound's duration. Sum overflow is OK — that's the bit-crusher character.",
        "where": "Death scream ($1A) — also reused for Stargate's Inviso event.",
    },
    "ORGAN": {
        "title": "ORGAN — multi-note tune engine",
        "what": "Plays sequences of notes with per-note pitch and duration. Uses a wavetable underneath (similar to GWAVE) but with a tune-data interpreter on top.",
        "how": "Tune table is a list of (note, duration) pairs. Each note sets a GPER and a sample count; the engine loops the wavetable that many times before advancing.",
        "where": "Defender's PHANTOM and TACCATA; Stargate's FIFTH (CE3K) and NINTH; Robotron has its own polyphonic ORGAN with popcount mixing.",
    },
    "BG": {
        "title": "BG — background drone",
        "what": "Persistent low-volume noise played continuously between other sounds. The 'arcade ambience' under everything.",
        "how": "FNOISE-driven; the IRQ handler's BG poll runs whenever no foreground command is active.",
        "where": "BG1 (background start), BG2INC (turbine ratchet that raises BG pitch), BGEND (silence the background).",
    },
    "PWM": {
        "title": "PWM — pulse-width modulation",
        "what": "Encoding a value by varying how long a high-vs-low pulse stays at each level. The duty cycle (high-fraction) controls amplitude/timbre.",
        "how": "On the Williams board this means alternating two DAC values at fast rates; the ratio (1.45 μs resolution) varies over time.",
        "where": "VARI engine and the HYPER warp use PWM mechanics in different ways.",
    },
    "DAC": {
        "title": "DAC — digital-to-analog converter",
        "what": "The MC1408 8-bit DAC at PIA Port A. Each byte the CPU writes (`STAA $0400`) becomes a voltage on the speaker amplifier input.",
        "how": "256 voltage levels (0x00 = full-negative, 0x80 = mid-rail/silence, 0xFF = full-positive) followed by a single-pole ~10 kHz reconstruction filter (1458 op-amp).",
        "where": "All Williams sounds work by streaming bytes to this single 8-bit DAC; no on-chip mixer, no separate channels.",
    },
    "PIA": {
        "title": "PIA — MC6821 peripheral interface adapter",
        "what": "The chip that wires the sound CPU to the DAC and to the main-CPU command latch.",
        "how": "Port A = DAC byte (output). Port B = 6-bit command latch (input from main CPU). The CA1 line strobes /IRQ when a new command lands.",
        "where": "Memory-mapped at $0400-$0403 on every Williams sound board (and mirrored at $8400 — bit 15 is ignored by the decoder).",
    },
    "IRQ": {
        "title": "IRQ — interrupt request",
        "what": "Hardware signal that pre-empts the CPU and vectors it to a handler. On the sound board, IRQ = 'a new command arrived in PIA Port B.'",
        "how": "PIA's CA1 line goes high when the main CPU writes Port B. The 6802 pushes its registers and jumps via $FFF8/9 to the per-game IRQ handler. Reading Port B inside the handler clears CA1.",
        "where": "Every sound starts with an IRQ. The handler reads the command, dispatches to a per-code routine (LITE / HBDV / etc.), runs the sound to completion, then RTIs back to the BRA-self idle loop.",
    },
    "BRA-self": {
        "title": "BRA-self idle loop",
        "what": "A two-byte `BRA *` (branch to itself) instruction that the sound CPU sits on when no sound is playing.",
        "how": "Williams' main loop after SETUP is literally `LOOP: BRA LOOP`. CPU spins here, waiting for the next IRQ.",
        "where": "Defender / Stargate / Robotron all use the same idiom. The explorer detects it for 'idle' classification.",
    },
    "ZOH": {
        "title": "ZOH — zero-order hold",
        "what": "Resampling rule: between two known sample times, hold the previous value flat until the next change.",
        "how": "Models a physical sample-and-hold DAC ladder: the analogue voltage stays where it was until the CPU writes a new byte.",
        "where": "Used in both the offline `renderDacEvents` resampler and the realtime `fillBlock` per-sample loop.",
    },
    "LPF": {
        "title": "LPF — low-pass filter",
        "what": "Audio filter that attenuates frequencies above its cutoff. On Williams hardware, a single-pole RC filter at ~10 kHz tames the DAC stair-step.",
        "how": "Single-pole IIR: y[n] = α·x[n] + (1−α)·y[n−1]. α derived from cutoff Hz + sample rate; cutoff ~10 kHz matches the 1458 op-amp's analogue tail.",
        "where": "Both offline (`synth/lpf.ts`) and realtime (`engine/realtimeRunner.ts`) apply it inline. Doesn't kill DAC aliasing entirely — that's part of the iconic Williams grit.",
    },
    "WVDECA": {
        "title": "WVDECA — wavetable decay",
        "what": "Subtractive amplitude envelope: instead of multiplying samples by a gain factor, decay a working RAM copy of the wavetable.",
        "how": "Each echo iteration subtracts a small amount from each sample (`working[i] -= original[i] >> 4 * decay`) with intentional 8-bit wrap-around — the wrap is what gives later iterations the 'glitched' timbre.",
        "where": "GWAVE family. Heartbeat echoes, bonus chimes, lander deaths.",
    },
    "6802": {
        "title": "6802 — the sound CPU",
        "what": "Motorola 6802: a 6800 core with 128 bytes of on-chip RAM, clocked at 894 886 Hz on the Williams sound board.",
        "how": "Runs a tiny ROM program (2 KB Defender/Stargate, 4 KB Robotron). No timers or sound hardware — it makes sound purely by writing bytes to the DAC at cycle-counted intervals.",
        "where": "Every sound is this CPU executing a per-command routine. Its 128-byte zero page is the working RAM you see in the heatmap.",
    },
    "CA1": {
        "title": "CA1 — PIA interrupt strobe",
        "what": "The PIA control line that fires the CPU's IRQ when the main game CPU drops a new command into Port B.",
        "how": "A Port-B write pulses CA1; the PIA latches an interrupt flag and asserts /IRQ. Reading Port B inside the handler clears the flag.",
        "where": "The trigger behind every sound — see IRQ and PIA.",
    },
    "mid-rail": {
        "title": "mid-rail — the silence level ($80)",
        "what": "The DAC's center value, $80. Output swings above it (toward $FF) and below it (toward $00); sitting at $80 is silence.",
        "how": "Because the amp is AC-coupled, only *changes* around mid-rail are heard. Sounds end by parking the DAC near $80.",
        "where": "The Eye byte-tape and oscilloscope draw symmetrically around mid-rail; the RAM heatmap's SOUND cell rests here when idle.",
    },
    "AC-coupling": {
        "title": "AC-coupling — the amp's DC blocker",
        "what": "A series capacitor on the amplifier input that passes audio but blocks any steady DC offset left on the DAC.",
        "how": "Modeled in the explorer as a ~5 Hz high-pass between the gain stage and the output, so a sound that ends parked away from mid-rail fades to silence instead of leaving a click/hum.",
        "where": "Why the spectrogram goes dark after a sound ends rather than painting a persistent DC band.",
    },
    "phase accumulator": {
        "title": "phase accumulator — the pitch counter",
        "what": "A running counter whose high bits index a wavetable; the increment added each step sets the pitch.",
        "how": "Bigger increment → the index advances faster → higher pitch. Letting the accumulator overflow wraps cleanly back to the table start.",
        "where": "The mechanism under GWAVE (one accumulator) and SCREAM (four summed accumulators).",
    },
    "duty cycle": {
        "title": "duty cycle — high-fraction of a square wave",
        "what": "The proportion of each cycle the DAC sits high versus low. 50% is a symmetric square; skewed ratios change the timbre.",
        "how": "VARI holds the DAC high for HIPER counts then low for LOPER counts; the HIPER:LOPER ratio is the duty cycle, and ramping the two timers slides pitch and timbre together.",
        "where": "The VARI engine pane's duty-cycle preview; PWM effects.",
    },
    "popcount": {
        "title": "popcount — set-bit count",
        "what": "The number of 1-bits in a byte. ORGAN reads it from the OSCIL mask to know how many notes are sounding at once.",
        "how": "Each set OSCIL bit enables one oscillator; the popcount is the polyphony, and the sum of active voices is what reaches the DAC.",
        "where": "Robotron's polyphonic ORGAN (Beethoven's 9th) — muting OSCIL bits changes the popcount and you hear voices drop out.",
    },
    "OSCIL": {
        "title": "OSCIL — ORGAN oscillator mask",
        "what": "A zero-page bitmask where each set bit enables one of ORGAN's oscillators (voices).",
        "how": "The engine sums every enabled voice per sample; clearing a bit silences that voice immediately (the basis of the ORGAN voice-mute toggles).",
        "where": "ORGAN engine pane (the b0..b7 checkboxes) and the RAM heatmap.",
    },
    "GPER": {
        "title": "GPER — GWAVE period",
        "what": "How many CPU cycles the GWAVE engine dwells on each wavetable sample before advancing — i.e. the pitch.",
        "how": "Larger GPER → slower walk through the table → lower pitch. The pattern table updates GPER per note to play a melody.",
        "where": "Shown in the Wavetable engine pane's caption; the GWAVE family (heartbeat, chimes, etc.).",
    },
    "GECHO": {
        "title": "GECHO — GWAVE echo flag",
        "what": "Non-zero while GWAVE is replaying its wavetable as a decaying echo rather than the initial strike.",
        "how": "When set, the engine re-walks the table with the amplitude knocked down by WVDECA — the trailing repeats you hear after a heartbeat or chime.",
        "where": "Caption of the Wavetable engine pane (● when echoing, ○ when not).",
    },
    "GECNT": {
        "title": "GECNT — GWAVE echo counter",
        "what": "How many echoes are left to play in the current GWAVE sound.",
        "how": "Loaded per sound, decremented as each echo finishes; the sound ends (returns to idle) when it reaches zero.",
        "where": "Caption of the Wavetable engine pane.",
    },
    "GECDEC": {
        "title": "GECDEC — decays per echo",
        "what": "How many WVDECA decay passes run on the wavetable between echoes — sets how fast the timbre fades.",
        "how": "Higher GECDEC = more amplitude subtracted per echo = a faster-dying sound.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "GWFRM": {
        "title": "GWFRM — waveform address",
        "what": "16-bit pointer to the source waveform bytes GWAVE copies into the live $24..$6B table.",
        "how": "Set per sound from a preset table (sine, square, harmonic mix, …); the copy is what WVDECA then mutates in place for echoes.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "GWFRQ": {
        "title": "GWFRQ — frequency-table address",
        "what": "16-bit pointer into the per-note pitch (GPER) pattern table the GWAVE melody steps through.",
        "how": "Each note advances the pointer; the value read becomes the next GPER (dwell-per-sample), so this table *is* the tune.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "FOFSET": {
        "title": "FOFSET — frequency offset",
        "what": "Signed value added to each note's period — transposes the whole GWAVE melody up or down.",
        "how": "Applied as the pattern table is read; negative raises pitch (shorter period), positive lowers it.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "GDFINC": {
        "title": "GDFINC — delta-frequency increment",
        "what": "Per-step amount added to the running pitch delta, gliding GWAVE's pitch across a note.",
        "how": "Accumulated each sample so the period drifts smoothly instead of jumping — the source of GWAVE's slides/swells.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "PRDECA": {
        "title": "PRDECA — pre-decay factor",
        "what": "Amount the WVDECA pass subtracts from the wavetable amplitude before each echo.",
        "how": "Bigger PRDECA = the echoes lose volume faster; the knob behind the characteristic decaying timbre.",
        "where": "Footer of the Wavetable engine pane.",
    },
    "LOPER": {
        "title": "LOPER — VARI low period",
        "what": "How long (in counts) the VARI engine holds the DAC at its low level each cycle.",
        "how": "Paired with HIPER: the LOPER:HIPER ratio is the duty cycle and their sum is the period (pitch). LODT/LOMOD ramp LOPER over the sound's life, sliding pitch + timbre. The VARI pane's blue 'LO' bar is LOCNT counting down from LOPER.",
        "where": "VARI engine — SAW, FOSHIT, QUASAR, spinner sounds. Zero page $13 (Defender/Stargate), $12 (Robotron).",
    },
    "HIPER": {
        "title": "HIPER — VARI high period",
        "what": "How long (in counts) the VARI engine holds the DAC at its high level each cycle.",
        "how": "Paired with LOPER to set the square wave's duty cycle and period. HIDT ramps it over the sound's life. The VARI pane's green 'HI' bar is HICNT counting down from HIPER.",
        "where": "VARI engine. Zero page $14 (Defender/Stargate), $13 (Robotron).",
    },
    "envelope": {
        "title": "envelope — amplitude over time",
        "what": "The loudness contour of a sound from onset to decay. The Williams board has no dedicated envelope generator.",
        "how": "Envelopes are faked: GWAVE decays a RAM copy of the wavetable (WVDECA), VARI ramps its timers, and tune engines just stop writing. The shape is baked into the routine.",
        "where": "Why each sound's tail sounds the way it does — see WVDECA for the GWAVE case.",
    },
    "SETUP": {
        "title": "SETUP — boot routine",
        "what": "The code each ROM runs from reset: initialise the stack, clear RAM, then drop into the idle loop.",
        "how": "Runs once at power-on (or when the explorer loads a game), then falls into BRA-self to wait for the first command.",
        "where": "The first lane in the Stage swimlane before any sound fires.",
    },
    "RTI": {
        "title": "RTI — return from interrupt",
        "what": "The 6800 instruction that ends an IRQ handler, restoring the registers saved when the interrupt fired.",
        "how": "Pops CCR, B, A, X, and PC off the stack in order, resuming exactly where the CPU was — which on this board is the BRA-self idle.",
        "where": "The last instruction of every sound's handler; the '▸ IRQ' step lands just after the previous RTI.",
    },
    "FFT": {
        "title": "FFT — fast Fourier transform",
        "what": "An algorithm that decomposes a slice of the output waveform into its frequency components.",
        "how": "The explorer feeds the post-volume signal through a Web Audio AnalyserNode (which runs an FFT) and scrolls the magnitudes as the spectrogram — low frequencies at the bottom, high at the top.",
        "where": "The Spectrogram panel. LITE's LFSR noise shows up as a broadband upward sweep.",
    },
}


def main() -> None:
    out = ROOT / "explorer/public/data/glossary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    out.write_text(json.dumps(data, indent=2) + "\n")
    n = sum(len(v) for v in data.values())
    print(f"wrote {out.relative_to(ROOT)} — {n} entries ({', '.join(f'{g}={len(v)}' for g, v in data.items())})")


if __name__ == "__main__":
    main()
