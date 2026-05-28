/**
 * The command-info panel + "Try:" chip browser + term popover/list.
 *
 * `refreshCmdInfo` renders the `$XX` info card (including the $1B/$1C/$13/$00
 * arm-forms and their fire buttons); the chip browser doubles as a one-click
 * sound explorer; term-links reveal a glossary popover on click and show a
 * one-line hover title.  `initGlossaryUi` wires the delegated term-click
 * handler + the "Show:" legend, and returns the four hooks `main` calls from
 * the cmd-input handler and game-switch refresh.
 */
import { els } from "../els.ts";
import { lookup, lookupTerm, summarize } from "../glossary.ts";
import { escapeHtml } from "../format.ts";
import { allEnabled, chipEngineKey, isChipVisible } from "../../engine/chipFilter.ts";
import { ORGAN_TUNES, DEFAULT_ORGAN_TUNE, AUTO_PULSE_GAP_MS } from "../organTunes.ts";
import type { AppContext } from "../appContext.ts";

export interface GlossaryUiApi {
  /** Re-render the `$XX` command-info card from the cmd input + active game. */
  refreshCmdInfo(): void;
  /** Rebuild the "Try:" chip browser from the active game's glossary. */
  refreshChipTooltips(): void;
  /** Rebuild the term-list buttons. */
  renderTermList(): void;
  /** Add hover titles to `[data-term]` elements under `root` (default document). */
  annotateTermLinks(root?: ParentNode): void;
}

export function initGlossaryUi(ctx: AppContext): GlossaryUiApi {
  /** Enabled engine keys for the Try-list filter — all on by default. */
  const chipFilter = allEnabled();

  function refreshCmdInfo(): void {
    const raw = els.cmd.value.trim();
    const cmd = Number.parseInt(raw, 16);
    if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) {
      els.cmdInfo.textContent = "Enter a hex code in the range 00..3F.";
      els.cmdInfo.style.borderLeftColor = "#5a5e68";
      return;
    }
    const entry = lookup(ctx.getGlossary(), ctx.currentGame(), cmd);
    if (!entry) {
      els.cmdInfo.textContent = `$${cmd.toString(16).padStart(2, "0").toUpperCase()} — no glossary entry for ${ctx.currentGame()}.`;
      els.cmdInfo.style.borderLeftColor = "#5a5e68";
      return;
    }
    const code = cmd.toString(16).padStart(2, "0").toUpperCase();
    // The engine name renders as a clickable term link if we have an
    // explanation for it; otherwise plain text.
    const engineHtml = entry.engine
      ? (lookupTerm(ctx.getGlossary(), entry.engine)
          ? ` · <a class="term-link" data-term="${escapeHtml(entry.engine)}">${escapeHtml(entry.engine)}</a>`
          : ` · ${escapeHtml(entry.engine)}`)
      : "";
    // Special-case help for the four "zero DAC events when fired alone"
    // commands.  $1B / $1C are multi-step protocols (arming routines); $13
    // toggles state only; $00 is silence by design.
    let extra = "";
    const game = ctx.currentGame();
    if (cmd === 0x1B) {
      const tunes = ORGAN_TUNES[game];
      const optHtml = tunes
        .map((t) => `<option value="${t.num}">${t.num} — ${escapeHtml(t.name)} · ${escapeHtml(t.note)}</option>`)
        .join("");
      extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ffd866; border-radius: 3px;">
        <div style="font-size: 0.82rem; color: #ffd866;">⚠ Two-step command — \$1B alone arms the tune flag but doesn't play it.</div>
        <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0.5rem;">
          \$1B's body is literally <code>DEC ORGFLG; RTS</code>. The tune actually
          plays inside the <em>next</em> IRQ, which reads its command byte as
          the tune number. Clicking <kbd>Fire</kbd> on \$1B now auto-pulses
          \$0${DEFAULT_ORGAN_TUNE} (tune ${DEFAULT_ORGAN_TUNE}) ${AUTO_PULSE_GAP_MS} ms later — pick a different
          tune below to override.
        </div>
        <div class="row" style="gap: 0.4rem; align-items: center;">
          <label for="organtTune" style="font-size: 0.82rem;">Tune:</label>
          <select id="organtTune" style="font-size: 0.85rem;">${optHtml}</select>
          <button id="organtFire" class="primary" style="font-size: 0.85rem;">Arm + Play</button>
        </div>
      </div>`;
    } else if (cmd === 0x1C) {
      if (game === "defender") {
        extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ff6188; border-radius: 3px;">
          <div style="font-size: 0.82rem; color: #ff6188;">⚠ Four-step command — \$1C alone arms a 3-byte data sequence; the note plays after the third follow-up byte.</div>
          <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0.5rem;">
            \$1C sets <code>ORGFLG = 3</code> and RTSes; each of the next three IRQs
            decrements ORGFLG and shifts its command byte into the OSCIL/note
            state.  Defender is the only ROM with a working implementation —
            on Stargate / Robotron \$1C is gutted to a single <code>RTS</code>.
          </div>
          <div class="row" style="gap: 0.4rem; align-items: center; font-size: 0.85rem;">
            <label>osc:</label><input id="organnOsc" type="text" value="0F" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
            <label>dly:</label><input id="organnDly" type="text" value="00" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
            <label>note:</label><input id="organnNote" type="text" value="05" maxlength="2" style="width: 3rem; text-align: center; font-family: ui-monospace, monospace;" />
            <button id="organnFire" class="primary" style="font-size: 0.85rem;">Arm + Play</button>
          </div>
        </div>`;
      } else {
        extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #ff6188; border-radius: 3px;">
          <div style="font-size: 0.82rem; color: #ff6188;">⚠ Gutted on ${game} — \$1C is a single <code>RTS</code>, silent regardless of follow-up bytes.</div>
          <div class="help-text" style="font-size: 0.78rem; color: #abafb6; margin: 0.2rem 0 0;">
            Defender's \$1C drives a 3-byte note-arming protocol; ${game} dropped that
            mechanism.  Switch to Defender to fire ad-hoc organ notes.
          </div>
        </div>`;
      }
    } else if (cmd === 0x13) {
      extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #78dce8; border-radius: 3px; font-size: 0.78rem; color: #abafb6;">
        ℹ BGEND clears the BG1/BG2 flags. Only audible if you previously fired
        $0F (BG1) or $10 (BG2INC) — otherwise it's a no-op.
      </div>`;
    } else if (cmd === 0x00) {
      extra = `<div class="arm-form" style="margin-top: 0.55rem; padding: 0.5rem 0.7rem; background: #1a1e26; border-left: 3px solid #78dce8; border-radius: 3px; font-size: 0.78rem; color: #abafb6;">
        ℹ The handler reads the latch, sees $00, dispatches nothing. Useful for
        "kick the background poll" but otherwise silent.
      </div>`;
    }
    els.cmdInfo.innerHTML =
      `<strong>$${code}</strong>  ${escapeHtml(entry.routine)}` +
      `<span style="color: #abafb6;">${engineHtml} · ${escapeHtml(entry.name)}</span>` +
      (entry.blurb ? `<br><span style="color: #abafb6; font-size: 0.82rem;">${escapeHtml(entry.blurb)}</span>` : "") +
      extra;
    els.cmdInfo.style.borderLeftColor = cmd === 0x1B ? "#ffd866" : cmd === 0x1C ? "#ff6188" : "#ffd866";
    annotateTermLinks(els.cmdInfo); // hover tooltip on the (re-rendered) engine term-link

    // Wire the Arm+Play button for $1B (deferred until after innerHTML).
    if (cmd === 0x1B) {
      const select = document.getElementById("organtTune") as HTMLSelectElement | null;
      const btn = document.getElementById("organtFire") as HTMLButtonElement | null;
      if (btn && select) {
        btn.addEventListener("click", async () => {
          if (!ctx.getHost()) {
            ctx.log("Init the worklet first.", "err");
            return;
          }
          const tune = Number.parseInt(select.value, 10);
          const tuneName = ORGAN_TUNES[ctx.currentGame()].find((t) => t.num === tune)?.name ?? "?";
          ctx.log(`Firing $1B then $${tune.toString(16).padStart(2, "0").toUpperCase()} (ORGANT → tune ${tune} ${tuneName})`);
          await ctx.fireSequence([0x1B, tune]);
        });
      }
    }

    // Wire the Arm+Play button for $1C on Defender (the 4-byte ORGANN protocol).
    if (cmd === 0x1C && game === "defender") {
      const osc = document.getElementById("organnOsc") as HTMLInputElement | null;
      const dly = document.getElementById("organnDly") as HTMLInputElement | null;
      const note = document.getElementById("organnNote") as HTMLInputElement | null;
      const btn = document.getElementById("organnFire") as HTMLButtonElement | null;
      if (btn && osc && dly && note) {
        btn.addEventListener("click", async () => {
          if (!ctx.getHost()) {
            ctx.log("Init the worklet first.", "err");
            return;
          }
          const parseHex = (el: HTMLInputElement): number => {
            const n = Number.parseInt(el.value.trim(), 16);
            return Number.isFinite(n) ? n & 0xFF : 0;
          };
          const b1 = parseHex(osc), b2 = parseHex(dly), b3 = parseHex(note);
          const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
          ctx.log(`Firing $1C → ${hex(b1)} → ${hex(b2)} → ${hex(b3)} (ORGANN sequence)`);
          await ctx.fireSequence([0x1C, b1, b2, b3]);
        });
      }
    }
  }

  function renderTermList(): void {
    const keys = Object.keys(ctx.getGlossary().terms ?? {}).sort();
    els.termList.innerHTML = keys
      .map((k) => `<button class="term" data-term="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
      .join("");
  }

  function showTerm(key: string): void {
    const t = lookupTerm(ctx.getGlossary(), key);
    if (!t) {
      els.termPopover.style.display = "none";
      return;
    }
    els.termPopover.innerHTML =
      `<strong style="color: #78dce8;">${escapeHtml(t.title)}</strong>` +
      `<br><span style="color: #abafb6; font-size: 0.78rem;">WHAT</span> · ${escapeHtml(t.what)}` +
      `<br><span style="color: #abafb6; font-size: 0.78rem;">HOW</span> · ${escapeHtml(t.how)}` +
      `<br><span style="color: #abafb6; font-size: 0.78rem;">WHERE</span> · ${escapeHtml(t.where)}`;
    els.termPopover.style.display = "block";
  }

  /**
   * Give every glossary term-link / chip (`[data-term]`) a hover `title` with
   * the term's short "what" description.  Appends to any pre-existing title
   * rather than overwriting; idempotent via a `data-term-titled` flag.
   */
  function annotateTermLinks(root: ParentNode = document): void {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-term]"))) {
      if (el.dataset.termTitled === "1") continue;
      const t = lookupTerm(ctx.getGlossary(), el.dataset.term ?? "");
      if (!t || !t.what) continue;
      el.title = el.title ? `${el.title} — ${t.what}` : t.what;
      el.dataset.termTitled = "1";
    }
  }

  /**
   * Rebuild the "Try:" chip browser from the active game's glossary.  One chip
   * per command code; sorted by hex code.  Each chip shows `$XX  ROUTINE` plus
   * a small engine-coloured dot, and the tooltip carries the `summarize()` text.
   */
  function refreshChipTooltips(): void {
    const game = ctx.currentGame();
    const entries = ctx.getGlossary()[game];
    els.cmdChips.replaceChildren();
    if (!entries || Object.keys(entries).length === 0) {
      const placeholder = document.createElement("span");
      placeholder.className = "cmd-chips-empty";
      placeholder.textContent = "(glossary not yet loaded)";
      els.cmdChips.appendChild(placeholder);
      return;
    }
    // When a custom ROM is being auditioned (Design's "Open in Explore"), the
    // user's named slots replace the base game's chips for the slot codes
    // they cover, and new chips appear for codes outside the base game's
    // glossary.  Renders as the project's actual item list — what the worklet
    // is actually running — not the base game's stock commands.
    const customSlots = ctx.getCustomSlots?.() ?? null;
    const customByCode = new Map(customSlots?.map((s) => [s.code, s.name]) ?? []);
    type Row = { key: string; code: number; label: string; engine?: string; titleText: string; custom: boolean };
    const rows: Row[] = [];
    for (const k of Object.keys(entries)) {
      const code = Number.parseInt(k, 16);
      if (!Number.isFinite(code)) continue;
      const entry = entries[k]!;
      const customName = customByCode.get(code);
      rows.push({
        key: k,
        code,
        label: customName ?? (entry.routine || "—"),
        engine: customName ? "VARI" : entry.engine,
        titleText: customName
          ? `$${k.toUpperCase()} — “${customName}” (custom VARI slot; overlaid over the base game's ${entry.routine || "—"} entry)`
          : summarize(entry),
        custom: !!customName,
      });
    }
    // Add custom slots whose codes aren't in the base game's glossary at all
    // (typically anything ≥ $20 unlocked by the mask widen in `customRom.ts`).
    for (const s of customSlots ?? []) {
      if (rows.some((r) => r.code === s.code)) continue;
      const k = s.code.toString(16).padStart(2, "0");
      rows.push({
        key: k,
        code: s.code,
        label: s.name,
        engine: "VARI",
        titleText: `$${k.toUpperCase()} — “${s.name}” (custom VARI slot at a command code the base ROM doesn't define)`,
        custom: true,
      });
    }
    rows.sort((a, b) => a.code - b.code);
    for (const r of rows) {
      const btn = document.createElement("button");
      btn.className = "chip" + (r.custom ? " chip-custom" : "");
      btn.dataset.cmd = r.key.toUpperCase();
      if (r.engine) btn.dataset.engine = r.engine;
      btn.title = r.titleText;
      btn.innerHTML =
        `<span class="chip-engine"></span>` +
        `<span class="chip-cmd">$${r.key.toUpperCase()}</span>` +
        `<span class="chip-name">${escapeHtml(r.label)}</span>`;
      btn.addEventListener("click", () => {
        els.cmd.value = btn.dataset.cmd ?? "";
        refreshCmdInfo();
        // Fire immediately — the chip browser doubles as a one-click sound
        // explorer.  Skip if the worklet isn't ready yet (chips render the
        // moment the glossary loads, which is typically before init finishes).
        if (!ctx.getHost()) return;
        const cmd = Number.parseInt(btn.dataset.cmd ?? "", 16);
        if (Number.isNaN(cmd) || cmd < 0 || cmd > 0x3F) return;
        ctx.fireUserCmd(cmd);
      });
      els.cmdChips.appendChild(btn);
    }
    applyChipFilter();
  }

  /** Show/hide each chip per the current engine filter. */
  function applyChipFilter(): void {
    for (const node of Array.from(els.cmdChips.children)) {
      const el = node as HTMLElement;
      if (!el.classList.contains("chip")) continue; // skip the empty-placeholder
      const key = chipEngineKey(el.dataset.engine);
      el.style.display = isChipVisible(key, chipFilter) ? "" : "none";
    }
  }

  /** Wire the "Show:" legend swatches as engine toggles (once, at startup). */
  function initChipLegend(): void {
    for (const item of Array.from(els.chipLegend.querySelectorAll<HTMLButtonElement>(".legend-item"))) {
      item.addEventListener("click", () => {
        const key = chipEngineKey(item.dataset.engine);
        if (chipFilter.has(key)) chipFilter.delete(key);
        else chipFilter.add(key);
        item.setAttribute("aria-pressed", chipFilter.has(key) ? "true" : "false");
        applyChipFilter();
      });
    }
  }

  // Delegated click handler: any element with data-term reveals the term.
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const termEl = target?.closest<HTMLElement>("[data-term]");
    if (termEl) {
      const key = termEl.dataset.term;
      if (key) showTerm(key);
    }
  });

  initChipLegend();

  return { refreshCmdInfo, refreshChipTooltips, renderTermList, annotateTermLinks };
}
