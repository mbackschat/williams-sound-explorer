/**
 * Sound genealogy (Step 5.4 / Pattern 7).
 *
 * Loads the hand-curated `public/data/genealogy.json` and renders each
 * family as a row: family name + engine tag + one button per member.
 * Clicking two member buttons (with the ABDiff panel mounted) pre-fills
 * the diff selectors and auto-runs.  A "Compare all pairs" shortcut on
 * each family kicks off the canonical comparison (first vs second member).
 *
 * Deliberately list-shaped rather than node-and-edge.  The relationships
 * we're showing are *equivalences* across games — a flat by-engine table
 * is more legible than a graph for the size of the dataset (5 families,
 * 11 members).
 */
import type { GameKind } from "../board/soundboard.ts";
import type { ABDiff, ABDiffPick } from "./ABDiff.ts";

export interface GenealogyMember {
  game: GameKind;
  cmd: number;
  label: string;
}
export interface GenealogyFamily {
  name: string;
  engine: string;
  members: GenealogyMember[];
  notes?: string;
}
export interface Genealogy {
  families: GenealogyFamily[];
}

const ENGINE_COLOR: Record<string, string> = {
  LFSR: "#78dce8",
  GWAVE: "#a9dc76",
  VARI: "#ffd866",
  SCREAM: "#ff6188",
  ORGAN: "#ab9df2",
};

export async function loadGenealogy(url = `${import.meta.env.BASE_URL}data/genealogy.json`): Promise<Genealogy> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { families: [] };
    const raw = (await res.json()) as { families?: GenealogyFamily[] };
    return { families: raw.families ?? [] };
  } catch {
    return { families: [] };
  }
}

/**
 * Mount the genealogy UI inside `container`.  Each member button calls
 * `onPickChange(slot, member)` so the host can mirror the selection into
 * the A/B controls; clicking "Compare" on a family fires `diff.runAndRender`.
 */
export function renderGenealogy(
  container: HTMLElement,
  genealogy: Genealogy,
  diff: ABDiff,
  setPick: (slot: "a" | "b", pick: ABDiffPick) => void,
): void {
  container.replaceChildren();
  if (genealogy.families.length === 0) {
    const empty = document.createElement("p");
    empty.style.fontSize = "0.8rem";
    empty.style.color = "#abafb6";
    empty.textContent = "(genealogy.json not loaded — A/B diff still available manually)";
    container.appendChild(empty);
    return;
  }

  // Selection state per family — clicking a member chips fills slot A then B,
  // wrapping back to A.  Visualised by 'A' / 'B' badges on selected chips.
  for (const fam of genealogy.families) {
    const row = document.createElement("div");
    row.className = "genealogy-row";

    const head = document.createElement("div");
    head.className = "genealogy-head";
    const engineDot = document.createElement("span");
    engineDot.className = "engine-dot";
    engineDot.style.background = ENGINE_COLOR[fam.engine] ?? "#abafb6";
    head.appendChild(engineDot);
    const title = document.createElement("strong");
    title.textContent = fam.name;
    head.appendChild(title);
    const engineTag = document.createElement("span");
    engineTag.className = "engine-tag";
    engineTag.textContent = fam.engine;
    head.appendChild(engineTag);
    row.appendChild(head);

    const memberRow = document.createElement("div");
    memberRow.className = "genealogy-members";
    const memberButtons: HTMLButtonElement[] = [];
    let nextSlot: "a" | "b" = "a";

    for (const m of fam.members) {
      const btn = document.createElement("button");
      btn.className = "genealogy-member";
      btn.dataset.game = m.game;
      btn.dataset.cmd = m.cmd.toString(16).toUpperCase().padStart(2, "0");
      btn.title = `Load ${m.game} $${btn.dataset.cmd} ${m.label} into the next A/B diff slot (A, then B).`;
      btn.innerHTML =
        `<span class="badge"></span>` +
        `<span class="game">${m.game}</span> ` +
        `<span class="cmd">$${btn.dataset.cmd}</span> ` +
        `<span class="label">${m.label}</span>`;
      btn.addEventListener("click", () => {
        const slot = nextSlot;
        setPick(slot, { game: m.game, cmd: m.cmd, label: m.label });
        // Update all member buttons in this family to reflect slot badges.
        const slotLabel = slot === "a" ? "A" : "B";
        const badge = btn.querySelector(".badge");
        if (badge) badge.textContent = slotLabel;
        btn.classList.add(`slot-${slot}`);
        // Clear the OTHER slot's badge on this same button only.
        btn.classList.remove(slot === "a" ? "slot-b" : "slot-a");
        // Toggle next slot.
        nextSlot = slot === "a" ? "b" : "a";
      });
      memberButtons.push(btn);
      memberRow.appendChild(btn);
    }
    row.appendChild(memberRow);

    if (fam.notes) {
      const notes = document.createElement("p");
      notes.className = "genealogy-notes";
      notes.textContent = fam.notes;
      row.appendChild(notes);
    }

    if (fam.members.length >= 2) {
      const compareBtn = document.createElement("button");
      compareBtn.className = "genealogy-compare";
      compareBtn.textContent = `Compare ${fam.members[0]!.game} ↔ ${fam.members[1]!.game}`;
      compareBtn.title = `Load ${fam.members[0]!.game} and ${fam.members[1]!.game} into the A/B diff and run it.`;
      compareBtn.addEventListener("click", async () => {
        const a: ABDiffPick = { ...fam.members[0]! };
        const b: ABDiffPick = { ...fam.members[1]! };
        setPick("a", a);
        setPick("b", b);
        await diff.runAndRender(a, b);
      });
      row.appendChild(compareBtn);
    }

    container.appendChild(row);
  }
}
