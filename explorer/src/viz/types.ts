/**
 * Shared shape for visualisation panels (Step 3.1 — Pattern 1 three-panel
 * triangle).  Every panel exposes the same tiny lifecycle so `main.ts` can
 * dispatch state snapshots uniformly.
 *
 * Snapshots are the single source of truth: each panel reads only what it
 * needs from the snapshot (oscilloscope samples / DAC byte / disassembly)
 * and renders into its own canvas (or DOM block).  The "shared timeline
 * cursor" mentioned in the plan emerges from every panel reading the same
 * `cycles` / `scrubCycle` value from the snapshot.
 */
import type { StateSnapshot } from "../data/protocol.ts";

export interface VizPanel {
  /** Render the latest state.  Cheap — called at ~10 Hz from the host poll. */
  update(snapshot: StateSnapshot): void;
  /**
   * Optional: forget any held state and re-render the idle caption.  Called
   * by `main.ts` on every new user-driven fire so per-engine views don't
   * carry stale state from the previous sound into the next.  Views that
   * have nothing to forget (oscilloscope, byte tape, code panel, RAM
   * heatmap, swimlane, spectrogram) leave this unimplemented.
   */
  resetIdle?(): void;
}
