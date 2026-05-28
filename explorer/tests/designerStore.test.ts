/**
 * Designer project JSON export/import (the saveable artefact) for the
 * own-item-list `CustomProject` shape, plus legacy v1 conversion.
 *
 * IndexedDB CRUD is browser-only and untested here; these cover the pure
 * serialise / parse-and-validate path (the import-failure surface a user hits)
 * and the v1→CustomProject migration.
 */
import { describe, expect, it } from "vitest";
import { exportJson, importJson, type CustomProject } from "../src/web/designer/designerStore.ts";
import { maxSlots } from "../src/engine/customRom.ts";

const SAW = [0x40, 0x01, 0x00, 0x10, 0xE1, 0x00, 0x80, 0xFF, 0xFF];
const project: CustomProject = {
  name: "My game",
  engineBase: "defender",
  slots: [{ name: "Thunder", record: SAW, start: SAW }],
  createdAt: 100,
  updatedAt: 200,
};

describe("exportJson / importJson (CustomProject)", () => {
  it("round-trips a project (name, engineBase, named slots preserved)", () => {
    const back = importJson(exportJson(project));
    expect(back.name).toBe("My game");
    expect(back.engineBase).toBe("defender");
    expect(back.slots).toHaveLength(1);
    expect(back.slots[0]!.name).toBe("Thunder");
    expect(back.slots[0]!.record).toEqual(SAW);
    expect(back.slots[0]!.start).toEqual(SAW);
    expect(back.createdAt).toBe(100); // preserved
  });

  it("exported JSON carries no ROM-byte blob — only parameter values", () => {
    expect(exportJson(project)).not.toMatch(/bytes|ArrayBuffer|\brom\b/i);
  });

  it("defaults a slot's `start` to its record when absent", () => {
    const back = importJson(JSON.stringify({ ...project, slots: [{ name: "x", record: SAW }] }));
    expect(back.slots[0]!.start).toEqual(SAW);
  });

  it("rejects non-JSON, a missing name, and a bad engine base", () => {
    expect(() => importJson("{nope")).toThrow(/JSON/i);
    expect(() => importJson(JSON.stringify({ ...project, name: "" }))).toThrow(/name/i);
    expect(() => importJson(JSON.stringify({ ...project, engineBase: "robotron" }))).toThrow(/engine base/i);
  });

  it("rejects malformed slots and over-capacity projects", () => {
    expect(() => importJson(JSON.stringify({ ...project, slots: [{ name: "x", record: [1, 2, 3] }] }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...project, slots: [{ record: SAW }] }))).toThrow(/name/i);
    const tooMany = Array.from({ length: maxSlots("defender") + 1 }, (_, i) => ({ name: `s${i}`, record: SAW, start: SAW }));
    expect(() => importJson(JSON.stringify({ ...project, slots: tooMany }))).toThrow(/too many/i);
  });
});

describe("legacy v1 recipe migration", () => {
  it("converts { baseGame, edits } to named slots", () => {
    const legacy = JSON.stringify({ name: "old", baseGame: "defender", edits: { 29: SAW } }); // $1D = SAW
    const p = importJson(legacy);
    expect(p.engineBase).toBe("defender");
    expect(p.slots).toHaveLength(1);
    expect(p.slots[0]!.name).toBe("SAW");
    expect(p.slots[0]!.record).toEqual(SAW);
  });

  it("rejects a legacy recipe whose base game can't be a custom-ROM engine base", () => {
    expect(() => importJson(JSON.stringify({ name: "r", baseGame: "robotron", edits: { 29: SAW } }))).toThrow(/engine base/i);
  });
});
