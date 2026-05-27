/**
 * Onboarding screen — lets the user supply the Williams sound ROMs the app no
 * longer ships.  Three labeled slots (the slot fixes the game; Defender vs
 * Stargate are both 2 KB and otherwise indistinguishable).  Each dropped/chosen
 * file is validated (romValidate), stored locally (romStore), and its tier +
 * SHA-1 shown — so an unrecognized-but-working dump (⚠) reveals its hash for
 * adding to the allowlist.  Nothing is uploaded anywhere.
 *
 * Emits a `rom-store-changed` window event after any store mutation; main.ts
 * listens to refresh game availability.
 */
import type { GameKind } from "../board/soundboard.ts";
import { validateRom } from "./romValidate.ts";
import { deleteRom, getStored, listRoms, putRom } from "./romStore.ts";

const SLOTS: { game: GameKind; label: string }[] = [
  { game: "defender", label: "Defender (1980) — 2 KB sound ROM" },
  { game: "stargate", label: "Stargate / Defender II (1981) — 2 KB sound ROM" },
  { game: "robotron", label: "Robotron 2084 (1982) — 4 KB sound ROM" },
];

interface SlotEls {
  root: HTMLElement;
  status: HTMLElement;
  sha: HTMLElement;
  fileInput: HTMLInputElement;
  actions: HTMLElement;
}

const slotEls = new Map<GameKind, SlotEls>();
let onEnterCb: () => void = () => {};
let built = false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function notify(): void {
  window.dispatchEvent(new CustomEvent("rom-store-changed"));
}

async function handleFile(game: GameKind, file: File): Promise<void> {
  const els = slotEls.get(game)!;
  els.status.className = "rom-slot-status";
  els.status.textContent = `Checking ${file.name}…`;
  els.sha.textContent = "";
  let v;
  try {
    v = await validateRom(game, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    els.status.className = "rom-slot-status tier-reject";
    els.status.textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  if (v.tier === "reject") {
    els.status.className = "rom-slot-status tier-reject";
    els.status.textContent = `✗ ${v.message}`;
    return;
  }
  await putRom({ game, bytes: v.bytes.slice().buffer, sha: v.sha, tier: v.tier, storedAt: Date.now() });
  await refreshSlots();
  notify();
}

function buildSlots(): void {
  const host = document.getElementById("onboardingSlots");
  if (!host) return;
  host.replaceChildren();
  slotEls.clear();

  for (const { game, label } of SLOTS) {
    const root = el("div", "rom-slot");
    root.dataset.game = game;

    // Game name on its own line; status + button on the line below so long
    // names (e.g. "Stargate / Defender II") don't crowd them.
    const name = el("div", "rom-slot-name", label);

    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) void handleFile(game, f);
      fileInput.value = ""; // allow re-selecting the same file
    });

    const controls = el("div", "rom-slot-controls");
    const status = el("span", "rom-slot-status", "No ROM yet — drop a file or choose one.");
    const actions = el("div", "rom-slot-actions");
    const choose = el("button", undefined, "Choose file…");
    choose.addEventListener("click", () => fileInput.click());
    actions.appendChild(choose);
    controls.append(status, actions);

    const sha = el("div", "rom-slot-sha");
    root.append(name, controls, fileInput, sha);

    // Drag-and-drop onto the whole slot.
    root.addEventListener("dragover", (e) => {
      e.preventDefault();
      root.classList.add("dragover");
    });
    root.addEventListener("dragleave", () => root.classList.remove("dragover"));
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      root.classList.remove("dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) void handleFile(game, f);
    });

    slotEls.set(game, { root, status, sha, fileInput, actions });
    host.appendChild(root);
  }
}

async function refreshSlots(): Promise<void> {
  for (const { game } of SLOTS) {
    const els = slotEls.get(game);
    if (!els) continue;
    const rec = await getStored(game);
    els.root.classList.toggle("filled", !!rec);
    // Reset the action buttons (keep the file input).
    els.actions.replaceChildren();
    const choose = el("button", undefined, rec ? "Replace…" : "Choose file…");
    choose.addEventListener("click", () => els.fileInput.click());
    els.actions.appendChild(choose);

    if (rec) {
      const ok = rec.tier === "ok";
      els.status.className = `rom-slot-status ${ok ? "tier-ok" : "tier-warn"}`;
      els.status.textContent = ok
        ? "✓ recognized sound ROM."
        : "⚠ accepted (unrecognized dump — analysis may not line up).";
      els.sha.textContent = `SHA-1 ${rec.sha}`;
      const remove = el("button", undefined, "Remove");
      remove.addEventListener("click", () => {
        void deleteRom(game).then(() => refreshSlots()).then(notify);
      });
      els.actions.appendChild(remove);
    } else {
      els.status.className = "rom-slot-status";
      els.status.textContent = "No ROM yet — drop a file or choose one.";
      els.sha.textContent = "";
    }
  }

  const enter = document.getElementById("onboardingEnter") as HTMLButtonElement | null;
  const hint = document.getElementById("onboardingHint");
  const count = (await listRoms()).length;
  if (enter) enter.disabled = count === 0;
  if (hint) {
    hint.textContent = count === 0
      ? "Add at least one ROM to continue."
      : `${count} of 3 loaded — the rest stay locked until you add them.`;
  }
}

/** Wire the overlay once (call at startup). */
export function mountOnboarding(opts: { onEnter: () => void }): void {
  if (built) return;
  built = true;
  onEnterCb = opts.onEnter;
  buildSlots();
  const enter = document.getElementById("onboardingEnter");
  enter?.addEventListener("click", () => onEnterCb());
}

export function showOnboarding(focusGame?: GameKind): void {
  const overlay = document.getElementById("onboarding");
  if (!overlay) return;
  overlay.style.display = "block";
  void refreshSlots();
  if (focusGame) {
    const slot = slotEls.get(focusGame)?.root;
    if (slot) {
      slot.scrollIntoView({ behavior: "smooth", block: "center" });
      slot.classList.add("dragover");
      window.setTimeout(() => slot.classList.remove("dragover"), 900);
    }
  }
}

export function hideOnboarding(): void {
  const overlay = document.getElementById("onboarding");
  if (overlay) overlay.style.display = "none";
}
