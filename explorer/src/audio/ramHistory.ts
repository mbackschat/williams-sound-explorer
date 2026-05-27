/**
 * Ring buffer of periodic CPU + RAM snapshots — companion to `DacHistory`.
 *
 * Why this exists: scrub mode used to only replay audio + look up the
 * historical PC at the scrub head.  The engine-state slot's *identity*
 * was recovered (we know which engine was running at cycle X), but its
 * *values* — LOCNT/HICNT bars, the GWAVE wavetable, the SCREAM voices —
 * read live RAM, which is frozen at whatever it had when the user pressed
 * Scrub.  Bars therefore didn't animate as the head moved.  Documented as
 * the "scrub doesn't time-travel RAM" caveat in
 * `docs/explorer_implementation.md`.
 *
 * The fix is this module: every ~512 CPU cycles we snapshot zero-page RAM
 * (`$00..$7F`, 128 bytes) + the X register into a ring.  Scrub mode
 * binary-searches by cycle and feeds the matching snapshot through
 * `engineStateForPc()` via an optional `ramOverride` argument.  Now the
 * slot's *values* are the values that were live at the head's cycle, not
 * the frozen-at-scrub-entry values.
 *
 * Memory budget:
 *   - 128 bytes RAM × 10 000 snapshots = 1.28 MB
 *   - 8 bytes cycle + 2 bytes x × 10 000 = 100 KB
 *   - Total ≈ 1.4 MB.  Sized for ~5.7 s of capture at the default 512-cycle
 *     interval (~1750 snapshots/sec), or arbitrarily long at slower rates.
 *
 * Capacity wraps oldest-first like `DacHistory`.
 */

export interface RamSnapshot {
  /** CPU cycle at which the snapshot was taken. */
  cycle: number;
  /** X register value at the snapshot point. */
  x: number;
  /** Zero-page RAM at $00..$7F (128 bytes).  Fresh allocation per call. */
  ram: Uint8Array;
}

/** Default snapshot interval in CPU cycles (~572 µs @ 894 886 Hz). */
export const RAM_HISTORY_DEFAULT_INTERVAL = 512;

/** Default capacity — ~5.7 s of capture at the default interval. */
export const RAM_HISTORY_DEFAULT_CAPACITY = 10_000;

/** How many bytes of zero-page RAM we snapshot per entry. */
export const RAM_SNAPSHOT_SIZE = 128;

export class RamHistory {
  private readonly cycles: Float64Array;
  private readonly xs: Uint16Array;
  /** Flat backing store — `RAM_SNAPSHOT_SIZE` bytes per slot. */
  private readonly bytes: Uint8Array;
  private readonly capacity: number;
  private writePos = 0;
  private _size = 0;

  constructor(capacity = RAM_HISTORY_DEFAULT_CAPACITY) {
    if (capacity <= 0) throw new Error("RamHistory: capacity must be > 0");
    this.capacity = capacity;
    this.cycles = new Float64Array(capacity);
    this.xs = new Uint16Array(capacity);
    this.bytes = new Uint8Array(capacity * RAM_SNAPSHOT_SIZE);
  }

  /**
   * Append a snapshot.  `ramSource` must contain at least `RAM_SNAPSHOT_SIZE`
   * bytes of zero-page RAM (we copy 128 bytes starting at offset 0).
   */
  push(cycle: number, x: number, ramSource: Uint8Array): void {
    this.cycles[this.writePos] = cycle;
    this.xs[this.writePos] = x & 0xFFFF;
    const dst = this.bytes.subarray(
      this.writePos * RAM_SNAPSHOT_SIZE,
      (this.writePos + 1) * RAM_SNAPSHOT_SIZE,
    );
    dst.set(ramSource.subarray(0, RAM_SNAPSHOT_SIZE));
    this.writePos = (this.writePos + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  clear(): void {
    this.writePos = 0;
    this._size = 0;
  }

  get size(): number { return this._size; }

  /**
   * Snapshot at-or-before `targetCycle`.  Returns `undefined` if the buffer
   * is empty or every snapshot is in the future.  The returned `ram`
   * is a *fresh copy* so the caller can keep / mutate without aliasing
   * the ring's backing store.
   */
  at(targetCycle: number): RamSnapshot | undefined {
    if (this._size === 0) return undefined;
    const oldest = this.cycles[this.physicalIndex(0)]!;
    if (targetCycle < oldest) return undefined;
    const logicalIdx = this.binarySearchLE(targetCycle);
    const phys = this.physicalIndex(logicalIdx);
    const ram = new Uint8Array(RAM_SNAPSHOT_SIZE);
    ram.set(this.bytes.subarray(phys * RAM_SNAPSHOT_SIZE, (phys + 1) * RAM_SNAPSHOT_SIZE));
    return {
      cycle: this.cycles[phys]!,
      x: this.xs[phys]!,
      ram,
    };
  }

  private physicalIndex(logicalIdx: number): number {
    const oldestPhys = this._size === this.capacity ? this.writePos : 0;
    return (oldestPhys + logicalIdx) % this.capacity;
  }

  /** Largest logical index whose cycle ≤ target.  Precondition: target ≥ oldest cycle. */
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
