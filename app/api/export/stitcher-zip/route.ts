import { NextRequest, NextResponse } from "next/server";
import { fetchUpfBuffer } from "@/lib/fetch-upf";
import { buildStitcherZipFromUpf } from "@/lib/stitcher/export-stitcher-zip";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ExportBody {
  url?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let upfBuf: Buffer | null = null;
    let filename = "panono-ptgui.zip";

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof Blob) {
        upfBuf = Buffer.from(await file.arrayBuffer());
        const name = file instanceof File ? file.name : "upload.upf";
        filename = name.replace(/\.upf$/i, "-ptgui.zip");
      }
    } else {
      const body = (await req.json()) as ExportBody;
      if (body.url) {
        upfBuf = await fetchUpfBuffer(body.url);
        const id = body.url.split("/").pop()?.replace(/\.upf$/i, "") ?? "panono";
        filename = `${id}-ptgui.zip`;
      }
    }

    if (!upfBuf?.length) {
      return NextResponse.json(
        { error: "Provide a UPF url (JSON) or file upload (multipart)" },
        { status: 400 }
      );
    }

    const zip = await buildStitcherZipFromUpf(upfBuf);

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
