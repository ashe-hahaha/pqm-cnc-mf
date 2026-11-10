"use client";

import { useState } from "react";
import { cn } from "@/lib/format";

export type ActiveDrawing = {
  relPath: string;
  name: string;
  kind: "pdf" | "image";
  jobId: string;
  jobName: string;
  programName?: string;
};

type ApiDrawing = {
  id: string;
  jobId: string;
  name: string;
  relPath: string;
  kind: "pdf" | "image";
  bytes: number;
};

type ApiJob = {
  id: string;
  name: string;
  drawings: ApiDrawing[];
  programs: { name: string; relPath: string }[];
  hasCmm: boolean;
};

export function DrawingSourcePicker({
  active,
  onSelect,
}: {
  active: ActiveDrawing | null;
  onSelect: (drawing: ActiveDrawing) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function loadJobs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/machining-data/jobs");
      const json = (await res.json()) as { jobs?: ApiJob[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to scan MachiningData");
      setJobs(json.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load drawings");
    } finally {
      setLoading(false);
    }
  }

  function openPicker() {
    setOpen(true);
    void loadJobs();
  }

  async function onUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/machining-data/upload", {
        method: "POST",
        body,
      });
      const json = (await res.json()) as {
        drawing?: ApiDrawing;
        error?: string;
      };
      if (!res.ok || !json.drawing) {
        throw new Error(json.error ?? "Upload failed");
      }
      await loadJobs();
      onSelect({
        relPath: json.drawing.relPath,
        name: json.drawing.name,
        kind: json.drawing.kind,
        jobId: json.drawing.jobId,
        jobName: "Uploaded drawings",
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (open) setOpen(false);
          else openPicker();
        }}
        className="rounded border border-panel-border bg-background/50 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-steel hover:text-accent"
      >
        {active ? `Drawing: ${active.name}` : "Load drawing…"}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(100vw-2rem,28rem)] rounded-lg border border-panel-border bg-panel p-3 shadow-none">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">
                MachiningData drawings
              </p>
              <p className="text-[11px] text-muted">
                data/MachiningData · tech drawing / shop picture
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-muted hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          {loading ? (
            <p className="py-4 text-sm text-muted">Scanning folder…</p>
          ) : null}
          {error ? (
            <p className="mb-2 rounded border border-bad/40 bg-bad/10 px-2 py-1.5 text-xs text-bad">
              {error}
            </p>
          ) : null}

          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {jobs.map((job) => (
              <div key={job.id}>
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-foreground">
                  <span className="font-medium">{job.name}</span>
                  {job.hasCmm ? (
                    <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
                      CMM
                    </span>
                  ) : null}
                  {job.programs[0] ? (
                    <span className="text-[10px] text-muted">
                      NC {job.programs[0].name}
                    </span>
                  ) : null}
                </p>
                {job.drawings.length === 0 ? (
                  <p className="text-[11px] text-muted">No drawing files</p>
                ) : (
                  <ul className="space-y-1">
                    {job.drawings.map((d) => {
                      const selected = active?.relPath === d.relPath;
                      return (
                        <li key={d.relPath}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelect({
                                relPath: d.relPath,
                                name: d.name,
                                kind: d.kind,
                                jobId: job.id,
                                jobName: job.name,
                                programName: job.programs[0]?.name,
                              });
                              setOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors",
                              selected
                                ? "border-accent/50 bg-accent/10 text-foreground"
                                : "border-panel-border bg-background/40 text-muted hover:border-steel hover:text-foreground",
                            )}
                          >
                            <span className="truncate">{d.name}</span>
                            <span className="shrink-0 uppercase tracking-[0.08em]">
                              {d.kind}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
            {!loading && jobs.length === 0 ? (
              <p className="text-sm text-muted">
                No jobs found under data/MachiningData.
              </p>
            ) : null}
          </div>

          <div className="mt-3 border-t border-panel-border pt-3">
            <label className="flex cursor-pointer flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
                Upload new drawing
              </span>
              <span className="text-[11px] text-muted">
                Saves to data/MachiningData/_uploads (PDF or image)
              </span>
              <input
                type="file"
                accept=".pdf,image/*"
                disabled={uploading}
                className="mt-1 block w-full text-xs text-muted file:mr-3 file:rounded file:border-0 file:bg-steel/30 file:px-2 file:py-1 file:text-xs file:text-foreground"
                onChange={(e) => {
                  void onUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {uploading ? (
              <p className="mt-1 text-xs text-muted">Uploading…</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function drawingFileUrl(relPath: string): string {
  return `/api/machining-data/file?rel=${encodeURIComponent(relPath)}`;
}
