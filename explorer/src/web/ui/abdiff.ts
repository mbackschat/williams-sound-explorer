/**
 * Step 5.3 / 5.4 — A/B diff + Genealogy.  Two byte-tapes with a divergence
 * band; the genealogy list fills the A/B selectors and runs the offline diff.
 * Self-contained: owns its `ABDiff` instance and clears its ROM cache on the
 * `rom-store-changed` event.  `ctx` is used only for logging.
 */
import { els } from "../els.ts";
import type { GameKind } from "../../board/soundboard.ts";
import { ABDiff, type ABDiffPick } from "../../viz/ABDiff.ts";
import { loadGenealogy, renderGenealogy } from "../../viz/Genealogy.ts";
import type { AppContext } from "../appContext.ts";

function readPickFromUi(slot: "a" | "b"): ABDiffPick {
  const gameEl = slot === "a" ? els.abGameA : els.abGameB;
  const cmdEl = slot === "a" ? els.abCmdA : els.abCmdB;
  const cmdHex = cmdEl.value.trim();
  const cmd = Number.parseInt(cmdHex, 16);
  return {
    game: gameEl.value as GameKind,
    cmd: Number.isNaN(cmd) ? 0 : (cmd & 0x3F),
  };
}

function writePickToUi(slot: "a" | "b", pick: ABDiffPick): void {
  const gameEl = slot === "a" ? els.abGameA : els.abGameB;
  const cmdEl = slot === "a" ? els.abCmdA : els.abCmdB;
  gameEl.value = pick.game;
  cmdEl.value = pick.cmd.toString(16).toUpperCase().padStart(2, "0");
}

export function initABDiff(ctx: AppContext): void {
  const abDiff = new ABDiff({
    container: els.abCanvas.parentElement as HTMLElement,
    canvas: els.abCanvas,
    summary: els.abSummary,
  });
  // A replaced/removed ROM must not be served from abDiff's cache.
  window.addEventListener("rom-store-changed", () => abDiff.clearRomCache());

  els.abRun.addEventListener("click", async () => {
    els.abRun.disabled = true;
    try {
      await abDiff.runAndRender(readPickFromUi("a"), readPickFromUi("b"));
    } catch (e) {
      ctx.log(`A/B diff failed: ${(e as Error).message}`, "err");
    } finally {
      els.abRun.disabled = false;
    }
  });

  void loadGenealogy().then((g) => {
    renderGenealogy(els.genealogyList, g, abDiff, writePickToUi);
    if (g.families.length > 0) {
      ctx.log(`Loaded sound genealogy — ${g.families.length} families.`, "ok");
    }
  });
}
