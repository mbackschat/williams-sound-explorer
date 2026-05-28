/**
 * Browser-local store for Designer projects (IndexedDB), plus JSON
 * export/import.
 *
 * A project (`CustomProject`) is a **custom ROM with its own item list**: an
 * engine base (which game's VARI engine to run on) + an ordered list of named
 * sounds, each a 9-byte VVECT record. It carries **no copyrighted ROM bytes** —
 * only parameter values — and the runnable image is reconstituted from the
 * user's base ROM via `buildCustomRom`. This is the only saveable artefact.
 *
 * Projects are keyed by `name`; saving over an existing name overwrites it.
 * Legacy v1 projects (`{ baseGame, edits }`) are converted on load.
 */
import type { GameKind } from "../../board/soundboard.ts";
import { VVECT_STRIDE, variCommandsFor } from "../../engine/variEdit.ts";
import { maxSlots } from "../../engine/customRom.ts";

/** Custom ROMs run on a VARI engine that can take new slots: Defender or Stargate. */
export const ENGINE_BASES: readonly GameKind[] = ["defender", "stargate"];

export interface CustomSlot {
  /** User-facing name (the item list shows these). */
  name: string;
  /** Current 9-byte VVECT record. */
  record: number[];
  /** The record at creation/copy time — the "Start" reference for A/B. */
  start: number[];
}

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

// ─── Coercion: accept current shape or convert a legacy v1 recipe ──────────

const isByteRecord = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === VVECT_STRIDE && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF);

/** Convert a legacy v1 recipe `{ baseGame, edits }` to a `CustomProject`. */
function fromLegacy(o: Record<string, unknown>): CustomProject {
  const baseGame = o.baseGame as GameKind;
  const names = new Map(variCommandsFor(baseGame).map((c) => [c.cmd, c.name]));
  const slots: CustomSlot[] = Object.entries(o.edits as Record<string, number[]>)
    .map(([cmd, record]) => ({ name: names.get(Number(cmd)) ?? `$${cmd}`, record, start: record }));
  const now = Date.now();
  return {
    name: typeof o.name === "string" ? o.name : "untitled",
    engineBase: ENGINE_BASES.includes(baseGame) ? baseGame : "defender",
    slots,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
  };
}

function coerceProject(raw: unknown): CustomProject {
  const o = raw as Record<string, unknown>;
  if ("edits" in o && !("slots" in o)) return fromLegacy(o); // legacy v1 recipe
  return o as unknown as CustomProject;
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
    if (!ENGINE_BASES.includes(o.baseGame as GameKind)) throw new Error(`Legacy project's base game "${String(o.baseGame)}" can't be a custom-ROM engine base.`);
    return { ...fromLegacy(o), updatedAt: Date.now() };
  }

  if (typeof o.name !== "string" || o.name.trim() === "") throw new Error("Missing project name.");
  if (!ENGINE_BASES.includes(o.engineBase as GameKind)) throw new Error(`Engine base must be Defender or Stargate (got "${String(o.engineBase)}").`);
  const engineBase = o.engineBase as GameKind;
  if (!Array.isArray(o.slots)) throw new Error("Missing slots.");
  if (o.slots.length > maxSlots(engineBase)) throw new Error(`Too many sounds (${o.slots.length} > ${maxSlots(engineBase)} for ${engineBase}).`);

  const slots: CustomSlot[] = o.slots.map((s, i) => {
    const so = s as Record<string, unknown>;
    if (typeof so.name !== "string") throw new Error(`Sound ${i + 1}: missing name.`);
    if (!isByteRecord(so.record)) throw new Error(`Sound "${so.name}": record must be ${VVECT_STRIDE} bytes (0..255).`);
    const start = isByteRecord(so.start) ? so.start : so.record;
    return { name: so.name, record: so.record, start };
  });

  const now = Date.now();
  return {
    name: o.name,
    engineBase,
    slots,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
}
