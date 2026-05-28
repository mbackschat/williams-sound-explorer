/**
 * The GWAVE parameter-record editor panel — nine labelled sliders over a
 * command's 7-byte SVTAB record, plus a **click-to-draw waveform canvas**
 * (Phase 5 step 2) showing the resolved bytes of the slot's current WAVE#.
 *
 *   byte 0 → GECHO (hi) + GCCNT (lo)
 *   byte 1 → GECDEC (hi) + WAVE# (lo)
 *   bytes 2..6 → PRDECA, GDFINC, GDCNT, PATLEN, PATOFF (whole bytes)
 *
 * The waveform canvas displays whichever WAVE# the slot's record currently
 * points at — switching the WAVE# slider re-renders the canvas to that
 * waveform's bytes.  Drawing on the canvas emits `onWaveformDraw(idx, bytes)`;
 * the host (`designerMode.ts`) writes those into the project-level
 * `waveformOverrides` and re-builds the custom ROM (audition replays).
 *
 * Same shape as `variEditor.ts` so `designerMode.ts` can swap editors on
 * slot selection.  The host owns the record; this panel is a pure view that
 * fires its callbacks per slider tweak / per canvas stroke.
 */
import { GWAVE_FIELDS, getField, setField, STOCK_WAVE_NAMES, STOCK_WAVE_LENGTHS, type GWaveField } from "../../engine/gwaveEdit.ts";

export interface GWaveEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Seed every slider from a 7-byte record. */
  setRecord(record: number[]): void;
  /** The current 7-byte record. */
  getRecord(): number[];
  /**
   * Update the waveform canvas with the resolved bytes for the current
   * WAVE# (either stock from the base ROM or the user's project-level
   * override), plus the list of commands that share this waveform.
   */
  setWaveform(bytes: number[], sharedBy: { cmd: number; name: string }[], isOverridden: boolean): void;
  /** Current WAVE# (from the record's byte-1 low nybble) — convenience for the host. */
  currentWaveIdx(): number;
}

function fmtValue(field: GWaveField, value: number): string {
  if (field.label === "WAVE#") {
    const name = STOCK_WAVE_NAMES[value] ?? "?";
    return `${value} (${name})`;
  }
  const hex = `$${value.toString(16).toUpperCase().padStart(field.packing === "byte" ? 2 : 1, "0")}`;
  if (field.signed && field.packing === "byte" && value > 0x7F) return `${hex} (${value - 0x100})`;
  return hex;
}

export function buildGWaveEditor(
  onRecordChange: (record: number[]) => void,
  onWaveformDraw: (idx: number, bytes: number[]) => void,
  onWaveformReset: (idx: number) => void,
): GWaveEditorApi {
  let record: number[] = new Array(7).fill(0);

  const el = document.createElement("div");
  el.className = "param-sliders designer-fields designer-fields-gwave";

  // ── Slider panel (Phase 5 step 1) ───────────────────────────────────────
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
      onRecordChange([...record]);
    });

    row.append(label, slider, value);
    el.append(row);
    return { field, slider, value };
  });

  function refreshSliders(): void {
    for (const { field, slider, value } of rows) {
      const v = getField(record, field);
      slider.value = String(v);
      value.textContent = fmtValue(field, v);
    }
  }

  const currentWaveIdx = (): number => (record[1] ?? 0) & 0x0F;

  // ── Waveform canvas (Phase 5 step 2) ────────────────────────────────────
  // `wfBytes` is the bytes currently SHOWN on the canvas — these are passed
  // in by the host (either stock GWVTAB bytes or the project's override).
  // The canvas draws them as bars; drawing emits `onWaveformDraw(idx, bytes)`.
  let wfBytes: number[] = [];
  let wfIdxAtPaint = 0; // the idx the canvas was last seeded for

  const canvasHost = document.createElement("div");
  canvasHost.className = "designer-wfcanvas-host";

  const canvasLabel = document.createElement("div");
  canvasLabel.className = "designer-wfcanvas-label";

  const canvas = document.createElement("canvas") as HTMLCanvasElement;
  canvas.className = "designer-wfcanvas";
  canvas.width = 560;   // 2× CSS size (deviceScaleFactor 2 friendly)
  canvas.height = 200;
  canvas.style.width = "280px";
  canvas.style.height = "100px";

  const sharedRow = document.createElement("div");
  sharedRow.className = "designer-wfcanvas-shared";

  const resetBtn = document.createElement("button");
  resetBtn.className = "designer-wfcanvas-reset";
  resetBtn.textContent = "Reset to stock";
  resetBtn.title = "Revert this waveform's bytes to the base ROM's original (clears the project's override for this WAVE#).";
  resetBtn.addEventListener("click", () => onWaveformReset(currentWaveIdx()));

  canvasHost.append(canvasLabel, canvas, sharedRow, resetBtn);
  el.append(canvasHost);

  function redrawCanvas(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, W, H);
    if (wfBytes.length === 0) return;
    const n = wfBytes.length;
    const cellW = W / n;
    // Mid line at 128 — wave bytes are unsigned 0..255, centred visually at 128.
    ctx.strokeStyle = "#2a2f37";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    // Filled bars from the mid line — purple to match the GWAVE accent.
    ctx.fillStyle = "#b78ff5";
    for (let i = 0; i < n; i++) {
      const v = wfBytes[i]! & 0xFF;
      const y = ((255 - v) / 255) * H;
      const top = Math.min(y, H / 2);
      const bot = Math.max(y, H / 2);
      ctx.fillRect(i * cellW + 0.5, top, Math.max(1, cellW - 1), bot - top);
    }
  }

  /** Convert a mouse event's coordinates → (sampleIndex, byteValue). */
  function pickAt(ev: MouseEvent): { i: number; v: number } | null {
    if (wfBytes.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const xCss = ev.clientX - rect.left;
    const yCss = ev.clientY - rect.top;
    const i = Math.max(0, Math.min(wfBytes.length - 1, Math.floor((xCss / rect.width) * wfBytes.length)));
    const v = Math.max(0, Math.min(255, Math.round(255 - (yCss / rect.height) * 255)));
    return { i, v };
  }

  let drawing = false;
  function applyAt(ev: MouseEvent): void {
    const p = pickAt(ev);
    if (!p) return;
    if (wfBytes[p.i] === p.v) return;
    wfBytes[p.i] = p.v;
    redrawCanvas();
    onWaveformDraw(wfIdxAtPaint, [...wfBytes]);
  }
  canvas.addEventListener("mousedown", (ev: MouseEvent) => {
    drawing = true;
    applyAt(ev);
    ev.preventDefault();
  });
  window.addEventListener("mousemove", (ev: MouseEvent) => {
    if (drawing) applyAt(ev);
  });
  window.addEventListener("mouseup", () => { drawing = false; });

  function setWaveform(bytes: number[], sharedBy: { cmd: number; name: string }[], isOverridden: boolean): void {
    wfBytes = [...bytes];
    wfIdxAtPaint = currentWaveIdx();
    const name = STOCK_WAVE_NAMES[wfIdxAtPaint] ?? "?";
    const overrideMark = isOverridden ? " · edited" : "";
    canvasLabel.textContent = `Waveform — ${wfIdxAtPaint} ${name} (${STOCK_WAVE_LENGTHS[wfIdxAtPaint] ?? "?"} bytes)${overrideMark}`;
    canvasLabel.dataset.overridden = isOverridden ? "1" : "0";
    // "Shared by" — every editable GWAVE command that points at this idx via
    // its SVTAB byte-1 low nybble.  The user's current edit affects all of
    // them, so the warning is the right place to say so.
    if (sharedBy.length === 0) {
      sharedRow.textContent = "No editable GWAVE commands currently use this waveform.";
    } else {
      const labels = sharedBy.map((s) => `$${s.cmd.toString(16).toUpperCase().padStart(2, "0")} ${s.name}`).join(", ");
      sharedRow.innerHTML = `<span class="designer-bar-label">Shared by:</span> ${labels} — your edits affect every one.`;
    }
    resetBtn.disabled = !isOverridden;
    redrawCanvas();
  }

  return {
    el,
    setRecord(rec: number[]): void {
      record = [...rec];
      refreshSliders();
    },
    getRecord: () => [...record],
    setWaveform,
    currentWaveIdx,
  };
}
