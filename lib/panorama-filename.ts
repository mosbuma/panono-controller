export interface RegistrySubjects {
  mainSubject: string;
  detailSubject?: string;
}

const SUBJECT_MAX_LEN = 40;
const UNSAFE_CHARS = /[/\\:*?"<>|@]/g;

/** Parse camera capture_date (ISO or "yyyy-MM-dd HH:mm:ss,SSS") → yyyy-mm-dd_hh-mm-ss local time. */
export function formatCaptureTimestamp(captureDate: string | undefined): string {
  if (!captureDate) return "unknown-time";
  let d = new Date(captureDate);
  if (Number.isNaN(d.getTime())) {
    const normalized = captureDate.replace(",", ".");
    d = new Date(normalized);
  }
  if (Number.isNaN(d.getTime())) return "unknown-time";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function sanitizeSubject(raw: string): string {
  let s = raw.trim().replace(/\s+/g, "-").replace(UNSAFE_CHARS, "-");
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > SUBJECT_MAX_LEN) s = s.slice(0, SUBJECT_MAX_LEN).replace(/-+$/, "");
  return s;
}

export function buildDownloadBasename(
  captureDate: string | undefined,
  registry?: RegistrySubjects | null
): string | null {
  if (!registry?.mainSubject.trim()) return null;
  const main = sanitizeSubject(registry.mainSubject);
  if (!main) return null;
  const ts = formatCaptureTimestamp(captureDate);
  const detail = registry.detailSubject?.trim()
    ? sanitizeSubject(registry.detailSubject)
    : "";
  return detail ? `${ts}@${main}@${detail}` : `${ts}@${main}`;
}

export function downloadUpfFilename(
  imageId: string,
  captureDate: string | undefined,
  registry?: RegistrySubjects | null
): string {
  return `${buildDownloadBasename(captureDate, registry) ?? imageId}.upf`;
}

export function downloadPtGuiZipFilename(
  imageId: string,
  captureDate: string | undefined,
  registry?: RegistrySubjects | null
): string {
  const base = buildDownloadBasename(captureDate, registry) ?? imageId;
  return `${base}-ptgui-full.zip`;
}

/** Append -2, -3, … when the same basename is used more than once in a bulk download. */
export function dedupeBasenames(basenames: string[]): string[] {
  const counts = new Map<string, number>();
  return basenames.map((base) => {
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}
