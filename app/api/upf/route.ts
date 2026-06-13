import { NextRequest, NextResponse } from "next/server";
import { fetchUpfBuffer } from "@/lib/fetch-upf";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query parameter required" }, { status: 400 });
  }
  try {
    const buf = await fetchUpfBuffer(url);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
