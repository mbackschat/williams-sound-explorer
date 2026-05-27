/**
 * Pattern 5 / Step 6.2 — what-if parameter sliders.  Each `.param-row` carries
 * per-game address attributes (data-addr-{game}); on game switch the addresses
 * re-resolve and the force-checkbox state is replayed against the new game's
 * cells.  Sliders track live RAM when force is off; when force flips on, the
 * slider's value is pushed as a paramOverride and the row turns yellow.
 *
 * `initParamSliders` wires the rows and returns the two hooks `main` drives:
 * `syncFromSnapshot` (per render frame, when force is off) and `replayOverrides`
 * (after a host is (re)created on game switch / init).
 */
import type { StateSnapshot } from "../../data/protocol.ts";
import type { AppContext } from "../appContext.ts";

type VariKey = "loper" | "hiper" | "locnt" | "hicnt" | "lodt" | "hidt" | "lomod" | "hien";
interface ParamRow {
  row: HTMLElement;
  slider: HTMLInputElement;
  value: HTMLElement;
  force: HTMLInputElement;
  /** Engine slot field this row mirrors when force is off; undefined = no live mirror. */
  ramKey: VariKey | undefined;
}
const VARI_RAM_KEYS: Record<string, VariKey> = {
  LOPER: "loper",
  HIPER: "hiper",
};

export interface ParamSlidersApi {
  /** Mirror the live VARI cell into each non-forced slider (called per snapshot). */
  syncFromSnapshot(s: StateSnapshot): void;
  /** Re-push every forced override to the (new) host — call after host (re)creation. */
  replayOverrides(): void;
}

export function initParamSliders(ctx: AppContext): ParamSlidersApi {
  const paramRows: ParamRow[] = [];

  const addrForRow = (row: HTMLElement): number => {
    const g = ctx.currentGame();
    const raw = row.dataset[`addr${g[0]!.toUpperCase()}${g.slice(1)}` as `addr${string}`]
      ?? row.dataset.addrDefender ?? "0";
    return Number.parseInt(raw, 16);
  };

  const rows = Array.from(document.querySelectorAll(".param-row")) as HTMLElement[];
  for (const row of rows) {
    const slider = row.querySelector(".param-slider") as HTMLInputElement;
    const value = row.querySelector(".param-value") as HTMLElement;
    const force = row.querySelector(".param-force-cb") as HTMLInputElement;
    const label = row.querySelector(".param-label") as HTMLElement;
    const cellName = label.textContent?.trim() ?? "";
    paramRows.push({ row, slider, value, force, ramKey: VARI_RAM_KEYS[cellName] });

    // Force toggle: on → set the override to the slider's current value;
    // off → clear the override.
    force.addEventListener("change", () => {
      row.classList.toggle("forced", force.checked);
      const host = ctx.getHost();
      if (!host) return;
      if (force.checked) {
        host.setParamOverride(addrForRow(row), Number.parseInt(slider.value, 10));
      } else {
        host.setParamOverride(addrForRow(row), null);
      }
    });

    // Slider drag: only sends if force is on.  Either way the user sees the
    // value display update so they can preview the candidate value.
    slider.addEventListener("input", () => {
      const v = Number.parseInt(slider.value, 10);
      value.textContent = `$${v.toString(16).toUpperCase().padStart(2, "0")}`;
      const host = ctx.getHost();
      if (force.checked && host) {
        host.setParamOverride(addrForRow(row), v);
      }
    });
  }

  return {
    syncFromSnapshot(s: StateSnapshot): void {
      for (const r of paramRows) {
        if (r.force.checked) continue;
        if (!r.ramKey || !s.vari) continue;
        const live = (s.vari[r.ramKey] as number) & 0xFF;
        if (Number.parseInt(r.slider.value, 10) !== live) {
          r.slider.value = String(live);
          r.value.textContent = `$${live.toString(16).toUpperCase().padStart(2, "0")}`;
        }
      }
    },
    replayOverrides(): void {
      const host = ctx.getHost();
      if (!host) return;
      for (const r of paramRows) {
        if (r.force.checked) {
          host.setParamOverride(addrForRow(r.row), Number.parseInt(r.slider.value, 10));
        }
      }
    },
  };
}
