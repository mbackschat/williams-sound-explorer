/**
 * The VARI parameter-record editor panel — eight labelled sliders (one per
 * logical field; SWPDT is 16-bit) over a command's 9-byte VVECT record.
 *
 * Reuses the explore UI's `.param-row` markup/CSS so the sliders look and feel
 * like the Pattern 5 force-sliders.  It is a pure view over a working record:
 * `setRecord` seeds the sliders, edits fire `onChange(record)`, and the host
 * (`designerMode.ts`) decides what to do with the new bytes.
 */
import { VARI_FIELDS, getField, setField, type VariField } from "../../engine/variEdit.ts";

export interface VariEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Seed every slider from a 9-byte record. */
  setRecord(record: number[]): void;
  /** The current 9-byte record. */
  getRecord(): number[];
}

function fmtValue(field: VariField, value: number): string {
  const hex = `$${value.toString(16).toUpperCase().padStart(field.width * 2, "0")}`;
  if (field.signed && field.width === 1 && value > 0x7F) return `${hex} (${value - 0x100})`;
  return hex;
}

export function buildVariEditor(onChange: (record: number[]) => void): VariEditorApi {
  let record: number[] = new Array(9).fill(0);

  const el = document.createElement("div");
  el.className = "param-sliders designer-fields";

  const rows = VARI_FIELDS.map((field) => {
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
