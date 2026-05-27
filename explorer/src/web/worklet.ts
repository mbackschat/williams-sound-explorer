/**
 * AudioWorkletProcessor for the Williams sound explorer.
 *
 * Lives in the audio thread.  Owns a `RealtimeRunner` and forwards control
 * messages from the main thread (`load`, `fire`, `stop`, `speed`).
 * `process()` is the audio-thread hot path — it just calls
 * `runner.fillBlock(output)` and returns.
 *
 * Message protocol (see also `host.ts`):
 *
 *   main → worklet                            response back
 *   --------------------------------------    -------------------
 *   { type: "load", game, rom: ArrayBuffer }  { type: "ready" }
 *   { type: "fire", cmd: number }             (none)
 *   { type: "stop" }                          (none)
 *   { type: "speed", value: number }          (none)
 *   anything that throws                      { type: "error", message }
 *
 * The processor is registered as "williams-sound-explorer-processor"; the host wires
 * an `AudioWorkletNode` of that name to the destination.
 *
 * NOTE: this file is loaded as a *separate* ES module by
 * `audioContext.audioWorklet.addModule(url)`.  It has its own module graph,
 * which is why we explicitly avoid any `node:*` imports here or anywhere
 * downstream (the `realtimeRunner` module tree is Node-free).
 */
/// <reference path="./worklet-globals.d.ts" />
import { RealtimeRunner } from "../engine/realtimeRunner.ts";
import type { WorkletInMsg, WorkletOutMsg } from "../data/protocol.ts";

class WilliamsSoundProcessor extends AudioWorkletProcessor {
  private runner: RealtimeRunner | undefined;
  /** When false, `process()` emits silence regardless of CPU state. */
  private active = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletInMsg>) => {
      try {
        this.onMessage(e.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.port.postMessage({ type: "error", message } satisfies WorkletOutMsg);
      }
    };
  }

  private onMessage(msg: WorkletInMsg): void {
    switch (msg.type) {
      case "load": {
        const rom = new Uint8Array(msg.rom);
        this.runner = new RealtimeRunner(msg.game, rom, { sampleRate });
        this.runner.bootToIdle();
        this.active = true;
        this.port.postMessage({ type: "ready" } satisfies WorkletOutMsg);
        return;
      }
      case "fire":
        this.runner?.fire(msg.cmd);
        return;
      case "stop":
        // "Stop" means "go silent and do not consume CPU".  We don't tear
        // the runner down; the host can resume by sending another command
        // (which re-arms `active` via the next `load`, or just by mute UI).
        this.active = false;
        return;
      case "speed":
        this.runner?.setSpeed(msg.value);
        return;
      case "pause":
        this.runner?.pause();
        this.postSnapshot();
        return;
      case "resume":
        this.runner?.resume();
        this.postSnapshot();
        return;
      case "step": {
        if (!this.runner) return;
        const cycles = this.runner.step();
        this.postSnapshot({ reached: true, stepCycles: cycles });
        return;
      }
      case "step-dac": {
        if (!this.runner) return;
        const res = this.runner.stepToNextDacWrite();
        this.postSnapshot({ reached: res.reached, stepCycles: res.cycles });
        return;
      }
      case "step-irq": {
        if (!this.runner) return;
        const res = this.runner.stepToNextIrq();
        this.postSnapshot({ reached: res.reached, stepCycles: res.cycles });
        return;
      }
      case "scrub-start":
        this.runner?.startScrub(msg.cycle, msg.speed);
        this.postSnapshot();
        return;
      case "scrub-pos":
        this.runner?.setScrubPosition(msg.cycle);
        return;
      case "scrub-speed":
        this.runner?.setScrubSpeed(msg.value);
        return;
      case "scrub-end":
        this.runner?.exitScrub({ resume: msg.resume });
        this.postSnapshot();
        return;
      case "scrub-loop":
        this.runner?.setScrubLoop(msg.mode);
        return;
      case "reset-recording":
        this.runner?.resetRecording();
        this.postSnapshot();
        return;
      case "engine-toggle":
        this.runner?.setToggle(msg.key, msg.value);
        this.postSnapshot();
        return;
      case "param-override":
        this.runner?.setParamOverride(msg.addr, msg.value);
        this.postSnapshot();
        return;
      case "snapshot":
        this.postSnapshot();
        return;
    }
  }

  private postSnapshot(extra: { reached?: boolean; stepCycles?: number } = {}): void {
    if (!this.runner) return;
    const snap = this.runner.snapshot();
    this.port.postMessage({
      type: "state",
      snapshot: {
        ...snap,
        ...extra,
      },
    } satisfies WorkletOutMsg);
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (this.active && this.runner) {
      this.runner.fillBlock(out);
    } else {
      out.fill(0);
    }
    return true; // keep the processor alive
  }
}

registerProcessor("williams-sound-explorer-processor", WilliamsSoundProcessor);
