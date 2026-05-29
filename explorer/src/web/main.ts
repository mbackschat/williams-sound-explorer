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
} from "../engine/scrubTimeline.ts";
import type { GameKind } from "../board/soundboard.ts";
import { loadGlossary, lookup, type Glossary } from "./glossary.ts";
import { loadLabelMaps, emptyLabelMap, type LabelMap } from "./labelMap.ts";
import { loadZeroPageMaps } from "./zeroPageMap.ts";
import { runSoundWithRom } from "../engine/runner.ts";
import { liveSoundActive } from "../engine/playbackActive.ts";
import { renderDacEvents } from "../synth/DacSampler.ts";
import { applyLpf } from "../synth/lpf.ts";
import { encodeWav } from "../synth/wav.ts";
import { loadRomFromUrl } from "./romFetch.ts";
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
import type { VizPanel } from "../viz/types.ts";
import { els } from "./els.ts";
import { dbToPct, meterTrack, escapeHtml } from "./format.ts";
import { initLayout } from "./ui/layout.ts";
import { initWavExport } from "./ui/wavExport.ts";
import { initABDiff } from "./ui/abdiff.ts";
import { initParamSliders } from "./ui/paramSliders.ts";
import { initEngineToggles } from "./ui/engineToggles.ts";
import { initGlossaryUi } from "./ui/glossaryUi.ts";
import { initKeyboard } from "./ui/keyboard.ts";
import { initModeToggle } from "./ui/modeToggle.ts";
import { ORGAN_TUNES, DEFAULT_ORGAN_TUNE, AUTO_PULSE_GAP_MS } from "./organTunes.ts";
import type { AppContext } from "./appContext.ts";

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
/**
 * Custom-ROM audition state.  When the user clicks "Open in Explore" in Design
 * mode, the Designer pushes the custom ROM image into our worklet via
 * `auditionCustomRom` below; we keep the rebuild closure here so the dynamic
 * "Custom" switcher button can re-load the *current* project state on later
 * clicks (edits made in Design between clicks are picked up).  `customRomActive`
 * tracks which ROM the worklet last loaded — base game (false) or custom (true) —
 * so the switcher UI reflects what's actually playing.
 */
let customAudition: {
  baseGame: GameKind;
  projectName: string;
  slots: { code: number; name: string }[];
  rebuild: () => { rom: Uint8Array; cmd?: number; slots: { code: number; name: string }[] };
} | null = null;
let customRomActive = false;
let customSwitcherBtn: HTMLButtonElement | undefined;
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
    // A base-game button is "active" only when the worklet is actually
    // playing that base game's stock ROM — when we've swapped in a custom
    // ROM the base game's button shows as inactive (the dynamic Custom
    // button is the active one then).
    const isActive = host !== undefined && game === selectedGame && loadingGame === null && !customRomActive;
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
  // Dynamic "Custom" entry — only present once Design mode has pushed an
  // audition (otherwise the switcher is the original three).
  if (customSwitcherBtn && customAudition) {
    const label = `Custom: ${customAudition.projectName || "untitled"}`;
    customSwitcherBtn.textContent = label;
    customSwitcherBtn.classList.toggle("active", customRomActive);
    customSwitcherBtn.classList.toggle("loading", false);
    customSwitcherBtn.disabled = customRomActive || loadingGame !== null;
    customSwitcherBtn.setAttribute("aria-checked", customRomActive ? "true" : "false");
    customSwitcherBtn.title = customRomActive
      ? `${label} — auditioning, running on ${customAudition.baseGame}'s engine`
      : `Re-load this custom ROM into the emulator (built from the current Design-mode project)`;
  }
}

/**
 * Lazily insert the dynamic "Custom" entry into #gameSwitcher.  Created on
 * first audition; persists for the rest of the session so the user can return
 * to the custom ROM after switching to a base game and back.  Click handler
 * re-runs `customAudition.rebuild` so any Design-mode edits made between
 * clicks land in the next audition.
 */
function ensureCustomSwitcherBtn(): void {
  if (customSwitcherBtn) return;
  if (!els.gameSwitcher) return;
  const btn = document.createElement("button");
  btn.className = "game-pick game-pick-custom";
  btn.setAttribute("role", "radio");
  btn.setAttribute("aria-checked", "false");
  btn.addEventListener("click", () => {
    if (!customAudition || !host) return;
    void (async () => {
      const audition = customAudition!;
      const fresh = audition.rebuild();
      if (selectedGame !== audition.baseGame) {
        await switchToGame(audition.baseGame);
        if (!host) return;
      }
      // Pick up Design-mode edits made since the last hand-off: bytes + slots.
      audition.slots = fresh.slots;
      host.loadCustomRom(audition.baseGame, fresh.rom);
      customRomActive = true;
      refreshGameSwitcherUi();
      glossaryUi.refreshChipTooltips();
      if (fresh.cmd !== undefined) {
        els.cmd.value = fresh.cmd.toString(16).toUpperCase().padStart(2, "0");
        glossaryUi.refreshCmdInfo();
        host.fire(fresh.cmd);
      }
    })();
  });
  els.gameSwitcher.appendChild(btn);
  customSwitcherBtn = btn;
}

/** Refresh `availableGames` from the store + dependent UI (switcher). */
async function refreshAvailability(): Promise<void> {
  availableGames = new Set(await listRoms());
  refreshGameSwitcherUi();
}

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
 * `resetIdle?()` is optional on the `VizPanel` interface, so we
 * optional-chain it across the panel list.
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
  paramSliders.syncFromSnapshot(s);
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
  // Non-blocking "sounding now" hint — Fire stays enabled (Space re-fires
  // anytime); it just glows while the live sound is still producing output.
  els.fire.classList.toggle("firing", liveSoundActive(s.segments, s.scrubbing));
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

/** RMS release rate — dB drop per snapshot (~100 ms apart). */
const METER_RMS_RELEASE = 3;
/** Peak release rate — much slower, so transients hold long enough to read. */
const METER_PEAK_RELEASE = 0.75;

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
  // Replay any toggles / forced params the user set before Init — the
  // controllers stash them locally since the host rejects messages until
  // the worklet is ready.
  engineToggles.applyToggleStateToHost();
  paramSliders.replayOverrides();
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
  // Same-game self-click is a no-op UNLESS we're currently auditioning a
  // custom ROM on this base game — in that case the click means "give me
  // back the stock ROM", which needs a full reload.
  if (host !== undefined && game === selectedGame && !customRomActive) return;
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
    // A real base-game switch always lands us on the stock ROM; the custom
    // audition is no longer the active image even if its switcher entry
    // remains for the user to return to.
    customRomActive = false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Switch to ${game} failed: ${msg}`, "err");
  } finally {
    loadingGame = null;
    refreshGameSwitcherUi();
    // Make sure tooltips / cmdInfo / glossary chips reflect the new game.
    glossaryUi.refreshCmdInfo();
    glossaryUi.refreshChipTooltips();
    // Replay any forced parameter overrides at the new game's addresses
    // (per-game zero-page layouts differ — Robotron's LOPER is $12, not $13).
    paramSliders.replayOverrides();
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
  // ROM caches (wavExport, abdiff) self-invalidate via the rom-store-changed event.
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

els.cmd.addEventListener("input", () => glossaryUi.refreshCmdInfo());
// Enter in the cmd box fires the typed command (same as clicking Fire).
els.cmd.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (!host) return;
  const cmd = parseCmd();
  if (cmd === undefined) return;
  fireUserCmd(cmd);
});
// Game-switch refresh of glossary tooltips is handled in switchToGame()'s
// `finally` block, since the new game-switcher buttons bypass <select>.

loadGlossary().then((g) => {
  glossary = g;
  glossaryUi.refreshCmdInfo();
  glossaryUi.refreshChipTooltips();
  glossaryUi.renderTermList();
  glossaryUi.annotateTermLinks(); // hover-tooltip every static term-link + glossary chip
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

/**
 * Audition a custom ROM in Explore's worklet.  Used by Design mode's "Open in
 * Explore" — we land in Explore with the user's custom slot playing and every
 * Explore visualisation pointed at the custom image.  The dynamic "Custom"
 * switcher entry is created on first call and persists for the session, so
 * the user can flip between base game and custom audition freely.
 */
async function auditionCustomRom(spec: {
  baseGame: GameKind;
  rom: Uint8Array;
  cmd?: number;
  projectName: string;
  slots: { code: number; name: string }[];
  rebuild: () => { rom: Uint8Array; cmd?: number; slots: { code: number; name: string }[] };
}): Promise<void> {
  // Need Explore's worklet up; if it isn't (or it's on a different base),
  // route through the existing switch path first.  After this, `host` is the
  // base-game host with the stock ROM loaded — we then overwrite the runner's
  // ROM in place.
  if (!host || selectedGame !== spec.baseGame) {
    await switchToGame(spec.baseGame);
    if (!host) { log("Audition: explore worklet not ready", "err"); return; }
  }
  customAudition = { baseGame: spec.baseGame, projectName: spec.projectName, slots: spec.slots, rebuild: spec.rebuild };
  ensureCustomSwitcherBtn();
  host.loadCustomRom(spec.baseGame, spec.rom);
  customRomActive = true;
  refreshGameSwitcherUi();
  // F3 fix: the "Try:" chip row should reflect the custom item list, not the
  // base game's commands — overlay happens inside refreshChipTooltips().
  glossaryUi.refreshChipTooltips();
  if (spec.cmd !== undefined) {
    // User-requested follow-up: when handing off to Explore, fill #cmd with
    // the auditioned slot's code so the user sees what's playing in the
    // hex input and the cmdInfo readout matches.
    els.cmd.value = spec.cmd.toString(16).toUpperCase().padStart(2, "0");
    glossaryUi.refreshCmdInfo();
    host.fire(spec.cmd);
  }
}

/** Click the top-level Explore button (no-op if already in Explore). */
function switchToExploreMode(): void {
  const btn = document.getElementById("modeExplore");
  btn?.click();
}

const ctx: AppContext = {
  log,
  getHost: () => host,
  isScrubbing: () => scrubbing,
  isPaused: () => paused,
  currentGame,
  fireUserCmd,
  getGlossary: () => glossary,
  availableGames: () => availableGames,
  switchToGame,
  fireSequence,
  auditionCustomRom,
  switchToExploreMode,
  getCustomSlots: () => (customRomActive && customAudition ? customAudition.slots : null),
};
const paramSliders = initParamSliders(ctx);
const engineToggles = initEngineToggles(ctx);
const glossaryUi = initGlossaryUi(ctx);

initLayout(log);
initWavExport(ctx);
initABDiff(ctx);
initKeyboard(ctx);
initModeToggle(ctx);

log("Loaded.");
