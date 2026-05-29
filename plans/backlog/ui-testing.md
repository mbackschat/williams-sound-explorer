# UI testing via the capture manifest — investigation, design & plan

**Status:** proposed (not started). Author hand-off plan — meant to be picked up and executed later.
**One-line goal:** promote the existing Playwright capture harness (`explorer/e2e/`) into a first-class **browser-layer UI test suite** that runs the documented click-paths and asserts the app actually wired up — filling the one layer neither Vitest nor the golden fixtures touch.
**ROM/CI note (deferred per request):** the suite needs the dev server serving ROMs, and the repo ships zero ROM bytes, so for now it is a **local-only gate**. CI-gating is possible later via a synthetic test ROM (see §7); it does **not** block any of Phases 1–4 below.

---

## 1. Investigation — where we are today

### 1.1 The current test stack and what each layer covers

| Layer | Where | Covers | Gated in CI? |
|---|---|---|---|
| Unit tests (Vitest, 385) | `explorer/tests/*.test.ts` | The **DOM-free core** — `cpu/`, `board/`, `synth/`, `engine/`, `data/`, plus pure `web/` helpers (`format`, `keymap`). Fast, deterministic. | Yes (`npm test`) |
| Headless-core gate | `explorer/tsconfig.core.json` | Type-level: the headless layers must compile with **no DOM/Node**, so a stray `document`/`fetch` or a `web/`→core import fails the build. | Yes (`npm run typecheck`) |
| Golden DAC fixtures | `explorer/tests/golden/*.json` | **Output correctness** — bit-for-bit DAC stream for LITE/SAW/HBDV/CANNON/SCREAM. The regression gate for synthesis. | Yes (via Vitest) |
| Capture manifest | `explorer/e2e/{lib,capture,tutorials}.ts` | **End-to-end browser behaviour** — click-paths resolve, the AudioWorklet runs, panels render, engine/scrub state surfaces. Today framed as "screenshots + smoke". | **No** (local only) |

### 1.2 The gap this idea fills

Everything green-gated today is **headless**. Nothing in CI exercises the actual browser app: the DOM wiring in `web/` + `web/ui/`, the canvas visualisers in `viz/`, the AudioWorklet message pipeline, the event handlers, the onboarding/ROM-store path, the keyboard layer. The capture manifest is the **only** thing that drives the real app in a real browser — so it is the natural (and already-built) home for that missing coverage. Bugs it can catch that unit tests cannot: a renamed/removed control, a broken worklet message, a viz panel that stopped painting, a chip that no longer fires, the AudioContext failing to resume, a regressed keyboard binding.

### 1.3 What the manifest already is

`explorer/e2e/capture.ts` already **runs assertions and exits non-zero on failure** — it is a UI smoke test today, just packaged as a screenshot tool. The pieces:

- **`tutorials.ts`** — 20 `Entry` records (12 tutorials + 5 engine showcases + 3 interface-tour shots). Each: `{ id, game, steps[], readyWhen?, assert?[], shot }`.
- **Step vocabulary** (`lib.ts: runStep`): `fireChip` · `speed` · `click` · `select` · `fill` · `hover` · `openSection` · `scrubTo` · `waitMs`.
- **Assert vocabulary** (`capture.ts: checkAssert`): `recorded` · `text` · `textContains` · `cmdInfoContains` · `hasClass` · `markerCountAtLeast` · `canvasNonBlank`.
- **Shot variants**: `{ clip }` (element) · `{ viewport }` · `{ fullPage }`.
- **Robustness already solved**: `launch()` sets `--autoplay-policy=no-user-gesture-required`; `selectGame()` waits out the startup race for a settled active game (= worklet ready); `resetState()` makes entries order-independent (exit scrub, clear freeze toggles / forced sliders, reset scroll); `reveal()` opens collapsed `<details>` and tolerates Playwright-only `:has-text()`.
- Design + selectors documented in [`docs/implementation/web-capture.md`](../../docs/implementation/web-capture.md).

### 1.4 Honest limitations (design must respect these)

- **Smoke, not correctness.** `canvasNonBlank` proves "something rendered," not "the right thing." The suite catches "broke entirely," not "broke subtly." Correctness stays with the golden fixtures.
- **Flakiness.** Timing-dependent (audio startup, canvas-fill, `waitMs`). The worklet-readiness race and the tut-01 timing fix are previews of the hardening needed.
- **Speed.** ~20 entries × (boot + fire + waits) ≈ 1–2 min. Fine for a pre-ship gate, too slow for a tight inner loop.
- **Dual-purpose coupling.** A good *screenshot* wants a rich live frame (non-deterministic); a good *test* wants robustness; a good *visual-diff baseline* wants a frozen frame. These pull apart — the design must let a test entry opt out of screenshotting.
- **ROM/CI** (deferred) — see header note + §7.

---

## 2. Goals & non-goals

**Goals**
- Make the manifest a maintained, runnable **UI smoke/integration suite** with a fast assert-only mode and a clear pass/fail contract.
- Let **assertion-only** test entries coexist with the doc-illustration entries (some tests need no screenshot; some scenarios are not tutorials).
- Raise catch-rate with a few more **declarative asserts** and **negative/edge** scenarios the tutorials don't cover.
- Keep it **complementary** to Vitest/golden — never duplicate logic-level coverage.

**Non-goals (for now)**
- CI gating (deferred — local only until the synthetic-ROM path is built).
- Pixel/perceptual **visual regression** (Tier 3 — explicitly cautioned against as a gate; see §7).
- Replacing golden fixtures for correctness.

---

## 3. Design

### 3.1 Two run modes, one manifest

Add a **verify mode** to the driver, selected by flag:

- `npx tsx e2e/capture.ts` — **capture**: run steps, assert, *and* write the screenshot (today's behaviour; feeds MANUAL/README).
- `npx tsx e2e/capture.ts --verify` — **verify**: run steps + assert only, **skip** the screenshot and the file I/O. Faster, no working-tree churn, pure pass/fail. This is the "UI test" entry point.

Reporting: per-entry ✓/✗ lines (have them) + a final summary line `N passed / M failed` and a non-zero exit on any failure (have the exit). In `--verify`, print a compact summary suited to a test gate.

### 3.2 Optional `shot`, and test-only entries

- Make `Entry.shot` **optional**. An entry with no `shot` is a pure test case (asserts only) — runs in both modes, never screenshots.
- Decide manifest organisation (open question, §8): either (a) keep one `tutorials` array and add a separate `uiTests: Entry[]` array in `tutorials.ts` (or a new `e2e/uiTests.ts`) that the driver also consumes, or (b) one combined array with a `kind: "doc" | "test"` tag. **Leaning (a)** — keeps the doc-illustration set clean and stable, and lets `--verify` run *both* while `capture` (screenshot) runs only the doc set. The id-substring filter already lets you target subsets.

### 3.3 Assert vocabulary extensions

Current asserts cover "present / has class / non-blank." For real UI regression add (all declarative, all in `checkAssert`):

- `exists: sel` / `notExists: sel` — element presence (e.g. a locked game shows a 🔒 child; onboarding overlay appears/doesn't).
- `count: [sel, n]` / `countAtLeast: [sel, n]` — generalise `markerCountAtLeast` (e.g. chip count per game, glossary term count).
- `attr: [sel, name, value]` — e.g. `aria-pressed`, `disabled`, `data-active` on `#engineStack`.
- `enabled: sel` / `disabled: sel` — transport greys out during scrub; chips disabled while scrubbing.
- `logContains: sub` — `#log` got the expected fire/switch/error line.
- `canvasChanged: sel` — capture a canvas hash before an action and assert it changed after (catches "panel frozen / not updating", stronger than `canvasNonBlank`). Optional, slightly more complex.

### 3.4 Determinism & flakiness strategy

- Prefer **DOM/text asserts** over pixel asserts (robust).
- For any entry that must be stable, use **`scrubTo` freeze** (fire → record → `#scrubStart` → park `#scrubPos`) so the frame is reproducible.
- Keep the **`recorded` gate** on every entry that fires a sound (the precise "audio actually ran" probe).
- Add a **retry** wrapper in `--verify` (e.g. up to 2 retries per entry) to absorb timing flakes without masking real failures; log retries so chronic flakiness is visible.
- Generous, *bounded* waits; never a bare `sleep` where a `waitForFunction`/`waitForSelector` will do.

### 3.5 Placement in the stack & scripts

- New script: `"test:ui": "tsx e2e/capture.ts --verify"` in `explorer/package.json` (note: needs a dev server + `dev:roms` already up — document the two-step, and have the future `tools/refresh_screenshots.sh` / a `test:ui` wrapper start/stop the server).
- **Do not** fold into `npm test` (that must stay fast, headless, CI-safe). `test:ui` is a separate, local, pre-ship gate — sibling to `refresh_corpus.sh`.
- Document in `docs/implementation/web-capture.md` (it already half-describes this) + a one-line pointer in `docs/README.md` and the CLAUDE.md commands block.

---

## 4. Coverage matrix (what to test, beyond the 20 doc entries)

The 20 existing entries already smoke-test: each engine's playback + its panel, the scrubber, A/B diff, genealogy, freeze toggle, param slider, step/pause, causal hover, the two-column layout. Gaps to add as **test-only** entries:

| Area | Proposed test entry | Key asserts |
|---|---|---|
| Game switch | switch defender→robotron→stargate | each `#gameSwitcher button.active:not(.loading)`; chip set changes; `recorded` after a fire on the new game |
| Per-game chip sets | each game loads its command set | `countAtLeast` on `#cmdChips button.chip`; a known chip exists per game |
| Silence / control cmds | fire `$00` (silence) | plays without error; no spurious engine-pane `.active`; log line |
| Transport gating | enter scrub → Fire/Step/chips disabled; Live → re-enabled | `disabled`/`enabled` on `#fire`/`#step`/chips |
| Pause/step semantics | fire, pause, step×N | `#pauseState` = paused; `#codePanel` PC advances between steps (text changes) |
| Step→DAC / Step→IRQ | `#stepDac` / `#stepIrq` | cycle count advances; no throw |
| Speed presets | each `data-speed` updates `#speedReadout` | `text` on `#speedReadout` |
| Hide help (Pattern 12) | toggle `#hideHelpToggle` | `body.hide-help` class toggles; glossary hidden; persists across reload |
| Keyboard layer | Space=fire, P=pause, 1–4=speed, G=game, `?`=overlay | state changes mirror the button paths; overlay appears on `?` |
| Engine toggles | each freeze toggle gates its cell (audible/RAM effect) | toggle `.active`; (optional) RAM heatmap cell stops updating |
| Voice mutes / Build-up | SCREAM/ORGAN voice checkboxes + Build-up/Tear-down | checkboxes toggle; sequence runs without throw |
| `$1B` auto-pulse | fire `$1B` → tune plays | `recorded`; organ pane `.active` after the 40 ms pulse |
| `$1C` 4-byte picker (Defender) | arm + play sequence | no throw; `recorded` |
| A/B identical-% | defender vs defender same cmd → ~100% | `#abSummary` contains expected %-ish |
| WAV export | `#exportWav` triggers a download | download event fires; (don't assert bytes) |
| Onboarding / locked game | *(needs single-ROM context — deferred with ROM work)* | `notExists` active game; onboarding overlay shows |
| Error surface | fire an out-of-range hex | graceful `#cmdInfo` message; no uncaught `pageerror` |
| Global invariant | every entry | **zero `pageerror`/`console.error`** during the run (promote the existing console listener into a hard assert) |

The last row is high-value and cheap: the driver already listens for `console.error`/`pageerror` — make any occurrence **fail the entry**.

---

## 5. Phased implementation plan

Each phase is independently shippable and leaves the suite green.

- **Phase 0 — Investigation/confirm (S).** Re-read `web-capture.md` + `lib.ts`/`capture.ts`. Confirm selectors for the new scenarios (game-switch states, `disabled` attrs during scrub, `#hideHelpToggle` → `body.hide-help`, keyboard handlers in `web/ui/keyboard.ts`, `#speedReadout`, `#exportWav`, log line format). Note anything that needs a `data-*`/id it doesn't have yet (prefer asserting on existing classes/attrs first).
- **Phase 1 — Verify mode + scaffolding (M).** Add `--verify` to `capture.ts` (assert-only, skip screenshot/file I/O); make `Entry.shot` optional; add the `uiTests` array (decision §8) and have the driver consume it (capture mode shoots only doc entries; verify mode runs all). Add `npm run test:ui`. Promote `console.error`/`pageerror` to a hard failure. Document in `web-capture.md` + INDEX + CLAUDE.md. **DoD:** `npm run test:ui` runs the 20 existing entries assert-only and passes.
- **Phase 2 — Assert vocabulary (M).** Implement `exists`/`notExists`, `count`/`countAtLeast`, `attr`, `enabled`/`disabled`, `logContains` (and optionally `canvasChanged`). Unit-test the pure bits where feasible. **DoD:** vocab available + typechecked.
- **Phase 3 — Coverage entries (L).** Add the §4 test-only entries (skip the ROM-gated onboarding/locked-game one). **DoD:** suite covers the matrix; all green; total runtime noted.
- **Phase 4 — Flakiness hardening (M).** Add per-entry retry in `--verify`; audit waits → prefer `waitForFunction`; apply `scrubTo` freeze to any flaky entry; run the suite ~10× to measure flake rate; fix outliers. **DoD:** ≥ ~9/10 clean runs locally.
- **Phase 5 — (Later/optional) CI unlock + visual diff.** Synthetic test ROM → CI gating (§7). Tier-3 visual diff only if desired, opt-in, manual-review (not a gate).

---

## 6. Risks & open questions

- **Flake erodes trust.** A UI suite that fails randomly gets ignored. Phase 4 is not optional if this becomes a gate.
- **Dual-purpose drift.** Keep doc-illustration entries and test entries cleanly separable so tuning one doesn't break the other.
- **Selector coupling.** Tests bind to IDs/classes; intentional UI refactors will break them (that's the point, but it's churn). Prefer semantic/stable selectors; add `data-testid` only where no stable hook exists.
- **Runtime creep.** As entries grow, the suite slows. Keep `--verify` lean (no screenshots) and allow id-filtered subset runs for local loops.

---

## 7. ROM / CI (deferred — noted only)

The suite needs the dev server serving `explorer/public/roms/` (gitignored; populated by `npm run dev:roms` from locally-supplied ROMs). CI has no ROMs and the repo ships none → **local-only for now.**

Future unlock (own work item, not blocking Phases 1–4): a small **synthetic, non-Williams test ROM** (your own MIT bytes) committed to the repo. Finding from investigation: `loadRomBytes` (`src/web/romStore.ts:114`) accepts any ROM whose validation tier `!== "reject"`, so a **structurally-valid** synthetic ROM (correct size + valid 6802 reset vectors, unknown SHA → "warn") would auto-load with **no allowlist edit**. Authoring a minimal 6802 program that touches each engine path is bounded work; it would let `test:ui` run in GitHub Actions. Caveat: it tests the UI against *synthetic* behaviour, not real Williams output — fine for UI regression; real-output correctness stays with golden fixtures + local runs.

---

## 8. Decisions to confirm before running

1. **Manifest organisation:** separate `uiTests` array (recommended) vs a `kind` tag on one combined array.
2. **Retries:** allow up to 2 per entry in `--verify` (recommended) or fail-fast on first miss.
3. **`console.error`/`pageerror` policy:** hard-fail any (recommended) vs warn-only.
4. **Scope of Phase 3:** do the full §4 matrix, or a high-value subset first (game switch, transport gating, pause/step, hide-help, keyboard, the global no-error invariant)?
5. **`test:ui` server lifecycle:** rely on a manually-started dev server, or build the wrapper that starts/stops it (ties into the still-pending `tools/refresh_screenshots.sh`).

---

## 9. Definition of done (for the Tier-1 effort, Phases 1–4)

- `npm run test:ui` exists, runs assert-only against the doc entries + the new test-only entries, and exits non-zero on any failure (including any `console.error`/`pageerror`).
- `Entry.shot` is optional; doc-illustration and test entries are cleanly separated; `capture` (screenshot) still produces exactly the MANUAL/README images.
- The §4 coverage matrix (minus the ROM-gated onboarding case) is implemented and green.
- Flake rate measured and acceptable locally.
- `docs/implementation/web-capture.md` (+ INDEX + CLAUDE.md commands) describe the suite, its local-only status, and the deferred CI path.
