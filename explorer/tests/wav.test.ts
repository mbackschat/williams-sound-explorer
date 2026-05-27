/**
 * WAV encoder tests.  Sanity-check the header and the PCM payload encoding.
 */
import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/synth/wav.ts";

describe("encodeWav", () => {
  it("writes a 44-byte RIFF/WAVE header followed by PCM data", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWav(samples, 48000);

    // Header
    expect(String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!)).toBe("RIFF");
    expect(String.fromCharCode(wav[8]!, wav[9]!, wav[10]!, wav[11]!)).toBe("WAVE");
    expect(String.fromCharCode(wav[12]!, wav[13]!, wav[14]!, wav[15]!)).toBe("fmt ");
    expect(String.fromCharCode(wav[36]!, wav[37]!, wav[38]!, wav[39]!)).toBe("data");

    // File size = 44 + 5 * 2 = 54
    expect(wav.length).toBe(54);

    // Sample 0 (0.0) encodes to int16(0)
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    // Sample 1 (0.5) → ~+0x4000
    expect(view.getInt16(46, true)).toBeCloseTo(0x4000, -2);
    // Sample 2 (-0.5) → ~-0x4000
    expect(view.getInt16(48, true)).toBeCloseTo(-0x4000, -2);
    // Sample 3 (+1) → +0x7FFF
    expect(view.getInt16(50, true)).toBe(0x7FFF);
    // Sample 4 (-1) → -0x8000
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  it("clamps out-of-range samples to ±1", () => {
    const samples = new Float32Array([2.0, -2.0]);
    const wav = encodeWav(samples, 48000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7FFF);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it("sample rate is written little-endian at offset 24", () => {
    const wav = encodeWav(new Float32Array(0), 44100);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2);
  });
});
