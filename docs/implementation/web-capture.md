# Web capture — automated tutorial verification + screenshots/GIF

This documents the tooling that drives the explorer in a real browser to **(a) verify each MANUAL.md tutorial's click-path still works** and **(b) capture the illustrative screenshots used in MANUAL.md / README.md plus the README demo GIF**. It is a *local maintainer tool*, not a CI job — see "ROM / copyright constraint" below for why.

Status (2026-05-27): complete and in use. The AudioWorklet runs under headless Chromium (the make-or-break risk) and canvases paint. `e2e/readme.ts` produces `docs/img/readme/hero.png` (full two-column viewport still) + `docs/img/readme/demo.gif` (slow-mo live-grid clip), wired into README.md. `e2e/capture.ts` runs a 20-entry manifest — all 12 MANUAL tutorials + 5 per-engine showcase panels + 3 interface-tour shots (§2 overview / column-navigation / full-page map) — verifying each click-path and emitting its image to `docs/img/manual/`, all wired into MANUAL.md (§2 interface tour, §3 engine gallery, §4 tutorials). Remaining: a `tools/refresh_screenshots.sh` wrapper (tracked at the end).

## Why this exists

MANUAL.md has 12 tutorials, each a precise sequence of clicks ("fire `$11 LITE`, click `¹⁄₁₀×`, watch the spectrogram"). Two things rot over time: the prose drifts from the actual UI (a control gets renamed/moved and the tutorial's clicks no longer resolve), and the manual is text-only where a picture would teach faster. One Playwright script driven by one declarative manifest fixes both at once — the *same* entry that verifies a tutorial's clicks also produces its screenshot, so they can't drift apart from each other.

What this verifies and what it doesn't: it confirms the **click-path resolves and the panels light up** (the real drift risk). It does **not** verify synthesis *correctness* — the `canvasNonBlank` probe only checks a canvas isn't a uniform fill. Audio correctness stays guarded by the golden DAC fixture (`explorer/tests/golden/defender_11_lite.json`) and the Vitest suite; this tool is complementary, not a replacement.

## ROM / copyright constraint (read first)

The locked decision is that the repo ships **zero Williams ROM bytes**. This tool honours that:

- It drives the **dev server**, which serves the dev-only ROM fallback in `explorer/public/roms/` (populated by `npm run dev:roms`, which copies your locally-built/-supplied `research/roms/*_sound.bin`). That directory is gitignored.
- It emits only PNG/GIF, which contain the explorer's **own visualisations** plus the original public routine labels (`LITE`, `HBDV`, …) — never ROM bytes.
- Therefore it is a **local tool run by a maintainer who already has the ROMs**, not a GitHub Action. Wiring it into CI would mean smuggling ROMs into the build, which we won't do.

The committed outputs (the PNGs/GIF under `docs/img/`) are fine to publish — they are derived visualisations, not the copyrighted program.

## Architecture: three manifests, one driver

```
explorer/e2e/lib.ts                shared Playwright primitives (launch, boot, selectGame, reveal, runStep, canvasRange)
explorer/e2e/manifest.ts           shared types (Entry/Step/Assert/Shot) + selector helpers
explorer/e2e/capturesExplorer.ts   MANUAL.md illustrations — 12 tutorials + 5 engine showcase + 3 UI tour
explorer/e2e/capturesDesigner.ts   MANUAL_DESIGNER.md illustrations — Designer flows (incl. GWAVE)
explorer/e2e/smokes.ts             transient regression-only flows — no shipping screenshots
explorer/e2e/capture.ts            driver — picks one manifest (or all shipping ones) and runs it
explorer/e2e/readme.ts             bespoke README assets: viewport hero PNG + demo GIF
docs/img/manual/*.png              committed per-entry screenshots
docs/img/readme/*.png|gif          committed README hero shot + demo GIF
```

The three manifests partition by **what each entry exists for** — illustrations for `MANUAL.md`, illustrations for `MANUAL_DESIGNER.md`, or transient regression checks during feature work — so a Designer-mode dev never has to re-run 20 unrelated Explorer screenshots, and smokes never accumulate as stale tutorials.

Run a single set or filter within one:

```bash
npx tsx e2e/capture.ts                       # default: explorer + designer (every shipping screenshot)
npx tsx e2e/capture.ts explorer              # only Explorer entries
npx tsx e2e/capture.ts designer              # only Designer entries
npx tsx e2e/capture.ts smokes                # only transient smokes
npx tsx e2e/capture.ts explorer:tut-04       # filter by id substring within a manifest
npx tsx e2e/capture.ts tut-04                # legacy: id-only filter scans every manifest
```

It lives under `explorer/` (not the repo-root `tools/`) because it is fundamentally an end-to-end test of the explorer app and `playwright` is an explorer devDependency — the same reasoning that puts the Vitest suite in `explorer/tests/`. Node module resolution then finds `playwright` in `explorer/node_modules` with no path gymnastics.

### Manifest entry shape

Each entry is plain data the driver interprets — no per-tutorial imperative code:

```ts
interface Entry {
  id: string;            // also the MANUAL anchor it illustrates
  game: "defender" | "stargate" | "robotron";
  steps: Step[];         // the exact clicks the tutorial tells a human to do
  readyWhen?: Assert;    // gate before asserting/capturing (usually { recorded: true })
  assert?: Assert[];     // post-conditions = "the tutorial still works"
  shot: Shot;            // { clip } an element · { viewport: true } the window · { fullPage: true } whole page → repo-relative path
}
```

The driver understands a fixed, small vocabulary. Adding a tutorial is a data edit, not new code, as long as it stays within this vocabulary:

**Steps**

| Step | Effect | Resolves to |
|---|---|---|
| `{ fireChip: "11" }` | fire a sound | `#cmdChips button.chip[data-cmd="11"]` (uppercase hex) |
| `{ speed: "0.1" }` | speed preset | `button[data-speed="0.1"]` (`1`/`0.25`/`0.1`/`0.01`) |
| `{ click: sel }` | click any selector | as given |
| `{ select: [sel, value] }` | set a `<select>` | e.g. `#abGameA` → `"stargate"` |
| `{ openSection: sel }` | open the `<details>` containing `sel` | climbs to the enclosing section |
| `{ scrubTo: 0.5 }` | freeze a deterministic frame | sets `#scrubPos` range + dispatches `input` |
| `{ waitMs: 2500 }` | settle delay | lets a canvas scroll-fill / animation advance |

**Asserts**

| Assert | Passes when |
|---|---|
| `{ recorded: true }` | `#scrubReadout` left the `"no recording yet"` state (= audio actually ran) |
| `{ text: [sel, exact] }` | element text equals `exact` |
| `{ textContains: [sel, sub] }` | element text contains `sub` |
| `{ cmdInfoContains: "LITE" }` | shorthand for `textContains` on `#cmdInfo` |
| `{ hasClass: [sel, cls] }` | element has class `cls` (e.g. `#scrubStart` `active`) |
| `{ markerCountAtLeast: 1 }` | `#scrubMarkers` has ≥ N children |
| `{ canvasNonBlank: sel }` | the canvas's red-channel range > 8 (not a uniform fill) |

### Stable selectors the app already exposes

No `data-testid`s were added — the app's existing IDs/data-attrs cover everything a tutorial touches (see `explorer/src/web/main.ts`):

- Game switch: `#gameSwitcher button[data-game="defender"|"stargate"|"robotron"]` (scope to `#gameSwitcher` — genealogy/onboarding also carry `data-game`).
- Sound chips: `#cmdChips button.chip[data-cmd="XX"]` (clicking fires immediately).
- Speed presets: `button[data-speed="1"|"0.25"|"0.1"|"0.01"]`.
- Transport: `#fire`, `#firePaused`, `#pause` (+ `#pauseState` reads `running`/`paused`), `#step`/`#stepDac`/`#stepIrq`.
- Scrubber: `#scrubStart`/`#scrubLive` (segmented toggle; gain `.active`), `#scrubPos` (slider), `#scrubMarkers`, `#scrubPlay`, `button.scrub-preset`, `#scrubReadout`.
- A/B diff: `#abGameA`/`#abCmdA`/`#abGameB`/`#abCmdB` (selects), `#abRun`, `#abSummary`, `#abCanvas`.
- Panels to clip: `#earCanvas`, `#eyeCanvas`, `#swimlaneCanvas`, `#spectroCanvas`, `#variCanvas`/`#screamCanvas`/`#organCanvas`/`#fnoiseCanvas`/`#wavetableCanvas`, `#ramHeatmapCanvas`, `#explainerCard`, `#cmdInfo`.

## The three problems the driver solves

These were found empirically while bringing the prototype up; they're the non-obvious bits.

**1. Headless audio — the make-or-break risk.** Every visualisation is driven by snapshots the AudioWorklet posts from its `process()` callback. If the `AudioContext` stays `suspended` (autoplay policy), no snapshots flow, every canvas stays blank, and both the screenshots and the verification are worthless. Two things make it run: launch Chromium with `--autoplay-policy=no-user-gesture-required`, and rely on the fact that Playwright clicks are *trusted* gestures (the app also force-resumes on the first pointerdown/keydown — see `resumeOnFirstGesture` in `main.ts`). The proof it worked: the `{ recorded: true }` gate passed and `#spectroCanvas` came back non-blank. Use `{ recorded: true }` as the readiness gate on any entry that fires a sound — it is the precise "audio really ran" probe. If headless ever misbehaves, run `--headed`.

**2. Readiness gating.** The app auto-initialises Defender on load; while a game initialises its switcher button is `disabled` + `.loading`, and the *active* game's button stays `disabled` as a no-op self-click. There's a startup race — a brief enabled-but-not-yet-active window before auto-init disables the buttons — so the driver does **not** blindly click. `selectGame()` first waits until *some* game has settled into `.active:not(.loading)` (= auto-init finished and the worklet is ready), then clicks the target only if it isn't already that game. Firing a chip before the worklet is ready is a silent no-op (no sound, idle panels), so this gate is mandatory before any `runStep` that fires — `readme.ts` calls `selectGame` for exactly this reason.

**3. Collapsed sections.** Several control groups are collapsed `<details>` by default (e.g. "Speed & volume", "A/B diff & genealogy"). A hidden control isn't clickable. Rather than require an `openSection` step everywhere, the driver auto-opens every collapsed `<details>` ancestor of a target selector (`reveal()`) before clicking it, before the `canvasNonBlank` check, and before the screenshot clip. `openSection` remains available for cases where you want a section open without immediately interacting inside it.

## Determinism

Live canvases animate, so naive screenshots are frame-dependent. Levers:

- **`deviceScaleFactor: 2`** + **`viewport: { width: 1920, height: 1200 }`** — crisp retina text, the layout width the two-column UI is designed for.
- **`scrubTo`** — for any panel that survives scrub mode, fire → record → enter scrub (`#scrubStart`) → park `#scrubPos` at a fixed fraction. That freezes a *repeatable* frame, so re-running the capture is pixel-stable instead of catching whatever frame the animation was on (this is exactly the Tutorial 4 mechanism repurposed for determinism).
- **`waitMs`** — for live scrolling panels (spectrogram), slow-motion widens the window where the panel is full of content; a settle wait lands the capture in it.

### Known tuning point: full-width scrolling panels

`#spectroCanvas` spans the full column width and scrolls newest-at-right. It only fills completely if the signal lasts at least as long as the canvas's column-time-span — which a single `$11 LITE` at ¹⁄₁₀× (~7 s) does not quite reach, leaving the left third dark ("before the fire"). For a fully-filled spectrogram either fire the sound a few times back-to-back, sustain a longer sound, or clip a sub-rectangle of the canvas rather than the whole element. Not a pipeline bug — just framing.

## Screenshot taxonomy

- **MANUAL.md** — element-clipped shots, one per tutorial, of the specific panel that tutorial is about (oscilloscope, byte tape, swimlane, VARI sliders, A/B diff…). Tight crops read far better inline than a full page. The §2 interface tour is the exception: it uses `viewport` shots (overview + the Ear↔GWAVE column-navigation pairing) and one `fullPage` shot (the whole-UI map), since those are *about* the layout, not one panel. → `docs/img/manual/` (via `capture.ts`). Wire them into MANUAL with `<img src=… width=…>` (≈640 for wide panels, 460 for the squarer engine panes, 700–820 for the interface shots), **not** bare `![](…)` — the clips are 2× DPI, so `![]` would render them at full column width. Re-captures only overwrite the PNGs; the widths in MANUAL stay put.
- **README.md** — a *viewport* hero shot (not `fullPage` — the page is enormously tall) of the two-column layout mid-sound, plus the GIF. → `docs/img/readme/` (via `readme.ts`).
- **The GIF** — one short slow-mo sequence recorded as a Playwright video, cropped to the live grid, converted with ffmpeg. → `docs/img/readme/demo.gif`.

Both README assets shoot **Defender `$1D SAW` at `¼×`**: the descending pitch makes a clean diagonal in the spectrogram (good still) and obvious motion everywhere (good GIF — the oscilloscope's square-wave period visibly widens as pitch falls, with the Code panel's `VARI:` registers, the byte tape, and the swimlane all updating in lockstep).

### Hero still — revealing the RAM heatmap

The `.left-col` is `position: sticky` while the `.right-col` scrolls with the window. So after the sound goes live, the hero does `window.scrollBy(0, 350)` before the screenshot: that lifts the right column to bring the **RAM heatmap** (which sits below the spectrogram) into frame, while the controls + live grid in the sticky left column stay put. The shot is captured at `deviceScaleFactor: 2` then lanczos-downscaled to 1920px-wide for crisp text at a reasonable file size (~0.6 MB).

### GIF pipeline (crop to live grid, ffmpeg two-pass palette)

`readme.ts` records the sequence via Playwright's `recordVideo` (a `.webm` flushed on context close), at DPR 1 so video-px == CSS-px == `boundingBox`-px and the crop maths line up. It crops to the `.live-grid` element's bounding box — Ear oscilloscope · Code · Eye byte tape · Swimlane, the clearest "watch the sound being made" framing — then:

```bash
# vf = crop=W:H:X:Y,fps=12,scale=<W/2>:-2:flags=lanczos   (W,H,X,Y from the .live-grid box)
ffmpeg -ss 3 -t 4 -i in.webm -vf "${vf},palettegen=stats_mode=diff" palette.png
ffmpeg -ss 3 -t 4 -i in.webm -i palette.png \
  -lavfi "${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" -loop 0 demo.gif
```

`-ss 3` skips the boot/clicks/scroll; two-pass palette keeps the dark-UI gradients from banding. The crop (~755×540) is downscaled to **50% width** (`scale=W/2:-2`, height follows) → ~378×270, 4 s, ~0.9 MB — light enough for a README and rendered at native width there. Trade fps/duration down for an even smaller file. `ffmpeg` is already on PATH.

## Canonical engine-showcase samples (Defender)

When a capture should *show off an engine* (per-engine panel shots, the engine-view tutorials, or an alternate GIF), fire these Defender commands — the picks that exercise each engine most clearly. Confirmed against `docs/defender_sound_catalogue.md`.

| Engine | Cmd | Routine | Note |
|---|---|---|---|
| LFSR | `$11` | LITE | lightning; the canonical end-to-end sound |
| GWAVE | `$0A` | SV3 | wavetable engine (a test/effect sound, but a clean GWAVE exemplar) |
| FNOISE | `$16` | THRUST | thrust drone — gentle frequency slope |
| SCREAM | `$1A` | SCREAM | death scream — 4-voice additive |
| VARI | `$1F` | QUASAR | quasar zap (reverse-polarity variable-duty square) |
| ORGAN | `$1B` | ORGANT | organ tune; the explorer auto-pulses tune 1 after the arm |

These are Defender-specific; SCREAM/ORGAN also exist on Stargate + Robotron (cross-game comparable). For VARI the descending **`$1D SAW`** is the better *motion* pick (used by the README GIF); `$1F QUASAR` is the better *engine-identity* still.

## How to run

Prereqs: ROMs supplied/built (`research/roms/*_sound.bin`), `playwright` installed (it is, as an explorer devDep; Chromium is in the shared `~/Library/Caches/ms-playwright` cache).

```bash
cd explorer
npm run dev:roms          # copy local ROMs into the gitignored public/roms/
npm run dev               # dev server on http://localhost:5173 (leave running)

# in another shell, from explorer/:
npx tsx e2e/capture.ts            # run every manifest entry (verify + per-tutorial PNG)
npx tsx e2e/capture.ts tut-02     # only entries whose id includes "tut-02"
npx tsx e2e/capture.ts --headed   # watch it drive a real window (debugging)
CAPTURE_URL=http://localhost:4173 npx tsx e2e/capture.ts   # point at a different server

npx tsx e2e/readme.ts             # the README hero + demo GIF
npx tsx e2e/readme.ts hero        # just the hero PNG
npx tsx e2e/readme.ts gif         # just the GIF
```

Exit code is non-zero if any assertion fails, so the same invocation doubles as a verification gate. The intended convenience wrapper (not yet written) is `tools/refresh_screenshots.sh`, mirroring `tools/refresh_corpus.sh`: copy ROMs → start the dev server → run `e2e/capture.ts` → tear the server down — one command, optionally with a single-tutorial arg.

## Extending it

Add an `Entry` to the manifest matching its purpose — `capturesExplorer.ts` for a MANUAL.md illustration, `capturesDesigner.ts` for a MANUAL_DESIGNER.md illustration, or `smokes.ts` for a transient regression-only check. Example shapes:

```ts
// scrub-freeze a deterministic VARI frame (Tutorial 4)
{ id: "tut-04-scrubber", game: "defender",
  steps: [ { fireChip: "1D" }, { waitMs: 2000 }, { click: "#scrubStart" }, { scrubTo: 0.5 } ],
  readyWhen: { recorded: true },
  assert: [ { markerCountAtLeast: 1 }, { hasClass: ["#scrubStart","active"] }, { canvasNonBlank: "#variCanvas" } ],
  shot: { clip: "#variCanvas", file: "docs/img/manual/tut-04-scrubber.png" } },

// cross-game A/B diff (Tutorial 8)
{ id: "tut-08-ab-diff", game: "defender",
  steps: [ { openSection: "#abRun" },
           { select: ["#abGameA","defender"] }, { select: ["#abCmdA","01"] },
           { select: ["#abGameB","stargate"] }, { select: ["#abCmdB","01"] },
           { click: "#abRun" } ],
  readyWhen: { textContains: ["#abSummary","%"] },
  assert: [ { textContains: ["#abSummary","%"] }, { canvasNonBlank: "#abCanvas" } ],
  shot: { clip: "#abCanvas", file: "docs/img/manual/tut-08-ab-diff.png" } },
```

If an entry needs an action the vocabulary can't express, add a new `Step`/`Assert` variant in `manifest.ts` (the shared types) and a handler branch in `capture.ts` — keep handlers generic (selector-driven), never tutorial- or feature-specific.

## Remaining work

- ✅ README hero + demo GIF (`e2e/readme.ts`), wired into README.md.
- ✅ Manifest expanded to all 12 tutorials + 5 engine-showcase panels + 3 interface-tour shots (`e2e/capture.ts`), wired into MANUAL.md (§2 + §3 + §4).
- Write `tools/refresh_screenshots.sh` (server lifecycle + capture, mirroring `refresh_corpus.sh`) — the one convenience piece still missing; for now run `npm run dev:roms && npm run dev`, then `e2e/capture.ts` + `e2e/readme.ts` by hand.
