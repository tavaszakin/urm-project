import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
} from "./current_harness.mjs";
import { classifyViewIntrusionsBySegmentPhase, segmentPhase } from "./segment_phase_intrusion_ownership.mjs";

const DEFAULT = Object.freeze({ no: "left", yes: "right" });
const FLIPPED = Object.freeze({ no: "right", yes: "left" });
const PHASE_COLORS = {
  departure: "#2563eb",
  body: "#7c3aed",
  arrival: "#059669",
  direct: "#d97706",
};
const CASES = [
  {
    id: "bounded-i22-d",
    group: "bounded_sub i-22",
    title: "A1 · bounded_sub i-22 default · valid departure signal",
    fixture: "minimization:bounded_sub",
    focusFork: "i-22",
    candidate: "D",
    edgeId: "i-24-jump",
    nodeIds: ["i-26"],
    note: "The intrusion lies on segment 0: departure path i-22/no versus node i-22/yes.",
  },
  {
    id: "bounded-i22-f",
    group: "bounded_sub i-22",
    title: "A2 · bounded_sub i-22 flipped · intrusion absent",
    fixture: "minimization:bounded_sub",
    focusFork: "i-22",
    candidate: "F",
    edgeId: "i-24-jump",
    nodeIds: ["i-26"],
    note: "The same edge and node are highlighted; no segment intersects i-26.",
  },
  {
    id: "divides-i53-d",
    group: "divides i-53",
    title: "B · divides i-53 default · whole-edge departure failure",
    fixture: "characteristic:divides",
    focusFork: "i-53",
    candidate: "D",
    edgeId: "i-53-yes",
    nodeIds: ["i-54"],
    note: "The intrusion is on segment 2 (arrival), not the semantic departure segment.",
  },
  {
    id: "eq-i9-body",
    group: "new body counterexample",
    title: "C · eq i-9 flipped · compelling conflict stranded in body",
    fixture: "characteristic:eq",
    focusFork: "i-9",
    candidate: "F",
    edgeId: "i-16-jump",
    nodeIds: ["i-23", "i-24", "i-25", "i-26"],
    note: "Both endpoints remain in i-9/no while the body rail crosses four i-9/yes nodes; the phase rule deliberately leaves all four unowned.",
  },
  {
    id: "divides-i3-arrival",
    group: "new arrival counterexample",
    title: "D · divides i-3 flipped · arrival label spans a branch transition",
    fixture: "characteristic:divides",
    focusFork: "i-3",
    candidate: "F",
    edgeId: "i-53-yes",
    nodeIds: ["i-54"],
    note: "Target ancestry calls the whole final segment i-3/no even where it intersects source-side node i-54 in i-3/yes.",
  },
];

const round = (value) => Math.round(value * 1000) / 1000;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);
const pathText = (path) => path == null ? "none" : `[${path.join(",")}]`;

function instructionLabel(view, node) {
  if (node.id === "start") return "START";
  if (node.id === view.terminalId) return `HALT (${node.id})`;
  const instruction = view.program[node.instructionIndex];
  return Array.isArray(instruction)
    ? `${node.instructionIndex}: ${instruction[0]}(${instruction.slice(1).join(",")})`
    : node.id;
}

function buildRequestedCandidates(program, fixture, requested) {
  const raw = buildRawRoleOrdinaryTerminalBase(program, fixture);
  const { realizeEndpoints } = buildComposedLoopEndpointRealizer(raw);
  const orientationMap = new Map(raw.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const results = new Map();
  for (const focusFork of raw.tree.bottomUp) {
    orientationMap.set(focusFork, { ...DEFAULT });
    const defaultView = realizeEndpoints(orientationMap);
    orientationMap.set(focusFork, { ...FLIPPED });
    const flippedView = realizeEndpoints(orientationMap);
    if (requested.has(`${focusFork}:D`)) results.set(`${focusFork}:D`, defaultView);
    if (requested.has(`${focusFork}:F`)) results.set(`${focusFork}:F`, flippedView);
    const chooseFlipped = flippedView.defects.total < defaultView.defects.total;
    orientationMap.set(focusFork, { ...(chooseFlipped ? FLIPPED : DEFAULT) });
  }
  return results;
}

function boundsFor(view, route, nodeIds) {
  const points = [...route.points];
  for (const nodeId of [route.source, route.target, ...nodeIds]) {
    const box = view.boxes.get(nodeId);
    if (!box) continue;
    points.push([box.left, box.top], [box.right, box.bottom]);
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const padding = 72;
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function segmentLabelPoint(start, end, phase) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const phaseOffsetY = phase === "body" ? 15 : phase === "arrival" ? -10 : 0;
  return [
    (start[0] + end[0]) / 2 - (dy / length) * 14,
    (start[1] + end[1]) / 2 + (dx / length) * 14 + phaseOffsetY,
  ];
}

function svgFor(view, route, events, spec, scale) {
  const bounds = boundsFor(view, route, spec.nodeIds);
  const markerId = `phase-arrow-${spec.id}`;
  let body = `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#172033"/></marker></defs>`;

  for (const backgroundRoute of view.routed.routes) {
    const points = backgroundRoute.points.map((point) => `${round(point[0])},${round(point[1])}`).join(" ");
    body += `<polyline points="${points}" fill="none" stroke="#cbd5e1" stroke-width="1.2" opacity="0.68"/>`;
  }

  for (const node of view.cfg.nodes) {
    const box = view.boxes.get(node.id);
    if (!box) continue;
    const selected = spec.nodeIds.includes(node.id);
    const endpoint = node.id === route.source || node.id === route.target;
    const focus = node.id === spec.focusFork;
    const fill = selected ? "#fff7ed" : focus ? "#ecfeff" : "#fff";
    const stroke = selected ? "#ea580c" : focus ? "#0891b2" : endpoint ? "#475569" : "#94a3b8";
    const strokeWidth = selected || focus ? 3 : endpoint ? 2 : 1;
    if (node.kind === "conditionalJump") {
      body += `<polygon points="${box.cx},${box.top} ${box.right},${box.cy} ${box.cx},${box.bottom} ${box.left},${box.cy}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    } else {
      body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
    body += `<text class="node-label" x="${box.cx}" y="${box.cy}">${escapeHtml(instructionLabel(view, node))}</text>`;
  }

  const routeSegmentCount = route.points.length - 1;
  for (let segmentIndex = 0; segmentIndex < routeSegmentCount; segmentIndex += 1) {
    const start = route.points[segmentIndex];
    const end = route.points[segmentIndex + 1];
    const phase = segmentPhase(segmentIndex, routeSegmentCount);
    const color = PHASE_COLORS[phase];
    const [labelX, labelY] = segmentLabelPoint(start, end, phase);
    body += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-width="7" stroke-linecap="round"${phase === "body" ? ' stroke-dasharray="12 7"' : ""}${segmentIndex === routeSegmentCount - 1 ? ` marker-end="url(#${markerId})"` : ""}/>`;
    body += `<text class="phase-label" x="${round(labelX)}" y="${round(labelY)}" fill="${color}" text-anchor="middle">segment ${segmentIndex} · ${phase}</text>`;
  }

  for (const event of events) {
    const box = view.boxes.get(event.nodeId);
    const [intervalStart, intervalEnd] = event.intersectionInterval;
    const midpoint = [(intervalStart[0] + intervalEnd[0]) / 2, (intervalStart[1] + intervalEnd[1]) / 2];
    body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="#f97316" fill-opacity="0.16" stroke="#ea580c" stroke-width="3" stroke-dasharray="6 3"/>`;
    body += `<line x1="${intervalStart[0]}" y1="${intervalStart[1]}" x2="${intervalEnd[0]}" y2="${intervalEnd[1]}" stroke="#dc2626" stroke-width="9"/>`;
    body += `<circle cx="${midpoint[0]}" cy="${midpoint[1]}" r="6" fill="#fff" stroke="#991b1b" stroke-width="3"/>`;
  }

  const pixelWidth = Math.max(500, bounds.width * scale);
  const pixelHeight = Math.max(300, bounds.height * scale);
  return `<svg viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${Math.ceil(pixelWidth)}" height="${Math.ceil(pixelHeight)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function metadataFor(events, spec, route) {
  if (events.length === 0) {
    return `<dl><dt>edge</dt><dd>${escapeHtml(spec.edgeId)} · ${route.points.length - 1} segments</dd>`
      + `<dt>node</dt><dd>${escapeHtml(spec.nodeIds.join(", "))}</dd>`
      + "<dt>intrusion</dt><dd class=\"good\">absent</dd></dl>";
  }
  const first = events[0];
  const nodePaths = [...new Set(events.map((event) => pathText(event.nodeBranchPath)))];
  return `<dl><dt>edge × node</dt><dd>${escapeHtml(`${spec.edgeId} × ${events.map((event) => event.nodeId).join(", ")}`)}</dd>`
    + `<dt>intruding phase</dt><dd><span class="phase-chip ${first.phase}">${escapeHtml(first.phase)}</span> · segment ${first.segmentIndex}/${first.routeSegmentCount}</dd>`
    + `<dt>source path</dt><dd><code>${escapeHtml(pathText(first.sourceBranchPath))}</code></dd>`
    + `<dt>semantic token</dt><dd><code>${escapeHtml(first.semanticDepartureToken ?? "none")}</code></dd>`
    + `<dt>departure path</dt><dd><code>${escapeHtml(pathText(first.departurePath))}</code></dd>`
    + `<dt>arrival path</dt><dd><code>${escapeHtml(pathText(first.arrivalPath))}</code></dd>`
    + `<dt>phase path</dt><dd><code>${escapeHtml(pathText(first.phasePath))}</code></dd>`
    + `<dt>node path${nodePaths.length > 1 ? "s" : ""}</dt><dd><code>${escapeHtml(nodePaths.join(" · "))}</code></dd>`
    + `<dt>old whole-edge result</dt><dd>${escapeHtml(first.departurePathClassification)}</dd>`
    + `<dt>phase-local result</dt><dd>${escapeHtml(first.phaseClassification)}</dd></dl>`;
}

function cardFor(view, spec, scale) {
  const route = view.routed.routes.find((row) => row.edgeId === spec.edgeId);
  if (!route) throw new Error(`${spec.id}: missing ${spec.edgeId}`);
  const intrusions = classifyViewIntrusionsBySegmentPhase(
    view,
    spec.focusFork,
    { fixture: spec.fixture, candidate: spec.candidate },
    { scanAllForks: true },
  );
  const events = intrusions.filter((row) => row.edgeId === spec.edgeId && spec.nodeIds.includes(row.nodeId));
  const article = document.createElement("article");
  article.id = spec.id;
  article.innerHTML = `<h2>${escapeHtml(spec.title)}</h2>`
    + `<p class="case-note">${escapeHtml(spec.note)}</p>`
    + `<div class="legend"><span class="departure">departure</span><span class="body">body</span><span class="arrival">arrival</span><span class="intrusion">intrusion</span></div>`
    + metadataFor(events, spec, route)
    + `<div class="canvas">${svgFor(view, route, events, spec, scale)}</div>`
    + `<details><summary>Exact event diagnostics</summary><pre>${escapeHtml(JSON.stringify(events, null, 2))}</pre></details>`;
  return { article, eventCount: events.length };
}

async function startViewer() {
  const status = document.querySelector("#status");
  const viewsNode = document.querySelector("#views");
  const scaleInput = document.querySelector("#scale");
  const scaleValue = document.querySelector("#scale-value");
  const programs = await fetch(new URL("../.sketchv3-harness/programs.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`fixture load failed: ${response.status}`);
    return response.json();
  });
  const requestedByFixture = new Map();
  for (const spec of CASES) {
    if (!requestedByFixture.has(spec.fixture)) requestedByFixture.set(spec.fixture, new Set());
    requestedByFixture.get(spec.fixture).add(`${spec.focusFork}:${spec.candidate}`);
  }
  const views = new Map();
  const started = performance.now();
  for (const [fixture, requested] of requestedByFixture) {
    const fixtureViews = buildRequestedCandidates(programs[fixture], fixture, requested);
    for (const [key, view] of fixtureViews) views.set(`${fixture}:${key}`, view);
  }
  const buildMs = performance.now() - started;

  const draw = () => {
    const scale = Number(scaleInput.value);
    scaleValue.textContent = `${scale.toFixed(2)}×`;
    const cards = CASES.map((spec) => cardFor(
      views.get(`${spec.fixture}:${spec.focusFork}:${spec.candidate}`),
      spec,
      scale,
    ));
    viewsNode.replaceChildren(...cards.map((card) => card.article));
    for (const spec of CASES.filter((row) => row.id.startsWith("bounded-i22"))) {
      const canvas = document.querySelector(`#${spec.id} .canvas`);
      canvas.scrollTop = canvas.scrollHeight;
    }
    window.__SKETCHV4_SEGMENT_PHASE_VISUAL_STATE__ = {
      cardCount: cards.length,
      buildMs,
      eventCounts: Object.fromEntries(CASES.map((spec, index) => [spec.id, cards[index].eventCount])),
      scoringExperimentRun: false,
    };
  };
  scaleInput.addEventListener("input", draw);
  draw();
  status.textContent = `${CASES.length} isolated phase-inspection cards · ${buildMs.toFixed(1)} ms candidate construction · no orientation scoring.`;
}

startViewer().catch((error) => {
  const status = document.querySelector("#status");
  status.className = "error";
  status.textContent = error?.stack ?? String(error);
});
