// Harness-only single-variable probe over the SketchV4 loop-endpoints checkpoint.
// Compares the exact normal minimization:bounded_sub baseline with the same composed
// realization after forcing only real-fork i-22 to the flipped orientation.

import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildBoundedSubI22FlipComparisonViews,
  buildRawRoleOrdinaryTerminalView,
  summarizeView,
} from "./ordinary_halt_experiment.mjs";

const CHECKPOINT_SHA = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const EXPECTED_BASELINE_SHA256 = "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65";
const FIXTURE = "minimization:bounded_sub";

const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));
const raw = buildRawRoleOrdinaryTerminalView(programs[FIXTURE], FIXTURE);
const comparison = buildBoundedSubI22FlipComparisonViews(raw);

function canonicalGeometry(view) {
  return JSON.stringify({
    nodeBoxes: [...view.boxes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, box]) => [id, box.left, box.right, box.top, box.bottom, box.cx, box.cy, box.w, box.h]),
    routes: view.routed.routes
      .slice()
      .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
      .map((route) => [route.edgeId, route.source, route.target, route.sourcePort, route.targetPort, route.points]),
    orientation: [...view.orientationMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, orientation]) => [id, orientation.no, orientation.yes]),
  });
}

function geometryDigest(view) {
  const bytes = canonicalGeometry(view);
  return {
    canonicalBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function attachmentReport(summary, edgeId = "i-24-jump") {
  return {
    edgeCount: summary.attachmentLegality.edgeCount,
    legalEdgeCount: summary.attachmentLegality.legalEdgeCount,
    illegalEdgeCount: summary.attachmentLegality.illegalEdgeCount,
    illegalEdges: summary.attachmentLegality.illegalEdges,
    loopReturnEdgeCount: summary.attachmentLegality.loopReturnEdgeCount,
    legalLoopReturnEdgeCount: summary.attachmentLegality.legalLoopReturnEdgeCount,
    loopReturnEdges: summary.attachmentLegality.loopReturnEdges,
    focusedEdge: summary.attachmentLegality.loopReturnEdges.find((row) => row.edgeId === edgeId) ?? null,
  };
}

function viewReport(view) {
  const summary = summarizeView(view);
  return {
    label: summary.label,
    geometryDigest: geometryDigest(view),
    orientation: summary.orientation,
    productionOrientationCost: summary.currentProductionStyleCost,
    productionDefects: view.defects.defects,
    crossings: summary.properCrossings,
    edgeOverlaps: summary.edgeOverlaps,
    nodeOverlaps: summary.trueNodeOverlaps,
    unrelatedNodeEdgeIntrusions: summary.unrelatedNodeEdgeIntersections,
    attachmentLegality: attachmentReport(summary),
    focusGeometry: view.i22FlipExperiment.focusGeometry,
    warnings: summary.warnings,
    fallbackOrRejectionFired: summary.fallbackOrRejectionFired,
  };
}

const baselineSummary = summarizeView(comparison.baseline);
const forcedSummary = summarizeView(comparison.forced);
const attachmentChanges = comparison.baseline.attachments
  .map((before) => {
    const after = comparison.forced.attachments.find((row) => row.edgeId === before.edgeId);
    return { edgeId: before.edgeId, before, after };
  })
  .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after));

const report = {
  experiment: "bounded_sub i-22 forced-flip single-variable comparison",
  checkpoint: {
    commit: CHECKPOINT_SHA,
    expectedBaselineSha256: EXPECTED_BASELINE_SHA256,
  },
  freeze: {
    productionFilesChanged: false,
    orientationScoringChanged: false,
    explicitOrientationChange: comparison.geometryDelta.orientationChanges,
    ordinaryHaltRetained: true,
    composedLoopEndpointGrammarRetained: true,
    adaptiveBranchRaysRetained: true,
    routingAndPortsRerunWithoutRuleChanges: true,
    automaticRepairUsed: false,
  },
  normalOrientationEvaluationForI22: comparison.orientationEvaluation,
  baseline: viewReport(comparison.baseline),
  forcedFlipped: viewReport(comparison.forced),
  geometryDelta: {
    ...comparison.geometryDelta,
    unchangedNodeCount: comparison.baseline.boxes.size - comparison.geometryDelta.changedNodePositionCount,
    unchangedRouteCount: comparison.baseline.routed.routes.length - comparison.geometryDelta.changedRouteCount,
    attachmentChanges,
  },
  defectDelta: comparison.defectDelta,
  conclusion: {
    hypothesisConfirmed: baselineSummary.experimentalNodeEdgeIntrusionCount === 1
      && forcedSummary.experimentalNodeEdgeIntrusionCount === 0,
    removedIntrusion: "i-24-jump × i-26",
    newScoredOrSeparateDefects: Object.values(comparison.defectDelta)
      .flatMap((category) => category.added).length,
    productionCostDistinguishesCandidates: comparison.orientationEvaluation.row.costDefault
      !== comparison.orientationEvaluation.row.costFlipped,
    moreSeriousVisualDefectCreated: false,
    unrelatedGeometryChangedUnexpectedly: comparison.geometryDelta.unexpectedChangedNodeIds.length > 0
      || comparison.geometryDelta.unexpectedChangedRouteIds.length > 0,
  },
};

const failures = [];
if (report.baseline.geometryDigest.sha256 !== EXPECTED_BASELINE_SHA256) failures.push("checkpoint baseline hash mismatch");
if (comparison.geometryDelta.orientationChanges.length !== 1 || comparison.geometryDelta.orientationChanges[0].id !== "i-22") failures.push("more than i-22 changed orientation");
if (comparison.orientationEvaluation.row.costDefault !== 0 || comparison.orientationEvaluation.row.costFlipped !== 0) failures.push("normal i-22 cost is no longer a 0/0 tie");
if (baselineSummary.properCrossingCount !== 0 || forcedSummary.properCrossingCount !== 0) failures.push("crossing regression");
if (baselineSummary.edgeOverlapCount !== 0 || forcedSummary.edgeOverlapCount !== 0) failures.push("edge-overlap regression");
if (baselineSummary.trueNodeOverlapCount !== 0 || forcedSummary.trueNodeOverlapCount !== 0) failures.push("node-overlap regression");
if (baselineSummary.experimentalNodeEdgeIntrusionCount !== 1 || forcedSummary.experimentalNodeEdgeIntrusionCount !== 0) failures.push("intrusion hypothesis failed");
if (comparison.geometryDelta.unexpectedChangedNodeIds.length || comparison.geometryDelta.unexpectedChangedRouteIds.length) failures.push("unrelated geometry changed");
if (baselineSummary.attachmentLegality.legalLoopReturnEdgeCount !== 3 || forcedSummary.attachmentLegality.legalLoopReturnEdgeCount !== 3) failures.push("loop attachment regression");
if (baselineSummary.attachmentLegality.illegalEdgeCount !== forcedSummary.attachmentLegality.illegalEdgeCount) failures.push("attachment legality count changed");
if (Object.values(comparison.defectDelta).some((category) => category.added.length > 0)) failures.push("new defect created");
if (baselineSummary.fallbackOrRejectionFired || forcedSummary.fallbackOrRejectionFired) failures.push("fallback or rejection fired");

if (failures.length) throw new Error(`bounded_sub i-22 flip probe failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
