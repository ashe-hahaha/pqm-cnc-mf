import type { DrawingBalloon } from "@/domain/opsDashboard";

function nextBalloonIds(existing: DrawingBalloon[]): { id: string; code: string } {
  let max = 0;
  for (const b of existing) {
    const m = /^B?(\d+)$/i.exec(b.code) ?? /^b(\d+)$/i.exec(b.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = max + 1;
  return { id: `b${n}`, code: `B${n}` };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Create one manual balloon stub at a drawing position. */
export function createManualBalloon(
  existing: DrawingBalloon[],
  page: number,
  xPct: number,
  yPct: number,
): DrawingBalloon {
  const { id, code } = nextBalloonIds(existing);
  return {
    id,
    code,
    characteristic: "Dimension",
    characteristicType: "LENGTH",
    featureKind: "Feature",
    nominal: 0,
    upperTol: 0.02,
    lowerTol: 0.02,
    unit: "mm",
    critical: false,
    xPct: clamp(xPct, 0, 100),
    yPct: clamp(yPct, 0, 100),
    page,
    source: "manual",
    risk: "not_machined",
  };
}

/**
 * Place `count` balloons near a click — small grid offset so they don't stack.
 */
export function createManualBalloons(
  existing: DrawingBalloon[],
  page: number,
  xPct: number,
  yPct: number,
  count: number,
): DrawingBalloon[] {
  const n = Math.max(1, Math.min(24, Math.floor(count)));
  let roster = [...existing];
  const created: DrawingBalloon[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const balloon = createManualBalloon(
      roster,
      page,
      xPct + col * 2.2,
      yPct + row * 2.2,
    );
    roster = [...roster, balloon];
    created.push(balloon);
  }
  return created;
}
