# PQM-CNC Workplan Detail

Companion to the root [README](../README.md) and [HANDOVER](./HANDOVER.md).
Use this file for sprint notes and decisions. For “what works today,” trust
**HANDOVER** over older milestone checklists below.

Last updated: 2026-08-07

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-02 | Sibling repo (not OEE fork) | Quality domain differs; reuse patterns |
| 2026-08-02 | Phase D mock/sim first | Matches OEE buy-in path |
| 2026-08-02 | Add Quality Engineer role | SPC / investigation persona |
| 2026-08-02 | Investigation route `/quality` | Avoid OEE “losses” language |
| 2026-08-03 | Ops `/dashboard` is primary demo | Faster customer story than waiting on full `/map` |
| 2026-08-03 | Manual Next/N after piece | Operator-paced review |
| 2026-08-03 | Process follows cut; review keeps last then click | Live evidence without fighting inspect |
| 2026-08-03 | Process = step/plateau + light sine noise | CNC setpoint nature |
| 2026-08-04 | Quality trend = poly≤3 + AR noise; 3 QC pts | Not sine, not a chord |
| 2026-08-04 | Pass QC still scatters in-band | Good ≠ flat |
| 2026-08-04 | In-cut = purple `#a78bfa` | Distinct from warn gold |
| 2026-08-04 | `BALLOON_CYCLE_MS = 8000` | Demo pace (was 30s) |
| 2026-08-07 | Handover package + docs refresh | New developer pickup |

---

## Shipped vs backlog (as of handoff)

### Shipped

- [x] Next.js 16 + Tailwind + Vitest on port 3001
- [x] Ops dashboard with machining sim
- [x] Drawing balloons (design/lock, persist local + API)
- [x] Process streaming + quality trends
- [x] Copilot (scripted)
- [x] HMI inference pages
- [x] Hierarchy + machining-data + balloon-layouts APIs
- [x] Handover + offline guide aligned to `/dashboard`

### Backlog

- [ ] Initial git commit + freeze tag `phase-d-pqm-cnc-v0.1.0`
- [ ] Soft login + role switcher
- [ ] Full `/map` floor plan (M6-class)
- [ ] `/quality` investigation workspace
- [ ] `/scenarios` yield what-if
- [ ] Rich `/demo` presenter page
- [ ] Layout editor

---

## Legacy sprint checklists (historical)

Kept for traceability against the original map-first plan. Many items were
superseded by the ops-dashboard path.

### S0 (foundation) — done

- [x] Repo scaffold, README, Vitest, layer stubs

### S1–S3 (map-first) — partially superseded

- Seed hierarchy exists; `/map` remains a shell
- Ops sim + dashboard cover much of the “live quality” intent

---

## Acceptance for credible demo (current bar)

1. Presenter can run the `/dashboard` narrative in `OFFLINE_DEMO_GUIDE.md`
2. Sim completes a piece with 1 warn + 1 high_risk; Next loads another
3. `npm test` and `npm run build` green
4. In-cut (purple) ≠ warn (gold)
5. Phase D disclaimer clear to the audience

---

## Sprint notes

### 2026-08-07 — Handover

- Added `docs/HANDOVER.md`
- Refreshed README + offline guide to match live product
- Packaged handoff archive under `~/MLProjects/`
