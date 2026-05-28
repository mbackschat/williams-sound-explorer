# Williams Sound Explorer and Designer (WSED)

**Official name: Williams Sound Explorer and Designer (WSED)** — use this name + acronym in user-facing docs (README, MANUAL*). Browser-based tool for the Williams arcade sound effects of **Defender** (1980), **Stargate / Defender II** (1981), and **Robotron 2084** (1982). Goal: deeply *understand* the sound algorithms via visualization and slow-motion animations, *hear* them aloud (audio playback is a first-class requirement, not a side-effect), *and* **design your own** (Design mode). The git repo / GitHub Pages slug stays `williams-sound-explorer`.

## Where everything lives

- **User manual**: [`MANUAL.md`](MANUAL.md) — for humans using the explorer (12 tutorials, engine catalogue, links into the deep docs)
- **Live execution plan**: [`~/.claude/plans/goal-is-to-built-purrfect-river.md`](~/.claude/plans/goal-is-to-built-purrfect-river.md) — 6 phases, 18 numbered steps, decisions, risk register
- **Docs index**: [`docs/00_INDEX.md`](docs/00_INDEX.md) — fast-lookup tables, "where do I find X?", project state
- **Currently-built code reference**: [`docs/explorer_implementation.md`](docs/explorer_implementation.md) — read this first when resuming a session
- **Designer manual**: [`MANUAL_DESIGNER.md`](MANUAL_DESIGNER.md) — for humans using Design mode (the companion to `MANUAL.md`)
- **Sound Designer mode (internals)**: [`docs/designer_implementation.md`](docs/designer_implementation.md) (impl state); roadmap + decision log in [`plans/designer-mode.md`](plans/designer-mode.md) — the separate Design mode for editing all 5 data-driven engines (VARI + GWAVE + LFSR + FNOISE + RADIO)

## On-demand references (load when you need them)

| If you need… | Read |
|---|---|
| What's actually built in `explorer/` (module map, design decisions, APIs) | `docs/explorer_implementation.md` |
| Sound Designer mode (VARI + GWAVE + LFSR + FNOISE + RADIO editors, .bin roundtrip): module map, decisions, record references, recipe schema | `docs/designer_implementation.md` |
| Why authoring works without an assembler ("a sound is *data*, not code") | private submodule — `research/findings_designer_feasibility.md` |
| Real-time AudioWorklet pipeline + message protocol (Phase 2.1) | `docs/explorer_implementation.md` §Real-time pipeline |
| Disassembler + semantic Step→DAC/IRQ + glossary (Step 2.2 extras) | `docs/explorer_implementation.md` §Debugger primitives |
| Tape-loop scrubber + DAC history ring (Step 2.3 / Pattern 11) | `docs/explorer_implementation.md` §Tape-loop scrubber |
| Live grid Ear·Code / Eye·Swimlane (Step 3.1 / Pattern 1, reorganised) | `docs/explorer_implementation.md` §Live grid |
| Dual-trace oscilloscope + spectrogram (Step 3.2) | `docs/explorer_implementation.md` §Oscilloscope + Spectrogram |
| Stage swimlane + label-map (Step 3.4 / Pattern adjacent) | `docs/explorer_implementation.md` §Stage swimlane |
| Known caveats + deferred follow-ups (read before changing scrub / engine slots) | `docs/explorer_implementation.md` §Known caveats and deferred follow-ups |
| Tutorial screenshot + verification harness (`explorer/e2e/`, MANUAL/README images) | `docs/web-capture.md` |
| The 6-phase architectural plan + snapshot schema | `docs/explorer_architecture.md` |
| The 5 design principles + 12 UX patterns | `docs/pedagogical_design.md` |
| Williams hardware (6802, PIA, DAC, clock, filter) | `docs/sound_hardware_model.md` |
| The 8 DSP primitives every sound uses | `docs/synthesis_techniques.md` |
| Defender command codes + parameters | `docs/defender_sound_catalogue.md` |
| Stargate (= Defender II) command codes (mostly identical to Defender) | `docs/stargate_sound_catalogue.md` |
| Robotron command codes (63 total) | `docs/robotron_sound_catalogue.md` |
| Prior art (zapspace's Defender Sound Studio) | `docs/sound_studio_reference.md` |
| Williams main-CPU + video deep-dive (background reading) | `docs/defender_hardware_and_programming.md` |
| How to obtain reference audio (MAME / emulator) | `docs/reference_audio_plan.md` |
| Path B audio pipeline build plan | `docs/assemble_drive_pipeline.md` |
| Low-level reverse-engineering notes + build internals | private submodule — see `research/CLAUDE_research.md` (contributors with access) |

## Project layout

```
williams-sound-explorer/
├── CLAUDE.md            this file
├── MANUAL.md            user-facing 12-tutorial manual
├── docs/                curated reference (13 files; start at 00_INDEX.md)
├── research/            private submodule (access-restricted) — raw research notes
├── tools/               render scripts (render_sound.ts, render_all.ts); build tooling documented privately
├── explorer/            the TypeScript app — Phases 1-6 done; all 12 UX patterns shipped
└── out/                 rendered WAV files (gitignored)
```

## Current state

**Phases 1–6 done; all 12 UX patterns shipped.** The explorer emulates the 6802 sound CPU, plays every command, and visualises all six engines (LFSR / VARI / GWAVE / FNOISE / SCREAM / ORGAN) with slow-motion, scrub, and per-engine views. (Build + verification internals are kept in the private `research/CLAUDE_research.md`.)

There is also a separate **Sound Designer mode** (top-level Explore ↔ Design toggle): fork the game's sound bank — opens with every editable command pre-loaded, edit any **VARI**, **GWAVE**, **LFSR**, **FNOISE**, or **RADIO** sound's parameter record, audition/A/B, save as a JSON recipe (no ROM bytes) or download a runnable custom `.bin` for MAME / a real cabinet, upload it back to keep editing. All 5 of Williams's data-driven engines are now editable — **per-engine parity with the Defender Sound Studio**. Its implementation state lives in `docs/designer_implementation.md` (the designer analog of the implementation doc below); the Explore UI is unchanged by it.

**`docs/explorer_implementation.md` is the source of truth for implementation state** — module map, per-engine viz, phase + test status, known caveats. Read it first when resuming a session. The roadmap (6 phases, 18 steps, risk register) lives in the plan file linked above. This file is durable orientation only and does **not** track a per-feature changelog — that's git history + the implementation doc (see the CLAUDE.md convention below).

## Commands

```bash
# Build/verify internals are documented privately — see research/CLAUDE_research.md
python3 tools/build_explainer_cards.py                 # rebuild explainer card JSONs from docs/explainer_cards.md
python3 tools/build_zeropage.py                        # rebuild RAM-heatmap cell descriptors ({game}_zeropage.json)
tools/refresh_corpus.sh                                # re-render bulk audio corpus (out/corpus/) — see "Bulk corpus freshness" below
npx tsx tools/render_all.ts                            # what refresh_corpus.sh wraps (use that one)
cd explorer && npm test                                # Vitest
cd explorer && npm run typecheck                       # strict typecheck — full project + headless-core DOM-free gate (tsconfig.core.json)
cd explorer && npm run dev                             # Vite dev server → http://localhost:5173
cd explorer && npm run build                           # production bundle → explorer/dist
npx tsx tools/render_sound.ts defender 0x11 out/x.wav  # render any sound → WAV
cd explorer && npx tsx e2e/capture.ts                  # verify + (re)shoot every MANUAL/MANUAL_DESIGNER illustration (needs dev:roms + dev server; docs/web-capture.md)
cd explorer && npx tsx e2e/capture.ts designer         # filter to one manifest (explorer | designer | smokes); `designer:gwave` filters within
cd explorer && npx tsx e2e/capture.ts <id-substring>   # legacy: scan every manifest for matching ids
cd explorer && npx tsx e2e/readme.ts                   # (re)shoot the README hero + demo GIF
```

## Decisions already locked

- **UI**: Vite + plain TS + canvas (no reactive framework until Phase 4 if needed)
- **Deployment**: GitHub Pages via Vite static build
- **ROM distribution**: **user-supplied** — the app ships no ROM bytes (copyright).  On first run an onboarding screen takes uploads, validated + stored in IndexedDB (`web/romStore.ts` + `web/romValidate.ts`).  A gitignored `explorer/public/roms/` is a **dev-only** fallback (`npm run dev:roms` copies locally-built/-supplied ROMs there); `prepare:public` no longer copies them, so `npm run build` / `dist/` contain zero ROM bytes.
- **First sound targeted end-to-end**: LITE ($11) Lightning — verified
- **Snapshot rate**: every 64 CPU cycles
- **Validation**: ear + spectrogram for Phases 1–3; MAME DAC-diff before Phase 5

## Conventions

- **Git: NEVER commit (or push) unless the user explicitly says so in that message.** This is a hard rule. Do the work, then **propose** the commit (message + scope) and **stop** — leave the changes uncommitted for the user to commit. Words like "proceed", "go", "do it", "yes", "continue", or approving a plan do **NOT** authorize a commit; only an explicit "commit" (or "push") does. This applies to the `research/` submodule too — never commit it on your own. (Repeatedly-stated user preference — auto-committing is a real annoyance.)
- **Git: commit directly to `main` and stay on `main`. Never auto-create branches.** *When the user does ask you to commit*, stage + commit on the current branch (main) — this **overrides** the default "if on the default branch, branch first" behaviour.
- **Docs vs research**: curated docs in `docs/` (public), raw dense notes in the private `research/` submodule. Cross-link both ways; don't duplicate.
- **Persistence**: always write findings to disk, never leave deep research only in chat.
- **CLAUDE.md is durable orientation, not a changelog.** Keep it to: where-things-live, project layout, commands, locked decisions, conventions/gotchas, and a short current-status blurb. Implementation state + per-feature history live in `docs/explorer_implementation.md` and git history — never append a per-step `✅ …` log here. (It bloats every session's context and triplicates the implementation doc + plan, forcing the same edit in three places.) Touch CLAUDE.md only when *durable orientation* changes: a new top-level dir, a new command, a locked decision, or a convention.
- **Doc sweep is part of "done" — sweep BEFORE the change is considered shipped, not after.** Any change visible to a user (UI / behaviour / new feature / new control), reader (docs / glossary / catalogue facts), or future maintainer (module layout / test count / phase status / API shape) requires a repo-wide sweep of every place the affected fact appears. The fail-mode is updating one doc and missing the others — the same fact (a feature name, a count, a control binding, a piece of state, a pattern's status) is duplicated across many files, and stale claims are reputational damage that surfaces later.

  **How to sweep:**

  1. **Name what changed.** The new term itself, plus the names of similar adjacent things that already exist. Added a panel? Grep for the other panels. Bumped a count? Grep for the old count. Shipped a pattern? Grep for the old "remaining" / "⏳" / "of 12" status lines. Renamed something? Grep for the old name.
  2. **Grep the whole repo.** Exclude `research/` (frozen raw reference; see the rule below), `node_modules/`, `dist/`, `out/`, `.git/`, generated artefacts. Everything else is in scope — `CLAUDE.md`, `MANUAL.md`, every `.md` in `docs/`, code comments, test descriptions, file paths if a rename was involved.
  3. **Update every match consistently.** Anywhere a list of similar items exists, the new item belongs in it. Anywhere a count or summary depends on what changed, update it. Anywhere the old name appears, update or remove it.
  4. **When in doubt, sweep.** A wasted grep costs nothing; a stale claim surfacing later costs trust.

  **The required minimum surface to verify** for every meaningful change: `MANUAL.md` (user-facing — if the UI / behaviour changed, this needs an interface-tour / pitfalls / timeline entry, not just the agent-facing docs), `docs/00_INDEX.md` (project state + "up next"), `docs/explorer_implementation.md` (module map / test count / Phase status / source-layout tree — **the home for implementation state**), `docs/pedagogical_design.md` (pattern status if a pattern shipped), `docs/explorer_architecture.md` (phase completion), and the per-game sound catalogues if a ROM-level finding changed. For **Design-mode / capability** changes, also sweep `MANUAL_DESIGNER.md` (the designer manual) + `docs/designer_implementation.md` + `plans/designer-mode.md`, and keep `README.md` current — its **test badge**, the **Sound Designer** section, and especially the **"How it compares" section** (per-solution prose, using the **WSED** acronym; refresh it whenever WSED's features or approach shift relative to the other tools it names — e.g. the Defender Sound Studio; the fuller feature-by-feature comparison lives in `MANUAL_DESIGNER.md`). `CLAUDE.md` is **not** in this list — update it only when *durable orientation* changes (layout / commands / locked decisions / conventions), never as a per-feature changelog (see the CLAUDE.md convention above). **Only skip MANUAL.md** if the change is genuinely internal (private method, refactor that doesn't change behaviour, test added without a UI surface). Treat stale docs as a regression.
- **Clear, scannable docs — structure first, prose last.** When a doc explains how something works, the reader must be able to **find the answer by scanning headers, tables, and lists** — not by reading linearly. Lead with structure; reach for prose only when a table/list/diagram won't carry the idea.
  - **Default to the densest *clear* form**, in this order: a **table** (parameter / option / field rosters, per-item comparisons), a **short bullet list** (steps, variants, caveats), a **diagram** (ASCII flow / pseudocode for control flow + pipelines), then **prose** — used for the *one-line plain-English intro* before a block ("what this does" / "what you're hearing") and for genuine narrative, not for enumerating things a table would hold.
  - **One idea per short subsection.** If a numbered step or section grows past a screenful, split it into `###` subsections with their own heading — never let one step balloon into a wall covering many cases (e.g. one editor per subsection, not all editors in one step).
  - **Don't pad.** Every sentence earns its place; cut hedges, asides, and restatements. Keep **explicit antecedents** (never "the four" — name them). Surface key caveats as their own line (⚠ / **Note:**), not buried mid-paragraph. **Clarity comes from structure, not volume** — prefer the shortest form that stays unambiguous.
  - **User-facing docs (`README.md`, `MANUAL*.md`) are scannability-critical**: open with a **quick-start / at-a-glance** (the few steps or a summary table), illustrate each distinct surface with a **screenshot**, and let a newcomer succeed without reading every paragraph.
  - **Deep reference docs** (`docs/*` how-it-works) may go long when the *content* demands it — but still table-first and sectioned. The shape to mirror for a deep case-study doc is `docs/sound_studio_reference.md` (per-engine: parameter table + annotated pseudocode walkthrough). Long ≠ good; long-because-the-detail-is-real is fine, long-because-prose-rambles is not.
- **UI/UX is high-priority, not a finishing touch.** Every user-facing surface (Explore, Designer, onboarding, manuals) is a *designed* thing — not "controls that happen to be on a page". Aim for:
  - **Intuitive on first sight** — a user can start exploring without a manual; **visual cues** (segmented controls, colour-coded state, hover tooltips, sticky controls, in-place status feedback) guide progressive discovery. Avoid relying on the docs to explain what a button does — the UI should disclose its own meaning.
  - **Space-efficient** — no controls below the fold that should be in view (e.g. a transport row needs to be reachable without scroll); no two-row layouts where one fits; no half-screen panels for content that fits in a strip; grow with the data (canvases that scale cell width by byte count) so future growth doesn't force re-layout.
  - **Professional + clean** — restrained palette, consistent spacing/typography, **grouped + labeled** controls over shoulder-to-shoulder rows. Visible separators between logical groups. No emoji clutter; no busy ornament.
  - **Power-user efficient** — keyboard shortcuts, single-click handoffs (e.g. **Open in Explore**), dense-but-discoverable layouts. Honor the user who has learned the surface — don't force them through menus for routine actions.
  - **UX problems are first-class bugs.** A "this is cluttered" / "I had to scroll to find X" report ranks alongside a stack trace — not below it. The Designer's Phase 5 redesign (commits `001a988` + its `F:` follow-ups — 3-column GWAVE layout, sticky transport, grouped + labeled header bar) is the working reference; mirror that quality bar elsewhere.
- **`research/` is frozen raw reference, not part of the doc sweep.** It's a private submodule; its maintenance convention (what to update there, and when) lives in `research/CLAUDE_research.md`. Explorer features / UI choices / cross-ROM audits go in `docs/` (curated), never duplicating the private raw detail.
- **Headless/browser split is enforced — don't dissolve it.** `explorer/src/` is layered: `cpu/`, `board/`, `synth/`, `engine/` (realtime driver + per-engine state + toggles + history + scrub math + `runner.ts`) and `data/` (the shared `protocol.ts` contract: `StateSnapshot`, worklet messages, the six engine-state shapes) are **headless**; `web/` (host, worklet, main, onboarding, `rom*`, the JSON loaders) and `viz/` are the **browser** layer; `node/` holds the `node:fs` loaders (`rom.ts`, `runnerNode.ts` — CLI + tests, never bundled). The headless layers are gated by `explorer/tsconfig.core.json` (lib `ES2022` only, `types: []` — no DOM, no Node), run as the second half of `npm run typecheck`. So in a headless dir: **no** `document`/`window`/`fetch`/`indexedDB`/`crypto.subtle`/`import.meta.env`, and **no** import from `web/` or `node/` — either fails the gate. Shared types belong in `data/protocol.ts`, not in a browser module.
- **Defender II = Stargate** — same game, different release name.
- **Robotron's arcade ROM has no PCM speech** — it's all algorithmic synthesis.
- **Test thoroughly**: every non-trivial change covers happy path + edge cases + invariants + negative cases. The golden DAC fixture (`explorer/tests/golden/defender_11_lite.json`) is the regression gate.
- **Don't emit throwaway `smoke-*.ts` Playwright scripts — add an entry to the `explorer/e2e/` capture manifests instead.** Three manifests partition by purpose: `capturesExplorer.ts` (illustrations for `MANUAL.md`), `capturesDesigner.ts` (illustrations for `MANUAL_DESIGNER.md`), and `smokes.ts` (transient regression checks — no shipping screenshots; entries get deleted when their feature ships). Each entry verifies a click-path *and* produces an artefact, so it survives review. Chaining `cat > smoke-foo.ts && npx tsx … && rm` in a single Bash call leaves the harness wrapper shell hanging around between turns (the inner `rm` doesn't reap the outer shell) and produces no lasting artefact — every smoke run leaks a process. Run a single manifest with `npx tsx e2e/capture.ts <name>`; filter within one with `<name>:<id-substring>`.
- **Bulk corpus freshness**: the WAV corpus at `out/corpus/{game}/{XX_ROUTINE}.wav` is *not* a regression gate (the golden DAC fixtures are). It's a *convenience artefact* — a browsable library of every sound, refreshed on demand.  It can quietly drift out of sync with the emulator as the codebase evolves.  Re-run `tools/refresh_corpus.sh` after any of: (a) the ROM binaries change; (b) edits to `explorer/src/engine/*` (`runner.ts`, `realtimeRunner.ts`, …) / `node/runnerNode.ts` / `cpu/*` / `synth/*` / `board/*`; (c) edits to `tools/render_all.ts` itself; (d) new command codes added to the glossary.  The script accepts a single-game arg (e.g. `tools/refresh_corpus.sh defender`) for quick partial refresh.  The full sweep takes ~30 s.
