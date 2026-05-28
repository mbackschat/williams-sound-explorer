/**
 * Shared surface that `main.ts` exposes to its UI controllers (`web/ui/*`).
 *
 * `main.ts` still owns the mutable app state (`host`, `selectedGame`,
 * `glossary`, …) and the orchestration functions; this is the read/act facade
 * it hands each controller's `init(ctx)` so a controller can reach shared state
 * and trigger cross-cutting actions without importing `main.ts` (which would
 * be circular).  Getters are functions (not snapshotted values) because the
 * underlying state is reassigned on game-switch — call them each time.
 *
 * The interface grows as controllers are extracted; keep it to what's actually
 * consumed.
 */
import type { GameKind } from "../board/soundboard.ts";
import type { Glossary } from "./glossary.ts";
import type { WilliamsSoundHost } from "./host.ts";

export interface AppContext {
  /** Append a line to the on-page log (kind tints it ok/err). */
  log(line: string, kind?: "" | "ok" | "err"): void;
  /** The live worklet host, or undefined before Init / between game switches. */
  getHost(): WilliamsSoundHost | undefined;
  /** Scrub mode is active (vs live). */
  isScrubbing(): boolean;
  /** The CPU is paused. */
  isPaused(): boolean;
  /** The game selected in the segmented switcher. */
  currentGame(): GameKind;
  /** The loaded glossary (reassigned on game-switch — call each time). */
  getGlossary(): Glossary;
  /** Games whose ROM is available in the local store. */
  availableGames(): ReadonlySet<GameKind>;
  /** The user-driven fire entry point (handles the $1B auto-pulse, etc.). */
  fireUserCmd(cmd: number): void;
  /** Switch the active game (loads its worklet/ROM); shows onboarding if missing. */
  switchToGame(game: GameKind): Promise<void>;
  /** Fire a sequence of command bytes with a gap between each (genealogy compare). */
  fireSequence(commands: number[], gapMs?: number): Promise<void>;

  /**
   * Audition a custom ROM (built by Design mode) in Explore's pipeline.  Loads
   * `rom` into the worklet running on `baseGame`'s engine, fires `cmd` if
   * given, and exposes a "Custom" entry in the game switcher so the user can
   * return to this audition.  `rebuild` is called on every later switcher
   * click to re-build the image from the current project state, so edits made
   * in Design between clicks are picked up.
   */
  auditionCustomRom(spec: {
    baseGame: GameKind;
    rom: Uint8Array;
    cmd?: number;
    projectName: string;
    /** Per-slot `(code, name)` pairs — drives Explore's "Try:" chip row while custom is active. */
    slots: { code: number; name: string }[];
    rebuild: () => { rom: Uint8Array; cmd?: number; slots: { code: number; name: string }[] };
  }): Promise<void>;

  /** Programmatically flip the Explore | Design top toggle (used by Design's "Open in Explore"). */
  switchToExploreMode(): void;

  /**
   * Custom-ROM slots currently in the worklet (or `null` when a stock ROM is
   * loaded).  Used by the glossary UI to overlay the "Try:" chip row with
   * the user's named slots while a custom audition is active.
   */
  getCustomSlots(): { code: number; name: string }[] | null;
}
