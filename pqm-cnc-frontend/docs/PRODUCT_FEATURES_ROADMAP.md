# Predictive Quality Monitoring (CNC) — End-user feature summary  
## Material for product roadmap

**Plant / site context:** Machine Shop 1 (Precision Machining Group)  
**Users:** Machine operators, quality engineers, process / manufacturing engineers, supervisors  

This document lists **capabilities the end user can see and use**. It is intended for roadmap prioritization, not engineering delivery plans.

---

## 1. What the product is for

Help teams **see predicted quality risk on the drawing while the part is still being cut**—at the feature (balloon / CTQ) level—before scrap is confirmed at the CMM.

Typical questions the product answers:

- How is quality looking on this job right now?  
- Which drawing balloons are high risk or warning?  
- Why is this balloon risky (prediction vs spec, process context)?  
- What should the operator or quality engineer do next?  
- How do predicted values compare to measured QC over recent parts?  
- Which failure modes dominate for this product?  
- How confident is the model, and how much QC coverage do we have?  
- What does in-process quality look like on the operator HMI?

---

## 2. User journey (story to protect in the roadmap)

1. Open the **Operational Dashboard (Monitor)** for the live job and drawing.  
2. Watch balloons machine in sequence; process streams for the feature in cut.  
3. When risk appears, read **alerts** and **AI recommendations**.  
4. Click a balloon for **detail** and **quality trend** (prediction vs measured QC).  
5. Ask the **PQM Copilot** which balloons are high risk and what to do next.  
6. Check the **Operator HMI** for the in-process quality score on that machine.  
7. Optionally scan the **shop-floor map** for plant-level quality risk.  
8. *(Roadmap)* Open **Quality Investigation** and **Yield what-if** when those workspaces ship.

---

## 3. End-user features

### 3.1 Operational dashboard (primary surface)

| Feature | User value |
|---------|------------|
| Job / process header | See machine, product, work order, program, operation, tool, balloon, material, batch progress, inspected parts |
| Live status | Know the job is live; wall-clock time |
| Playback speed (1× / 10×) | Speed through a machining cycle for review or demos |
| Next piece (Next / N) | Load the next blank after review |
| Lock / unlock layout | Keep panel layout stable during a shift |
| Load / switch drawing | Work with the correct drawing for the job |
| Ops sidebar | Jump Overview / Drawing / Trends / Process / Reports / Alerts / Settings |

---

### 3.2 Drawing – quality balloon map

| Feature | User value |
|---------|------------|
| CTQ balloons on the drawing | See predicted quality **on the geometry**, not only in tables |
| Balloon status legend | Pass / Warn / Risk / Not machined / In cut at a glance |
| In-cut highlight | Know which feature is being cut now |
| Click balloon to inspect | Freeze detail + trend on the feature of interest |
| Multi-page drawing | Navigate drawing sheets |
| Zoom / pan | Inspect dense drawings (e.g. Ctrl+Shift gestures) |
| Design vs Locked mode | Author or protect balloon placement |
| Add / delete / drag balloons | Place CTQs for a new or updated drawing |
| Upload / pick drawing source | Bring in job drawings from machining data |

---

### 3.3 Balloon quality summary

| Feature | User value |
|---------|------------|
| Pass / Warning / High risk / Not machined counts | Instant feature-level scorecard for the piece |
| Overall quality status | Single good / watch / poor read for the current job |
| Prediction confidence | How much to trust the current predictions |

---

### 3.4 Process context (while cutting)

| Feature | User value |
|---------|------------|
| Feedrate, spindle speed, spindle load | Live cutting parameters for the active balloon |
| MRR, estimated DoC / WoC | Material-removal context |
| Vibration RMS / Acoustic RMS | Signal severity next to quality risk |
| Sparklines (streaming) | See process move during the cut |
| Follow selected / last balloon | Keep process evidence aligned with investigation |

---

### 3.5 Selected balloon detail & quality trend

| Feature | User value |
|---------|------------|
| Predicted value vs spec | See where the feature is expected to land |
| Margin & pass probability | Quantify how close to a fail |
| Confidence & last QC | Trust and latest metrology result |
| Quality trend chart | Predicted series vs measured QC over recent parts |
| Spec band (LSL–USL) | Visualize against limits |
| In control / out of control | Quick SPC-style status for the characteristic |

---

### 3.6 Alerts & AI recommendations

| Feature | User value |
|---------|------------|
| Alerts list (high risk / warning / info) | Interrupt-driven awareness during the cycle |
| Click alert → focus balloon | Jump from message to the feature on the drawing |
| AI recommendations | Suggested actions (e.g. extra CMM sample, verify tool, increase sampling, continue machining) |
| Priority levels | High / recommended / info / OK triage |

---

### 3.7 Failure Pareto & model confidence

| Feature | User value |
|---------|------------|
| Top failure Pareto (this product) | See which defect modes dominate recent parts |
| Cumulative % | Focus on the vital few quality issues |
| Prediction confidence | Model trust for current predictions |
| Similar jobs coverage | How much like-history supports the prediction |
| QC coverage / inspected parts | How much metrology backs the view |
| Model status & last update | Know whether the quality model is current |

---

### 3.8 Shop-floor map (plant view)

| Feature | User value |
|---------|------------|
| Plant title & cell preview | Orient around Machine Shop 1 |
| Plant KPIs | Predicted scrap, average Cpk, cell count |
| Machine cards | Risk and Cpk per machine (traffic-light style) |
| Drill toward Monitor / HMI | Move from plant risk to job or operator view |

*Note for roadmap:* Map is a lighter shell today than the Operational Dashboard; full interactive cell map is a natural enhance item.

---

### 3.9 Operator HMI (in-process quality)

| Feature | User value |
|---------|------------|
| Machine list ranked by quality | Find the hottest quality risk on the floor |
| Live quality score | Simple operator-facing score |
| Score label | ok / watch / suspect / critical |
| P(defect) & confidence | Probability framing for the shift |
| Top drivers | Why the score is moving |
| Process & signal summary | Enough context to act without the full ops board |

*Roadmap gap users may expect:* predicted hold / acknowledge workflow (named in presenter materials; not a full control on the HMI yet).

---

### 3.10 PQM Copilot

| Feature | User value |
|---------|------------|
| Always-available assistant | Ask without leaving the current screen |
| Plant / job quality overview | “How is quality looking?” |
| High-risk balloon list | “Which balloons are high risk?” |
| Explain selected balloon | Why this CTQ is risky |
| Quality trend tip | Point to prediction vs QC |
| Next actions | What to do now on the job |
| Next piece guidance | When to load the next blank |
| Suggested topic chips | Common quality questions one click away |
| Deep links | Jump to Drawing / Trends / Alerts / Process |

---

### 3.11 Named surfaces to complete (roadmap)

These appear in navigation or docs as user destinations but are **not yet interactive product workspaces**:

| Surface | Intended user value when complete |
|---------|-----------------------------------|
| **Quality Investigation** | Defect Pareto → events → machine / metrology detail for quality engineers |
| **Yield what-if** | Compare early tool change / process override vs run-on → scrap & yield delta |
| **Presenter checklist / Demo** | Guided walkthrough for customer sessions |
| **Soft login / roles** | Operator vs quality engineer views (UI-gated) |

---

## 4. How this differs from OEE or PdM (for positioning)

| If the user knows… | This product instead emphasizes… |
|--------------------|----------------------------------|
| **OEE** (availability, performance, losses) | **Feature-level predicted quality** on the drawing during the cut |
| **PdM** (spindle/tool health, RUL, maintenance) | **Dimensional / CTQ risk**, pass probability, QC vs prediction, quality actions |

Keep roadmap language in **quality / yield / CTQ / balloon / CMM** terms—not “losses” or “component RUL,” unless intentionally bridging products later.

---

## 5. Feature themes for roadmap planning

Group backlog items by **user outcome**.

| Theme | Outcome for users | Example enhancements |
|-------|-------------------|----------------------|
| **A. See quality risk on the drawing** | Know which feature is failing before CMM | Richer balloon states, multi-job drawings, cell map parity with Monitor |
| **B. Prove it with process & QC** | Trust predictions with evidence | Stronger trends, more QC points, exportable investigation packs |
| **C. Act during the cut** | Change behavior this piece / next piece | HMI hold/acknowledge, clearer recommendations, sampling workflow |
| **D. Investigate after the fact** | Close the loop for quality engineers | Full Quality Investigation workspace, event timelines, metrology detail |
| **E. Decide with yield economics** | Choose process/tool interventions | Yield what-if (scrap, yield, cost of early change) |
| **F. Guided assistance** | Ask in natural language | Broader Copilot questions, role-specific chips, saved playbooks |

---

## 6. Suggested prioritization questions

For each feature in §3, ask:

1. **Who** uses it on a normal shift (operator / quality / process / supervisor)?  
2. **When** do they need it (during cut / end of piece / end of batch / weekly review)?  
3. **What decision** does it change (continue, re-cut, extra CMM, tool change, hold)?  
4. **What is missing** for them to trust it on a real job?  
5. **Keep / Enhance / Defer** for the next release?

---

## 7. Quick map of user surfaces

| User surface | Where users go |
|--------------|----------------|
| Operational Dashboard (Monitor) | Live job, drawing balloons, process, trends, alerts, recommendations |
| Drawing balloon map | Feature-level predicted quality on the print |
| Shop-floor map | Plant / cell quality risk cards |
| Operator HMI | In-process quality score & drivers |
| PQM Copilot | Ask and deep-link |
| Quality Investigation | *(Roadmap)* Deep quality analysis |
| Yield what-if | *(Roadmap)* Scrap / yield trade-offs |

---

## 8. Demo job context (reference)

Useful when walking the story with stakeholders:

| Field | Example demo values |
|-------|---------------------|
| Machine | Makino Slim3n / VMC family |
| Product | VALVE BODY A12 |
| Material | SS316L |
| Operation / tool | e.g. OP20 hole finish boring · T06 |
| Cells in plant model | Milling Cell A, Turning Cell B, Grinding Cell C |

---

*Use this file in roadmap workshops as the end-user capability checklist. Update when user-facing features are added, changed, or retired.*
