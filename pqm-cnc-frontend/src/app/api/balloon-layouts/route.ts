import { NextResponse } from "next/server";
import type { DrawingBalloon } from "@/domain/opsDashboard";
import type { BalloonEditMode } from "@/lib/drawingBalloonCache";
import {
  getBalloonLayout,
  saveBalloonLayout,
} from "@/lib/balloonLayoutStore";

/**
 * GET /api/balloon-layouts?relPath=...
 * PUT /api/balloon-layouts  { relPath, balloons, mode }
 */
export async function GET(request: Request) {
  try {
    const relPath = new URL(request.url).searchParams.get("relPath");
    if (!relPath) {
      return NextResponse.json({ error: "relPath required" }, { status: 400 });
    }
    const layout = getBalloonLayout(relPath);
    return NextResponse.json({ layout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read layout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      relPath?: string;
      balloons?: DrawingBalloon[];
      mode?: BalloonEditMode;
    };
    if (!body.relPath || !Array.isArray(body.balloons)) {
      return NextResponse.json(
        { error: "relPath and balloons required" },
        { status: 400 },
      );
    }
    const mode = body.mode === "design" || body.mode === "lock" ? body.mode : "lock";
    const layout = saveBalloonLayout(body.relPath, body.balloons, mode);
    return NextResponse.json({ layout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save layout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
