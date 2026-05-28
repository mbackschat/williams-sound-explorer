/**
 * The RADIO editor panel (Phase 9) — a hybrid of one **FREQ slider** and a
 * **16-cell click-to-draw wavetable canvas**, over RADIO's record
 * `[freq, ...16 LUT bytes]`.
 *
 * RADIO ($18) is the wavetable phase-accumulator: FREQ (the 16-bit initial
 * frequency / accumulator step) sets the starting pitch + climb rate; the 16
 * LUT bytes are the waveform the accumulator reads. Editing both is a pure
 * in-place byte patch (see `engine/radioEdit.ts`).
 *
 * Pure view: edits fire `onChange(record)` with the full 17-value record; the
 * host (`designerMode.ts`) decides what to do. Reuses the GWAVE waveform
 * canvas's `.designer-wfcanvas*` styling and the `.param-row` slider markup.
 */
import { RADSND_LEN } from "../../engine/radioEdit.ts";

export interface RadioEditorApi {
  /** The panel root to insert into the DOM. */
  el: HTMLElement;
  /** Seed the FREQ slider + the 16 canvas cells from a record `[freq, ...16 bytes]`. */
  setRecord(record: number[]): void;
  /** The current record `[freq, ...16 bytes]`. */
  getRecord(): number[];
}

export function buildRadioEditor(onChange: (record: number[]) => void): RadioEditorApi {
  let freq = 0;
  let lut: number[] = new Array(RADSND_LEN).fill(0);

  const el = document.createElement("div");
  el.className = "param-sliders designer-fields designer-radio";

  // ── FREQ slider (reuses the .param-row markup) ───────────────────────────
  const row = document.createElement("div");
  row.className = "param-row";
  row.title = "FREQ — the initial frequency / accumulator step (16-bit). Lower = a lower starting pitch and a slower upward climb; higher = brighter and faster.";
  const label = document.createElement("span");
  label.className = "param-label";
  label.textContent = "FREQ";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "param-slider";
  slider.min = "0";
  slider.max = "65535";
  slider.step = "1";
  const valueEl = document.createElement("span");
  valueEl.className = "param-value";
  const fmtFreq = (v: number): string => `$${v.toString(16).toUpperCase().padStart(4, "0")}`;
  slider.addEventListener("input", () => {
    freq = Number.parseInt(slider.value, 10);
    valueEl.textContent = fmtFreq(freq);
    onChange(getRecord());
  });
  row.append(label, slider, valueEl);

  // ── 16-cell wavetable canvas ─────────────────────────────────────────────
  const canvasHost = document.createElement("div");
  canvasHost.className = "designer-wfcanvas-host";
  const canvasLabel = document.createElement("div");
  canvasLabel.className = "designer-wfcanvas-label";
  canvasLabel.textContent = "Wavetable — 16 bytes (RADSND)";
  const canvas = document.createElement("canvas") as HTMLCanvasElement;
  canvas.className = "designer-wfcanvas";
  canvas.width = 1200;
  canvas.height = 200;
  canvasHost.append(canvasLabel, canvas);

  el.append(row, canvasHost);

  function redrawCanvas(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, W, H);
    const n = lut.length;
    const cellW = W / n;
    ctx.strokeStyle = "#2a2f37";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    // Blue to match the RADIO item accent (distinct from FNOISE's orange).
    ctx.fillStyle = "#7aa2f7";
    for (let i = 0; i < n; i++) {
      const v = lut[i]! & 0xFF;
      const y = ((255 - v) / 255) * H;
      const top = Math.min(y, H / 2);
      const bot = Math.max(y, H / 2);
      ctx.fillRect(i * cellW + 0.5, top, Math.max(1, cellW - 1), bot - top);
    }
  }

  function pickAt(ev: MouseEvent): { i: number; v: number } {
    const rect = canvas.getBoundingClientRect();
    const xCss = ev.clientX - rect.left;
    const yCss = ev.clientY - rect.top;
    const i = Math.max(0, Math.min(lut.length - 1, Math.floor((xCss / rect.width) * lut.length)));
    const v = Math.max(0, Math.min(255, Math.round(255 - (yCss / rect.height) * 255)));
    return { i, v };
  }

  let drawing = false;
  function applyAt(ev: MouseEvent): void {
    const p = pickAt(ev);
    if (lut[p.i] === p.v) return;
    lut[p.i] = p.v;
    redrawCanvas();
    onChange(getRecord());
  }
  canvas.addEventListener("mousedown", (ev: MouseEvent) => { drawing = true; applyAt(ev); ev.preventDefault(); });
  window.addEventListener("mousemove", (ev: MouseEvent) => { if (drawing) applyAt(ev); });
  window.addEventListener("mouseup", () => { drawing = false; });

  function getRecord(): number[] {
    return [freq, ...lut];
  }

  return {
    el,
    setRecord(record: number[]): void {
      freq = record[0] ?? 0;
      lut = record.slice(1, 1 + RADSND_LEN);
      while (lut.length < RADSND_LEN) lut.push(0);
      slider.value = String(freq);
      valueEl.textContent = fmtFreq(freq);
      redrawCanvas();
    },
    getRecord,
  };
}
