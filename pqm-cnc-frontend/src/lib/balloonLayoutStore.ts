import fs from "node:fs";
import path from "node:path";
import type { DrawingBalloon } from "@/domain/opsDashboard";
import type { BalloonEditMode } from "@/lib/drawingBalloonCache";
import { normalizeBalloonsForStorage } from "@/lib/drawingBalloonCache";

export type BalloonLayoutRecord = {
  balloons: DrawingBalloon[];
  mode: BalloonEditMode;
  updatedAt: string;
};

type BalloonLayoutFile = {
  byRelPath: Record<string, BalloonLayoutRecord>;
};

const STORE_PATH = path.join(
  process.cwd(),
  "data",
  "pqm",
  "balloon-layouts.json",
);

function emptyFile(): BalloonLayoutFile {
  return { byRelPath: {} };
}

function ensureDir() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

export function readBalloonLayoutFile(): BalloonLayoutFile {
  try {
    if (!fs.existsSync(STORE_PATH)) return emptyFile();
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as BalloonLayoutFile;
    if (!parsed || typeof parsed !== "object" || !parsed.byRelPath) {
      return emptyFile();
    }
    return parsed;
  } catch {
    return emptyFile();
  }
}

export function writeBalloonLayoutFile(file: BalloonLayoutFile) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(file, null, 2), "utf8");
}

export function getBalloonLayout(
  relPath: string,
): BalloonLayoutRecord | null {
  const rec = readBalloonLayoutFile().byRelPath[relPath];
  return rec ?? null;
}

export function saveBalloonLayout(
  relPath: string,
  balloons: DrawingBalloon[],
  mode: BalloonEditMode,
): BalloonLayoutRecord {
  const file = readBalloonLayoutFile();
  const normalized = normalizeBalloonsForStorage(balloons);
  const existing = file.byRelPath[relPath];
  if (
    existing?.mode === mode &&
    JSON.stringify(existing.balloons) === JSON.stringify(normalized)
  ) {
    return existing;
  }
  const rec: BalloonLayoutRecord = {
    balloons: normalized,
    mode,
    updatedAt: new Date().toISOString(),
  };
  file.byRelPath[relPath] = rec;
  writeBalloonLayoutFile(file);
  return rec;
}
