/**
 * Browser-local store for Designer projects (IndexedDB), plus JSON
 * export/import.
 *
 * A project (`CustomProject`) is a **custom ROM with its own item list**: an
 * engine base (which game's engine code to run on) + an ordered list of named
 * slots. Each slot is a discriminated union:
 *
 *  - **VARI slot** (Phase 3): a new sound at command code `$1D`+, defined by a
 *    9-byte VVECT record. Defender / Stargate only.
 *  - **GWAVE slot** (Phase 5 step 1): an *override* of an existing GWAVE
 *    command (`targetCmd` ∈ $01..$0D), defined by a 7-byte SVTAB record. Any
 *    game — Robotron unlocks here because GWAVE patching is in place (no
 *    dispatcher widen needed).
 *
 * The project carries **no copyrighted ROM bytes** — only parameter values —
 * and the runnable image is reconstituted from the user's base ROM via
 * `buildCustomRom`. Projects are keyed by `name`; saving over an existing
 * name overwrites it.
 *
 * Three on-disk shapes are accepted on load (newest → oldest):
 *  - **v3** (current): `slots: (VariSlot | GwaveSlot)[]` with explicit `kind`.
 *  - **v2** (own-item-list, pre-GWAVE): `slots: [{ name, record, start }]`
 *    without `kind` — treated as all-VARI.
 *  - **v1** (override-in-place): `{ baseGame, edits: { [cmd]: record } }` —
 *    each edit becomes a VARI slot named after the base command.
 */
import type { GameKind } from "../../board/soundboard.ts";
import { VVECT_STRIDE, variCommandsFor } from "../../engine/variEdit.ts";
import { SVTAB_STRIDE, gwaveCommandsFor } from "../../engine/gwaveEdit.ts";
import { maxSlots } from "../../engine/customRom.ts";

/**
 * Games usable as a custom-ROM engine base. Robotron is included for GWAVE
 * slots (override in place); VARI slots remain Defender/Stargate-only and are
 * gated per-slot inside `importJson` and at +New time in the Designer UI.
 */
export const ENGINE_BASES: readonly GameKind[] = ["defender", "stargate", "robotron"];

export interface VariCustomSlot {
  kind: "vari";
  /** User-facing name (the item list shows these). */
  name: string;
  /** Current 9-byte VVECT record. */
  record: number[];
  /** The record at creation/copy time — the "Start" reference for A/B. */
  start: number[];
}

export interface GwaveCustomSlot {
  kind: "gwave";
  /** User-facing name. */
  name: string;
  /** Current 7-byte SVTAB record. */
  record: number[];
  /** The record at creation/copy time — the "Start" reference for A/B. */
  start: number[];
  /**
   * The base game's GWAVE command code this slot *overrides* (e.g. `$05` BBSV).
   * In Explore, firing this code plays the user's edited record.
   */
  targetCmd: number;
}

export type CustomSlot = VariCustomSlot | GwaveCustomSlot;

export interface CustomProject {
  name: string;
  engineBase: GameKind;
  slots: CustomSlot[];
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "williams-sound-designer";
const STORE = "projects";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "name" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function listProjects(): Promise<CustomProject[]> {
  const all = await tx<unknown[]>("readonly", (s) => s.getAll() as IDBRequest<unknown[]>);
  return all.map(coerceProject).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(name: string): Promise<CustomProject | undefined> {
  const rec = await tx<unknown>("readonly", (s) => s.get(name) as IDBRequest<unknown>);
  return rec == null ? undefined : coerceProject(rec);
}

export async function saveProject(p: CustomProject): Promise<void> {
  await tx("readwrite", (s) => s.put(p));
}

export async function deleteProject(name: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(name));
}

// ─── Byte-record validators ────────────────────────────────────────────────

const isVariRecord = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === VVECT_STRIDE && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF);

const isGwaveRecord = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === SVTAB_STRIDE && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF);

const VARI_BASES = new Set<GameKind>(["defender", "stargate"]);

// ─── Coercion: accept v3 (current) / v2 / v1 ──────────────────────────────

/** Convert a legacy v1 recipe `{ baseGame, edits }` to a `CustomProject` (all VARI). */
function fromLegacyV1(o: Record<string, unknown>): CustomProject {
  const baseGame = o.baseGame as GameKind;
  const names = new Map(variCommandsFor(baseGame).map((c) => [c.cmd, c.name]));
  const slots: CustomSlot[] = Object.entries(o.edits as Record<string, number[]>)
    .map(([cmd, record]) => ({ kind: "vari" as const, name: names.get(Number(cmd)) ?? `$${cmd}`, record, start: record }));
  const now = Date.now();
  return {
    name: typeof o.name === "string" ? o.name : "untitled",
    engineBase: VARI_BASES.has(baseGame) ? baseGame : "defender",
    slots,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
  };
}

/** Tag a v2 (no-kind) slot as VARI; leave already-tagged slots untouched. */
function tagV2Slot(raw: unknown): CustomSlot {
  const s = raw as Record<string, unknown>;
  if (s.kind === "gwave") {
    return {
      kind: "gwave",
      name: String(s.name ?? ""),
      record: (s.record as number[]) ?? [],
      start: ((s.start as number[]) ?? (s.record as number[])) ?? [],
      targetCmd: Number(s.targetCmd ?? 0),
    };
  }
  return {
    kind: "vari",
    name: String(s.name ?? ""),
    record: (s.record as number[]) ?? [],
    start: ((s.start as number[]) ?? (s.record as number[])) ?? [],
  };
}

function coerceProject(raw: unknown): CustomProject {
  const o = raw as Record<string, unknown>;
  if ("edits" in o && !("slots" in o)) return fromLegacyV1(o); // v1 → v3
  const slots = Array.isArray(o.slots) ? o.slots.map(tagV2Slot) : [];
  return {
    name: String(o.name ?? "untitled"),
    engineBase: (ENGINE_BASES.includes(o.engineBase as GameKind) ? o.engineBase : "defender") as GameKind,
    slots,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
  };
}

// ─── JSON export / import (pure — no IndexedDB) ────────────────────────────

export function exportJson(p: CustomProject): string {
  return JSON.stringify(p, null, 2);
}

/** Parse + validate a project from JSON (also accepts a legacy v1 recipe). */
export function importJson(text: string): CustomProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not valid JSON."); }
  if (typeof raw !== "object" || raw === null) throw new Error("Expected a JSON object.");
  const o = raw as Record<string, unknown>;

  if ("edits" in o && !("slots" in o)) {
    // Legacy v1 recipes were always all-VARI, so the base must support VARI.
    if (!VARI_BASES.has(o.baseGame as GameKind)) throw new Error(`Legacy project's base game "${String(o.baseGame)}" can't host VARI slots (try Defender or Stargate).`);
    return { ...fromLegacyV1(o), updatedAt: Date.now() };
  }

  if (typeof o.name !== "string" || o.name.trim() === "") throw new Error("Missing project name.");
  if (!ENGINE_BASES.includes(o.engineBase as GameKind)) throw new Error(`Engine base must be Defender, Stargate, or Robotron (got "${String(o.engineBase)}").`);
  const engineBase = o.engineBase as GameKind;
  if (!Array.isArray(o.slots)) throw new Error("Missing slots.");

  const variCap = VARI_BASES.has(engineBase) ? maxSlots(engineBase) : 0;
  const editableGwave = new Set(gwaveCommandsFor(engineBase).map((c) => c.cmd));

  let variCount = 0;
  const slots: CustomSlot[] = o.slots.map((s, i) => {
    const so = s as Record<string, unknown>;
    if (typeof so.name !== "string") throw new Error(`Sound ${i + 1}: missing name.`);
    const kind = so.kind === "gwave" ? "gwave" : "vari"; // v2 slots without kind default to VARI

    if (kind === "vari") {
      if (!VARI_BASES.has(engineBase)) {
        throw new Error(`Sound "${so.name}": VARI slots aren't supported on ${engineBase} — use Defender or Stargate.`);
      }
      if (!isVariRecord(so.record)) throw new Error(`Sound "${so.name}": VARI record must be ${VVECT_STRIDE} bytes (0..255).`);
      const start = isVariRecord(so.start) ? so.start : so.record;
      variCount++;
      return { kind: "vari", name: so.name, record: so.record, start };
    }

    // GWAVE slot
    if (!isGwaveRecord(so.record)) throw new Error(`Sound "${so.name}": GWAVE record must be ${SVTAB_STRIDE} bytes (0..255).`);
    const targetCmd = Number(so.targetCmd);
    if (!Number.isInteger(targetCmd) || !editableGwave.has(targetCmd)) {
      throw new Error(`Sound "${so.name}": GWAVE override target $${(targetCmd >>> 0).toString(16).toUpperCase()} is not an editable GWAVE command on ${engineBase}.`);
    }
    const start = isGwaveRecord(so.start) ? so.start : so.record;
    return { kind: "gwave", name: so.name, record: so.record, start, targetCmd };
  });

  if (variCount > variCap) throw new Error(`Too many VARI sounds (${variCount} > ${variCap} for ${engineBase}).`);

  // GWAVE overrides must each target a distinct command (you can only override
  // one record per code).
  const gwaveTargets = new Set<number>();
  for (const s of slots) {
    if (s.kind !== "gwave") continue;
    if (gwaveTargets.has(s.targetCmd)) throw new Error(`Duplicate GWAVE override for $${s.targetCmd.toString(16).toUpperCase()}.`);
    gwaveTargets.add(s.targetCmd);
  }

  const now = Date.now();
  return {
    name: o.name,
    engineBase,
    slots,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
}
