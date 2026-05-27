/**
 * Pure key→action mapping for the keyboard shortcuts.  No DOM — the decision
 * logic lives here so it's unit-testable (`tests/keyboard.test.ts`); the thin
 * DOM handler in `keyboard.ts` reads the environment, calls `keyAction`, and
 * dispatches the result to the existing on-screen controls.
 */

export type KeyAction =
  | "fire" | "pauseToggle"
  | "stepInstr" | "stepDac" | "stepIrq"
  | "scrubBack" | "scrubFwd"
  | "speed0" | "speed1" | "speed2" | "speed3"
  | "volumeUp" | "volumeDown"
  | "scrubToggle" | "loop" | "reset"
  | "gameCycle" | "focusCmd" | "hideHelp" | "shortcuts";

export interface KeyEnv {
  /** An input/select/textarea has focus — shortcuts must not hijack typing. */
  typing: boolean;
  /** Scrub mode is active (vs live). */
  scrubbing: boolean;
  /** The CPU is paused. */
  paused: boolean;
}

/**
 * Resolve a keydown to an action, or `null` to let it through.
 * `mod` = any of Ctrl/Meta/Alt held (so OS/browser shortcuts are never stolen).
 */
export function keyAction(key: string, mod: boolean, env: KeyEnv): KeyAction | null {
  if (mod || env.typing) return null;
  switch (key) {
    case " ": return "fire";
    // ←/→ "nudge time": seek the recording while scrubbing, else single-step
    // one instruction when paused live.  Left can't step backwards live.
    case "ArrowRight": return env.scrubbing ? "scrubFwd" : env.paused ? "stepInstr" : null;
    case "ArrowLeft": return env.scrubbing ? "scrubBack" : null;
    case "ArrowUp": return "volumeUp";
    case "ArrowDown": return "volumeDown";
    case "1": return "speed0";
    case "2": return "speed1";
    case "3": return "speed2";
    case "4": return "speed3";
    case "?": return "shortcuts";
    case "/": return "focusCmd";
  }
  switch (key.toLowerCase()) {
    case "p": return "pauseToggle";
    case "d": return "stepDac";
    case "i": return "stepIrq";
    case "s": return "scrubToggle";
    case "l": return "loop";
    case "r": return "reset";
    case "g": return "gameCycle";
    case "h": return "hideHelp";
  }
  return null;
}

/** Shortcut reference, shown in the `?` overlay + documented in MANUAL.md. */
export const KEY_HELP: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "Space", label: "Fire the current command" },
  { keys: "P", label: "Pause / Resume" },
  { keys: "← →", label: "Nudge time — scrub seek, or single-step when paused" },
  { keys: "↑ ↓", label: "Volume up / down" },
  { keys: "1–4", label: "Speed: 1× · ¼× · ¹⁄₁₀× · ¹⁄₁₀₀×" },
  { keys: "D / I", label: "Step to next DAC write / IRQ" },
  { keys: "S", label: "Toggle Scrub / Live" },
  { keys: "L / R", label: "Scrub loop mode / Reset" },
  { keys: "G", label: "Cycle game" },
  { keys: "/", label: "Focus the command box" },
  { keys: "H", label: "Toggle help text" },
  { keys: "?", label: "Show this shortcuts list" },
];
