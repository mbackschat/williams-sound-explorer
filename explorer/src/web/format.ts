/**
 * Pure formatting / metering helpers for the browser UI — no DOM, no host, no
 * shared state.  Extracted from `main.ts` so they can be unit-tested
 * (see `tests/format.test.ts`); the UI imports them from here.
 */

/** Bottom of the volume-meter scale, in dBFS. */
const METER_DB_FLOOR = -60;

/** Map a dBFS level to a 0–100 meter-fill percentage (clamped to the scale). */
export function dbToPct(db: number): number {
  if (!isFinite(db)) return 0;
  const t = (db - METER_DB_FLOOR) / -METER_DB_FLOOR;
  return Math.max(0, Math.min(100, t * 100));
}

/** Fast-attack, slow-release filter that never drops below `signalDb`. */
export function meterTrack(currentDb: number, signalDb: number, releaseDb: number): number {
  if (!isFinite(signalDb)) {
    // Signal is silent: decay the meter toward the floor.
    if (!isFinite(currentDb)) return -Infinity;
    const next = currentDb - releaseDb;
    return next <= METER_DB_FLOOR ? -Infinity : next;
  }
  if (!isFinite(currentDb) || signalDb >= currentDb) return signalDb;
  // Decay, but clamp so we never read lower than the actual signal level.
  return Math.max(signalDb, currentDb - releaseDb);
}

/** Escape the four HTML-significant characters for safe innerHTML interpolation. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
