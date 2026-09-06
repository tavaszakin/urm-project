// Flow-layout diagnostic probe (non-mutating). Copy into
//   urmwebpage/frontend/.flow-layout-probes/<question>_probe.mjs
// and edit TARGET_LABELS + the per-fixture `measure()` body.
//
// Rules (see SKILL.md): reuse production layout functions, prefer engine-exposed
// diagnostics, do not reimplement production layout/routing/collision logic,
// compile real fixtures via the backend, dump JSON + a table.
//
// Run from urmwebpage/frontend:  node .flow-layout-probes/<question>_probe.mjs
// Requires the backend up (URM_BACKEND_URL, default http://127.0.0.1:8000).

import { createServer } from "vite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(here, "..");          // urmwebpage/frontend
const BACKEND_DIR = path.join(here, "..", "..");  // urmwebpage
const BACKEND_URL = process.env.URM_BACKEND_URL ?? "http://127.0.0.1:8000";
const ARTIFACT = path.join(here, path.basename(fileURLToPath(import.meta.url)).replace(/\.mjs$/, ".json"));

// --- EDIT ME: which fixtures to probe (labels must exist in METRIC_FIXTURES) ---
const TARGET_LABELS = ["characteristic:divides", "characteristic:eq"];

// --- EDIT ME: engine target. V4 is default; add the V3 baseline only if asked. ---
const MODES = [
  { key: "sketchv4", search: "?flowLayout=sketchv4" },
  // { key: "sketchv3_legacy", search: "" },  // uncomment for legacy comparison
];

function loadFixtureSpecs() {
  const json = execFileSync(
    "python3",
    ["-c", "import json,fixture_kinds; print(json.dumps([{'label':f['label'],'spec':f['spec']} for f in fixture_kinds.METRIC_FIXTURES]))"],
    { cwd: BACKEND_DIR, encoding: "utf8" },
  );
  return new Map(JSON.parse(json).map((f) => [f.label, f.spec]));
}

async function backendReachable() {
  try { return (await fetch(`${BACKEND_URL}/function-kinds`)).ok; } catch { return false; }
}

async function compile(spec) {
  const r = await fetch(`${BACKEND_URL}/compile-function`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec),
  });
  if (!r.ok) return { ok: false, program: null, error: `HTTP ${r.status}` };
  return { ok: true, program: (await r.json()).program, error: null };
}

// --- EDIT ME: prefer engine-exposed fields. Simple descriptive measurements from
// production outputs are OK if labeled probe-local; never reimplement production
// layout/routing/collision logic. Unavailable metric -> null + note. ---
function measure(plan) {
  return {
    sketchV4Active: plan.sketchV4Active ?? false,
    fallbackUsed: plan.sketchV3FallbackUsed ?? false,
    node_count: plan.nodes?.length ?? null,
    edge_count: (plan.edges ?? []).filter((e) => Array.isArray(e.points) && e.points.length >= 2).length,
    // Example of honestly-unavailable metric (no engine diagnostic exposes it here):
    detected_overlaps: null, // UNAVAILABLE: not reimplementing production collision logic
  };
}

async function main() {
  if (!(await backendReachable())) {
    console.error(`Backend required at ${BACKEND_URL} (compiles fixtures). Start uvicorn and retry.`);
    process.exit(1);
  }
  const specByLabel = loadFixtureSpecs();
  const missing = TARGET_LABELS.filter((l) => !specByLabel.has(l));
  if (missing.length) console.warn("Labels absent from METRIC_FIXTURES:", missing);

  const compiled = {};
  for (const label of TARGET_LABELS) {
    const spec = specByLabel.get(label);
    compiled[label] = spec ? await compile(spec) : { ok: false, program: null, error: "spec-not-found" };
  }

  const server = await createServer({ root: FRONTEND, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  const rows = [];
  try {
    const mod = await server.ssrLoadModule("/src/components/BetaFlowDiagram.jsx");
    for (const label of TARGET_LABELS) {
      const c = compiled[label];
      for (const mode of MODES) {
        if (!c.ok) { rows.push({ label, mode: mode.key, ok: false, note: `compile failed: ${c.error}` }); continue; }
        globalThis.window = { location: { search: mode.search } };
        const ow = console.warn; console.warn = () => {};
        let plan = null, err = null;
        try { plan = mod.computePrimaryLayoutPlan(c.program, label, {}); }
        catch (e) { err = e; } finally { console.warn = ow; }
        if (err) { rows.push({ label, mode: mode.key, ok: false, note: `layout threw: ${String(err).slice(0, 140)}` }); continue; }
        rows.push({ label, mode: mode.key, ok: true, ...measure(plan) });
      }
    }
  } finally {
    await server.close();
  }

  fs.writeFileSync(ARTIFACT, JSON.stringify(rows, null, 2));
  console.table(rows);
  console.log(`\nEvidence: ${ARTIFACT}`);
}

main();
