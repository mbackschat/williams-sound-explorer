/**
 * Sound Designer mode — a **Custom ROM with its own item list** (Phase 3b).
 *
 * You pick an *engine base* (which game's VARI engine to run on — Defender or
 * Stargate), then build your own list of named VARI sounds: copy any game's
 * VARI sound as a starting point, or add a new one, then edit, audition, and
 * save. Sounds map to command codes `$1D`+ by list order (`buildCustomRom`);
 * the runnable image is reconstituted from the user's base ROM, and the saved
 * project (`CustomProject`) is a JSON recipe carrying **no ROM bytes**.
 *
 * Separate top-level mode: `main.ts` hides the Explore layout and mounts this
 * into `#designer-root`. Audition renders the custom image offline through the
 * real emulator (`audition.ts`); nothing here touches the Explore worklet.
 */
import "./designer.css";
import type { GameKind } from "../../board/soundboard.ts";
import type { AppContext } from "../appContext.ts";
import { loadRomBytes } from "../romStore.ts";
import { variCommandsFor, readVariRecord } from "../../engine/variEdit.ts";
import { gwaveCommandsFor, readGWaveRecord, readWaveform, waveformUsers, readPattern, patternUsers, DEFAULT_NEW_WAVE_LENGTH, reclampWaveformIdxAfterRemoval } from "../../engine/gwaveEdit.ts";
import { lfsrCommandsFor, lfsrFieldsFor, readLfsrRecord, LFSR_CALLER_BASE } from "../../engine/lfsrEdit.ts";
import { fnoiseCommandsFor, fnoiseFieldsFor, readFnoiseRecord } from "../../engine/fnoiseEdit.ts";
import { radioCommandsFor, readRadioRecord } from "../../engine/radioEdit.ts";
import { buildCustomRom, computeBudget, maxSlots, VARI_CMD_BASE, type CustomSlot as RomCustomSlot } from "../../engine/customRom.ts";
import { importBinAsProject, ROM_SIZE } from "../../engine/projectFromBin.ts";
import {
  ENGINE_BASES, listProjects, getProject, saveProject, exportJson, importJson,
  type CustomProject, type CustomSlot,
} from "./designerStore.ts";
import { buildVariEditor, type VariEditorApi } from "./variEditor.ts";
import { buildGWaveEditor, type GWaveEditorApi } from "./gwaveEditor.ts";
import { buildFieldSliderEditor, type FieldSliderEditorApi } from "./fieldSliders.ts";
import { buildRadioEditor, type RadioEditorApi } from "./radioEditor.ts";
import {
  renderSound, playSamples, drawWaveform, drawDiff, drawPlayhead, durationMs,
  onPlaybackState, pauseResume, stopPlayback, setLoop, playbackState, playbackProgress,
  type PlayState, type RenderedSound,
} from "./audition.ts";

export interface DesignerHandle { dispose(): void; }

const LABEL: Record<GameKind, string> = { defender: "Defender", stargate: "Stargate", robotron: "Robotron" };

/** VARI slots need a clean linear dispatcher widen; Robotron's is non-linear. */
const VARI_BASES = new Set<GameKind>(["defender", "stargate"]);
const supportsVari = (game: GameKind): boolean => VARI_BASES.has(game);

/** Count how many VARI slots come before index `i` (so we can assign codes $1D, $1E, …). */
function variIndexOf(slots: CustomSlot[], i: number): number {
  let n = 0;
  for (let k = 0; k < i; k++) if (slots[k]!.kind === "vari") n++;
  return n;
}

/** Total number of VARI slots in the project. */
function variCount(slots: CustomSlot[]): number {
  return slots.reduce((n, s) => n + (s.kind === "vari" ? 1 : 0), 0);
}

/** The command code an item-list row maps to: $1D+ for VARI, slot.targetCmd for GWAVE. */
function slotCmd(slots: CustomSlot[], i: number): number {
  const slot = slots[i]!;
  return slot.kind === "vari" ? VARI_CMD_BASE + variIndexOf(slots, i) : slot.targetCmd;
}

/** Map a project's slots to the discriminated `CustomSlot` shape `buildCustomRom` accepts. */
function toRomSlots(slots: CustomSlot[]): RomCustomSlot[] {
  let variIdx = 0;
  return slots.map((s) =>
    s.kind === "vari"
      ? { kind: "vari", code: VARI_CMD_BASE + (variIdx++), record: s.record }
      : s.kind === "gwave"
        ? { kind: "gwave", cmd: s.targetCmd, record: s.record }
        : s.kind === "lfsr"
          ? { kind: "lfsr", cmd: s.targetCmd, record: s.record }
          : s.kind === "fnoise"
            ? { kind: "fnoise", cmd: s.targetCmd, record: s.record }
            : { kind: "radio", cmd: s.targetCmd, record: s.record },
  );
}

/** Bytewise equality on parameter records (same length, same bytes). */
function recordsEqualStatic(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Phase 6.1: a slot is "stock" when it (a) sits at a canonical stock position
 * in the populated item list AND (b) has not been edited (`record == start`).
 * Stock slots are no-ops on the saved recipe (they'd patch the base ROM with
 * its own bytes), so save/export drops them — the on-disk JSON stays sparse,
 * just like before pre-population.
 *
 *  - **GWAVE stock**: the slot's `targetCmd` is in `gwaveCommandsFor(game)`
 *    (i.e. $01..$0D — every editable GWAVE).  All GWAVE slots in the
 *    populated list are stock candidates; only user edits flip them off.
 *  - **VARI stock**: the slot is at VARI-index 0, 1, or 2 (codes $1D / $1E / $1F).
 *    User-added VARI slots (index 3+ → codes $20+) are *never* stock — even
 *    when their bytes equal a stock SAW seed, the act of adding them is
 *    deliberate user intent that has to persist.
 */
function isStockSlot(slots: CustomSlot[], i: number, game: GameKind): boolean {
  const slot = slots[i]!;
  if (!recordsEqualStatic(slot.record, slot.start)) return false;
  if (slot.kind === "gwave" || slot.kind === "lfsr" || slot.kind === "fnoise" || slot.kind === "radio") {
    // Cheap: any populated GWAVE/LFSR/FNOISE/RADIO override slot.  All are
    // pre-populated override-in-place rows (never user-added), so an unedited
    // one is stock.
    return true; // populate only inserts editable codes; user can't add others
  }
  // VARI: count VARI slots before this position; first 3 are stock SAW/FOSHIT/QUASAR.
  let variIdx = 0;
  for (let k = 0; k < i; k++) if (slots[k]!.kind === "vari") variIdx++;
  return variIdx <= 2 && VARI_BASES.has(game);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const emptyProject = (engineBase: GameKind): CustomProject => {
  const now = Date.now();
  return { name: "", engineBase, slots: [], createdAt: now, updatedAt: now };
};

export function mountDesigner(root: HTMLElement, ctx: AppContext): DesignerHandle {
  root.replaceChildren();
  root.classList.add("designer");

  // ── State ────────────────────────────────────────────────────────────
  let project = emptyProject((ENGINE_BASES.find((g) => ctx.availableGames().has(g)) ?? "defender"));
  let baseRom: Uint8Array | null = null;
  let selected = -1;
  let volume = 0.3;
  // transport
  let source: "edited" | "start" = "edited";
  let loop = false;
  let diffOn = false;
  let editedR: RenderedSound | null = null;
  let startR: RenderedSound | null = null;
  let scopeRaf = 0;
  let autoReplayTimer = 0;
  // copy-from sources, read from whichever game ROMs the user has
  let copySources: { label: string; record: number[] }[] = [];

  const status = (msg: string, kind: "" | "ok" | "err" = ""): void => {
    statusLine.textContent = msg;
    statusLine.dataset.kind = kind;
    ctx.log(`Designer: ${msg}`, kind);
  };

  // ── Header ───────────────────────────────────────────────────────────
  const baseButtons = new Map<GameKind, HTMLButtonElement>();
  const enginePicker = el("div", { className: "designer-engine game-switcher", role: "radiogroup" });
  for (const g of ENGINE_BASES) {
    const b = el("button", { className: "game-pick", textContent: LABEL[g] });
    b.addEventListener("click", () => { void setEngine(g); });
    baseButtons.set(g, b);
    enginePicker.append(b);
  }

  const nameInput = el("input", { type: "text", className: "designer-name", placeholder: "project name" });
  const projectSelect = el("select", { className: "designer-open", title: "Open a saved project" });
  const saveBtn = el("button", { className: "designer-save", textContent: "Save", title: "Save this custom ROM to the browser (IndexedDB)." });
  const newBtn = el("button", { className: "designer-new", textContent: "New", title: "Start an empty custom ROM." });
  const exportBtn = el("button", { textContent: "↓ JSON", title: "Download this project as a JSON recipe file (no ROM bytes — safe to share)." });
  const importInput = el("input", { type: "file", accept: "application/json,.json", className: "designer-import" });
  const importBtn = el("button", { textContent: "↑ JSON", title: "Load a project from a JSON recipe file." });
  importBtn.addEventListener("click", () => importInput.click());
  // Phase 6.2: Download the built custom ROM image as a .bin file — closes
  // the loop "edit → MAME → upload → edit".  The .bin contains the user's
  // base ROM bytes with their edits applied, so the file IS copyrighted ROM
  // content; the tooltip + status note flag it as personal-use, not shareable.
  const exportBinBtn = el("button", {
    textContent: "↓ .bin",
    title: "Download your custom ROM as a .bin file you can load in MAME or burn to EPROM. Contains the original Williams ROM bytes with your edits — for personal use, don't redistribute.",
  });
  const importBinInput = el("input", { type: "file", accept: ".bin,application/octet-stream", className: "designer-import-bin" });
  const importBinBtn = el("button", {
    textContent: "↑ .bin",
    title: "Load a custom ROM .bin file back into the Designer. Diffs against your base ROM to reconstruct the project. Requires the base ROM to already be loaded in Explore mode.",
  });
  importBinBtn.addEventListener("click", () => importBinInput.click());
  // "Open in Explore" is created with the transport controls below; it
  // re-joins them as the rightmost button in the sticky transport row
  // (it sat in the header briefly during the Phase 5 redesign; user
  // feedback was to put it back with Play/Pause where it visually
  // belongs as an audition action).
  const openInExploreBtn = el("button", {
    className: "designer-open-explore",
    textContent: "▶ Open in Explore",
    title: "Audition this sound in Explore mode — pause/step/scrub the live worklet on your custom ROM, with every Explore visualisation pointed at it.",
  });

  // Logical groups, each wrapped in its own `.designer-bar-group` container so
  // the row wraps as **whole groups** when the viewport narrows (groups stay
  // atomic; the wrap break can't fall mid-group).  Five groups in two natural
  // tiers — project identity (Engine / Project / Open) and file I/O (Recipe /
  // ROM); CSS gap separates them without explicit dividers.
  const group = (label: string, ...kids: Node[]): HTMLElement =>
    el("div", { className: "designer-bar-group" }, [
      el("span", { className: "designer-bar-label", textContent: label }), ...kids,
    ]);
  const header = el("div", { className: "designer-header" }, [
    el("h2", { textContent: "🎛 Sound Designer — Custom ROM" }),
    el("span", { className: "designer-sub", textContent: "Fork the game's sound bank: edit any of its sounds, audition, save — or download as a .bin and load in MAME." }),
    el("div", { className: "designer-bar" }, [
      group("Engine:", enginePicker),
      group("Project:", nameInput, saveBtn, newBtn),
      group("Open:", projectSelect),
      group("Recipe:", exportBtn, importBtn, importInput),
      group("ROM:", exportBinBtn, importBinBtn, importBinInput),
    ]),
  ]);

  // ── Item list ──────────────────────────────────────────────────────────
  const itemList = el("div", { className: "designer-items" });
  const itemCount = el("span", { className: "designer-bar-label" });
  // ROM-space indicator — shows how many free-region bytes the current
  // project would consume in the relocated layout.  Live readout so users
  // see the headroom *before* they hit "+ New waveform" and discover via a
  // "Won't fit" error.  `data-state` drives the colour: ok / tight / over.
  const romSpace = el("span", { className: "designer-bar-label designer-rom-space" });
  const addNewBtn = el("button", { textContent: "+ New VARI", title: "Add a new VARI sound at the next free command code (seeded from the base game's SAW)." });
  const copySelect = el("select", { className: "designer-copy", title: "Copy a VARI sound from any loaded game as a starting point" });
  // GWAVE has no equivalent of VARI's mask widen — you can only override an
  // existing GWAVE command in place ($01..$0D).  The dropdown lists the
  // editable codes for the engine base; greyed-out entries are already
  // overridden in this project.
  const gwaveOverrideSelect = el("select", { className: "designer-gwave-override", title: "Override an existing GWAVE command in place (its 7-byte SVTAB record becomes editable)." });
  // Phase 6.1: the item list is now pre-populated with every editable
  // command from the engine base, so "Override GWAVE:" is redundant — the
  // user edits GWAVE by clicking the existing stock row.  Kept "+ New VARI"
  // and "Copy VARI:" for adding *extra* VARI sounds beyond the base game's
  // set (rows 3+, codes $20+).
  const itemsSection = el("div", { className: "designer-section designer-items-head" }, [
    el("span", { className: "designer-bar-label", textContent: "Your sounds" }), itemCount,
    romSpace,
    el("span", { className: "sep" }), addNewBtn,
    el("span", { className: "designer-bar-label", textContent: "Copy VARI:" }), copySelect,
  ]);

  // ── Editor + audition ──────────────────────────────────────────────────
  const variEditor: VariEditorApi = buildVariEditor(onEditorChange);
  // GWAVE editor takes three callbacks: slot-record edit (existing onEditorChange),
  // waveform-byte canvas edit (writes to project.waveformOverrides), and reset
  // (clears the override for that idx).  Both waveform paths drive auto-replay.
  const gwaveEditor: GWaveEditorApi = buildGWaveEditor(
    (rec) => { onEditorChange(rec); refreshWaveformCanvas(); refreshPatternCanvas(); },
    (idx, bytes) => {
      // For stock waves (0..6), edits land in `waveformOverrides`.  For
      // user-added waves (7..15), edits land in `addedWaveforms[idx - 7]`.
      if (idx <= 6) {
        project.waveformOverrides ??= {};
        project.waveformOverrides[idx] = bytes;
      } else {
        project.addedWaveforms ??= [];
        const slot = idx - 7;
        if (slot >= 0 && slot < project.addedWaveforms.length) {
          project.addedWaveforms[slot] = bytes;
        }
      }
      touch();
      scheduleAutoReplay();
      refreshWaveformCanvas();
    },
    (idx) => {
      // "Reset to stock" only meaningful for stock idx (clears an override).
      // For added waves (idx ≥ 7) there's no stock to revert to; the editor
      // hides the Reset button there in favour of "× Remove" (handled below).
      // This guard is the defensive belt for direct programmatic invocations.
      if (idx > 6) {
        status("Added waveforms have no stock to revert to — use × Remove to drop the waveform.", "");
        return;
      }
      if (project.waveformOverrides) {
        delete project.waveformOverrides[idx];
        if (Object.keys(project.waveformOverrides).length === 0) delete project.waveformOverrides;
      }
      touch();
      scheduleAutoReplay();
      refreshWaveformCanvas();
    },
    (offset, bytes) => {
      project.patternOverrides ??= {};
      project.patternOverrides[offset] = bytes;
      touch();
      scheduleAutoReplay();
      refreshPatternCanvas();
    },
    (offset) => {
      if (project.patternOverrides) {
        delete project.patternOverrides[offset];
        if (Object.keys(project.patternOverrides).length === 0) delete project.patternOverrides;
      }
      touch();
      scheduleAutoReplay();
      refreshPatternCanvas();
    },
    // "+ New waveform" handler (Phase 5 step 4): append a fresh user-added
    // wave at idx (7 + addedCount), seeded with a sine ramp so the user
    // starts editing from something audible.  Switch the slot's WAVE# to
    // it.  Capped at 9 (WAVE# nybble); also **pre-flight** the build so a
    // wave that would overrun the free ROM region never gets added — the
    // alternative was silent commit + a delayed "Won't fit" auto-replay
    // error blamed on whatever the user clicked next.
    () => {
      const slot = project.slots[selected];
      if (!baseRom || !slot || slot.kind !== "gwave") return;
      project.addedWaveforms ??= [];
      if (project.addedWaveforms.length >= 9) { status("Added-waveform cap (9) reached — WAVE# is a 4-bit nybble.", "err"); return; }
      const seed: number[] = [];
      for (let i = 0; i < DEFAULT_NEW_WAVE_LENGTH; i++) {
        seed.push(Math.round(0x80 + 0x60 * Math.sin((i / DEFAULT_NEW_WAVE_LENGTH) * 2 * Math.PI)));
      }
      // Pre-flight: try the build with the seed appended.  If buildCustomRom
      // throws (over the free-region budget), surface the error here — and
      // do NOT mutate the project — so the user gets a clear "this wave
      // can't be added" message right now instead of a stale auto-replay
      // error two clicks later.
      try {
        buildCustomRom(baseRom, project.engineBase, toRomSlots(project.slots), {
          waveformOverrides: project.waveformOverrides,
          patternOverrides: project.patternOverrides,
          addedWaveforms: [...project.addedWaveforms, seed],
        });
      } catch (e) {
        status(`Can't add waveform — ${e instanceof Error ? e.message : String(e)}`, "err");
        return;
      }
      project.addedWaveforms.push(seed);
      const newIdx = 6 + project.addedWaveforms.length; // idx 7 for the first add
      const rec = [...slot.record];
      rec[1] = (rec[1]! & 0xF0) | (newIdx & 0x0F);
      slot.record = rec;
      touch();
      gwaveEditor.setRecord(rec);
      refreshGwaveEditorLimits();
      refreshWaveformCanvas();
      scheduleAutoReplay();
      status(`Added waveform idx ${newIdx} (${seed.length} bytes) — edit via the canvas.`, "ok");
    },
    // "× Remove" handler: drop a user-added waveform from the project and
    // re-clamp every GWAVE slot whose WAVE# nybble pointed at it (or at a
    // higher idx that's now shifted down).  Stock waves (idx ≤ 6) can't be
    // removed — `gwaveEditor` hides the button there, but we still guard.
    (idx) => {
      if (idx < 7) return;
      const addedSlot = idx - 7;
      if (!project.addedWaveforms || addedSlot >= project.addedWaveforms.length) return;
      project.addedWaveforms.splice(addedSlot, 1);
      if (project.addedWaveforms.length === 0) delete project.addedWaveforms;
      // Re-clamp every GWAVE slot's WAVE# field — see
      // `reclampWaveformIdxAfterRemoval` (headless, in `engine/gwaveEdit.ts`)
      // for the at/above/below rules.
      let touchedSlots = 0;
      for (const s of project.slots) {
        if (s.kind !== "gwave") continue;
        const next = reclampWaveformIdxAfterRemoval(s.record, idx);
        if (next[1] !== s.record[1]) {
          s.record = next;
          touchedSlots++;
        }
      }
      touch();
      // If the user was sitting on a GWAVE slot, push the re-clamped record
      // back into the editor so the WAVE# slider readout matches.
      const cur = project.slots[selected];
      if (cur && cur.kind === "gwave") gwaveEditor.setRecord(cur.record);
      refreshGwaveEditorLimits();
      refreshWaveformCanvas();
      scheduleAutoReplay();
      const tail = touchedSlots > 0
        ? ` ${touchedSlots} slot${touchedSlots === 1 ? "" : "s"} re-clamped.`
        : "";
      status(`Removed user-added waveform idx ${idx}.${tail}`, "ok");
    },
  );
  // Field-slider editor — a per-command slider set (rebuilt when the selected
  // sound changes), shared by both LFSR and FNOISE (both store a virtual list
  // of field values; only one slot is shown at a time so one panel suffices).
  const fieldEditor: FieldSliderEditorApi = buildFieldSliderEditor(onEditorChange);

  // RADIO editor — a FREQ slider + a 16-cell wavetable canvas. Its record is
  // `[freq, ...16 bytes]`; it owns its own canvas, so it lives in the sliders
  // column and is shown only for RADIO slots.
  const radioEditor: RadioEditorApi = buildRadioEditor(onEditorChange);

  // The sliders column contains all the editors' slider panels (VARI / GWAVE /
  // field-slider for LFSR+FNOISE / RADIO); only one is visible at a time
  // depending on the selected slot's kind.  GWAVE's waveform/pitch canvases sit
  // in their own grid columns to the right.
  const slidersCol = el("div", { className: "designer-edit-sliders-col" });
  slidersCol.append(variEditor.el, gwaveEditor.slidersEl, fieldEditor.el, radioEditor.el);
  variEditor.el.style.display = "";
  gwaveEditor.slidersEl.style.display = "none";
  gwaveEditor.waveformPanelEl.style.display = "none";
  gwaveEditor.patternPanelEl.style.display = "none";
  fieldEditor.el.style.display = "none";
  radioEditor.el.style.display = "none";

  /**
   * Editor label row — switches with the selected slot's kind and carries a
   * "↻ Reset record" button.  The button reverts the slot's record to its
   * `start` bytes (what was copied/created when the slot was added — also
   * the reference the Source: Edited│Start toggle plays).  It's disabled
   * when the record already equals start, so the row stays calm until you
   * actually edit.  Works for both VARI and GWAVE since both editors share
   * the slot-shape `{ record, start }`.
   */
  const editorLabelText = el("span", { textContent: "Parameter record (VVECT — VARI)" });
  const recordResetBtn = el("button", {
    className: "designer-record-reset",
    textContent: "↻ Reset record",
    disabled: true,
    title: "Revert this slot's parameter record (the slider values) to its starting bytes — what was copied/created when the slot was added. Doesn't affect waveform/pattern overrides, which have their own per-canvas Reset.",
  });
  const editorLabel = el("div", { className: "designer-edit-label" }, [editorLabelText, recordResetBtn]);

  // The 3-column grid for the editor body.  CSS sizes the columns differently
  // per slot kind: `vari` shows only the sliders column; `gwave` shows
  // sliders | waveform | pitch (with canvas columns sized to grow up to ~600 px
  // each so future v-future "new waveforms" / long PATLENs stay drawable).
  const editRow = el("div", { className: "designer-edit-row" });
  editRow.append(slidersCol, gwaveEditor.waveformPanelEl, gwaveEditor.patternPanelEl);

  function showEditorFor(kind: CustomSlot["kind"]): void {
    const fieldKind = kind === "lfsr" || kind === "fnoise";
    variEditor.el.style.display = kind === "vari" ? "" : "none";
    gwaveEditor.slidersEl.style.display = kind === "gwave" ? "" : "none";
    gwaveEditor.waveformPanelEl.style.display = kind === "gwave" ? "" : "none";
    gwaveEditor.patternPanelEl.style.display = kind === "gwave" ? "" : "none";
    fieldEditor.el.style.display = fieldKind ? "" : "none";
    radioEditor.el.style.display = kind === "radio" ? "" : "none";
    // VARI + LFSR + FNOISE + RADIO are single-column; GWAVE adds side canvases.
    editRow.classList.toggle("designer-edit-row-vari", kind !== "gwave");
    editRow.classList.toggle("designer-edit-row-gwave", kind === "gwave");
    editorLabelText.textContent = kind === "vari"
      ? "Parameter record (VVECT — VARI)"
      : kind === "gwave"
        ? "Parameter record (SVTAB — GWAVE override)"
        : kind === "lfsr"
          ? "Parameter record (caller immediates — LFSR override)"
          : kind === "fnoise"
            ? "Parameter record (FNTAB / caller immediates — FNOISE override)"
            : "Parameter record (FREQ + RADSND wavetable — RADIO override)";
  }

  /** Same length + every byte equal — used to gate the "↻ Reset record" button. */
  function recordsEqual(a: number[] | undefined, b: number[] | undefined): boolean {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Enable/disable the "↻ Reset record" button by comparing record to start. */
  function refreshRecordResetState(): void {
    const slot = project.slots[selected];
    recordResetBtn.disabled = !slot || recordsEqual(slot.record, slot.start);
  }

  recordResetBtn.addEventListener("click", () => {
    const slot = project.slots[selected];
    if (!slot || recordsEqual(slot.record, slot.start)) return;
    // Push the start bytes back into the slot AND into the active editor's
    // sliders so the UI follows.  onEditorChange below would re-source to
    // "edited" and schedule the replay — we want both, since the user
    // expects to hear the just-reverted record.
    slot.record = [...slot.start];
    // LFSR/FNOISE slider sets are per-command — reseed values (fields are
    // already set from selectSlot, since the same slot is still selected).
    const ed = slot.kind === "vari" ? variEditor
      : slot.kind === "gwave" ? gwaveEditor
      : slot.kind === "radio" ? radioEditor
      : fieldEditor;
    ed.setRecord(slot.record);
    if (slot.kind === "gwave") { refreshWaveformCanvas(); refreshPatternCanvas(); }
    onEditorChange(slot.record);
    status(`Reverted ${slot.name || "(unnamed)"} to its starting record.`, "ok");
  });

  const playBtn = el("button", { className: "designer-play", textContent: "▶ Play", title: "Play the selected sound from the top." });
  const pauseBtn = el("button", { textContent: "⏸ Pause", title: "Pause / resume playback.", disabled: true });
  const loopBtn = el("button", { textContent: "🔁 Loop", title: "Repeat continuously — edits update the loop live." });
  const srcEditedBtn = el("button", { className: "active", textContent: "Edited", title: "Audition your edited sound." });
  const srcStartBtn = el("button", { textContent: "Start", title: "Audition the sound's starting point (as copied/created)." });
  const sourceToggle = el("div", { className: "designer-source game-switcher", role: "radiogroup" }, [srcEditedBtn, srcStartBtn]);
  const diffBtn = el("button", { textContent: "⇄ Diff", title: "Overlay the starting point (grey) + divergence (red) behind the live trace." });
  const volSlider = el("input", { type: "range", min: "0", max: "1", step: "0.01", value: String(volume), className: "designer-vol" });
  loopBtn.setAttribute("aria-pressed", "false");
  diffBtn.setAttribute("aria-pressed", "false");

  volSlider.addEventListener("input", () => { volume = Number(volSlider.value); });
  playBtn.addEventListener("click", () => play()); // always restart from the top
  pauseBtn.addEventListener("click", () => pauseResume());
  loopBtn.addEventListener("click", () => {
    loop = !loop;
    loopBtn.classList.toggle("toggle-on", loop);
    loopBtn.setAttribute("aria-pressed", String(loop));
    setLoop(loop);
  });
  srcEditedBtn.addEventListener("click", () => setSource("edited"));
  srcStartBtn.addEventListener("click", () => setSource("start"));
  diffBtn.addEventListener("click", () => {
    diffOn = !diffOn;
    diffBtn.classList.toggle("toggle-on", diffOn);
    diffBtn.setAttribute("aria-pressed", String(diffOn));
    if (playbackState() === "idle") redrawScope();
  });
  onPlaybackState((s: PlayState) => {
    pauseBtn.disabled = s === "idle";
    pauseBtn.textContent = s === "paused" ? "▶ Resume" : "⏸ Pause";
  });
  // Design-mode keyboard map (F1): kept minimal and scoped to this surface —
  // Space = Play (restart) · P = Pause/Resume.  Listener fires only when
  // designer-root is visible (Explore's keyboard handler already early-returns
  // in that state) and ignores key events while the user is typing into the
  // project name, copy select, or any slider/text input.
  window.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      playBtn.click();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (!pauseBtn.disabled) pauseBtn.click();
    }
  });
  // Hand the selected slot off to Explore's worklet: build the custom image,
  // load it via auditionCustomRom, fire the slot's command code, and flip the
  // top-level mode toggle.  The rebuild closure means future clicks of the
  // dynamic "Custom" switcher entry pick up edits made in Design afterwards.
  openInExploreBtn.addEventListener("click", () => {
    if (!baseRom || selected < 0) return;
    stopPlayback();
    // Snapshot the project's current item list as (code, name) pairs so
    // Explore's "Try:" chip row can show your slots instead of the base
    // game's stock commands (F3 fix).  VARI slots use auto-assigned codes;
    // GWAVE slots use their override target.  Each click of the dynamic
    // Custom switcher button refreshes this via the rebuild closure.
    const slotsOf = (): { code: number; name: string }[] =>
      project.slots.map((_s, i) => ({ code: slotCmd(project.slots, i), name: project.slots[i]!.name }));
    void ctx.auditionCustomRom({
      baseGame: project.engineBase,
      rom: buildEdited(),
      cmd: slotCmd(project.slots, selected),
      projectName: project.name || "untitled",
      slots: slotsOf(),
      rebuild: () => ({
        rom: buildEdited(),
        cmd: slotCmd(project.slots, selected >= 0 ? selected : 0),
        slots: slotsOf(),
      }),
    }).then(() => ctx.switchToExploreMode());
  });

  const scope = el("canvas", { className: "designer-scope" }) as HTMLCanvasElement;
  // Status line lives near the header (above the item list), not in the
  // Audition column — save/open/copy/error feedback shouldn't pollute the
  // scope area, and the line should be visible regardless of which slot is
  // selected.  See F2 fix.
  const statusLine = el("div", { className: "designer-status" });
  // The full-width audition scope strip sits beneath the 3-column edit row.
  // The scope is a *static* offline render with a playhead, so a thin strip
  // (~120 px tall, full width) is more efficient than the old half-screen
  // right column.
  const auditionStrip = el("div", { className: "designer-audition-strip" }, [
    el("div", { className: "designer-edit-label", textContent: "Audition" }),
    scope,
  ]);

  const editPanel = el("div", { className: "designer-edit" }, [
    editorLabel,
    editRow,
    auditionStrip,
  ]);

  // Sticky transport bar — single row of Play / Pause / Loop / Source / Diff
  // / Vol / Open in Explore, glued to the bottom of the viewport when the
  // editor exceeds the window height.  Open in Explore sits at the right
  // end of the row, visually separated by a sep so it reads as a distinct
  // audition-handoff action.
  const transport = el("div", { className: "designer-transport" }, [
    playBtn, pauseBtn, loopBtn,
    el("span", { className: "sep" }),
    el("span", { className: "designer-bar-label", textContent: "Source" }), sourceToggle,
    el("span", { className: "sep" }),
    diffBtn,
    el("span", { className: "sep" }),
    el("span", { className: "designer-bar-label", textContent: "Vol" }), volSlider,
    el("span", { className: "sep" }),
    openInExploreBtn,
  ]);

  const lockedMsg = el("div", { className: "designer-locked" });
  root.append(header, statusLine, itemsSection, itemList, editPanel, transport, lockedMsg);

  // ── Behaviour ──────────────────────────────────────────────────────────

  function setControlsEnabled(on: boolean): void {
    for (const b of [saveBtn, newBtn, exportBtn, exportBinBtn, importBinBtn]) b.disabled = !on;
    const variOk = on && supportsVari(project.engineBase);
    addNewBtn.disabled = !variOk || variCount(project.slots) >= maxVari();
    copySelect.disabled = !variOk;
    gwaveOverrideSelect.disabled = !on;
    itemsSection.style.display = on ? "" : "none";
    itemList.style.display = on ? "" : "none";
    const slotOk = on && selected >= 0;
    editPanel.style.display = slotOk ? "" : "none";
    transport.style.display = slotOk ? "" : "none";
    openInExploreBtn.disabled = !slotOk;
    lockedMsg.style.display = on ? "none" : "";
  }

  /** VARI capacity on the current engine base, or 0 on Robotron. */
  const maxVari = (): number => (supportsVari(project.engineBase) ? maxSlots(project.engineBase) : 0);

  function refreshEngineUi(): void {
    for (const [g, b] of baseButtons) {
      const avail = ctx.availableGames().has(g);
      b.classList.toggle("active", g === project.engineBase);
      b.classList.toggle("locked", !avail);
      const role = supportsVari(g) ? "VARI + GWAVE" : "GWAVE only";
      b.title = avail ? `Run on ${LABEL[g]}'s engine (${role})` : `${LABEL[g]} ROM not loaded — add it in Explore mode first`;
    }
  }

  function refreshItemList(): void {
    // Phase 6.1: count edited (non-stock) slots — that's what the user
    // cares about ("how many of the game's sounds have I touched?").
    // Total = current item count (stocks pre-populated + any user-added).
    const game = project.engineBase;
    const stockFlags = project.slots.map((_s, i) => isStockSlot(project.slots, i, game));
    const editedCount = stockFlags.filter((s) => !s).length;
    const total = project.slots.length;
    itemCount.textContent = total > 0
      ? `(${editedCount} edited / ${total} total)`
      : `(no items)`;
    itemList.replaceChildren(...project.slots.map((slot, i) => {
      const stock = stockFlags[i]!;
      const cls = `designer-item designer-item-${slot.kind}${i === selected ? " active" : ""}${stock ? " designer-item-stock" : " designer-item-edited"}`;
      const row = el("div", { className: cls });
      if (stock) row.dataset.stock = "1";
      // Stable selector for e2e captures + future scripts: every row
      // carries its command code as `data-cmd` (zero-padded uppercase hex).
      // VARI codes are auto-assigned by list order via `slotCmd`; GWAVE
      // codes are the slot's `targetCmd`.  Both flow through `slotCmd`.
      row.dataset.cmd = slotCmd(project.slots, i).toString(16).toUpperCase().padStart(2, "0");
      row.dataset.kind = slot.kind;
      row.addEventListener("click", () => selectSlot(i));
      const name = el("input", { className: "designer-item-name", value: slot.name }) as HTMLInputElement;
      name.addEventListener("click", (e) => e.stopPropagation());
      name.addEventListener("input", () => { slot.name = name.value; touch(); });
      const engineName = slot.kind === "vari" ? "VARI" : slot.kind === "gwave" ? "GWAVE" : slot.kind === "lfsr" ? "LFSR" : slot.kind === "fnoise" ? "FNOISE" : "RADIO";
      const codeText = `$${slotCmd(project.slots, i).toString(16).toUpperCase().padStart(2, "0")} ${engineName}`;
      const code = el("span", { className: "designer-item-code", textContent: codeText });
      code.title = slot.kind === "vari"
        ? (stock ? "Stock VARI sound — edit the sliders to make it yours." : "Custom VARI slot — auto-assigned command code (extends VVECT).")
        : slot.kind === "gwave"
          ? (stock ? "Stock GWAVE sound — edit the sliders to make it yours." : `Overrides the base game's GWAVE command $${slot.targetCmd.toString(16).toUpperCase()} in place.`)
          : slot.kind === "lfsr"
            ? (stock ? "Stock LFSR sound — edit the sliders to make it yours." : `Overrides the base game's LFSR command $${slot.targetCmd.toString(16).toUpperCase()} in place.`)
            : slot.kind === "fnoise"
              ? (stock ? "Stock FNOISE sound — edit the sliders to make it yours." : `Overrides the base game's FNOISE command $${slot.targetCmd.toString(16).toUpperCase()} in place.`)
              : (stock ? "Stock RADIO sound — edit the FREQ slider + wavetable to make it yours." : `Overrides the base game's RADIO command $${slot.targetCmd.toString(16).toUpperCase()} (FREQ + RADSND LUT) in place.`);
      // Dot indicator: dim grey for stock, green for edited.  Sits before the
      // name input so the user reads "● $05 GWAVE BBSV" at a glance.
      const dot = el("span", { className: "designer-item-dot", title: stock ? "Stock — unchanged from the base ROM." : "Edited — diverges from the base ROM." });
      // × Remove is hidden for stock rows (they're the game's commands;
      // a re-populate would just re-add them next time the project loads).
      // User-added VARI rows ($20+) and edited rows keep the × so users
      // can drop them; an edited stock row gets ↻ Reset record in the
      // editor toolbar instead — the way to "remove" your edit.
      const del = el("button", { className: "designer-item-del", textContent: "✕", title: "Remove this sound" });
      if (stock) del.style.visibility = "hidden";
      del.addEventListener("click", (e) => { e.stopPropagation(); removeSlot(i); });
      row.append(dot, code, name, del);
      return row;
    }));
    if (project.slots.length === 0) {
      itemList.append(el("div", { className: "designer-empty", textContent: "No sounds yet — load the engine's base ROM to populate the list." }));
    }
    refreshRomBudget();
  }

  /** Populate the GWAVE override dropdown, greying out commands already overridden. */
  function refreshGwaveOverrideOptions(): void {
    const taken = new Set(project.slots.filter((s) => s.kind === "gwave").map((s) => (s as { targetCmd: number }).targetCmd));
    const opts: HTMLOptionElement[] = [el("option", { value: "", textContent: "override…" }) as HTMLOptionElement];
    for (const c of gwaveCommandsFor(project.engineBase)) {
      const o = el("option", {
        value: String(c.cmd),
        textContent: `$${c.cmd.toString(16).toUpperCase().padStart(2, "0")} ${c.name}${taken.has(c.cmd) ? " (taken)" : ""}`,
      }) as HTMLOptionElement;
      if (taken.has(c.cmd)) o.disabled = true;
      opts.push(o);
    }
    gwaveOverrideSelect.replaceChildren(...opts);
    gwaveOverrideSelect.value = "";
  }

  const touch = (): void => { project.updatedAt = Date.now(); refreshRomBudget(); };

  /**
   * Recompute the "Custom ROM X/Y bytes" indicator from the project's current
   * state.  Pure (no `baseRom` needed) — `computeBudget` mirrors the same
   * arithmetic `buildCustomRom` uses for its overrun guard.  Three visual
   * states drive the colour via `data-state`:
   *
   *   ok    — comfortable headroom (≥ 20 bytes free).
   *   tight — < 20 free bytes; "+ New waveform" may not fit.
   *   over  — already over (a build will throw "Won't fit").
   */
  function refreshRomBudget(): void {
    const b = computeBudget(project.engineBase, toRomSlots(project.slots), {
      waveformOverrides: project.waveformOverrides,
      patternOverrides: project.patternOverrides,
      addedWaveforms: project.addedWaveforms,
    });
    const headroom = b.freeRegion - b.used;
    const state = b.overrun > 0 ? "over" : headroom < 20 ? "tight" : "ok";
    romSpace.dataset.state = state;
    if (b.overrun > 0) {
      romSpace.textContent = `· ROM ${b.used}/${b.freeRegion} B (${b.overrun} over)`;
    } else {
      romSpace.textContent = `· ROM ${b.used}/${b.freeRegion} B (${headroom} free)`;
    }
    const detail = b.relocated
      ? `VVECT ${b.vvectBytes} B + relocated GWVTAB ${b.gwvtabBytes} B = ${b.used} B in the free region.`
      : `VVECT extent ${b.vvectBytes} B in the ${b.freeRegion} B free region. Adding new waveforms relocates GWVTAB into this region.`;
    romSpace.title = `Custom ROM space (between VVECT and original GWVTAB): ${b.freeRegion} bytes total.\n${detail}`;
  }

  function selectSlot(i: number): void {
    stopPlayback(); clearTimeout(autoReplayTimer);
    selected = i;
    const slot = project.slots[i];
    if (slot) {
      showEditorFor(slot.kind);
      if (slot.kind === "lfsr" || slot.kind === "fnoise") {
        // Rebuild the per-command slider set, then seed its values.
        const fields = slot.kind === "lfsr"
          ? lfsrFieldsFor(project.engineBase, slot.targetCmd)
          : fnoiseFieldsFor(project.engineBase, slot.targetCmd);
        fieldEditor.setFields(fields);
        fieldEditor.setRecord(slot.record);
      } else if (slot.kind === "radio") {
        radioEditor.setRecord(slot.record);
      } else {
        (slot.kind === "vari" ? variEditor : gwaveEditor).setRecord(slot.record);
        if (slot.kind === "gwave") { refreshGwaveEditorLimits(); refreshWaveformCanvas(); refreshPatternCanvas(); }
      }
    }
    refreshItemList();
    setControlsEnabled(baseRom != null);
    refreshRecordResetState();
    if (slot && baseRom) redrawScope();
  }

  /**
   * Push the resolved bytes for the GWAVE slot's current WAVE# into the
   * editor's canvas: the project's override if any, else the base ROM's
   * stock waveform.  Also feeds the "Shared by" list (which editable
   * commands point at this idx in the base ROM).  Called whenever the
   * selected slot changes, WAVE# changes, or a waveform-byte / reset edit
   * fires.
   */
  function refreshWaveformCanvas(): void {
    if (!baseRom) return;
    const slot = project.slots[selected];
    if (!slot || slot.kind !== "gwave") return;
    const idx = gwaveEditor.currentWaveIdx();
    if (idx <= 6) {
      // Stock waveform — bytes come from the base ROM, possibly overridden
      // by `waveformOverrides` (Step 2 behaviour, unchanged).
      const overridden = project.waveformOverrides?.[idx];
      const bytes = overridden ?? readWaveform(baseRom, project.engineBase, idx);
      const sharedBy = waveformUsers(baseRom, project.engineBase, idx).map((c) => ({ cmd: c.cmd, name: c.name }));
      gwaveEditor.setWaveform([...bytes], sharedBy, !!overridden);
    } else {
      // User-added waveform (Phase 5 step 4) — bytes live in the project,
      // not in the base ROM.  "Shared by" lists other editable commands
      // whose SVTAB WAVE# nybble happens to point at this idx (in the
      // base ROM).  The canvas treats `isOverridden = true` for added
      // waves so the Reset button stays meaningful as "Remove this
      // waveform" semantics later, or as a visual cue right now.
      const addedIdx = idx - 7;
      const bytes = project.addedWaveforms?.[addedIdx] ?? [];
      const sharedBy = waveformUsers(baseRom, project.engineBase, idx).map((c) => ({ cmd: c.cmd, name: c.name }));
      gwaveEditor.setWaveform([...bytes], sharedBy, true);
    }
  }

  /** Clamp the WAVE# slider to existing waveforms (6 stock + N added). */
  function refreshGwaveEditorLimits(): void {
    const maxIdx = 6 + (project.addedWaveforms?.length ?? 0);
    gwaveEditor.setMaxWaveIdx(maxIdx);
  }

  /**
   * Push the resolved bytes for the GWAVE slot's current (PATOFF, PATLEN)
   * into the editor's pattern canvas: the project's override if any, else
   * the base ROM's stock GFRTAB bytes.  When PATLEN is 0 the canvas
   * renders an empty state.  "Shared by" excludes the slot's own targetCmd
   * — it's the command the user is currently editing.
   */
  function refreshPatternCanvas(): void {
    if (!baseRom) return;
    const slot = project.slots[selected];
    if (!slot || slot.kind !== "gwave") return;
    const offset = gwaveEditor.currentPatternOffset();
    const length = gwaveEditor.currentPatternLength();
    if (length === 0) {
      gwaveEditor.setPattern([], [], false);
      return;
    }
    const overridden = project.patternOverrides?.[offset];
    // If the override exists but doesn't cover the full PATLEN (e.g. user
    // reduced PATLEN after editing), trim/extend from base to fill the gap.
    let bytes: number[];
    if (overridden) {
      if (overridden.length >= length) {
        bytes = overridden.slice(0, length);
      } else {
        bytes = [...overridden, ...readPattern(baseRom, project.engineBase, offset + overridden.length, length - overridden.length)];
      }
    } else {
      bytes = readPattern(baseRom, project.engineBase, offset, length);
    }
    const sharedBy = patternUsers(baseRom, project.engineBase, offset, length)
      .filter((c) => c.cmd !== slot.targetCmd)
      .map((c) => ({ cmd: c.cmd, name: c.name }));
    gwaveEditor.setPattern(bytes, sharedBy, !!overridden);
  }

  function addNew(): void {
    if (!baseRom || !supportsVari(project.engineBase) || variCount(project.slots) >= maxVari()) return;
    const record = readVariRecord(baseRom, project.engineBase, VARI_CMD_BASE); // base SAW as a starting point
    // Phase 6.1: the populated stocks own $1D..$1F (SAW/FOSHIT/QUASAR);
    // a user-added VARI lands at $20+ via the auto-assign rule.  Default
    // the name to "My $XX" so it reads as user-authored next to the stock
    // SAW / FOSHIT / QUASAR rows.
    const newCmd = VARI_CMD_BASE + variCount(project.slots);
    const name = `My $${newCmd.toString(16).toUpperCase()}`;
    project.slots.push({ kind: "vari", name, record, start: [...record] });
    touch();
    selectSlot(project.slots.length - 1);
    status(`Added a new VARI sound at $${newCmd.toString(16).toUpperCase()}.`);
  }

  function addCopy(label: string, record: number[]): void {
    if (!baseRom || !supportsVari(project.engineBase)) { status("VARI slots aren't supported on Robotron — switch engine base, or use Override GWAVE.", "err"); return; }
    if (variCount(project.slots) >= maxVari()) { status("VARI at capacity — remove a slot first.", "err"); return; }
    project.slots.push({ kind: "vari", name: label, record: [...record], start: [...record] });
    touch();
    selectSlot(project.slots.length - 1);
    status(`Copied ${label}.`, "ok");
  }

  /** Add a GWAVE override slot: copies the base game's existing record at `targetCmd`. */
  function addGwaveOverride(targetCmd: number): void {
    if (!baseRom) return;
    if (project.slots.some((s) => s.kind === "gwave" && s.targetCmd === targetCmd)) {
      status(`$${targetCmd.toString(16).toUpperCase()} is already overridden — edit that slot instead.`, "err");
      return;
    }
    const record = readGWaveRecord(baseRom, project.engineBase, targetCmd);
    const name = gwaveCommandsFor(project.engineBase).find((c) => c.cmd === targetCmd)?.name ?? `$${targetCmd.toString(16).toUpperCase()}`;
    project.slots.push({ kind: "gwave", name: `My ${name}`, record, start: [...record], targetCmd });
    touch();
    selectSlot(project.slots.length - 1);
    status(`Overriding ${name} ($${targetCmd.toString(16).toUpperCase()}).`, "ok");
  }

  function removeSlot(i: number): void {
    stopPlayback();
    project.slots.splice(i, 1);
    touch();
    if (selected >= project.slots.length) selected = project.slots.length - 1;
    if (selected >= 0) selectSlot(selected); else { setControlsEnabled(baseRom != null); refreshItemList(); }
  }

  function onEditorChange(rec: number[]): void {
    const slot = project.slots[selected];
    if (!slot) return;
    slot.record = rec;
    touch();
    source = "edited"; updateSourceUi();
    refreshRecordResetState();
    scheduleAutoReplay();
  }

  // ── Audition (build the custom image, play the selected slot) ─────────────

  function buildEdited(): Uint8Array {
    return buildCustomRom(baseRom!, project.engineBase, toRomSlots(project.slots), {
      waveformOverrides: project.waveformOverrides,
      patternOverrides: project.patternOverrides,
      addedWaveforms: project.addedWaveforms,
    });
  }
  function renderEdited(): RenderedSound {
    return renderSound(project.engineBase, buildEdited(), slotCmd(project.slots, selected));
  }
  /** Render the selected slot's `start` bytes — for the A/B "Start" toggle and Diff overlay. */
  function renderStart(): RenderedSound {
    const slot = project.slots[selected]!;
    if (slot.kind === "vari") {
      // Build a ROM containing only this one VARI sound (at the base code $1D)
      // and fire it — gives the unedited timbre without any sibling VARI slots
      // bleeding in.
      const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "vari", code: VARI_CMD_BASE, record: slot.start }]);
      return renderSound(project.engineBase, rom, VARI_CMD_BASE);
    }
    if (slot.kind === "gwave") {
      // GWAVE: override the same target with the `start` bytes and fire that code.
      const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "gwave", cmd: slot.targetCmd, record: slot.start }]);
      return renderSound(project.engineBase, rom, slot.targetCmd);
    }
    if (slot.kind === "lfsr") {
      // LFSR: override the same target with the `start` field values and fire it.
      const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "lfsr", cmd: slot.targetCmd, record: slot.start }]);
      return renderSound(project.engineBase, rom, slot.targetCmd);
    }
    if (slot.kind === "fnoise") {
      // FNOISE: override-in-place shape (FNTAB row or caller immediates).
      const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "fnoise", cmd: slot.targetCmd, record: slot.start }]);
      return renderSound(project.engineBase, rom, slot.targetCmd);
    }
    // RADIO: override the FREQ immediate + RADSND LUT with the `start` record.
    const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "radio", cmd: slot.targetCmd, record: slot.start }]);
    return renderSound(project.engineBase, rom, slot.targetCmd);
  }

  function drawScopeFrame(withPlayhead: boolean): void {
    if (diffOn && editedR && startR) drawDiff(scope, startR.samples, editedR.samples);
    else {
      const r = source === "edited" ? editedR : startR;
      if (r) drawWaveform(scope, r.samples, source === "edited" ? "#a9dc76" : "#6b7280");
    }
    if (withPlayhead) { const p = playbackProgress(); if (p !== null) drawPlayhead(scope, p); }
  }
  function redrawScope(): void {
    cancelAnimationFrame(scopeRaf); scopeRaf = 0;
    try { editedR = renderEdited(); startR = renderStart(); } catch { /* invalid build — leave last frame */ return; }
    drawScopeFrame(false);
  }
  function animateScope(): void {
    cancelAnimationFrame(scopeRaf);
    const tick = (): void => {
      drawScopeFrame(true);
      scopeRaf = playbackState() === "idle" ? 0 : requestAnimationFrame(tick);
    };
    scopeRaf = requestAnimationFrame(tick);
  }

  function play(): void {
    if (selected < 0 || !baseRom) return;
    try {
      editedR = renderEdited();
      startR = renderStart();
    } catch (e) {
      status(`Render failed: ${e instanceof Error ? e.message : String(e)}`, "err");
      return;
    }
    const r = source === "edited" ? editedR : startR;
    playSamples(r.samples, volume, loop);
    animateScope();
    status(`${source === "edited" ? (r.reachedIdle ? "" : "(capped) ") + "Edited" : "Start"} — ${durationMs(r.cycles).toFixed(0)} ms${loop ? " · looping" : ""}.`, source === "edited" ? "ok" : "");
  }

  function updateSourceUi(): void {
    srcEditedBtn.classList.toggle("active", source === "edited");
    srcStartBtn.classList.toggle("active", source === "start");
  }
  function setSource(s: "edited" | "start"): void {
    source = s; updateSourceUi();
    if (playbackState() === "idle") redrawScope(); else play();
  }
  function scheduleAutoReplay(): void {
    clearTimeout(autoReplayTimer);
    autoReplayTimer = window.setTimeout(() => play(), 130);
  }

  addNewBtn.addEventListener("click", addNew);
  copySelect.addEventListener("change", () => {
    const idx = Number(copySelect.value);
    const src = copySources[idx];
    if (src) addCopy(src.label, src.record);
    copySelect.value = "";
  });
  gwaveOverrideSelect.addEventListener("change", () => {
    const cmd = Number(gwaveOverrideSelect.value);
    if (cmd) addGwaveOverride(cmd);
    gwaveOverrideSelect.value = "";
  });

  // ── Engine base + copy sources ────────────────────────────────────────

  async function setEngine(game: GameKind): Promise<void> {
    if (!ctx.availableGames().has(game)) { status(`${LABEL[game]} ROM not loaded.`, "err"); refreshEngineUi(); return; }
    // Phase 6.1: VARI count is now stock-aware — stock slots are pre-populated
    // on every game and represent no user intent, so they're free to drop on
    // an engine switch.  Only edited + user-added VARI count against the
    // limits / Robotron's no-VARI rule.
    const prevGame = project.engineBase;
    const nonStockVariCount = project.slots
      .filter((s, i) => s.kind === "vari" && !isStockSlot(project.slots, i, prevGame))
      .length;
    if (!supportsVari(game) && nonStockVariCount > 0) {
      status(`${LABEL[game]} can't host VARI slots — your ${nonStockVariCount} edited/added VARI sound(s) would be lost. Reset or remove them first.`, "err"); return;
    }
    if (supportsVari(game) && nonStockVariCount > maxSlots(game)) {
      status(`${LABEL[game]} holds at most ${maxSlots(game)} VARI sounds; trim the list first.`, "err"); return;
    }
    // Existing GWAVE override targets must remain editable on the new base
    // (all three games share the editable $01..$0D list, so this is a no-op
    // today — written as a guard against future per-game divergence).
    const editable = new Set(gwaveCommandsFor(game).map((c) => c.cmd));
    for (const s of project.slots) {
      if (s.kind === "gwave" && !editable.has(s.targetCmd)) {
        status(`GWAVE override $${s.targetCmd.toString(16).toUpperCase()} isn't valid on ${LABEL[game]} — remove it first.`, "err");
        return;
      }
    }
    // Edited LFSR overrides must remain editable on the new base.  LAUNCH ($39)
    // is Robotron-only — an *edited* LAUNCH would be lost on Defender/Stargate.
    // Stock (unedited) LFSR slots are dropped + repopulated below, so only an
    // edited slot referencing a now-invalid code blocks the switch.
    for (let i = 0; i < project.slots.length; i++) {
      const s = project.slots[i]!;
      if (s.kind === "lfsr" && LFSR_CALLER_BASE[game][s.targetCmd] === undefined && !isStockSlot(project.slots, i, prevGame)) {
        status(`LFSR override $${s.targetCmd.toString(16).toUpperCase()} isn't valid on ${LABEL[game]} — reset or remove it first.`, "err");
        return;
      }
    }
    // Edited FNOISE overrides must stay editable on the new base. BG1 ($0F) and
    // HBOMB ($3E) are Robotron-only in the FNOISE set; an edited one would be
    // lost on Defender/Stargate.  Stock slots are dropped + repopulated below.
    const fnoiseEditable = new Set(fnoiseCommandsFor(game).map((c) => c.cmd));
    for (let i = 0; i < project.slots.length; i++) {
      const s = project.slots[i]!;
      if (s.kind === "fnoise" && !fnoiseEditable.has(s.targetCmd) && !isStockSlot(project.slots, i, prevGame)) {
        status(`FNOISE override $${s.targetCmd.toString(16).toUpperCase()} isn't valid on ${LABEL[game]} — reset or remove it first.`, "err");
        return;
      }
    }
    project.engineBase = game;
    // Drop stock slots (they reference the OLD base ROM's bytes); populate
    // below repopulates them fresh from the NEW base ROM.  Edited / user-added
    // slots survive.  Pre-compute flags so the in-place index isn't broken
    // mid-filter by `splice`-style index shifts.
    const stockFlags = project.slots.map((_s, i) => isStockSlot(project.slots, i, prevGame));
    project.slots = project.slots.filter((_s, i) => !stockFlags[i]);
    touch();
    refreshEngineUi();
    await loadEngineRom();
  }

  /**
   * Phase 6.1: pre-populate the project's slot list with the engine base's
   * editable commands.  Idempotent — preserves any existing slot bytes (so
   * user edits and user-added VARI rows survive a re-populate), and fills in
   * stock entries for any canonical command not already in the list.  The
   * result is sorted canonically: GWAVE block (by `targetCmd` asc) first,
   * then VARI stock (rows 0..2 in order), then any user-added VARI rows.
   *
   * Called from `loadEngineRom` (every time the base ROM loads, which covers
   * both *New Project* and *Open Project*), so opening a saved sparse project
   * — whose `slots` only contains the user's deltas — comes back to a fully
   * populated list.
   */
  function populateProject(p: CustomProject, rom: Uint8Array): void {
    const game = p.engineBase;
    const gwaveExisting = new Map<number, CustomSlot>();
    const lfsrExisting = new Map<number, CustomSlot>();
    const fnoiseExisting = new Map<number, CustomSlot>();
    const radioExisting = new Map<number, CustomSlot>();
    const variExisting: CustomSlot[] = [];
    for (const s of p.slots) {
      if (s.kind === "gwave") gwaveExisting.set(s.targetCmd, s);
      else if (s.kind === "lfsr") lfsrExisting.set(s.targetCmd, s);
      else if (s.kind === "fnoise") fnoiseExisting.set(s.targetCmd, s);
      else if (s.kind === "radio") radioExisting.set(s.targetCmd, s);
      else variExisting.push(s);
    }
    const out: CustomSlot[] = [];
    // GWAVE stock entries (every editable code) — preserve any existing slot.
    for (const c of gwaveCommandsFor(game)) {
      const ex = gwaveExisting.get(c.cmd);
      if (ex) { out.push(ex); continue; }
      const record = readGWaveRecord(rom, game, c.cmd);
      out.push({ kind: "gwave", name: c.name, record, start: [...record], targetCmd: c.cmd });
    }
    // LFSR stock entries (LITE / TURBO / APPEAR; + LAUNCH on Robotron) —
    // override-in-place, every game.  The record is the virtual field-value
    // list read from the caller-code immediates.
    for (const c of lfsrCommandsFor(game)) {
      const ex = lfsrExisting.get(c.cmd);
      if (ex) { out.push(ex); continue; }
      const record = readLfsrRecord(rom, game, c.cmd);
      out.push({ kind: "lfsr", name: c.name, record, start: [...record], targetCmd: c.cmd });
    }
    // FNOISE stock entries — Robotron: BG1 / THRUST / CANNON / HBOMB (FNTAB);
    // Defender/Stargate: THRUST + CANNON (inline; BG1 has no patchable immediate).
    for (const c of fnoiseCommandsFor(game)) {
      const ex = fnoiseExisting.get(c.cmd);
      if (ex) { out.push(ex); continue; }
      const record = readFnoiseRecord(rom, game, c.cmd);
      out.push({ kind: "fnoise", name: c.name, record, start: [...record], targetCmd: c.cmd });
    }
    // RADIO stock entry — a single $18 command on every game (FREQ + 16-byte LUT).
    for (const c of radioCommandsFor(game)) {
      const ex = radioExisting.get(c.cmd);
      if (ex) { out.push(ex); continue; }
      const record = readRadioRecord(rom, game);
      out.push({ kind: "radio", name: c.name, record, start: [...record], targetCmd: c.cmd });
    }
    if (supportsVari(game)) {
      const stockVari = variCommandsFor(game).filter((c) => c.row <= 2);
      // First 3 VARI positions are the stock SAW/FOSHIT/QUASAR rows;
      // anything beyond is user-added VARI ($20+).
      for (let row = 0; row < stockVari.length; row++) {
        const ex = variExisting[row];
        if (ex) { out.push(ex); continue; }
        const c = stockVari[row]!;
        const record = readVariRecord(rom, game, c.cmd);
        out.push({ kind: "vari", name: c.name, record, start: [...record] });
      }
      for (let k = stockVari.length; k < variExisting.length; k++) out.push(variExisting[k]!);
    } else {
      // Robotron: no VARI population (non-linear dispatch is still v-future).
      // Defensive: preserve any pre-existing VARI rows even though the UI
      // shouldn't have allowed them — they'll be hidden by setControlsEnabled.
      for (const v of variExisting) out.push(v);
    }
    p.slots = out;
  }

  /**
   * Phase 6.1: serialise a project as a sparse recipe — strip every "stock"
   * slot (record unchanged from start), keeping the JSON / IndexedDB shape
   * small + portable.  On open, `populateProject` re-creates the stocks.
   * Non-slot fields (waveformOverrides / patternOverrides / addedWaveforms /
   * name / engineBase / timestamps) round-trip unchanged.
   */
  function projectForPersist(p: CustomProject): CustomProject {
    const game = p.engineBase;
    const filtered = p.slots.filter((_s, i) => !isStockSlot(p.slots, i, game));
    return { ...p, slots: filtered };
  }

  async function loadEngineRom(): Promise<void> {
    if (!ctx.availableGames().has(project.engineBase)) {
      baseRom = null;
      lockedMsg.textContent = `Load the ${LABEL[project.engineBase]} ROM in Explore mode first — Design needs a base ROM to layer your custom sounds onto.`;
      setControlsEnabled(false);
      return;
    }
    try {
      baseRom = await loadRomBytes(project.engineBase);
    } catch (e) {
      baseRom = null;
      lockedMsg.textContent = `Could not load ${LABEL[project.engineBase]} ROM: ${e instanceof Error ? e.message : String(e)}`;
      setControlsEnabled(false);
      return;
    }
    // Phase 6.1: fill in stock entries before showing the item list.
    populateProject(project, baseRom);
    setControlsEnabled(true);
    refreshItemList();
    // Phase 6.1: auto-select the first slot once the list is populated so
    // the editor + audition strip are visible immediately — the user sees
    // an editable thing on landing, rather than a list with the editor
    // collapsed.  Skipped when the caller already chose a slot (open path).
    if (selected < 0 && project.slots.length > 0) selected = 0;
    if (selected >= 0 && selected < project.slots.length) selectSlot(selected);
  }

  async function loadCopySources(): Promise<void> {
    const out: { label: string; record: number[] }[] = [];
    for (const g of ["defender", "stargate", "robotron"] as GameKind[]) {
      if (!ctx.availableGames().has(g)) continue;
      try {
        const rom = await loadRomBytes(g);
        for (const c of variCommandsFor(g)) out.push({ label: `${LABEL[g]} ${c.name}`, record: readVariRecord(rom, g, c.cmd) });
      } catch { /* skip a game we can't read */ }
    }
    copySources = out;
    copySelect.replaceChildren(
      el("option", { value: "", textContent: out.length ? "copy from…" : "no ROMs to copy from" }),
      ...out.map((s, i) => el("option", { value: String(i), textContent: s.label })),
    );
  }

  // ── Project save / open / new / export / import ──────────────────────────

  async function refreshProjectList(): Promise<void> {
    const projects = await listProjects();
    projectSelect.replaceChildren(
      el("option", { value: "", textContent: projects.length ? "— open —" : "— none saved —" }),
      ...projects.map((p) => el("option", { value: p.name, textContent: `${p.name} (${LABEL[p.engineBase]})` })),
    );
  }

  async function openProject(p: CustomProject): Promise<void> {
    project = p;
    nameInput.value = p.name;
    selected = p.slots.length ? 0 : -1;
    refreshEngineUi();
    await loadEngineRom();
    status(`Opened "${p.name}".`, "ok");
  }

  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) { status("Give the project a name first.", "err"); return; }
    project.name = name; touch();
    // Persist only the deltas (Phase 6.1): stock slots are reconstructed by
    // `populateProject` on open, so writing them would just bloat the recipe.
    void saveProject(projectForPersist(project))
      .then(() => {
        status(`Saved "${name}".`, "ok");
        // F2 fix: after refreshing the option list, point the Open dropdown
        // at the just-saved project so the user sees "this is what I'm on"
        // instead of the default "— open —" placeholder.
        return refreshProjectList().then(() => { projectSelect.value = name; });
      })
      .catch((e: unknown) => status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "err"));
  });
  newBtn.addEventListener("click", () => {
    project = emptyProject(project.engineBase);
    nameInput.value = ""; selected = -1;
    projectSelect.value = ""; // empty project → drop the Open: selection too
    // Phase 6.1: pre-populate the fresh project from the loaded base ROM so
    // the list isn't empty — the user lands on a "this is the game's sound
    // bank, edit any of it" view, not a "build from scratch" view.  Same
    // shape as `loadEngineRom`'s populate; the auto-select picks slot 0.
    if (baseRom) {
      populateProject(project, baseRom);
      if (project.slots.length > 0) selected = 0;
    }
    refreshItemList(); setControlsEnabled(baseRom != null);
    if (selected >= 0) selectSlot(selected);
    status("New project.");
  });
  projectSelect.addEventListener("change", () => {
    const name = projectSelect.value;
    if (name) void getProject(name).then((p) => { if (p) void openProject(p); });
  });
  exportBtn.addEventListener("click", () => {
    project.name = nameInput.value.trim() || "untitled";
    // Export sparse (Phase 6.1) — same rationale as save: stock slots come
    // back via `populateProject` on import; persisting them is dead weight.
    const blob = new Blob([exportJson(projectForPersist(project))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `${project.name.replace(/[^A-Za-z0-9]+/g, "_")}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported "${project.name}.json".`, "ok");
  });
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => { void openProject(importJson(text)); })
      .catch((e: unknown) => status(`Import failed: ${e instanceof Error ? e.message : String(e)}`, "err"))
      .finally(() => { importInput.value = ""; });
  });

  // Phase 6.2: ↓ .bin — download the built custom ROM image.  We need a
  // valid baseRom (the build won't run otherwise) AND the build itself to
  // succeed; an over-budget project's "Won't fit" error surfaces here.
  exportBinBtn.addEventListener("click", () => {
    if (!baseRom) { status("Load the base ROM first.", "err"); return; }
    project.name = nameInput.value.trim() || "untitled";
    let bytes: Uint8Array;
    try { bytes = buildEdited(); }
    catch (e) { status(`Build failed: ${e instanceof Error ? e.message : String(e)}`, "err"); return; }
    // Wrap in a fresh Uint8Array so its `.buffer` is a plain `ArrayBuffer`
    // (not `ArrayBufferLike` / potentially `SharedArrayBuffer`), which Blob's
    // strict type signature requires.
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const safeName = project.name.replace(/[^A-Za-z0-9]+/g, "_");
    const a = el("a", { href: url, download: `${safeName}_${project.engineBase}.bin` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported "${safeName}_${project.engineBase}.bin" — for personal use, don't redistribute (contains Williams ROM bytes).`, "ok");
  });
  // ↑ .bin — diff against the user's base ROM in IndexedDB and reconstruct
  // the project's deltas via importBinAsProject (headless, full-fidelity).
  // The file picker's `accept=".bin"` is advisory; we re-validate size before
  // passing to the importer.
  importBinInput.addEventListener("change", () => {
    const file = importBinInput.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then(async (buf) => {
      const bin = new Uint8Array(buf);
      // Identify game by size (Defender/Stargate share 2 KB, Robotron is 4 KB).
      // For the 2 KB ambiguity, use the project's current engine base — the
      // user picked which game in the header before clicking ↑ .bin.
      const game: GameKind = bin.length === ROM_SIZE.robotron
        ? "robotron"
        : project.engineBase;
      if (bin.length !== ROM_SIZE[game]) {
        throw new Error(`Wrong .bin size: got ${bin.length}, expected ${ROM_SIZE[game]} bytes for ${LABEL[game]}.`);
      }
      if (!ctx.availableGames().has(game)) {
        throw new Error(`${LABEL[game]} base ROM is not loaded — add it in Explore mode first.`);
      }
      const refRom = await loadRomBytes(game);
      const reconstructed = importBinAsProject(bin, refRom, game);
      // Fold the reconstruction into a CustomProject and open it through the
      // normal path so engine UI, populate, audition all wire up.
      const now = Date.now();
      const newProj: CustomProject = {
        name: file.name.replace(/\.bin$/i, "") || "imported",
        engineBase: reconstructed.engineBase,
        slots: reconstructed.slots as CustomSlot[],
        ...(reconstructed.waveformOverrides ? { waveformOverrides: reconstructed.waveformOverrides } : {}),
        ...(reconstructed.patternOverrides ? { patternOverrides: reconstructed.patternOverrides } : {}),
        ...(reconstructed.addedWaveforms ? { addedWaveforms: reconstructed.addedWaveforms } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await openProject(newProj);
      const editCount = reconstructed.slots.length
        + Object.keys(reconstructed.waveformOverrides ?? {}).length
        + Object.keys(reconstructed.patternOverrides ?? {}).length
        + (reconstructed.addedWaveforms?.length ?? 0);
      status(`Imported "${file.name}" — reconstructed ${editCount} edit(s) from the .bin.`, "ok");
    }).catch((e: unknown) => status(`.bin import failed: ${e instanceof Error ? e.message : String(e)}`, "err"))
      .finally(() => { importBinInput.value = ""; });
  });

  // ── Boot ──────────────────────────────────────────────────────────────
  refreshEngineUi();
  refreshItemList();
  void loadCopySources();
  void refreshProjectList();
  void loadEngineRom();

  return {
    dispose(): void {
      stopPlayback(); cancelAnimationFrame(scopeRaf);
      root.replaceChildren(); root.classList.remove("designer");
    },
  };
}
