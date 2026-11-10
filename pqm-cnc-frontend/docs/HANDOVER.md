# PQM-CNC — Developer Handover (day-1)

**Handoff date:** 2026-08-07  
**Repo:** `~/MLProjects/pqm-cnc`  
**Demo:** http://localhost:3001/dashboard  

For **overview, logic flow, and module I/O**, read the root
[`README.md`](../README.md) first. This file is the short pickup checklist.

---

## 15-minute pickup

```bash
cd ~/MLProjects/pqm-cnc
npm install
npm run dev    # :3001
npm test
```

1. Open `/dashboard`.
2. Watch purple **In cut** balloon + Process streaming (~8s/balloon; try **10×**).
3. Click balloons (inspect freezes detail/trend). After piece complete, Process
   follows clicks; press **N** / **Next** for next piece.
4. Open Copilot (**C**).

Presenter script: [`OFFLINE_DEMO_GUIDE.md`](./OFFLINE_DEMO_GUIDE.md).

---

## What works vs stubs

| Live | Stub / shell |
|------|----------------|
| `/dashboard` ops + machining sim | `/map` card shell |
| Process + quality trends | `/quality`, `/scenarios` |
| Drawing balloons + persist | Soft login |
| Copilot, `/hmi` scores | Full floor-map editor |

---

## Where to edit

| Change | Start here |
|--------|------------|
| Cycle timing / outcomes | `src/sim/machiningCycle.ts` |
| Sim React binding | `src/sim/useMachiningSim.ts` |
| Dashboard wiring | `src/components/dashboard/OpsDashboard.tsx` |
| Quality series shape | `src/lib/qualityTrend.ts` |
| Process series / stream | `src/lib/processTrends.ts` |
| In-cut styling | `src/components/dashboard/DrawingStage.tsx` |
| Seed job / balloons | `src/seed/opsDashboard.ts` |

Full I/O tables → [README §5](../README.md#5-module-interfaces-io).  
Logic flow → [README §4](../README.md#4-logic-flow).

---

## Gotchas

1. Next.js 16 — see `AGENTS.md` / `node_modules/next/dist/docs/`.
2. No git commits may exist yet — create initial commit when approved.
3. Ops snapshot is **client-simulated**, not fetched from an ops HTTP API.
4. Inspect ≠ process focus (see README §4.3).
5. Drawing zoom/pan needs **Ctrl+Shift**.
6. Large packs under `data/MachiningData/_uploads` are gitignored.

---

## Backlog (priority)

1. Soft login  
2. Real `/map` floor plan  
3. `/quality` investigation  
4. `/scenarios` what-if  
5. Git freeze tag `phase-d-pqm-cnc-v0.1.0`

Decisions log: [`WORKPLAN.md`](./WORKPLAN.md).
