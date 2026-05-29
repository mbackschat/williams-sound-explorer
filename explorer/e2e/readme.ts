#!/usr/bin/env -S npx tsx
/**
 * Capture the two bespoke README assets:
 *   docs/img/readme/hero.png  — a viewport still of the two-column UI mid-sound
 *   docs/img/readme/demo.gif  — a short slow-motion clip (Playwright video → ffmpeg)
 *
 * Local maintainer tool (drives the dev server's gitignored public/roms/, emits
 * only PNG/GIF, never ROM bytes).  See docs/implementation/web-capture.md.  Prereqs:
 *   cd explorer && npm run dev:roms && npm run dev      # server on :5173
 * Usage:
 *   npx tsx e2e/readme.ts            # both
 *   npx tsx e2e/readme.ts hero       # just the hero
 *   npx tsx e2e/readme.ts gif        # just the GIF
 */
import { type Browser } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { REPO_ROOT, VIEWPORT, launch, bootPage, selectGame, runStep } from "./lib.ts";

const execFileAsync = promisify(execFile);

// The sound both assets show: Defender SAW (VARI) at ¼× — descending pitch = a
// clean diagonal in the spectrogram (good still) and obvious motion in the byte
// tape / VARI bars / oscilloscope (good GIF).
const SETUP = [{ speed: "0.25" as const }, { fireChip: "1D" as const }];

const HERO_OUT = resolve(REPO_ROOT, "docs/img/readme/hero.png");
const GIF_OUT = resolve(REPO_ROOT, "docs/img/readme/demo.gif");

async function ffmpeg(args: string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

/** Viewport still at 2× DPR, then lanczos-downscaled to 1920px-wide for a crisp, reasonably-sized PNG. */
async function captureHero(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await bootPage(context);
  await selectGame(page, "defender"); // waits for worklet-ready, else the fire is a no-op
  for (const step of SETUP) await runStep(page, step);
  await page.waitForTimeout(3500); // let the spectrogram fill + panels go live
  // The left column is position:sticky and the right column scrolls with the
  // window, so nudging the window down lifts the right column to reveal the RAM
  // heatmap (below the spectrogram) while the controls/live-grid stay in frame.
  await page.evaluate(() => window.scrollBy(0, 350));
  await page.waitForTimeout(300); // settle the repaint
  const tmp = await mkdtemp(join(tmpdir(), "ws-hero-"));
  const raw = join(tmp, "hero@2x.png");
  await page.screenshot({ path: raw }); // viewport only (not fullPage); 3840×2400 @2×
  await mkdir(dirname(HERO_OUT), { recursive: true });
  await ffmpeg(["-i", raw, "-vf", "scale=1920:-1:flags=lanczos", HERO_OUT]);
  await rm(tmp, { recursive: true, force: true });
  await context.close();
  process.stdout.write(`  📸 docs/img/readme/hero.png\n`);
}

/** Record the slow-mo sequence as webm, then crop to the live grid + two-pass-palette into a GIF. */
async function captureGif(browser: Browser): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "ws-gif-"));
  const size = { width: 1600, height: 1200 }; // tall enough that the live grid fits once scrolled
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1, // DPR 1 → video px == CSS px == boundingBox px, so the crop maths line up
    recordVideo: { dir: tmp, size },
  });
  const page = await bootPage(context);
  await selectGame(page, "defender"); // waits for worklet-ready, else the fire is a no-op
  for (const step of SETUP) await runStep(page, step); // ¼×, fire SAW (auto-scrolls back to top)

  // Frame on the live grid (Ear oscilloscope · Code · Eye byte tape · Swimlane)
  // — the clearest "watch the sound being made" motion. Crop to its box.
  const grid = page.locator(".live-grid");
  await grid.scrollIntoViewIfNeeded();
  const b = await grid.boundingBox();
  if (!b) throw new Error(".live-grid has no bounding box");
  const x = Math.max(0, Math.round(b.x));
  const y = Math.max(0, Math.round(b.y));
  const w = Math.min(Math.round(b.width), size.width - x);
  const h = Math.min(Math.round(b.height), size.height - y);

  await page.waitForTimeout(7000); // SAW @¼× runs ~7.6 s — capture it sweeping
  const video = page.video();
  await context.close(); // flushes the webm
  const webm = await video!.path();

  // Trim past the ~3 s of boot/clicks/scroll, crop to the grid, 12 fps. Two-pass
  // palette keeps the dark-UI gradients from banding.  Downscale to 50% width
  // (height follows via -2) — keeps the GIF light for a README.
  const trim = ["-ss", "3", "-t", "4", "-i", webm];
  const gw = Math.round(w / 2);
  const vf = `crop=${w}:${h}:${x}:${y},fps=12,scale=${gw}:-2:flags=lanczos`;
  const palette = join(tmp, "palette.png");
  await mkdir(dirname(GIF_OUT), { recursive: true });
  await ffmpeg([...trim, "-vf", `${vf},palettegen=stats_mode=diff`, palette]);
  await ffmpeg([
    ...trim,
    "-i",
    palette,
    "-lavfi",
    `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop",
    "0",
    GIF_OUT,
  ]);
  await rm(tmp, { recursive: true, force: true });
  process.stdout.write(`  🎞  docs/img/readme/demo.gif (${w}×${h} crop → ${gw}px wide)\n`);
}

async function main(): Promise<void> {
  const which = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const browser = await launch(process.argv.includes("--headed"));
  try {
    if (which !== "gif") await captureHero(browser);
    if (which !== "hero") await captureGif(browser);
  } finally {
    await browser.close();
  }
}

void main();
