// Production page/CFG/rendering checks and an offline comparison artifact.
// No layout overrides, pins, alternate renderers, or public comparison route.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOrdinaryTerminalCfg } from "../src/layout/sketchv4/cfg.js";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "urm-second-smallest"));
const kinds = [3, 4, 5, 6].map((k) => `second_smallest_${k}`);
const specs = [...kinds.map((kind) => ({ kind })), { kind: "characteristic", relation: "divides" }];
const programs = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from compiler import FunctionSpec, compile_function_to_program
print(json.dumps([compile_function_to_program(FunctionSpec(**s)) for s in json.load(sys.stdin)]))
`], { cwd: path.resolve(frontend, ".."), input: JSON.stringify(specs), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));

// Enumerate each elementary directed cycle once, rooted at its least-ordered
// node. This counts cycles on the builder's actual edges, not DFS back edges,
// loop-return lanes, or the graph's cyclomatic rank.
function simpleCycleCount(cfg) {
  const rank = new Map(cfg.nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map(cfg.nodes.map((node) => [node.id, new Set()]));
  for (const edge of cfg.edges) outgoing.get(edge.from).add(edge.to);
  let count = 0;
  for (const start of rank.keys()) {
    const visited = new Set([start]);
    const walk = (node) => {
      for (const target of outgoing.get(node)) {
        if (target === start) count += 1;
        else if (rank.get(target) > rank.get(start) && !visited.has(target)) {
          visited.add(target);
          walk(target);
          visited.delete(target);
        }
      }
    };
    walk(start);
  }
  return count;
}

const server = await createServer({ root: frontend, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
try {
  const { default: Diagram, computePrimaryLayoutPlan } = await server.ssrLoadModule("/src/components/BetaFlowDiagram.jsx");
  const { default: Compute } = await server.ssrLoadModule("/src/pages/ComputePage.jsx");
  const { default: Flow } = await server.ssrLoadModule("/src/pages/FlowDiagramBetaPage.jsx");
  const { default: Runner } = await server.ssrLoadModule("/src/components/FunctionRunner.jsx");
  const { getFunctionMetadata, FUNCTION_ORDER } = await server.ssrLoadModule("/src/functionMetadata.js");
  const { normalizeFunctionSpec, validateFunctionSpec } = await server.ssrLoadModule("/src/components/FunctionSpecBuilder.jsx");
  const { buildFunctionExpressionNode } = await server.ssrLoadModule("/src/components/FunctionExpressionView.jsx");
  const { default: Definition } = await server.ssrLoadModule("/src/components/FunctionDefinitionPreview.jsx");
  for (const Page of [Compute, Flow]) {
    const html = renderToStaticMarkup(React.createElement(Page));
    for (const kind of kinds) {
      assert(html.includes(`<option value="${kind}">`), `${Page.name} missing ${kind}`);
    }
  }

  const rows = [];
  const cards = [];
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const program = programs[index];
    const id = spec.relation ? `${spec.kind}:${spec.relation}` : spec.kind;
    const metadata = getFunctionMetadata(spec.kind);
    const cfg = buildOrdinaryTerminalCfg(program).cfg;
    const cycles = simpleCycleCount(cfg);
    const plan = computePrimaryLayoutPlan(program, spec.kind);
    assert.equal(plan.layoutMode, "sketchV4", `${id} must use the default V4 engine`);
    assert.equal(plan.nodes.length, program.length + 2); // START + ordinary synthetic HALT
    assert(plan.width > 0 && plan.height > 0);
    assert(plan.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert(plan.edges.every((edge) => edge.points.every((point) => point.every(Number.isFinite))));
    if (index < 4) {
      const k = index + 3;
      assert(FUNCTION_ORDER.includes(id));
      assert.equal(validateFunctionSpec(spec), "");
      assert.deepEqual(normalizeFunctionSpec(spec), spec);
      assert.equal(program.length, k * k + 2 * k + 4);
      assert.equal(metadata.arity, k);
      assert.equal(metadata.defaultInputs.length, k);
      assert.equal(buildFunctionExpressionNode(spec).args.length, k);
      const definition = renderToStaticMarkup(React.createElement(Definition, { functionSpec: spec }));
      assert(definition.includes(`operatorname{${metadata.notation.replaceAll("_", "\\_")}}`));
      const runner = renderToStaticMarkup(React.createElement(Runner, {
        fixedFunctionSpec: spec, initialInputs: metadata.defaultInputs,
      }));
      assert.equal((runner.match(/class="[^"]*runner-variable-input/g) ?? []).length, k);
      assert.equal(cycles, k + 1);
      assert.equal(cfg.nodes.filter((node) => node.kind === "conditionalJump").length, k * k);
    }
    const svg = renderToStaticMarkup(React.createElement(Diagram, { program, selectedFunctionId: spec.kind }))
      .match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
    assert(svg, `${id}: production renderer must emit an SVG`);
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
    const row = {
      id, instructionNodes: program.length,
      conditionalJumps: cfg.nodes.filter((node) => node.kind === "conditionalJump").length,
      simpleDirectedCycles: cycles, width: plan.width, height: plan.height,
      svgViewBoxWidth: viewBox[2], svgViewBoxHeight: viewBox[3],
      layoutMode: plan.layoutMode, failures: [],
      diagnostics: plan.sketchV4PlacementDebug.sketchV4Summary,
    };
    rows.push(row);
    // Unique SVG marker IDs when the five independent production renders are
    // embedded together. Only the document IDs change; geometry is untouched.
    const embedded = svg.replaceAll("beta-flow-arrow-", `comparison-${index}-`);
    cards.push(`<article><h2>${index < 4 ? metadata.display : id}</h2>
      <p>${row.instructionNodes} instructions · ${row.conditionalJumps} conditionals · ${cycles} cycles<br>
      ${Math.round(row.width)} × ${Math.round(row.height)} layout units</p>
      <div class="canvas">${embedded}</div>
      <details><summary>Diagnostics</summary><pre>${JSON.stringify(row, null, 2)}</pre></details></article>`);
  }
  const css = await fs.readFile(path.join(frontend, "src/index.css"), "utf8");
  const diagramCss = css.slice(css.indexOf(".beta-flow-svg {"), css.indexOf(".encoding-workspace {"));
  const html = `<!doctype html><html lang="en" data-theme="light"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Second-smallest — production SketchV4 comparison</title>
    <style>${diagramCss}
    :root{--compute-text:#171717;--compute-secondary:#555;--compute-surface:#fff;--compute-surface-alt:#fafafa;--font-ui:Georgia,serif;--font-mono:monospace}
    body{font:15px Georgia,serif;margin:24px;background:#f8f8f8;color:#171717}h1{font-size:24px}h2{font-size:18px}p{line-height:1.5}
    main{display:grid;grid-template-columns:repeat(5,minmax(240px,1fr));gap:16px}article{padding:12px;background:white;border:1px solid #ddd;min-width:0}
    .canvas{height:600px;overflow:auto}.canvas svg{width:100%!important;height:auto!important}.math-text{font-size:10px}
    .beta-flow-node-title-math .math-text{font-size:8px}pre{white-space:pre-wrap;font:11px monospace}
    body.readable main{display:block}body.readable article{margin:20px 0}body.readable .canvas{height:auto;overflow:auto}
    body.readable .canvas svg{width:1400px!important;height:auto!important}button{font:inherit;padding:6px 12px;margin:0 0 16px;cursor:pointer}
    @media(max-width:900px){main{grid-template-columns:repeat(2,minmax(240px,1fr))}}
    </style><h1>Second-smallest family — production SketchV4</h1>
    <p>Unmodified production CFG, orientation, routes, adapter and SVG renderer. START and synthetic HALT are excluded from instruction counts.
    Offline snapshot; labels use the renderer's plain-text fallback. Diagnostics record existing geometry defects without changing the layout.</p>
    <button onclick="document.body.classList.toggle('readable')">Toggle large diagrams</button>
    <main>${cards.join("\n")}</main></html>`;
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "index.html"), html);
  await fs.writeFile(path.join(output, "metrics.json"), JSON.stringify(rows, null, 2) + "\n");
  console.table(rows.map(({ id, instructionNodes, conditionalJumps, simpleDirectedCycles, width, height, diagnostics }) => ({
    id, instructionNodes, conditionalJumps, simpleDirectedCycles,
    width: Math.round(width), height: Math.round(height),
    crossings: diagnostics.crossingCount, nodeOverlaps: diagnostics.nodeOverlapCount,
    illegalAttachmentEndpoints: diagnostics.illegalLocalAttachmentEndpointCount,
  })));
  console.log(`Production page/arity/CFG/layout/render checks passed. Comparison: ${path.join(output, "index.html")}`);
} finally {
  await server.close();
}
