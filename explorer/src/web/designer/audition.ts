/**
 * Designer audition: render an (edited) ROM image offline and play it.
 *
 * Reuses the exact offline pipeline the ⬇ .wav export uses
 * (`runSoundWithRom` → `renderDacEvents` → `applyLpf`, see `web/ui/wavExport.ts`)
 * so a custom sound is bit-identical to what the live emulator would produce —
 * no worklet, no live transport.  Playback is a one-shot `AudioBufferSource`
 * through a dedicated `AudioContext` kept separate from the Explore host.
 */
import type { GameKind } from "../../board/soundboard.ts";
import { runSoundWithRom } from "../../engine/runner.ts";
import { renderDacEvents } from "../../synth/DacSampler.ts";
import { applyLpf } from "../../synth/lpf.ts";

const RATE = 48000;

export interface RenderedSound {
  samples: Float32Array;
  cycles: number;
  reachedIdle: boolean;
}

/** Render one command from a raw ROM image to LPF'd audio samples in [-1, +1]. */
export function renderSound(game: GameKind, rom: Uint8Array, cmd: number): RenderedSound {
  const r = runSoundWithRom(game, rom, cmd);
  const samples = renderDacEvents(r.events, { totalCycles: r.cycles, targetRate: RATE });
  applyLpf(samples, { cutoffHz: 10000, sampleRate: RATE });
  return { samples, cycles: r.cycles, reachedIdle: r.reachedIdle };
}

export type PlayState = "idle" | "playing" | "paused";

let audioCtx: AudioContext | undefined;
let currentSource: AudioBufferSourceNode | undefined;
let state: PlayState = "idle";
let stateCb: ((s: PlayState) => void) | undefined;
let startedAt = 0;       // audioCtx.currentTime when the current sound started
let durationSec = 0;     // length of the current sound
let looping = false;

/**
 * Playback progress 0..1, or null when idle. Driven by `audioCtx.currentTime`,
 * which freezes while suspended — so the playhead pauses with the audio. When
 * looping, the position wraps each cycle.
 */
export function playbackProgress(): number | null {
  if (!audioCtx || state === "idle" || durationSec <= 0) return null;
  const elapsed = audioCtx.currentTime - startedAt;
  const t = looping ? elapsed % durationSec : elapsed;
  return Math.max(0, Math.min(1, t / durationSec));
}

function setState(s: PlayState): void { state = s; stateCb?.(s); }

/** Subscribe to playback-state changes (to drive a Play/Pause button label). */
export function onPlaybackState(cb: (s: PlayState) => void): void { stateCb = cb; }
export function playbackState(): PlayState { return state; }

/** Play a sample buffer at the given volume (0..1); replaces any current playback. */
export function playSamples(samples: Float32Array, volume = 0.3, loop = false): void {
  if (samples.length === 0) return;
  stopPlayback();
  audioCtx ??= new AudioContext();
  void audioCtx.resume();
  const buf = audioCtx.createBuffer(1, samples.length, RATE);
  buf.getChannelData(0).set(samples);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(audioCtx.destination);
  src.onended = () => { if (currentSource === src) { currentSource = undefined; setState("idle"); } };
  currentSource = src;
  looping = loop;
  durationSec = samples.length / RATE;
  startedAt = audioCtx.currentTime;
  src.start();
  setState("playing");
}

/** Toggle looping on the in-flight sound (and for subsequent plays). */
export function setLoop(on: boolean): void {
  looping = on;
  if (currentSource) currentSource.loop = on;
}
export function isLooping(): boolean { return looping; }

/** Pause (suspend) or resume the in-flight sound — sounds can run several seconds. */
export function pauseResume(): void {
  if (!audioCtx || !currentSource) return;
  if (audioCtx.state === "running") { void audioCtx.suspend(); setState("paused"); }
  else { void audioCtx.resume(); setState("playing"); }
}

/** Stop the in-flight sound and reset to idle. */
export function stopPlayback(): void {
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = undefined;
  }
  if (audioCtx?.state === "suspended") void audioCtx.resume(); // unfreeze for the next play
  setState("idle");
}

/** ms duration a rendered sound represents (894.886 kHz CPU clock). */
export function durationMs(cycles: number): number {
  return cycles / 894_886 * 1000;
}

// ─── Canvas drawing ────────────────────────────────────────────────────────

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 120;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Plot a [-1,1] waveform decimated to the canvas width. */
export function drawWaveform(canvas: HTMLCanvasElement, samples: Float32Array, color = "#a9dc76"): void {
  const { ctx, w, h } = fitCanvas(canvas);
  const mid = h / 2;
  ctx.strokeStyle = "#2a2f37";
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  if (samples.length === 0) return;
  const step = samples.length / w;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const s = samples[Math.min(samples.length - 1, Math.floor(x * step))]!;
    const y = mid - s * (mid - 2);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Overlay the original (grey) and edited (green) waveforms and shade the band
 * where they diverge (red) — the "diff vs original" view.
 */
export function drawDiff(canvas: HTMLCanvasElement, original: Float32Array, edited: Float32Array): void {
  const { ctx, w, h } = fitCanvas(canvas);
  const mid = h / 2;
  const n = Math.max(original.length, edited.length);
  if (n === 0) return;
  const step = n / w;
  const at = (buf: Float32Array, i: number): number => (i < buf.length ? buf[i]! : 0);

  // Divergence shading first (behind the traces).
  ctx.fillStyle = "rgba(255, 90, 90, 0.28)";
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor(x * step));
    const d = Math.abs(at(edited, i) - at(original, i));
    if (d > 0.004) ctx.fillRect(x, mid - d * (mid - 2), 1, d * (mid - 2) * 2);
  }

  const trace = (buf: Float32Array, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const s = at(buf, Math.min(n - 1, Math.floor(x * step)));
      const y = mid - s * (mid - 2);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  trace(original, "#6b7280"); // grey = original
  trace(edited, "#a9dc76");   // green = edited
}

/**
 * Draw a vertical playhead at `fraction` (0..1) of the width. Assumes the
 * canvas transform is already set (call right after `drawWaveform`, which
 * fits the canvas) so coordinates are in CSS pixels.
 */
export function drawPlayhead(canvas: HTMLCanvasElement, fraction: number): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 120;
  const x = Math.max(0, Math.min(1, fraction)) * w;
  ctx.strokeStyle = "#ffd866";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
}
