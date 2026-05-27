/**
 * Per-game tune table for $1B ORGANT + the auto-pulse timing.  Shared between
 * the transport's `fireUserCmd` ($1B auto-pulse) and the command-info panel's
 * $1B arm-form.  Indices match `ORGTAB` entries in the sound ROMs (sourced from
 * `research/williams-soundroms/VSNDRM{1,2,3}.SRC`).
 */
import type { GameKind } from "../board/soundboard.ts";

export const ORGAN_TUNES: Record<GameKind, { num: number; name: string; note: string }[]> = {
  defender: [
    { num: 1, name: "PHANTOM", note: "3 notes — D2, CS2, FS1 (long)" },
    { num: 2, name: "TACCATA", note: "34-note baroque-organ figure" },
  ],
  stargate: [
    { num: 1, name: "FIFTH", note: "Close Encounters 5-note motif (G2, EF1)" },
    { num: 2, name: "NINTH", note: "42-note multi-octave figure" },
  ],
  robotron: [
    { num: 1, name: "FIFTH", note: "Close Encounters 5-note motif" },
    { num: 2, name: "NINTH", note: "42-note multi-octave figure" },
  ],
};

/** Auto-pulse gap (ms) after arming $1B before the tune byte is sent. */
export const AUTO_PULSE_GAP_MS = 40;
/** Default tune fired by the $1B auto-pulse when the user hasn't picked one. */
export const DEFAULT_ORGAN_TUNE = 1;
