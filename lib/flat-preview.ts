/**
 * Flat equirectangular gallery thumbnail.
 *
 * The thumbnail is produced *server-side* by the improved stitcher
 * (POST /api/stitch, variant "thumb" → lib/stitcher/equirect-official.ts) and
 * cached both server-side (data/stitches-v4) and client-side (IndexedDB).
 * Generation therefore needs a connection to the app server; when offline we
 * only serve already-cached thumbnails and skip generation entirely.
 */
import { getFlatPreviewBlob, putFlatPreview } from "@/lib/flat-preview-cache";

/** Server stitch variant used for gallery thumbnails (see lib/stitch-cache.ts). */
const THUMB_VARIANT = "thumb";

/** Preview generation requires the app server; false when the browser is offline. */
export function previewsAvailableOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

async function fetchServerThumb(imageId: string, previewUpfUrl: string): Promise<Blob> {
  const res = await fetch("/api/stitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: previewUpfUrl, imageId, variant: THUMB_VARIANT }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Thumbnail stitch failed (${res.status}): ${detail}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Empty thumbnail response");
  return blob;
}

/** Build the flat thumbnail for one panorama via the server stitcher. */
export async function buildFlatPreviewBlob(
  imageId: string,
  previewUpfUrl: string
): Promise<Blob> {
  return fetchServerThumb(imageId, previewUpfUrl);
}

export async function loadCachedFlatPreviewUrl(
  imageId: string,
  previewUrl: string
): Promise<string | null> {
  const blob = await getFlatPreviewBlob(imageId, previewUrl);
  return blob ? URL.createObjectURL(blob) : null;
}

type PreviewJob = { imageId: string; previewUrl: string };

let queue: PreviewJob[] = [];
let running = false;
let cancelled = false;

export function stopFlatPreviewGeneration(): void {
  cancelled = true;
  queue = [];
}

export function enqueueFlatPreviews(jobs: PreviewJob[]): void {
  // Generation needs the app server; skip entirely when offline.
  if (!previewsAvailableOnline()) return;
  cancelled = false;
  queue = jobs.filter((j) => j.previewUrl);
  if (!running && queue.length) void drainPreviewQueue();
}

const readyListeners = new Set<(imageId: string, objectUrl: string) => void>();
const startListeners = new Set<(imageId: string) => void>();

export function onFlatPreviewReady(
  cb: (imageId: string, objectUrl: string) => void
): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

export function onFlatPreviewStart(cb: (imageId: string) => void): () => void {
  startListeners.add(cb);
  return () => startListeners.delete(cb);
}

function emitReady(imageId: string, objectUrl: string): void {
  for (const cb of readyListeners) cb(imageId, objectUrl);
}

function emitStart(imageId: string): void {
  for (const cb of startListeners) cb(imageId);
}

async function drainPreviewQueue(): Promise<void> {
  running = true;
  while (queue.length && !cancelled) {
    // Bail out if connectivity dropped mid-run.
    if (!previewsAvailableOnline()) break;
    const job = queue.shift()!;
    emitStart(job.imageId);
    try {
      const jpeg = await buildFlatPreviewBlob(job.imageId, job.previewUrl);
      await putFlatPreview(job.imageId, job.previewUrl, jpeg);
      emitReady(job.imageId, URL.createObjectURL(jpeg));
    } catch {
      /* leave placeholder on failure */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  running = false;
}
