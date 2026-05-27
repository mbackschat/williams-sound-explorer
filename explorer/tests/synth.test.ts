/**
 * Tests for the synth layer (DacSampler + LPF) — Step 1.5.
 *
 * Coverage:
 *   • Output sample count matches the documented ratio (±1 for rounding).
 *   • Range stays inside [-1, +1].
 *   • Zero-order hold: a single event at t=0 holds its value through the tail.
 *   • Two events: the value flips at the right output-sample index.
 *   • LPF DC response = 1.0 (steady DC input emerges unchanged after settling).
 *   • LPF attenuates high frequencies (Nyquist tone → small amplitude).
 */
import { describe, expect, it } from "vitest";

import { renderDacEvents } from "../src/synth/DacSampler.ts";
import { applyLpf } from "../src/synth/lpf.ts";

describe("DacSampler — renderDacEvents", () => {
  it("emits sample-count = ceil(cycles * outRate/inRate)", () => {
    const inputRate = 894886;
    const targetRate = 48000;
    const cycles = 100_000;
    const expected = Math.round(cycles * targetRate / inputRate);
    const samples = renderDacEvents([], { totalCycles: cycles, targetRate, inputRate });
    expect(samples.length).toBe(expected);
  });

  it("values are bounded to [-1, +1] for the full 8-bit DAC range", () => {
    const events = Array.from({ length: 256 }, (_, i) => ({ cycle: i * 100, value: i }));
    const samples = renderDacEvents(events, { totalCycles: 256 * 100 });
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("zero-order hold: a single event at cycle 0 holds through the buffer", () => {
    const samples = renderDacEvents([{ cycle: 0, value: 0xFF }], { totalCycles: 1000 });
    // DAC value $FF normalises to (255-128)/128 ≈ +0.992
    for (const s of samples) {
      expect(s).toBeGreaterThan(0.98);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("two events: the value flips at the right output index", () => {
    const totalCycles = 1_000_000;
    const targetRate = 48000;
    const inputRate = 894886;
    const events = [
      { cycle: 0, value: 0x00 },                // -1.0
      { cycle: 500_000, value: 0xFF },          // ≈ +0.992
    ];
    const samples = renderDacEvents(events, { totalCycles, targetRate, inputRate });
    const flipIdx = Math.round(500_000 * targetRate / inputRate);
    // Sample just before the flip should be near -1
    expect(samples[flipIdx - 2]!).toBeLessThan(-0.99);
    // Sample just after should be near +1
    expect(samples[flipIdx + 2]!).toBeGreaterThan(0.98);
  });

  it("default initial value (0x80) renders as 0.0 (silence)", () => {
    const samples = renderDacEvents([], { totalCycles: 100 });
    for (const s of samples) {
      expect(s).toBe(0);
    }
  });

  it("LITE-like event count → audible sample buffer of correct length", () => {
    // LITE on Defender produces 386 events over ~624000 cycles (= ~700 ms)
    const events = Array.from({ length: 386 }, (_, i) => ({
      cycle: 250 + i * 1600,
      value: i % 2 === 0 ? 0xFF : 0x00,
    }));
    const samples = renderDacEvents(events, { totalCycles: 624000 });
    // ~700 ms at 48 kHz ≈ 33,470 samples
    expect(samples.length).toBeGreaterThan(33_000);
    expect(samples.length).toBeLessThan(34_000);
  });
});

describe("LPF — applyLpf", () => {
  it("DC response after settle is ~1.0 (constant input passes through)", () => {
    const samples = new Float32Array(2000);
    samples.fill(0.5);
    applyLpf(samples, { cutoffHz: 10000, sampleRate: 48000 });
    // After many samples it should converge near 0.5
    expect(samples[samples.length - 1]!).toBeCloseTo(0.5, 3);
  });

  it("Nyquist-rate sine is heavily attenuated", () => {
    const sr = 48000;
    const len = 2000;
    const samples = new Float32Array(len);
    // Half-Nyquist tone (12 kHz at 48 kHz sample rate) — clearly above cutoff
    for (let i = 0; i < len; i++) samples[i] = Math.cos(2 * Math.PI * 12000 * i / sr);
    applyLpf(samples, { cutoffHz: 10000, sampleRate: sr });
    // Peak amplitude should drop noticeably
    let maxAbs = 0;
    for (let i = len - 500; i < len; i++) maxAbs = Math.max(maxAbs, Math.abs(samples[i]!));
    expect(maxAbs).toBeLessThan(0.8); // a one-pole at fc ≈ fnyq/2 drops by ~6 dB+
  });

  it("starts from zero (initial state silence)", () => {
    const samples = new Float32Array([0, 0, 0, 1, 1, 1]);
    applyLpf(samples, { cutoffHz: 10000, sampleRate: 48000 });
    expect(samples[0]).toBe(0);
    // Sample 3 (first 1.0 input) ramps gradually upward
    expect(samples[3]!).toBeGreaterThan(0);
    expect(samples[3]!).toBeLessThan(1);
  });
});
