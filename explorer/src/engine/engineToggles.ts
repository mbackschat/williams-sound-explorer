/**
 * Engine toggles — Pattern 3 "solo / mute / freeze" controls (Step 4.4).
 *
 * Each toggle gates a single, surgical RAM write so the user can hear what
 * happens when a specific piece of the synthesis algorithm is taken out of
 * the loop.  Implementation is non-destructive: `shouldDiscardWrite()`
 * returns `true` when the corresponding toggle would suppress the write,
 * and the bus simply skips the byte without otherwise altering CPU state.
 *
 * The pedagogical effects are documented next to each toggle and verified
 * by the tests in `engineToggles.test.ts`:
 *   - LFSR freeze → LO/HI never update → LITE becomes a steady periodic
 *     waveform at the (also-still-running) LFREQ rate.
 *   - VARI freeze period → LOPER/HIPER never update → SAW becomes a
 *     steady square wave with the initial duty cycle.
 *   - GWAVE freeze pattern → GPER never updates → heartbeat's pitch is
 *     pinned at the fire-time value (the pattern step's pitch contour is
 *     bypassed).
 *   - GWAVE skip decay → WVDECA's in-place writeback to the wavetable RAM
 *     is suppressed → the wavetable stays at the load-time bytes across
 *     every echo.
 *
 * NOTE: PC-gated traps use the *post-advance* `cpu.pc` (i.e. the address
 * of the instruction AFTER the writing op).  That's fine here because all
 * gated ranges are several bytes wide; the writing instruction's PC sits
 * 1-3 bytes inside the same range.
 */
import type { GameKind } from "../board/soundboard.ts";
import { wvdecaRange } from "./engineState.ts";

export interface EngineToggles {
  /** LFSR — discard writes to $09 / $0A so the shift register stops advancing. */
  lfsrFreeze?: boolean;
  /** VARI — discard writes to $13 / $14 so LOPER/HIPER stay at fire-time values. */
  variFreezePeriod?: boolean;
  /** GWAVE — discard writes to $21 (GPER) so the pattern step's pitch contour is bypassed. */
  gwaveFreezePattern?: boolean;
  /** GWAVE — discard writes to $24..$6B from inside WVDECA so the wavetable doesn't decay. */
  gwaveSkipDecay?: boolean;
  /**
   * SCREAM (Robotron) per-voice mute — Pattern 4 (Step 6.1).  Each toggle
   * discards writes to that voice's TIMER cell (only while PC is inside the
   * SCREAM routine).  CLR ,X zeros the cell at SCREAM entry, so the mute
   * pins TIMER at 0; ADDA TIMER,FREQ stays positive → BPL skips ADDB →
   * voice contributes nothing.  The voice's FREQ cell is left alone so the
   * cascade (voice N's FREQ hitting $37 starts voice N+1) keeps working.
   */
  screamMuteVoice0?: boolean;
  screamMuteVoice1?: boolean;
  screamMuteVoice2?: boolean;
  screamMuteVoice3?: boolean;
  /**
   * ORGAN (Robotron) per-voice mute — Pattern 4 expansion (Step 6.1+).  Each
   * toggle clears its bit of the OSCIL bitmask on every CPU write to the
   * OSCIL cell, only while PC is inside the ORGAN routine.  ORGAN's
   * popcount-polyphony means voice N contributes when OSCIL bit N is set;
   * masking the bit off on write silences exactly that voice without
   * touching the tune table or note arithmetic.
   *
   * Implemented as a *value transform* in `transformWriteValue()` rather
   * than as a discard, because we need to LET the write happen but with
   * the masked bits cleared.  Pattern 5 paramOverrides still take
   * precedence — an active override forces a fixed value regardless of
   * mute mask.
   */
  organMuteVoice0?: boolean;
  organMuteVoice1?: boolean;
  organMuteVoice2?: boolean;
  organMuteVoice3?: boolean;
  organMuteVoice4?: boolean;
  organMuteVoice5?: boolean;
  organMuteVoice6?: boolean;
  organMuteVoice7?: boolean;
}

/** All known toggle keys, exported so the host can iterate when wiring the UI. */
export const ENGINE_TOGGLE_KEYS = [
  "lfsrFreeze",
  "variFreezePeriod",
  "gwaveFreezePattern",
  "gwaveSkipDecay",
  "screamMuteVoice0",
  "screamMuteVoice1",
  "screamMuteVoice2",
  "screamMuteVoice3",
  "organMuteVoice0",
  "organMuteVoice1",
  "organMuteVoice2",
  "organMuteVoice3",
  "organMuteVoice4",
  "organMuteVoice5",
  "organMuteVoice6",
  "organMuteVoice7",
] as const satisfies readonly (keyof EngineToggles)[];

export type EngineToggleKey = (typeof ENGINE_TOGGLE_KEYS)[number];

/**
 * Per-game LO/HI / LOPER+HIPER / GPER / GWTAB cell addresses used by the
 * toggle gates.  Robotron's zero-page layout differs from Defender/Stargate
 * (the source was rewritten with its own EQUates), so each game has its own
 * cell map.  Kept in this file rather than imported from engineState.ts to
 * avoid a circular dep — these are the cells *the toggle* needs to gate,
 * which is a subset of what engineState reads, but defined independently
 * for clarity.
 */
const CELL_MAP: Record<GameKind, {
  lfsrHi: number; lfsrLo: number;
  variLoper: number; variHiper: number;
  gwaveGper: number;
  gwtabLo: number; gwtabHi: number;
  /** SCREAM PC range — SCREAM exists on all three games. */
  screamRange?: [number, number];
  /** TIMER cell address per voice index (0..3). */
  screamTimer?: readonly [number, number, number, number];
  /** ORGAN PC range — ORGAN exists on all three games. */
  organRange?: [number, number];
  /** OSCIL bitmask cell address. */
  organOscil?: number;
}> = {
  // SCREAM/ORGAN ranges + cells mirror engineState.ts SCREAM_SPECS / ORGAN_SPECS.
  // Defender/Stargate overlay one zero-page cell higher than Robotron: STABLE=$13
  // (TIMER cells $14/$16/$18/$1A) and OSCIL=$15.
  defender: {
    lfsrHi: 0x09, lfsrLo: 0x0A, variLoper: 0x13, variHiper: 0x14,
    gwaveGper: 0x21, gwtabLo: 0x24, gwtabHi: 0x6B,
    screamRange: [0xF9F3, 0xFA44], screamTimer: [0x14, 0x16, 0x18, 0x1A],
    organRange: [0xFA44, 0xFB0A], organOscil: 0x15,
  },
  stargate: {
    lfsrHi: 0x09, lfsrLo: 0x0A, variLoper: 0x13, variHiper: 0x14,
    gwaveGper: 0x21, gwtabLo: 0x24, gwtabHi: 0x6B,
    screamRange: [0xF9F3, 0xFA44], screamTimer: [0x14, 0x16, 0x18, 0x1A],
    organRange: [0xFA44, 0xFAE0], organOscil: 0x15,
  },
  robotron: {
    lfsrHi: 0x05, lfsrLo: 0x06, variLoper: 0x12, variHiper: 0x13,
    gwaveGper: 0x20, gwtabLo: 0x23, gwtabHi: 0x6A,
    // STABLE=$12, layout = 4×(FREQ, TIMER); TIMER cells are the odd offsets.
    screamRange: [0xF87A, 0xF8CB], screamTimer: [0x13, 0x15, 0x17, 0x19],
    organRange: [0xF8CB, 0xF967], organOscil: 0x14,
  },
};

/** Static list of (toggle key → voice index) so we can iterate in one place. */
const SCREAM_VOICE_TOGGLES: readonly { key: EngineToggleKey; voice: 0 | 1 | 2 | 3 }[] = [
  { key: "screamMuteVoice0", voice: 0 },
  { key: "screamMuteVoice1", voice: 1 },
  { key: "screamMuteVoice2", voice: 2 },
  { key: "screamMuteVoice3", voice: 3 },
];

/** ORGAN voice-mute toggle keys in OSCIL-bit order (bit 0 → voice 0, …). */
const ORGAN_VOICE_TOGGLES: readonly EngineToggleKey[] = [
  "organMuteVoice0",
  "organMuteVoice1",
  "organMuteVoice2",
  "organMuteVoice3",
  "organMuteVoice4",
  "organMuteVoice5",
  "organMuteVoice6",
  "organMuteVoice7",
];

/**
 * AND-mask transform: returns the value to actually write at `addr` after
 * applying any active toggle transforms.  Currently used for the ORGAN
 * voice mute, where bits of OSCIL get cleared as the CPU writes to it.
 * For any addr/PC/toggle combo with no transform applicable, returns the
 * original `value` unchanged.
 */
export function transformWriteValue(
  toggles: EngineToggles,
  addr: number,
  game: GameKind,
  pc: number,
  value: number,
): number {
  const a = addr & 0xFF;
  const v = value & 0xFF;
  const c = CELL_MAP[game];
  // ORGAN voice mute — gate OSCIL writes only while PC is inside ORGAN.
  if (c.organRange && c.organOscil !== undefined && a === c.organOscil
      && pc >= c.organRange[0] && pc < c.organRange[1]) {
    let muteMask = 0;
    for (let i = 0; i < 8; i++) {
      if (toggles[ORGAN_VOICE_TOGGLES[i]!]) muteMask |= 1 << i;
    }
    if (muteMask !== 0) return v & ~muteMask & 0xFF;
  }
  return v;
}

/**
 * Pure write-gating predicate.  Pass it the toggles, the addr being
 * written, the current game (for PC-gated traps), and `cpu.pc` (post-advance).
 * Returns `true` when the write should be silently dropped.
 */
export function shouldDiscardWrite(
  toggles: EngineToggles,
  addr: number,
  game: GameKind,
  pc: number,
): boolean {
  const a = addr & 0xFF;
  const c = CELL_MAP[game];
  if (toggles.lfsrFreeze && (a === c.lfsrHi || a === c.lfsrLo)) return true;
  if (toggles.variFreezePeriod && (a === c.variLoper || a === c.variHiper)) return true;
  if (toggles.gwaveFreezePattern && a === c.gwaveGper) return true;
  if (toggles.gwaveSkipDecay && a >= c.gwtabLo && a <= c.gwtabHi) {
    const wvd = wvdecaRange(game);
    if (wvd && pc >= wvd[0] && pc < wvd[1]) return true;
  }
  // SCREAM voice mute — PC must be inside the SCREAM routine.  Each voice's
  // toggle gates exactly that voice's TIMER cell; FREQ is left alone so the
  // cascade (voice N's FREQ → $37 starts voice N+1) keeps running.
  if (c.screamRange && c.screamTimer && pc >= c.screamRange[0] && pc < c.screamRange[1]) {
    for (const { key, voice } of SCREAM_VOICE_TOGGLES) {
      if (toggles[key] && a === c.screamTimer[voice]) return true;
    }
  }
  return false;
}

/**
 * Human-readable label + one-line tooltip per toggle, for the UI.
 * Co-located with the toggle definitions so adding a new toggle doesn't
 * require chasing labels through main.ts.
 */
export const ENGINE_TOGGLE_META: Record<EngineToggleKey, { label: string; tooltip: string }> = {
  lfsrFreeze: {
    label: "Freeze LFSR",
    tooltip: "Freeze LFSR — discard writes to the noise shift-register cells ($09/$0A) so it stops advancing. LITE's evolving lightning crackle collapses into a fixed, repeating click (you hear the raw clock, not the noise).",
  },
  variFreezePeriod: {
    label: "Freeze VARI period",
    tooltip: "Freeze VARI period — pin the LOPER/HIPER timers ($13/$14) so they stop ramping. SAW's pitch + duty-cycle sweep holds at its current value instead of sliding.",
  },
  gwaveFreezePattern: {
    label: "Freeze GWAVE pitch",
    tooltip: "Freeze GWAVE pitch — pin GPER ($21) so the per-note pitch contour stops updating. The heartbeat's pitch sweep is bypassed and it plays at one fixed pitch.",
  },
  gwaveSkipDecay: {
    label: "Skip WVDECA",
    tooltip: "Skip WVDECA — discard the decay routine's writes to the wavetable ($24..$6B). Echoes stop fading: every repeat plays at full amplitude instead of dying away.",
  },
  screamMuteVoice0: {
    label: "Mute v0",
    tooltip: "Mute SCREAM voice 0 — discard writes to this voice's TIMER cell so it stays silent. You hear the scream minus this layer; the cascade still triggers the next voice. Checked = muted.",
  },
  screamMuteVoice1: {
    label: "Mute v1",
    tooltip: "Mute SCREAM voice 1 — discard writes to this voice's TIMER cell so it stays silent. The scream plays without this layer. Checked = muted.",
  },
  screamMuteVoice2: {
    label: "Mute v2",
    tooltip: "Mute SCREAM voice 2 — discard writes to this voice's TIMER cell so it stays silent. The scream plays without this layer. Checked = muted.",
  },
  screamMuteVoice3: {
    label: "Mute v3",
    tooltip: "Mute SCREAM voice 3 — discard writes to this voice's TIMER cell so it stays silent. The scream plays without this layer. Checked = muted.",
  },
  organMuteVoice0: { label: "Mute b0", tooltip: "Mute ORGAN voice b0 — clear bit 0 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice1: { label: "Mute b1", tooltip: "Mute ORGAN voice b1 — clear bit 1 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice2: { label: "Mute b2", tooltip: "Mute ORGAN voice b2 — clear bit 2 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice3: { label: "Mute b3", tooltip: "Mute ORGAN voice b3 — clear bit 3 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice4: { label: "Mute b4", tooltip: "Mute ORGAN voice b4 — clear bit 4 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice5: { label: "Mute b5", tooltip: "Mute ORGAN voice b5 — clear bit 5 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice6: { label: "Mute b6", tooltip: "Mute ORGAN voice b6 — clear bit 6 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
  organMuteVoice7: { label: "Mute b7", tooltip: "Mute ORGAN voice b7 — clear bit 7 of the OSCIL mask on every write, dropping that oscillator from the chord (popcount falls by one). Checked = muted." },
};

/** Voice-scoped toggles, used by the SCREAM UI / sequencer.  Stable order = v0..v3. */
export const SCREAM_VOICE_TOGGLE_KEYS = [
  "screamMuteVoice0",
  "screamMuteVoice1",
  "screamMuteVoice2",
  "screamMuteVoice3",
] as const satisfies readonly EngineToggleKey[];

/** ORGAN voice-mute toggle keys in OSCIL-bit order (bit 0 → b0, … bit 7 → b7). */
export const ORGAN_VOICE_TOGGLE_KEYS = [
  "organMuteVoice0",
  "organMuteVoice1",
  "organMuteVoice2",
  "organMuteVoice3",
  "organMuteVoice4",
  "organMuteVoice5",
  "organMuteVoice6",
  "organMuteVoice7",
] as const satisfies readonly EngineToggleKey[];
