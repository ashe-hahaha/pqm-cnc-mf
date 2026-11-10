import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "data", "MachiningData");
const UPLOADS_DIR = path.join(ROOT, "_uploads");

const DRAWING_EXT = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".webp",
]);

export type DrawingKind = "pdf" | "image";

export type MachiningDrawing = {
  id: string;
  jobId: string;
  name: string;
  relPath: string;
  kind: DrawingKind;
  bytes: number;
};

export type MachiningJobBundle = {
  id: string;
  name: string;
  drawings: MachiningDrawing[];
  programs: { name: string; relPath: string }[];
  hasCmm: boolean;
};

export function getMachiningDataRoot(): string {
  return ROOT;
}

export function ensureUploadsDir(): string {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  return UPLOADS_DIR;
}

/** Resolve a relative path under MachiningData; throws if outside root. */
export function resolveMachiningPath(relPath: string): string {
  const cleaned = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (
    cleaned.includes("\0") ||
    cleaned.split("/").some((p) => p === "..")
  ) {
    throw new Error("Invalid path");
  }
  const abs = path.resolve(ROOT, cleaned);
  const rootResolved = path.resolve(ROOT);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error("Path escapes MachiningData");
  }
  return abs;
}

export function drawingKindFor(filePath: string): DrawingKind | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!DRAWING_EXT.has(ext)) return null;
  return ext === ".pdf" ? "pdf" : "image";
}

function toRel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function isDrawingCandidate(absFile: string, rel: string): boolean {
  const kind = drawingKindFor(absFile);
  if (!kind) return false;
  const lower = rel.toLowerCase();
  // Skip CMM / inspection report PDFs — keep tech drawings & shop pictures.
  if (lower.includes("/cmm/") || lower.includes("/inspection")) return false;
  if (lower.includes("cmm-check")) return false;
  if (lower.includes("/obsolete/")) return false;
  return true;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, out);
    else out.push(abs);
  }
  return out;
}

function findPrograms(jobAbs: string): { name: string; relPath: string }[] {
  const programs: { name: string; relPath: string }[] = [];
  const candidates = ["NC", "NC file", "nc"];
  for (const folder of candidates) {
    const dir = path.join(jobAbs, folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (!fs.statSync(abs).isFile()) continue;
      if (name.startsWith(".")) continue;
      programs.push({ name, relPath: toRel(abs) });
    }
  }
  return programs.sort((a, b) => a.name.localeCompare(b.name));
}

function jobHasCmm(jobAbs: string): boolean {
  const markers = ["CMM", "Inspection data", "inspection data"];
  return markers.some((m) => fs.existsSync(path.join(jobAbs, m)));
}

/** List product folders and their tech drawings under data/MachiningData. */
export function listMachiningJobs(): MachiningJobBundle[] {
  if (!fs.existsSync(ROOT)) return [];

  const jobs: MachiningJobBundle[] = [];

  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (entry.name === "_uploads") continue;

    const jobAbs = path.join(ROOT, entry.name);
    const files = walkFiles(jobAbs);
    const drawings: MachiningDrawing[] = [];

    for (const abs of files) {
      const rel = toRel(abs);
      if (!isDrawingCandidate(abs, rel)) continue;
      const kind = drawingKindFor(abs);
      if (!kind) continue;
      const stat = fs.statSync(abs);
      drawings.push({
        id: rel,
        jobId: entry.name,
        name: path.basename(abs),
        relPath: rel,
        kind,
        bytes: stat.size,
      });
    }

    // Prefer DCC/*.pdf first in UI.
    drawings.sort((a, b) => {
      const aDcc = a.relPath.includes("/DCC/") && a.kind === "pdf" ? 0 : 1;
      const bDcc = b.relPath.includes("/DCC/") && b.kind === "pdf" ? 0 : 1;
      if (aDcc !== bDcc) return aDcc - bDcc;
      return a.name.localeCompare(b.name);
    });

    jobs.push({
      id: entry.name,
      name: entry.name,
      drawings,
      programs: findPrograms(jobAbs),
      hasCmm: jobHasCmm(jobAbs),
    });
  }

  // Uploaded drawings (not tied to a product folder yet).
  if (fs.existsSync(UPLOADS_DIR)) {
    const uploadDrawings: MachiningDrawing[] = [];
    for (const abs of walkFiles(UPLOADS_DIR)) {
      const rel = toRel(abs);
      const kind = drawingKindFor(abs);
      if (!kind) continue;
      uploadDrawings.push({
        id: rel,
        jobId: "_uploads",
        name: path.basename(abs),
        relPath: rel,
        kind,
        bytes: fs.statSync(abs).size,
      });
    }
    if (uploadDrawings.length > 0) {
      jobs.unshift({
        id: "_uploads",
        name: "Uploaded drawings",
        drawings: uploadDrawings.sort((a, b) => a.name.localeCompare(b.name)),
        programs: [],
        hasCmm: false,
      });
    }
  }

  return jobs.sort((a, b) => {
    if (a.id === "_uploads") return -1;
    if (b.id === "_uploads") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/** Save an uploaded drawing into data/MachiningData/_uploads. */
export function saveUploadedDrawing(
  filename: string,
  bytes: Buffer,
): MachiningDrawing {
  ensureUploadsDir();
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, "_");
  if (!drawingKindFor(base)) {
    throw new Error("Unsupported drawing type (use PDF or image)");
  }
  let target = path.join(UPLOADS_DIR, base);
  if (fs.existsSync(target)) {
    const stem = path.parse(base).name;
    const ext = path.parse(base).ext;
    target = path.join(UPLOADS_DIR, `${stem}-${Date.now()}${ext}`);
  }
  fs.writeFileSync(target, bytes);
  const rel = toRel(target);
  const kind = drawingKindFor(target)!;
  return {
    id: rel,
    jobId: "_uploads",
    name: path.basename(target),
    relPath: rel,
    kind,
    bytes: bytes.length,
  };
}
