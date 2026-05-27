/**
 * Self-contained layout controllers for the browser UI:
 *   - the no-explanation (hide-help) toggle (Pattern 12 / Step 6.5), and
 *   - the draggable two-column splitter.
 * Both depend only on `els` + localStorage; `log` reports the hide-help flip.
 */
import { els } from "../els.ts";

export function initLayout(log: (line: string) => void): void {
  initHideHelp(log);
  initColumnSplitter();
}

// Pattern 12 / Step 6.5 — No-explanation toggle.  Adds/removes a body class
// that CSS uses to hide help paragraphs, term-link styling, the cmdInfo
// blurb, the glossary, and the like.  Persisted to localStorage so the
// "show me the data only" preference survives page reloads.
function initHideHelp(log: (line: string) => void): void {
  const STORAGE_KEY = "williams-sound-explorer.hide-help";
  const apply = (hide: boolean): void => {
    document.body.classList.toggle("hide-help", hide);
    els.hideHelpToggle.setAttribute("aria-pressed", hide ? "true" : "false");
    els.hideHelpToggle.textContent = hide ? "Show help" : "Hide help";
  };
  apply(localStorage.getItem(STORAGE_KEY) === "1");
  els.hideHelpToggle.addEventListener("click", () => {
    const next = !document.body.classList.contains("hide-help");
    apply(next);
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    log(next
      ? "Hide help: on. Predict the algorithm from the bars + tape + spectrogram."
      : "Hide help: off. Explanatory text restored.");
  });
}

// Column splitter — drag the divider between the left and right columns to
// resize the page's two-column layout.  The split fraction is persisted in
// localStorage; double-click resets to 50/50.  At <1100 px the splitter
// hides (CSS) and this code is a no-op until the user resizes wider.
function initColumnSplitter(): void {
  const STORAGE_KEY = "williams-sound-explorer.col-split";
  const DEFAULT_FRACTION = 0.5;
  const MIN_FRACTION = 0.22;
  const MAX_FRACTION = 0.78;

  const applyFraction = (fraction: number): void => {
    const clamped = Math.max(MIN_FRACTION, Math.min(MAX_FRACTION, fraction));
    // Use fr-units so the CSS minmax(360px, …) clamps still apply at the
    // far ends of the drag range.  Left = clamped fr, right = (1 - clamped) fr.
    els.pageLayout.style.setProperty(
      "--left-width",
      `${(clamped * 100).toFixed(2)}fr`,
    );
    // Mirror the right side too so the grid template re-evaluates with the
    // new ratio — the third column's minmax(360px, 1fr) becomes
    // minmax(360px, (1 - clamped)fr).
    els.pageLayout.style.setProperty(
      "--right-width",
      `${((1 - clamped) * 100).toFixed(2)}fr`,
    );
  };

  // Restore saved fraction or fall back to 50/50.
  const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  applyFraction(Number.isFinite(saved) ? saved : DEFAULT_FRACTION);

  let dragging = false;
  let activePointerId: number | null = null;

  els.colSplitter.addEventListener("pointerdown", (e: PointerEvent) => {
    dragging = true;
    activePointerId = e.pointerId;
    els.colSplitter.classList.add("dragging");
    els.colSplitter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  els.colSplitter.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    const rect = els.pageLayout.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    applyFraction(fraction);
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    els.colSplitter.classList.remove("dragging");
    try { els.colSplitter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Persist the current fraction.  Re-parse from the CSS variable so a
    // mid-drag clamp at MIN/MAX is what gets saved (not the raw mouse pos).
    const raw = els.pageLayout.style.getPropertyValue("--left-width");
    const m = /([\d.]+)fr/.exec(raw);
    if (m) localStorage.setItem(STORAGE_KEY, (Number.parseFloat(m[1]!) / 100).toFixed(4));
  };
  els.colSplitter.addEventListener("pointerup", endDrag);
  els.colSplitter.addEventListener("pointercancel", endDrag);

  // Double-click anywhere on the splitter resets to 50/50.
  els.colSplitter.addEventListener("dblclick", () => {
    applyFraction(DEFAULT_FRACTION);
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_FRACTION));
  });

  // Keyboard accessibility — arrow keys when the splitter has focus.
  els.colSplitter.addEventListener("keydown", (e: KeyboardEvent) => {
    const raw = els.pageLayout.style.getPropertyValue("--left-width");
    const m = /([\d.]+)fr/.exec(raw);
    const current = m ? Number.parseFloat(m[1]!) / 100 : DEFAULT_FRACTION;
    const step = e.shiftKey ? 0.05 : 0.02;
    let next = current;
    if (e.key === "ArrowLeft")  next = current - step;
    else if (e.key === "ArrowRight") next = current + step;
    else if (e.key === "Home")  next = MIN_FRACTION;
    else if (e.key === "End")   next = MAX_FRACTION;
    else if (e.key === " " || e.key === "Enter") next = DEFAULT_FRACTION;
    else return;
    e.preventDefault();
    applyFraction(next);
    localStorage.setItem(STORAGE_KEY, next.toFixed(4));
  });
}
