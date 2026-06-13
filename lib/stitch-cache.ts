import fs from "fs/promises";
import path from "path";

export type StitchVariant = "thumb" | "preview" | "full";
export type StitchMethod = "calibrated" | "opticalflow";

// v2: vignetting + exposure + multiband stitcher (invalidate v1 cache)
const CACHE_ROOT = path.join(process.cwd(), "data", "stitches-v2");

const VARIANT_OPTS: Record<
  StitchVariant,
  { width?: number; height?: number; resolution: "preview" | "full"; quality: number }
> = {
  thumb: { width: 360, height: 180, resolution: "preview", quality: 82 },
  preview: { resolution: "preview", quality: 90 },
  full: { resolution: "full", quality: 92 },
};

export function stitchVariantOpts(variant: StitchVariant) {
  return VARIANT_OPTS[variant];
}

function safeId(imageId: string): string {
  const cleaned = imageId.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned) throw new Error("Invalid imageId");
  return cleaned;
}

function cacheBasename(variant: StitchVariant, method: StitchMethod): string {
  return method === "opticalflow" ? `${variant}-oflow` : variant;
}

export function cacheFilePath(
  imageId: string,
  variant: StitchVariant,
  method: StitchMethod = "calibrated"
): string {
  return path.join(CACHE_ROOT, safeId(imageId), `${cacheBasename(variant, method)}.jpg`);
}

export async function ensureCacheDir(imageId: string): Promise<string> {
  const dir = path.join(CACHE_ROOT, safeId(imageId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readCachedStitch(
  imageId: string,
  variant: StitchVariant,
  method: StitchMethod = "calibrated"
): Promise<Buffer | null> {
  try {
    return await fs.readFile(cacheFilePath(imageId, variant, method));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeCachedStitch(
  imageId: string,
  variant: StitchVariant,
  jpeg: Buffer,
  method: StitchMethod = "calibrated"
): Promise<void> {
  await ensureCacheDir(imageId);
  await fs.writeFile(cacheFilePath(imageId, variant, method), jpeg);
}

export async function removeCachedStitches(imageId: string): Promise<void> {
  const dir = path.join(CACHE_ROOT, safeId(imageId));
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export interface CacheEntry {
  imageId: string;
  variants: StitchVariant[];
}

export async function listCachedStitches(): Promise<CacheEntry[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(CACHE_ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const entries: CacheEntry[] = [];
  for (const dir of dirs) {
    const fullDir = path.join(CACHE_ROOT, dir);
    const stat = await fs.stat(fullDir);
    if (!stat.isDirectory()) continue;
    const files = await fs.readdir(fullDir);
    const variants = files
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => f.replace(/-oflow\.jpg$/, "").replace(/\.jpg$/, "") as StitchVariant)
      .filter((v): v is StitchVariant => v === "thumb" || v === "preview" || v === "full");
    if (variants.length) entries.push({ imageId: dir, variants });
  }
  return entries;
}

export async function cachedStitchCount(): Promise<number> {
  const entries = await listCachedStitches();
  return entries.reduce((n, e) => n + e.variants.length, 0);
}

export function isStitchVariant(value: string): value is StitchVariant {
  return value === "thumb" || value === "preview" || value === "full";
}

export function isStitchMethod(value: string | null | undefined): value is StitchMethod {
  return value === "calibrated" || value === "opticalflow";
}

export function parseStitchMethod(value: string | null | undefined): StitchMethod {
  return isStitchMethod(value) ? value : "calibrated";
}
