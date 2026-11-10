import type { DrawingBalloon } from "@/domain/opsDashboard";

const BALLOON_PREFIX = "pqm.ops.pageBalloons:";
const MODE_PREFIX = "pqm.ops.balloonEditMode:";
const META_PREFIX = "pqm.ops.balloonLayoutMeta:";

export type BalloonEditMode = "design" | "lock";

export type BalloonLayoutPayload = {
  balloons: DrawingBalloon[];
  mode: BalloonEditMode;
  updatedAt: string;
};

/** Strip live sim risk so resumed layouts start clean. */
export function normalizeBalloonsForStorage(
  balloons: DrawingBalloon[],
): DrawingBalloon[] {
  return balloons.map((b) => ({
    ...b,
    page: b.page ?? 1,
    source: b.source === "seed" ? "seed" : "manual",
    risk: "not_machined",
  }));
}

/** Persist manual balloon layout per drawing (browser localStorage). */
export function readBalloonCache(relPath: string): DrawingBalloon[] | null {
  const payload = readBalloonLayoutLocal(relPath);
  return payload ? payload.balloons : null;
}

export function readBalloonLayoutLocal(
  relPath: string,
): BalloonLayoutPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BALLOON_PREFIX + relPath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DrawingBalloon[] | BalloonLayoutPayload;
    if (Array.isArray(parsed)) {
      // Legacy: bare balloon array
      return {
        balloons: normalizeBalloonsForStorage(parsed),
        mode: readBalloonEditMode(relPath),
        updatedAt: readMetaUpdatedAt(relPath) ?? new Date(0).toISOString(),
      };
    }
    if (parsed && Array.isArray(parsed.balloons)) {
      return {
        balloons: normalizeBalloonsForStorage(parsed.balloons),
        mode:
          parsed.mode === "design" || parsed.mode === "lock"
            ? parsed.mode
            : readBalloonEditMode(relPath),
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeBalloonCache(
  relPath: string,
  balloons: DrawingBalloon[],
  mode?: BalloonEditMode,
) {
  if (typeof window === "undefined") return;
  const resolvedMode = mode ?? readBalloonEditMode(relPath);
  const payload: BalloonLayoutPayload = {
    balloons: normalizeBalloonsForStorage(balloons),
    mode: resolvedMode,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(BALLOON_PREFIX + relPath, JSON.stringify(payload));
    localStorage.setItem(MODE_PREFIX + relPath, resolvedMode);
    localStorage.setItem(META_PREFIX + relPath, payload.updatedAt);
  } catch {
    /* quota — ignore */
  }
}

export function writeBalloonLayoutLocal(payload: BalloonLayoutPayload & { relPath: string }) {
  writeBalloonCache(payload.relPath, payload.balloons, payload.mode);
}

export function clearBalloonCache(relPath: string) {
  try {
    localStorage.removeItem(BALLOON_PREFIX + relPath);
    localStorage.removeItem(MODE_PREFIX + relPath);
    localStorage.removeItem(META_PREFIX + relPath);
  } catch {
    /* ignore */
  }
}

function readMetaUpdatedAt(relPath: string): string | null {
  try {
    return localStorage.getItem(META_PREFIX + relPath);
  } catch {
    return null;
  }
}

/** design = edit balloons; lock = production (select only). */
export function readBalloonEditMode(relPath: string): BalloonEditMode {
  if (typeof window === "undefined") return "design";
  try {
    const raw = localStorage.getItem(MODE_PREFIX + relPath);
    if (raw === "lock" || raw === "design") return raw;
  } catch {
    /* ignore */
  }
  return readBalloonCache(relPath)?.length ? "lock" : "design";
}

export function writeBalloonEditMode(relPath: string, mode: BalloonEditMode) {
  try {
    localStorage.setItem(MODE_PREFIX + relPath, mode);
    const existing = readBalloonLayoutLocal(relPath);
    if (existing) {
      writeBalloonCache(relPath, existing.balloons, mode);
    }
  } catch {
    /* ignore */
  }
}

/** Pick the newer of local vs server layout. */
export function pickNewerLayout(
  local: BalloonLayoutPayload | null,
  remote: BalloonLayoutPayload | null,
): BalloonLayoutPayload | null {
  if (!local) return remote;
  if (!remote) return local;
  const lt = Date.parse(local.updatedAt) || 0;
  const rt = Date.parse(remote.updatedAt) || 0;
  return rt >= lt ? remote : local;
}
