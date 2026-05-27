/**
 * Minimal Float32 → 16-bit PCM WAV encoder.
 *
 * Produces a standard RIFF/WAVE/fmt /data file with one mono channel.
 * The 44-byte canonical header layout:
 *
 *   offset  size  content
 *      0    4     "RIFF"
 *      4    4     file size - 8 (little-endian uint32)
 *      8    4     "WAVE"
 *     12    4     "fmt "
 *     16    4     16              (PCM chunk size)
 *     20    2     1               (PCM format)
 *     22    2     1               (mono)
 *     24    4     sampleRate
 *     28    4     sampleRate * 2  (bytes / sec)
 *     32    2     2               (block align = channels * bytesPerSample)
 *     34    2     16              (bits per sample)
 *     36    4     "data"
 *     40    4     data length in bytes
 *     44    *     PCM samples (little-endian signed 16-bit)
 */

/** Encode `samples` (clamped to [-1,1]) as a 16-bit PCM WAV byte array. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const view = new DataView(buf.buffer);

  // RIFF header
  writeAscii(buf, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(buf, 8, "WAVE");
  writeAscii(buf, 12, "fmt ");
  view.setUint32(16, 16, true);             // PCM chunk size
  view.setUint16(20, 1, true);              // format = PCM
  view.setUint16(22, 1, true);              // channels = 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  writeAscii(buf, 36, "data");
  view.setUint32(40, dataBytes, true);

  // PCM payload
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i]!;
    if (s > 1) s = 1; else if (s < -1) s = -1;
    const intSample = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
    view.setInt16(44 + i * 2, intSample, true);
  }
  return buf;
}

function writeAscii(buf: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i);
}
