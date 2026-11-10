import { beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ content: "", writes: 0 }));
vi.mock("node:fs", () => ({
  default: {
    existsSync: () => Boolean(disk.content),
    readFileSync: () => disk.content,
    mkdirSync: () => {},
    writeFileSync: (_path: string, content: string) => {
      disk.content = content;
      disk.writes++;
    },
  },
}));

import { saveBalloonLayout } from "./balloonLayoutStore";
import { opsDashboardSeed } from "@/seed/opsDashboard";

beforeEach(() => {
  disk.content = "";
  disk.writes = 0;
});

it("does not rewrite layouts when only simulated risk changes", () => {
  const balloons = opsDashboardSeed.balloons;
  const first = saveBalloonLayout("drawing.pdf", balloons, "lock");
  const again = saveBalloonLayout(
    "drawing.pdf",
    balloons.map((b) => ({ ...b, risk: "warning" as const })),
    "lock",
  );
  expect(disk.writes).toBe(1);
  expect(again.updatedAt).toBe(first.updatedAt);
});

it("persists actual position and edit-mode changes", () => {
  const balloons = opsDashboardSeed.balloons;
  saveBalloonLayout("drawing.pdf", balloons, "lock");
  const moved = balloons.map((b, i) => i === 0 ? { ...b, xPct: b.xPct + 1 } : b);
  saveBalloonLayout("drawing.pdf", moved, "lock");
  saveBalloonLayout("drawing.pdf", moved, "design");
  expect(disk.writes).toBe(3);
});
