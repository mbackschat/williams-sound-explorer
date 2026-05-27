/**
 * CodePanel inspect-cursor tests (Step 4.5 / Pattern 8).
 *
 * Verifies the textual rendering of the inspect line — the panel writes
 * into a `<pre>` element's textContent, so we can assert against the
 * resulting string without a real browser.
 *
 * What's covered:
 *   1. No inspect cursor → just the usual disassembly + registers.
 *   2. Cursor with a known PC + loaded label map → "INSPECT [src] cycle N PC $YYYY LABEL+ofs file.SRC:line".
 *   3. Cursor with PC = undefined (e.g. hover during silence) → "(silent)".
 *   4. Cursor without a label map → falls back to "PC $YYYY" without the label tail.
 *   5. setInspectCursor(null) clears the line.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { CodePanel } from "../src/viz/CodePanel.ts";
import { emptyLabelMap, type LabelMap } from "../src/audio/labelMap.ts";
import type { StateSnapshot } from "../src/audio/worklet.ts";

/**
 * Minimal HTMLPreElement stand-in.  CodePanel only ever sets `.textContent`
 * on its target, so we only need to mock that property.  Lets these tests
 * run under the default Node Vitest environment without pulling jsdom.
 */
function makePre(): { el: { textContent: string }; text: () => string } {
  const el = { textContent: "" };
  return { el, text: () => el.textContent };
}

function makeSnapshot(): StateSnapshot {
  return {
    pc: 0xF801, a: 0, b: 0, x: 0, sp: 0x7F, ccr: 0,
    cycles: 1000,
    paused: false, scrubbing: false, scrubCycle: 0, scrubSpeed: 0,
    recorded: { oldestCycle: 0, newestCycle: 0, size: 0 },
    lastDac: 0x80,
    disassembly: { address: 0xF801, bytes: [0x0F], mnemonic: "SEI", operand: "", length: 1, nextPc: 0xF802 },
    lastSamples: new Float32Array(0),
    lastRawSamples: new Float32Array(0),
    segments: [],
    scrubLoopMode: "none",
    recentDacEvents: {
      cycles: new Float64Array(0), values: new Uint8Array(0), pcs: new Uint16Array(0),
      count: 0, windowStart: 0, windowEnd: 0,
    },
    ramSnapshot: new Uint8Array(128),
    ramLastWrite: new Uint32Array(128),
  } as StateSnapshot;
}

function makeLabelMap(): LabelMap {
  const m = emptyLabelMap();
  m.defender = [
    { addr: 0xF801, label: "SETUP", src_line: 170 },
    { addr: 0xF88C, label: "LITE", src_line: 250 },
    { addr: 0xF89E, label: "LITEN", src_line: 265 },
  ];
  return m;
}

let p: ReturnType<typeof makePre>;
let panel: CodePanel;
let snap: StateSnapshot;

beforeEach(() => {
  p = makePre();
  panel = new CodePanel(p.el as unknown as HTMLPreElement);
  snap = makeSnapshot();
});

describe("CodePanel — no inspect cursor", () => {
  it("does not render an INSPECT line", () => {
    panel.update(snap);
    expect(p.text()).not.toContain("INSPECT");
    expect(p.text()).toContain("SEI");
  });
});

describe("CodePanel — inspect cursor with label map", () => {
  it("renders cycle / PC / label / source line", () => {
    panel.setLabelMap(makeLabelMap(), () => "defender");
    panel.update(snap);
    panel.setInspectCursor({ cycle: 9876, pc: 0xF8A0, source: "spectrogram" });
    const text = p.text();
    expect(text).toContain("INSPECT [spectrogram]");
    // toLocaleString separator varies by environment — match either thousands sep.
    expect(text).toMatch(/cycle=9[.,]876/);
    expect(text).toContain("PC=$F8A0");
    // Resolved label: $F8A0 falls inside LITEN block, offset 2.
    expect(text).toContain("LITEN+2");
    expect(text).toContain("VSNDRM1.SRC:265");
  });

  it("renders LITE+0 as plain LITE (no +0 tail)", () => {
    panel.setLabelMap(makeLabelMap(), () => "defender");
    panel.update(snap);
    panel.setInspectCursor({ cycle: 1, pc: 0xF88C, source: "byte tape" });
    expect(p.text()).toContain("LITE  ");
    expect(p.text()).not.toContain("LITE+0");
  });

  it("setInspectCursor(null) removes the INSPECT line", () => {
    panel.setLabelMap(makeLabelMap(), () => "defender");
    panel.update(snap);
    panel.setInspectCursor({ cycle: 1, pc: 0xF88C, source: "byte tape" });
    expect(p.text()).toContain("INSPECT");
    panel.setInspectCursor(null);
    expect(p.text()).not.toContain("INSPECT");
  });
});

describe("CodePanel — inspect cursor without label map", () => {
  it("renders cycle + PC without the label tail", () => {
    panel.update(snap);
    panel.setInspectCursor({ cycle: 42, pc: 0xF8A0, source: "spectrogram" });
    const text = p.text();
    expect(text).toContain("INSPECT [spectrogram]");
    expect(text).toContain("PC=$F8A0");
    expect(text).not.toContain(".SRC:");
  });
});

describe("CodePanel — inspect cursor with no PC", () => {
  it("falls back to (silent) when PC is undefined", () => {
    panel.setLabelMap(makeLabelMap(), () => "defender");
    panel.update(snap);
    panel.setInspectCursor({ cycle: 7, pc: undefined, source: "spectrogram" });
    const text = p.text();
    expect(text).toContain("INSPECT [spectrogram]");
    expect(text).toContain("PC=(silent)");
    // No label since there's no PC.
    expect(text).not.toContain(".SRC:");
  });
});
