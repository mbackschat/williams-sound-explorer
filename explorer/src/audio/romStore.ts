/**
 * Browser-local store for user-uploaded Williams sound ROMs (IndexedDB).
 *
 * The app ships no copyrighted ROM bytes; the user supplies their own via the
 * onboarding screen and they persist here across sessions.  ROMs are tiny
 * (2–4 KB), so a single object store keyed by game is plenty.
 *
 * `loadRomBytes(game)` is the single entry the rest of the app reads through
 * (rerouted from `host.fetchRom` and `loadRomFromUrl`): IndexedDB first, then a
 * gitignored `/roms/<game>_sound.bin` dev fallback (seeded into the store on
 * first hit) so a developer with local ROMs still gets a one-click experience.
 */
import type { GameKind } from "../board/soundboard.ts";
import { validateRom } from "./romValidate.ts";

const DB_NAME = "williams-sound-explorer";
const STORE = "roms";
const GAMES: readonly GameKind[] = ["defender", "stargate", "robotron"];

export interface StoredRom {
  game: GameKind;
  bytes: ArrayBuffer;
  sha: string;
  tier: "ok" | "warn";
  storedAt: number;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "game" });
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

export async function getStored(game: GameKind): Promise<StoredRom | undefined> {
  const rec = await tx<StoredRom | undefined>("readonly", (s) => s.get(game) as IDBRequest<StoredRom | undefined>);
  return rec ?? undefined;
}

/** Stored ROM bytes as a FRESH Uint8Array copy (safe to transfer to the worklet). */
export async function getRom(game: GameKind): Promise<Uint8Array | undefined> {
  const rec = await getStored(game);
  return rec ? new Uint8Array(rec.bytes.slice(0)) : undefined;
}

export async function putRom(rec: StoredRom): Promise<void> {
  await tx("readwrite", (s) => s.put(rec));
}

export async function deleteRom(game: GameKind): Promise<void> {
  await tx("readwrite", (s) => s.delete(game));
}

export async function hasRom(game: GameKind): Promise<boolean> {
  return (await getStored(game)) !== undefined;
}

/** Games that currently have a stored ROM. */
export async function listRoms(): Promise<GameKind[]> {
  const present: GameKind[] = [];
  for (const g of GAMES) {
    if (await hasRom(g)) present.push(g);
  }
  return present;
}

/** Try the gitignored dev fallback `/roms/<game>_sound.bin`; undefined on miss. */
async function tryFetchDevRom(game: GameKind): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}roms/${game}_sound.bin`);
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/**
 * The single ROM-bytes source for the whole app.  IndexedDB first; otherwise
 * the dev fallback (validated + seeded into the store so subsequent loads come
 * from IDB).  Throws when neither is available — callers must guard the game's
 * availability before reaching here (see `listRoms` / the switcher guards).
 */
export async function loadRomBytes(game: GameKind): Promise<Uint8Array> {
  const stored = await getRom(game);
  if (stored) return stored;

  const dev = await tryFetchDevRom(game);
  if (dev) {
    const v = await validateRom(game, dev);
    if (v.tier !== "reject") {
      await putRom({ game, bytes: v.bytes.slice().buffer, sha: v.sha, tier: v.tier, storedAt: Date.now() });
      return v.bytes;
    }
  }
  throw new Error(`No ROM available for ${game} — upload it first.`);
}
