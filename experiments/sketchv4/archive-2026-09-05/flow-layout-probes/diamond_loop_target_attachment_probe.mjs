// Diagnostic-only SketchV4 target-attachment experiment.
//
// Compares the fixed ordinary-HALT/adaptive-reentry checkpoint geometry with a
// local diamond attachment rule for loop returns. Production modules and the
// checkpoint harness are read only. This probe writes only its sibling JSON.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAdaptiveRightReentryDiagnosticView,
  buildRawRoleOrdinaryTerminalView,
  crossingDetails,
  edgeOverlapDetails,
  nodeOverlapDetails,
  unrelatedNodeEdgeIntersections,
} from "./ordinary_halt_experiment.mjs";
import { validateEdgeAttachments } from "../src/layout/sketchv4/attachmentStubs.js";
import { evaluateDefects } from "../src/layout/sketchv4/defects.js";
import { buildLayout } from "../src/layout/sketchv4/pipeline.js";
import { routeEdges } from "../src/layout/sketchv4/routing.js";

const CHECKPOINT_SHA = "2cbcc69130fd549a602a66e5a7febdd7f3d38c42";
const BASELINE_SHA = "93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1";
const CLEARANCE = 16;
const EPSILON = 0.75;
const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(here, "..", "..");
const BACKEND_URL = process.env.URM_BACKEND_URL ?? "http://127.0.0.1:8000";
const ARTIFACT = path.join(here, "diamond_loop_target_attachment_probe.json");

const currentVisual = {
  sizeForKind: (kind) =>
    kind === "start" || kind === "halt" ? [48, 18]
      : kind === "conditionalJump" ? [82, 46]
        : [88, 30],
  branchAngleTan: Math.tan(33 * Math.PI / 180),
  pitch: { setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126 },
  terminalSize: [48, 18],
  haltBandOffset: 154,
  clearance: CLEARANCE,
};

const NO_HALT_CONTEXT = Object.freeze({
  haltBox: null,
  haltExitRecords: Object.freeze([]),
  haltExitCount: 0,
  haltX: 0,
  haltBandOffset: 0,
});

const point = (p) => Array.isArray(p) ? [...p] : p;
const round = (n) => Number.isFinite(n) ? Math.round(n * 10000) / 10000 : n;
const roundedPoint = (p) => Array.isArray(p) ? p.map(round) : p;
const samePoint = (a, b) => Array.isArray(a) && Array.isArray(b)
  && Math.abs(a[0] - b[0]) <= EPSILON
  && Math.abs(a[1] - b[1]) <= EPSILON;

function fixtureSpecs() {
  const json = execFileSync(
    "python3",
    ["-c", "import json,fixture_kinds; print(json.dumps([{'label':f['label'],'spec':f['spec']} for f in fixture_kinds.METRIC_FIXTURES]))"],
    { cwd: BACKEND_DIR, encoding: "utf8" },
  );
  return JSON.parse(json);
}

async function compile(spec) {
  const response = await fetch(`${BACKEND_URL}/compile-function`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!response.ok) throw new Error(`compile failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.program)) throw new Error("compile returned no program");
  return payload.program;
}

function diamondPorts(box, side) {
  if (side === "left") {
    return {
      center: [box.left, box.cy],
      upper: [(box.left + box.cx) / 2, (box.top + box.cy) / 2],
      lower: [(box.left + box.cx) / 2, (box.cy + box.bottom) / 2],
      names: { center: "left", upper: "upper-left", lower: "lower-left" },
    };
  }
  return {
    center: [box.right, box.cy],
    upper: [(box.cx + box.right) / 2, (box.top + box.cy) / 2],
    lower: [(box.cx + box.right) / 2, (box.cy + box.bottom) / 2],
    names: { center: "right", upper: "upper-right", lower: "lower-right" },
  };
}

function targetEntryHorizontal(route) {
  const points = route.points ?? [];
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a[1] - b[1]) <= EPSILON && Math.abs(a[0] - b[0]) > EPSILON) {
      return { segmentIndex: i, start: a, end: b, y: a[1] };
    }
  }
  return null;
}

function approachFacts(view, route) {
  const lane = view.lanes.laneRecords.find((row) => row.edgeId === route.edgeId);
  const targetNode = view.cfg.nodeById.get(route.target);
  const targetBox = view.boxes.get(route.target);
  const horizontal = targetEntryHorizontal(route);
  const adjustment = (view.routed.parallelRailAdjustmentRecords ?? []).find((row) => (
    row.edgeId === route.edgeId && row.segmentKind === "target-entry"
  ));
  if (route.routeFamily !== "loop-return" || targetNode?.kind !== "conditionalJump"
      || !targetBox || !horizontal || (lane?.side !== "left" && lane?.side !== "right")) {
    return null;
  }
  return {
    side: lane.side,
    targetNode,
    targetBox,
    horizontal,
    finalApproachY: horizontal.y,
    // clearY's result is computed from the complete lane set. The later
    // clearParallelLoopRailY pass is sequential; its recorded fromY is the
    // order-independent approach signature this experiment intentionally uses.
    baseApproachY: adjustment?.fromY ?? horizontal.y,
    parallelAdjustment: adjustment ?? null,
  };
}

function choosePort(facts, rowKind = "base") {
  const ports = diamondPorts(facts.targetBox, facts.side);
  const approachY = rowKind === "final" ? facts.finalApproachY : facts.baseApproachY;
  let slot = "center";
  // Only promote to a diagonal port when the approach shoulder is actually in
  // that named port's exterior incident quadrant. The middle band remains on
  // the ordinary side-center policy rather than inventing a forced choice.
  if (approachY < ports.upper[1] - EPSILON) slot = "upper";
  else if (approachY > ports.lower[1] + EPSILON) slot = "lower";
  return {
    rowKind,
    approachY,
    slot,
    portName: ports.names[slot],
    portPoint: ports[slot],
  };
}

function validate(view, route) {
  const sourceNode = view.cfg.nodeById.get(route.source);
  const targetNode = view.cfg.nodeById.get(route.target);
  return validateEdgeAttachments(route, sourceNode, targetNode, route.points, {
    sourceBox: view.boxes.get(route.source),
    targetBox: view.boxes.get(route.target),
  });
}

function applyCandidate(view) {
  const decisions = [];
  const routes = view.routed.routes.map((route) => {
    const facts = approachFacts(view, route);
    if (!facts) return route;
    const selected = choosePort(facts, "base");
    const oldValidation = validate(view, route);
    if (samePoint(selected.portPoint, route.targetPort)) {
      decisions.push({
        edgeId: route.edgeId,
        target: route.target,
        side: facts.side,
        baseApproachY: facts.baseApproachY,
        finalApproachY: facts.finalApproachY,
        targetBox: facts.targetBox,
        selectedPort: selected.portName,
        selectedPoint: selected.portPoint,
        changed: false,
        oldTargetAttachment: oldValidation.target,
      });
      return route;
    }

    const points = route.points.map(point);
    const oldPoints = route.points.map(point);
    points[points.length - 1] = point(selected.portPoint);
    const candidate = {
      ...route,
      points,
      targetPort: point(selected.portPoint),
      connectorKind: "diamondDiagonalTargetStub",
      portPolicyCase: `loop-return-${selected.portName}`,
    };
    const newValidation = validate(view, candidate);
    decisions.push({
      edgeId: route.edgeId,
      target: route.target,
      side: facts.side,
      baseApproachY: facts.baseApproachY,
      finalApproachY: facts.finalApproachY,
      parallelAdjustment: facts.parallelAdjustment,
      targetBox: facts.targetBox,
      selectedPort: selected.portName,
      oldTargetPoint: point(route.targetPort),
      newTargetPoint: point(selected.portPoint),
      oldFinalSegment: oldPoints.slice(-2),
      newFinalSegment: points.slice(-2),
      changed: true,
      oldTargetAttachment: oldValidation.target,
      newTargetAttachment: newValidation.target,
      wholeEdgeLegalBefore: oldValidation.legal,
      wholeEdgeLegalAfter: newValidation.legal,
      sourceLegalityUnchanged: oldValidation.source,
    });
    return candidate;
  });

  const routed = { ...view.routed, routes };
  const defects = evaluateDefects(
    { routes, boxes: view.boxes },
    { realForkSet: view.roles.realForkSet, lcaRF: view.tree.lcaRF },
    { clearance: CLEARANCE, program: view.programName, orientationSource: "diagnosticTargetAttachmentOnly" },
  );
  return { ...view, routed, defects, targetAttachmentDecisions: decisions };
}

function metrics(view) {
  return {
    crossingCount: crossingDetails(view.routed.routes).length,
    edgeOverlapCount: edgeOverlapDetails(view.routed.routes).length,
    nodeOverlapCount: nodeOverlapDetails(view.boxes).length,
    nodeEdgeIntrusionCount: unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes).length,
  };
}

function conciseDecision(decision) {
  return {
    edgeId: decision.edgeId,
    target: decision.target,
    side: decision.side,
    baseApproachY: round(decision.baseApproachY),
    finalApproachY: round(decision.finalApproachY),
    targetBox: decision.targetBox ? Object.fromEntries(Object.entries(decision.targetBox).map(([k, v]) => [k, round(v)])) : null,
    selectedPort: decision.selectedPort,
    selectedPoint: roundedPoint(decision.selectedPoint ?? decision.newTargetPoint),
    oldTargetPoint: roundedPoint(decision.oldTargetPoint),
    newTargetPoint: roundedPoint(decision.newTargetPoint),
    oldFinalSegment: decision.oldFinalSegment?.map(roundedPoint),
    newFinalSegment: decision.newFinalSegment?.map(roundedPoint),
    changed: decision.changed,
    oldTargetAttachment: decision.oldTargetAttachment ? {
      portName: decision.oldTargetAttachment.portName,
      incidentDirection: decision.oldTargetAttachment.incidentDirection,
      legal: decision.oldTargetAttachment.legal,
      reason: decision.oldTargetAttachment.reason,
    } : null,
    newTargetAttachment: decision.newTargetAttachment ? {
      portName: decision.newTargetAttachment.portName,
      incidentDirection: decision.newTargetAttachment.incidentDirection,
      legal: decision.newTargetAttachment.legal,
      reason: decision.newTargetAttachment.reason,
    } : null,
    wholeEdgeLegalBefore: decision.wholeEdgeLegalBefore,
    wholeEdgeLegalAfter: decision.wholeEdgeLegalAfter,
    unchangedSourceAttachment: decision.sourceLegalityUnchanged ? {
      portName: decision.sourceLegalityUnchanged.portName,
      incidentDirection: decision.sourceLegalityUnchanged.incidentDirection,
      legal: decision.sourceLegalityUnchanged.legal,
      reason: decision.sourceLegalityUnchanged.reason,
    } : null,
  };
}

function assignmentRows(view, rowKind) {
  return view.routed.routes
    .map((route) => {
      const facts = approachFacts(view, route);
      if (!facts) return null;
      const selection = choosePort(facts, rowKind);
      return {
        edgeId: route.edgeId,
        target: route.target,
        baseApproachY: round(facts.baseApproachY),
        finalApproachY: round(facts.finalApproachY),
        selectedPort: selection.portName,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
}

function assignmentSignature(rows) {
  return JSON.stringify(rows.map((row) => [row.edgeId, row.target, row.selectedPort]));
}

function baseApproachSignature(rows) {
  return JSON.stringify(rows.map((row) => [row.edgeId, row.target, row.baseApproachY]));
}

function rerouteWithEdgeOrder(view, order) {
  const edges = order === "reverse" ? [...view.cfg.edges].reverse() : [...view.cfg.edges];
  const cfg = { ...view.cfg, edges };
  const routed = routeEdges(cfg, view.roles, view.ownership, view.skeleton, view.lanes, NO_HALT_CONTEXT, {
    clearance: CLEARANCE,
  });
  return { ...view, cfg, routed };
}

async function main() {
  const health = await fetch(`${BACKEND_URL}/function-kinds`);
  if (!health.ok) throw new Error(`backend unavailable: HTTP ${health.status}`);

  const specs = fixtureSpecs();
  const programs = new Map();
  for (const fixture of specs) programs.set(fixture.label, await compile(fixture.spec));

  const dividesProgram = programs.get("characteristic:divides");
  const raw = buildRawRoleOrdinaryTerminalView(dividesProgram, "characteristic:divides");
  const checkpoint = buildAdaptiveRightReentryDiagnosticView(raw, "i-25").view;
  const candidate = applyCandidate(checkpoint);
  const focusIds = new Set(["i-27-jump", "i-52-jump"]);

  const normalOrder = rerouteWithEdgeOrder(checkpoint, "normal");
  const reverseOrder = rerouteWithEdgeOrder(checkpoint, "reverse");
  const normalBaseAssignments = assignmentRows(normalOrder, "base");
  const reverseBaseAssignments = assignmentRows(reverseOrder, "base");
  const normalFinalAssignments = assignmentRows(normalOrder, "final");
  const reverseFinalAssignments = assignmentRows(reverseOrder, "final");

  const fixtureAudit = [];
  for (const fixture of specs) {
    const layout = buildLayout(programs.get(fixture.label), {
      programName: fixture.label,
      orientationSource: "v4Assigned",
      visual: currentVisual,
      diagnostics: true,
    });
    const candidateLayout = applyCandidate(layout);
    const changed = candidateLayout.targetAttachmentDecisions.filter((row) => row.changed);
    const diamondLoopReturns = layout.routed.routes.filter((route) => approachFacts(layout, route));
    const currentMetrics = metrics(layout);
    const candidateMetrics = metrics(candidateLayout);
    fixtureAudit.push({
      fixture: fixture.label,
      diamondLoopReturnCount: diamondLoopReturns.length,
      changedCount: changed.length,
      changed: changed.map(conciseDecision),
      decisions: candidateLayout.targetAttachmentDecisions.map(conciseDecision),
      currentMetrics,
      candidateMetrics,
      metricDelta: Object.fromEntries(Object.keys(currentMetrics).map((key) => [key, candidateMetrics[key] - currentMetrics[key]])),
    });
  }

  const checkpointDecisions = candidate.targetAttachmentDecisions
    .filter((row) => focusIds.has(row.edgeId))
    .map(conciseDecision);
  const checkpointRoutes = (view) => view.routed.routes
    .filter((route) => focusIds.has(route.edgeId))
    .map((route) => ({
      edgeId: route.edgeId,
      source: route.source,
      target: route.target,
      targetPort: roundedPoint(route.targetPort),
      points: route.points.map(roundedPoint),
    }));

  const output = {
    meta: {
      baselineSha: BASELINE_SHA,
      checkpointSha: CHECKPOINT_SHA,
      experiment: "diagnostic-only; fixed checkpoint orientation and placement; no product source changes",
      candidateRule: "For a loop-return into a diamond, retain the lane side; resolve the named target port from clearY's pre-sequential-displacement approach row. Choose the upper/lower diagonal port only when that row lies in its exterior incident quadrant; otherwise retain side-center.",
      orderControl: "The rule reads target-entry fromY before clearParallelLoopRailY's sequential reservation displacement.",
    },
    checkpointComparison: {
      target: "i-4",
      targetBox: Object.fromEntries(Object.entries(checkpoint.boxes.get("i-4")).map(([k, v]) => [k, round(v)])),
      currentMetrics: metrics(checkpoint),
      candidateMetrics: metrics(candidate),
      currentRoutes: checkpointRoutes(checkpoint),
      candidateRoutes: checkpointRoutes(candidate),
      decisions: checkpointDecisions,
    },
    processingOrderAudit: {
      baseApproachRule: {
        normal: normalBaseAssignments.filter((row) => focusIds.has(row.edgeId)),
        reverse: reverseBaseAssignments.filter((row) => focusIds.has(row.edgeId)),
        assignmentsIdentical: assignmentSignature(normalBaseAssignments) === assignmentSignature(reverseBaseAssignments),
        baseApproachRowsIdentical: baseApproachSignature(normalBaseAssignments) === baseApproachSignature(reverseBaseAssignments),
      },
      rejectedFinalDisplacedRowRule: {
        normal: normalFinalAssignments.filter((row) => focusIds.has(row.edgeId)),
        reverse: reverseFinalAssignments.filter((row) => focusIds.has(row.edgeId)),
        assignmentsIdentical: assignmentSignature(normalFinalAssignments) === assignmentSignature(reverseFinalAssignments),
        note: "Uses the already-displaced committed row and therefore inherits route iteration order.",
      },
      normalAdjustments: normalOrder.routed.parallelRailAdjustmentRecords.filter((row) => row.segmentKind === "target-entry" && focusIds.has(row.edgeId)),
      reverseAdjustments: reverseOrder.routed.parallelRailAdjustmentRecords.filter((row) => row.segmentKind === "target-entry" && focusIds.has(row.edgeId)),
    },
    currentProductionFixtureAudit: {
      fixtureCount: fixtureAudit.length,
      diamondLoopReturnCount: fixtureAudit.reduce((sum, row) => sum + row.diamondLoopReturnCount, 0),
      changedCount: fixtureAudit.reduce((sum, row) => sum + row.changedCount, 0),
      changedFixtures: fixtureAudit.filter((row) => row.changedCount > 0),
      allFixtures: fixtureAudit,
      note: "Enumeration uses current production SketchV4 placements/routes at the fixed selected orientation. It does not feed the diagnostic candidate back into orientation selection.",
    },
  };

  fs.writeFileSync(ARTIFACT, `${JSON.stringify(output, null, 2)}\n`);

  console.table(checkpointDecisions.map((row) => ({
    edge: row.edgeId,
    baseY: row.baseApproachY,
    finalY: row.finalApproachY,
    oldPort: row.oldTargetAttachment?.portName,
    newPort: row.selectedPort,
    changed: row.changed,
    oldTargetLegal: row.oldTargetAttachment?.legal,
    newTargetLegal: row.newTargetAttachment?.legal ?? row.oldTargetAttachment?.legal,
  })));
  console.table([
    { view: "checkpoint", ...output.checkpointComparison.currentMetrics },
    { view: "candidate", ...output.checkpointComparison.candidateMetrics },
  ]);
  console.log(`base-row assignments order-independent: ${output.processingOrderAudit.baseApproachRule.assignmentsIdentical}`);
  console.log(`final-row assignments order-independent: ${output.processingOrderAudit.rejectedFinalDisplacedRowRule.assignmentsIdentical}`);
  console.log(`production audit: ${output.currentProductionFixtureAudit.diamondLoopReturnCount} diamond loop returns; ${output.currentProductionFixtureAudit.changedCount} candidates`);
  for (const row of output.currentProductionFixtureAudit.changedFixtures) {
    console.log(`  ${row.fixture}: ${row.changed.map((item) => `${item.edgeId}->${item.selectedPort}`).join(", ")}`);
  }
  console.log(`Evidence: ${ARTIFACT}`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
