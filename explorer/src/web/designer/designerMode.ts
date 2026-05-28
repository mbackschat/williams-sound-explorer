/**
 * Sound Designer mode (v1) — author a VARI sound the way a Williams designer
 * would: pick a base game, copy one of its VARI commands, edit the parameter
 * record, audition it, diff it against the original, and save the project.
 *
 * It is a *separate mode*: `main.ts` hides the Explore layout and mounts this
 * surface into `#designer-root`.  Nothing here touches the Explore UI or the
 * live worklet — audition renders the edited ROM image offline (`audition.ts`).
 * The custom ROM is never persisted as bytes; only the recipe (parameter
 * edits) is saved (`designerStore.ts`), so no copyrighted bytes are stored.
 */
import "./designer.css";
import type { GameKind } from "../../board/soundboard.ts";
import type { AppContext } from "../appContext.ts";
import { loadRomBytes } from "../romStore.ts";
import {
  variCommandsFor, readVariRecord, applyRecipe, type VariRecipe,
} from "../../engine/variEdit.ts";
import {
  listProjects, getProject, saveProject, exportJson, importJson,
} from "./designerStore.ts";
import { buildVariEditor, type VariEditorApi } from "./variEditor.ts";
import {
  renderSound, playSamples, drawWaveform, drawDiff, drawPlayhead, durationMs,
  onPlaybackState, pauseResume, stopPlayback, setLoop, playbackState, playbackProgress,
  type PlayState, type RenderedSound,
} from "./audition.ts";

const BASE_GAMES: { game: GameKind; label: string }[] = [
  { game: "defender", label: "Defender" },
  { game: "stargate", label: "Stargate" },
  { game: "robotron", label: "Robotron" },
];

export interface DesignerHandle {
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function emptyRecipe(baseGame: GameKind): VariRecipe {
  const now = Date.now();
  return { name: "", baseGame, edits: {}, createdAt: now, updatedAt: now };
}

export function mountDesigner(root: HTMLElement, ctx: AppContext): DesignerHandle {
  root.replaceChildren();
  root.classList.add("designer");

  // ── State ────────────────────────────────────────────────────────────
  let baseGame: GameKind = "defender";
  let baseRom: Uint8Array | null = null;
  let recipe: VariRecipe = emptyRecipe(baseGame);
  let selectedCmd: number | null = null;
  let volume = 0.3;

  const status = (msg: string, kind: "" | "ok" | "err" = ""): void => {
    statusLine.textContent = msg;
    statusLine.dataset.kind = kind;
    ctx.log(`Designer: ${msg}`, kind);
  };

  // ── Header ───────────────────────────────────────────────────────────
  const baseButtons = new Map<GameKind, HTMLButtonElement>();
  const gamePicker = el("div", { className: "designer-game-switcher game-switcher", role: "radiogroup" });
  for (const { game, label } of BASE_GAMES) {
    const b = el("button", { className: "game-pick", textContent: label });
    b.addEventListener("click", () => { void loadBase(game); });
    baseButtons.set(game, b);
    gamePicker.append(b);
  }

  const nameInput = el("input", {
    type: "text", className: "designer-name", placeholder: "project name", value: "",
  });
  const projectSelect = el("select", { className: "designer-open", title: "Open a saved project" });
  const saveBtn = el("button", { textContent: "Save", title: "Save this project to the browser (IndexedDB)." });
  const newBtn = el("button", { textContent: "New", title: "Start a fresh project on the current base game." });
  const exportBtn = el("button", { textContent: "⬇ JSON", title: "Download this project as a JSON recipe (no ROM bytes)." });
  const importInput = el("input", { type: "file", accept: "application/json,.json", className: "designer-import" });
  const importBtn = el("button", { textContent: "⬆ JSON", title: "Load a project from a JSON recipe file." });
  importBtn.addEventListener("click", () => importInput.click());

  const header = el("div", { className: "designer-header" }, [
    el("h2", { textContent: "🎛 Sound Designer" }),
    el("span", { className: "designer-sub", textContent: "VARI — author a sound as a Williams designer would: edit the parameter record, hear it, save it." }),
    el("div", { className: "designer-bar" }, [
      el("span", { className: "designer-bar-label", textContent: "Base ROM:" }), gamePicker,
      el("span", { className: "sep" }),
      nameInput, saveBtn, newBtn,
      el("span", { className: "designer-bar-label", textContent: "Open:" }), projectSelect,
      exportBtn, importBtn, importInput,
    ]),
  ]);

  // ── Command picker ───────────────────────────────────────────────────
  const cmdButtons = new Map<number, HTMLButtonElement>();
  const cmdPicker = el("div", { className: "designer-cmds" });
  const cmdRow = el("div", { className: "designer-section" }, [
    el("span", { className: "designer-bar-label", textContent: "Sound:" }), cmdPicker,
  ]);

  // ── Editor + audition ──────────────────────────────────────────────────
  let editor: VariEditorApi = buildVariEditor(onEditorChange);

  // Audition transport state.
  let source: "edited" | "original" = "edited";
  let loop = false;
  let diffOn = false;
  let editedR: RenderedSound | null = null;
  let originalR: RenderedSound | null = null;
  let scopeRaf = 0;
  let autoReplayTimer = 0;

  const playBtn = el("button", { className: "designer-play", textContent: "▶ Play", title: "Play the selected source from the top." });
  const pauseBtn = el("button", { textContent: "⏸ Pause", title: "Pause / resume playback.", disabled: true });
  const loopBtn = el("button", { textContent: "🔁 Loop", title: "Repeat continuously — edits update the loop live." });
  const srcEditedBtn = el("button", { className: "active", textContent: "Edited", title: "Audition your edited version." });
  const srcOriginalBtn = el("button", { textContent: "Original", title: "Audition the unedited original (instant A/B)." });
  const sourceToggle = el("div", { className: "designer-source game-switcher", role: "radiogroup" }, [srcEditedBtn, srcOriginalBtn]);
  const diffBtn = el("button", { textContent: "⇄ Diff", title: "Overlay original (grey) + divergence (red) behind the live trace." });
  const resetBtn = el("button", { textContent: "↺ Reset", title: "Discard edits to this sound — back to the original record." });
  const volSlider = el("input", { type: "range", min: "0", max: "1", step: "0.01", value: String(volume), className: "designer-vol" });
  loopBtn.setAttribute("aria-pressed", "false");
  diffBtn.setAttribute("aria-pressed", "false");
  srcEditedBtn.setAttribute("aria-checked", "true");
  srcOriginalBtn.setAttribute("aria-checked", "false");

  volSlider.addEventListener("input", () => { volume = Number(volSlider.value); });
  playBtn.addEventListener("click", () => play());
  pauseBtn.addEventListener("click", () => pauseResume());
  loopBtn.addEventListener("click", () => {
    loop = !loop;
    loopBtn.classList.toggle("toggle-on", loop);
    loopBtn.setAttribute("aria-pressed", String(loop));
    setLoop(loop);
    status(`Loop ${loop ? "on" : "off"}.`);
  });
  srcEditedBtn.addEventListener("click", () => setSource("edited"));
  srcOriginalBtn.addEventListener("click", () => setSource("original"));
  diffBtn.addEventListener("click", () => {
    diffOn = !diffOn;
    diffBtn.classList.toggle("toggle-on", diffOn);
    diffBtn.setAttribute("aria-pressed", String(diffOn));
    if (playbackState() === "idle") redrawScope();
  });
  resetBtn.addEventListener("click", resetCmd);
  onPlaybackState((s: PlayState) => {
    pauseBtn.disabled = s === "idle";
    pauseBtn.textContent = s === "paused" ? "▶ Resume" : "⏸ Pause";
  });

  const editorHost = el("div", { className: "designer-editor-host" });
  editorHost.append(editor.el);

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
          diffBtn, resetBtn,
          el("span", { className: "sep" }),
          el("span", { className: "designer-bar-label", textContent: "Vol" }), volSlider,
        ]),
      ]),
      el("div", { className: "designer-edit-right" }, [
        el("div", { className: "designer-edit-label", textContent: "Audition" }),
        scope,
        statusLine,
      ]),
    ]),
  ]);

  const lockedMsg = el("div", { className: "designer-locked" });

  root.append(header, cmdRow, editPanel, lockedMsg);

  // ── Behaviour ──────────────────────────────────────────────────────────

  function originalRecord(cmd: number): number[] {
    return readVariRecord(baseRom!, baseGame, cmd);
  }

  function isEdited(cmd: number): boolean {
    const e = recipe.edits[cmd];
    if (!e) return false;
    const o = originalRecord(cmd);
    return e.some((b, i) => b !== o[i]);
  }

  function onEditorChange(rec: number[]): void {
    if (selectedCmd === null) return;
    const o = originalRecord(selectedCmd);
    if (rec.every((b, i) => b === o[i])) {
      delete recipe.edits[selectedCmd]; // no-op edit → keep the recipe clean
    } else {
      recipe.edits[selectedCmd] = rec;
    }
    recipe.updatedAt = Date.now();
    refreshCmdButtons();
    // Editing implies "hear my edit": switch to Edited and auto-replay (debounced).
    source = "edited";
    updateSourceUi();
    scheduleAutoReplay();
  }

  function refreshCmdButtons(): void {
    for (const [cmd, b] of cmdButtons) {
      b.classList.toggle("active", cmd === selectedCmd);
      b.classList.toggle("edited", isEdited(cmd));
    }
  }

  function selectCmd(cmd: number): void {
    stopPlayback();
    clearTimeout(autoReplayTimer);
    selectedCmd = cmd;
    editor.setRecord(recipe.edits[cmd] ?? originalRecord(cmd));
    refreshCmdButtons();
    if (renderBoth()) redrawScope();
  }

  function buildCmdPicker(): void {
    cmdButtons.clear();
    cmdPicker.replaceChildren();
    for (const { cmd, name } of variCommandsFor(baseGame)) {
      const b = el("button", {
        className: "designer-cmd",
        textContent: `$${cmd.toString(16).toUpperCase()} ${name}`,
        title: `Edit ${name} (command $${cmd.toString(16).toUpperCase()})`,
      });
      b.addEventListener("click", () => selectCmd(cmd));
      cmdButtons.set(cmd, b);
      cmdPicker.append(b);
    }
  }

  function setControlsEnabled(on: boolean): void {
    for (const b of [playBtn, loopBtn, srcEditedBtn, srcOriginalBtn, diffBtn, resetBtn, saveBtn, exportBtn]) b.disabled = !on;
    pauseBtn.disabled = !on || playbackState() === "idle";
    cmdRow.style.display = on ? "" : "none";
    editPanel.style.display = on ? "" : "none";
    lockedMsg.style.display = on ? "none" : "";
  }

  async function loadBase(game: GameKind): Promise<void> {
    for (const [g, b] of baseButtons) {
      const available = ctx.availableGames().has(g);
      b.disabled = false;
      b.classList.toggle("active", g === game);
      b.classList.toggle("locked", !available);
      b.title = available ? `Base your custom sound on ${g}` : `${g} ROM not loaded — add it in Explore mode first`;
    }
    baseGame = game;
    if (!ctx.availableGames().has(game)) {
      baseRom = null;
      lockedMsg.textContent = `No ${game} ROM loaded. Switch to Explore mode and add it, then come back.`;
      setControlsEnabled(false);
      return;
    }
    try {
      baseRom = await loadRomBytes(game);
    } catch (e) {
      baseRom = null;
      lockedMsg.textContent = `Could not load ${game} ROM: ${e instanceof Error ? e.message : String(e)}`;
      setControlsEnabled(false);
      return;
    }
    // Changing base game resets the working recipe (edits are base-specific).
    if (recipe.baseGame !== game) recipe = emptyRecipe(game);
    recipe.baseGame = game;
    setControlsEnabled(true);
    buildCmdPicker();
    const first = variCommandsFor(game)[0]!;
    selectCmd(first.cmd);
    status(`Editing ${game}. Pick a sound, drag the sliders, hit ▶ Play.`, "ok");
  }

  function updateSourceUi(): void {
    srcEditedBtn.classList.toggle("active", source === "edited");
    srcOriginalBtn.classList.toggle("active", source === "original");
    srcEditedBtn.setAttribute("aria-checked", String(source === "edited"));
    srcOriginalBtn.setAttribute("aria-checked", String(source === "original"));
  }

  /** Render both edited + original for the current command (cached for scope + audio). */
  function renderBoth(): boolean {
    if (selectedCmd === null || !baseRom) return false;
    try {
      originalR = renderSound(baseGame, baseRom, selectedCmd);
      editedR = renderSound(baseGame, applyRecipe(baseRom, recipe), selectedCmd);
      return true;
    } catch (e) {
      status(`Render failed: ${e instanceof Error ? e.message : String(e)}`, "err");
      return false;
    }
  }

  /** Draw one scope frame: the playing source (or the diff overlay) + optional playhead. */
  function drawScopeFrame(withPlayhead: boolean): void {
    if (diffOn && editedR && originalR) {
      drawDiff(scope, originalR.samples, editedR.samples);
    } else {
      const r = source === "edited" ? editedR : originalR;
      if (r) drawWaveform(scope, r.samples, source === "edited" ? "#a9dc76" : "#6b7280");
    }
    if (withPlayhead) { const p = playbackProgress(); if (p !== null) drawPlayhead(scope, p); }
  }

  function redrawScope(): void {
    cancelAnimationFrame(scopeRaf); scopeRaf = 0;
    drawScopeFrame(false);
  }

  /** Animate the scope (view + moving playhead) while a sound plays. */
  function animateScope(): void {
    cancelAnimationFrame(scopeRaf);
    const tick = (): void => {
      drawScopeFrame(true);
      scopeRaf = playbackState() === "idle" ? 0 : requestAnimationFrame(tick);
    };
    scopeRaf = requestAnimationFrame(tick);
  }

  /** Play the currently-selected source (Edited / Original) from the top. */
  function play(): void {
    if (!renderBoth()) return;
    const r = source === "edited" ? editedR! : originalR!;
    playSamples(r.samples, volume, loop);
    animateScope();
    const tag = source === "edited" ? `${r.reachedIdle ? "" : "(capped) "}Edited` : "Original";
    status(`${tag} — ${durationMs(r.cycles).toFixed(0)} ms${loop ? " · looping" : ""}.`, source === "edited" ? "ok" : "");
  }

  function setSource(s: "edited" | "original"): void {
    source = s;
    updateSourceUi();
    if (playbackState() === "idle") redrawScope();
    else play(); // instant A/B while playing
  }

  function scheduleAutoReplay(): void {
    clearTimeout(autoReplayTimer);
    autoReplayTimer = window.setTimeout(() => play(), 130);
  }

  function resetCmd(): void {
    if (selectedCmd === null) return;
    stopPlayback();
    clearTimeout(autoReplayTimer);
    delete recipe.edits[selectedCmd];
    editor.setRecord(originalRecord(selectedCmd));
    refreshCmdButtons();
    if (renderBoth()) redrawScope();
    status("Reset to original.");
  }

  async function refreshProjectList(): Promise<void> {
    const projects = await listProjects();
    projectSelect.replaceChildren(
      el("option", { value: "", textContent: projects.length ? "— open —" : "— none saved —" }),
      ...projects.map((p) => el("option", { value: p.name, textContent: `${p.name} (${p.baseGame})` })),
    );
  }

  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) { status("Give the project a name first.", "err"); return; }
    recipe.name = name;
    recipe.updatedAt = Date.now();
    void saveProject(recipe).then(() => {
      status(`Saved "${name}".`, "ok");
      void refreshProjectList();
    }).catch((e: unknown) => status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "err"));
  });

  newBtn.addEventListener("click", () => {
    recipe = emptyRecipe(baseGame);
    nameInput.value = "";
    if (selectedCmd !== null) selectCmd(selectedCmd);
    status("New project.");
  });

  projectSelect.addEventListener("change", () => {
    const name = projectSelect.value;
    if (!name) return;
    void getProject(name).then(async (p) => {
      if (!p) return;
      recipe = p;
      nameInput.value = p.name;
      await loadBase(p.baseGame); // resets recipe if base differs — so reattach
      recipe = p;
      buildCmdPicker();
      if (selectedCmd !== null && variCommandsFor(baseGame).some((c) => c.cmd === selectedCmd)) selectCmd(selectedCmd);
      else selectCmd(variCommandsFor(baseGame)[0]!.cmd);
      status(`Opened "${p.name}".`, "ok");
    });
  });

  exportBtn.addEventListener("click", () => {
    recipe.name = nameInput.value.trim() || "untitled";
    const blob = new Blob([exportJson(recipe)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `${recipe.name.replace(/[^A-Za-z0-9]+/g, "_")}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported "${recipe.name}.json".`, "ok");
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file.text().then(async (text) => {
      try {
        const p = importJson(text);
        recipe = p;
        nameInput.value = p.name;
        await loadBase(p.baseGame);
        recipe = p;
        buildCmdPicker();
        selectCmd(variCommandsFor(baseGame)[0]!.cmd);
        status(`Imported "${p.name}".`, "ok");
      } catch (e) {
        status(`Import failed: ${e instanceof Error ? e.message : String(e)}`, "err");
      } finally {
        importInput.value = "";
      }
    });
  });

  // ── Boot ────────────────────────────────────────────────────────────────
  const available = [...ctx.availableGames()];
  if (available.length === 0) {
    setControlsEnabled(false);
    lockedMsg.textContent = "No ROMs loaded yet. Switch to Explore mode and add a sound ROM, then come back to design.";
  } else {
    const start = ctx.availableGames().has(ctx.currentGame()) ? ctx.currentGame() : available[0]!;
    void loadBase(start);
  }
  void refreshProjectList();

  return {
    dispose(): void {
      root.replaceChildren();
      root.classList.remove("designer");
    },
  };
}
