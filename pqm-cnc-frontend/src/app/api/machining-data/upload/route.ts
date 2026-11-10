import { NextResponse } from "next/server";
import { saveUploadedDrawing } from "@/lib/machiningData";

/**
 * POST /api/machining-data/upload
 * multipart form field "file" → saved under data/MachiningData/_uploads
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "empty file" }, { status: 400 });
    }
    if (bytes.length > 40 * 1024 * 1024) {
      return NextResponse.json({ error: "file too large (40MB max)" }, { status: 400 });
    }
    const drawing = saveUploadedDrawing(file.name, bytes);
    return NextResponse.json({ drawing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
