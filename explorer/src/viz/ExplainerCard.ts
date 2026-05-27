/**
 * Annotated explainer card (Step 6.3 / Pattern 9).
 *
 * Each card is a routine-keyed JSON file at
 * `explorer/public/data/explainer/{ROUTINE}.json` describing one
 * Williams sound algorithm: TL;DR, how it works, what to watch in the
 * UI, key code paths, and cross-refs.  Loaded on demand when the user
 * fires a command — the glossary entry's `routine` field maps the
 * `(game, cmd)` pair to the right card.
 *
 * The panel writes raw HTML into the provided container; a tiny
 * markdown-ish renderer handles backtick `code`, **bold**, and
 * [text](url) links.  No external dependency.
 *
 * State machine: a card is either loaded (`render(card)`), missing
 * (`renderMissing(routine, cmd)`), or empty (`renderIdle()` — the
 * initial state before any fire).  Loading is lazy; the same routine
 * is fetched at most once per page session.
 */

/** Schema of one card.  All string fields support the markdown subset. */
export interface ExplainerCard {
  /** Short title shown as the section heading.  e.g. "LITE — Lightning sweep". */
  title: string;
  /** Primary engine tag — colours the left border (LFSR / GWAVE / VARI / …). */
  engine: string;
  /** Games this card applies to (informational, not used by the loader). */
  games?: string[];
  /** 1-2 sentence summary — the "if you only read one line" part. */
  tldr: string;
  /** Multi-paragraph algorithm explanation.  Paragraphs separated by `\n\n`. */
  how: string;
  /** Bullet list — RAM cells / engine-view canvases / spectrogram features to focus on. */
  watch: string[];
  /** Bullet list — code paths / routine entry points / source-line refs. */
  code: string[];
  /** Bullet list — cross-references to docs / other sounds / tutorials. */
  see: string[];
}

/**
 * Sanitise a glossary `routine` field into the card-file key.
 *
 * Must stay in sync with `sanitise_routine()` in
 * `tools/build_explainer_cards.py`.  Examples:
 *   `"LITE"`        → `"LITE"`
 *   `"SP1 / CABSHK"`→ `"SP1"`
 *   `"BON2 / BONV"` → `"BON2"`
 *   `"PERK$$"`      → `"PERK"`
 *   `"(silence)"`   → `""`  (no card)
 */
function sanitiseRoutine(raw: string): string {
  const first = raw.trim().split(/[ /]+/)[0] ?? "";
  return first.replace(/[^A-Za-z0-9_]+/g, "").toUpperCase();
}

/** Engine → CSS colour, matches chip palette in index.html. */
const ENGINE_COLOR: Record<string, string> = {
  LFSR: "#78dce8",
  GWAVE: "#a9dc76",
  VARI: "#ffd866",
  SCREAM: "#ff6188",
  ORGAN: "#ab9df2",
  FNOISE: "#fc9867",
};

/**
 * Tiny markdown subset → HTML.  Escapes everything first, then handles
 * (in order): backtick `code`, **bold**, [text](url).  No nested handling;
 * authors should keep cards simple.  Returns HTML safe to insert.
 */
function renderMd(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;")
     .replace(/</g, "&lt;")
     .replace(/>/g, "&gt;")
     .replace(/"/g, "&quot;");
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`,
  );
  return html;
}

/** Mount-point info passed to the panel on construction. */
export interface ExplainerCardOptions {
  /** The container `<div>` we render into. */
  container: HTMLElement;
  /** Optional URL prefix for card files (default `/data/explainer`). */
  cardBaseUrl?: string;
}

export class ExplainerCardPanel {
  private readonly container: HTMLElement;
  private readonly cardBaseUrl: string;
  /** Per-session card cache.  null = looked up + not found. */
  private readonly cache = new Map<string, ExplainerCard | null>();
  private currentRoutine: string | undefined;

  constructor(opts: ExplainerCardOptions) {
    this.container = opts.container;
    this.cardBaseUrl = (opts.cardBaseUrl ?? `${import.meta.env.BASE_URL}data/explainer`).replace(/\/+$/, "");
    this.renderIdle();
  }

  /**
   * Look up the card for `routine` and render it.  Idempotent: re-calling
   * with the same routine does nothing.  Fires async fetch on first call
   * per routine; renders a "loading" placeholder until the fetch completes.
   */
  async setRoutine(routine: string | undefined, cmd: number, game: string): Promise<void> {
    if (!routine) { this.renderMissing("(unknown)", cmd, game); this.currentRoutine = undefined; return; }
    // Card files are keyed by the sanitised routine name (must match
    // `tools/build_explainer_cards.py`'s `sanitise_routine`).  Examples:
    // "SP1 / CABSHK" → "SP1.json"; "PERK$$" → "PERK.json".
    const key = sanitiseRoutine(routine);
    if (!key) { this.renderMissing(routine, cmd, game); this.currentRoutine = undefined; return; }
    if (key === this.currentRoutine) return;
    this.currentRoutine = key;

    // Cache hit?
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (cached) this.render(cached);
      else this.renderMissing(routine, cmd, game);
      return;
    }

    // Render a loading state while we fetch.
    this.renderLoading(routine);
    try {
      const res = await fetch(`${this.cardBaseUrl}/${key}.json`);
      if (!res.ok) {
        this.cache.set(key, null);
        if (this.currentRoutine === key) this.renderMissing(routine, cmd, game);
        return;
      }
      const card = (await res.json()) as ExplainerCard;
      this.cache.set(key, card);
      if (this.currentRoutine === key) this.render(card);
    } catch {
      this.cache.set(key, null);
      if (this.currentRoutine === key) this.renderMissing(routine, cmd, game);
    }
  }

  /** Initial state — before any sound has been fired. */
  private renderIdle(): void {
    this.container.innerHTML = `
      <p class="help-text" style="font-size: 0.8rem; margin: 0; color: #abafb6;">
        Fire a sound to see its annotated explainer card here — TL;DR, how the
        algorithm works, which engine cells to watch, and pointers into the
        source &amp; docs.  Cards exist for a handful of canonical sounds so
        far (LITE, HBDV, SAW, CANNON, SCREAM, ORGANT).
      </p>
    `;
    this.container.style.borderLeftColor = "#353a44";
  }

  /** Transient state while a fetch is in flight. */
  private renderLoading(routine: string): void {
    this.container.innerHTML = `
      <div style="color: #5a5e68; font-size: 0.82rem;">Loading explainer for <code>${routine}</code>…</div>
    `;
    this.container.style.borderLeftColor = "#353a44";
  }

  /** Card not found for this routine — graceful fallback. */
  private renderMissing(routine: string, cmd: number, game: string): void {
    const cmdHex = `$${cmd.toString(16).toUpperCase().padStart(2, "0")}`;
    this.container.innerHTML = `
      <div style="font-size: 0.82rem; color: #abafb6;">
        <strong style="color: #d1d4dc;">${routine}</strong> · ${cmdHex} on ${game}
      </div>
      <p class="help-text" style="font-size: 0.8rem; margin: 0.3rem 0 0;">
        No explainer card yet for this routine.  See the catalogue
        (<code>docs/${game}_sound_catalogue.md</code>) for the raw entry, or
        the deep source notes in
        <code>research/findings_${game}_sound.md</code>.
      </p>
    `;
    this.container.style.borderLeftColor = "#353a44";
  }

  /** Full card render. */
  private render(card: ExplainerCard): void {
    const accent = ENGINE_COLOR[card.engine] ?? "#5a5e68";
    const sections: string[] = [];

    sections.push(`
      <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.3rem;">
        <strong style="color: ${accent}; font-size: 0.95rem;">${renderMd(card.title)}</strong>
        <span class="engine-tag" style="color: ${accent}; border-color: ${accent};">${card.engine}</span>
      </div>
      <p class="explainer-tldr" style="font-size: 0.85rem; margin: 0 0 0.6rem; color: #d1d4dc; line-height: 1.45;">
        ${renderMd(card.tldr)}
      </p>
    `);

    const paragraphs = card.how
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => `<p class="help-text" style="font-size: 0.82rem; line-height: 1.5; margin: 0.35rem 0;">${renderMd(p)}</p>`)
      .join("");
    sections.push(`<details class="explainer-sub" open><summary>How it works</summary>${paragraphs}</details>`);

    if (card.watch.length > 0) {
      const items = card.watch.map((i) => `<li>${renderMd(i)}</li>`).join("");
      sections.push(`<details class="explainer-sub"><summary>What to watch</summary><ul>${items}</ul></details>`);
    }
    if (card.code.length > 0) {
      const items = card.code.map((i) => `<li>${renderMd(i)}</li>`).join("");
      sections.push(`<details class="explainer-sub"><summary>Key code paths</summary><ul>${items}</ul></details>`);
    }
    if (card.see.length > 0) {
      const items = card.see.map((i) => `<li>${renderMd(i)}</li>`).join("");
      sections.push(`<details class="explainer-sub"><summary>See also</summary><ul>${items}</ul></details>`);
    }

    this.container.innerHTML = sections.join("");
    this.container.style.borderLeftColor = accent;
  }
}
