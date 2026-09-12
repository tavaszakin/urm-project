import { buildCheckpointStageView } from "../../../urmwebpage/frontend/.flow-layout-probes/current_harness.mjs";
import { buildParityCandidate as buildLiveProduction } from "./scripts/live_production.mjs";
import {
  canonicalGeometryFromSnapshot,
  compareSnapshots,
  snapshotFromView,
  stableStringify,
} from "./lib/parity_data.mjs";

const $ = (selector) => document.querySelector(selector);
const manifest = await fetch("./manifest.json").then((response) => response.json());
const programs = await fetch("../archive-2026-09-05/programs.json").then((response) => response.json());

const fixtureSelect = $("#fixture");
const stageSelect = $("#stage");
const focusSelect = $("#focus");
const overlayToggle = $("#overlay-toggle");
const params = new URLSearchParams(location.search);
let buildCount = 0;

const FOCUS_PRESETS = [
  ["auto", "Stage focus (auto)"],
  ["full", "Full layout"],
  ["terminal", "A · synthetic terminal"],
  ["adaptive", "B · adaptive merge edges"],
  ["i57", "C · divides reentry context"],
  ["loop-sources", "D · loop sources"],
  ["i52-target", "E · i-52 → i-4 target"],
];

function populate(select, entries, selected) {
  select.replaceChildren(...entries.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    return option;
  }));
}

populate(fixtureSelect, manifest.fixtures.map((value) => [value, value]), params.get("fixture") ?? manifest.fixtures[0]);
populate(stageSelect, manifest.stages.map((value) => [value, value]), (params.get("stage") ?? "E").toUpperCase());
populate(focusSelect, FOCUS_PRESETS, params.get("focus") ?? "auto");
overlayToggle.checked = params.get("overlay") === "1";

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshotWithHash(view, fixture, stage, comparisonSource) {
  const snapshot = snapshotFromView(view, fixture, stage, { comparisonSource });
  const canonical = canonicalGeometryFromSnapshot(snapshot);
  snapshot.geometry = { canonicalBytes: canonical.length, sha256: await sha256(canonical) };
  return snapshot;
}

function orientationSummary(snapshot) {
  const flipped = snapshot.orientation.filter((row) => row.bit === "flipped").map((row) => row.id);
  return flipped.length ? `flipped: ${flipped.join(", ")}; all others default` : "all default";
}

function autoFocus(stage) {
  return ({ A: "terminal", B: "adaptive", C: "i57", D: "loop-sources", E: "i52-target" })[stage] ?? "full";
}

function focusDefinition(snapshot, requested) {
  const focus = requested === "auto" ? autoFocus(snapshot.stage) : requested;
  const routes = new Set();
  const nodes = new Set();
  if (focus === "terminal") {
    nodes.add(snapshot.terminal?.id);
    for (const route of snapshot.routes) if (route.target === snapshot.terminal?.id) routes.add(route.edgeId);
  } else if (focus === "adaptive") {
    for (const id of snapshot.diagnostics.stageEvidence.eligibleConditionalMergeEdgeIds) routes.add(id);
  } else if (focus === "i57") {
    routes.add("i-57-cont");
    routes.add("i-55-jump");
    nodes.add("i-25");
    nodes.add(snapshot.terminal?.id);
  } else if (focus === "loop-sources") {
    const byFixture = {
      "characteristic:divides": ["i-27-jump", "i-52-jump"],
      "primrec:basic": ["i-19-jump"],
    };
    for (const id of byFixture[snapshot.fixture] ?? []) routes.add(id);
  } else if (focus === "i52-target") {
    routes.add("i-52-jump");
    nodes.add("i-4");
  }
  for (const route of snapshot.routes) {
    if (routes.has(route.edgeId)) {
      nodes.add(route.source);
      nodes.add(route.target);
    }
  }
  return { focus, routes, nodes, full: focus === "full" || (routes.size === 0 && nodes.size === 0) };
}

function boundsFor(snapshot, focus) {
  const points = [];
  for (const node of snapshot.nodes) {
    if (focus.full || focus.nodes.has(node.id)) points.push([node.box.left, node.box.top], [node.box.right, node.box.bottom]);
  }
  for (const route of snapshot.routes) {
    if (focus.full || focus.routes.has(route.edgeId)) points.push(...route.points);
  }
  if (!points.length) return { x: 0, y: 0, width: 100, height: 100 };
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = Math.max(35, (maxX - minX) * 0.08);
  const padY = Math.max(35, (maxY - minY) * 0.05);
  return { x: minX - padX, y: minY - padY, width: maxX - minX + padX * 2, height: maxY - minY + padY * 2 };
}

function svgElement(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function drawSnapshot(svg, snapshot, focus, options = {}) {
  const { routeDiffs = new Set(), nodeDiffs = new Set(), color = "#7891ad", identicalOpacity = 1, offset = 0 } = options;
  for (const route of snapshot.routes) {
    const relevant = focus.full || focus.routes.has(route.edgeId);
    const differs = routeDiffs.has(route.edgeId);
    const polyline = svgElement("polyline", {
      points: route.points.map(([x, y]) => `${x + offset},${y + offset}`).join(" "),
      fill: "none",
      stroke: differs ? color : "#677385",
      "stroke-width": differs ? 4 : 2,
      "stroke-opacity": relevant ? (differs ? 1 : identicalOpacity) : 0.08,
      "vector-effect": "non-scaling-stroke",
    });
    const title = svgElement("title");
    title.textContent = `${route.edgeId}: ${stableStringify(route.points)}`;
    polyline.append(title);
    svg.append(polyline);
  }
  for (const node of snapshot.nodes) {
    const relevant = focus.full || focus.nodes.has(node.id);
    const differs = nodeDiffs.has(node.id);
    const rect = svgElement("rect", {
      x: node.box.left + offset,
      y: node.box.top + offset,
      width: node.box.w ?? node.box.right - node.box.left,
      height: node.box.h ?? node.box.bottom - node.box.top,
      rx: node.kind === "branch" ? 1 : 4,
      fill: differs ? `${color}33` : "#202a37",
      stroke: differs ? color : "#8492a6",
      "stroke-width": differs ? 3 : 1.5,
      "stroke-opacity": relevant ? (differs ? 1 : identicalOpacity) : 0.1,
      "vector-effect": "non-scaling-stroke",
    });
    svg.append(rect);
    if (relevant) {
      const label = svgElement("text", {
        x: node.box.cx + offset,
        y: node.box.cy + offset,
        fill: "#e6edf7",
        "font-size": 9,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        opacity: differs ? 1 : Math.max(identicalOpacity, 0.7),
      });
      label.textContent = node.id;
      svg.append(label);
    }
  }
}

function diagram(snapshot, focus, options = {}) {
  const svg = svgElement("svg");
  const bounds = options.bounds ?? boundsFor(snapshot, focus);
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  drawSnapshot(svg, snapshot, focus, options);
  const wrap = document.createElement("div");
  wrap.className = "diagram";
  wrap.append(svg);
  return wrap;
}

function metrics(snapshot, diff, defects) {
  const element = document.createElement("div");
  element.className = "metrics";
  const rows = [
    ["stage / fixture", `${snapshot.stage} / ${snapshot.fixture}`],
    ["geometry hash", snapshot.geometry.sha256],
    ["orientation", orientationSummary(snapshot)],
    ["diff counts", `nodes ${diff.nodeDiffCount} · routes ${diff.routeDiffCount} · ports ${diff.portDiffCount}`],
    ["accepted final annotations", defects.length ? defects.join("; ") : "none"],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "wide";
    row.textContent = `${label}: ${value}`;
    element.append(row);
  }
  return element;
}

function renderCard(target, title, snapshot, focus, diff, options, defects) {
  target.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = title;
  target.append(heading, metrics(snapshot, diff, defects), diagram(snapshot, focus, options));
}

function changedIds(part) {
  return new Set([...part.added, ...part.removed, ...part.changed]);
}

function syncUrl() {
  const next = new URL(location.href);
  next.searchParams.set("fixture", fixtureSelect.value);
  next.searchParams.set("stage", stageSelect.value);
  next.searchParams.set("focus", focusSelect.value);
  overlayToggle.checked ? next.searchParams.set("overlay", "1") : next.searchParams.delete("overlay");
  history.replaceState(null, "", next);
}

async function renderSelection() {
  syncUrl();
  const fixture = fixtureSelect.value;
  const stage = stageSelect.value;
  $("#status").className = "";
  $("#status").textContent = `Constructing only ${stage} / ${fixture}…`;
  try {
    const referencePath = manifest.stageHashes[stage][fixture].reference;
    const reference = await fetch(`./${referencePath}`).then((response) => response.json());
    const liveProduction = stage === "C";
    const candidateView = liveProduction
      ? buildLiveProduction(programs[fixture], fixture, stage)
      : buildCheckpointStageView(programs[fixture], fixture, stage);
    const comparisonSource = liveProduction
      ? "native production SketchV4 Layer C"
      : "current tested checkpoint harness";
    const candidate = await snapshotWithHash(candidateView, fixture, stage, comparisonSource);
    buildCount += 1;
    const diff = compareSnapshots(reference, candidate);
    const referenceFocus = focusDefinition(reference, focusSelect.value);
    const candidateFocus = focusDefinition(candidate, focusSelect.value);
    const routeDiffs = changedIds(diff.routes);
    const nodeDiffs = changedIds(diff.nodes);
    const defects = stage === "E" ? manifest.acceptedFinalDefects[fixture] : [];
    renderCard($("#reference-card"), "Frozen reference", reference, referenceFocus, diff, {
      routeDiffs, nodeDiffs, color: "#ffb454", identicalOpacity: 0.9,
    }, defects);
    renderCard($("#candidate-card"), liveProduction ? "Live production Layer C" : "Current harness reproduction", candidate, candidateFocus, diff, {
      routeDiffs, nodeDiffs, color: "#63d3ff", identicalOpacity: 0.9,
    }, defects);

    const overlayCard = $("#overlay-card");
    overlayCard.classList.toggle("hidden", !overlayToggle.checked);
    if (overlayToggle.checked) {
      const heading = document.createElement("h2");
      heading.textContent = "Geometry-difference overlay";
      const svg = svgElement("svg");
      const bounds = boundsFor(reference, referenceFocus);
      svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}`);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      drawSnapshot(svg, reference, referenceFocus, { routeDiffs, nodeDiffs, color: "#ffb454", identicalOpacity: 0.2 });
      drawSnapshot(svg, candidate, candidateFocus, { routeDiffs, nodeDiffs, color: "#63d3ff", identicalOpacity: 0.08, offset: diff.routeDiffCount || diff.nodeDiffCount ? 1.5 : 0 });
      const wrap = document.createElement("div");
      wrap.className = "diagram";
      wrap.append(svg);
      overlayCard.replaceChildren(heading, wrap);
    }

    const totalDiffs = diff.nodeDiffCount + diff.routeDiffCount + diff.portDiffCount + diff.orientationDiffCount + Number(diff.terminalChanged);
    $("#status").textContent = totalDiffs === 0
      ? `PASS · ${stage} / ${fixture} · immutable reference matches ${comparisonSource}`
      : `DIFFERENCE · ${stage} / ${fixture} · inspect emphasized objects`;
    $("#status").className = totalDiffs === 0 ? "" : "fail";
    window.__SKETCHV4_PARITY_VIEWER_STATE__ = {
      ready: true,
      stage,
      fixture,
      referenceHash: reference.geometry.sha256,
      candidateHash: candidate.geometry.sha256,
      diff,
      buildCount,
      constructedPairs: 1,
      comparisonSource,
    };
  } catch (error) {
    $("#status").textContent = `Viewer error: ${error.message}`;
    $("#status").className = "fail";
    window.__SKETCHV4_PARITY_VIEWER_STATE__ = { ready: false, error: error.stack ?? error.message, buildCount };
    throw error;
  }
}

for (const control of [fixtureSelect, stageSelect, focusSelect, overlayToggle]) {
  control.addEventListener("change", renderSelection);
}
await renderSelection();
