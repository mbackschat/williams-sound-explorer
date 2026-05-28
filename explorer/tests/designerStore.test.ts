/**
 * Designer project JSON export/import (the saveable artefact).
 *
 * IndexedDB CRUD is browser-only and untested here; these cover the pure
 * serialise/parse-and-validate path, which is the import-failure surface a
 * user actually hits (hand-edited or shared JSON).
 */
import { describe, expect, it } from "vitest";
import { exportJson, importJson } from "../src/web/designer/designerStore.ts";
import type { VariRecipe } from "../src/engine/variEdit.ts";

const recipe: VariRecipe = {
  name: "My zap",
  baseGame: "defender",
  edits: { 0x1D: [0x40, 0x01, 0x00, 0x10, 0xE1, 0x00, 0x80, 0xFF, 0xFF] },
  createdAt: 100,
  updatedAt: 200,
};

describe("exportJson / importJson", () => {
  it("round-trips a valid project (name, baseGame, edits preserved)", () => {
    const back = importJson(exportJson(recipe));
    expect(back.name).toBe("My zap");
    expect(back.baseGame).toBe("defender");
    expect(back.edits[0x1D]).toEqual(recipe.edits[0x1D]);
    expect(back.createdAt).toBe(100); // preserved
    expect(back.updatedAt).toBeGreaterThanOrEqual(200); // stamped fresh on import
  });

  it("exported JSON contains no ROM-byte blob — only parameter values", () => {
    const json = exportJson(recipe);
    expect(json).not.toMatch(/bytes|ArrayBuffer|rom/i);
  });

  it("rejects non-JSON", () => {
    expect(() => importJson("{not json")).toThrow(/JSON/i);
  });

  it("rejects an unknown base game", () => {
    expect(() => importJson(JSON.stringify({ ...recipe, baseGame: "pacman" }))).toThrow(/base game/i);
  });

  it("rejects a command that isn't VARI-editable on the base game", () => {
    expect(() => importJson(JSON.stringify({ ...recipe, edits: { 0x11: recipe.edits[0x1D] } }))).toThrow(/VARI/i);
    // MOSQTO ($3F) is Robotron-only — invalid under a Defender base
    expect(() => importJson(JSON.stringify({ ...recipe, edits: { 0x3F: recipe.edits[0x1D] } }))).toThrow();
  });

  it("rejects a record that is not 9 bytes (or out of range)", () => {
    expect(() => importJson(JSON.stringify({ ...recipe, edits: { 0x1D: [1, 2, 3] } }))).toThrow(/bytes/i);
    expect(() => importJson(JSON.stringify({ ...recipe, edits: { 0x1D: [0, 0, 0, 0, 0, 0, 0, 0, 999] } }))).toThrow();
  });

  it("rejects a missing name", () => {
    expect(() => importJson(JSON.stringify({ ...recipe, name: "" }))).toThrow(/name/i);
  });
});
