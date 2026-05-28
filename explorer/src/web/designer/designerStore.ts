/**
 * Browser-local store for Designer projects (IndexedDB), plus JSON
 * export/import.
 *
 * A project is a `VariRecipe` (`engine/variEdit.ts`): a base game + per-command
 * VVECT edits.  It carries **no copyrighted ROM bytes** — only parameter
 * values — so the runnable image is reconstituted from the user's base ROM at
 * load time.  This is the only saveable artefact in the explorer.
 *
 * A dedicated database (separate from `romStore`'s) keeps the schema decoupled
 * so neither module has to coordinate version bumps with the other.  Projects
 * are keyed by `name` — saving a project with an existing name overwrites it.
 */
import type { GameKind } from "../../board/soundboard.ts";
import { variCommandsFor, VVECT_STRIDE, type VariRecipe } from "../../engine/variEdit.ts";

const DB_NAME = "williams-sound-designer";
const STORE = "projects";
const BASE_GAMES: readonly GameKind[] = ["defender", "stargate", "robotron"];

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
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

export async function listProjects(): Promise<VariRecipe[]> {
  const all = await tx<VariRecipe[]>("readonly", (s) => s.getAll() as IDBRequest<VariRecipe[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(name: string): Promise<VariRecipe | undefined> {
  const rec = await tx<VariRecipe | undefined>("readonly", (s) => s.get(name) as IDBRequest<VariRecipe | undefined>);
  return rec ?? undefined;
}

export async function saveProject(recipe: VariRecipe): Promise<void> {
  await tx("readwrite", (s) => s.put(recipe));
}

export async function deleteProject(name: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(name));
}

// ─── JSON export / import (pure — no IndexedDB) ────────────────────────────

/** Serialise a project to pretty JSON for download / sharing. */
export function exportJson(recipe: VariRecipe): string {
  return JSON.stringify(recipe, null, 2);
}

function isByteRecord(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === VVECT_STRIDE
    && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xFF);
}

/**
 * Parse + validate a project from JSON.  Throws a human-readable error on any
 * malformed field so import failures are actionable rather than silent.
 */
export function importJson(text: string): VariRecipe {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("Expected a JSON object.");
  const o = raw as Record<string, unknown>;

  if (typeof o.name !== "string" || o.name.trim() === "") throw new Error("Missing project name.");
  if (!BASE_GAMES.includes(o.baseGame as GameKind)) {
    throw new Error(`Unknown base game "${String(o.baseGame)}".`);
  }
  const baseGame = o.baseGame as GameKind;
  if (typeof o.edits !== "object" || o.edits === null) throw new Error("Missing edits.");

  const validCmds = new Set(variCommandsFor(baseGame).map((c) => c.cmd));
  const edits: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(o.edits as Record<string, unknown>)) {
    const cmd = Number(k);
    if (!validCmds.has(cmd)) throw new Error(`$${k} is not an editable VARI command on ${baseGame}.`);
    if (!isByteRecord(v)) throw new Error(`Edit for $${k} must be ${VVECT_STRIDE} bytes (0..255).`);
    edits[cmd] = v;
  }

  const now = Date.now();
  return {
    name: o.name,
    baseGame,
    edits,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
}
