// Harness-only self-consistent recursive completed-candidate orientation probe.
// Exact recursive selection is followed by a diagnostic-only exhaustive mask oracle.

import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildRawRoleOrdinaryTerminalView,
  buildSelfConsistentCompletedCandidateComparisonViews,
  summarizeView,
} from "./ordinary_halt_experiment.mjs";

const CHECKPOINT_SHA = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const FIXTURES = [
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
];
const EXPECTED_BASELINE_HASHES = {
  "minimization:bounded_sub": "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
  "characteristic:divides": "72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd",
  "characteristic:eq": "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
  "primrec:basic": "e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f",
  predecessor: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
};
const PREVIOUS_ROLLOUT_MISMATCHES = new Set([
  "minimization:bounded_sub|i-15",
  "minimization:bounded_sub|i-12",
  "characteristic:divides|i-38",
  "characteristic:divides|i-15",
  "characteristic:eq|i-31",
  "characteristic:eq|i-11",
  "predecessor|i-2",
]);
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

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
  const canonical = canonicalGeometry(view);
  return {
    canonicalBytes: canonical.length,
    sha256: crypto.createHash("sha256").update(canonical).digest("hex"),
  };
}

function finalDiagnostics(view) {
  const summary = summarizeView(view);
  return {
    properCrossingCount: summary.properCrossingCount,
    properCrossings: summary.properCrossings,
    edgeOverlapCount: summary.edgeOverlapCount,
    edgeOverlaps: summary.edgeOverlaps,
    nodeOverlapCount: summary.trueNodeOverlapCount,
    nodeOverlaps: summary.trueNodeOverlaps,
    nodeEdgeIntrusionCount: summary.experimentalNodeEdgeIntrusionCount,
    nodeEdgeIntrusions: summary.unrelatedNodeEdgeIntersections,
    experimentalCost: summary.intrusionAwareOrientationCost,
    fallbackOrRejectionFired: summary.fallbackOrRejectionFired,
  };
}

function recursiveRowReport(row) {
  return {
    realForkId: row.realForkId,
    completedDefault: row.completedDefault,
    completedFlipped: row.completedFlipped,
    recursiveCompletionDefaultOrientationMap: row.recursiveCompletionDefaultOrientationMap,
    recursiveCompletionFlippedOrientationMap: row.recursiveCompletionFlippedOrientationMap,
    finalDecision: row.finalDecision,
    tieBreakReason: row.tieBreakReason,
    selectedCompletionMatchesActuallySelectedSuffix:
      row.selectedCompletionConsistency.matchesRecursivePolicyActuallySelectedSuffix,
    selectedCompletionDifferences: row.selectedCompletionConsistency.differencesFromFinalMap,
  };
}

const failures = [];
const fixtureReports = [];
const revisitedPreviousMismatches = [];
for (const fixture of FIXTURES) {
  const raw = buildRawRoleOrdinaryTerminalView(programs[fixture], fixture);
  const result = buildSelfConsistentCompletedCandidateComparisonViews(raw);
  const recursiveRows = result.comparison.recursiveRows.map(recursiveRowReport);
  const report = {
    fixture,
    orientationMaps: result.comparison.orientationMaps,
    changedFromCheckpoint: result.comparison.changedFromCheckpoint.map((row) => row.realForkId),
    changedFromOneStep: result.comparison.changedFromOneStep.map((row) => row.realForkId),
    recursiveForkEvaluations: recursiveRows,
    selectedCompletionMismatchCount: result.comparison.selectedCompletionMismatchCount,
    final: {
      checkpoint: { diagnostics: finalDiagnostics(result.baseline), geometryDigest: geometryDigest(result.baseline) },
      provisional: { diagnostics: finalDiagnostics(result.provisional), geometryDigest: geometryDigest(result.provisional) },
      oneStep: { diagnostics: finalDiagnostics(result.oneStep), geometryDigest: geometryDigest(result.oneStep) },
      recursive: { diagnostics: finalDiagnostics(result.recursive), geometryDigest: geometryDigest(result.recursive) },
    },
    exhaustiveOracle: result.comparison.exhaustiveOracle,
    evaluationCache: result.comparison.evaluationCache,
  };
  fixtureReports.push(report);

  for (const row of result.comparison.recursiveRows) {
    if (!PREVIOUS_ROLLOUT_MISMATCHES.has(`${fixture}|${row.realForkId}`)) continue;
    revisitedPreviousMismatches.push({
      fixture,
      realForkId: row.realForkId,
      oneStepCosts: row.oneStepCompletedCosts,
      recursiveCosts: row.recursiveCompletedCosts,
      oneStepDecision: row.oneStepDecision,
      recursiveDecision: row.recursiveDecision,
      decisionChanged: row.oneStepDecision !== row.recursiveDecision,
      selectedCompletionMatchesActuallySelectedSuffix:
        row.selectedCompletionConsistency.matchesRecursivePolicyActuallySelectedSuffix,
    });
  }

  if (report.final.checkpoint.geometryDigest.sha256 !== EXPECTED_BASELINE_HASHES[fixture]) failures.push(`${fixture}: checkpoint hash mismatch`);
  if (report.changedFromOneStep.length > 0) failures.push(`${fixture}: recursive decision changed from one-step {${report.changedFromOneStep}}`);
  if (report.selectedCompletionMismatchCount !== 0) failures.push(`${fixture}: selected recursive completion mismatch`);
  if (!report.exhaustiveOracle.recursiveReachesGlobalMinimum) failures.push(`${fixture}: recursive map missed exhaustive minimum`);
  if (report.evaluationCache.uniqueFinalMapsRealized !== report.exhaustiveOracle.enumeratedMapCount) failures.push(`${fixture}: not every orientation map was realized`);
  if (Object.values(report.final).some((stage) => stage.diagnostics.fallbackOrRejectionFired)) failures.push(`${fixture}: fallback or rejection fired`);
}

const bounded = fixtureReports.find((row) => row.fixture === "minimization:bounded_sub");
const divides = fixtureReports.find((row) => row.fixture === "characteristic:divides");
const eq = fixtureReports.find((row) => row.fixture === "characteristic:eq");
if (bounded.orientationMaps.recursive["i-22"] !== "flipped") failures.push("bounded recursive i-22 is not flipped");
if (bounded.final.recursive.diagnostics.nodeEdgeIntrusions.some(
  (row) => row.edgeId === "i-24-jump" && row.nodeId === "i-26",
)) failures.push("bounded recursive layout retained i-24-jump × i-26");
if (divides.orientationMaps.recursive["i-25"] !== "default"
  || divides.orientationMaps.recursive["i-48"] !== "flipped"
  || divides.orientationMaps.recursive["i-53"] !== "flipped") failures.push("divides recursive required orientations failed");
if (divides.final.recursive.diagnostics.properCrossings.some(
  (row) => row.edgeA === "i-27-jump" && row.edgeB === "i-33-cont",
)) failures.push("divides recursive layout retained i-27-jump × i-33-cont");
if (!divides.final.recursive.diagnostics.edgeOverlaps.some(
  (row) => row.edgeA === "i-55-jump" && row.edgeB === "i-57-cont",
)) failures.push("divides diagnostic edge overlap changed");
if (!eq.final.recursive.diagnostics.edgeOverlaps.some(
  (row) => row.edgeA === "i-46-yes" && row.edgeB === "i-47-cont",
)) failures.push("eq diagnostic edge overlap changed");
if (revisitedPreviousMismatches.length !== PREVIOUS_ROLLOUT_MISMATCHES.size) failures.push("did not revisit all seven previous rollout mismatches");
if (revisitedPreviousMismatches.some((row) => row.decisionChanged || !row.selectedCompletionMatchesActuallySelectedSuffix)) failures.push("a previous rollout mismatch changed decision or stayed inconsistent");

const output = {
  experiment: "self-consistent recursive completed-candidate orientation",
  checkpoint: { commit: CHECKPOINT_SHA, expectedBaselineHashes: EXPECTED_BASELINE_HASHES },
  policy: {
    finalCandidateCost: "node overlaps + proper crossings + segment-level unrelated node-edge intrusions",
    weights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    strictImprovement: true,
    tieBreak: "default",
    suffixCompletionPolicy: "same recursive completed-candidate policy",
    oldProductionCompletionUsed: false,
    memoizationBehaviorPreserving: true,
    pruningOrApproximation: false,
    pins: [],
  },
  fixtureReports,
  completionConsistencyAudit: {
    selectedCandidateMismatchCount: fixtureReports.reduce((sum, report) => sum + report.selectedCompletionMismatchCount, 0),
    previousRolloutMismatchesRevisited: revisitedPreviousMismatches,
  },
  exhaustiveOracleConclusion: {
    everyRecursiveResultIsGlobalMinimum: fixtureReports.every((report) => report.exhaustiveOracle.recursiveReachesGlobalMinimum),
    explanation: "The recursion explores both branches through every remaining fork and chooses the lower final scalar, so it is exact global N/C/I optimization. Default-on-tie makes the selected global minimum lexicographically default-first in the existing bottom-up order.",
  },
  freeze: {
    productionFilesChanged: false,
    geometryChanged: false,
    routingChanged: false,
    portsChanged: false,
    placementChanged: false,
    haltChanged: false,
    adaptiveMergeRaysChanged: false,
    loopEndpointRulesChanged: false,
    i57ReentryChanged: false,
    defectDefinitionsChanged: false,
    segmentLevelIntrusionCountingChanged: false,
    edgeOverlapScored: false,
    repairApplied: false,
    resultPromoted: false,
    resultCheckpointed: false,
  },
};

if (failures.length) throw new Error(`self-consistent completed-candidate probe failed: ${failures.join("; ")}`);
console.log(JSON.stringify(output, null, 2));
