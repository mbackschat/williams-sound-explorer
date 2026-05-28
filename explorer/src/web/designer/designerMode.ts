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
import { buildCustomRom, computeBudget, maxSlots, VARI_CMD_BASE, type CustomSlot as RomCustomSlot } from "../../engine/customRom.ts";
import {
  ENGINE_BASES, listProjects, getProject, saveProject, exportJson, importJson,
  type CustomProject, type CustomSlot,
} from "./designerStore.ts";
import { buildVariEditor, type VariEditorApi } from "./variEditor.ts";
import { buildGWaveEditor, type GWaveEditorApi } from "./gwaveEditor.ts";
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
      : { kind: "gwave", cmd: s.targetCmd, record: s.record },
  );
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
  const exportBtn = el("button", { textContent: "↓ Export", title: "Download this project as a JSON recipe file (no ROM bytes — safe to share)." });
  const importInput = el("input", { type: "file", accept: "application/json,.json", className: "designer-import" });
  const importBtn = el("button", { textContent: "↑ Import", title: "Load a project from a JSON recipe file." });
  importBtn.addEventListener("click", () => importInput.click());
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

  // Four logical groups separated by `.sep` dividers so the bar reads as
  // grouped controls rather than one long shoulder-to-shoulder row:
  //   1. Engine base       — D / S / R picker.
  //   2. Project (edit)    — "Project:" label + name input + Save + New.
  //   3. Open (switch)     — load a saved project from the in-browser store.
  //   4. File transfer     — Export / Import the project as JSON.
  const header = el("div", { className: "designer-header" }, [
    el("h2", { textContent: "🎛 Sound Designer — Custom ROM" }),
    el("span", { className: "designer-sub", textContent: "Build your own list of VARI sounds: copy from any game or start new, edit, audition, save." }),
    el("div", { className: "designer-bar" }, [
      el("span", { className: "designer-bar-label", textContent: "Engine:" }), enginePicker,
      el("span", { className: "sep" }),
      el("span", { className: "designer-bar-label", textContent: "Project:" }), nameInput, saveBtn, newBtn,
      el("span", { className: "sep" }),
      el("span", { className: "designer-bar-label", textContent: "Open:" }), projectSelect,
      el("span", { className: "sep" }),
      exportBtn, importBtn, importInput,
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
  const itemsSection = el("div", { className: "designer-section designer-items-head" }, [
    el("span", { className: "designer-bar-label", textContent: "Your sounds" }), itemCount,
    romSpace,
    el("span", { className: "sep" }), addNewBtn,
    el("span", { className: "designer-bar-label", textContent: "Copy VARI:" }), copySelect,
    el("span", { className: "sep" }),
    el("span", { className: "designer-bar-label", textContent: "Override GWAVE:" }), gwaveOverrideSelect,
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
  // The sliders column contains *both* editors' slider panels (VARI + GWAVE);
  // only one is visible at a time depending on the selected slot's kind.
  // Waveform/pitch canvases sit in their own grid columns to the right.
  const slidersCol = el("div", { className: "designer-edit-sliders-col" });
  slidersCol.append(variEditor.el, gwaveEditor.slidersEl);
  variEditor.el.style.display = "";
  gwaveEditor.slidersEl.style.display = "none";
  gwaveEditor.waveformPanelEl.style.display = "none";
  gwaveEditor.patternPanelEl.style.display = "none";

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

  function showEditorFor(kind: "vari" | "gwave"): void {
    variEditor.el.style.display = kind === "vari" ? "" : "none";
    gwaveEditor.slidersEl.style.display = kind === "gwave" ? "" : "none";
    gwaveEditor.waveformPanelEl.style.display = kind === "gwave" ? "" : "none";
    gwaveEditor.patternPanelEl.style.display = kind === "gwave" ? "" : "none";
    editRow.classList.toggle("designer-edit-row-vari", kind === "vari");
    editRow.classList.toggle("designer-edit-row-gwave", kind === "gwave");
    editorLabelText.textContent = kind === "vari"
      ? "Parameter record (VVECT — VARI)"
      : "Parameter record (SVTAB — GWAVE override)";
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
    const ed = slot.kind === "vari" ? variEditor : gwaveEditor;
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
    for (const b of [saveBtn, newBtn, exportBtn]) b.disabled = !on;
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
    const v = variCount(project.slots);
    const cap = maxVari();
    itemCount.textContent = supportsVari(project.engineBase)
      ? `(VARI ${v}/${cap})`
      : `(${project.slots.length} sounds — Robotron is GWAVE-only)`;
    itemList.replaceChildren(...project.slots.map((slot, i) => {
      const row = el("div", { className: `designer-item designer-item-${slot.kind}${i === selected ? " active" : ""}` });
      row.addEventListener("click", () => selectSlot(i));
      const name = el("input", { className: "designer-item-name", value: slot.name }) as HTMLInputElement;
      name.addEventListener("click", (e) => e.stopPropagation());
      name.addEventListener("input", () => { slot.name = name.value; touch(); });
      const codeText = slot.kind === "vari"
        ? `$${slotCmd(project.slots, i).toString(16).toUpperCase().padStart(2, "0")} VARI`
        : `$${slot.targetCmd.toString(16).toUpperCase().padStart(2, "0")} GWAVE`;
      const code = el("span", { className: "designer-item-code", textContent: codeText });
      code.title = slot.kind === "vari"
        ? "Custom VARI slot — auto-assigned command code (extends VVECT)."
        : `Overrides the base game's GWAVE command $${slot.targetCmd.toString(16).toUpperCase()} in place.`;
      const del = el("button", { className: "designer-item-del", textContent: "✕", title: "Remove this sound" });
      del.addEventListener("click", (e) => { e.stopPropagation(); removeSlot(i); });
      row.append(code, name, del);
      return row;
    }));
    if (project.slots.length === 0) {
      itemList.append(el("div", { className: "designer-empty", textContent: "No sounds yet — “+ New VARI” / “Copy VARI:” / “Override GWAVE:” to add one." }));
    }
    refreshGwaveOverrideOptions();
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
      (slot.kind === "vari" ? variEditor : gwaveEditor).setRecord(slot.record);
      if (slot.kind === "gwave") { refreshGwaveEditorLimits(); refreshWaveformCanvas(); refreshPatternCanvas(); }
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
    project.slots.push({ kind: "vari", name: `Sound ${variCount(project.slots) + 1}`, record, start: [...record] });
    touch();
    selectSlot(project.slots.length - 1);
    status("Added a new VARI sound.");
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
    // GWAVE: override the same target with the `start` bytes and fire that code.
    const rom = buildCustomRom(baseRom!, project.engineBase, [{ kind: "gwave", cmd: slot.targetCmd, record: slot.start }]);
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
    if (!supportsVari(game) && variCount(project.slots) > 0) {
      status(`${LABEL[game]} can't host VARI slots — remove your VARI sounds first.`, "err"); return;
    }
    if (supportsVari(game) && variCount(project.slots) > maxSlots(game)) {
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
    project.engineBase = game;
    touch();
    refreshEngineUi();
    await loadEngineRom();
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
    setControlsEnabled(true);
    refreshItemList();
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
    void saveProject(project)
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
    refreshItemList(); setControlsEnabled(baseRom != null);
    status("New project.");
  });
  projectSelect.addEventListener("change", () => {
    const name = projectSelect.value;
    if (name) void getProject(name).then((p) => { if (p) void openProject(p); });
  });
  exportBtn.addEventListener("click", () => {
    project.name = nameInput.value.trim() || "untitled";
    const blob = new Blob([exportJson(project)], { type: "application/json" });
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
