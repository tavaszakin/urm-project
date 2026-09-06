import { unrelatedNodeEdgeIntersections } from "./current_harness.mjs";
import { classifyEndpointTransitionAtFork, classifyEndpointTransitionIntrusions } from "./endpoint_transition_intrusion_ownership.mjs";
import { runLocalOrientationSweep } from "./endpoint_transition_intrusion_scoring.mjs";

const PHASE_COLORS = { departure: "#2563eb", body: "#7c3aed", arrival: "#059669", direct: "#d97706" };
const round = (value) => Math.round(value * 1000) / 1000;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
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

function boundsFor(view, spec) {
  if (spec.fullView) {
    const padding = 42;
    return {
      minX: view.renderBounds.minX - padding,
      minY: view.renderBounds.minY - padding,
      width: view.renderBounds.width + padding * 2,
      height: view.renderBounds.height + padding * 2,
    };
  }
  const points = [];
  for (const edgeId of spec.edgeIds) {
    const route = view.routed.routes.find((row) => row.edgeId === edgeId);
    if (route) points.push(...route.points);
  }
  for (const nodeId of spec.nodeIds) {
    const box = view.boxes.get(nodeId);
    if (box) points.push([box.left, box.top], [box.right, box.bottom]);
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const padding = 72;
  return {
    minX: Math.min(...xs) - padding,
    minY: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2,
  };
}

function transitionForSegment(view, route, spec, segmentIndex) {
  const edge = view.cfg.edgeById.get(route.edgeId);
  return classifyEndpointTransitionAtFork({
    view,
    edge,
    sourcePath: view.ownership.branchPath(route.source),
    targetPath: view.ownership.branchPath(route.target),
    nodePath: view.ownership.branchPath(spec.nodeIds[0]),
    segmentIndex,
    routeSegmentCount: route.points.length - 1,
    focusFork: spec.focusFork,
  });
}

function labelPoint(start, end, phase) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const extra = phase === "body" ? 15 : phase === "arrival" ? -10 : 0;
  return [
    (start[0] + end[0]) / 2 - (dy / length) * 15,
    (start[1] + end[1]) / 2 + (dx / length) * 15 + extra,
  ];
}

function svgFor(view, events, spec, scale) {
  const bounds = boundsFor(view, spec);
  const highlightedEdges = new Set(spec.edgeIds);
  let body = "";
  for (const route of view.routed.routes) {
    const points = route.points.map((point) => `${round(point[0])},${round(point[1])}`).join(" ");
    body += `<polyline points="${points}" fill="none" stroke="#cbd5e1" stroke-width="1.2" opacity="0.65"/>`;
  }
  for (const node of view.cfg.nodes) {
    const box = view.boxes.get(node.id);
    if (!box) continue;
    const selected = spec.nodeIds.includes(node.id);
    const focus = node.id === spec.focusFork;
    const fill = selected ? "#fff7ed" : focus ? "#ecfeff" : "#fff";
    const stroke = selected ? "#ea580c" : focus ? "#0891b2" : "#94a3b8";
    const strokeWidth = selected || focus ? 3 : 1;
    if (node.kind === "conditionalJump") {
      body += `<polygon points="${box.cx},${box.top} ${box.right},${box.cy} ${box.cx},${box.bottom} ${box.left},${box.cy}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    } else {
      body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
    body += `<text class="node-label" x="${box.cx}" y="${box.cy}">${escapeHtml(instructionLabel(view, node))}</text>`;
  }
  for (const edgeId of highlightedEdges) {
    const route = view.routed.routes.find((row) => row.edgeId === edgeId);
    if (!route) continue;
    for (let segmentIndex = 0; segmentIndex < route.points.length - 1; segmentIndex += 1) {
      const start = route.points[segmentIndex];
      const end = route.points[segmentIndex + 1];
      if (!spec.phaseOverlay) {
        const color = edgeId === spec.edgeIds[0] ? "#0f766e" : "#be185d";
        body += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
        continue;
      }
      const transition = transitionForSegment(view, route, spec, segmentIndex);
      const color = PHASE_COLORS[transition.phase];
      const [x, y] = labelPoint(start, end, transition.phase);
      const ownership = transition.segmentSide == null ? "unowned/withheld" : `${transition.segmentSide}-owned`;
      body += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${color}" stroke-width="7" stroke-linecap="round"${transition.segmentSide == null ? ' stroke-dasharray="12 7" opacity="0.68"' : ""}/>`;
      body += `<text class="segment-label" x="${round(x)}" y="${round(y)}" fill="${color}" text-anchor="middle">${transition.phase} · ${ownership}</text>`;
    }
  }
  for (const event of events) {
    const box = view.boxes.get(event.nodeId);
    const [start, end] = event.intersectionInterval;
    const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="#f97316" fill-opacity="0.17" stroke="#ea580c" stroke-width="3" stroke-dasharray="6 3"/>`;
    body += `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#dc2626" stroke-width="9"/>`;
    body += `<circle cx="${midpoint[0]}" cy="${midpoint[1]}" r="6" fill="#fff" stroke="#991b1b" stroke-width="3"/>`;
  }
  const pixelWidth = Math.max(520, bounds.width * scale);
  const pixelHeight = Math.max(320, bounds.height * scale);
  return `<svg viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${Math.ceil(pixelWidth)}" height="${Math.ceil(pixelHeight)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function scoreText(metrics) {
  return `${metrics.nodeOverlaps} + ${metrics.properCrossings} + ${metrics.ownedIntrusionCount} = ${metrics.total}`;
}

function metadataFor(spec, events) {
  const row = spec.scoreRow;
  const representative = events[0];
  const lines = [
    ["focus / decision", `${spec.focusFork} / ${spec.decision}`],
    ["D score (N+C+owned)", scoreText(row.default)],
    ["F score (N+C+owned)", scoreText(row.flipped)],
    ["raw provisional D/F", `${row.default.rawIntrusionCount ?? "—"} / ${row.flipped.rawIntrusionCount ?? "—"}`],
    ["owned provisional D/F", `${row.default.ownedIntrusionCount ?? "—"} / ${row.flipped.ownedIntrusionCount ?? "—"}`],
    ...spec.metadata,
  ];
  if (representative) lines.push(
    ["intruding segment", `${representative.phase} · ${representative.segmentIndex}/${representative.routeSegmentCount}`],
    ["transition / side", `${representative.transition} / ${representative.segmentSide}`],
    ["departure path", pathText(representative.departurePath)],
    ["target path", pathText(representative.targetPath)],
    ["node path", pathText(representative.nodePath)],
  );
  return `<dl>${lines.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function cardFor(spec, scale) {
  const rawIntrusions = unrelatedNodeEdgeIntersections(spec.view.routed.routes, spec.view.boxes);
  const classified = classifyEndpointTransitionIntrusions(spec.view, spec.focusFork, rawIntrusions, {
    fixture: spec.fixture,
    candidate: spec.candidate,
  });
  const events = classified.filter((row) => spec.eventPairs.some(([edgeId, nodeId]) =>
    row.edgeId === edgeId && row.nodeId === nodeId));
  const article = document.createElement("article");
  article.id = spec.id;
  article.innerHTML = `<h2>${escapeHtml(spec.title)}</h2>`
    + `<p class="case-note">${escapeHtml(spec.note)}</p>`
    + `<div class="legend"><span class="departure">departure</span><span class="body">body</span><span class="arrival">arrival</span><span class="intrusion">intrusion</span><span class="selected">selected result</span></div>`
    + metadataFor(spec, events)
    + `<div class="canvas">${svgFor(spec.view, events, spec, scale)}</div>`
    + `<details><summary>Exact score and event diagnostics</summary><pre>${escapeHtml(JSON.stringify({ score: spec.scoreRow, events }, null, 2))}</pre></details>`;
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
  const buildStarted = performance.now();
  const boundedControl = runLocalOrientationSweep(programs["minimization:bounded_sub"], "minimization:bounded_sub", { ownedIntrusionScoring: false });
  const boundedExperimental = runLocalOrientationSweep(programs["minimization:bounded_sub"], "minimization:bounded_sub", { ownedIntrusionScoring: true });
  const dividesExperimental = runLocalOrientationSweep(programs["characteristic:divides"], "characteristic:divides", { ownedIntrusionScoring: true });
  const eqExperimental = runLocalOrientationSweep(programs["characteristic:eq"], "characteristic:eq", {
    ownedIntrusionScoring: true,
    captureCandidates: ["i-9:F", "i-14:F"],
  });
  const buildMs = performance.now() - buildStarted;
  const findRow = (run, focusFork) => run.candidates.find((row) => row.focusFork === focusFork);
  const specs = [
    {
      id: "bounded-checkpoint", title: "1 · bounded_sub checkpoint · i-22 default", fixture: "minimization:bounded_sub",
      focusFork: "i-22", candidate: "D final", decision: "D (checkpoint)", view: boundedControl.finalView,
      scoreRow: findRow(boundedExperimental, "i-22"), edgeIds: ["i-24-jump"], nodeIds: ["i-26"],
      eventPairs: [["i-24-jump", "i-26"]], phaseOverlay: true,
      note: "The departure-owned loop segment passes through i-26. The frozen local score sees D/F = 1/0.",
      metadata: [["phase / transition", "departure / NO → OUTSIDE"], ["owner", "i-22 / NO"]],
    },
    {
      id: "bounded-experimental", title: "2 · bounded_sub experiment · i-22 flipped", fixture: "minimization:bounded_sub",
      focusFork: "i-22", candidate: "F final", decision: "F (experimental)", view: boundedExperimental.finalView,
      scoreRow: findRow(boundedExperimental, "i-22"), edgeIds: ["i-24-jump"], nodeIds: ["i-26"],
      eventPairs: [["i-24-jump", "i-26"]], phaseOverlay: true,
      note: "The same route and node are highlighted after the local selector flips i-22; the intrusion is absent.",
      metadata: [["final diagnostics", "0 crossings / 0 edge overlaps / 0 node overlaps / 0 intrusions"]],
    },
    {
      id: "divides-i25", title: "3 · divides experimental final · i-25 remains default", fixture: "characteristic:divides",
      focusFork: "i-25", candidate: "final", decision: "D", view: dividesExperimental.finalView,
      scoreRow: findRow(dividesExperimental, "i-25"), edgeIds: ["i-27-jump", "i-33-cont"], nodeIds: ["i-25"],
      eventPairs: [], phaseOverlay: false, fullView: true,
      note: "Raw provisional intrusions favor F (4/3), but none belongs to i-25 (0/0). The final i-27-jump × i-33-cont crossing remains absent.",
      metadata: [["selected", "D"], ["final i-27-jump × i-33-cont", "absent"], ["final diagnostics", "0 crossings / 1 edge overlap / 0 node overlaps / 0 intrusions"]],
    },
    {
      id: "eq-i9-body", title: "4 · eq i-9 flipped candidate · coherent body-owned signal", fixture: "characteristic:eq",
      focusFork: "i-9", candidate: "F provisional", decision: "D (after comparison)", view: eqExperimental.candidateViews.get("i-9:F"),
      scoreRow: findRow(eqExperimental, "i-9"), edgeIds: ["i-16-jump"], nodeIds: ["i-23", "i-24", "i-25", "i-26"],
      eventPairs: [["i-16-jump", "i-23"], ["i-16-jump", "i-24"], ["i-16-jump", "i-25"], ["i-16-jump", "i-26"]], phaseOverlay: true,
      note: "NO → NO endpoint consensus carries NO ownership through body segment 1, exposing four opposite YES nodes. i-9 still selects D.",
      metadata: [["transition", "NO → NO"], ["body ownership", "NO"], ["owned body conflicts", "4"]],
    },
    {
      id: "eq-i14-arrival", title: "5 · eq i-14 flipped candidate · target-local arrival signal", fixture: "characteristic:eq",
      focusFork: "i-14", candidate: "F provisional", decision: "D (after comparison)", view: eqExperimental.candidateViews.get("i-14:F"),
      scoreRow: findRow(eqExperimental, "i-14"), edgeIds: ["i-11-yes"], nodeIds: ["i-15"],
      eventPairs: [["i-11-yes", "i-15"]], phaseOverlay: true,
      note: "A representative OUTSIDE → YES arrival is YES-owned at i-14 and crosses sibling node i-15 in NO. It strengthens the existing default margin.",
      metadata: [["transition", "OUTSIDE → YES"], ["arrival ownership", "YES"], ["unexpected changed fork", "none"]],
    },
  ];

  const draw = () => {
    const scale = Number(scaleInput.value);
    scaleValue.textContent = `${scale.toFixed(2)}×`;
    const cards = specs.map((spec) => cardFor(spec, scale));
    viewsNode.replaceChildren(...cards.map((row) => row.article));
    for (const id of ["bounded-checkpoint", "bounded-experimental"]) {
      const canvas = document.querySelector(`#${id} .canvas`);
      canvas.scrollTop = canvas.scrollHeight;
    }
    window.__SKETCHV4_ENDPOINT_TRANSITION_SCORING_VISUAL_STATE__ = {
      cardCount: cards.length,
      buildMs,
      eventCounts: Object.fromEntries(specs.map((spec, index) => [spec.id, cards[index].eventCount])),
      orientations: {
        boundedCheckpoint: boundedControl.orientationMap,
        boundedExperimental: boundedExperimental.orientationMap,
        dividesExperimental: dividesExperimental.orientationMap,
        eqExperimental: eqExperimental.orientationMap,
      },
      noProductionImportsBeyondCurrentHarness: true,
      scoringExperimentOnly: true,
    };
  };
  scaleInput.addEventListener("input", draw);
  draw();
  status.textContent = `5 isolated comparison cards · ${buildMs.toFixed(1)} ms construction · local provisional scoring only · no promotion.`;
}

startViewer().catch((error) => {
  const status = document.querySelector("#status");
  status.className = "error";
  status.textContent = error?.stack ?? String(error);
});
