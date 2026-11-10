import type { FailureParetoItem } from "@/domain/opsDashboard";
import { Panel } from "./Panel";

export function FailurePareto({ items }: { items: FailureParetoItem[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const withCum = items.reduce<
    Array<FailureParetoItem & { cumulative: number }>
  >((acc, item) => {
    const prev = acc[acc.length - 1]?.cumulative ?? 0;
    acc.push({ ...item, cumulative: prev + item.pct });
    return acc;
  }, []);

  const w = 420;
  const h = 140;
  const pad = { l: 28, r: 36, t: 12, b: 36 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const barW = plotW / Math.max(withCum.length, 1);

  const bars = withCum.map((item, i) => {
    const bh = (item.count / max) * plotH;
    const x = pad.l + i * barW + barW * 0.18;
    const y = pad.t + plotH - bh;
    return { ...item, x, y, bh, cx: pad.l + i * barW + barW / 2 };
  });

  const cumPath = bars
    .map((b, i) => {
      const y = pad.t + plotH - (b.cumulative / 100) * plotH;
      return `${i === 0 ? "M" : "L"}${b.cx},${y}`;
    })
    .join(" ");

  return (
    <Panel title="Top failure Pareto · this product · last 100 parts">
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div>
          <svg viewBox={`0 0 ${w} ${h}`} className="h-[150px] w-full">
            {[0, 0.5, 1].map((t) => {
              const y = pad.t + plotH * (1 - t);
              return (
                <line
                  key={t}
                  x1={pad.l}
                  x2={pad.l + plotW}
                  y1={y}
                  y2={y}
                  stroke="rgba(148,163,184,0.12)"
                />
              );
            })}
            {bars.map((b) => (
              <rect
                key={b.label}
                x={b.x}
                y={b.y}
                width={barW * 0.64}
                height={b.bh}
                rx={2}
                fill="#3d8fd1"
              />
            ))}
            <path
              d={cumPath}
              fill="none"
              stroke="#d4a017"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {bars.map((b) => {
              const y = pad.t + plotH - (b.cumulative / 100) * plotH;
              return (
                <circle
                  key={`c-${b.label}`}
                  cx={b.cx}
                  cy={y}
                  r={3}
                  fill="#d4a017"
                  stroke="#0b111b"
                  strokeWidth={1}
                />
              );
            })}
            {bars.map((b) => (
              <text
                key={`l-${b.label}`}
                x={b.cx}
                y={h - 8}
                textAnchor="middle"
                fill="#6b7c8f"
                style={{ fontSize: 8 }}
              >
                {b.label.split(" ")[0]}
              </text>
            ))}
            <text
              x={w - 4}
              y={pad.t + 8}
              textAnchor="end"
              fill="#d4a017"
              style={{ fontSize: 8 }}
            >
              Cum %
            </text>
          </svg>
          <div className="mt-1 flex gap-4 text-[10px] uppercase tracking-[0.08em] text-[#6b7c8f]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#3d8fd1]" /> Count
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[#d4a017]" /> Cumulative %
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[#243141]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0e1620] text-[#6b7c8f]">
              <tr>
                <th className="px-2.5 py-2 font-medium">Failure mode</th>
                <th className="px-2 py-2 font-medium">Count</th>
                <th className="px-2 py-2 font-medium">%</th>
                <th className="px-2.5 py-2 font-medium">Cum</th>
              </tr>
            </thead>
            <tbody>
              {withCum.map((item) => (
                <tr
                  key={item.label}
                  className="border-t border-[#243141] text-foreground"
                >
                  <td className="px-2.5 py-1.5">{item.label}</td>
                  <td className="px-2 py-1.5 tabular-nums">{item.count}</td>
                  <td className="px-2 py-1.5 tabular-nums">{item.pct}</td>
                  <td className="px-2.5 py-1.5 tabular-nums text-[#d4a017]">
                    {item.cumulative}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
