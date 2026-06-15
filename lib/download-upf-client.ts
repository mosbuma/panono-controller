import { fetchUpfArrayBuffer } from "@/lib/fetch-upf-client";

export async function downloadUpfBlob(upfUrl: string, filename: string): Promise<void> {
  const buf = await fetchUpfArrayBuffer(upfUrl);
  const blob = new Blob([buf], { type: "application/zip" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export interface BulkUpfItem {
  imageId: string;
  upfUrl: string;
  label?: string;
  filename?: string;
}

export interface BulkDownloadProgress {
  done: number;
  total: number;
  currentLabel: string;
}

/** Download full UPF files sequentially (browser may prompt for multiple downloads). */
export async function downloadAllUpfs(
  items: BulkUpfItem[],
  onProgress?: (progress: BulkDownloadProgress) => void
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const label = item.label ?? item.imageId;
    onProgress?.({ done: i, total, currentLabel: label });
    try {
      await downloadUpfBlob(item.upfUrl, item.filename ?? `${item.imageId}.upf`);
      ok++;
      await new Promise((r) => setTimeout(r, 450));
    } catch {
      failed++;
    }
    onProgress?.({ done: i + 1, total, currentLabel: label });
  }

  return { ok, failed };
}
