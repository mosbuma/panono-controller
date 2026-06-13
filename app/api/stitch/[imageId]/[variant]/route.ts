import { NextRequest, NextResponse } from "next/server";
import {
  isStitchVariant,
  parseStitchMethod,
  readCachedStitch,
  removeCachedStitches,
  type StitchMethod,
} from "@/lib/stitch-cache";

export const runtime = "nodejs";

type Params = { imageId: string; variant: string };

function resolveMethod(req: NextRequest): StitchMethod {
  return parseStitchMethod(req.nextUrl.searchParams.get("method"));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<Params> }
): Promise<NextResponse> {
  const { imageId, variant } = await ctx.params;
  if (!isStitchVariant(variant)) {
    return NextResponse.json({ error: "Unknown variant" }, { status: 400 });
  }

  const method = resolveMethod(req);
  const jpeg = await readCachedStitch(imageId, variant, method);
  if (!jpeg) {
    return NextResponse.json({ error: "Not cached" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "X-Stitch-Method": method,
    },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<Params> }
): Promise<NextResponse> {
  const { imageId, variant } = await ctx.params;
  if (!isStitchVariant(variant)) {
    return new NextResponse(null, { status: 400 });
  }
  const method = resolveMethod(req);
  const jpeg = await readCachedStitch(imageId, variant, method);
  if (!jpeg) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.length),
      "Cache-Control": "public, max-age=86400",
      "X-Stitch-Method": method,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<Params> }
): Promise<NextResponse> {
  const { imageId } = await ctx.params;
  await removeCachedStitches(imageId);
  return NextResponse.json({ ok: true });
}
