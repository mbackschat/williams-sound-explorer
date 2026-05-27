/**
 * Listen-then-look quiz (Step 6.4 / Pattern 10).
 *
 * Plays a random sound from the catalogue, asks the user to identify
 * its engine.  Reveals the correct answer with a link into the
 * matching explainer card.  Score tracked per session.
 *
 * Reuses the existing fire path (so the sound is fired the same way as
 * any user click — host.fire / fireSequence — and the explainer-card
 * pane stays collapsed unless the user clicks Reveal).
 *
 * The pool comes from the glossary: every `(game, cmd)` whose engine
 * tag is one of the six canonical engines.  Hand-coded specials
 * (HYPER, KNOCK, RADIO, ZIREN, WHIST, PLANE, START) are skipped from
 * the question pool — recognising them would test memorisation rather
 * than synthesis-engine ear.
 *
 * The visual engine-view pane *will* show the engine slot as soon as
 * the sound fires, which is a strong hint.  That's intentional: the
 * quiz rewards focused listening AND looking ("listen-then-look").
 * Users who want pure-audio mode can collapse the right column or
 * toggle "Hide help" to dim the giveaway labels.
 */
import type { GameKind } from "../board/soundboard.ts";

/** Per-entry glossary shape (a subset of what's in the JSON). */
interface GlossaryEntry {
  name?: string;
  routine?: string;
  engine?: string;
  blurb?: string;
}
type GameGlossary = Record<string, GlossaryEntry>;
type Glossary = Partial<Record<GameKind, GameGlossary>>;

const CANONICAL_ENGINES = ["LFSR", "GWAVE", "VARI", "FNOISE", "SCREAM", "ORGAN"] as const;
type CanonicalEngine = (typeof CANONICAL_ENGINES)[number];

/** Engine → CSS colour, matches chip palette. */
const ENGINE_COLOR: Record<CanonicalEngine, string> = {
  LFSR: "#78dce8",
  GWAVE: "#a9dc76",
  VARI: "#ffd866",
  SCREAM: "#ff6188",
  ORGAN: "#ab9df2",
  FNOISE: "#fc9867",
};

interface PoolEntry {
  game: GameKind;
  cmd: number;
  engine: CanonicalEngine;
  routine: string;
  name: string;
}

export interface QuizPanelOptions {
  container: HTMLElement;
  /** Getter so the panel can re-read after the glossary loads asynchronously. */
  getGlossary: () => Glossary;
  /** Switch to a different game before firing the sound (async because game-init takes time). */
  switchGame: (game: GameKind) => Promise<void>;
  /** Current game (used to decide whether `switchGame` is needed). */
  currentGame: () => GameKind;
  /** Fire a command on the active game.  The quiz uses this directly — it does
   *  not call `fireUserCmd` because that triggers the explainer-card load,
   *  which would reveal the answer.  Reveal happens explicitly on user click. */
  fireRaw: (cmd: number) => void;
  /** Show the explainer card for the just-revealed sound. */
  loadExplainer: (cmd: number, game: GameKind) => void;
}

export class QuizPanel {
  private readonly container: HTMLElement;
  private readonly getGlossary: () => Glossary;
  private readonly switchGame: (g: GameKind) => Promise<void>;
  private readonly getCurrentGame: () => GameKind;
  private readonly fireRaw: (cmd: number) => void;
  private readonly loadExplainer: (cmd: number, game: GameKind) => void;
  private pool: PoolEntry[];
  private current: PoolEntry | undefined;
  private state: "idle" | "question" | "revealed" = "idle";
  private score = { correct: 0, total: 0 };

  constructor(opts: QuizPanelOptions) {
    this.container = opts.container;
    this.getGlossary = opts.getGlossary;
    this.switchGame = opts.switchGame;
    this.getCurrentGame = opts.currentGame;
    this.fireRaw = opts.fireRaw;
    this.loadExplainer = opts.loadExplainer;
    this.pool = this.buildPool();
    this.renderIdle();
  }

  private buildPool(): PoolEntry[] {
    const out: PoolEntry[] = [];
    const games: GameKind[] = ["defender", "stargate", "robotron"];
    const glossary = this.getGlossary();
    for (const game of games) {
      const entries = glossary[game];
      if (!entries) continue;
      for (const [cmdHex, e] of Object.entries(entries)) {
        const eng = (e.engine ?? "").toUpperCase();
        if (!(CANONICAL_ENGINES as readonly string[]).includes(eng)) continue;
        const cmd = parseInt(cmdHex, 16);
        if (!Number.isFinite(cmd) || cmd < 0 || cmd > 0x3F) continue;
        out.push({
          game,
          cmd,
          engine: eng as CanonicalEngine,
          routine: e.routine ?? "",
          name: e.name ?? "",
        });
      }
    }
    return out;
  }

  private pickRandom(): PoolEntry | undefined {
    if (this.pool.length === 0) return undefined;
    return this.pool[Math.floor(Math.random() * this.pool.length)];
  }

  private async nextQuestion(): Promise<void> {
    const pick = this.pickRandom();
    if (!pick) {
      this.container.innerHTML = `<p class="help-text">Quiz pool is empty — glossary not loaded yet?</p>`;
      return;
    }
    this.current = pick;
    this.state = "question";
    this.renderQuestion();
    // Fire the sound — switching games first if needed.  We deliberately use
    // `fireRaw` so the explainer-card panel isn't auto-populated (would
    // reveal the answer); the user clicks Reveal to load it.
    if (this.getCurrentGame() !== pick.game) {
      try { await this.switchGame(pick.game); } catch { /* ignore */ }
    }
    this.fireRaw(pick.cmd);
  }

  private replay(): void {
    if (!this.current) return;
    this.fireRaw(this.current.cmd);
  }

  private answer(engine: CanonicalEngine): void {
    if (this.state !== "question" || !this.current) return;
    this.score.total++;
    if (engine === this.current.engine) this.score.correct++;
    this.state = "revealed";
    this.renderReveal(engine);
  }

  private renderIdle(): void {
    const intro = this.pool.length
      ? `Pool of ${this.pool.length} sounds across the 6 canonical engines (LFSR / GWAVE / VARI / FNOISE / SCREAM / ORGAN).  Each question fires a random one and asks you to identify the engine that produced it.`
      : `Quiz pool will fill once the glossary loads.`;
    this.container.innerHTML = `
      <p class="help-text" style="font-size: 0.82rem; margin: 0 0 0.5rem;">${intro}</p>
      <button id="quizStart" class="quiz-start" title="Start the listen-then-look quiz — fires a random sound and asks you to name the engine that produced it.">Start quiz</button>
    `;
    this.container.querySelector<HTMLButtonElement>("#quizStart")?.addEventListener("click", () => {
      void this.nextQuestion();
    });
  }

  private renderQuestion(): void {
    if (!this.current) return;
    const scoreLine = this.score.total > 0
      ? ` · score <strong>${this.score.correct} / ${this.score.total}</strong>`
      : "";
    const buttons = CANONICAL_ENGINES.map((eng) => {
      const c = ENGINE_COLOR[eng];
      return `<button class="quiz-choice" data-engine="${eng}" style="border-color: ${c}; color: ${c};" title="Answer: the sound was produced by the ${eng} engine.">${eng}</button>`;
    }).join("");
    this.container.innerHTML = `
      <div style="font-size: 0.78rem; color: #abafb6; margin-bottom: 0.45rem;">
        Question ${this.score.total + 1}${scoreLine}
      </div>
      <p style="font-size: 0.85rem; color: #d1d4dc; margin: 0 0 0.5rem;">
        🔊 <strong>Listen carefully.</strong>  Which engine produced this sound?
      </p>
      <div class="quiz-choices" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; margin-bottom: 0.55rem;">
        ${buttons}
      </div>
      <div class="row" style="gap: 0.35rem; margin: 0;">
        <button id="quizReplay" class="quiz-secondary" title="Replay the current sound.">🔁 Replay</button>
        <button id="quizSkip" class="quiz-secondary" title="Skip this question without answering (doesn't count against your score).">Skip →</button>
      </div>
    `;
    this.container.querySelectorAll<HTMLButtonElement>(".quiz-choice").forEach((b) => {
      b.addEventListener("click", () => this.answer(b.dataset.engine as CanonicalEngine));
    });
    this.container.querySelector<HTMLButtonElement>("#quizReplay")?.addEventListener("click", () => this.replay());
    this.container.querySelector<HTMLButtonElement>("#quizSkip")?.addEventListener("click", () => { void this.nextQuestion(); });
  }

  private renderReveal(picked: CanonicalEngine): void {
    if (!this.current) return;
    const correct = picked === this.current.engine;
    const c = this.current;
    const colour = ENGINE_COLOR[c.engine];
    const verdict = correct
      ? `<span style="color: #a9dc76;">✓ Correct!</span>`
      : `<span style="color: #ff6188;">✗ Not quite — you picked <strong>${picked}</strong>.</span>`;
    const cmdHex = `$${c.cmd.toString(16).toUpperCase().padStart(2, "0")}`;
    this.container.innerHTML = `
      <div style="font-size: 0.82rem; margin-bottom: 0.5rem;">${verdict}</div>
      <p style="font-size: 0.85rem; color: #d1d4dc; margin: 0 0 0.4rem;">
        That was <strong style="color: ${colour};">${c.routine}</strong>
        (<span style="color: ${colour};">${c.engine}</span>) ·
        <code>${cmdHex}</code> on ${c.game}.
        <span style="color: #abafb6;">${c.name}</span>
      </p>
      <div class="row" style="gap: 0.35rem; margin: 0.5rem 0 0;">
        <button id="quizExplain" class="quiz-secondary" title="Open the annotated explainer card for this routine.">📖 Open explainer card</button>
        <button id="quizNext" class="quiz-start" title="Move on to the next random question.">Next question →</button>
        <span style="margin-left: auto; font-size: 0.8rem; color: #abafb6;">
          score <strong>${this.score.correct} / ${this.score.total}</strong>
        </span>
      </div>
    `;
    this.container.querySelector<HTMLButtonElement>("#quizExplain")?.addEventListener("click", () => {
      this.loadExplainer(c.cmd, c.game);
    });
    this.container.querySelector<HTMLButtonElement>("#quizNext")?.addEventListener("click", () => { void this.nextQuestion(); });
  }

  /** Re-render the idle screen — call after the glossary first loads so the pool count is correct. */
  refresh(): void {
    this.pool = this.buildPool();
    if (this.state === "idle") this.renderIdle();
  }
}
