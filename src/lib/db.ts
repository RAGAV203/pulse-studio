/** Tiny promise wrapper around IndexedDB for the offline track library. */

export type TrackSource = "file" | "studio" | "recording" | "pads";

export type Track = {
  id: string;
  name: string;
  artist?: string;
  duration: number;
  size: number;
  type: string;
  source: TrackSource;
  createdAt: number;
  peaks?: number[];
  bpm?: number | null;
  thumbnail?: string;
  blob: Blob;
};

export type TrackMeta = Omit<Track, "blob">;

const DB_NAME = "pulse-studio";
const STORE = "tracks";
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");

export async function putTrack(t: Track) {
  await tx("readwrite", (s) => s.put(t));
  // ask the browser not to evict our offline library under storage pressure
  void navigator.storage?.persist?.();
  return t;
}

export const getTrack = (id: string) => tx<Track | undefined>("readonly", (s) => s.get(id));

export async function listTracks(): Promise<TrackMeta[]> {
  const all = await tx<Track[]>("readonly", (s) => s.getAll());
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const deleteTrack = (id: string) => tx("readwrite", (s) => s.delete(id));

export async function updateTrack(id: string, patch: Partial<Track>) {
  const t = await getTrack(id);
  if (!t) return;
  await putTrack({ ...t, ...patch });
}
