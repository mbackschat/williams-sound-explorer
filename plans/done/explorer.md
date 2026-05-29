# Explore mode — roadmap & decisions

> Status + decisions for the **Explorer** (Explore mode). Dashboard: [`STATUS.md`](../STATUS.md). How it's built (reference): [`../docs/implementation/explorer_implementation.md`](../../docs/implementation/explorer_implementation.md); architecture: [`../docs/implementation/explorer_architecture.md`](../../docs/implementation/explorer_architecture.md). The full original execution plan (with risk register) is archived at [`done/explorer-original-plan.md`](explorer-original-plan.md).

## Status: ✅ complete

All 6 phases shipped; all 12 UX patterns delivered.

| Phase | What | State |
|---|---|---|
| 1 | Silent 6800 emulator + offline WAV exporter | ✅ |
| 2 | AudioWorklet playback · speed/pause/single-step · Step→DAC/IRQ · tape scrubber | ✅ |
| 3 | Visualization v0 — oscilloscope · spectrogram (AC-coupled) · DAC byte-tape · stage swimlane | ✅ |
| 4 | Per-engine introspection — 6 engine slots · freeze toggles · causal hover · golden fixtures | ✅ |
| 5 | Robotron + cross-game — A/B diff · genealogy · per-game zero-page specs + label maps | ✅ |
| 6 | Pedagogy + polish — all 12 patterns · RAM heatmap · scrub time-travel · explainer cards (63) · quiz · MANUAL.md | ✅ |

Per-phase → UX-pattern mapping: [`../docs/design/pedagogical_design.md`](../../docs/design/pedagogical_design.md) § Implementation priority.

## Locked decisions

- **UI:** Vite + plain TS + canvas — no reactive framework.
- **Deployment:** GitHub Pages via Vite static build.
- **ROM distribution:** user-supplied; the app ships zero ROM bytes (validated + stored in IndexedDB; gitignored dev fallback). Enables a clean MIT publish.
- **Snapshot rate:** every 64 CPU cycles.
- **Headless/browser split:** enforced by `explorer/tsconfig.core.json` (`cpu`/`board`/`synth`/`engine`/`data` stay DOM-free).
- **Slow-mode:** decouple — render audio at 1×, animate visualizations from cached snapshots (not slowed audio).

(Original open design questions — ROM source, label-map build, slow-mode strategy, AudioWorklet support — are all resolved above; see the archived plan for the original framing.)

## Next

Explore mode is feature-complete. Forward work for the whole project lives in [`STATUS.md`](../STATUS.md) § *Next / backlog* (optional polish + deferred items).
