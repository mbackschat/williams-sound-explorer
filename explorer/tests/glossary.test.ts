/**
 * Glossary term lookup — `lookupTerm` must resolve mixed-case keys.
 *
 * Regression: it used to uppercase the query (`terms[term.toUpperCase()]`),
 * which silently missed every key that isn't all-caps — e.g. "duty cycle",
 * "mid-rail", "phase accumulator", and even the long-standing "BRA-self".
 */
import { describe, expect, it } from "vitest";
import { lookupTerm, type Glossary, type TermEntry } from "../src/web/glossary.ts";

const term = (title: string): TermEntry => ({ title, what: "w", how: "h", where: "e" });

function fixture(): Glossary {
  return {
    defender: {},
    stargate: {},
    robotron: {},
    terms: {
      DAC: term("DAC — digital-to-analog converter"),
      "BRA-self": term("BRA-self idle loop"),
      "duty cycle": term("duty cycle — high-fraction"),
      "6802": term("6802 — the sound CPU"),
    },
  };
}

describe("lookupTerm", () => {
  it("resolves an all-uppercase key (legacy form)", () => {
    expect(lookupTerm(fixture(), "DAC")?.title).toContain("DAC");
  });

  it("resolves an uppercase key from a lowercase query", () => {
    expect(lookupTerm(fixture(), "dac")?.title).toContain("DAC");
  });

  it("resolves a mixed-case key exactly (regression)", () => {
    expect(lookupTerm(fixture(), "duty cycle")?.title).toContain("duty cycle");
    expect(lookupTerm(fixture(), "BRA-self")?.title).toContain("BRA-self");
  });

  it("is case-insensitive for mixed-case keys", () => {
    expect(lookupTerm(fixture(), "Duty Cycle")?.title).toContain("duty cycle");
    expect(lookupTerm(fixture(), "bra-self")?.title).toContain("BRA-self");
  });

  it("resolves a digit-leading key", () => {
    expect(lookupTerm(fixture(), "6802")?.title).toContain("6802");
  });

  it("returns undefined for an unknown term", () => {
    expect(lookupTerm(fixture(), "nope")).toBeUndefined();
  });

  it("returns undefined when there are no terms", () => {
    expect(lookupTerm({ defender: {}, stargate: {}, robotron: {}, terms: {} }, "DAC")).toBeUndefined();
  });
});
