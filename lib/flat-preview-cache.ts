/**
 * Client-side IndexedDB cache for flat gallery thumbnails and preview UPF archives.
 * Entries are kept while the panorama still exists on the camera (pruned on refresh).
 */

const DB_NAME = "panono-flat-previews";
const DB_VERSION = 2;
const THUMB_STORE = "previews";
const UPF_STORE = "previewUpfs";

/** Bump when thumbnail rendering changes so stale JPEGs are regenerated. */
export const FLAT_PREVIEW_VERSION = 4;

interface PreviewRecord {
  imageId: string;
  previewUrl: string;
  jpeg: Blob;
  version: number;
  updatedAt: number;
}

interface PreviewUpfRecord {
  imageId: string;
  previewUrl: string;
  upf: Blob;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(THUMB_STORE)) {
        db.createObjectStore(THUMB_STORE, { keyPath: "imageId" });
      }
      if (!db.objectStoreNames.contains(UPF_STORE)) {
        db.createObjectStore(UPF_STORE, { keyPath: "imageId" });
      }
    };
  });
  return dbPromise;
}

function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      })
  );
}

export async function getFlatPreviewBlob(
  imageId: string,
  previewUrl: string
): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const record = (await runTx(THUMB_STORE, "readonly", (store) => store.get(imageId))) as
      | PreviewRecord
      | undefined;
    if (!record?.jpeg || record.previewUrl !== previewUrl || record.version !== FLAT_PREVIEW_VERSION) {
      if (record) await deleteFlatPreview(imageId);
      return null;
    }
    return record.jpeg;
  } catch {
    return null;
  }
}

export async function putFlatPreview(
  imageId: string,
  previewUrl: string,
  jpeg: Blob
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const record: PreviewRecord = {
    imageId,
    previewUrl,
    jpeg,
    version: FLAT_PREVIEW_VERSION,
    updatedAt: Date.now(),
  };
  try {
    await runTx(THUMB_STORE, "readwrite", (store) => store.put(record));
  } catch {
    /* cache is best-effort */
  }
}

export async function getPreviewUpfBuffer(
  imageId: string,
  previewUrl: string
): Promise<ArrayBuffer | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const record = (await runTx(UPF_STORE, "readonly", (store) => store.get(imageId))) as
      | PreviewUpfRecord
      | undefined;
    if (!record?.upf || record.previewUrl !== previewUrl) {
      if (record) await deletePreviewUpf(imageId);
      return null;
    }
    return record.upf.arrayBuffer();
  } catch {
    return null;
  }
}

export async function putPreviewUpf(
  imageId: string,
  previewUrl: string,
  upf: Blob
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const record: PreviewUpfRecord = {
    imageId,
    previewUrl,
    upf,
    updatedAt: Date.now(),
  };
  try {
    await runTx(UPF_STORE, "readwrite", (store) => store.put(record));
  } catch {
    /* cache is best-effort */
  }
}

export async function deleteFlatPreview(imageId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await runTx(THUMB_STORE, "readwrite", (store) => store.delete(imageId));
  } catch {
    /* ignore */
  }
}

export async function deletePreviewUpf(imageId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await runTx(UPF_STORE, "readwrite", (store) => store.delete(imageId));
  } catch {
    /* ignore */
  }
}

/** Drop cached data for panoramas no longer on the camera. */
export async function pruneFlatPreviewCache(validImageIds: Set<string>): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    for (const storeName of [THUMB_STORE, UPF_STORE]) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const key = cursor.key as string;
          if (!validImageIds.has(key)) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB prune failed"));
      });
    }
  } catch {
    /* ignore */
  }
}

export async function deletePreviewCacheEntry(imageId: string): Promise<void> {
  await Promise.all([deleteFlatPreview(imageId), deletePreviewUpf(imageId)]);
}
