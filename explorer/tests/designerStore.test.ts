/**
 * Designer project JSON export/import (the saveable artefact) for the
 * own-item-list `CustomProject` shape — VARI + GWAVE slots — plus the legacy
 * v1 (`{ baseGame, edits }`) and v2 (no-`kind` slots) on-disk shape conversions.
 *
 * IndexedDB CRUD is browser-only and untested here; these cover the pure
 * serialise / parse-and-validate path (the import-failure surface a user hits)
 * and the migrations.
 */
import { describe, expect, it } from "vitest";
import { exportJson, importJson, type CustomProject } from "../src/web/designer/designerStore.ts";
import { maxSlots } from "../src/engine/customRom.ts";

const SAW = [0x40, 0x01, 0x00, 0x10, 0xE1, 0x00, 0x80, 0xFF, 0xFF];
const HBDV = [0x81, 0x24, 0x00, 0x00, 0x00, 0x16, 0x31];

const project: CustomProject = {
  name: "My game",
  engineBase: "defender",
  slots: [{ kind: "vari", name: "Thunder", record: SAW, start: SAW }],
  createdAt: 100,
  updatedAt: 200,
};

describe("exportJson / importJson — VARI slots", () => {
  it("round-trips a VARI project (name, engineBase, named slots preserved)", () => {
    const back = importJson(exportJson(project));
    expect(back.name).toBe("My game");
    expect(back.engineBase).toBe("defender");
    expect(back.slots).toHaveLength(1);
    expect(back.slots[0]!.kind).toBe("vari");
    expect(back.slots[0]!.name).toBe("Thunder");
    expect(back.slots[0]!.record).toEqual(SAW);
    expect(back.slots[0]!.start).toEqual(SAW);
    expect(back.createdAt).toBe(100); // preserved
  });

  it("exported JSON carries no ROM-byte blob — only parameter values", () => {
    expect(exportJson(project)).not.toMatch(/bytes|ArrayBuffer|\brom\b/i);
  });

  it("defaults a slot's `start` to its record when absent", () => {
    const back = importJson(JSON.stringify({ ...project, slots: [{ kind: "vari", name: "x", record: SAW }] }));
    expect(back.slots[0]!.start).toEqual(SAW);
  });

  it("rejects non-JSON and a missing name", () => {
    expect(() => importJson("{nope")).toThrow(/JSON/i);
    expect(() => importJson(JSON.stringify({ ...project, name: "" }))).toThrow(/name/i);
  });

  it("Robotron is a valid engine base, but VARI slots there are rejected", () => {
    expect(() => importJson(JSON.stringify({ ...project, engineBase: "robotron" }))).toThrow(/VARI slots aren't supported on robotron/);
  });

  it("rejects malformed VARI slots and over-capacity projects", () => {
    expect(() => importJson(JSON.stringify({ ...project, slots: [{ kind: "vari", name: "x", record: [1, 2, 3] }] }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...project, slots: [{ kind: "vari", record: SAW }] }))).toThrow(/name/i);
    const tooMany = Array.from({ length: maxSlots("defender") + 1 }, (_, i) => ({ kind: "vari" as const, name: `s${i}`, record: SAW, start: SAW }));
    expect(() => importJson(JSON.stringify({ ...project, slots: tooMany }))).toThrow(/too many/i);
  });
});

describe("exportJson / importJson — GWAVE slots", () => {
  const gp: CustomProject = {
    name: "G-mix",
    engineBase: "defender",
    slots: [{ kind: "gwave", name: "Loud BBSV", record: HBDV, start: HBDV, targetCmd: 0x05 }],
    createdAt: 100,
    updatedAt: 200,
  };

  it("round-trips a GWAVE project preserving targetCmd + record + name", () => {
    const back = importJson(exportJson(gp));
    expect(back.slots).toHaveLength(1);
    const s = back.slots[0]!;
    expect(s.kind).toBe("gwave");
    if (s.kind !== "gwave") return; // narrow for TS
    expect(s.name).toBe("Loud BBSV");
    expect(s.record).toEqual(HBDV);
    expect(s.targetCmd).toBe(0x05);
  });

  it("Robotron + GWAVE-only project is accepted (no dispatcher widen needed)", () => {
    const robo: CustomProject = { ...gp, engineBase: "robotron" };
    const back = importJson(exportJson(robo));
    expect(back.engineBase).toBe("robotron");
    expect(back.slots[0]!.kind).toBe("gwave");
  });

  it("rejects a GWAVE override targeting a non-editable command", () => {
    const bad = { ...gp, slots: [{ kind: "gwave", name: "x", record: HBDV, start: HBDV, targetCmd: 0x12 }] }; // BON2 excluded
    expect(() => importJson(JSON.stringify(bad))).toThrow(/editable GWAVE command/i);
  });

  it("rejects duplicate GWAVE override targets", () => {
    const dup = { ...gp, slots: [
      { kind: "gwave", name: "a", record: HBDV, start: HBDV, targetCmd: 0x05 },
      { kind: "gwave", name: "b", record: HBDV, start: HBDV, targetCmd: 0x05 },
    ]};
    expect(() => importJson(JSON.stringify(dup))).toThrow(/duplicate GWAVE override/i);
  });

  it("rejects a malformed GWAVE record (wrong length / out-of-range byte)", () => {
    expect(() => importJson(JSON.stringify({ ...gp, slots: [{ kind: "gwave", name: "x", record: [1,2,3], targetCmd: 0x05 }] }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...gp, slots: [{ kind: "gwave", name: "x", record: [1,2,3,4,5,6,256], targetCmd: 0x05 }] }))).toThrow(/bytes/i);
  });

  it("mixed VARI + GWAVE in one project round-trips", () => {
    const mixed: CustomProject = {
      ...project,
      slots: [
        { kind: "vari", name: "v", record: SAW, start: SAW },
        { kind: "gwave", name: "g", record: HBDV, start: HBDV, targetCmd: 0x05 },
      ],
    };
    const back = importJson(exportJson(mixed));
    expect(back.slots).toHaveLength(2);
    expect(back.slots[0]!.kind).toBe("vari");
    expect(back.slots[1]!.kind).toBe("gwave");
  });
});

describe("exportJson / importJson — LFSR slots (Phase 7)", () => {
  // LITE = 2 fields, APPEAR = 3, TURBO = 4. LAUNCH ($39) is Robotron-only.
  const lp: CustomProject = {
    name: "lightning",
    engineBase: "defender",
    slots: [
      { kind: "lfsr", name: "LITE", record: [1, 3], start: [1, 3], targetCmd: 0x11 },
      { kind: "lfsr", name: "TURBO", record: [0x20, 1, 1, 0xFF], start: [0x20, 1, 1, 0xFF], targetCmd: 0x14 },
    ],
    createdAt: 1, updatedAt: 2,
  };

  it("round-trips an LFSR project preserving targetCmd + record + name", () => {
    const back = importJson(exportJson(lp));
    expect(back.slots).toHaveLength(2);
    const lite = back.slots[0]!;
    expect(lite.kind).toBe("lfsr");
    expect(lite.name).toBe("LITE");
    expect(lite.record).toEqual([1, 3]);
    expect((lite as { targetCmd: number }).targetCmd).toBe(0x11);
    expect(back.slots[1]!.record).toEqual([0x20, 1, 1, 0xFF]);
  });

  it("accepts LAUNCH ($39) on Robotron but not on Defender", () => {
    const robo: CustomProject = { ...lp, engineBase: "robotron", slots: [{ kind: "lfsr", name: "LAUNCH", record: [0xFF, 0x60, 0xFF], start: [0xFF, 0x60, 0xFF], targetCmd: 0x39 }] };
    expect(importJson(exportJson(robo)).slots[0]!.name).toBe("LAUNCH");
    const bad: CustomProject = { ...lp, slots: [{ kind: "lfsr", name: "LAUNCH", record: [0xFF, 0x60, 0xFF], start: [0xFF, 0x60, 0xFF], targetCmd: 0x39 }] };
    expect(() => importJson(JSON.stringify(bad))).toThrow(/editable LFSR command/i);
  });

  it("rejects a wrong-length / out-of-range LFSR record", () => {
    // TURBO needs 4 values; 2 is wrong.
    expect(() => importJson(JSON.stringify({ ...lp, slots: [{ kind: "lfsr", name: "x", record: [1, 2], start: [1, 2], targetCmd: 0x14 }] }))).toThrow(/value/i);
    // NFRQ1 (field 2 of TURBO) is 16-bit; a byte field overflow is caught too.
    expect(() => importJson(JSON.stringify({ ...lp, slots: [{ kind: "lfsr", name: "x", record: [256, 1, 1, 1], start: [256, 1, 1, 1], targetCmd: 0x14 }] }))).toThrow(/value|range/i);
  });

  it("rejects duplicate LFSR override targets", () => {
    const dup: CustomProject = { ...lp, slots: [
      { kind: "lfsr", name: "a", record: [1, 3], start: [1, 3], targetCmd: 0x11 },
      { kind: "lfsr", name: "b", record: [1, 3], start: [1, 3], targetCmd: 0x11 },
    ] };
    expect(() => importJson(JSON.stringify(dup))).toThrow(/duplicate LFSR override/i);
  });

  it("mixes VARI + GWAVE + LFSR in one project", () => {
    const mixed: CustomProject = {
      name: "kitchen sink", engineBase: "defender",
      slots: [
        { kind: "vari", name: "v", record: SAW, start: SAW },
        { kind: "gwave", name: "g", record: HBDV, start: HBDV, targetCmd: 0x01 },
        { kind: "lfsr", name: "l", record: [9, 9, 9], start: [9, 9, 9], targetCmd: 0x15 },
      ],
      createdAt: 0, updatedAt: 0,
    };
    const back = importJson(exportJson(mixed));
    expect(back.slots.map((s) => s.kind)).toEqual(["vari", "gwave", "lfsr"]);
    expect(back.slots[2]!.record).toEqual([9, 9, 9]);
  });
});

describe("exportJson / importJson — FNOISE slots (Phase 8)", () => {
  // CANNON ($17) on Defender = 4 fields; Robotron CANNON = 5 (incl LOFRQ).
  const fp: CustomProject = {
    name: "noise", engineBase: "defender",
    slots: [{ kind: "fnoise", name: "CANNON", record: [1, 1, 255, 1000], start: [1, 1, 255, 1000], targetCmd: 0x17 }],
    createdAt: 1, updatedAt: 2,
  };

  it("round-trips a Defender FNOISE project (CANNON, 4 fields)", () => {
    const back = importJson(exportJson(fp));
    expect(back.slots[0]!.kind).toBe("fnoise");
    expect(back.slots[0]!.record).toEqual([1, 1, 255, 1000]);
    expect((back.slots[0] as { targetCmd: number }).targetCmd).toBe(0x17);
  });

  it("accepts BG1 ($0F) + HBOMB ($3E) on Robotron but not on Defender", () => {
    const robo: CustomProject = { ...fp, engineBase: "robotron", slots: [
      { kind: "fnoise", name: "HBOMB", record: [1, 1, 1, 0x40, 0x1000], start: [1, 1, 1, 0x40, 0x1000], targetCmd: 0x3E },
    ] };
    expect(importJson(exportJson(robo)).slots[0]!.name).toBe("HBOMB");
    const bad: CustomProject = { ...fp, slots: [{ kind: "fnoise", name: "BG1", record: [0], start: [0], targetCmd: 0x0F }] };
    expect(() => importJson(JSON.stringify(bad))).toThrow(/editable FNOISE command/i);
  });

  it("rejects a wrong-length FNOISE record + duplicate targets", () => {
    // Defender CANNON needs 4 values.
    expect(() => importJson(JSON.stringify({ ...fp, slots: [{ kind: "fnoise", name: "x", record: [1, 2], start: [1, 2], targetCmd: 0x17 }] }))).toThrow(/value/i);
    const dup: CustomProject = { ...fp, slots: [
      { kind: "fnoise", name: "a", record: [1, 1, 255, 1000], start: [1, 1, 255, 1000], targetCmd: 0x17 },
      { kind: "fnoise", name: "b", record: [1, 1, 255, 1000], start: [1, 1, 255, 1000], targetCmd: 0x17 },
    ] };
    expect(() => importJson(JSON.stringify(dup))).toThrow(/duplicate FNOISE override/i);
  });

  it("mixes all four engine kinds in one project", () => {
    const mixed: CustomProject = {
      name: "all", engineBase: "defender",
      slots: [
        { kind: "vari", name: "v", record: SAW, start: SAW },
        { kind: "gwave", name: "g", record: HBDV, start: HBDV, targetCmd: 0x01 },
        { kind: "lfsr", name: "l", record: [9, 9, 9], start: [9, 9, 9], targetCmd: 0x15 },
        { kind: "fnoise", name: "f", record: [3], start: [3], targetCmd: 0x16 },
      ],
      createdAt: 0, updatedAt: 0,
    };
    const back = importJson(exportJson(mixed));
    expect(back.slots.map((s) => s.kind)).toEqual(["vari", "gwave", "lfsr", "fnoise"]);
  });
});

describe("legacy v1 recipe migration (override-in-place)", () => {
  it("converts { baseGame, edits } to named VARI slots", () => {
    const legacy = JSON.stringify({ name: "old", baseGame: "defender", edits: { 29: SAW } }); // $1D = SAW
    const p = importJson(legacy);
    expect(p.engineBase).toBe("defender");
    expect(p.slots).toHaveLength(1);
    expect(p.slots[0]!.kind).toBe("vari");
    expect(p.slots[0]!.name).toBe("SAW");
    expect(p.slots[0]!.record).toEqual(SAW);
  });

  it("rejects a legacy recipe whose base game can't host VARI slots", () => {
    expect(() => importJson(JSON.stringify({ name: "r", baseGame: "robotron", edits: { 29: SAW } }))).toThrow(/VARI slots/i);
  });
});

describe("v2 on-disk migration (slots without `kind` are tagged VARI)", () => {
  it("a v2 project (slots have no kind) imports as all-VARI", () => {
    const v2 = JSON.stringify({
      name: "v2-project", engineBase: "defender",
      slots: [{ name: "Thunder", record: SAW }],
      createdAt: 1, updatedAt: 2,
    });
    const back = importJson(v2);
    expect(back.slots[0]!.kind).toBe("vari");
    expect(back.slots[0]!.record).toEqual(SAW);
  });
});

describe("exportJson / importJson — waveformOverrides (Phase 5 step 2)", () => {
  const FLAT8 = Array.from({ length: 8 }, () => 0x80);  // valid GS2 length
  const FLAT16 = Array.from({ length: 16 }, () => 0x40); // valid GS1 length

  it("round-trips a project that overrides one stock waveform", () => {
    const p: CustomProject = {
      name: "wf",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      waveformOverrides: { 0: FLAT8, 2: FLAT16 },
      createdAt: 100,
      updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.waveformOverrides).toEqual({ 0: FLAT8, 2: FLAT16 });
  });

  it("a project with no waveformOverrides has the field absent (not an empty object)", () => {
    const p: CustomProject = {
      name: "no-wf",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100,
      updatedAt: 200,
    };
    expect(importJson(exportJson(p)).waveformOverrides).toBeUndefined();
  });

  it("rejects malformed waveformOverrides (non-object, bad idx, wrong length, byte out of range)", () => {
    const base: CustomProject = {
      name: "wf-bad",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100, updatedAt: 200,
    };
    expect(() => importJson(JSON.stringify({ ...base, waveformOverrides: [1, 2, 3] }))).toThrow(/object/i);
    expect(() => importJson(JSON.stringify({ ...base, waveformOverrides: { 9: FLAT8 } }))).toThrow(/range/i);
    expect(() => importJson(JSON.stringify({ ...base, waveformOverrides: { 0: [1, 2, 3] } }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...base, waveformOverrides: { 0: [...FLAT8.slice(0, 7), 256] } }))).toThrow(/range/i);
  });

  it("permits a project with only waveformOverrides and no slots", () => {
    const p: CustomProject = {
      name: "wf-only",
      engineBase: "defender",
      slots: [],
      waveformOverrides: { 4: FLAT16 }, // override stock GSQ22
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.slots).toHaveLength(0);
    expect(back.waveformOverrides).toEqual({ 4: FLAT16 });
  });
});

describe("exportJson / importJson — patternOverrides (Phase 5 step 3)", () => {
  const BBSND_FLAT = Array.from({ length: 0x14 }, () => 0x20); // 20 bytes; covers BBSV's range

  it("round-trips a project that overrides one pitch pattern", () => {
    const p: CustomProject = {
      name: "pat",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      patternOverrides: { 0x47: BBSND_FLAT }, // BBSV's pattern range
      createdAt: 100,
      updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.patternOverrides).toEqual({ 0x47: BBSND_FLAT });
  });

  it("a project with no patternOverrides has the field absent", () => {
    const p: CustomProject = {
      name: "no-pat",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100,
      updatedAt: 200,
    };
    expect(importJson(exportJson(p)).patternOverrides).toBeUndefined();
  });

  it("rejects malformed patternOverrides (non-object, bad offset, wrong length, byte out of range, GFRTAB overrun)", () => {
    const base: CustomProject = {
      name: "pat-bad",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100, updatedAt: 200,
    };
    expect(() => importJson(JSON.stringify({ ...base, patternOverrides: [1, 2] }))).toThrow(/object/i);
    expect(() => importJson(JSON.stringify({ ...base, patternOverrides: { 256: BBSND_FLAT } }))).toThrow(/range/i);
    expect(() => importJson(JSON.stringify({ ...base, patternOverrides: { 0: [] } }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...base, patternOverrides: { 0: [...BBSND_FLAT.slice(0, 19), 256] } }))).toThrow(/range/i);
    // Defender GFRTAB safe-end is $A9 = 169; override at offset 100 length 100 overruns.
    const tooLong = Array.from({ length: 100 }, () => 0);
    expect(() => importJson(JSON.stringify({ ...base, patternOverrides: { 100: tooLong } }))).toThrow(/GFRTAB|past/i);
  });

  it("permits a project with only patternOverrides and no slots", () => {
    const p: CustomProject = {
      name: "pat-only",
      engineBase: "defender",
      slots: [],
      patternOverrides: { 0x47: BBSND_FLAT },
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.slots).toHaveLength(0);
    expect(back.patternOverrides).toEqual({ 0x47: BBSND_FLAT });
  });

  it("a mixed project carries every override channel through the round-trip", () => {
    const FLAT16 = Array.from({ length: 16 }, () => 0x40);
    const p: CustomProject = {
      name: "mixed",
      engineBase: "defender",
      slots: [
        { kind: "vari", name: "v", record: SAW, start: SAW },
        { kind: "gwave", name: "g", record: HBDV, start: HBDV, targetCmd: 0x05 },
      ],
      waveformOverrides: { 4: FLAT16 },
      patternOverrides: { 0x47: BBSND_FLAT },
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.slots).toHaveLength(2);
    expect(back.waveformOverrides).toEqual({ 4: FLAT16 });
    expect(back.patternOverrides).toEqual({ 0x47: BBSND_FLAT });
  });
});

describe("exportJson / importJson — addedWaveforms (Phase 5 step 4)", () => {
  const W16 = Array.from({ length: 16 }, (_, i) => i * 16); // 16-byte ramp

  it("round-trips a project that adds one new waveform", () => {
    const p: CustomProject = {
      name: "added",
      engineBase: "defender",
      slots: [],
      addedWaveforms: [W16],
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.addedWaveforms).toEqual([W16]);
  });

  it("absent field stays absent (not an empty array) on a project without added waves", () => {
    const p: CustomProject = {
      name: "no-added",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100, updatedAt: 200,
    };
    expect(importJson(exportJson(p)).addedWaveforms).toBeUndefined();
  });

  it("rejects malformed addedWaveforms (non-array, too many entries, bad lengths, bad bytes)", () => {
    const base: CustomProject = {
      name: "bad-added",
      engineBase: "defender",
      slots: [{ kind: "vari", name: "v", record: SAW, start: SAW }],
      createdAt: 100, updatedAt: 200,
    };
    expect(() => importJson(JSON.stringify({ ...base, addedWaveforms: "nope" }))).toThrow(/array/i);
    expect(() => importJson(JSON.stringify({ ...base, addedWaveforms: Array.from({ length: 10 }, () => W16) }))).toThrow(/9 added|nybble/i);
    expect(() => importJson(JSON.stringify({ ...base, addedWaveforms: [[]] }))).toThrow(/1\.\.255/);
    expect(() => importJson(JSON.stringify({ ...base, addedWaveforms: [Array.from({ length: 256 }, () => 0)] }))).toThrow(/1\.\.255/);
    expect(() => importJson(JSON.stringify({ ...base, addedWaveforms: [[1, 2, 256]] }))).toThrow(/range/i);
  });

  it("permits a project with only an added waveform (no slots, no other overrides)", () => {
    const p: CustomProject = {
      name: "wave-only",
      engineBase: "defender",
      slots: [],
      addedWaveforms: [W16],
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.slots).toHaveLength(0);
    expect(back.addedWaveforms).toEqual([W16]);
  });

  it("a fully-loaded project (slots + every override channel + added waves) round-trips", () => {
    const FLAT16 = Array.from({ length: 16 }, () => 0x40);
    const BBSND_FLAT = Array.from({ length: 0x14 }, () => 0x20);
    const p: CustomProject = {
      name: "kitchen-sink",
      engineBase: "defender",
      slots: [
        { kind: "vari", name: "v", record: SAW, start: SAW },
        { kind: "gwave", name: "g", record: HBDV, start: HBDV, targetCmd: 0x05 },
      ],
      waveformOverrides: { 4: FLAT16 },
      patternOverrides: { 0x47: BBSND_FLAT },
      addedWaveforms: [W16],
      createdAt: 100, updatedAt: 200,
    };
    const back = importJson(exportJson(p));
    expect(back.slots).toHaveLength(2);
    expect(back.waveformOverrides).toEqual({ 4: FLAT16 });
    expect(back.patternOverrides).toEqual({ 0x47: BBSND_FLAT });
    expect(back.addedWaveforms).toEqual([W16]);
  });
});
