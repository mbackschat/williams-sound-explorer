/**
 * Top-level Explore ↔ Design mode switch.
 *
 * Explore is the default read-only visualiser; Design is the sound-designer
 * surface (`web/designer/*`).  Switching just shows one surface and hides the
 * other — the Explore layout and its controllers are never modified.  The
 * designer module is imported lazily on first use so it stays out of the
 * initial bundle, and is kept mounted (hidden) afterwards to preserve work.
 */
import type { AppContext } from "../appContext.ts";
import type { DesignerHandle } from "../designer/designerMode.ts";

export function initModeToggle(ctx: AppContext): void {
  const exploreBtn = document.getElementById("modeExplore");
  const designBtn = document.getElementById("modeDesign");
  const pageLayout = document.getElementById("pageLayout");
  const designerRoot = document.getElementById("designer-root");
  if (!exploreBtn || !designBtn || !pageLayout || !designerRoot) return;

  let designer: DesignerHandle | undefined;
  let mode: "explore" | "design" = "explore";

  function setMode(next: "explore" | "design"): void {
    if (next === mode) return;
    mode = next;
    const design = next === "design";
    // `.page-layout` is `display: grid`, which overrides the `hidden`
    // attribute, so drive its display explicitly.
    pageLayout!.style.display = design ? "none" : "";
    designerRoot!.hidden = !design;
    for (const [btn, on] of [[exploreBtn!, !design], [designBtn!, design]] as const) {
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    }
    if (design && !designer) {
      void import("../designer/designerMode.ts").then(({ mountDesigner }) => {
        designer = mountDesigner(designerRoot!, ctx);
      });
    }
  }

  exploreBtn.addEventListener("click", () => setMode("explore"));
  designBtn.addEventListener("click", () => setMode("design"));
}
