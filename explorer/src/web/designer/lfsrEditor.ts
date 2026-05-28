/**
 * The LFSR parameter editor panel — a set of labelled sliders, one per field
 * the selected command actually sets.  Unlike VARI (a fixed 9-field record) or
 * GWAVE (a fixed 9-field record + canvases), the LFSR family exposes a
 * *different* field set per sound: LITE has 2 (DFREQ, CYCNT), APPEAR / LAUNCH
 * have 3 (DFREQ, LFREQ, CYCNT), TURBO has 4 (CYCNT/NFFLG, DECAY, NFRQ1, NAMP).
 * So this panel rebuilds its sliders whenever the selected command changes
 * (`setFields`), then seeds them from the slot's virtual record (`setRecord`).
 *
 * It is a pure view: edits fire `onChange(record)` with the current field
 * values (in field order), and the host (`designerMode.ts`) decides what to do.
 * Reuses the explore UI's `.param-row` markup/CSS like the VARI/GWAVE editors.
 */
import type { LfsrField } from "../../engine/lfsrEdit.ts";

export interface LfsrEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Rebuild the sliders for a command's field layout (call before `setRecord`). */
  setFields(fields: readonly LfsrField[]): void;
  /** Seed every slider from a virtual record (one value per current field). */
  setRecord(record: number[]): void;
  /** The current virtual record. */
  getRecord(): number[];
}

function fmtValue(field: LfsrField, value: number): string {
  const hex = `$${value.toString(16).toUpperCase().padStart(field.width * 2, "0")}`;
  if (field.signed && field.width === 1 && value > 0x7F) return `${hex} (${value - 0x100})`;
  return hex;
}

export function buildLfsrEditor(onChange: (record: number[]) => void): LfsrEditorApi {
  let fields: readonly LfsrField[] = [];
  let record: number[] = [];
  let rows: { field: LfsrField; slider: HTMLInputElement; value: HTMLSpanElement }[] = [];

  const el = document.createElement("div");
  el.className = "param-sliders designer-fields";

  function rebuild(): void {
    el.replaceChildren();
    rows = fields.map((field, i) => {
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
        record[i] = v;
        value.textContent = fmtValue(field, v);
        onChange([...record]);
      });

      row.append(label, slider, value);
      el.append(row);
      return { field, slider, value };
    });
  }

  function refresh(): void {
    for (let i = 0; i < rows.length; i++) {
      const { field, slider, value } = rows[i]!;
      const v = record[i] ?? 0;
      slider.value = String(v);
      value.textContent = fmtValue(field, v);
    }
  }

  return {
    el,
    setFields(f: readonly LfsrField[]): void {
      fields = f;
      record = new Array(f.length).fill(0);
      rebuild();
    },
    setRecord(rec: number[]): void {
      record = [...rec];
      refresh();
    },
    getRecord: () => [...record],
  };
}
