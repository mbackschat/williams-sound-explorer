/**
 * Zero-order-hold resampler for the Williams 8-bit DAC stream.
 *
 * Input: a sequence of `{cycle, value}` events at the CPU's 894886-Hz rate
 *   — i.e. each event says "from this cycle onward, the DAC output is this
 *   8-bit value, until the next event."
 * Output: a `Float32Array` of samples at `targetRate` Hz (typically 48 kHz),
 *   with each byte 0..255 normalised to [-1.0, +1.0] around the midpoint
 *   (0x80 → 0.0).
 *
 * The resampler is structurally the same as msarnoff's `DacSampler` in
 * `research/findings_sound_studio.md` §5.1: walk through the event timeline,
 * emit `Math.floor(deltaCycles * outRate/inRate)` samples of the *previous*
 * value before adopting the new one.  This models a physical sample-and-hold
 * DAC ladder faithfully (the analogue voltage holds steady until the next
 * 6802 `STAA $0400`).
 *
 * Pure function: same input → identical output.  Tested in `synth.test.ts`.
 */

import type { DACEvent } from "../board/pia.ts";

export interface RenderOptions {
  /** Sample rate of the output WAV, default 48000 Hz. */
  targetRate?: number;
  /** Input cycle rate, default 894886 Hz (Williams bus clock). */
  inputRate?: number;
  /**
   * Total number of input cycles to render (the duration of the captured
   * sound, in CPU cycles).  Required so we know how much to emit after the
   * final event.
   */
  totalCycles: number;
  /** Initial DAC value before the first event.  Default 0x80 (mid-rail). */
  initialValue?: number;
}

/**
 * Render a DAC event stream to a `Float32Array` of audio samples in [-1, +1].
 *
 * Time accounting uses a fractional accumulator so quantisation error never
 * builds up across long sounds — the resampler emits *exactly* the right
 * number of output samples for the given input duration.
 */
export function renderDacEvents(
  events: ReadonlyArray<DACEvent>,
  opts: RenderOptions,
): Float32Array {
  const targetRate = opts.targetRate ?? 48000;
  const inputRate = opts.inputRate ?? 894886;
  const totalCycles = opts.totalCycles;
  const ratio = targetRate / inputRate;            // output samples per input cycle

  const totalOutSamples = Math.round(totalCycles * ratio);
  const out = new Float32Array(totalOutSamples);

  let currentValue = opts.initialValue ?? 0x80;
  let lastCycle = 0;
  let outIdx = 0;

  /** Emit `n` samples of the current DAC value into the output buffer. */
  const emit = (n: number): void => {
    // Unsigned 8-bit DAC → signed float.  Mapping: 0x00 → -1.0, 0x80 → 0.0,
    // 0xFF → +127/128 ≈ +0.992.  This is the standard PCM convention.
    const sample = (currentValue - 0x80) / 0x80;
    const end = Math.min(outIdx + n, totalOutSamples);
    out.fill(sample, outIdx, end);
    outIdx = end;
  };

  for (const ev of events) {
    // How many output samples should we have emitted by this event?
    const cumOut = Math.round(ev.cycle * ratio);
    const samplesToEmit = cumOut - outIdx;
    if (samplesToEmit > 0) emit(samplesToEmit);
    currentValue = ev.value & 0xFF;
    lastCycle = ev.cycle;
  }
  // Tail: emit samples for whatever cycles remain after the last event.
  if (outIdx < totalOutSamples) {
    emit(totalOutSamples - outIdx);
  }
  return out;
}
