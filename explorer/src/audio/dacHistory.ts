/**
 * Ring buffer of recent DAC events (cycle, byte) for the tape-loop scrubber.
 *
 * The runtime captures every Port-A write the CPU makes alongside its CPU
 * cycle timestamp.  The scrubber UI then walks across this buffer to play
 * back any cycle range — forward, reverse, or at arbitrary speed.
 *
 * Storage: parallel typed arrays (`Float64Array` for cycles since the count
 * grows past 2^32 after a few minutes; `Uint8Array` for DAC bytes).  Inside
 * the ring, events are appended monotonically (CPU cycles never decrease),
 * so binary search in the *logical* (oldest→newest) index space gives the
 * event covering any target cycle in O(log n).
 *
 * Default capacity 50 000 events.  LITE produces ~550 events/sec; Robotron's
 * denser sounds can hit ~10 000 events/sec — so 50 000 is roughly 5 seconds
 * of dense playback or 90 seconds of LITE.  The cap is per-instance.
 */

export interface HistoryRange {
  /** Cycle of the oldest still-recorded event, or 0 if empty. */
  oldestCycle: number;
  /** Cycle of the newest recorded event, or 0 if empty. */
  newestCycle: number;
  /** Number of events stored (0..capacity). */
  size: number;
}

/**
 * Default DAC byte returned by `valueAt` for queries before the buffer's
 * oldest event or when the buffer is empty.  Mid-rail = silent.
 */
export const DAC_SILENCE = 0x80;

export class DacHistory {
  private readonly cycles: Float64Array;
  private readonly values: Uint8Array;
  private readonly pcs: Uint16Array;
  private readonly capacity: number;
  private writePos = 0;
  private _size = 0;

  constructor(capacity = 50_000) {
    if (capacity <= 0) throw new Error("DacHistory: capacity must be > 0");
    this.capacity = capacity;
    this.cycles = new Float64Array(capacity);
    this.values = new Uint8Array(capacity);
    this.pcs = new Uint16Array(capacity);
  }

  /** Append a new event.  Overwrites the oldest if at capacity. */
  push(cycle: number, value: number, pc = 0): void {
    this.cycles[this.writePos] = cycle;
    this.values[this.writePos] = value & 0xFF;
    this.pcs[this.writePos] = pc & 0xFFFF;
    this.writePos = (this.writePos + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  /** Reset to empty.  No allocation — the typed-array storage is reused. */
  clear(): void {
    this.writePos = 0;
    this._size = 0;
  }

  /** How many events are currently buffered. */
  get size(): number { return this._size; }

  /** Buffer's recorded cycle range + size, in one call. */
  range(): HistoryRange {
    if (this._size === 0) {
      return { oldestCycle: 0, newestCycle: 0, size: 0 };
    }
    return {
      oldestCycle: this.cycles[this.physicalIndex(0)]!,
      newestCycle: this.cycles[this.physicalIndex(this._size - 1)]!,
      size: this._size,
    };
  }

  /**
   * Snapshot the most recent `n` events as three parallel arrays.
   * `cycles[i]`, `values[i]`, `pcs[i]` together describe event i; oldest at
   * index 0, newest at index count-1.
   */
  recent(n: number): { cycles: Float64Array; values: Uint8Array; pcs: Uint16Array; count: number } {
    const count = Math.min(n, this._size);
    const cycles = new Float64Array(count);
    const values = new Uint8Array(count);
    const pcs = new Uint16Array(count);
    if (count === 0) return { cycles, values, pcs, count: 0 };
    const startLogical = this._size - count;
    const oldestPhys = this._size === this.capacity ? this.writePos : 0;
    for (let i = 0; i < count; i++) {
      const phys = (oldestPhys + startLogical + i) % this.capacity;
      cycles[i] = this.cycles[phys]!;
      values[i] = this.values[phys]!;
      pcs[i] = this.pcs[phys]!;
    }
    return { cycles, values, pcs, count };
  }

  /**
   * Snapshot all events whose cycle is in `[startCycle, endCycle]`,
   * oldest first.  Used by the byte-tape view to show what was happening
   * around a particular moment (either "now" live, or the scrub head).
   * Caps to `maxCount` (most recent kept when capping).
   */
  eventsInRange(
    startCycle: number,
    endCycle: number,
    maxCount = 1024,
  ): { cycles: Float64Array; values: Uint8Array; pcs: Uint16Array; count: number } {
    if (this._size === 0 || endCycle < startCycle) {
      return { cycles: new Float64Array(0), values: new Uint8Array(0), pcs: new Uint16Array(0), count: 0 };
    }
    // First logical index whose cycle >= startCycle (binary-search variant).
    // Then walk forward until cycle > endCycle or maxCount events collected.
    let lo = 0;
    let hi = this._size - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cycleAtLogical(mid) < startCycle) lo = mid + 1;
      else hi = mid;
    }
    // If every event is still below startCycle, the search lands on the
    // last index — guard against returning it.
    if (this.cycleAtLogical(lo) < startCycle) {
      return { cycles: new Float64Array(0), values: new Uint8Array(0), pcs: new Uint16Array(0), count: 0 };
    }
    // Collect into a temporary array first so we can cap correctly.
    const tmpC: number[] = [];
    const tmpV: number[] = [];
    const tmpP: number[] = [];
    const oldestPhys = this._size === this.capacity ? this.writePos : 0;
    for (let i = lo; i < this._size; i++) {
      const phys = (oldestPhys + i) % this.capacity;
      const c = this.cycles[phys]!;
      if (c > endCycle) break;
      tmpC.push(c);
      tmpV.push(this.values[phys]!);
      tmpP.push(this.pcs[phys]!);
    }
    // Cap to maxCount, keeping the newest.
    const start = Math.max(0, tmpC.length - maxCount);
    const count = tmpC.length - start;
    const cycles = new Float64Array(count);
    const values = new Uint8Array(count);
    const pcs = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      cycles[i] = tmpC[start + i]!;
      values[i] = tmpV[start + i]!;
      pcs[i] = tmpP[start + i]!;
    }
    return { cycles, values, pcs, count };
  }

  /** Logical-index cycle accessor used by binary search. */
  private cycleAtLogical(logicalIdx: number): number {
    const oldestPhys = this._size === this.capacity ? this.writePos : 0;
    return this.cycles[(oldestPhys + logicalIdx) % this.capacity]!;
  }

  /**
   * Return the DAC byte that was in effect at `targetCycle` (ZOH semantics:
   * the byte from the most recent event with `cycle <= targetCycle`).
   * Returns `DAC_SILENCE` if `targetCycle` is before the oldest recorded
   * event or the buffer is empty.
   */
  valueAt(targetCycle: number): number {
    if (this._size === 0) return DAC_SILENCE;
    const oldest = this.cycles[this.physicalIndex(0)]!;
    if (targetCycle < oldest) return DAC_SILENCE;
    const logicalIdx = this.binarySearchLE(targetCycle);
    return this.values[this.physicalIndex(logicalIdx)]!;
  }

  /**
   * PC of the most-recent DAC-writing instruction at-or-before `targetCycle`.
   * Returns `undefined` when the buffer is empty or every event is in the
   * future.  Used by the scrub-mode snapshot to dispatch engine-state lookup
   * by *historical* PC instead of the (frozen) live `cpu.pc`.
   */
  pcAt(targetCycle: number): number | undefined {
    if (this._size === 0) return undefined;
    const oldest = this.cycles[this.physicalIndex(0)]!;
    if (targetCycle < oldest) return undefined;
    const logicalIdx = this.binarySearchLE(targetCycle);
    return this.pcs[this.physicalIndex(logicalIdx)]!;
  }

  /**
   * Map a logical index (0 = oldest, size-1 = newest) to the physical
   * storage slot.  When the buffer hasn't wrapped, logical == physical.
   * After wrapping, the oldest slot is `writePos`.
   */
  private physicalIndex(logicalIdx: number): number {
    const oldestPhys = this._size === this.capacity ? this.writePos : 0;
    return (oldestPhys + logicalIdx) % this.capacity;
  }

  /**
   * Logical index of the event with the largest cycle ≤ target.
   * Pre-condition: caller has verified `targetCycle >= oldest cycle`.
   */
  private binarySearchLE(targetCycle: number): number {
    let lo = 0;
    let hi = this._size - 1;
    let result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midCycle = this.cycles[this.physicalIndex(mid)]!;
      if (midCycle <= targetCycle) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }
}
