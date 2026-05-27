/**
 * Single-pole biquad low-pass filter.
 *
 * Models the Williams sound-board's reconstruction filter:
 * 1458 op-amp I-to-V converter with a feedback capacitor giving a soft,
 * 6 dB/octave roll-off around 10 kHz.  Per `docs/sound_hardware_model.md`
 * "DAC and the analog tail" — NOT a brick-wall multi-pole filter.  Pick the
 * cutoff loose enough that DAC stair-step aliasing still bleeds through (it's
 * part of the iconic Williams grit).
 *
 * Implementation: one-pole RC filter
 *   y[n] = a · x[n] + (1 - a) · y[n-1]
 * where  a = dt / (RC + dt) = 2π·fc·dt / (1 + 2π·fc·dt).
 */

export interface LpfOptions {
  /** Cutoff frequency in Hz.  Default 10000 (10 kHz). */
  cutoffHz?: number;
  /** Sample rate in Hz.  Default 48000. */
  sampleRate?: number;
}

/**
 * Apply a single-pole low-pass filter to `samples` in place, returning the
 * same buffer for chaining.  Initial state is 0.0 (matching DC silence).
 */
export function applyLpf(samples: Float32Array, opts: LpfOptions = {}): Float32Array {
  const cutoff = opts.cutoffHz ?? 10000;
  const sr = opts.sampleRate ?? 48000;
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);

  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y = alpha * samples[i]! + (1 - alpha) * y;
    samples[i] = y;
  }
  return samples;
}
