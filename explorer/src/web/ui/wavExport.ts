/**
 * Offline ⬇ .wav export of the current command — re-renders through the exact
 * pipeline as `tools/render_sound.ts` (deterministic, clean ROM sound,
 * independent of the live worklet, so it works before Init too).
 */
import { els } from "../els.ts";
import { lookup } from "../glossary.ts";
import { loadRomFromUrl } from "../romFetch.ts";
import type { GameKind } from "../../board/soundboard.ts";
import { runSoundWithRom } from "../../engine/runner.ts";
import { renderDacEvents } from "../../synth/DacSampler.ts";
import { applyLpf } from "../../synth/lpf.ts";
import { encodeWav } from "../../synth/wav.ts";
import type { AppContext } from "../appContext.ts";

const WAV_EXPORT_RATE = 48000;
const exportRomCache = new Map<GameKind, Uint8Array>();

export function initWavExport(ctx: AppContext): void {
  els.exportWav.addEventListener("click", () => { void exportCurrentWav(ctx); });
  // A replaced/removed ROM must not be served from this cache.
  window.addEventListener("rom-store-changed", () => exportRomCache.clear());
}

function triggerDownload(bytes: Uint8Array, filename: string): void {
  // Copy into a plain ArrayBuffer-backed view so Blob accepts it under
  // strict lib types (encodeWav's buffer is typed ArrayBufferLike).
  const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCurrentWav(ctx: AppContext): Promise<void> {
  const cmd = Number.parseInt(els.cmd.value, 16);
  if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) {
    ctx.log(`Export: "${els.cmd.value}" is not a valid command ($00..$3F).`, "err");
    return;
  }
  const game = ctx.currentGame();
  const hh = cmd.toString(16).padStart(2, "0").toUpperCase();
  els.exportWav.disabled = true;
  try {
    let rom = exportRomCache.get(game);
    if (!rom) {
      rom = await loadRomFromUrl(game);
      exportRomCache.set(game, rom);
    }
    const result = runSoundWithRom(game, rom, cmd);
    if (result.events.length === 0) {
      ctx.log(`Export: $${hh} produced no DAC output (silent) — nothing to save.`, "err");
      return;
    }
    const samples = renderDacEvents(result.events, {
      totalCycles: result.cycles,
      targetRate: WAV_EXPORT_RATE,
    });
    applyLpf(samples, { cutoffHz: 10000, sampleRate: WAV_EXPORT_RATE });
    const wav = encodeWav(samples, WAV_EXPORT_RATE);
    const routine = (lookup(ctx.getGlossary(), game, cmd)?.routine ?? "")
      .replace(/[^A-Za-z0-9]+/g, "") || "sound";
    const ms = (result.cycles / 894_886 * 1000).toFixed(0);
    triggerDownload(wav, `${game}_${hh}_${routine}.wav`);
    ctx.log(`Exported ${game}_${hh}_${routine}.wav — ${ms} ms${result.reachedIdle ? "" : " (capped at 5 s)"}.`, "ok");
  } catch (e) {
    ctx.log(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "err");
  } finally {
    els.exportWav.disabled = false;
  }
}
