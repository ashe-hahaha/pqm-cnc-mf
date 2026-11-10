import type { DrawingBalloon } from "@/domain/opsDashboard";
import {
  type BalloonEditMode,
  type BalloonLayoutPayload,
  pickNewerLayout,
  readBalloonLayoutLocal,
  writeBalloonCache,
} from "@/lib/drawingBalloonCache";

async function fetchRemoteLayout(
  relPath: string,
): Promise<BalloonLayoutPayload | null> {
  try {
    const res = await fetch(
      `/api/balloon-layouts?relPath=${encodeURIComponent(relPath)}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      layout?: BalloonLayoutPayload | null;
    };
    if (!json.layout || !Array.isArray(json.layout.balloons)) return null;
    return {
      balloons: json.layout.balloons,
      mode: json.layout.mode === "design" ? "design" : "lock",
      updatedAt: json.layout.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Load newest layout from localStorage and server file store. */
export async function loadBalloonLayout(
  relPath: string,
): Promise<BalloonLayoutPayload | null> {
  const local = readBalloonLayoutLocal(relPath);
  const remote = await fetchRemoteLayout(relPath);
  const picked = pickNewerLayout(local, remote);
  if (picked) {
    // Keep both stores aligned to the winner.
    writeBalloonCache(relPath, picked.balloons, picked.mode);
  }
  return picked;
}

/** Persist to localStorage immediately and to the server file store. */
export async function persistBalloonLayout(
  relPath: string,
  balloons: DrawingBalloon[],
  mode: BalloonEditMode,
): Promise<void> {
  writeBalloonCache(relPath, balloons, mode);
  try {
    await fetch("/api/balloon-layouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relPath, balloons, mode }),
      keepalive: true,
    });
  } catch {
    /* offline / server down — localStorage still holds the layout */
  }
}
