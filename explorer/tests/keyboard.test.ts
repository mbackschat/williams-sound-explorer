/**
 * Pure key→action mapping for the keyboard shortcuts (`src/web/ui/keymap.ts`).
 *
 * The DOM handler (`keyboard.ts`) is thin glue; all the decision logic lives in
 * `keyAction`, which is pure (no DOM) and therefore unit-testable here.  The
 * context-sensitive arrow behaviour and the typing/modifier guards are the
 * parts most worth pinning.
 */
import { describe, expect, it } from "vitest";

import { keyAction, type KeyEnv } from "../src/web/ui/keymap.ts";

const env = (o: Partial<KeyEnv> = {}): KeyEnv => ({ typing: false, scrubbing: false, paused: false, ...o });

describe("keyAction", () => {
  it("Space fires the current command", () => {
    expect(keyAction(" ", false, env())).toBe("fire");
  });

  it("ignores every key while typing in an input/select", () => {
    expect(keyAction(" ", false, env({ typing: true }))).toBeNull();
    expect(keyAction("1", false, env({ typing: true }))).toBeNull();
    expect(keyAction("g", false, env({ typing: true }))).toBeNull();
  });

  it("ignores keys held with a modifier (lets OS/browser shortcuts through)", () => {
    expect(keyAction(" ", true, env())).toBeNull();
    expect(keyAction("g", true, env())).toBeNull();
    expect(keyAction("1", true, env())).toBeNull();
  });

  it("maps 1–4 to the four speed presets", () => {
    expect(keyAction("1", false, env())).toBe("speed0");
    expect(keyAction("2", false, env())).toBe("speed1");
    expect(keyAction("3", false, env())).toBe("speed2");
    expect(keyAction("4", false, env())).toBe("speed3");
  });

  it("left/right nudge time by context", () => {
    // Scrub mode → seek the recording.
    expect(keyAction("ArrowLeft", false, env({ scrubbing: true }))).toBe("scrubBack");
    expect(keyAction("ArrowRight", false, env({ scrubbing: true }))).toBe("scrubFwd");
    // Paused live → right single-steps one instruction; left can't step back.
    expect(keyAction("ArrowRight", false, env({ paused: true }))).toBe("stepInstr");
    expect(keyAction("ArrowLeft", false, env({ paused: true }))).toBeNull();
    // Playing live → arrows do nothing (nothing to nudge).
    expect(keyAction("ArrowRight", false, env())).toBeNull();
    expect(keyAction("ArrowLeft", false, env())).toBeNull();
  });

  it("up/down adjust volume in every mode", () => {
    expect(keyAction("ArrowUp", false, env())).toBe("volumeUp");
    expect(keyAction("ArrowDown", false, env({ scrubbing: true }))).toBe("volumeDown");
  });

  it("letter shortcuts are case-insensitive", () => {
    expect(keyAction("p", false, env())).toBe("pauseToggle");
    expect(keyAction("P", false, env())).toBe("pauseToggle");
    expect(keyAction("G", false, env())).toBe("gameCycle");
  });

  it("maps the remaining controls", () => {
    expect(keyAction("d", false, env())).toBe("stepDac");
    expect(keyAction("i", false, env())).toBe("stepIrq");
    expect(keyAction("s", false, env())).toBe("scrubToggle");
    expect(keyAction("l", false, env())).toBe("loop");
    expect(keyAction("r", false, env())).toBe("reset");
    expect(keyAction("h", false, env())).toBe("hideHelp");
    expect(keyAction("/", false, env())).toBe("focusCmd");
    expect(keyAction("?", false, env())).toBe("shortcuts");
  });

  it("returns null for unmapped keys", () => {
    expect(keyAction("x", false, env())).toBeNull();
    expect(keyAction("Enter", false, env())).toBeNull();
    expect(keyAction("Tab", false, env())).toBeNull();
  });
});
