/**
 * Keyboard shortcuts.  A single window `keydown` handler resolves the key via
 * the pure `keyAction` mapper, then dispatches to the *existing* on-screen
 * controls (button `.click()` / range nudges) — so every shortcut reuses the
 * same code path as the mouse, and this module adds no logic of its own beyond
 * the mapping (which is unit-tested) and a `?` help overlay.
 */
import { els } from "../els.ts";
import type { AppContext } from "../appContext.ts";
import { keyAction, KEY_HELP, type KeyAction } from "./keymap.ts";

export function initKeyboard(ctx: AppContext): void {
  annotateShortcutTooltips();
  window.addEventListener("keydown", (e) => {
    // Design mode owns its own shortcut surface (see web/designer/designerMode.ts).
    // While Explore is hidden behind the mode toggle, none of its key bindings
    // should fire — otherwise Space would still trigger Fire, etc.
    if (isDesignActive()) return;
    const el = document.activeElement;
    const typing = !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    const action = keyAction(e.key, mod, { typing, scrubbing: ctx.isScrubbing(), paused: ctx.isPaused() });
    if (!action) return;
    e.preventDefault();
    dispatch(action, ctx);
  });
}

/**
 * Append each control's keyboard shortcut to its `title` so the binding is
 * discoverable on hover — the user shouldn't have to know (or open the `?`
 * overlay to learn) which key drives which button.  Keyed off the same `els`
 * controls `dispatch` targets, so the tooltip can't drift from the binding.
 * Idempotent (guards against double-append) and tolerant of absent elements.
 */
function appendKey(el: Element | null | undefined, key: string): void {
  if (!el) return;
  const cur = el.getAttribute("title") ?? "";
  const tag = `[${key}]`;
  if (cur.includes(tag)) return; // already annotated
  el.setAttribute("title", cur ? `${cur}  ${tag}` : tag);
}

function annotateShortcutTooltips(): void {
  appendKey(els.fire, "Space");
  appendKey(els.pause, "P");
  appendKey(els.step, "→ when paused");
  appendKey(els.stepDac, "D");
  appendKey(els.stepIrq, "I");
  appendKey(els.scrubStart, "S");
  appendKey(els.scrubLive, "S");
  appendKey(els.scrubLoop, "L");
  appendKey(els.scrubReset, "R");
  appendKey(els.hideHelpToggle, "H");
  appendKey(els.volume, "↑ / ↓");
  appendKey(els.cmd, "focus with /");
  appendKey(els.gameSwitcher, "cycle with G");
  // Speed presets 1–4 (1× / ¼× / ¹⁄₁₀× / ¹⁄₁₀₀×).
  const presets = document.querySelectorAll<HTMLButtonElement>(".preset[data-speed]");
  ["1", "2", "3", "4"].forEach((k, i) => appendKey(presets[i], k));
}

/** True when the top-level mode toggle is in Design (designer-root visible). */
function isDesignActive(): boolean {
  const dr = document.getElementById("designer-root");
  return !!dr && !dr.hidden;
}

function clickPreset(i: number): void {
  document.querySelectorAll<HTMLButtonElement>(".preset[data-speed]")[i]?.click();
}

/** Nudge a range input by `delta` (clamped) and fire its `input` listener. */
function nudgeRange(el: HTMLInputElement, delta: number): void {
  const min = Number(el.min), max = Number(el.max);
  el.value = String(Math.max(min, Math.min(max, Number(el.value) + delta)));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function cycleGame(): void {
  const btns = Array.from(els.gameSwitcher.querySelectorAll<HTMLButtonElement>(".game-pick"));
  if (btns.length === 0) return;
  const cur = btns.findIndex((b) => b.classList.contains("active"));
  btns[(Math.max(0, cur) + 1) % btns.length]?.click();
}

function dispatch(a: KeyAction, ctx: AppContext): void {
  switch (a) {
    case "fire": els.fire.click(); return;
    case "pauseToggle": els.pause.click(); return;
    case "stepInstr": els.step.click(); return;
    case "stepDac": els.stepDac.click(); return;
    case "stepIrq": els.stepIrq.click(); return;
    case "scrubBack": nudgeRange(els.scrubPos, -10); return;
    case "scrubFwd": nudgeRange(els.scrubPos, +10); return;
    case "speed0": clickPreset(0); return;
    case "speed1": clickPreset(1); return;
    case "speed2": clickPreset(2); return;
    case "speed3": clickPreset(3); return;
    case "volumeUp": nudgeRange(els.volume, +0.05); return;
    case "volumeDown": nudgeRange(els.volume, -0.05); return;
    case "scrubToggle": (ctx.isScrubbing() ? els.scrubLive : els.scrubStart).click(); return;
    case "loop": els.scrubLoop.click(); return;
    case "reset": els.scrubReset.click(); return;
    case "gameCycle": cycleGame(); return;
    case "focusCmd": els.cmd.focus(); els.cmd.select(); return;
    case "hideHelp": els.hideHelpToggle.click(); return;
    case "shortcuts": toggleShortcuts(); return;
  }
}

let overlay: HTMLDivElement | undefined;
function toggleShortcuts(): void {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "shortcutsOverlay";
    overlay.innerHTML =
      `<div class="shortcuts-card"><h2>Keyboard shortcuts</h2><dl>` +
      KEY_HELP.map((k) => `<dt>${k.keys}</dt><dd>${k.label}</dd>`).join("") +
      `</dl><p class="help-text">Press <kbd>?</kbd> or click anywhere to close.</p></div>`;
    overlay.style.display = "none";
    overlay.addEventListener("click", () => { overlay!.style.display = "none"; });
    document.body.appendChild(overlay);
  }
  overlay.style.display = overlay.style.display === "none" ? "flex" : "none";
}
