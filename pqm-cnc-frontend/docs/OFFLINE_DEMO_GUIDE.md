# Offline Demo Guide — Predictive Quality Monitoring (CNC)

**Audience:** Presenter running a customer buy-in demo without live coaching  
**Mode:** Phase D (simulated data)  
**App:** http://localhost:3001  
**Primary surface:** `/dashboard` (ops monitor)

> This is **not** live plant data. Scores and trends are simulated for narrative
> control. Phase P will swap seed/sim for FastAPI + TimescaleDB behind the same
> APIs.

Developer setup: see [`HANDOVER.md`](./HANDOVER.md).

---

## Before you start (5 min)

1. `npm install && npm run dev` → http://localhost:3001  
2. Open **`/dashboard`** (main story). Soft login is not enforced yet.  
3. Optional: set speed to **10×** for a short room; **1×** for a paced walkthrough.  
4. Confirm a drawing is selected and balloons are visible.

---

## Timed narrative (~15–20 min)

### 1. Ops monitor open (3 min) — `/dashboard`

- Job header: part / batch / sim label  
- Drawing map with color balloons (Pass / Warn / Risk / N/M)  
- Purple pulse = **In cut** (current balloon)  
- Left: summary + Process context streaming  
- Right: balloon detail + quality trend (20 predictions, 3 measured QC)

**Talk track:** “We overlay predicted quality on the drawing while the piece is cut.”

### 2. Live machining cycle (5 min)

- Watch process sparklines grow for the active balloon, then reset on the next  
- Note exactly one **warning** and one **high risk** per piece (demo design)  
- Alerts and recommendations update as outcomes land  
- After the piece completes → review; Process keeps the last balloon; click another
  balloon to switch process graphs  
- Press **N** / **Next** to load the next blank  

**Talk track:** “Process evidence and risk land feature-by-feature — not after the CMM queue.”

### 3. Inspect a risk balloon (3 min)

- Click high-risk balloon → detail + quality trend freeze on that feature  
- Point at measured QC diamonds vs prediction path  
- Open Copilot (**C** or FAB): “Which balloon is high risk?” / “What’s the status?”

**Talk track:** “Inspect stays on the operator’s question; live cut continues separately.”

### 4. Machine HMI score (2 min) — `/hmi/mch-mill-03`

- Show in-process quality score for a mill  
- Tie back to plant hierarchy seed  

**Talk track:** “Cell and machine views share the same Phase D contracts we’ll wire to real inference.”

### 5. Close (2 min)

- Phase D = experience + API shapes  
- Phase P = Timescale + models + MTConnect/CMM  
- Q&A  

---

## FAQ

| Question | Answer |
|----------|--------|
| Is this live? | No — Phase D simulation for buy-in |
| Why purple ring? | Balloon under cut (distinct from gold = warning risk) |
| Why 8s per balloon? | Demo pace (use 10× if needed) |
| Soft login? | Documented for later; not blocking the ops demo today |
| Why purple ring? | Balloon under cut (distinct from gold = warning risk) |
| Why 8s per balloon? | Demo pace (use 10× if needed) |

---

## Controls cheat-sheet

| Control | Action |
|---------|--------|
| Click balloon | Inspect (detail + quality trend) |
| N / Next | Load next piece (after review) |
| 1× / 10× | Sim speed |
| C / Copilot FAB | Open PQM Copilot |
| Ctrl+Shift + wheel/drag | Zoom / pan drawing |
| Design / Locked | Balloon edit mode |

---

*Aligned with handoff 2026-08-07. Update this guide when `/map` or login ships.*
