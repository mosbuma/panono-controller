import { NextRequest, NextResponse } from "next/server";
import { fetchUpfBuffer } from "@/lib/fetch-upf";
import {
  cachedStitchCount,
  isStitchVariant,
  listCachedStitches,
  parseStitchMethod,
  readCachedStitch,
  stitchVariantOpts,
  writeCachedStitch,
  type StitchMethod,
  type StitchVariant,
} from "@/lib/stitch-cache";
import { stitchUpfBuffer, type StitchResolution } from "@/lib/stitcher/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StitchBody {
  url?: string;
  imageId?: string;
  variant?: StitchVariant;
  force?: boolean;
  resolution?: StitchResolution;
  width?: number;
  height?: number;
  quality?: number;
  method?: StitchMethod;
  useGravity?: boolean;
  applyVignetting?: boolean;
  applyExposure?: boolean;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

export async function GET(): Promise<NextResponse> {
  const entries = await listCachedStitches();
  const count = await cachedStitchCount();
  return NextResponse.json({ count, entries });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let upfBuf: Buffer | null = null;
    let resolution: StitchResolution = "preview";
    let width: number | undefined;
    let height: number | undefined;
    let quality = 90;
    let filename = "panorama.jpg";
    let imageId: string | undefined;
    let variant: StitchVariant | undefined;
    let force = false;
    let cacheHit = false;
    let method: StitchMethod = "calibrated";
    let useGravity: boolean | undefined;
    let applyVignetting: boolean | undefined;
    let applyExposure: boolean | undefined;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof Blob) {
        upfBuf = Buffer.from(await file.arrayBuffer());
        const name = file instanceof File ? file.name : "upload.upf";
        filename = name.replace(/\.upf$/i, ".jpg");
      }
      const res = form.get("resolution");
      if (res === "preview" || res === "full") resolution = res;
      const v = form.get("variant");
      if (typeof v === "string" && isStitchVariant(v)) variant = v;
      const id = form.get("imageId");
      if (typeof id === "string" && id) imageId = id;
      method = parseStitchMethod(form.get("method")?.toString());
      const w = form.get("width");
      const h = form.get("height");
      if (typeof w === "string" && w) width = Number(w);
      if (typeof h === "string" && h) height = Number(h);
      useGravity = parseBool(form.get("useGravity"));
      applyVignetting = parseBool(form.get("applyVignetting"));
      applyExposure = parseBool(form.get("applyExposure"));
    } else {
      const body = (await req.json()) as StitchBody;
      imageId = body.imageId;
      variant = body.variant;
      force = Boolean(body.force);
      method = body.method ?? "calibrated";
      if (body.url) {
        upfBuf = await fetchUpfBuffer(body.url);
        const id = body.url.split("/").pop()?.replace(/\.upf$/i, "") ?? "panorama";
        filename = `${id}.jpg`;
      }
      if (body.resolution === "preview" || body.resolution === "full") {
        resolution = body.resolution;
      }
      width = body.width;
      height = body.height;
      if (body.quality) quality = Math.min(100, Math.max(50, body.quality));
      useGravity = parseBool(body.useGravity);
      applyVignetting = parseBool(body.applyVignetting);
      applyExposure = parseBool(body.applyExposure);
    }

    if (variant) {
      const opts = stitchVariantOpts(variant);
      resolution = opts.resolution;
      width = opts.width ?? width;
      height = opts.height ?? height;
      quality = opts.quality;
    }

    if (imageId && variant && !force) {
      const cached = await readCachedStitch(imageId, variant, method);
      if (cached) {
        cacheHit = true;
        return new NextResponse(new Uint8Array(cached), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Disposition": `inline; filename="${imageId}-${variant}${method === "opticalflow" ? "-oflow" : ""}.jpg"`,
            "Cache-Control": "public, max-age=86400",
            "X-Cache": "HIT",
            "X-Stitch-Method": method,
          },
        });
      }
    }

    if (!upfBuf?.length) {
      return NextResponse.json(
        { error: "Provide a UPF url (JSON) or file upload (multipart)" },
        { status: 400 }
      );
    }

    const jpeg = await stitchUpfBuffer(upfBuf, {
      resolution,
      width,
      height,
      quality,
      method,
      useGravity,
      applyVignetting,
      applyExposure,
    });

    if (imageId && variant) {
      await writeCachedStitch(imageId, variant, jpeg, method);
    }

    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": imageId ? "public, max-age=86400" : "private, max-age=3600",
        "X-Cache": cacheHit ? "HIT" : "MISS",
        "X-Stitch-Method": method,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stitch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
