/**
 * Phase 2.1 browser harness — wires the HTML buttons in `index.html` to the
 * `WilliamsSoundHost`.  Deliberately minimal: this is the *first ear-check
 * in a browser*, not a UI.  The proper UI scaffold lands in Phase 3.1.
 */
import { WilliamsSoundHost, type StateSnapshot, type ScrubLoopMode, type SoundSegment } from "./host.ts";
import {
  clipSegmentsToRange,
  compactDuration,
  cycleToCompactOffset,
  compactOffsetToCycle,
  scrubReadout,
} from "./scrubTimeline.ts";
import {
  ENGINE_TOGGLE_KEYS,
  ENGINE_TOGGLE_META,
  SCREAM_VOICE_TOGGLE_KEYS,
  ORGAN_VOICE_TOGGLE_KEYS,
  type EngineToggleKey,
} from "./engineToggles.ts";
import type { GameKind } from "../board/soundboard.ts";
import { loadGlossary, lookup, lookupTerm, summarize, type Glossary } from "./glossary.ts";
import { loadLabelMaps, emptyLabelMap, type LabelMap } from "./labelMap.ts";
import { loadZeroPageMaps } from "./zeroPageMap.ts";
import { allEnabled, chipEngineKey, isChipVisible } from "./chipFilter.ts";
import { runSoundWithRom } from "../runner.ts";
import { renderDacEvents } from "../synth/DacSampler.ts";
import { applyLpf } from "../synth/lpf.ts";
import { encodeWav } from "../synth/wav.ts";
import { loadRomFromUrl } from "../board/romFetch.ts";
import { listRoms, hasRom, loadRomBytes } from "./romStore.ts";
import { mountOnboarding, showOnboarding, hideOnboarding } from "./onboarding.ts";
import { EarPanel } from "../viz/EarPanel.ts";
import { EyePanel } from "../viz/EyePanel.ts";
import { CodePanel } from "../viz/CodePanel.ts";
import { Spectrogram } from "../viz/Spectrogram.ts";
import { StageSwimlane } from "../viz/StageSwimlane.ts";
import { VARIView } from "../viz/VARIView.ts";
import { WavetableView } from "../viz/WavetableView.ts";
import { SCREAMView } from "../viz/SCREAMView.ts";
import { ORGANView } from "../viz/ORGANView.ts";
import { FNOISEView } from "../viz/FNOISEView.ts";
import { RAMHeatmap } from "../viz/RAMHeatmap.ts";
import { ExplainerCardPanel } from "../viz/ExplainerCard.ts";
import { QuizPanel } from "../viz/QuizPanel.ts";
import { ABDiff, type ABDiffPick } from "../viz/ABDiff.ts";
import { loadGenealogy, renderGenealogy } from "../viz/Genealogy.ts";
import type { VizPanel } from "../viz/types.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not in DOM`);
  return el as T;
};

const els = {
  pageLayout: $<HTMLDivElement>("pageLayout"),
  colSplitter: $<HTMLDivElement>("colSplitter"),
  gameSwitcher: $<HTMLDivElement>("gameSwitcher"),
  cmd: $<HTMLInputElement>("cmd"),
  fire: $<HTMLButtonElement>("fire"),
  firePaused: $<HTMLButtonElement>("firePaused"),
  pause: $<HTMLButtonElement>("pause"),
  step: $<HTMLButtonElement>("step"),
  stepDac: $<HTMLButtonElement>("stepDac"),
  stepIrq: $<HTMLButtonElement>("stepIrq"),
  pauseState: $<HTMLSpanElement>("pauseState"),
  speedReadout: $<HTMLSpanElement>("speedReadout"),
  volume: $<HTMLInputElement>("volume"),
  volumeReadout: $<HTMLSpanElement>("volumeReadout"),
  volumeMeterRms: $<HTMLDivElement>("volumeMeterRms"),
  volumeMeterPeak: $<HTMLDivElement>("volumeMeterPeak"),
  meterReadout: $<HTMLSpanElement>("meterReadout"),
  earCanvas: $<HTMLCanvasElement>("earCanvas"),
  eyeCanvas: $<HTMLCanvasElement>("eyeCanvas"),
  codePanel: $<HTMLPreElement>("codePanel"),
  spectroCanvas: $<HTMLCanvasElement>("spectroCanvas"),
  swimlaneCanvas: $<HTMLCanvasElement>("swimlaneCanvas"),
  variCanvas: $<HTMLCanvasElement>("variCanvas"),
  wavetableCanvas: $<HTMLCanvasElement>("wavetableCanvas"),
  screamCanvas: $<HTMLCanvasElement>("screamCanvas"),
  organCanvas: $<HTMLCanvasElement>("organCanvas"),
  fnoiseCanvas: $<HTMLCanvasElement>("fnoiseCanvas"),
  ramHeatmapCanvas: $<HTMLCanvasElement>("ramHeatmapCanvas"),
  explainerCard: $<HTMLDivElement>("explainerCard"),
  quizPanel: $<HTMLDivElement>("quizPanel"),
  engineStack: $<HTMLDivElement>("engineStack"),
  engineToggleRow: $<HTMLDivElement>("engineToggleRow"),
  screamBuildUp: $<HTMLButtonElement>("screamBuildUp"),
  screamTearDown: $<HTMLButtonElement>("screamTearDown"),
  screamSeqStop: $<HTMLButtonElement>("screamSeqStop"),
  organBuildUp: $<HTMLButtonElement>("organBuildUp"),
  organTearDown: $<HTMLButtonElement>("organTearDown"),
  organSeqStop: $<HTMLButtonElement>("organSeqStop"),
  hideHelpToggle: $<HTMLButtonElement>("hideHelpToggle"),
  abGameA: $<HTMLSelectElement>("abGameA"),
  abGameB: $<HTMLSelectElement>("abGameB"),
  abCmdA: $<HTMLInputElement>("abCmdA"),
  abCmdB: $<HTMLInputElement>("abCmdB"),
  abRun: $<HTMLButtonElement>("abRun"),
  abSummary: $<HTMLSpanElement>("abSummary"),
  abCanvas: $<HTMLCanvasElement>("abCanvas"),
  genealogyList: $<HTMLDivElement>("genealogyList"),
  cmdInfo: $<HTMLDivElement>("cmdInfo"),
  cmdChips: $<HTMLDivElement>("cmdChips"),
  chipLegend: $<HTMLDivElement>("chipLegend"),
  exportWav: $<HTMLButtonElement>("exportWav"),
  termList: $<HTMLDivElement>("termList"),
  termPopover: $<HTMLDivElement>("termPopover"),
  scrubStart: $<HTMLButtonElement>("scrubStart"),
  scrubLive: $<HTMLButtonElement>("scrubLive"),
  scrubReset: $<HTMLButtonElement>("scrubReset"),
  scrubMode: $<HTMLButtonElement>("scrubMode"),
  scrubPos: $<HTMLInputElement>("scrubPos"),
  scrubReadout: $<HTMLSpanElement>("scrubReadout"),
  scrubLoop: $<HTMLButtonElement>("scrubLoop"),
  scrubPlay: $<HTMLButtonElement>("scrubPlay"),
  scrubMarkers: $<HTMLDivElement>("scrubMarkers"),
  log: $<HTMLDivElement>("log"),
};

let host: WilliamsSoundHost | undefined;
let paused = false;
let scrubbing = false;
/** Most recent recorded cycle range — used to map slider 0..1000 to cycle. */
let recordedOldest = 0;
let recordedNewest = 0;
let glossary: Glossary = { defender: {}, stargate: {}, robotron: {}, terms: {} };
let labelMap: LabelMap = emptyLabelMap();
/** Active game per the segmented switcher.  Initial = Defender. */
let selectedGame: GameKind = "defender";
/** Game whose runner is currently loading (so the button can show ⟳). */
let loadingGame: GameKind | null = null;
const ALL_GAMES: readonly GameKind[] = ["defender", "stargate", "robotron"];
/** Games whose ROM is in the local store — drives the switcher's locked state. */
let availableGames = new Set<GameKind>();

function currentGame(): GameKind {
  return selectedGame;
}

const gamePickButtons = Array.from(
  els.gameSwitcher.querySelectorAll<HTMLButtonElement>("button.game-pick"),
);

function refreshGameSwitcherUi(): void {
  for (const btn of gamePickButtons) {
    const game = btn.dataset.game as GameKind;
    const has = availableGames.has(game);
    const isActive = host !== undefined && game === selectedGame && loadingGame === null;
    const isLoading = game === loadingGame;
    btn.classList.toggle("active", isActive);
    btn.classList.toggle("loading", isLoading);
    btn.classList.toggle("locked", !has);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
    if (!has) {
      // No ROM yet — keep it CLICKABLE (opens onboarding for that game).
      btn.disabled = false;
      btn.title = `Upload ${game}'s sound ROM to enable it`;
    } else {
      // Disable the active button (no-op self-click) AND every button while
      // any load is in flight, so the user can't queue switches mid-init.
      btn.disabled = loadingGame !== null || isActive;
      const label = btn.textContent?.trim() || game;
      btn.title = isActive
        ? `${label} — active (ROM loaded)`
        : `Switch to ${label} — loads its sound ROM into the emulator`;
    }
  }
}

/** Refresh `availableGames` from the store + dependent UI (switcher). */
async function refreshAvailability(): Promise<void> {
  availableGames = new Set(await listRoms());
  refreshGameSwitcherUi();
}

/**
 * Per-game tune table for $1B ORGANT. Indices match `ORGTAB` entries in the
 * sound ROMs. Sourced from `research/williams-soundroms/VSNDRM{1,2,3}.SRC`.
 * On Stargate $1C ORGANN is gutted to a no-op stub — handled separately.
 */
const ORGAN_TUNES: Record<GameKind, { num: number; name: string; note: string }[]> = {
  defender: [
    { num: 1, name: "PHANTOM", note: "3 notes — D2, CS2, FS1 (long)" },
    { num: 2, name: "TACCATA", note: "34-note baroque-organ figure" },
  ],
  stargate: [
    { num: 1, name: "FIFTH", note: "Close Encounters 5-note motif (G2, EF1)" },
    { num: 2, name: "NINTH", note: "42-note multi-octave figure" },
  ],
  robotron: [
    { num: 1, name: "FIFTH", note: "Close Encounters 5-note motif" },
    { num: 2, name: "NINTH", note: "42-note multi-octave figure" },
  ],
};

/**
 * Fire a sequence of commands with a wall-clock gap between each, so the
 * PIA's CA1 latch has time to be cleared by the IRQ handler before the
 * next command lands.  Without the gap, two rapid `fire()` calls would
 * overwrite the latched value and the first command would be lost.
 *
 * ORGANT and ORGANN both depend on this: they "arm" via the first IRQ,
 * then interpret the next byte arriving over the latch as parameter data.
 */
async function fireSequence(commands: number[], gapMs = 40): Promise<void> {
  if (!host) return;
  resetEnginePanels();
  if (commands.length > 0) loadExplainerForCmd(commands[0]!);
  for (let i = 0; i < commands.length; i++) {
    host.fire(commands[i]!);
    if (i < commands.length - 1) {
      await new Promise<void>((r) => setTimeout(r, gapMs));
    }
  }
}

/**
 * Look up the routine for `(currentGame, cmd)` in the glossary and load
 * the matching explainer card.  Silently degrades to a "no card yet"
 * placeholder for sounds we haven't authored cards for.
 */
function loadExplainerForCmd(cmd: number): void {
  const game = currentGame();
  const entry = lookup(glossary, game, cmd);
  const routine = entry?.routine;
  void explainerCard.setRoutine(routine, cmd, game);
}

/**
 * Reset every per-engine view's canvas to its idle caption.  Called at the
 * start of each user-initiated fire so stale state from the previous sound
 * doesn't carry over.  The sticky-during-playback behaviour inside each
 * view's `update()` still prevents intra-sound flicker — this only clears
 * between sounds.
 *
 * `panels` is populated lazily (after `loadGenealogy` etc.), so we use a
 * `forEach` with optional-chaining for the `resetIdle?()` interface.
 */
function resetEnginePanels(): void {
  for (const p of panels) p.resetIdle?.();
}

/**
 * User-driven fire entry point — what every "click → play this sound" path
 * calls (Fire button, paused-Fire, Try-chip).  Wraps `host.fire()` with
 * automatic two-pulse handling for arm-only commands so a single click
 * always produces audible output (or visibly explains why it can't).
 *
 * Arm-only commands across the three ROMs (audit in
 * `research/williams-soundroms`):
 *
 *   • `$1B` ORGANT (all 3 games) — sets ORGFLG = -1 and RTSes.  The next
 *     IRQ's command byte is read as the tune number by ORGNT1.  Without
 *     a follow-up the CPU spins at `BEQ *` in IRQ3 and nothing plays.
 *     **Auto-pulse**: fire `$1B`, wait 40 ms, fire tune index `$01`
 *     (PHANTOM / FIFTH / FIFTH depending on game).  The arm-form picker
 *     in `refreshCmdInfo` lets the user override the tune number.
 *
 *   • `$1C` ORGANN — multi-byte protocol (osc/dly/note over 3 follow-up
 *     IRQs on Defender; gutted to `RTS` on Stargate / Robotron).  No
 *     sensible auto-pulse; the cmdInfo panel documents this.
 *
 * All other commands fire as-is.  Caller responsibility: ensure `host` is
 * initialised before calling.
 */
const AUTO_PULSE_GAP_MS = 40;
const DEFAULT_ORGAN_TUNE = 1;

function fireUserCmd(cmd: number): void {
  if (!host) return;
  if (cmd === 0x1B) {
    // Auto-pulse: arm + kick a tune.  Reads the #organtTune picker if the
    // cmdInfo panel has rendered it (i.e. the user typed/clicked $1B and
    // chose a tune number); falls back to DEFAULT_ORGAN_TUNE for first-
    // click flows where the picker isn't in the DOM yet.
    const sel = document.getElementById("organtTune") as HTMLSelectElement | null;
    const tune = sel ? (Number.parseInt(sel.value, 10) || DEFAULT_ORGAN_TUNE) : DEFAULT_ORGAN_TUNE;
    const tuneName = ORGAN_TUNES[currentGame()].find((t) => t.num === tune)?.name ?? "?";
    log(`Fired $1B (ORGANT, arm) — auto-pulsing $0${tune} (${tuneName}) in ${AUTO_PULSE_GAP_MS} ms to kick the tune.`);
    void fireSequence([0x1B, tune], AUTO_PULSE_GAP_MS);
    return;
  }
  resetEnginePanels();
  loadExplainerForCmd(cmd);
  host.fire(cmd);
  log(`Fired $${cmd.toString(16).padStart(2, "0").toUpperCase()}`);
}

function refreshCmdInfo(): void {
  const raw = els.cmd.value.trim();
  const cmd = Number.parseInt(raw, 16);
  if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) {
    els.cmdInfo.textContent = "Enter a hex code in the range 00..3F.";
    els.cmdInfo.style.borderLeftColor = "#5a5e68";
    return;
  }
  const entry = lookup(glossary, currentGame(), cmd);
  if (!entry) {
    els.cmdInfo.textContent = `$${cmd.toString(16).padStart(2, "0").toUpperCase()} — no glossary entry for ${currentGame()}.`;
    els.cmdInfo.style.borderLeftColor = "#5a5e68";
    return;
  }
  const code = cmd.toString(16).padStart(2, "0").toUpperCase();
  // The engine name renders as a clickable term link if we have an
  // explanation for it; otherwise plain text.
  const engineHtml = entry.engine
    ? (lookupTerm(glossary, entry.engine)
        ? ` · <a class="term-link" data-term="${escapeHtml(entry.engine)}">${escapeHtml(entry.engine)}</a>`
        : ` · ${escapeHtml(entry.engine)}`)
    : "";
  // Special-case help for the four "zero DAC events when fired alone"
  // commands.  $1B / $1C are multi-step protocols (arming routines); $13
  // toggles state only; $00 is silence by design.
  let extra = "";
  const game = currentGame();
  if (cmd === 0x1B) {
    const tunes = ORGAN_TUNES[game];
    const optHtml = tunes
      .map((t) => `<option value="${t.num}">${t.num} — ${escapeHtml(t.name)} · ${escapeHtml(t.note)}</option>`)
      .join("");
    extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ffd866; border-radius: 3px;">
      <div style="font-size: 0.82rem; color: #ffd866;">⚠ Two-step command — \$1B alone arms the tune flag but doesn't play it.</div>
      <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0.5rem;">
        \$1B's body is literally <code>DEC ORGFLG; RTS</code>. The tune actually
        plays inside the <em>next</em> IRQ, which reads its command byte as
        the tune number. Clicking <kbd>Fire</kbd> on \$1B now auto-pulses
        \$0${DEFAULT_ORGAN_TUNE} (tune ${DEFAULT_ORGAN_TUNE}) ${AUTO_PULSE_GAP_MS} ms later — pick a different
        tune below to override.
      </div>
      <div class="row" style="gap: 0.4rem; align-items: center;">
        <label for="organtTune" style="font-size: 0.82rem;">Tune:</label>
        <select id="organtTune" style="font-size: 0.85rem;">${optHtml}</select>
        <button id="organtFire" class="primary" style="font-size: 0.85rem;">Arm + Play</button>
      </div>
    </div>`;
  } else if (cmd === 0x1C) {
    if (game === "defender") {
      extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ff6188; border-radius: 3px;">
        <div style="font-size: 0.82rem; color: #ff6188;">⚠ Four-step command — \$1C alone arms a 3-byte data sequence; the note plays after the third follow-up byte.</div>
        <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0.5rem;">
          \$1C sets <code>ORGFLG = 3</code> and RTSes; each of the next three IRQs
          decrements ORGFLG and shifts its command byte into the OSCIL/note
          state.  Defender is the only ROM with a working implementation —
          on Stargate / Robotron \$1C is gutted to a single <code>RTS</code>.
        </div>
        <div class="row" style="gap: 0.4rem; align-items: center; font-size: 0.85rem;">
          <label>osc:</label><input id="organnOsc" type="text" value="0F" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
          <label>dly:</label><input id="organnDly" type="text" value="00" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
          <label>note:</label><input id="organnNote" type="text" value="05" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
          <button id="organnFire" class="primary" style="font-size: 0.85rem;">Arm + Play</button>
        </div>
      </div>`;
    } else {
      extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ff6188; border-radius: 3px;">
        <div style="font-size: 0.82rem; color: #ff6188;">⚠ Gutted on ${game} — \$1C is a single <code>RTS</code>, silent regardless of follow-up bytes.</div>
        <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0;">
          Defender's \$1C drives a 3-byte note-arming protocol; ${game} dropped that
          mechanism.  Switch to Defender to fire ad-hoc organ notes.
        </div>
      </div>`;
    }
  } else if (cmd === 0x13) {
    extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #78dce8; border-radius: 3px; font-size: 0.78rem; color: #abafb6;">
      ℹ BGEND clears the BG1/BG2 flags. Only audible if you previously fired
      $0F (BG1) or $10 (BG2INC) — otherwise it's a no-op.
    </div>`;
  } else if (cmd === 0x00) {
    extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #78dce8; border-radius: 3px; font-size: 0.78rem; color: #abafb6;">
      ℹ The handler reads the latch, sees $00, dispatches nothing. Useful for
      "kick the background poll" but otherwise silent.
    </div>`;
  }
  els.cmdInfo.innerHTML =
    `<strong>$${code}</strong>  ${escapeHtml(entry.routine)}` +
    `<span style="color: #abafb6;">${engineHtml} · ${escapeHtml(entry.name)}</span>` +
    (entry.blurb ? `<br><span style="color: #abafb6; font-size: 0.82rem;">${escapeHtml(entry.blurb)}</span>` : "") +
    extra;
  els.cmdInfo.style.borderLeftColor = cmd === 0x1B ? "#ffd866" : cmd === 0x1C ? "#ff6188" : "#ffd866";
  annotateTermLinks(els.cmdInfo); // hover tooltip on the (re-rendered) engine term-link

  // Wire the Arm+Play button for $1B (deferred until after innerHTML).
  if (cmd === 0x1B) {
    const select = document.getElementById("organtTune") as HTMLSelectElement | null;
    const btn = document.getElementById("organtFire") as HTMLButtonElement | null;
    if (btn && select) {
      btn.addEventListener("click", async () => {
        if (!host) {
          log("Init the worklet first.", "err");
          return;
        }
        const tune = Number.parseInt(select.value, 10);
        const tuneName = ORGAN_TUNES[currentGame()].find((t) => t.num === tune)?.name ?? "?";
        log(`Firing $1B then $${tune.toString(16).padStart(2, "0").toUpperCase()} (ORGANT → tune ${tune} ${tuneName})`);
        await fireSequence([0x1B, tune]);
      });
    }
  }

  // Wire the Arm+Play button for $1C on Defender (the 4-byte ORGANN protocol).
  if (cmd === 0x1C && game === "defender") {
    const osc = document.getElementById("organnOsc") as HTMLInputElement | null;
    const dly = document.getElementById("organnDly") as HTMLInputElement | null;
    const note = document.getElementById("organnNote") as HTMLInputElement | null;
    const btn = document.getElementById("organnFire") as HTMLButtonElement | null;
    if (btn && osc && dly && note) {
      btn.addEventListener("click", async () => {
        if (!host) {
          log("Init the worklet first.", "err");
          return;
        }
        const parseHex = (el: HTMLInputElement): number => {
          const n = Number.parseInt(el.value.trim(), 16);
          return Number.isFinite(n) ? n & 0xFF : 0;
        };
        const b1 = parseHex(osc), b2 = parseHex(dly), b3 = parseHex(note);
        const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
        log(`Firing $1C → ${hex(b1)} → ${hex(b2)} → ${hex(b3)} (ORGANN sequence)`);
        await fireSequence([0x1C, b1, b2, b3]);
      });
    }
  }
}

function renderTermList(): void {
  const keys = Object.keys(glossary.terms ?? {}).sort();
  els.termList.innerHTML = keys
    .map((k) => `<button class="term" data-term="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
    .join("");
}

function showTerm(key: string): void {
  const t = lookupTerm(glossary, key);
  if (!t) {
    els.termPopover.style.display = "none";
    return;
  }
  els.termPopover.innerHTML =
    `<strong style="color: #78dce8;">${escapeHtml(t.title)}</strong>` +
    `<br><span style="color: #abafb6; font-size: 0.78rem;">WHAT</span> · ${escapeHtml(t.what)}` +
    `<br><span style="color: #abafb6; font-size: 0.78rem;">HOW</span> · ${escapeHtml(t.how)}` +
    `<br><span style="color: #abafb6; font-size: 0.78rem;">WHERE</span> · ${escapeHtml(t.where)}`;
  els.termPopover.style.display = "block";
}

/**
 * Give every glossary term-link / chip (`[data-term]`) a hover `title` with the
 * term's short "what" description, so the meaning is one hover away without
 * clicking through to the popover.  Appends to any pre-existing title rather
 * than overwriting it; idempotent via a `data-term-titled` flag so re-runs
 * (after cmdInfo re-renders, etc.) don't double-append.
 */
function annotateTermLinks(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-term]"))) {
    if (el.dataset.termTitled === "1") continue;
    const t = lookupTerm(glossary, el.dataset.term ?? "");
    if (!t || !t.what) continue;
    el.title = el.title ? `${el.title} — ${t.what}` : t.what;
    el.dataset.termTitled = "1";
  }
}

// Delegated click handler: any element with data-term reveals the term.
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  const termEl = target?.closest<HTMLElement>("[data-term]");
  if (termEl) {
    const key = termEl.dataset.term;
    if (key) showTerm(key);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * Rebuild the "Try:" chip browser from the active game's glossary.  One
 * chip per command code with a non-empty routine name; sorted by hex code.
 * Each chip shows `$XX  ROUTINE` plus a small engine-coloured dot, and the
 * tooltip carries the full `summarize()` text.
 */
function refreshChipTooltips(): void {
  const game = currentGame();
  const entries = glossary[game];
  els.cmdChips.replaceChildren();
  if (!entries || Object.keys(entries).length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className = "cmd-chips-empty";
    placeholder.textContent = "(glossary not yet loaded)";
    els.cmdChips.appendChild(placeholder);
    return;
  }
  // Sort by numeric hex code; entries with empty routines (e.g. silence)
  // still get a chip — the user can fire them too — but use "—" as label.
  const sorted = Object.keys(entries)
    .map((k) => ({ key: k, code: Number.parseInt(k, 16), entry: entries[k]! }))
    .filter((x) => Number.isFinite(x.code))
    .sort((a, b) => a.code - b.code);
  for (const { key, entry } of sorted) {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.dataset.cmd = key.toUpperCase();
    if (entry.engine) btn.dataset.engine = entry.engine;
    btn.title = summarize(entry);
    btn.innerHTML =
      `<span class="chip-engine"></span>` +
      `<span class="chip-cmd">$${key.toUpperCase()}</span>` +
      `<span class="chip-name">${escapeHtml(entry.routine || "—")}</span>`;
    btn.addEventListener("click", () => {
      els.cmd.value = btn.dataset.cmd ?? "";
      refreshCmdInfo();
      // Fire immediately — the chip browser doubles as a one-click sound
      // explorer.  Skip if the worklet isn't ready yet (chips render the
      // moment the glossary loads, which is typically before init finishes).
      if (!host) return;
      const cmd = Number.parseInt(btn.dataset.cmd ?? "", 16);
      if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) return;
      fireUserCmd(cmd);
    });
    els.cmdChips.appendChild(btn);
  }
  applyChipFilter();
}

/** Enabled engine keys for the Try-list filter — all on by default. */
const chipFilter = allEnabled();

/** Show/hide each chip per the current engine filter. */
function applyChipFilter(): void {
  for (const node of Array.from(els.cmdChips.children)) {
    const el = node as HTMLElement;
    if (!el.classList.contains("chip")) continue; // skip the empty-placeholder
    const key = chipEngineKey(el.dataset.engine);
    el.style.display = isChipVisible(key, chipFilter) ? "" : "none";
  }
}

/** Wire the "Show:" legend swatches as engine toggles (once, at startup). */
function initChipLegend(): void {
  for (const item of Array.from(els.chipLegend.querySelectorAll<HTMLButtonElement>(".legend-item"))) {
    item.addEventListener("click", () => {
      const key = chipEngineKey(item.dataset.engine);
      if (chipFilter.has(key)) chipFilter.delete(key);
      else chipFilter.add(key);
      item.setAttribute("aria-pressed", chipFilter.has(key) ? "true" : "false");
      applyChipFilter();
    });
  }
}
initChipLegend();

// ---- WAV export -----------------------------------------------------------
// Offline re-render of the current command to a downloadable .wav, reusing the
// exact pipeline as tools/render_sound.ts (deterministic, clean ROM sound —
// independent of the live worklet, so it works before Init too).
const WAV_EXPORT_RATE = 48000;
const exportRomCache = new Map<GameKind, Uint8Array>();

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

async function exportCurrentWav(): Promise<void> {
  const cmd = Number.parseInt(els.cmd.value, 16);
  if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) {
    log(`Export: "${els.cmd.value}" is not a valid command ($00..$3F).`, "err");
    return;
  }
  const game = currentGame();
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
      log(`Export: $${hh} produced no DAC output (silent) — nothing to save.`, "err");
      return;
    }
    const samples = renderDacEvents(result.events, {
      totalCycles: result.cycles,
      targetRate: WAV_EXPORT_RATE,
    });
    applyLpf(samples, { cutoffHz: 10000, sampleRate: WAV_EXPORT_RATE });
    const wav = encodeWav(samples, WAV_EXPORT_RATE);
    const routine = (lookup(glossary, game, cmd)?.routine ?? "")
      .replace(/[^A-Za-z0-9]+/g, "") || "sound";
    const ms = (result.cycles / 894_886 * 1000).toFixed(0);
    triggerDownload(wav, `${game}_${hh}_${routine}.wav`);
    log(`Exported ${game}_${hh}_${routine}.wav — ${ms} ms${result.reachedIdle ? "" : " (capped at 5 s)"}.`, "ok");
  } catch (e) {
    log(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "err");
  } finally {
    els.exportWav.disabled = false;
  }
}
els.exportWav.addEventListener("click", () => { void exportCurrentWav(); });

function log(line: string, kind: "" | "ok" | "err" = ""): void {
  const t = new Date().toTimeString().slice(0, 8);
  const cls = kind ? ` class="${kind}"` : "";
  els.log.insertAdjacentHTML("beforeend", `[${t}] <span${cls}>${line}</span>\n`);
  els.log.scrollTop = els.log.scrollHeight;
}

// Whether a game's worklet is loaded + ready.  Drives the Scrub/Live
// segmented toggle's enabled state (set in setReady, read in applyScrubUiState).
let hostReady = false;

// Playback transport (Fire / Fire⏸ / Pause / Step / ▸DAC / ▸IRQ + the Try
// chips) acts on the *live* CPU, which is frozen during scrub — so it's enabled
// only when a game is loaded AND we're not scrubbing.  (⬇ .wav is excluded: it
// renders offline and works regardless of scrub.)
function refreshTransportEnabled(): void {
  const live = hostReady && !scrubbing;
  els.fire.disabled = !live;
  els.firePaused.disabled = !live;
  els.pause.disabled = !live;
  els.step.disabled = !live || !paused;
  els.stepDac.disabled = !live || !paused;
  els.stepIrq.disabled = !live || !paused;
  els.cmdChips.classList.toggle("scrub-disabled", hostReady && scrubbing);
}

function setReady(ready: boolean): void {
  hostReady = ready;
  refreshGameSwitcherUi();
  els.scrubReset.disabled = !ready;
  els.scrubMode.disabled = !ready;
  // SCREAM + ORGAN Build-up / Tear-down run on whatever game is loaded (all
  // three support both engines), so they follow host readiness, not Robotron.
  els.screamBuildUp.disabled = !ready;
  els.screamTearDown.disabled = !ready;
  els.organBuildUp.disabled = !ready;
  els.organTearDown.disabled = !ready;
  applyScrubUiState();
}

function applyScrubUiState(): void {
  // Scrub / Live segmented toggle (styled like the game switcher): the current
  // mode is highlighted, the other segment is the action.  Both greyed until a
  // game is loaded; the active segment is disabled (no-op self-click).
  const live = !scrubbing;
  // Highlight the current mode only once a game is loaded — before that both
  // segments are greyed (disabled), with no "active" pip.
  els.scrubStart.classList.toggle("active", hostReady && scrubbing);
  els.scrubLive.classList.toggle("active", hostReady && live);
  els.scrubStart.disabled = !hostReady || scrubbing;
  els.scrubLive.disabled = !hostReady || live;
  // Playback transport is dead while scrubbing — keep it in sync here too.
  refreshTransportEnabled();
  // Rest of the scrub UI is meaningful only when scrubbing.
  els.scrubPos.disabled = !scrubbing;
  els.scrubLoop.disabled = !scrubbing;
  els.scrubPlay.disabled = !scrubbing;
  document.querySelectorAll<HTMLButtonElement>("button.scrub-preset").forEach((b) => {
    b.disabled = !scrubbing;
  });
}

// Play/pause toggle remembers the last non-zero speed so the user can
// freeze and resume without losing their playback direction.  Defaults
// to +1 (forward) for the first press.
let lastNonZeroScrubSpeed = 1;
let currentScrubSpeed = 0;
function setScrubSpeed(speed: number): void {
  currentScrubSpeed = speed;
  if (speed !== 0) lastNonZeroScrubSpeed = speed;
  els.scrubPlay.textContent = speed === 0 ? "▶" : "⏸";
  els.scrubPlay.title = speed === 0
    ? `Play at ${lastNonZeroScrubSpeed}× (last used)`
    : "Freeze the head (resumes at the same speed when clicked again)";
  if (host) host.setScrubSpeed(speed);
}

// Last-known segments + active marker tracking (rerendered when the set or
// the scrub head moves).
let knownSegments: SoundSegment[] = [];
let activeMarkerIndex = -1;

function renderScrubMarkers(s: StateSnapshot): void {
  // `knownSegments` is the ring-clipped segment list set in renderState.
  if (knownSegments.length === 0) {
    els.scrubMarkers.innerHTML = "";
    return;
  }
  // Compute slider positions according to the active timeline mode.
  const usingCompact = timelineMode === "compact";
  const total = usingCompact
    ? compactDuration(knownSegments, recordedNewest)
    : Math.max(0, recordedNewest - recordedOldest);
  if (total <= 0) {
    els.scrubMarkers.innerHTML = "";
    return;
  }
  const span = total;
  const cycleToPct = (cycle: number): number => {
    const v = usingCompact
      ? cycleToCompactOffset(cycle, knownSegments, recordedNewest)
      : cycle - recordedOldest;
    return (v / span) * 100;
  };
  // Identify which segment (if any) contains the current scrub head.
  if (s.scrubbing) {
    activeMarkerIndex = knownSegments.findIndex((seg) => {
      const end = seg.endCycle ?? Number.POSITIVE_INFINITY;
      return s.scrubCycle >= seg.startCycle && s.scrubCycle <= end;
    });
  } else {
    activeMarkerIndex = -1;
  }
  // Render markers as positioned div spans.  Use innerHTML for one-shot
  // replacement — segment counts stay small (<128).  Each start marker
  // shows the hex command code as a label above the tick; end markers
  // are thin gray ticks at the segment's endCycle so silences are visible.
  const parts: string[] = [];
  for (let i = 0; i < knownSegments.length; i++) {
    const seg = knownSegments[i]!;
    const startPct = cycleToPct(seg.startCycle);
    if (startPct >= 0 && startPct <= 100) {
      const hex = `$${seg.cmd.toString(16).padStart(2, "0").toUpperCase()}`;
      const entry = lookup(glossary, currentGame(), seg.cmd);
      const tooltip = entry
        ? `${hex}  ${entry.routine} — ${entry.name}`
        : hex;
      const active = i === activeMarkerIndex ? "true" : "false";
      parts.push(
        `<div class="scrub-marker" style="left: ${startPct.toFixed(2)}%;" ` +
          `data-segment-index="${i}" data-active="${active}" ` +
          `title="${escapeHtml(tooltip)}">` +
          `<span class="label">${hex}</span>` +
          `</div>`,
      );
    }
    if (seg.endCycle !== null) {
      const endPct = cycleToPct(seg.endCycle);
      if (endPct >= 0 && endPct <= 100) {
        parts.push(
          `<div class="scrub-end-marker" style="left: ${endPct.toFixed(2)}%;" ` +
            `data-segment-index="${i}" ` +
            `title="${escapeHtml(`end of $${seg.cmd.toString(16).padStart(2, "0").toUpperCase()} — silence after this`)}"></div>`,
        );
      }
    }
  }
  els.scrubMarkers.innerHTML = parts.join("");
}

let loopMode: ScrubLoopMode = "none";
function setLoopModeUI(mode: ScrubLoopMode): void {
  loopMode = mode;
  els.scrubLoop.textContent = `🔁 Loop: ${mode}`;
}

function setPaused(value: boolean): void {
  paused = value;
  els.pause.textContent = value ? "Resume" : "Pause";
  els.pauseState.textContent = value ? "paused" : "running";
  els.pauseState.style.color = value ? "#ffd866" : "#abafb6";
  refreshTransportEnabled();
}

let lastSnapshot: StateSnapshot | undefined;
// Engine-view sticky state — see renderState below for why.  ORGAN's tune
// tick lives inside [F8CB, F967) on Robotron but the sample-output loop
// ORGAN1/ORGANL is outside; without sticky-hold the pane flickers at the
// snapshot rate during tune playback.
let activeEngineSticky = "";
let activeEngineLastSeenMs = 0;

// The three Pattern-1 panels (Ear / Eye / Code) plus the Stage swimlane
// (Step 3.4 / Pattern adjacent).  Instantiated once at module load; each
// consumes the same snapshot stream.
const eyePanel = new EyePanel(els.eyeCanvas);
const codePanel = new CodePanel(els.codePanel);
const swimlane = new StageSwimlane(els.swimlaneCanvas, labelMap, currentGame);
const variView = new VARIView(els.variCanvas);
const wavetableView = new WavetableView(els.wavetableCanvas);
const screamView = new SCREAMView(els.screamCanvas);
const organView = new ORGANView(els.organCanvas);
const fnoiseView = new FNOISEView(els.fnoiseCanvas);
const ramHeatmap = new RAMHeatmap(els.ramHeatmapCanvas);
const explainerCard = new ExplainerCardPanel({ container: els.explainerCard });
const quizPanel = new QuizPanel({
  container: els.quizPanel,
  getGlossary: () => glossary,
  switchGame: switchToGame,
  currentGame,
  // The quiz fires sounds without auto-loading the explainer card (which
  // would reveal the answer).  We still reset the engine views so they
  // don't carry stale state into the new question; the user clicks the
  // reveal button afterwards to load the card explicitly.
  fireRaw: (cmd) => {
    if (!host) return;
    resetEnginePanels();
    host.fire(cmd);
  },
  loadExplainer: (cmd, _game) => loadExplainerForCmd(cmd),
});
const panels: VizPanel[] = [
  new EarPanel(els.earCanvas),
  eyePanel,
  codePanel,
  swimlane,
  variView,
  wavetableView,
  screamView,
  organView,
  fnoiseView,
  ramHeatmap,
];

// Pattern 8 (Step 4.5) — client-side PC-by-cycle cache.  Each snapshot's
// `recentDacEvents` is a ~250 ms window; we accumulate the new edge events
// here so a hover anywhere on the spectrogram (potentially several seconds
// of history) can still resolve to "which routine produced that sample".
// Indexed binary-search by cycle.  Bounded so a long session doesn't grow
// without limit — older entries are dropped LRU-style.
const pcHistory = { cycles: [] as number[], pcs: [] as number[] };
const PC_HISTORY_CAP = 60_000; // ≈ 60 s at LITE density / ≈ 6 s at Robotron density

function mergeDacEventsIntoPcHistory(
  ev: { cycles: Float64Array; pcs: Uint16Array; count: number },
): void {
  if (ev.count === 0) return;
  const lastCycle = pcHistory.cycles.length
    ? pcHistory.cycles[pcHistory.cycles.length - 1]!
    : -1;
  for (let i = 0; i < ev.count; i++) {
    const c = ev.cycles[i]!;
    if (c <= lastCycle) continue; // already cached
    pcHistory.cycles.push(c);
    pcHistory.pcs.push(ev.pcs[i]!);
  }
  // Cap to PC_HISTORY_CAP newest entries.
  const overflow = pcHistory.cycles.length - PC_HISTORY_CAP;
  if (overflow > 0) {
    pcHistory.cycles.splice(0, overflow);
    pcHistory.pcs.splice(0, overflow);
  }
}

function pcAtCycle(cycle: number): number | undefined {
  if (pcHistory.cycles.length === 0) return undefined;
  if (cycle < pcHistory.cycles[0]!) return undefined;
  let lo = 0;
  let hi = pcHistory.cycles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (pcHistory.cycles[mid]! <= cycle) lo = mid;
    else hi = mid - 1;
  }
  return pcHistory.pcs[lo];
}

function clearPcHistory(): void {
  pcHistory.cycles.length = 0;
  pcHistory.pcs.length = 0;
}

// Pattern 8 — hover sources publish to a single sink that pushes into the
// Code panel; mouseleave clears.
function publishInspect(source: string, cycle: number): void {
  const pc = pcAtCycle(cycle);
  codePanel.setInspectCursor({ cycle, pc, source });
}
function clearInspect(): void {
  codePanel.setInspectCursor(null);
}

// Spectrogram — independent rAF loop; reads the AnalyserNode each frame.
// Mounted at module load; the analyser getter returns undefined until the
// worklet is initialised, at which point columns start appearing.  Pattern 8
// hooks publish historical cycle on hover, using the live cpu-cycle getter
// to time-stamp each column.
const spectrogram = new Spectrogram();
spectrogram.mount(els.spectroCanvas, () => host?.getAnalyser(), {
  getCycle: () => lastSnapshot?.cycles ?? 0,
  hooks: {
    onCycleHover: (c) => publishInspect("spectrogram", c),
    onCycleLeave: () => clearInspect(),
  },
});
eyePanel.setHoverHooks({
  onCycleHover: (c) => publishInspect("byte tape", c),
  onCycleLeave: () => clearInspect(),
});

function renderState(s: StateSnapshot): void {
  // Cache for the spectrogram's getCycle() callback (declared above the
  // spectrogram.mount() call so the closure captures something defined).
  lastSnapshot = s;
  // Pattern 8 — accumulate fresh PC events into the client-side cache so
  // hover lookups can resolve historical cycles outside the current snapshot
  // window.  When the recording is cleared (Reset), drop the cache too.
  if (s.recorded.size === 0 && pcHistory.cycles.length > 0) clearPcHistory();
  mergeDacEventsIntoPcHistory(s.recentDacEvents);
  for (const p of panels) p.update(s);
  syncParamRowsFromSnapshot(s);
  // Engine view single-panel dispatch — show only the active engine's pane.
  // Priority order matches the at-most-one-slot-populated guarantee from
  // engineStateForPc().  An empty data-active falls back to the idle caption.
  //
  // Sticky-hold: the slot is populated only while PC is inside the engine's
  // address range; during normal playback the CPU constantly hops in and
  // out (e.g. ORGAN tune-tick code runs at F8CB-F967 but the sample-output
  // loop ORGAN1/ORGANL lives outside that range), which would otherwise
  // flicker the pane between "ORGAN" and "(idle)" at the snapshot rate.
  // Hold the last non-idle engine for HOLD_MS after the slot last appeared.
  const currentEngine =
    s.scream ? "scream" :
    s.organ ? "organ" :
    s.gwave ? "gwave" :
    s.fnoise ? "fnoise" :
    s.vari ? "vari" : "";
  const HOLD_MS = 500;
  const now = performance.now();
  if (currentEngine) {
    activeEngineSticky = currentEngine;
    activeEngineLastSeenMs = now;
  } else if (activeEngineSticky && now - activeEngineLastSeenMs > HOLD_MS) {
    activeEngineSticky = "";
  }
  // LFSR (LITE) doesn't have a canvas pane — its slot surfaces as a textual
  // line in the Code panel instead.
  if (els.engineStack.dataset.active !== activeEngineSticky) {
    els.engineStack.dataset.active = activeEngineSticky;
  }

  // Effective range used by the scrubber UI = the DAC range the ring still
  // holds.  The ring is finite and evicts oldest-first, so on long recordings
  // `oldestCycle` advances past early segments whose sample data is gone.  We
  // clip the segment list to the live range: phantom (evicted) segments are
  // dropped and a straddler's start is clamped up to `oldestCycle`.  That also
  // keeps the first marker visible — it now sits exactly at the slider's left
  // edge — replacing the old "extend left to the fire cycle" workaround, which
  // stranded the thumb mid-track once the ring wrapped.
  recordedOldest = s.recorded.oldestCycle;
  recordedNewest = s.recorded.newestCycle;
  knownSegments = clipSegmentsToRange(s.segments, recordedOldest, recordedNewest);
  scrubbing = s.scrubbing;
  applyScrubUiState();
  updateScrubReadout(s);
  updateVolumeMeter(s);
  renderScrubMarkers(s);
  // Reflect worklet's loop mode in the button label if it diverges.
  if (s.scrubLoopMode !== loopMode) setLoopModeUI(s.scrubLoopMode);
}

// dB-scaled level meter.  Map -60..0 dB → 0..100% bar width; below -60 dB
// reads as silent.  Bar = RMS, marker = held peak.  Both measured on the
// *post-volume* signal so the meter reflects what the speaker actually
// gets, not what the worklet generated upstream of the gain node.
//
// Both meters use a "fast attack, slow release, never below current
// signal" filter: snap up immediately on a louder sample, then decay
// toward the current rms/peak, but never decay *below* it.  That makes
// a steady signal display its true level steadily instead of oscillating
// between the snap-up value and a decayed-by-N value.
let meterRmsDb = -Infinity;
let meterPeakDb = -Infinity;

const METER_DB_FLOOR = -60;
/** RMS release rate — dB drop per snapshot (~100 ms apart). */
const METER_RMS_RELEASE = 3;
/** Peak release rate — much slower, so transients hold long enough to read. */
const METER_PEAK_RELEASE = 0.75;

function dbToPct(db: number): number {
  if (!isFinite(db)) return 0;
  const t = (db - METER_DB_FLOOR) / -METER_DB_FLOOR;
  return Math.max(0, Math.min(100, t * 100));
}

/** Fast-attack, slow-release filter that never drops below `signalDb`. */
function meterTrack(currentDb: number, signalDb: number, releaseDb: number): number {
  if (!isFinite(signalDb)) {
    // Signal is silent: decay the meter toward the floor.
    if (!isFinite(currentDb)) return -Infinity;
    const next = currentDb - releaseDb;
    return next <= METER_DB_FLOOR ? -Infinity : next;
  }
  if (!isFinite(currentDb) || signalDb >= currentDb) return signalDb;
  // Decay, but clamp so we never read lower than the actual signal level.
  return Math.max(signalDb, currentDb - releaseDb);
}

function updateVolumeMeter(s: StateSnapshot): void {
  const samples = s.lastSamples;
  if (!samples || samples.length === 0) return;

  const volume = host ? host.getVolume() : 1;
  // Compute AC-coupled RMS — i.e. the RMS of the signal with the DC bias
  // subtracted.  A held constant DC level produces no audible sound (the
  // speaker only responds to changes), so a level meter that ignores DC
  // matches what your ear hears.  Also makes the meter actually move:
  // LITE oscillates ±1 with mean ≈ 0 → AC RMS ≈ 0.7; pause holds at a
  // constant DC → AC RMS = 0.  Without this the meter pegs near full all
  // the time because samples sit near ±1 in both cases.
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]! * volume;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sum += v;
  }
  const mean = sum / samples.length;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]! * volume - mean;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);

  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  meterRmsDb = meterTrack(meterRmsDb, rmsDb, METER_RMS_RELEASE);
  meterPeakDb = meterTrack(meterPeakDb, peakDb, METER_PEAK_RELEASE);

  els.volumeMeterRms.style.width = `${dbToPct(meterRmsDb).toFixed(1)}%`;
  els.volumeMeterPeak.style.left = `${dbToPct(meterPeakDb).toFixed(1)}%`;
  els.meterReadout.textContent = isFinite(meterRmsDb)
    ? `RMS ${meterRmsDb.toFixed(0)} · pk ${isFinite(meterPeakDb) ? meterPeakDb.toFixed(0) : "−∞"} dB`
    : "silent";
}

const CPU_RATE_HZ = 894_886;

/** "compact" skips inter-segment silence on the slider; "realtime" is wall-clock. */
type TimelineMode = "compact" | "realtime";
let timelineMode: TimelineMode = "compact";

// Compact-axis math (clipSegmentsToRange / compactDuration / cycle↔offset)
// lives in ./scrubTimeline.ts so it's unit-testable; it takes the newest cycle
// explicitly rather than reading module state.

function cycleToSliderValue(cycle: number): number {
  if (timelineMode === "compact") {
    const total = compactDuration(knownSegments, recordedNewest);
    if (total <= 0) return 0;
    const t = cycleToCompactOffset(cycle, knownSegments, recordedNewest) / total;
    return Math.max(0, Math.min(1000, Math.round(t * 1000)));
  }
  if (recordedNewest <= recordedOldest) return 1000;
  const t = (cycle - recordedOldest) / (recordedNewest - recordedOldest);
  return Math.max(0, Math.min(1000, Math.round(t * 1000)));
}

function sliderValueToCycle(value: number): number {
  if (timelineMode === "compact") {
    const total = compactDuration(knownSegments, recordedNewest);
    if (total <= 0) return recordedNewest;
    const t = Math.max(0, Math.min(1000, value)) / 1000;
    return compactOffsetToCycle(t * total, knownSegments, recordedNewest);
  }
  if (recordedNewest <= recordedOldest) return recordedNewest;
  const t = Math.max(0, Math.min(1000, value)) / 1000;
  return Math.round(recordedOldest + t * (recordedNewest - recordedOldest));
}

function updateScrubReadout(s: StateSnapshot): void {
  if (s.recorded.size === 0) {
    els.scrubReadout.textContent = "no recording yet";
    return;
  }
  if (s.scrubbing) {
    // Report position in whichever axis the slider uses (compact = sound-only,
    // realtime = wall-clock) so the left edge reads 0.0 ms in both modes.
    const { posMs, totalMs } = scrubReadout(
      timelineMode, s.scrubCycle, knownSegments, recordedOldest, recordedNewest, CPU_RATE_HZ,
    );
    els.scrubReadout.textContent =
      `${posMs.toFixed(1)} / ${totalMs.toFixed(1)} ms · ${s.scrubSpeed.toFixed(2)}×`;
    els.scrubPos.value = String(cycleToSliderValue(s.scrubCycle));
  } else {
    const totalMs = ((s.recorded.newestCycle - s.recorded.oldestCycle) / CPU_RATE_HZ) * 1000;
    els.scrubReadout.textContent =
      `${totalMs.toFixed(1)} ms recorded · ${s.recorded.size.toLocaleString()} events`;
    els.scrubPos.value = "1000"; // park at newest
  }
}

let pollHandle: number | undefined;

function startPolling(): void {
  // Refresh state ~10 Hz so the CPU readout and the scrub readout move
  // continuously during live playback / scrub.  Snapshot is O(1) on the
  // worklet side, so this stays cheap.
  if (pollHandle !== undefined) return;
  pollHandle = window.setInterval(() => {
    if (host) host.requestSnapshot();
  }, 100);
}

function stopPolling(): void {
  if (pollHandle !== undefined) {
    window.clearInterval(pollHandle);
    pollHandle = undefined;
  }
}

async function initialise(game: GameKind): Promise<void> {
  if (host) return;
  log(`Initialising worklet for ${game}…`);
  host = new WilliamsSoundHost({
    workletUrl: `${import.meta.env.BASE_URL}williams-sound-explorer-worklet.js`,
    romBaseUrl: `${import.meta.env.BASE_URL}roms`,
    sampleRate: 48000,
    onState: renderState,
  });
  await host.init(game);
  // AudioContext.resume() needs a user gesture in most browsers.  If we're
  // auto-initialising on page load the context will stay suspended until
  // the first interaction.  We attempt to resume now (succeeds on Chrome
  // dev mode, may stay suspended elsewhere) AND register a one-shot
  // listener that resumes on any subsequent user gesture.
  try {
    await host.resume();
  } catch {
    // Browser refused — caught by the first-user-gesture handler below.
  }
  setReady(true);
  // Replay any toggles the user clicked before Init — buildEngineToggleRow
  // stashes them in toggleState since host.setEngineToggle() throws when
  // the worklet isn't yet ready.
  applyToggleStateToHost();
  replayParamOverrides();
  host.requestSnapshot();
  startPolling();
  log(`Ready. AudioContext rate = ${48000} Hz.`, "ok");
}

/**
 * Switch to `game`: dispose the current runner (if any) and re-init.
 * Idempotent — clicking the active game does nothing.  Visible UI feedback
 * happens via `refreshGameSwitcherUi()`.
 */
async function switchToGame(game: GameKind): Promise<void> {
  if (loadingGame !== null) return;
  if (host !== undefined && game === selectedGame) return;
  // Can't init a game with no stored ROM — send the user to upload it instead.
  if (!availableGames.has(game)) { showOnboarding(game); return; }
  loadingGame = game;
  refreshGameSwitcherUi();
  try {
    if (host) {
      stopPolling();
      await host.dispose();
      host = undefined;
      setPaused(false);
      scrubbing = false;
    }
    selectedGame = game;
    await initialise(game);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Switch to ${game} failed: ${msg}`, "err");
  } finally {
    loadingGame = null;
    refreshGameSwitcherUi();
    // Make sure tooltips / cmdInfo / glossary chips reflect the new game.
    refreshCmdInfo();
    refreshChipTooltips();
    // Replay any forced parameter overrides at the new game's addresses
    // (per-game zero-page layouts differ — Robotron's LOPER is $12, not $13).
    replayParamOverrides();
  }
}

function replayParamOverrides(): void {
  if (!host) return;
  for (const r of paramRows) {
    if (r.force.checked) {
      host.setParamOverride(addrForRow(r.row), Number.parseInt(r.slider.value, 10));
    }
  }
}

for (const btn of gamePickButtons) {
  btn.addEventListener("click", () => {
    const game = btn.dataset.game as GameKind;
    if (availableGames.has(game)) void switchToGame(game);
    else showOnboarding(game); // locked → upload its ROM
  });
}

// Re-evaluate availability whenever the ROM store changes (upload / remove).
window.addEventListener("rom-store-changed", () => { void onRomStoreChanged(); });
async function onRomStoreChanged(): Promise<void> {
  // Drop cached ROM bytes so a replaced/removed ROM isn't served stale.
  exportRomCache.clear();
  abDiff.clearRomCache();
  await refreshAvailability();
  // If the active game's ROM was removed, move to another available game, or
  // back to onboarding if none remain.
  if (host && !availableGames.has(selectedGame)) {
    const next = [...availableGames][0];
    if (next) await switchToGame(next);
    else showOnboarding();
  }
}

// Called by the onboarding "Enter the explorer" button.
async function enterFromOnboarding(): Promise<void> {
  await refreshAvailability();
  if (availableGames.size === 0) return; // button is disabled in this case
  hideOnboarding();
  if (!host) {
    const target = availableGames.has("defender") ? "defender" : [...availableGames][0]!;
    await switchToGame(target);
  }
}

// On first user gesture, force-resume the AudioContext.  Most browsers
// suspend the context until interaction; we attach this once at startup
// (rather than per-button) and let it self-remove after one shot.
const resumeOnFirstGesture = (): void => {
  if (host) {
    host.resume().catch(() => { /* already running, no-op */ });
  }
  window.removeEventListener("pointerdown", resumeOnFirstGesture);
  window.removeEventListener("keydown", resumeOnFirstGesture);
};
window.addEventListener("pointerdown", resumeOnFirstGesture);
window.addEventListener("keydown", resumeOnFirstGesture);

// Seed the store from the gitignored `/roms` dev fallback so a developer with
// local ROMs gets a one-click experience (no onboarding).  No-op in a clean
// publish where `/roms` is empty.
async function seedDevFallbacks(): Promise<void> {
  for (const g of ALL_GAMES) {
    if (!(await hasRom(g))) {
      try { await loadRomBytes(g); } catch { /* no dev fallback for this game */ }
    }
  }
}

// Boot: the app needs user-supplied ROMs.  If none are present, show the
// onboarding overlay; otherwise auto-init the first available game (preferring
// Defender).  Module scripts run after DOM parsing; we still defer one tick so
// the rest of this file's top-level wiring finishes, with a DOMContentLoaded
// fallback in case the module is hosted weirdly.
async function autoInit(): Promise<void> {
  mountOnboarding({ onEnter: () => { void enterFromOnboarding(); } });
  await seedDevFallbacks();
  await refreshAvailability();
  if (availableGames.size === 0) {
    log("No ROMs stored — showing onboarding.");
    showOnboarding();
    return;
  }
  selectedGame = availableGames.has("defender") ? "defender" : [...availableGames][0]!;
  log(`Auto-init: ${selectedGame}…`);
  await switchToGame(selectedGame);
}
function bootAutoInit(): void {
  autoInit().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-init failed: ${msg}`, "err");
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootAutoInit, { once: true });
} else {
  queueMicrotask(bootAutoInit);
}

function parseCmd(): number | undefined {
  const raw = els.cmd.value.trim();
  const cmd = Number.parseInt(raw, 16);
  if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) {
    log(`Invalid command "${raw}" (expected 0..3F hex)`, "err");
    return undefined;
  }
  return cmd;
}

els.fire.addEventListener("click", () => {
  if (!host) return;
  const cmd = parseCmd();
  if (cmd === undefined) return;
  fireUserCmd(cmd);
});

els.firePaused.addEventListener("click", () => {
  if (!host) return;
  const cmd = parseCmd();
  if (cmd === undefined) return;
  // Pause first so the CPU stops at the BRA-self idle with the new CA1
  // IRQ flag latched but not yet serviced.  The first Step ▸ then takes
  // the IRQ vector and lands at the handler entry — ideal for tracing a
  // sound from instruction zero.
  //
  // Note: ORGANT's auto-pulse fires the follow-up 40 ms later, but with
  // the CPU paused that follow-up just queues up at the PIA until the user
  // single-steps through to ORGANT — at which point the tune kicks in
  // naturally on the next IRQ.  Stepping the CPU instruction-by-instruction
  // through "arm + kick" is genuinely the easiest way to see how it works.
  host.pause();
  setPaused(true);
  fireUserCmd(cmd);
  log("(paused — Step ▸ through the IRQ to see the dispatch + arm flag.)");
});

els.pause.addEventListener("click", () => {
  if (!host) return;
  if (paused) {
    host.unpause();
    setPaused(false);
    log("Resumed.");
  } else {
    host.pause();
    setPaused(true);
    log("Paused (CPU frozen).");
  }
});

els.step.addEventListener("click", () => {
  if (!host || !paused) return;
  host.step();
});

els.stepDac.addEventListener("click", () => {
  if (!host || !paused) return;
  host.stepToDac();
});

els.stepIrq.addEventListener("click", () => {
  if (!host || !paused) return;
  host.stepToIrq();
});

function applySpeed(v: number): void {
  // Clamp to the previous slider's range so the readout stays bounded; the
  // four preset buttons cover the useful speeds (1× / ¼× / ¹⁄₁₀× / ¹⁄₁₀₀×).
  const clamped = Math.min(2, Math.max(0.01, v));
  els.speedReadout.textContent = `${clamped.toFixed(2)}×`;
  host?.setSpeed(clamped);
}

els.volume.addEventListener("input", () => {
  const v = Math.max(0, Math.min(1, Number.parseFloat(els.volume.value)));
  els.volumeReadout.textContent = `${Math.round(v * 100)}%`;
  if (host) host.setVolume(v);
});

document.querySelectorAll<HTMLButtonElement>(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = Number.parseFloat(btn.dataset.speed ?? "1");
    applySpeed(v);
    log(`Speed → ${v}× (${btn.textContent?.trim()})`);
  });
});

// (Chip click handlers are attached inside `refreshChipTooltips()` as each
// chip is built — the static querySelectorAll over button.chip is no longer
// needed since the chips are recreated on every glossary load / game switch.)

els.scrubStart.addEventListener("click", () => {
  if (!host) return;
  if (recordedNewest <= recordedOldest) {
    log("Nothing recorded yet — fire a sound first.", "err");
    return;
  }
  // Start with the head FROZEN (speed 0) so the user can navigate first
  // — click a marker or drag the slider — without the head running away
  // out from under their cursor.  Press ⏩ or ⏪ to play.
  host.startScrub(recordedOldest, 0);
  scrubbing = true;
  currentScrubSpeed = 0;
  els.scrubPlay.textContent = "▶";
  applyScrubUiState();
  log("Scrub mode — drag slider or click a marker; ⏩ to play, ⏪ to reverse.");
});

els.scrubLive.addEventListener("click", () => {
  if (!host) return;
  host.exitScrub({ resume: true });
  scrubbing = false;
  applyScrubUiState();
  log("Live mode — CPU running.");
});

els.scrubReset.addEventListener("click", () => {
  if (!host) return;
  host.resetRecording();
  // resetRecording also un-pauses the CPU + exits scrub, so reflect that
  // in the UI immediately (don't wait for the next snapshot).
  if (scrubbing) {
    scrubbing = false;
    applyScrubUiState();
  }
  if (paused) setPaused(false);
  recordedOldest = 0;
  recordedNewest = 0;
  knownSegments = [];
  els.scrubMarkers.innerHTML = "";
  els.scrubReadout.textContent = "no recording yet";
  log("Recording cleared.");
});

function setTimelineMode(mode: TimelineMode): void {
  timelineMode = mode;
  els.scrubMode.textContent = mode === "compact" ? "📍 Compact" : "📍 Real-time";
  els.scrubMode.title = mode === "compact"
    ? "Slider skips silence between sounds. Click for real-time (wall-clock) mode."
    : "Slider tracks wall-clock cycles, including silence. Click for compact mode.";
}

els.scrubMode.addEventListener("click", () => {
  setTimelineMode(timelineMode === "compact" ? "realtime" : "compact");
  log(`Timeline → ${timelineMode}`);
});

els.scrubPos.addEventListener("input", () => {
  if (!host || !scrubbing) return;
  const cycle = sliderValueToCycle(Number.parseInt(els.scrubPos.value, 10));
  host.setScrubPosition(cycle);
});

const LOOP_CYCLE: Record<ScrubLoopMode, ScrubLoopMode> = {
  none: "range",
  range: "segment",
  segment: "none",
};
els.scrubLoop.addEventListener("click", () => {
  if (!host) return;
  const next = LOOP_CYCLE[loopMode];
  host.setScrubLoop(next);
  setLoopModeUI(next);
  log(`Scrub loop → ${next}`);
});

// Marker click → jump to that segment's start and switch loop to "segment"
// for quick "study this sound on repeat" UX.
els.scrubMarkers.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (!target || !target.classList.contains("scrub-marker")) return;
  if (!host || !scrubbing) return;
  const idx = Number.parseInt(target.dataset.segmentIndex ?? "-1", 10);
  const seg = knownSegments[idx];
  if (!seg) return;
  host.setScrubPosition(seg.startCycle);
  host.setScrubLoop("segment");
  setLoopModeUI("segment");
  log(`Jumped to segment $${seg.cmd.toString(16).padStart(2, "0").toUpperCase()} + segment-loop`);
});

document.querySelectorAll<HTMLButtonElement>("button.scrub-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!host || !scrubbing) return;
    const speed = Number.parseFloat(btn.dataset.scrubSpeed ?? "1");
    setScrubSpeed(speed);
    log(`Scrub speed → ${speed}×`);
  });
});

els.scrubPlay.addEventListener("click", () => {
  if (!host || !scrubbing) return;
  setScrubSpeed(currentScrubSpeed === 0 ? lastNonZeroScrubSpeed : 0);
});

els.cmd.addEventListener("input", refreshCmdInfo);
// Game-switch refresh of glossary tooltips is handled in switchToGame()'s
// `finally` block, since the new game-switcher buttons bypass <select>.

loadGlossary().then((g) => {
  glossary = g;
  refreshCmdInfo();
  refreshChipTooltips();
  renderTermList();
  annotateTermLinks(); // hover-tooltip every static term-link + glossary chip
  quizPanel.refresh();
  const sounds = (["defender", "stargate", "robotron"] as const).reduce(
    (n, k) => n + Object.keys(g[k]).length,
    0,
  );
  const terms = Object.keys(g.terms ?? {}).length;
  log(`Loaded glossary — ${sounds} sound entries + ${terms} engine terms.`, "ok");
});

loadLabelMaps().then((m) => {
  labelMap = m;
  swimlane.setLabelMap(m);
  eyePanel.setLabelMap(m, currentGame);
  codePanel.setLabelMap(m, currentGame);
  const total = m.defender.length + m.stargate.length + m.robotron.length;
  log(`Loaded label maps — ${total} routines across 3 ROMs.`, "ok");
});

loadZeroPageMaps().then((m) => {
  ramHeatmap.setZeroPageMap(m, currentGame);
});

// Build the Pattern 3 engine-toggle row.  Each checkbox forwards to the host
// (which only accepts toggle messages after init); we cache state locally so
// the checkbox UI reflects what the user clicked even before the host exists,
// and we replay on init.
const toggleState: Partial<Record<EngineToggleKey, boolean>> = {};

/**
 * Pattern-4 voice-mute setup, parameterised per engine (SCREAM 4 voices /
 * ORGAN 8 OSCIL bits).  Each engine's sequencer shares the same UI shape:
 * checkboxes per voice + Build-up/Tear-down/Stop buttons.  Build-up fires
 * the sound with all voices muted and unmutes one at a time; Tear-down
 * fires with all on and mutes one at a time; Stop cancels and restores.
 */
interface VoiceMuteEngine {
  /** Engine identifier — used in log lines + .running-class tracking. */
  name: string;
  /** Toggle keys in voice-index order. */
  keys: readonly EngineToggleKey[];
  /** Checkbox elements indexed by voice. */
  checkboxes: HTMLInputElement[];
  /** Build-up / Tear-down / Stop button references. */
  buildUp: HTMLButtonElement;
  tearDown: HTMLButtonElement;
  stop: HTMLButtonElement;
  /** Selector to find the checkboxes in the DOM. */
  cbSelector: string;
  /** Data-attribute name on each checkbox carrying the voice index. */
  cbDatasetKey: string;
  /** Fires the engine's sound (host already verified non-null). */
  fire: () => Promise<void>;
}

function setVoiceMute(engine: VoiceMuteEngine, voice: number, value: boolean): void {
  const key = engine.keys[voice];
  if (!key) return;
  toggleState[key] = value;
  const cb = engine.checkboxes[voice];
  if (cb) {
    cb.checked = value;
    (cb.closest(".voice-toggle") as HTMLElement | null)?.classList.toggle("active", value);
  }
  try { host?.setEngineToggle(key, value); } catch { /* not yet ready */ }
}

function buildEngineToggleRow(): void {
  // SCREAM + ORGAN voice mutes get their own UI inside their engine pane.
  const voiceMuteSet: Set<EngineToggleKey> = new Set([
    ...SCREAM_VOICE_TOGGLE_KEYS,
    ...ORGAN_VOICE_TOGGLE_KEYS,
  ]);
  for (const key of ENGINE_TOGGLE_KEYS) {
    if (voiceMuteSet.has(key)) continue;
    const meta = ENGINE_TOGGLE_META[key];
    const label = document.createElement("label");
    label.className = "engine-toggle";
    label.title = meta.tooltip;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.toggleKey = key;
    cb.addEventListener("change", () => {
      toggleState[key] = cb.checked;
      label.classList.toggle("active", cb.checked);
      try {
        host?.setEngineToggle(key, cb.checked);
      } catch {
        // Host not yet initialised — state is stashed in toggleState and
        // replayed by applyToggleStateToHost() after Init.
      }
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(meta.label));
    els.engineToggleRow.appendChild(label);
  }
}

function buildVoiceUi(engine: VoiceMuteEngine): void {
  engine.checkboxes.length = 0;
  const cbs = Array.from(document.querySelectorAll<HTMLInputElement>(engine.cbSelector));
  for (const cb of cbs) {
    const voice = Number.parseInt(cb.dataset[engine.cbDatasetKey] ?? "-1", 10);
    if (voice < 0 || voice >= engine.keys.length) continue;
    engine.checkboxes[voice] = cb;
    // Tooltip from the shared meta so the static checkboxes explain themselves
    // (and never drift from the freeze-row text).  Set on the wrapping label
    // so hovering the "v0" / "b0" caption shows it too.
    const tip = ENGINE_TOGGLE_META[engine.keys[voice]!]!.tooltip;
    (cb.closest<HTMLElement>(".voice-toggle") ?? cb).title = tip;
    cb.title = tip;
    cb.addEventListener("change", () => setVoiceMute(engine, voice, cb.checked));
  }
}
function applyToggleStateToHost(): void {
  if (!host) return;
  for (const key of ENGINE_TOGGLE_KEYS) {
    const v = toggleState[key];
    if (v !== undefined) host.setEngineToggle(key, v);
  }
}
buildEngineToggleRow();

const SCREAM_ENGINE: VoiceMuteEngine = {
  name: "SCREAM",
  keys: SCREAM_VOICE_TOGGLE_KEYS,
  checkboxes: [],
  buildUp: els.screamBuildUp,
  tearDown: els.screamTearDown,
  stop: els.screamSeqStop,
  cbSelector: ".voice-cb",
  cbDatasetKey: "voice",
  fire: async () => { await fireSequence([0x1A]); },
};
const ORGAN_ENGINE: VoiceMuteEngine = {
  name: "ORGAN",
  keys: ORGAN_VOICE_TOGGLE_KEYS,
  checkboxes: [],
  buildUp: els.organBuildUp,
  tearDown: els.organTearDown,
  stop: els.organSeqStop,
  cbSelector: ".organ-voice-cb",
  cbDatasetKey: "bit",
  // ORGAN's "play me now" sequence is $1B (arm ORGFLG) + $02 (tune 2 —
  // NINTH/Beethoven on Stargate & Robotron, TACCATA on Defender; both exercise
  // the OSCIL voices the mutes act on).  ORGNT1 runs inside the IRQ that
  // services the second pulse — see MANUAL.md "Why $1B is special".
  fire: async () => { await fireSequence([0x1B, 0x02]); },
};
buildVoiceUi(SCREAM_ENGINE);
buildVoiceUi(ORGAN_ENGINE);

// Pattern 4 / Step 6.1 — Build-up / Tear-down sequencer.  Generic over
// engine config; only one sequence can be in flight at a time (subsequent
// clicks cancel the running one).
const VOICE_SEQ_STEP_MS = 700;
let voiceSeqTimer: number | undefined;
let voiceSeqRunning = false;
let voiceSeqEngine: VoiceMuteEngine | undefined;

function setSeqRunning(engine: VoiceMuteEngine | undefined, activeBtn?: HTMLButtonElement): void {
  voiceSeqRunning = engine !== undefined;
  voiceSeqEngine = engine;
  for (const e of [SCREAM_ENGINE, ORGAN_ENGINE]) {
    e.buildUp.classList.toggle("running", voiceSeqRunning && activeBtn === e.buildUp);
    e.tearDown.classList.toggle("running", voiceSeqRunning && activeBtn === e.tearDown);
    e.stop.disabled = !(voiceSeqRunning && voiceSeqEngine === e);
  }
}

function cancelVoiceSequence(): void {
  if (voiceSeqTimer !== undefined) {
    window.clearTimeout(voiceSeqTimer);
    voiceSeqTimer = undefined;
  }
  setSeqRunning(undefined);
}

function setAllMuted(engine: VoiceMuteEngine, muted: boolean): void {
  for (let v = 0; v < engine.keys.length; v++) setVoiceMute(engine, v, muted);
}

async function runVoiceSequence(engine: VoiceMuteEngine, direction: "build" | "tear"): Promise<void> {
  cancelVoiceSequence();
  // SCREAM + ORGAN play on all three games, so the sequencer runs on whichever
  // game is currently loaded — no forced switch to Robotron.
  if (!host) return;
  setAllMuted(engine, direction === "build");
  // Brief settle for the toggle messages to land before the fire.
  await new Promise((r) => setTimeout(r, 50));
  await engine.fire();
  log(`${direction === "build" ? "Build-up" : "Tear-down"} sequence — ${engine.name} firing…`);
  setSeqRunning(engine, direction === "build" ? engine.buildUp : engine.tearDown);
  const n = engine.keys.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(direction === "build" ? i : n - 1 - i);
  let step = 0;
  const advance = (): void => {
    if (!voiceSeqRunning || voiceSeqEngine !== engine) return;
    if (step >= order.length) {
      log(`${direction === "build" ? "Build-up" : "Tear-down"} sequence complete.`);
      setSeqRunning(undefined);
      return;
    }
    const v = order[step]!;
    setVoiceMute(engine, v, direction === "tear");
    log(`${direction === "build" ? "+" : "−"}${engine.name === "ORGAN" ? "b" : "v"}${v}`);
    step++;
    voiceSeqTimer = window.setTimeout(advance, VOICE_SEQ_STEP_MS);
  };
  voiceSeqTimer = window.setTimeout(advance, VOICE_SEQ_STEP_MS);
}

function wireEngineButtons(engine: VoiceMuteEngine): void {
  engine.buildUp.addEventListener("click", () => { void runVoiceSequence(engine, "build"); });
  engine.tearDown.addEventListener("click", () => { void runVoiceSequence(engine, "tear"); });
  engine.stop.addEventListener("click", () => {
    cancelVoiceSequence();
    setAllMuted(engine, false);
    log(`${engine.name} sequence cancelled; all voices restored.`);
  });
}
wireEngineButtons(SCREAM_ENGINE);
wireEngineButtons(ORGAN_ENGINE);

// Pattern 5 / Step 6.2 — parameter sliders.  Each `.param-row` carries
// per-game address attributes (data-addr-{game}); on game switch the
// addresses re-resolve and the force-checkbox state is replayed against
// the new game's cells.  Sliders track live RAM when force is off; when
// force flips on, the slider's value is pushed as a paramOverride and the
// row turns yellow.
type VariKey = "loper" | "hiper" | "locnt" | "hicnt" | "lodt" | "hidt" | "lomod" | "hien";
interface ParamRow {
  row: HTMLElement;
  slider: HTMLInputElement;
  value: HTMLElement;
  force: HTMLInputElement;
  /** Engine slot field this row mirrors when force is off; undefined = no live mirror. */
  ramKey: VariKey | undefined;
}
const VARI_RAM_KEYS: Record<string, VariKey> = {
  LOPER: "loper",
  HIPER: "hiper",
};
const paramRows: ParamRow[] = [];

function addrForRow(row: HTMLElement): number {
  const g = currentGame();
  const raw = row.dataset[`addr${g[0]!.toUpperCase()}${g.slice(1)}` as `addr${string}`]
    ?? row.dataset.addrDefender ?? "0";
  return Number.parseInt(raw, 16);
}

function setupParamRows(): void {
  const rows = Array.from(document.querySelectorAll(".param-row")) as HTMLElement[];
  for (const row of rows) {
    const slider = row.querySelector(".param-slider") as HTMLInputElement;
    const value = row.querySelector(".param-value") as HTMLElement;
    const force = row.querySelector(".param-force-cb") as HTMLInputElement;
    const label = row.querySelector(".param-label") as HTMLElement;
    const cellName = label.textContent?.trim() ?? "";
    const entry: ParamRow = {
      row, slider, value, force,
      ramKey: VARI_RAM_KEYS[cellName],
    };
    paramRows.push(entry);

    // Force toggle: on → set the override to the slider's current value;
    // off → clear the override.
    force.addEventListener("change", () => {
      row.classList.toggle("forced", force.checked);
      if (!host) return;
      if (force.checked) {
        host.setParamOverride(addrForRow(row), Number.parseInt(slider.value, 10));
      } else {
        host.setParamOverride(addrForRow(row), null);
      }
    });

    // Slider drag: only sends if force is on.  Either way the user sees the
    // value display update so they can preview the candidate value.
    slider.addEventListener("input", () => {
      const v = Number.parseInt(slider.value, 10);
      value.textContent = `$${v.toString(16).toUpperCase().padStart(2, "0")}`;
      if (force.checked && host) {
        host.setParamOverride(addrForRow(row), v);
      }
    });
  }
}
setupParamRows();

/** Push live RAM (from the snapshot) into each slider when force is off. */
function syncParamRowsFromSnapshot(s: StateSnapshot): void {
  for (const r of paramRows) {
    if (r.force.checked) continue;
    if (!r.ramKey || !s.vari) continue;
    const live = (s.vari[r.ramKey] as number) & 0xFF;
    if (Number.parseInt(r.slider.value, 10) !== live) {
      r.slider.value = String(live);
      r.value.textContent = `$${live.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
}

// Step 5.3 / 5.4 — A/B diff + Genealogy.  Both mount synchronously; the
// genealogy data is fetched async and renders into the list when ready.
const abDiff = new ABDiff({
  container: els.abCanvas.parentElement as HTMLElement,
  canvas: els.abCanvas,
  summary: els.abSummary,
});
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
els.abRun.addEventListener("click", async () => {
  els.abRun.disabled = true;
  try {
    await abDiff.runAndRender(readPickFromUi("a"), readPickFromUi("b"));
  } catch (e) {
    log(`A/B diff failed: ${(e as Error).message}`, "err");
  } finally {
    els.abRun.disabled = false;
  }
});
loadGenealogy().then((g) => {
  renderGenealogy(els.genealogyList, g, abDiff, writePickToUi);
  if (g.families.length > 0) {
    log(`Loaded sound genealogy — ${g.families.length} families.`, "ok");
  }
});

// Pattern 12 / Step 6.5 — No-explanation toggle.  Adds/removes a body class
// that CSS uses to hide help paragraphs, term-link styling, the cmdInfo
// blurb, the glossary, and the like.  Persisted to localStorage so the
// "show me the data only" preference survives page reloads.
(() => {
  const STORAGE_KEY = "williams-sound-explorer.hide-help";
  const apply = (hide: boolean): void => {
    document.body.classList.toggle("hide-help", hide);
    els.hideHelpToggle.setAttribute("aria-pressed", hide ? "true" : "false");
    els.hideHelpToggle.textContent = hide ? "Show help" : "Hide help";
  };
  apply(localStorage.getItem(STORAGE_KEY) === "1");
  els.hideHelpToggle.addEventListener("click", () => {
    const next = !document.body.classList.contains("hide-help");
    apply(next);
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    log(next
      ? "Hide help: on. Predict the algorithm from the bars + tape + spectrogram."
      : "Hide help: off. Explanatory text restored.");
  });
})();

// Column splitter — drag the divider between the left and right columns to
// resize the page's two-column layout.  The split fraction is persisted in
// localStorage; double-click resets to 50/50.  At <1100 px the splitter
// hides (CSS) and this code is a no-op until the user resizes wider.
(() => {
  const STORAGE_KEY = "williams-sound-explorer.col-split";
  const DEFAULT_FRACTION = 0.5;
  const MIN_FRACTION = 0.22;
  const MAX_FRACTION = 0.78;

  const applyFraction = (fraction: number): void => {
    const clamped = Math.max(MIN_FRACTION, Math.min(MAX_FRACTION, fraction));
    // Use fr-units so the CSS minmax(360px, …) clamps still apply at the
    // far ends of the drag range.  Left = clamped fr, right = (1 - clamped) fr.
    els.pageLayout.style.setProperty(
      "--left-width",
      `${(clamped * 100).toFixed(2)}fr`,
    );
    // Mirror the right side too so the grid template re-evaluates with the
    // new ratio — the third column's minmax(360px, 1fr) becomes
    // minmax(360px, (1 - clamped)fr).
    els.pageLayout.style.setProperty(
      "--right-width",
      `${((1 - clamped) * 100).toFixed(2)}fr`,
    );
  };

  // Restore saved fraction or fall back to 50/50.
  const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  applyFraction(Number.isFinite(saved) ? saved : DEFAULT_FRACTION);

  let dragging = false;
  let activePointerId: number | null = null;

  els.colSplitter.addEventListener("pointerdown", (e: PointerEvent) => {
    dragging = true;
    activePointerId = e.pointerId;
    els.colSplitter.classList.add("dragging");
    els.colSplitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  els.colSplitter.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    const rect = els.pageLayout.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    applyFraction(fraction);
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    els.colSplitter.classList.remove("dragging");
    try { els.colSplitter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Persist the current fraction.  Re-parse from the CSS variable so a
    // mid-drag clamp at MIN/MAX is what gets saved (not the raw mouse pos).
    const raw = els.pageLayout.style.getPropertyValue("--left-width");
    const m = /([\d.]+)fr/.exec(raw);
    if (m) localStorage.setItem(STORAGE_KEY, (Number.parseFloat(m[1]!) / 100).toFixed(4));
  };
  els.colSplitter.addEventListener("pointerup", endDrag);
  els.colSplitter.addEventListener("pointercancel", endDrag);

  // Double-click anywhere on the splitter resets to 50/50.
  els.colSplitter.addEventListener("dblclick", () => {
    applyFraction(DEFAULT_FRACTION);
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_FRACTION));
  });

  // Keyboard accessibility — arrow keys when the splitter has focus.
  els.colSplitter.addEventListener("keydown", (e: KeyboardEvent) => {
    const raw = els.pageLayout.style.getPropertyValue("--left-width");
    const m = /([\d.]+)fr/.exec(raw);
    const current = m ? Number.parseFloat(m[1]!) / 100 : DEFAULT_FRACTION;
    const step = e.shiftKey ? 0.05 : 0.02;
    let next = current;
    if (e.key === "ArrowLeft")  next = current - step;
    else if (e.key === "ArrowRight") next = current + step;
    else if (e.key === "Home")  next = MIN_FRACTION;
    else if (e.key === "End")   next = MAX_FRACTION;
    else if (e.key === " " || e.key === "Enter") next = DEFAULT_FRACTION;
    else return;
    e.preventDefault();
    applyFraction(next);
    localStorage.setItem(STORAGE_KEY, next.toFixed(4));
  });
})();

log("Loaded.");
