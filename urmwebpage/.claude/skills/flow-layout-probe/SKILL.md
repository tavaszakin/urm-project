---
name: flow-layout-probe
description: Write and run a non-mutating headless probe that measures the flow-diagram layout engine (SketchV4 by default) against real compiled fixtures, dumps JSON/table evidence, and summarizes findings. Use for diagnostic-only investigations of layout geometry — crossings, overlaps, spacing, ports, HALT routing — NOT for changing layout code.
---

# Flow-layout probe

Diagnostic-only tooling for the URM flow-diagram layout engine. A probe loads the
**production** layout code via Vite SSR, compiles **real fixtures** through the running
backend, runs them through the engine, and dumps evidence (JSON + console table). It never
edits `src/` and never reimplements the production layout.

Default target is **SketchV4** (`?flowLayout=sketchv4`). SketchV3 appears only as an
optional legacy baseline when a comparison is explicitly useful.

## When to use

Use this skill when the ask is to *observe or measure* the layout — e.g. "why does
`divides` cross near the HALT lane," "measure branch spacing across fixtures," "audit V4
port selection," "compare V4 vs the old engine on `eq`." See the trigger examples at the
bottom.

Do **not** use it to change layout behavior. If the ask is to fix/tune the layout, a probe
may still help you *see* the problem first, but the change itself is out of scope here.

## Prerequisites

- Backend running (it compiles fixtures): `cd urmwebpage && python3 -m uvicorn main:app --reload`
  (health check: `GET {URM_BACKEND_URL}/function-kinds`; default `http://127.0.0.1:8000`).
- Node deps installed in `urmwebpage/frontend` (`npm install`).
- No browser needed — Vite SSR loads the real frontend modules.

## How a probe works (the fixed scaffold)

1. **Compile real fixtures.** Pull specs from the single source of truth
   `fixture_kinds.METRIC_FIXTURES` (backend), then POST each spec to `/compile-function`
   to get the URM `program`. Never hand-author programs when a fixture exists.
2. **SSR-load production modules.** `createServer({ root: FRONTEND, middlewareMode })` then
   `server.ssrLoadModule(...)`. Two entry points:
   - **Full production plan (default):** `computePrimaryLayoutPlan(program, label, {})` from
     `/src/components/BetaFlowDiagram.jsx`. Select the engine by setting
     `globalThis.window = { location: { search } }` *before* the call:
     - SketchV4 (default): `search = "?flowLayout=sketchv4"`
     - SketchV3 (legacy baseline): `search = ""`
   - **V4 pipeline internals:** `buildLayout(program, options)` from
     `/src/layout/sketchv4/pipeline.js` — use when you need pre-render stages
     (roles, ownership, lanes, orientation, routing) rather than the final plan.
3. **Read the engine's own outputs.** Reuse whatever the plan/pipeline already exposes:
   `plan.nodes`, `plan.edges`, `plan.sketchV4Active`, `plan.sketchV3FallbackUsed`, and the
   diagnostics bag (`plan.sketchV3PlacementDebug` for legacy;
   V4 pipeline stage outputs for V4).
4. **Dump evidence** to `<probe>.json` beside the probe, and print a console table.
5. **Summarize** in the standard report format (below).

## Diagnostic-only rules (hard constraints)

- **Non-mutating.** The probe writes only its own JSON artifact under the scratch dir. It
  never edits `src/`, fixtures, goldens, or committed files.
- **Reuse production functions.** Layout comes from `computePrimaryLayoutPlan` /
  `buildLayout`. Never re-derive placement or routing.
- **Prefer engine-exposed diagnostics.** Do not reimplement production layout, routing, or
  collision logic. Simple descriptive measurements from production outputs are allowed if
  clearly labeled as probe-local and not used as replacement layout logic. When a metric
  isn't exposed and can't be cheaply described this way, record it as `null` with a note.
- **Real fixtures only.** Programs come from `METRIC_FIXTURES` via the backend compiler.
- **Scratch is disposable.** Probes live in the git-untracked `.flow-layout-probes/`; they
  are evidence-gathering, not part of the product.

## SketchV4 as default target

Unless the user explicitly says "SketchV3" / "legacy" / "the old engine", target V4:
set `search = "?flowLayout=sketchv4"` and assert `plan.sketchV4Active === true`. If
`plan.sketchV3FallbackUsed` is true, V4 declined the program and fell back — report that as
a finding, don't silently measure the fallback.

## Optional SketchV3 baseline comparison

Only when a before/after or "is V4 worse than the old engine here" question is in play, run
both modes over the same compiled program and diff the exposed metrics:

```js
const MODES = [
  { key: "sketchv4", search: "?flowLayout=sketchv4" },  // primary
  { key: "sketchv3_legacy", search: "" },               // baseline, only if asked/relevant
];
```

Keep V4 first and framed as the subject; V3 is the reference line, not the goal.

## Standard report format

Report back (not as raw table dumps) with:

1. **Question** — one line restating what was probed and the target engine.
2. **Evidence** — path to the dumped JSON + the fixtures covered.
3. **Findings** — the measured facts, most significant first; cite exact numbers and which
   engine-exposed field they came from. Flag any `null`/unavailable metrics honestly, and
   label any probe-local descriptive measurement as such.
4. **Fallback/health notes** — any `sketchV3FallbackUsed`, compile failures, or backend-down
   conditions.
5. **Footer** — "Diagnostic only; no product files changed. Probe: `<path>`."

Do not recommend or apply layout code changes from within this skill; if a fix is implied,
name it as a follow-up and stop.

## Locating exports (don't hardcode line numbers)

- `computePrimaryLayoutPlan`, `buildDiagramModel`, `buildSketchV4LayoutPlan`,
  `labelPointForPolyline` are exported from `src/components/BetaFlowDiagram.jsx`
  (grep the `export {` line if a path shifts).
- `buildLayout` and stage helpers are exported from `src/layout/sketchv4/pipeline.js`;
  sibling stage modules: `roles.js`, `ownership.js`, `lanes.js`, `orientation.js`,
  `routing.js`, `ports.js`, `skeleton.js`, `halt.js`, `defects.js`, `diagnostics.js`.

## Run

```bash
cd urmwebpage/frontend
node .flow-layout-probes/<your>_probe.mjs
```

## Trigger examples

**Should trigger:**
- "Why does `divides` cross near the HALT lane in V4?"
- "Measure branch/split spacing across the fixture set."
- "Audit V4 port selection on `eq` and `divisor_count`."
- "Did V4 regress any crossings vs the old engine on the clean fixtures?" (comparison mode)
- "Dump the lane/orientation assignments V4 produces for `factorial`."

**Should NOT trigger:**
- "Tune the split spacing / add a param to compact rows." → a layout *change*, not a probe.
- "Start the app / show me the diagram in the browser." → `run-urmwebpage`.
- "Run the pytest suite" / backend compiler questions. → not layout diagnostics.
- "Explain the V4 lane-bundle model." → design knowledge, not a measurement.
- Non-layout frontend components or the URM interpreter itself.
