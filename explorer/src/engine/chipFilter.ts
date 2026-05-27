/**
 * Engine filter for the "Try:" chip browser.
 *
 * Each legend swatch under the chip list is a toggle (all on by default).
 * Chips carry a `data-engine` attribute (uppercase engine name) or none;
 * the filter shows a chip when its engine key is in the enabled set.
 *
 * Pure helpers live here so the show/hide decision is unit-testable without
 * a DOM; main.ts owns the actual element wiring.
 */

/** Filter keys — the six canonical engines plus a bucket for chips with no
 *  engine (silence / control commands like BG2INC / BGEND). */
export const CHIP_FILTER_KEYS = [
  "LFSR",
  "GWAVE",
  "VARI",
  "SCREAM",
  "ORGAN",
  "FNOISE",
  "NONE",
] as const;

export type ChipFilterKey = (typeof CHIP_FILTER_KEYS)[number];

/** Map a chip's `data-engine` (possibly absent/empty) to its filter key. */
export function chipEngineKey(dataEngine: string | null | undefined): string {
  return dataEngine && dataEngine.length > 0 ? dataEngine.toUpperCase() : "NONE";
}

/** A chip is visible when its engine key is currently enabled. */
export function isChipVisible(key: string, enabled: ReadonlySet<string>): boolean {
  return enabled.has(key);
}

/** A fresh filter set with every engine enabled. */
export function allEnabled(): Set<string> {
  return new Set<string>(CHIP_FILTER_KEYS);
}
