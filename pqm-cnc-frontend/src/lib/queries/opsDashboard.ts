import type { OpsDashboardSnapshot } from "@/domain/opsDashboard";
import { opsDashboardSeed } from "@/seed/opsDashboard";

/** Page 1 operational dashboard snapshot (Phase D seed). */
export function queryOpsDashboard(): OpsDashboardSnapshot {
  return opsDashboardSeed;
}
