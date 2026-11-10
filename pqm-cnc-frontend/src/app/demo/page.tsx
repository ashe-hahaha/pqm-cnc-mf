export default function DemoPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-accent">M15</p>
        <h1 className="font-display text-3xl tracking-tight">Presenter checklist</h1>
        <p className="mt-2 text-sm text-muted">
          Phase D uses simulated CNC process and metrology data. Same UI contracts
          will back onto FastAPI + TimescaleDB in Phase P.
        </p>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground/90">
        <li>/map — cell risk traffic; inspect hot machine</li>
        <li>/dashboard — Quality Engineer lens + trends</li>
        <li>/quality — defect Pareto → events</li>
        <li>/hmi/mch-mill-03 — predicted hold acknowledge</li>
        <li>Copilot — “Which tool fails quality next?”</li>
        <li>/scenarios — early tool change yield delta</li>
      </ol>
      <p className="text-xs text-muted">
        Full script: <code className="text-accent">docs/OFFLINE_DEMO_GUIDE.md</code>
      </p>
    </div>
  );
}
