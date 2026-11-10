import fs from "node:fs";
import { NextResponse } from "next/server";
import {
  contentTypeFor,
  resolveMachiningPath,
} from "@/lib/machiningData";

/**
 * GET /api/machining-data/file?rel=AB-144243AE/DCC/144243AE.pdf
 * Streams a tech drawing (or other file) from data/MachiningData.
 */
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get("rel");
  if (!rel) {
    return NextResponse.json({ error: "rel required" }, { status: 400 });
  }

  try {
    const abs = resolveMachiningPath(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const buf = fs.readFileSync(abs);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentTypeFor(abs),
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          abs.split(/[/\\]/).pop() ?? "drawing",
        )}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
