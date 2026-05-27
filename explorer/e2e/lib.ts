/**
 * Shared Playwright primitives for the capture tools (`capture.ts` verifies +
 * shoots the per-tutorial panels; `readme.ts` shoots the README hero + GIF).
 * All knowledge of the app's stable selectors and its boot/readiness quirks
 * lives here so the two consumers stay tiny and consistent.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolve } from "node:path";

import type { Step, GameKind } from "./tutorials.ts";

export const BASE_URL = process.env.CAPTURE_URL ?? "http://localhost:5173";
export const REPO_ROOT = resolve(import.meta.dirname, "../.."); // explorer/e2e → repo root
export const VIEWPORT = { width: 1920, height: 1200 };
export const READY_TIMEOUT = 20_000;

/** Launch headless Chromium with the flag that lets the AudioWorklet run. */
export function launch(headed = false): Promise<Browser> {
  return chromium.launch({
    headless: !headed,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
}

/** Navigate + wait for the app to boot (onboarding auto-skips when ROMs are present). */
export async function bootPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(10_000); // fail fast on a stale selector; ready-waits pass READY_TIMEOUT
  page.on("console", (m) => {
    if (m.type() === "error") process.stdout.write(`  [console.error] ${m.text()}\n`);
  });
  page.on("pageerror", (err) => process.stdout.write(`  [pageerror] ${err.message}\n`));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cmdChips button.chip", { timeout: READY_TIMEOUT });
  return page;
}

export async function selectGame(page: Page, game: GameKind): Promise<void> {
  // Scope to #gameSwitcher — genealogy/onboarding also carry data-game.  The app
  // auto-inits Defender on load; while a game loads every switcher button is
  // disabled, and the active game's button stays disabled as a no-op self-click.
  // To avoid the startup race (a brief enabled-but-not-yet-active window before
  // auto-init disables the buttons), first wait until *some* game has settled
  // active-and-not-loading (= auto-init finished), then only click if the target
  // isn't already that game.
  await page.waitForSelector(`#gameSwitcher button[data-game].active:not(.loading)`, {
    timeout: READY_TIMEOUT,
  });
  const sel = `#gameSwitcher button[data-game="${game}"]`;
  const active = await page.locator(sel).evaluate((el) => el.classList.contains("active"));
  if (!active) {
    await page.click(sel); // a real switch; the target is enabled now that init settled
    await page.waitForSelector(`${sel}.active:not(.loading)`, { timeout: READY_TIMEOUT });
  }
}

/** Open every collapsed <details> ancestor so the target control is visible. */
export async function reveal(page: Page, sel: string): Promise<void> {
  await page.evaluate((s) => {
    let el: Element | null = document.querySelector(s);
    while (el) {
      if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
      el = el.parentElement;
    }
  }, sel);
}

export async function clickRevealed(page: Page, sel: string): Promise<void> {
  await reveal(page, sel);
  await page.click(sel);
}

export async function runStep(page: Page, step: Step): Promise<void> {
  if ("fireChip" in step) {
    await clickRevealed(page, `#cmdChips button.chip[data-cmd="${step.fireChip.toUpperCase()}"]`);
  } else if ("speed" in step) {
    await clickRevealed(page, `button[data-speed="${step.speed}"]`);
  } else if ("click" in step) {
    await clickRevealed(page, step.click);
  } else if ("select" in step) {
    const [sel, value] = step.select;
    await reveal(page, sel);
    await page.selectOption(sel, value);
  } else if ("openSection" in step) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const details = el?.closest("details");
      if (details && !details.open) (details.querySelector("summary") as HTMLElement)?.click();
    }, step.openSection);
  } else if ("scrubTo" in step) {
    await page.evaluate((frac) => {
      const el = document.querySelector<HTMLInputElement>("#scrubPos");
      if (!el) throw new Error("#scrubPos not found");
      const min = Number(el.min || "0");
      const max = Number(el.max || "100");
      el.value = String(min + frac * (max - min));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, step.scrubTo);
  } else if ("waitMs" in step) {
    await page.waitForTimeout(step.waitMs);
  }
}

/** Returns the colour-channel range of a 2d canvas; ~0 means uniform/blank. */
export async function canvasRange(page: Page, sel: string): Promise<number> {
  return page.evaluate((s) => {
    const c = document.querySelector<HTMLCanvasElement>(s);
    if (!c) return -1;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      // stride over the red channel
      if (data[i]! < min) min = data[i]!;
      if (data[i]! > max) max = data[i]!;
    }
    return max - min;
  }, sel);
}
