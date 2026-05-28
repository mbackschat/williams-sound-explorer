/**
 * The GWAVE parameter-record editor panel — nine labelled sliders over a
 * command's 7-byte SVTAB record.  Two of the bytes (0 and 1) are nybble-packed
 * so the panel has more logical fields than bytes:
 *
 *   byte 0 → GECHO (hi) + GCCNT (lo)
 *   byte 1 → GECDEC (hi) + WAVE# (lo)
 *   bytes 2..6 → PRDECA, GDFINC, GDCNT, PATLEN, PATOFF (whole bytes)
 *
 * Same shape as `variEditor.ts` so `designerMode.ts` can swap editors on slot
 * selection.  The host owns the record; this panel is a pure view that fires
 * `onChange(record)` per slider tweak.
 */
import { GWAVE_FIELDS, getField, setField, type GWaveField } from "../../engine/gwaveEdit.ts";

export interface GWaveEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Seed every slider from a 7-byte record. */
  setRecord(record: number[]): void;
  /** The current 7-byte record. */
  getRecord(): number[];
}

const STOCK_WAVE_NAMES = ["GS2", "GSSQ2", "GS1", "GS12", "GSQ22", "GS72", "GS1.7"] as const;

function fmtValue(field: GWaveField, value: number): string {
  if (field.label === "WAVE#") {
    const name = STOCK_WAVE_NAMES[value] ?? "?";
    return `${value} (${name})`;
  }
  const hex = `$${value.toString(16).toUpperCase().padStart(field.packing === "byte" ? 2 : 1, "0")}`;
  if (field.signed && field.packing === "byte" && value > 0x7F) return `${hex} (${value - 0x100})`;
  return hex;
}

export function buildGWaveEditor(onChange: (record: number[]) => void): GWaveEditorApi {
  let record: number[] = new Array(7).fill(0);

  const el = document.createElement("div");
  el.className = "param-sliders designer-fields designer-fields-gwave";

  const rows = GWAVE_FIELDS.map((field) => {
    const row = document.createElement("div");
    row.className = "param-row";
    row.title = field.help;

    const label = document.createElement("span");
    label.className = "param-label";
    label.textContent = field.label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "param-slider";
    slider.min = String(field.min);
    slider.max = String(field.max);
    slider.step = "1";

    const value = document.createElement("span");
    value.className = "param-value";

    slider.addEventListener("input", () => {
      const v = Number.parseInt(slider.value, 10);
      record = setField(record, field, v);
      value.textContent = fmtValue(field, v);
      onChange([...record]);
    });

    row.append(label, slider, value);
    el.append(row);
    return { field, slider, value };
  });

  function refresh(): void {
    for (const { field, slider, value } of rows) {
      const v = getField(record, field);
      slider.value = String(v);
      value.textContent = fmtValue(field, v);
    }
  }

  return {
    el,
    setRecord(rec: number[]): void {
      record = [...rec];
      refresh();
    },
    getRecord: () => [...record],
  };
}
