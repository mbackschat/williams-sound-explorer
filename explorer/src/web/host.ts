/**
 * Main-thread host for the Williams sound AudioWorklet.
 *
 * Wraps an `AudioContext` + `AudioWorkletNode` + the message protocol
 * documented in `worklet.ts`.  Typical usage from a page module:
 *
 *     const host = new WilliamsSoundHost({
 *       workletUrl: "/williams-sound-explorer-worklet.js",  // bundled worklet
 *       romBaseUrl: "/roms",                       // bundled binaries
 *     });
 *     await host.init("defender");
 *     await host.resume();                         // user-gesture mandate
 *     host.fire(0x11);                              // LITE
 *
 * The host is browser-only — it uses `AudioContext`, `fetch`, and
 * `AudioWorkletNode`, none of which exist in Node.  All Node-side rendering
 * still lives in `tools/render_sound.ts`.
 */
import type { GameKind } from "../board/soundboard.ts";
import type { StateSnapshot, WorkletInMsg, WorkletOutMsg } from "../data/protocol.ts";
import type { ScrubLoopMode } from "../engine/realtimeRunner.ts";
import type { EngineToggleKey } from "../engine/engineToggles.ts";
import { loadRomBytes } from "./romStore.ts";

export type { StateSnapshot, ScrubLoopMode, SoundSegment, EngineToggleKey } from "../data/protocol.ts";

/** Callback fired whenever the worklet posts a fresh state snapshot. */
export type StateListener = (snapshot: StateSnapshot) => void;

export interface WilliamsSoundHostOptions {
  /** URL of the bundled `worklet.js` (or a Vite-resolved equivalent). */
  workletUrl: string;
  /** Base URL where ROMs live (e.g. `/roms`). Files: `<base>/<game>_sound.bin`. */
  romBaseUrl: string;
  /** Optional sample-rate override.  Default lets the browser pick. */
  sampleRate?: number;
  /** Receives every state snapshot the worklet posts (paused state + after every step). */
  onState?: StateListener;
}

/** Default volume.  Williams sounds (especially LITE / TURBO) are near-clipping
 * by design — see `docs/explorer_implementation.md`.  Start quieter. */
export const DEFAULT_VOLUME = 0.3;

export class WilliamsSoundHost {
  private ctx: AudioContext | undefined;
  private node: AudioWorkletNode | undefined;
  private gainNode: GainNode | undefined;
  private dcBlocker: BiquadFilterNode | undefined;
  private analyserNode: AnalyserNode | undefined;
  private ready = false;
  private onState: StateListener | undefined;

  constructor(private readonly opts: WilliamsSoundHostOptions) {
    this.onState = opts.onState;
  }

  /** Replace the state listener after construction. */
  setStateListener(listener: StateListener | undefined): void {
    this.onState = listener;
  }

  /**
   * Load the ROM, register the worklet, and wire it to the destination.
   * Returns once the audio graph is wired and the worklet's `load` message
   * has been queued — but does NOT wait for the worklet to confirm `ready`.
   *
   * Why: under Chrome's autoplay policy the audio thread is suspended until
   * the first user gesture, so the worklet's message handler never runs and
   * `ready` never arrives.  Awaiting it would hang forever.  Instead we
   * trust the postMessage queue: the `load` message sits in it until the
   * worklet thread starts on first gesture, at which point `load` is
   * processed (RealtimeRunner created + booted) before any subsequent
   * `fire` / `step` / etc. — so commands the user clicks pre-resume just
   * queue safely.
   */
  async init(game: GameKind): Promise<void> {
    if (this.ready) throw new Error("WilliamsSoundHost.init: already initialised");
    this.ctx = this.opts.sampleRate
      ? new AudioContext({ sampleRate: this.opts.sampleRate })
      : new AudioContext();
    await this.ctx.audioWorklet.addModule(this.opts.workletUrl);

    this.node = new AudioWorkletNode(this.ctx, "williams-sound-explorer-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    // Inline a GainNode so the user can attenuate — these sounds clip the
    // DAC by design (LFSR noise = ±1 most of the time after LPF).
    this.gainNode = new GainNode(this.ctx, { gain: DEFAULT_VOLUME });
    // High-pass at 5 Hz simulates the AC-coupling capacitor in the real
    // Williams amplifier — speakers can't reproduce DC.  Without this, a
    // sound ending on a non-mid-rail DAC byte (LITE ends at $00 = -1.0)
    // leaves a permanent DC offset on the speaker which the spectrogram
    // then displays as horizontal lines forever.  5 Hz is well below the
    // audible band, so no perceptible effect on the sounds themselves.
    this.dcBlocker = new BiquadFilterNode(this.ctx, {
      type: "highpass",
      frequency: 5,
      Q: 0.7,
    });
    // AnalyserNode reads the post-volume, DC-blocked signal — same as the
    // speaker hears.  FFT size 512 → 256 frequency bins; smoothingTime-
    // Constant 0.6.  Spectrogram viz polls at rAF rate.
    this.analyserNode = new AnalyserNode(this.ctx, {
      fftSize: 512,
      smoothingTimeConstant: 0.6,
      minDecibels: -90,
      maxDecibels: -10,
    });
    this.node.connect(this.gainNode);
    this.gainNode.connect(this.dcBlocker);
    this.dcBlocker.connect(this.ctx.destination);
    this.dcBlocker.connect(this.analyserNode);

    // Long-lived message router — installed up-front so the eventual
    // `ready` arrives at the right place even though we don't await it.
    this.node.port.onmessage = (e: MessageEvent<WorkletOutMsg>) => {
      if (e.data.type === "state") {
        this.onState?.(e.data.snapshot);
      } else if (e.data.type === "error") {
        console.error("[WilliamsSoundHost] worklet error:", e.data.message);
      } else if (e.data.type === "ready") {
        // No-op for now — UI is already enabled.  Useful hook later.
      }
    };

    const rom = await this.fetchRom(game);
    this.post({ type: "load", game, rom }, [rom]);

    this.ready = true;
  }

  /**
   * Resume the AudioContext — must be called from a user gesture handler in
   * browsers that suspend audio by default (Safari, recent Chrome).
   */
  async resume(): Promise<void> {
    if (!this.ctx) throw new Error("WilliamsSoundHost.resume: init() not called");
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** Inject a 6-bit Williams sound command (0..0x3F). */
  fire(cmd: number): void {
    this.requireReady();
    this.post({ type: "fire", cmd });
  }

  /**
   * Replace the worklet's running ROM image with `rom` (built by Design mode's
   * `buildCustomRom`).  The audio graph stays in place — the worklet just
   * reboots its runner against the new bytes, so the next `fire` plays against
   * the custom image.  `game` is the base game's `GameKind` (drives memory
   * layout in the runner); call once `init()` has completed.
   */
  loadCustomRom(game: GameKind, rom: Uint8Array): void {
    this.requireReady();
    // Detach a fresh copy so the caller's buffer isn't transferred away.
    const buffer = new Uint8Array(rom).buffer;
    this.post({ type: "load", game, rom: buffer }, [buffer]);
  }

  /** Set playback speed multiplier (1 = real time). */
  setSpeed(value: number): void {
    this.requireReady();
    this.post({ type: "speed", value });
  }

  /**
   * Set the output volume in linear gain (0 = silence, 1 = unity).
   * Uses `setTargetAtTime` to ramp smoothly so the slider doesn't click.
   */
  setVolume(value: number): void {
    if (!this.gainNode || !this.ctx) {
      throw new Error("WilliamsSoundHost.setVolume: not initialised");
    }
    const v = Math.max(0, Math.min(1, value));
    this.gainNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  /** Read back the current (target) volume. */
  getVolume(): number {
    return this.gainNode?.gain.value ?? 0;
  }

  /**
   * Direct access to the host's `AnalyserNode` so visualisers (Spectrogram,
   * future Oscilloscope-with-FFT) can poll frequency / waveform data at
   * rAF rate without going through the worklet's snapshot stream.
   * Returns undefined before `init()` completes.
   */
  getAnalyser(): AnalyserNode | undefined {
    return this.analyserNode;
  }

  /** Mute the worklet's output (CPU stays in whatever state it was in). */
  stop(): void {
    this.requireReady();
    this.post({ type: "stop" });
  }

  /**
   * Freeze the CPU.  The worklet output holds the current LPF level so
   * resuming is click-free.  `step()` advances the CPU by one instruction
   * while paused.
   */
  pause(): void {
    this.requireReady();
    this.post({ type: "pause" });
  }

  /** Unfreeze the CPU.  Named `unpause` to avoid shadowing `resume()` (AudioContext). */
  unpause(): void {
    this.requireReady();
    this.post({ type: "resume" });
  }

  /** Advance the CPU by exactly one instruction (only meaningful while paused). */
  step(): void {
    this.requireReady();
    this.post({ type: "step" });
  }

  /** Advance the CPU to the next DAC write (the next moment of sound). */
  stepToDac(): void {
    this.requireReady();
    this.post({ type: "step-dac" });
  }

  /** Advance the CPU to the next IRQ handler entry (one sound-engine tick). */
  stepToIrq(): void {
    this.requireReady();
    this.post({ type: "step-irq" });
  }

  /** Ask the worklet to post its current state snapshot.  Useful right after init. */
  requestSnapshot(): void {
    this.requireReady();
    this.post({ type: "snapshot" });
  }

  /**
   * Enter scrub mode at `cycle` with playback `speed` (signed — negative
   * means reverse playback of the recorded DAC history).  Live CPU is
   * paused for the duration.
   */
  startScrub(cycle: number, speed = 1): void {
    this.requireReady();
    this.post({ type: "scrub-start", cycle, speed });
  }

  /** Move the scrub head to `cycle` (clamped server-side to the recorded range). */
  setScrubPosition(cycle: number): void {
    this.requireReady();
    this.post({ type: "scrub-pos", cycle });
  }

  /** Set scrub playback speed.  Negative = reverse, 0 = freeze the head. */
  setScrubSpeed(value: number): void {
    this.requireReady();
    this.post({ type: "scrub-speed", value });
  }

  /**
   * Exit scrub mode.  Pass `{resume: true}` to also un-pause live CPU.
   * Default keeps the CPU paused so the user can decide.
   */
  exitScrub(opts: { resume?: boolean } = {}): void {
    this.requireReady();
    this.post({ type: "scrub-end", resume: opts.resume });
  }

  /** Set scrub-mode loop policy: "none" / "range" / "segment". */
  setScrubLoop(mode: ScrubLoopMode): void {
    this.requireReady();
    this.post({ type: "scrub-loop", mode });
  }

  /** Wipe the DAC history ring + segment markers — "blank the tape". */
  resetRecording(): void {
    this.requireReady();
    this.post({ type: "reset-recording" });
  }

  /** Set or clear a Pattern 3 engine toggle (Step 4.4). */
  setEngineToggle(key: EngineToggleKey, value: boolean): void {
    this.requireReady();
    this.post({ type: "engine-toggle", key, value });
  }

  /**
   * Set or clear a Pattern 5 parameter override (Step 6.2).  `value === null`
   * clears the override and lets the CPU's writes resume taking effect.
   */
  setParamOverride(addr: number, value: number | null): void {
    this.requireReady();
    this.post({ type: "param-override", addr, value });
  }

  /** Tear down the AudioContext + node graph. */
  async dispose(): Promise<void> {
    this.node?.disconnect();
    this.gainNode?.disconnect();
    this.dcBlocker?.disconnect();
    this.analyserNode?.disconnect();
    await this.ctx?.close();
    this.node = undefined;
    this.gainNode = undefined;
    this.dcBlocker = undefined;
    this.analyserNode = undefined;
    this.ctx = undefined;
    this.ready = false;
  }

  // ---- private helpers --------------------------------------------------

  private requireReady(): void {
    if (!this.ready || !this.node) {
      throw new Error("WilliamsSoundHost: not initialised — call init() first");
    }
  }

  private post(msg: WorkletInMsg, transfer: Transferable[] = []): void {
    if (!this.node) throw new Error("post: node missing");
    // Every worklet-bound action opportunistically resumes the AudioContext
    // so the first click on Fire / Pause / Step / scrubber works even when
    // the browser's autoplay policy suspended us on page load.  If we're
    // not actually inside a user-gesture call stack the resume call is a
    // silent no-op (promise rejection is swallowed); subsequent gesture-
    // driven calls keep trying.
    if (this.ctx && this.ctx.state !== "running") {
      this.ctx.resume().catch(() => { /* not yet a gesture — keep waiting */ });
    }
    this.node.port.postMessage(msg, transfer);
  }

  // ROM bytes come from the user-supplied store (IndexedDB), not a bundled
  // file — see romStore.ts.  `loadRomBytes` returns a fresh copy each call, so
  // transferring its buffer to the worklet never neuters a shared/cached one.
  // (`opts.romBaseUrl` is now vestigial; the dev fallback inside the store
  // hardcodes `/roms`.)
  private async fetchRom(game: GameKind): Promise<ArrayBuffer> {
    const bytes = await loadRomBytes(game);
    return bytes.slice().buffer;
  }
}
