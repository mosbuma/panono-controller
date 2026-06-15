/**
 * Browser-local registry linking image_id → user-entered subject names (and optional geo).
 */

const DB_NAME = "panono-registry";
const DB_VERSION = 1;
const STORE = "registry";

export interface PanoramaGeo {
  lat: number;
  lng: number;
  source: "browser" | "camera";
}

export interface PanoramaRegistryRecord {
  imageId: string;
  mainSubject: string;
  detailSubject?: string;
  geo?: PanoramaGeo;
  registeredAt: number;
}

export interface PendingRegistration {
  mainSubject: string;
  detailSubject?: string;
  geo?: PanoramaGeo;
}

const pendingQueue: PendingRegistration[] = [];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "imageId" });
      }
    };
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      })
  );
}

export function queuePendingRegistration(entry: PendingRegistration): void {
  pendingQueue.push(entry);
}

export function shiftPendingRegistration(): PendingRegistration | undefined {
  return pendingQueue.shift();
}

export function pendingRegistrationCount(): number {
  return pendingQueue.length;
}

export async function saveRegistryEntry(
  record: Omit<PanoramaRegistryRecord, "registeredAt"> & { registeredAt?: number }
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const full: PanoramaRegistryRecord = {
    ...record,
    registeredAt: record.registeredAt ?? Date.now(),
  };
  await runTx("readwrite", (store) => store.put(full));
}

export async function getRegistryEntry(imageId: string): Promise<PanoramaRegistryRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const record = (await runTx("readonly", (store) => store.get(imageId))) as
      | PanoramaRegistryRecord
      | undefined;
    return record ?? null;
  } catch {
    return null;
  }
}

export async function getRegistryMap(
  imageIds: string[]
): Promise<Map<string, PanoramaRegistryRecord>> {
  const map = new Map<string, PanoramaRegistryRecord>();
  if (typeof indexedDB === "undefined" || !imageIds.length) return map;
  try {
    await Promise.all(
      imageIds.map(async (id) => {
        const rec = await getRegistryEntry(id);
        if (rec) map.set(id, rec);
      })
    );
  } catch {
    /* ignore */
  }
  return map;
}

export async function deleteRegistryEntry(imageId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await runTx("readwrite", (store) => store.delete(imageId));
  } catch {
    /* ignore */
  }
}

export async function prunePanoramaRegistry(validImageIds: Set<string>): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = cursor.key as string;
        if (!validImageIds.has(key)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("prune failed"));
    });
  } catch {
    /* ignore */
  }
}

// ---- localStorage helpers for dialog pre-fill ----

const REGISTER_INFO_KEY = "panono.registerInfo";
const LAST_MAIN_KEY = "panono.register.lastMainSubject";
const LAST_DETAIL_KEY = "panono.register.lastDetailSubject";
const INCLUDE_GEO_KEY = "panono.register.includeGeo";

export function readRegisterInfo(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(REGISTER_INFO_KEY) === "true";
}

export function writeRegisterInfo(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(REGISTER_INFO_KEY, enabled ? "true" : "false");
}

export interface LastSubjects {
  mainSubject: string;
  detailSubject: string;
  includeGeo: boolean;
}

export function readLastSubjects(): LastSubjects {
  if (typeof localStorage === "undefined") {
    return { mainSubject: "", detailSubject: "", includeGeo: false };
  }
  return {
    mainSubject: localStorage.getItem(LAST_MAIN_KEY) ?? "",
    detailSubject: localStorage.getItem(LAST_DETAIL_KEY) ?? "",
    includeGeo: localStorage.getItem(INCLUDE_GEO_KEY) === "true",
  };
}

export function saveLastSubjects(result: {
  mainSubject: string;
  detailSubject?: string;
  includeGeo?: boolean;
}): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LAST_MAIN_KEY, result.mainSubject);
  localStorage.setItem(LAST_DETAIL_KEY, result.detailSubject ?? "");
  if (result.includeGeo != null) {
    localStorage.setItem(INCLUDE_GEO_KEY, result.includeGeo ? "true" : "false");
  }
}
