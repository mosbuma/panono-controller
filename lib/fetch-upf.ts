import { isAllowedUpfUrl } from "@/lib/upf-url";

export { isAllowedUpfUrl };

export async function fetchUpfBuffer(url: string): Promise<Buffer> {
  if (!isAllowedUpfUrl(url)) {
    throw new Error("URL must point to a camera on the local network (private IP)");
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to fetch UPF: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
