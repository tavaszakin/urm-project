import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildLayout } from "../../../../urmwebpage/frontend/src/layout/sketchv4/pipeline.js";
import { ENCODING_PRESETS } from "../../../../urmwebpage/frontend/src/utils/encodingPresets.js";
import { PLAYGROUND_STARTER_PROGRAMS } from "../../../../urmwebpage/frontend/src/utils/playgroundPresets.js";
import { LAYER_A_VISUAL } from "./live_production_layer_a.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const FRONTEND = path.join(ROOT, "urmwebpage/frontend");

function compileBroaderFixtures() {
  const result = spawnSync("python3", [path.join(HERE, "compile_broader_fixtures.py")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `fixture compiler exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function classifyInstruction(instruction) {
  if (String(instruction?.[0] ?? "").trim().toUpperCase() !== "J") return "action";
  return Number(instruction[1]) === Number(instruction[2]) ? "unconditional" : "conditional";
}

function canonicalGeometry(layout) {
  return JSON.stringify({
    nodes: [...layout.boxes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, box]) => [id, box.left, box.right, box.top, box.bottom, box.cx, box.cy, box.w, box.h]),
    routes: layout.routed.routes
      .slice()
      .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
      .map((route) => [route.edgeId, route.source, route.target, route.sourcePort, route.targetPort, route.points]),
    orientation: [...layout.orientationMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, orientation]) => [id, orientation.no, orientation.yes]),
  });
}

function allFinite(layout) {
  const values = [];
  for (const box of layout.boxes.values()) {
    values.push(box.left, box.right, box.top, box.bottom, box.cx, box.cy, box.w, box.h);
  }
  for (const route of layout.routed.routes) {
    for (const point of route.points) values.push(point[0], point[1]);
    for (const point of [route.sourcePort, route.targetPort]) {
      if (point) values.push(point[0], point[1]);
    }
  }
  return values.every(Number.isFinite);
}

function assertLayerA(layout, sourceProgram, label) {
  const terminalId = `i-${sourceProgram.length}`;
  assert.equal(layout.terminalId, terminalId, `${label}: terminal id`);
  assert.equal(layout.cfg.nodes.filter((node) => node.id === terminalId).length, 1, `${label}: one terminal CFG node`);
  assert.equal(layout.skeleton.placements.has(terminalId), true, `${label}: terminal placed`);
  assert.equal([...layout.skeleton.placements].filter(([id]) => id === terminalId).length, 1, `${label}: terminal placed once`);
  assert.equal(layout.boxes.get(terminalId)?.w, 88, `${label}: terminal width`);
  assert.equal(layout.boxes.get(terminalId)?.h, 30, `${label}: terminal height`);
  assert.equal(layout.cfg.nodeById.get(terminalId)?.kind, "action", `${label}: terminal kind`);
  assert.equal(layout.cfg.nodeById.has("halt"), false, `${label}: no legacy halt CFG node`);
  assert.equal(layout.boxes.has("halt"), false, `${label}: no legacy halt box`);
  assert.equal(Object.hasOwn(layout, "halt"), false, `${label}: no placeHalt result`);
  assert.equal(layout.skeleton.haltExitEdges.length, 0, `${label}: no HALT skeleton placeholder`);
  assert.equal([...layout.roles.edgeRoleById.values()].includes("halt-exit"), false, `${label}: no halt-exit role`);
  assert.equal(layout.routed.routes.some((route) => route.routeFamily === "halt" || route.edgeRole === "halt-exit"), false, `${label}: no HALT route family`);
  assert.equal([...layout.routed.ports.values()].some((port) => String(port.portPolicyCase).startsWith("halt-")), false, `${label}: no HALT port policy`);
  assert.deepEqual(layout.cfg.outgoingByIndex.get(sourceProgram.length), { yes: null, no: null, cont: null }, `${label}: terminal has no outgoing CFG edge`);
  assert.equal(layout.routed.routes.some((route) => route.source === terminalId), false, `${label}: terminal has no outgoing route`);
  assert.equal(allFinite(layout), true, `${label}: finite geometry`);

  const cfgEdgeIds = layout.cfg.edges.map((edge) => edge.id).sort();
  const routeIds = layout.routed.routes.map((route) => route.edgeId).sort();
  assert.deepEqual(routeIds, cfgEdgeIds, `${label}: every CFG edge routed`);
  assert.equal(new Set(routeIds).size, routeIds.length, `${label}: every CFG edge routed once`);
  const routeById = new Map(layout.routed.routes.map((route) => [route.edgeId, route]));
  for (const edge of layout.cfg.edges) {
    const route = routeById.get(edge.id);
    assert.equal(route?.source, edge.from, `${label}: ${edge.id} route source`);
    assert.equal(route?.target, edge.to, `${label}: ${edge.id} route target`);
  }

  const actualIncoming = layout.cfg.edges.filter((edge) => edge.to === terminalId).map((edge) => edge.id).sort();
  assert.deepEqual(actualIncoming, layout.terminalConstruction.incomingEdgeIds, `${label}: terminal incoming set`);
  for (const index of layout.terminalConstruction.redirectedExplicitJumpIndexes) {
    const role = classifyInstruction(sourceProgram[index]);
    const edgeId = role === "conditional" ? `i-${index}-yes` : `i-${index}-jump`;
    assert.equal(layout.cfg.edgeById.get(edgeId)?.to, terminalId, `${label}: explicit jump ${edgeId} redirected`);
  }
  if (sourceProgram.length === 0) {
    assert.equal(layout.cfg.edgeById.get("entry")?.to, terminalId, `${label}: empty entry reaches terminal`);
  } else {
    const finalIndex = sourceProgram.length - 1;
    const finalRole = classifyInstruction(sourceProgram[finalIndex]);
    if (finalRole === "action") {
      assert.equal(layout.cfg.edgeById.get(`i-${finalIndex}-cont`)?.to, terminalId, `${label}: final fallthrough reaches terminal`);
    } else if (finalRole === "conditional") {
      assert.equal(layout.cfg.edgeById.get(`i-${finalIndex}-no`)?.to, terminalId, `${label}: final conditional fallthrough reaches terminal`);
    }
  }
  assert.equal(layout.terminalConstruction.placeHaltCalled, false, `${label}: placeHalt dormant`);
  assert.equal(layout.terminalConstruction.candidateAndFinalRealizer, "shared-realizeUnder", `${label}: shared realizer contract`);
}

function buildAndCheck(program, label) {
  const options = { programName: label, orientationSource: "v4Assigned", visual: LAYER_A_VISUAL };
  const first = buildLayout(program, { ...options, diagnostics: true });
  assertLayerA(first, program, label);
  const repeated = buildLayout(program, { ...options, diagnostics: true });
  assert.equal(canonicalGeometry(repeated), canonicalGeometry(first), `${label}: repeated output deterministic`);
  const noDiagnostics = buildLayout(program, { ...options, diagnostics: false });
  assert.equal(canonicalGeometry(noDiagnostics), canonicalGeometry(first), `${label}: diagnostics are read-only`);
  const fixedWinner = buildLayout(program, {
    ...options,
    orientationSource: "sketchV3Selected",
    sketchV3RealForkBits: first.orientationMap,
    diagnostics: false,
  });
  assert.equal(canonicalGeometry(fixedWinner), canonicalGeometry(first), `${label}: candidate/final realizer mismatch`);
  return first;
}

async function loadAdapter() {
  const viteEntry = path.join(FRONTEND, "node_modules/vite/dist/node/index.js");
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const reactPluginEntry = path.join(FRONTEND, "node_modules/@vitejs/plugin-react/dist/index.js");
  const react = (await import(pathToFileURL(reactPluginEntry).href)).default;
  const server = await createServer({
    configFile: false,
    root: FRONTEND,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [react()],
  });
  try {
    return {
      module: await server.ssrLoadModule("/src/components/BetaFlowDiagram.jsx"),
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

function assertAdapterPlan(plan, sourceProgram, label) {
  assert.equal(plan.sketchV4Active, true, `${label}: adapter fell back from V4`);
  const terminal = plan.nodes.filter((node) => node.id === "halt");
  assert.equal(terminal.length, 1, `${label}: one display terminal`);
  assert.equal(terminal[0].label, "HALT", `${label}: display terminal label`);
  assert.equal(terminal[0].kind, "action", `${label}: ordinary display dimensions`);
  assert.equal(terminal[0].isSyntheticTerminal, true, `${label}: terminal compatibility marker`);
  assert.equal(terminal[0].sketchV4InternalNodeId, `i-${sourceProgram.length}`, `${label}: terminal identity mapping`);
  assert.equal(plan.nodes.some((node) => node.id === `i-${sourceProgram.length}`), false, `${label}: internal terminal id leaked into display nodes`);
  const displayIds = new Set(plan.nodes.map((node) => node.id));
  assert.equal(plan.edges.every((edge) => displayIds.has(edge.from) && displayIds.has(edge.to)), true, `${label}: adapter edge/node id mismatch`);
  assert.equal(plan.edges.some((edge) => edge.from === `i-${sourceProgram.length}` || edge.to === `i-${sourceProgram.length}`), false, `${label}: internal terminal id leaked into display edges`);
  assert.equal(Number.isFinite(plan.width) && Number.isFinite(plan.height) && Number.isFinite(plan.offsetX) && Number.isFinite(plan.offsetY), true, `${label}: adapter bounds finite`);
}

async function main() {
  const compilerFixtures = compileBroaderFixtures();
  assert.equal(compilerFixtures.length, 24, "maintained compiler fixture count");
  const encodingFixtures = ENCODING_PRESETS
    .filter((preset) => preset.id !== "template" && preset.program.length > 0)
    .map((preset) => ({ label: `encoding:${preset.id}`, program: preset.program }));
  const playgroundFixtures = PLAYGROUND_STARTER_PROGRAMS
    .map((preset) => ({ label: `playground:${preset.id}`, program: preset.program }));
  const edgeCases = [
    { label: "structural:invalid-conditional-jump", program: [["J", 0, 1, 99]] },
    { label: "structural:invalid-unconditional-jump", program: [["J", 0, 0, -1]] },
  ];
  const fixtures = [...compilerFixtures, ...encodingFixtures, ...playgroundFixtures, ...edgeCases];

  const layouts = fixtures.map(({ program, label }) => ({ label, program, layout: buildAndCheck(program, label) }));

  const adapter = await loadAdapter();
  globalThis.__sketchV4Requested = true;
  try {
    for (const { label, program } of fixtures) {
      const plan = adapter.module.computePrimaryLayoutPlan(program, label, { selectedExampleName: label });
      assertAdapterPlan(plan, program, label);
    }
  } finally {
    delete globalThis.__sketchV4Requested;
    await adapter.close();
  }

  const maxInstructions = Math.max(...layouts.map(({ program }) => program.length));
  console.log(JSON.stringify({
    status: "PASS",
    compilerFixtures: compilerFixtures.length,
    encodingFixtures: encodingFixtures.length,
    playgroundFixtures: playgroundFixtures.length,
    structuralEdgeCases: edgeCases.length,
    totalPrograms: fixtures.length,
    maxInstructions,
    assertions: [
      "finite coordinates",
      "each CFG edge routed exactly once",
      "one ordinary synthetic terminal",
      "no legacy HALT layout path",
      "deterministic repeated output",
      "diagnostics read-only",
      "shared candidate/final Layer-A realizer",
      "adapter terminal identity translation",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
