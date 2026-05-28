/**
 * A generic per-command slider panel, shared by the LFSR (Phase 7) and FNOISE
 * (Phase 8) editors.  Both engines store their parameters as a *virtual record*
 * — a per-command ordered list of logical field values, where the field roster
 * differs per sound (LITE has 2 fields, TURBO 4; FNOISE's CANNON has 4, THRUST
 * 1, …).  So this panel rebuilds its sliders whenever the selected command
 * changes (`setFields`), then seeds them from the slot's record (`setRecord`).
 *
 * It is a pure view: edits fire `onChange(record)` with the current field
 * values (in field order); the host (`designerMode.ts`) decides what to do.
 * Reuses the explore UI's `.param-row` markup/CSS like the VARI/GWAVE editors.
 *
 * The field type is intentionally structural (`SliderFieldSpec`) so both
 * `LfsrField` and `FnoiseField` satisfy it without a shared base import.
 */

/** The render-relevant subset of an LFSR/FNOISE field descriptor. */
export interface SliderFieldSpec {
  label: string;
  /** 1 = byte, 2 = 16-bit (the readout widens accordingly). */
  width: 1 | 2;
  signed: boolean;
  min: number;
  max: number;
  help: string;
}

export interface FieldSliderEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Rebuild the sliders for a command's field layout (call before `setRecord`). */
  setFields(fields: readonly SliderFieldSpec[]): void;
  /** Seed every slider from a virtual record (one value per current field). */
  setRecord(record: number[]): void;
  /** The current virtual record. */
  getRecord(): number[];
}

function fmtValue(field: SliderFieldSpec, value: number): string {
  const hex = `$${value.toString(16).toUpperCase().padStart(field.width * 2, "0")}`;
  if (field.signed && field.width === 1 && value > 0x7F) return `${hex} (${value - 0x100})`;
  return hex;
}

export function buildFieldSliderEditor(onChange: (record: number[]) => void): FieldSliderEditorApi {
  let fields: readonly SliderFieldSpec[] = [];
  let record: number[] = [];
  let rows: { field: SliderFieldSpec; slider: HTMLInputElement; value: HTMLSpanElement }[] = [];

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
    setFields(f: readonly SliderFieldSpec[]): void {
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
