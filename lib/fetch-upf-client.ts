import { isAllowedUpfUrl } from "@/lib/upf-url";

/**
 * Fetch a camera UPF in the browser. Tries the camera URL directly first;
 * on network/CORS/mixed-content failure, falls back to same-origin /api/upf proxy
 * (the Next server must reach the camera on the LAN).
 */
export async function fetchUpfArrayBuffer(
  url: string,
  onProgress?: (pct: number | null) => void
): Promise<ArrayBuffer> {
  try {
    return await fetchArrayBuffer(url, onProgress);
  } catch (err) {
    if (!shouldUseProxy(err, url)) throw err;
    const proxyUrl = `/api/upf?url=${encodeURIComponent(url)}`;
    return fetchArrayBuffer(proxyUrl, onProgress);
  }
}

function shouldUseProxy(err: unknown, url: string): boolean {
  if (!isAllowedUpfUrl(url)) return false;
  if (typeof window !== "undefined" && window.location.protocol === "http:") return false;
  if (err instanceof TypeError) return true;
  return false;
}

async function fetchArrayBuffer(
  url: string,
  onProgress?: (pct: number | null) => void
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length") || 0);
  if (!res.body || !total || !onProgress) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.round((received / total) * 100));
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out.buffer;
}
