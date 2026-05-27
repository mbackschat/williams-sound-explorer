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
  /** The game selected in the segmented switcher. */
  currentGame(): GameKind;
  /** The loaded glossary (reassigned on game-switch — call each time). */
  getGlossary(): Glossary;
  /** Games whose ROM is available in the local store. */
  availableGames(): ReadonlySet<GameKind>;
  /** Switch the active game (loads its worklet/ROM); shows onboarding if missing. */
  switchToGame(game: GameKind): Promise<void>;
  /** Fire a sequence of command bytes with a gap between each (genealogy compare). */
  fireSequence(commands: number[], gapMs?: number): Promise<void>;
}
