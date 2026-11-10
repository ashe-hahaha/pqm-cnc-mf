export type DashboardCols = { left: number; right: number };

export type DashboardLayout = {
  heights: Record<string, number>;
  cols: DashboardCols;
  /** When true, panel/column resize handles are disabled. */
  locked: boolean;
};

const STORAGE_KEY = "pqm.ops.dashboardLayout";

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  heights: {
    drawing: 480,
    trend: 280,
    toolWearTrend: 280,
    process: 620,
    recommendations: 240,
    detail: 280,
    alerts: 220,
    pareto: 220,
    confidence: 200,
    summary: 200,
  },
  cols: { left: 260, right: 280 },
  locked: false,
};

export function readDashboardLayout(): DashboardLayout {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DASHBOARD_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const heights = { ...DEFAULT_DASHBOARD_LAYOUT.heights };
    for (const [key, value] of Object.entries(parsed.heights ?? {})) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        heights[key] = value;
      }
    }
    return {
      heights,
      cols: {
        ...DEFAULT_DASHBOARD_LAYOUT.cols,
        ...(parsed.cols ?? {}),
      },
      locked: Boolean(parsed.locked),
    };
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

export function writeDashboardLayout(layout: DashboardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}
