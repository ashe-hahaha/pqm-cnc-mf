# Handoff package checklist

Use this when giving the project to another developer or machine.

## Include

- [x] Source (`src/`), configs, `package-lock.json`
- [x] `docs/HANDOVER.md`, `WORKPLAN.md`, `OFFLINE_DEMO_GUIDE.md`
- [x] `README.md`, `AGENTS.md`
- [x] `public/` brand assets
- [x] `data/pqm/balloon-layouts.json` (if present)
- [x] Small reference PDFs under `data/` (optional)

## Exclude

- [x] `node_modules/`, `.next/`
- [x] `data/**/*.zip`, `data/MachiningData/_uploads/`
- [x] `.env*`, secrets
- [x] Large OneDrive dumps unless explicitly requested

## Receiver steps

1. Extract archive → `~/MLProjects/pqm-cnc`
2. Read `docs/HANDOVER.md`
3. `npm install && npm run dev`
4. Open http://localhost:3001/dashboard
5. `npm test`
6. Ask owner for MachiningData packs if drawings are missing
7. Create initial git commit when approved

## Suggested first commit message

```
Initial Phase D handoff: ops dashboard, machining sim, docs.

```
