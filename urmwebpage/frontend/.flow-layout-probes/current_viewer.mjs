import {
  buildCurrentCheckpointView,
  canonicalGeometry,
  namedOrientationMap,
  summarizeView,
} from "./current_harness.mjs";

const FIXTURES = [
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
];

const COLORS = {
  entry: "#94a3b8",
  setup: "#94a3b8",
  spine: "#64748b",
  "branch-exit": "#25324a",
  "merge-connector": "#168466",
  "loop-return": "#2563eb",
  halt: "#dc2626",
  unknown: "#a21caf",
};

const round = (value) => Math.round(value * 1000) / 1000;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

function polylineLabelPoint(points) {
  if (!Array.isArray(points) || points.length < 2) return [0, 0];
  const [a, b] = points;
  const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const delta = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(...delta) || 1;
  return [midpoint[0] - (delta[1] / length) * 10, midpoint[1] + (delta[0] / length) * 10];
}

function instructionLabel(view, node) {
  if (node.id === "start") return "START";
  if (node.id === view.terminalId) return `HALT (${node.id})`;
  const instruction = view.program[node.instructionIndex];
  return Array.isArray(instruction)
    ? `${node.instructionIndex}: ${instruction[0]}(${instruction.slice(1).join(",")})`
    : node.id;
}

function svgFor(view, summary, scale) {
  const padding = 28;
  const { renderBounds: bounds } = view;
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const markerId = "current-arrow";
  let body = `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#334155"/></marker></defs>`;

  for (const route of view.routed.routes) {
    const edge = view.cfg.edgeById.get(route.edgeId);
    const points = route.points.map((point) => `${round(point[0])},${round(point[1])}`).join(" ");
    const color = COLORS[route.routeFamily] ?? COLORS.unknown;
    body += `<polyline class="route" points="${points}" stroke="${color}" marker-end="url(#${markerId})"><title>${escapeHtml(`${route.edgeId} · ${route.edgeRole} · ${route.routeFamily}`)}</title></polyline>`;
    if (edge?.branch) {
      const [x, y] = polylineLabelPoint(route.points);
      body += `<text class="edge-label" x="${round(x)}" y="${round(y)}">${escapeHtml(edge.branch.toUpperCase())}</text>`;
    }
    body += `<circle class="overlay-port" cx="${round(route.sourcePort[0])}" cy="${round(route.sourcePort[1])}" r="3" fill="#f59e0b"><title>${escapeHtml(`${route.edgeId} source port`)}</title></circle>`;
    body += `<circle class="overlay-port" cx="${round(route.targetPort[0])}" cy="${round(route.targetPort[1])}" r="3" fill="#10b981"><title>${escapeHtml(`${route.edgeId} target port`)}</title></circle>`;
  }

  for (const node of view.cfg.nodes) {
    const box = view.boxes.get(node.id);
    if (!box) continue;
    const synthetic = node.id === view.terminalId;
    const fill = synthetic ? "#fff7d6" : node.id === "start" ? "#e8eef7" : "#fff";
    if (node.kind === "conditionalJump") {
      body += `<polygon points="${box.cx},${box.top} ${box.right},${box.cy} ${box.cx},${box.bottom} ${box.left},${box.cy}" fill="${fill}" stroke="#172033" stroke-width="1.2"/>`;
    } else {
      body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="${node.id === "start" ? 9 : 1}" fill="${fill}" stroke="#172033" stroke-width="1.1"/>`;
    }
    body += `<text class="node-label" x="${box.cx}" y="${box.cy - (synthetic ? 3 : 0)}">${escapeHtml(instructionLabel(view, node))}</text>`;
    if (synthetic) body += `<text class="node-id" x="${box.cx}" y="${box.cy + 8}">ordinary action geometry</text>`;
  }

  for (const crossing of summary.properCrossings) {
    body += `<g class="overlay-crossing"><circle cx="${crossing.point[0]}" cy="${crossing.point[1]}" r="7" fill="#ef4444" opacity="0.75"/><circle cx="${crossing.point[0]}" cy="${crossing.point[1]}" r="3" fill="#fff"/><title>${escapeHtml(`${crossing.edgeA} × ${crossing.edgeB}`)}</title></g>`;
  }
  for (const overlap of summary.trueNodeOverlaps) {
    const first = view.boxes.get(overlap.nodeA);
    const second = view.boxes.get(overlap.nodeB);
    body += `<rect class="overlay-overlap" x="${Math.max(first.left, second.left)}" y="${Math.max(first.top, second.top)}" width="${overlap.overlapX}" height="${overlap.overlapY}" fill="#d946ef" opacity="0.55"><title>${escapeHtml(`${overlap.nodeA} overlaps ${overlap.nodeB}`)}</title></rect>`;
  }
  for (const intrusion of summary.unrelatedNodeEdgeIntersections) {
    const box = intrusion.nodeBox;
    const [intervalStart, intervalEnd] = intrusion.intersectionInterval;
    const midpoint = [(intervalStart[0] + intervalEnd[0]) / 2, (intervalStart[1] + intervalEnd[1]) / 2];
    const title = `${intrusion.edgeId} × ${intrusion.nodeId} · ${intrusion.penetrationKind}`;
    body += `<g class="overlay-intrusion">`
      + `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="#f97316" fill-opacity="0.18" stroke="#ea580c" stroke-width="3" stroke-dasharray="6 3"><title>${escapeHtml(title)}</title></rect>`
      + `<line x1="${intrusion.segmentStart[0]}" y1="${intrusion.segmentStart[1]}" x2="${intrusion.segmentEnd[0]}" y2="${intrusion.segmentEnd[1]}" stroke="#fb923c" stroke-width="5" stroke-opacity="0.65"><title>${escapeHtml(title)}</title></line>`
      + `<line x1="${intervalStart[0]}" y1="${intervalStart[1]}" x2="${intervalEnd[0]}" y2="${intervalEnd[1]}" stroke="#dc2626" stroke-width="7"><title>${escapeHtml(title)}</title></line>`
      + `<circle cx="${midpoint[0]}" cy="${midpoint[1]}" r="5" fill="#fff" stroke="#991b1b" stroke-width="3"><title>${escapeHtml(title)}</title></circle>`
      + "</g>";
  }

  return `<svg viewBox="${minX} ${minY} ${width} ${height}" width="${Math.ceil(width * scale)}" height="${Math.ceil(height * scale)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function cardFor(view, summary, scale) {
  const crossingPairs = summary.properCrossings.length
    ? summary.properCrossings.map((row) => `${row.edgeA} × ${row.edgeB}`).join(", ")
    : "none";
  const article = document.createElement("article");
  article.innerHTML = `<h2>${escapeHtml(summary.label)}</h2>`
    + `<div class="provenance">Exact checkpoint reproduction: 9f166f24721e7125ec9c0105e8960c6273d8d932. No experimental orientation rule is active.</div>`
    + `<div class="summary">nodes ${summary.nodeCount} · edges ${summary.edgeCount} · production-style cost ${summary.currentProductionStyleCost} · intrusion-aware diagnostic ${summary.intrusionAwareOrientationCost} · crossings ${summary.properCrossingCount} (${escapeHtml(crossingPairs)}) · edge overlaps ${summary.edgeOverlapCount} · node overlaps ${summary.trueNodeOverlapCount} · unrelated node–edge intrusions ${summary.experimentalNodeEdgeIntrusionCount} · flips [${escapeHtml(summary.flippedForks.join(", ") || "none")}]</div>`
    + `<div class="canvas">${svgFor(view, summary, scale)}</div>`
    + `<details><summary>Exact diagnostics</summary><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></details>`;
  return article;
}

async function startViewer() {
  const status = document.querySelector("#status");
  const fixtureSelect = document.querySelector("#fixture");
  const viewsNode = document.querySelector("#views");
  const scaleInput = document.querySelector("#scale");
  const scaleValue = document.querySelector("#scale-value");
  const programs = await fetch(new URL("../.sketchv3-harness/programs.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`fixture load failed: ${response.status}`);
    return response.json();
  });
  for (const fixture of FIXTURES) {
    if (!programs[fixture]) continue;
    const option = document.createElement("option");
    option.value = fixture;
    option.textContent = fixture;
    fixtureSelect.append(option);
  }
  const query = new URLSearchParams(location.search);
  const requested = query.get("fixture");
  fixtureSelect.value = FIXTURES.includes(requested) ? requested : "characteristic:divides";

  let current = null;
  const draw = () => {
    const scale = Number(scaleInput.value);
    scaleValue.textContent = `${scale.toFixed(2)}×`;
    viewsNode.replaceChildren(cardFor(current.view, current.summary, scale));
  };
  const build = () => {
    const fixture = fixtureSelect.value;
    const started = performance.now();
    const view = buildCurrentCheckpointView(programs[fixture], fixture);
    const summary = summarizeView(view);
    const buildMs = performance.now() - started;
    current = { view, summary };
    draw();
    status.textContent = `${fixture}: one current checkpoint card; constructed in ${buildMs.toFixed(1)} ms. Historical probes are not loaded.`;
    window.history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ fixture })}`);
    window.__SKETCHV4_HARNESS_STATE__ = {
      fixture,
      cardCount: 1,
      buildMs,
      orientation: namedOrientationMap(view),
      canonicalBytes: canonicalGeometry(view).length,
    };
  };

  fixtureSelect.addEventListener("change", build);
  scaleInput.addEventListener("input", draw);
  for (const id of ["crossings", "overlaps", "intrusions", "ports"]) {
    document.querySelector(`#${id}`).addEventListener("change", (event) => {
      document.body.classList.toggle(`show-${id}`, event.target.checked);
    });
  }
  build();
}

startViewer().catch((error) => {
  const status = document.querySelector("#status");
  status.className = "error";
  status.textContent = error?.stack ?? String(error);
});
