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
import { buildCustomRom, maxSlots, VARI_CMD_BASE } from "../../engine/customRom.ts";
import {
  ENGINE_BASES, listProjects, getProject, saveProject, exportJson, importJson,
  type CustomProject,
} from "./designerStore.ts";
import { buildVariEditor, type VariEditorApi } from "./variEditor.ts";
import {
  renderSound, playSamples, drawWaveform, drawDiff, drawPlayhead, durationMs,
  onPlaybackState, pauseResume, stopPlayback, setLoop, playbackState, playbackProgress,
  type PlayState, type RenderedSound,
} from "./audition.ts";

export interface DesignerHandle { dispose(): void; }

const LABEL: Record<GameKind, string> = { defender: "Defender", stargate: "Stargate", robotron: "Robotron" };

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
  const saveBtn = el("button", { textContent: "Save", title: "Save this custom ROM to the browser (IndexedDB)." });
  const newBtn = el("button", { textContent: "New", title: "Start an empty custom ROM." });
  const exportBtn = el("button", { textContent: "⬇ JSON", title: "Download this project as a JSON recipe (no ROM bytes)." });
  const importInput = el("input", { type: "file", accept: "application/json,.json", className: "designer-import" });
  const importBtn = el("button", { textContent: "⬆ JSON", title: "Load a project from a JSON recipe file." });
  importBtn.addEventListener("click", () => importInput.click());

  const header = el("div", { className: "designer-header" }, [
    el("h2", { textContent: "🎛 Sound Designer — Custom ROM" }),
    el("span", { className: "designer-sub", textContent: "Build your own list of VARI sounds: copy from any game or start new, edit, audition, save." }),
    el("div", { className: "designer-bar" }, [
      el("span", { className: "designer-bar-label", textContent: "Engine:" }), enginePicker,
      el("span", { className: "sep" }),
      nameInput, saveBtn, newBtn,
      el("span", { className: "designer-bar-label", textContent: "Open:" }), projectSelect,
      exportBtn, importBtn, importInput,
    ]),
  ]);

  // ── Item list ──────────────────────────────────────────────────────────
  const itemList = el("div", { className: "designer-items" });
  const itemCount = el("span", { className: "designer-bar-label" });
  const addNewBtn = el("button", { textContent: "+ New", title: "Add a new sound (seeded from the base game's SAW)." });
  const copySelect = el("select", { className: "designer-copy", title: "Copy a sound from any loaded game as a starting point" });
  const itemsSection = el("div", { className: "designer-section designer-items-head" }, [
    el("span", { className: "designer-bar-label", textContent: "Your sounds" }), itemCount,
    el("span", { className: "sep" }), addNewBtn,
    el("span", { className: "designer-bar-label", textContent: "Copy:" }), copySelect,
  ]);

  // ── Editor + audition ──────────────────────────────────────────────────
  const editor: VariEditorApi = buildVariEditor(onEditorChange);
  const editorHost = el("div", { className: "designer-editor-host" });
  editorHost.append(editor.el);

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

  const scope = el("canvas", { className: "designer-scope" }) as HTMLCanvasElement;
  const statusLine = el("div", { className: "designer-status" });
  const editPanel = el("div", { className: "designer-edit" }, [
    el("div", { className: "designer-edit-cols" }, [
      el("div", { className: "designer-edit-left" }, [
        el("div", { className: "designer-edit-label", textContent: "Parameter record (VVECT)" }),
        editorHost,
        el("div", { className: "designer-audition-row" }, [
          playBtn, pauseBtn, loopBtn,
          el("span", { className: "sep" }),
          el("span", { className: "designer-bar-label", textContent: "Source" }), sourceToggle,
        ]),
        el("div", { className: "designer-audition-row" }, [
          diffBtn, el("span", { className: "sep" }),
          el("span", { className: "designer-bar-label", textContent: "Vol" }), volSlider,
        ]),
      ]),
      el("div", { className: "designer-edit-right" }, [
        el("div", { className: "designer-edit-label", textContent: "Audition" }),
        scope, statusLine,
      ]),
    ]),
  ]);

  const lockedMsg = el("div", { className: "designer-locked" });
  root.append(header, itemsSection, itemList, editPanel, lockedMsg);

  // ── Behaviour ──────────────────────────────────────────────────────────

  function setControlsEnabled(on: boolean): void {
    for (const b of [saveBtn, newBtn, exportBtn, addNewBtn]) b.disabled = !on;
    itemsSection.style.display = on ? "" : "none";
    itemList.style.display = on ? "" : "none";
    editPanel.style.display = on && selected >= 0 ? "" : "none";
    lockedMsg.style.display = on ? "none" : "";
  }

  function refreshEngineUi(): void {
    for (const [g, b] of baseButtons) {
      const avail = ctx.availableGames().has(g);
      b.classList.toggle("active", g === project.engineBase);
      b.classList.toggle("locked", !avail);
      b.title = avail ? `Run on ${LABEL[g]}'s VARI engine` : `${LABEL[g]} ROM not loaded — add it in Explore mode first`;
    }
  }

  function refreshItemList(): void {
    itemCount.textContent = `(${project.slots.length} / ${maxSlots(project.engineBase)})`;
    addNewBtn.disabled = project.slots.length >= maxSlots(project.engineBase);
    itemList.replaceChildren(...project.slots.map((slot, i) => {
      const row = el("div", { className: "designer-item" + (i === selected ? " active" : "") });
      row.addEventListener("click", () => selectSlot(i));
      const name = el("input", { className: "designer-item-name", value: slot.name }) as HTMLInputElement;
      name.addEventListener("click", (e) => e.stopPropagation());
      name.addEventListener("input", () => { slot.name = name.value; touch(); });
      const code = el("span", { className: "designer-item-code", textContent: `$${(VARI_CMD_BASE + i).toString(16).toUpperCase()}` });
      const del = el("button", { className: "designer-item-del", textContent: "✕", title: "Remove this sound" });
      del.addEventListener("click", (e) => { e.stopPropagation(); removeSlot(i); });
      row.append(code, name, del);
      return row;
    }));
    if (project.slots.length === 0) itemList.append(el("div", { className: "designer-empty", textContent: "No sounds yet — “+ New” or “Copy:” to add one." }));
  }

  const touch = (): void => { project.updatedAt = Date.now(); };

  function selectSlot(i: number): void {
    stopPlayback(); clearTimeout(autoReplayTimer);
    selected = i;
    const slot = project.slots[i];
    if (slot) editor.setRecord(slot.record);
    refreshItemList();
    setControlsEnabled(baseRom != null);
    if (slot && baseRom) redrawScope();
  }

  function addNew(): void {
    if (!baseRom || project.slots.length >= maxSlots(project.engineBase)) return;
    const record = readVariRecord(baseRom, project.engineBase, VARI_CMD_BASE); // base SAW as a starting point
    project.slots.push({ name: `Sound ${project.slots.length + 1}`, record, start: [...record] });
    touch();
    selectSlot(project.slots.length - 1);
    status("Added a new sound.");
  }

  function addCopy(label: string, record: number[]): void {
    if (!baseRom || project.slots.length >= maxSlots(project.engineBase)) { status("At capacity — remove a sound first.", "err"); return; }
    project.slots.push({ name: label, record: [...record], start: [...record] });
    touch();
    selectSlot(project.slots.length - 1);
    status(`Copied ${label}.`, "ok");
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
    scheduleAutoReplay();
  }

  // ── Audition (build the custom image, play the selected slot) ─────────────

  function buildEdited(): Uint8Array {
    return buildCustomRom(baseRom!, project.engineBase, project.slots.map((s, i) => ({ code: VARI_CMD_BASE + i, record: s.record })));
  }
  function renderEdited(): RenderedSound {
    return renderSound(project.engineBase, buildEdited(), VARI_CMD_BASE + selected);
  }
  function renderStart(): RenderedSound {
    const start = project.slots[selected]!.start;
    return renderSound(project.engineBase, buildCustomRom(baseRom!, project.engineBase, [{ code: VARI_CMD_BASE, record: start }]), VARI_CMD_BASE);
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

  // ── Engine base + copy sources ────────────────────────────────────────

  async function setEngine(game: GameKind): Promise<void> {
    if (!ctx.availableGames().has(game)) { status(`${LABEL[game]} ROM not loaded.`, "err"); refreshEngineUi(); return; }
    if (project.slots.length > maxSlots(game)) { status(`${LABEL[game]} holds at most ${maxSlots(game)} sounds; trim the list first.`, "err"); return; }
    project.engineBase = game;
    touch();
    refreshEngineUi();
    await loadEngineRom();
  }

  async function loadEngineRom(): Promise<void> {
    if (!ctx.availableGames().has(project.engineBase)) {
      baseRom = null;
      lockedMsg.textContent = `Load a Defender or Stargate ROM in Explore mode — a custom ROM runs on one of their VARI engines.`;
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
      .then(() => { status(`Saved "${name}".`, "ok"); return refreshProjectList(); })
      .catch((e: unknown) => status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "err"));
  });
  newBtn.addEventListener("click", () => {
    project = emptyProject(project.engineBase);
    nameInput.value = ""; selected = -1;
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
