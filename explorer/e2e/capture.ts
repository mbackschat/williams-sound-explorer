#!/usr/bin/env -S npx tsx
/**
 * Playwright driver: pick a manifest (or all), walk its entries, verify each
 * click-path, and capture the illustrative screenshot.  Local maintainer tool —
 * it drives the dev server (which serves your locally-supplied ROMs from
 * public/roms/) and emits only PNG, never ROM bytes.  NOT a CI job.
 * See `docs/web-capture.md`.
 *
 * Prereqs (the wrapper tools/refresh_screenshots.sh does these for you):
 *   cd explorer && npm run dev:roms && npm run dev      # server on :5173
 *
 * Usage:
 *   npx tsx e2e/capture.ts                    # default: explorer + designer (every shipping screenshot)
 *   npx tsx e2e/capture.ts explorer           # only Explorer entries (MANUAL.md illustrations)
 *   npx tsx e2e/capture.ts designer           # only Designer entries (MANUAL_DESIGNER.md illustrations)
 *   npx tsx e2e/capture.ts smokes             # only transient regression smokes (no shipping screenshots)
 *   npx tsx e2e/capture.ts explorer:tut-04    # filter by id substring within a manifest
 *   npx tsx e2e/capture.ts tut-04             # legacy: id-only filter scans every manifest
 *   CAPTURE_URL=http://localhost:5173 npx tsx e2e/capture.ts --headed
 */
import { type Page, type Locator } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { type Entry, type Assert } from "./manifest.ts";
import { entries as explorerEntries } from "./capturesExplorer.ts";
import { entries as designerEntries } from "./capturesDesigner.ts";
import { entries as smokeEntries } from "./smokes.ts";
import {
  REPO_ROOT,
  READY_TIMEOUT,
  VIEWPORT,
  launch,
  bootPage,
  selectGame,
  resetState,
  reveal,
  runStep,
  canvasRange,
} from "./lib.ts";

/** Each named manifest = an Entry[] that runs together as one "set". */
const MANIFESTS: Record<string, Entry[]> = {
  explorer: explorerEntries,
  designer: designerEntries,
  smokes: smokeEntries,
};
/** When no manifest is named, run everything that produces a shipping screenshot. */
const DEFAULT_SET: string[] = ["explorer", "designer"];

const HEADED = process.argv.includes("--headed");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));

/** Parse the CLI selector — either `manifest`, `manifest:filter`, or `filter` (any manifest). */
function pickEntries(): Entry[] {
  if (!arg) return DEFAULT_SET.flatMap((k) => MANIFESTS[k]!);
  const [head, rest] = arg.includes(":") ? arg.split(":") as [string, string] : [arg, ""];
  if (head in MANIFESTS) {
    const all = MANIFESTS[head]!;
    return rest ? all.filter((e) => e.id.includes(rest)) : all;
  }
  // Treat the whole arg as an id-substring filter across every manifest.
  return Object.values(MANIFESTS).flat().filter((e) => e.id.includes(arg));
}

async function checkAssert(page: Page, a: Assert): Promise<string | null> {
  if ("recorded" in a) {
    try {
      await page.waitForFunction(
        () => !(document.querySelector("#scrubReadout")?.textContent ?? "").includes("no recording"),
        { timeout: READY_TIMEOUT },
      );
      return null;
    } catch {
      return "audio never recorded (AudioContext stayed suspended?)";
    }
  }
  if ("cmdInfoContains" in a) return checkAssert(page, { textContains: ["#cmdInfo", a.cmdInfoContains] });
  if ("text" in a) {
    const [sel, exact] = a.text;
    const got = (await page.locator(sel).textContent())?.trim() ?? "";
    return got === exact ? null : `${sel} text = "${got}", expected "${exact}"`;
  }
  if ("textContains" in a) {
    const [sel, sub] = a.textContains;
    const got = (await page.locator(sel).textContent()) ?? "";
    return got.includes(sub) ? null : `${sel} text "${got.trim()}" does not contain "${sub}"`;
  }
  if ("hasClass" in a) {
    const [sel, cls] = a.hasClass;
    const has = await page.locator(sel).evaluate((el, c) => el.classList.contains(c), cls);
    return has ? null : `${sel} missing class "${cls}"`;
  }
  if ("disabled" in a) {
    // Buttons/inputs only — reads the live `disabled` property, not the
    // attribute (jsdom-style attribute reads can lie for properties set via
    // JS).  Useful for asserting a Reset-style control returned to idle.
    const sel = a.disabled;
    const isDisabled = await page.locator(sel).evaluate((el) => (el as HTMLButtonElement).disabled === true);
    return isDisabled ? null : `${sel} is enabled (expected disabled)`;
  }
  if ("markerCountAtLeast" in a) {
    const n = await page.locator("#scrubMarkers > *").count();
    return n >= a.markerCountAtLeast ? null : `#scrubMarkers has ${n}, expected ≥ ${a.markerCountAtLeast}`;
  }
  if ("canvasNonBlank" in a) {
    await reveal(page, a.canvasNonBlank);
    const range = await canvasRange(page, a.canvasNonBlank);
    return range > 8 ? null : `${a.canvasNonBlank} looks blank (channel range ${range})`;
  }
  return `unknown assert: ${JSON.stringify(a)}`;
}

async function runEntry(page: Page, e: Entry): Promise<boolean> {
  process.stdout.write(`\n▶ ${e.id} (${e.game})\n`);
  // A previous entry may have left us in Design mode (which hides
  // #gameSwitcher) or with a custom audition active.  Reset the top-level
  // state before this entry so it starts from a clean Explore page:
  //   - flip back to Explore (no-op if already there)
  //   - reset the Designer's project to empty if Designer is mounted
  //     (slot lists otherwise persist across mode flips and entries trying
  //     to override the same GWAVE code would hit a disabled option)
  await page.evaluate(() => {
    (document.getElementById("modeExplore") as HTMLButtonElement | null)?.click();
    const designNew = document.querySelector<HTMLButtonElement>(".designer-new");
    designNew?.click();
  });
  await selectGame(page, e.game);
  await resetState(page); // clear scrub / freeze toggles / forced sliders left by a prior entry
  for (const step of e.steps) await runStep(page, step);
  if (e.readyWhen) {
    const fail = await checkAssert(page, e.readyWhen);
    if (fail) {
      process.stdout.write(`  ✗ readyWhen: ${fail}\n`);
      return false;
    }
  }
  let ok = true;
  for (const a of e.assert ?? []) {
    const fail = await checkAssert(page, a);
    if (fail) {
      process.stdout.write(`  ✗ ${fail}\n`);
      ok = false;
    } else {
      process.stdout.write(`  ✓ ${Object.keys(a)[0]}\n`);
    }
  }
  const out = resolve(REPO_ROOT, e.shot.file);
  await mkdir(dirname(out), { recursive: true });
  if ("clip" in e.shot) {
    await reveal(page, e.shot.clip);
    const el: Locator = page.locator(e.shot.clip);
    await el.screenshot({ path: out });
  } else if ("fullPage" in e.shot) {
    await page.screenshot({ path: out, fullPage: true });
  } else {
    await page.screenshot({ path: out }); // viewport only
  }
  process.stdout.write(`  📸 ${e.shot.file}\n`);
  return ok;
}

async function main(): Promise<void> {
  const entries = pickEntries();
  if (entries.length === 0) {
    const known = Object.keys(MANIFESTS).join(", ");
    process.stdout.write(`No entries match "${arg}". Known manifests: ${known}.\n`);
    process.exit(1);
  }
  const browser = await launch(HEADED);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await bootPage(context);

  let allOk = true;
  for (const e of entries) {
    try {
      if (!(await runEntry(page, e))) allOk = false;
    } catch (err) {
      process.stdout.write(`  ✗ threw: ${err instanceof Error ? err.message : String(err)}\n`);
      allOk = false;
    }
  }

  await browser.close();
  process.stdout.write(allOk ? "\n✓ all entries passed\n" : "\n✗ some entries failed\n");
  process.exit(allOk ? 0 : 1);
}

void main();
