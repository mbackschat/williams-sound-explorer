/**
 * Pattern 3 engine-toggle row + Pattern 4 voice-mute Build-up/Tear-down
 * sequencer (Steps 4.4 / 6.1).
 *
 * Each toggle checkbox forwards to the host (which only accepts toggle messages
 * after Init); state is cached locally in `toggleState` so the UI reflects
 * pre-Init clicks and is replayed via the returned `applyToggleStateToHost`
 * after a host is (re)created.  SCREAM (4 voices) and ORGAN (8 OSCIL bits) each
 * get a voice-mute UI + a sequencer that fires the sound and (un)mutes voices
 * one at a time on a timer.
 */
import { els } from "../els.ts";
import {
  ENGINE_TOGGLE_KEYS,
  ENGINE_TOGGLE_META,
  SCREAM_VOICE_TOGGLE_KEYS,
  ORGAN_VOICE_TOGGLE_KEYS,
  type EngineToggleKey,
} from "../../engine/engineToggles.ts";
import type { AppContext } from "../appContext.ts";

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
  /** Fires the engine's sound. */
  fire: () => Promise<void>;
}

export interface EngineTogglesApi {
  /** Replay locally-stashed toggle state to the host (after Init / game switch). */
  applyToggleStateToHost(): void;
}

export function initEngineToggles(ctx: AppContext): EngineTogglesApi {
  const toggleState: Partial<Record<EngineToggleKey, boolean>> = {};

  function setVoiceMute(engine: VoiceMuteEngine, voice: number, value: boolean): void {
    const key = engine.keys[voice];
    if (!key) return;
    toggleState[key] = value;
    const cb = engine.checkboxes[voice];
    if (cb) {
      cb.checked = value;
      (cb.closest(".voice-toggle") as HTMLElement | null)?.classList.toggle("active", value);
    }
    try { ctx.getHost()?.setEngineToggle(key, value); } catch { /* not yet ready */ }
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
          ctx.getHost()?.setEngineToggle(key, cb.checked);
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
    const host = ctx.getHost();
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
    fire: async () => { await ctx.fireSequence([0x1A]); },
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
    fire: async () => { await ctx.fireSequence([0x1B, 0x02]); },
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
    if (!ctx.getHost()) return;
    setAllMuted(engine, direction === "build");
    // Brief settle for the toggle messages to land before the fire.
    await new Promise((r) => setTimeout(r, 50));
    await engine.fire();
    ctx.log(`${direction === "build" ? "Build-up" : "Tear-down"} sequence — ${engine.name} firing…`);
    setSeqRunning(engine, direction === "build" ? engine.buildUp : engine.tearDown);
    const n = engine.keys.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) order.push(direction === "build" ? i : n - 1 - i);
    let step = 0;
    const advance = (): void => {
      if (!voiceSeqRunning || voiceSeqEngine !== engine) return;
      if (step >= order.length) {
        ctx.log(`${direction === "build" ? "Build-up" : "Tear-down"} sequence complete.`);
        setSeqRunning(undefined);
        return;
      }
      const v = order[step]!;
      setVoiceMute(engine, v, direction === "tear");
      ctx.log(`${direction === "build" ? "+" : "−"}${engine.name === "ORGAN" ? "b" : "v"}${v}`);
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
      ctx.log(`${engine.name} sequence cancelled; all voices restored.`);
    });
  }
  wireEngineButtons(SCREAM_ENGINE);
  wireEngineButtons(ORGAN_ENGINE);

  return { applyToggleStateToHost };
}
