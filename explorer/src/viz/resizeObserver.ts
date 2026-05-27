/**
 * Tiny shared resize hook for the canvas-based viz panels.
 *
 * Every panel sizes its canvas in the constructor via `sizeForDpr()` — but
 * at that point the document layout often hasn't computed the canvas's
 * final width, so the pixel buffer ends up too small.  When the column
 * splitter (Phase 5+ UI) or a window resize later changes the canvas's
 * client size, the buffer stays at the original (small) dimensions and the
 * browser stretches the pixel buffer up to fit, producing the "everything
 * looks 4× too big" effect.
 *
 * `attachResizeRedraw(canvas, onResize)` hooks a `ResizeObserver` to the
 * canvas and runs the callback whenever the client size changes by ≥1 px.
 * Callers are responsible for actually re-running `sizeForDpr()` + repainting
 * inside the callback.
 */

export function attachResizeRedraw(
  canvas: HTMLCanvasElement,
  onResize: () => void,
): ResizeObserver {
  let lastW = 0;
  let lastH = 0;
  const ro = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // ResizeObserver can fire with 0×0 during reflow; skip those — they'd
    // trigger a useless redraw + an immediate second one.
    if (w === 0 || h === 0) return;
    if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
    lastW = w;
    lastH = h;
    onResize();
  });
  ro.observe(canvas);
  return ro;
}
