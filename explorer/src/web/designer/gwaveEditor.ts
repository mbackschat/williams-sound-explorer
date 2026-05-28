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
  /** The slider panel (SVTAB record editor) — column 1 in the GWAVE 3-column layout. */
  slidersEl: HTMLElement;
  /** The waveform-canvas panel (label + canvas + Shared-by + Reset) — column 2. */
  waveformPanelEl: HTMLElement;
  /** The pitch-pattern-canvas panel (label + canvas + Shared-by + Reset) — column 3. */
  patternPanelEl: HTMLElement;
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
  /**
   * Update the pitch-pattern canvas with the resolved bytes at the slot's
   * current (PATOFF, PATLEN) — either stock from the base ROM or the
   * project's pattern override.  `sharedBy` lists editable commands whose
   * pattern range overlaps the slot's range.
   */
  setPattern(bytes: number[], sharedBy: { cmd: number; name: string }[], isOverridden: boolean): void;
  /** Current WAVE# (from the record's byte-1 low nybble) — convenience for the host. */
  currentWaveIdx(): number;
  /** Current pitch-pattern offset (SVTAB byte 6). */
  currentPatternOffset(): number;
  /** Current pitch-pattern length (SVTAB byte 5). */
  currentPatternLength(): number;
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
  onPatternDraw: (offset: number, bytes: number[]) => void,
  onPatternReset: (offset: number) => void,
): GWaveEditorApi {
  let record: number[] = new Array(7).fill(0);

  // The sliders, waveform canvas, and pitch canvas now live in separate
  // DOM trees so the host (`designerMode.ts`) can place them in a 3-column
  // layout (sliders | waveform | pitch).  See `.designer-edit-row-gwave`
  // in `designer.css`.
  const slidersEl = document.createElement("div");
  slidersEl.className = "param-sliders designer-fields designer-fields-gwave";

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
    slidersEl.append(row);
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
  // Internal resolution is sized for the *max* CSS width the canvas can grow
  // to (~600 px) at 2× device pixel ratio.  CSS sets the display size to
  // `width: 100%` so the canvas fills its grid cell; cells auto-scale.
  canvas.width = 1200;
  canvas.height = 200;

  const sharedRow = document.createElement("div");
  sharedRow.className = "designer-wfcanvas-shared";

  const resetBtn = document.createElement("button");
  resetBtn.className = "designer-wfcanvas-reset";
  resetBtn.textContent = "Reset to stock";
  resetBtn.title = "Revert this waveform's bytes to the base ROM's original (clears the project's override for this WAVE#).";
  resetBtn.addEventListener("click", () => onWaveformReset(currentWaveIdx()));

  canvasHost.append(canvasLabel, canvas, sharedRow, resetBtn);
  // `canvasHost` is now `waveformPanelEl` (column 2 of the GWAVE edit row).

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

  // ── Pitch-pattern canvas (Phase 5 step 3) ───────────────────────────────
  // Below the waveform canvas, a second click-to-draw canvas shows the
  // resolved bytes at the slot's current PATOFF / PATLEN — either stock
  // GFRTAB bytes or the project's pattern override.  Drawing emits
  // `onPatternDraw(offset, bytes)`; the host writes those into
  // `project.patternOverrides[offset]` and rebuilds the custom ROM.
  let patBytes: number[] = [];
  let patOffsetAtPaint = 0; // PATOFF when the canvas was last seeded
  const currentPatternOffset = (): number => (record[6] ?? 0) & 0xFF;
  const currentPatternLength = (): number => (record[5] ?? 0) & 0xFF;

  const patHost = document.createElement("div");
  patHost.className = "designer-patcanvas-host";

  const patLabel = document.createElement("div");
  patLabel.className = "designer-patcanvas-label";

  const patCanvas = document.createElement("canvas") as HTMLCanvasElement;
  patCanvas.className = "designer-patcanvas";
  patCanvas.width = 1200;
  patCanvas.height = 200;

  const patShared = document.createElement("div");
  patShared.className = "designer-patcanvas-shared";

  const patResetBtn = document.createElement("button");
  patResetBtn.className = "designer-patcanvas-reset";
  patResetBtn.textContent = "Reset to stock";
  patResetBtn.title = "Revert this pattern's bytes to the base ROM's original (clears the project's override at this PATOFF).";
  patResetBtn.addEventListener("click", () => onPatternReset(currentPatternOffset()));

  patHost.append(patLabel, patCanvas, patShared, patResetBtn);
  // `patHost` is now `patternPanelEl` (column 3 of the GWAVE edit row).

  function redrawPatCanvas(): void {
    const ctx = patCanvas.getContext("2d");
    if (!ctx) return;
    const W = patCanvas.width, H = patCanvas.height;
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, W, H);
    if (patBytes.length === 0) {
      ctx.fillStyle = "#6b7280";
      ctx.font = "20px ui-monospace";
      ctx.textAlign = "center";
      ctx.fillText("(PATLEN = 0 — no pattern)", W / 2, H / 2);
      return;
    }
    const n = patBytes.length;
    const cellW = W / n;
    // Mid line — patterns are unsigned 0..255 like waveforms; show bars from $80.
    ctx.strokeStyle = "#2a2f37";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    // Filled bars in a contrasting teal-ish hue so the pattern canvas reads
    // distinct from the purple waveform canvas above it.
    ctx.fillStyle = "#7fc1ce";
    for (let i = 0; i < n; i++) {
      const v = patBytes[i]! & 0xFF;
      const y = ((255 - v) / 255) * H;
      const top = Math.min(y, H / 2);
      const bot = Math.max(y, H / 2);
      ctx.fillRect(i * cellW + 0.5, top, Math.max(1, cellW - 1), bot - top);
    }
  }

  function patPickAt(ev: MouseEvent): { i: number; v: number } | null {
    if (patBytes.length === 0) return null;
    const rect = patCanvas.getBoundingClientRect();
    const xCss = ev.clientX - rect.left;
    const yCss = ev.clientY - rect.top;
    const i = Math.max(0, Math.min(patBytes.length - 1, Math.floor((xCss / rect.width) * patBytes.length)));
    const v = Math.max(0, Math.min(255, Math.round(255 - (yCss / rect.height) * 255)));
    return { i, v };
  }

  let patDrawing = false;
  function patApplyAt(ev: MouseEvent): void {
    const p = patPickAt(ev);
    if (!p) return;
    if (patBytes[p.i] === p.v) return;
    patBytes[p.i] = p.v;
    redrawPatCanvas();
    onPatternDraw(patOffsetAtPaint, [...patBytes]);
  }
  patCanvas.addEventListener("mousedown", (ev: MouseEvent) => {
    patDrawing = true;
    patApplyAt(ev);
    ev.preventDefault();
  });
  window.addEventListener("mousemove", (ev: MouseEvent) => {
    if (patDrawing) patApplyAt(ev);
  });
  window.addEventListener("mouseup", () => { patDrawing = false; });

  function setPattern(bytes: number[], sharedBy: { cmd: number; name: string }[], isOverridden: boolean): void {
    patBytes = [...bytes];
    patOffsetAtPaint = currentPatternOffset();
    const overrideMark = isOverridden ? " · edited" : "";
    patLabel.textContent = bytes.length > 0
      ? `Pitch pattern — PATOFF $${patOffsetAtPaint.toString(16).toUpperCase().padStart(2, "0")} / PATLEN ${bytes.length}${overrideMark}`
      : `Pitch pattern — PATLEN = 0 (no pattern)`;
    patLabel.dataset.overridden = isOverridden ? "1" : "0";
    // "Shared by" — every editable GWAVE command whose pattern range overlaps
    // the slot's range.  We exclude *self* here since the slot's own
    // targetCmd is what the user is currently editing; if the host wants to
    // include it, it can.
    if (sharedBy.length === 0) {
      patShared.textContent = "No other editable GWAVE commands overlap this pattern range.";
    } else {
      const labels = sharedBy.map((s) => `$${s.cmd.toString(16).toUpperCase().padStart(2, "0")} ${s.name}`).join(", ");
      patShared.innerHTML = `<span class="designer-bar-label">Shared by:</span> ${labels} — your edits affect their pitch contour too.`;
    }
    patResetBtn.disabled = !isOverridden;
    redrawPatCanvas();
  }

  return {
    slidersEl,
    waveformPanelEl: canvasHost,
    patternPanelEl: patHost,
    setRecord(rec: number[]): void {
      record = [...rec];
      refreshSliders();
    },
    getRecord: () => [...record],
    setWaveform,
    setPattern,
    currentWaveIdx,
    currentPatternOffset,
    currentPatternLength,
  };
}
