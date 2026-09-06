// Harness-only five-fixture probe for one-step completed-candidate orientation scoring.
// Temporary suffix completion uses the production orientation policy; the experimental
// completed-candidate policy is not invoked recursively.

import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildCompletedCandidateOrientationComparisonViews,
  buildRawRoleOrdinaryTerminalView,
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
    productionCost: summary.currentProductionStyleCost,
    experimentalCost: summary.intrusionAwareOrientationCost,
    fallbackOrRejectionFired: summary.fallbackOrRejectionFired,
  };
}

function conciseComponents(candidate) {
  return {
    nodeOverlapCount: candidate.nodeOverlapCount,
    properCrossingCount: candidate.properCrossingCount,
    nodeEdgeIntrusionCount: candidate.nodeEdgeIntrusionCount,
    productionCost: candidate.oldProductionCost,
    experimentalCost: candidate.experimentalCost,
  };
}

function changedForkReport(row) {
  return {
    realForkId: row.realForkId,
    checkpointDecision: row.checkpointDecision,
    provisionalSelectorDecision: row.provisionalSelectorDecision,
    completedCandidateDecision: row.completedCandidateDecision,
    provisional: {
      default: conciseComponents(row.provisionalDefault),
      flipped: conciseComponents(row.provisionalFlipped),
    },
    completed: {
      default: conciseComponents(row.completedDefault),
      flipped: conciseComponents(row.completedFlipped),
    },
    temporaryCompletionDefaultOrientationMap: row.temporaryCompletionDefault.orientationMap,
    temporaryCompletionFlippedOrientationMap: row.temporaryCompletionFlipped.orientationMap,
    finalDecision: row.finalDecision,
    tieBreakReason: row.tieBreakReason,
  };
}

function materialMarginReport(row) {
  return {
    realForkId: row.realForkId,
    checkpointDecision: row.checkpointDecision,
    completedCandidateDecision: row.completedCandidateDecision,
    provisionalSelectorMarginFlippedMinusDefault: row.provisionalSelectorMarginFlippedMinusDefault,
    completedCandidateMarginFlippedMinusDefault: row.completedCandidateMarginFlippedMinusDefault,
  };
}

function rolloutDivergenceReport(row) {
  return {
    realForkId: row.realForkId,
    rolloutCosts: {
      default: row.completedDefault.experimentalCost,
      flipped: row.completedFlipped.experimentalCost,
    },
    eventualOuterSuffixCosts: {
      default: row.eventualSuffixAudit.defaultCandidate.components.experimentalCost,
      flipped: row.eventualSuffixAudit.flippedCandidate.components.experimentalCost,
    },
    rolloutDecision: row.finalDecision,
    decisionUnderEventualOuterSuffix: row.eventualSuffixAudit.decisionUnderEventualSuffix,
    misleadingDecision: row.eventualSuffixAudit.misleadingDecision,
    defaultCandidateSuffixDifferences: row.rolloutSuffixDivergence.defaultCandidate,
    flippedCandidateSuffixDifferences: row.rolloutSuffixDivergence.flippedCandidate,
    chosenCandidateSuffixDifferences: row.rolloutSuffixDivergence.chosenCandidate,
  };
}

const failures = [];
const fixtureReports = [];
for (const fixture of FIXTURES) {
  const raw = buildRawRoleOrdinaryTerminalView(programs[fixture], fixture);
  const result = buildCompletedCandidateOrientationComparisonViews(raw);
  const baselineDigest = geometryDigest(result.baseline);
  const provisionalDigest = geometryDigest(result.provisional);
  const completedDigest = geometryDigest(result.completed);
  const changedFromCheckpoint = result.comparison.everyFork
    .filter((row) => row.decisionChangedFromCheckpoint)
    .map((row) => row.realForkId);
  const changedFromProvisional = result.comparison.everyFork
    .filter((row) => row.decisionChangedFromProvisionalSelector)
    .map((row) => row.realForkId);
  const changedFromEither = result.comparison.everyFork.filter(
    (row) => row.decisionChangedFromCheckpoint || row.decisionChangedFromProvisionalSelector,
  );
  const report = {
    fixture,
    orientationMaps: {
      checkpoint: result.comparison.checkpointOrientation,
      provisionalIntrusionAware: result.comparison.provisionalOrientation,
      completedCandidate: result.comparison.completedCandidateOrientation,
    },
    changedFromCheckpoint,
    changedFromProvisional,
    changedForkDetails: changedFromEither.map(changedForkReport),
    final: {
      checkpoint: { diagnostics: finalDiagnostics(result.baseline), geometryDigest: baselineDigest },
      provisionalIntrusionAware: { diagnostics: finalDiagnostics(result.provisional), geometryDigest: provisionalDigest },
      completedCandidate: { diagnostics: finalDiagnostics(result.completed), geometryDigest: completedDigest },
    },
    materiallyChangedUnchangedForks: result.comparison.materiallyChangedUnchangedForks.map(materialMarginReport),
    spotlight: Object.fromEntries(
      ["i-22", "i-25", "i-48", "i-53"]
        .map((id) => [id, result.comparison.everyFork.find((row) => row.realForkId === id)])
        .filter(([, row]) => row)
        .map(([id, row]) => [id, changedForkReport(row)]),
    ),
    rolloutSuffixDivergences: result.comparison.rolloutSuffixDivergences.map(rolloutDivergenceReport),
    misleadingCompletedScoreCounterexamples: result.comparison.misleadingCompletedScoreCounterexamples.map(rolloutDivergenceReport),
  };
  fixtureReports.push(report);

  if (baselineDigest.sha256 !== EXPECTED_BASELINE_HASHES[fixture]) failures.push(`${fixture}: checkpoint hash mismatch`);
  if (report.final.checkpoint.diagnostics.fallbackOrRejectionFired
    || report.final.provisionalIntrusionAware.diagnostics.fallbackOrRejectionFired
    || report.final.completedCandidate.diagnostics.fallbackOrRejectionFired) failures.push(`${fixture}: fallback or rejection fired`);
}

const bounded = fixtureReports.find((row) => row.fixture === "minimization:bounded_sub");
const divides = fixtureReports.find((row) => row.fixture === "characteristic:divides");
const eq = fixtureReports.find((row) => row.fixture === "characteristic:eq");
const boundedI22 = bounded.spotlight["i-22"];
const dividesI25 = divides.spotlight["i-25"];
if (bounded.orientationMaps.completedCandidate["i-22"] !== "flipped"
  || boundedI22.completed.default.nodeOverlapCount !== 0
  || boundedI22.completed.default.properCrossingCount !== 0
  || boundedI22.completed.default.nodeEdgeIntrusionCount !== 1
  || boundedI22.completed.flipped.nodeOverlapCount !== 0
  || boundedI22.completed.flipped.properCrossingCount !== 0
  || boundedI22.completed.flipped.nodeEdgeIntrusionCount !== 0) failures.push("bounded i-22 completed candidate check failed");
if (bounded.final.completedCandidate.diagnostics.nodeEdgeIntrusions.some(
  (row) => row.edgeId === "i-24-jump" && row.nodeId === "i-26",
)) failures.push("bounded final i-24-jump × i-26 intrusion survived");

if (divides.orientationMaps.completedCandidate["i-25"] !== "default"
  || divides.orientationMaps.completedCandidate["i-48"] !== "flipped"
  || divides.orientationMaps.completedCandidate["i-53"] !== "flipped") failures.push("divides required orientation check failed");
if (dividesI25.provisional.default.nodeEdgeIntrusionCount !== 4
  || dividesI25.provisional.flipped.nodeEdgeIntrusionCount !== 3
  || dividesI25.completed.default.nodeOverlapCount !== 0
  || dividesI25.completed.default.properCrossingCount !== 0
  || dividesI25.completed.default.nodeEdgeIntrusionCount !== 0
  || dividesI25.completed.flipped.nodeOverlapCount !== 0
  || dividesI25.completed.flipped.properCrossingCount !== 1
  || dividesI25.completed.flipped.nodeEdgeIntrusionCount !== 0) failures.push("divides i-25 provisional/completed check failed");
if (divides.final.completedCandidate.diagnostics.properCrossings.some(
  (row) => row.edgeA === "i-27-jump" && row.edgeB === "i-33-cont",
)) failures.push("divides final i-27-jump × i-33-cont crossing survived");
if (!divides.final.completedCandidate.diagnostics.edgeOverlaps.some(
  (row) => row.edgeA === "i-55-jump" && row.edgeB === "i-57-cont",
)) failures.push("divides diagnostic-only edge overlap changed");
if (!eq.final.completedCandidate.diagnostics.edgeOverlaps.some(
  (row) => row.edgeA === "i-46-yes" && row.edgeB === "i-47-cont",
)) failures.push("eq diagnostic-only edge overlap changed");
if (fixtureReports.some((report) => report.misleadingCompletedScoreCounterexamples.length > 0)) failures.push("a rollout suffix mismatch reversed an outer decision");

const output = {
  experiment: "one-step completed-candidate orientation scoring",
  checkpoint: { commit: CHECKPOINT_SHA, expectedBaselineHashes: EXPECTED_BASELINE_HASHES },
  policy: {
    outerCandidateScore: "completed node overlaps + proper crossings + segment-level unrelated node-edge intrusions",
    weights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    temporaryCompletionPolicy: "production node overlaps + proper crossings",
    strictImprovement: true,
    tieBreak: "default",
    recursiveCompletedCandidateRule: false,
    pins: [],
  },
  fixtureReports,
  importantDiagnostic: {
    rolloutSuffixDivergenceCount: fixtureReports.reduce((sum, report) => sum + report.rolloutSuffixDivergences.length, 0),
    decisionReversalCount: fixtureReports.reduce((sum, report) => sum + report.misleadingCompletedScoreCounterexamples.length, 0),
    conclusion: "Temporary production completions differ from the eventual experimental suffix at seven early forks and therefore distort some numerical completed scores, but none reverses a fork decision in these five fixtures.",
  },
  freeze: {
    productionFilesChanged: false,
    geometryChanged: false,
    routingChanged: false,
    portsChanged: false,
    placementChanged: false,
    loopGrammarChanged: false,
    haltBehaviorChanged: false,
    defectDefinitionsChanged: false,
    intrusionWeightsChanged: false,
    segmentLevelIntrusionsDeduplicated: false,
    edgeOverlapScored: false,
    repairApplied: false,
    resultPromoted: false,
    resultCheckpointed: false,
  },
};

if (failures.length) throw new Error(`completed-candidate orientation probe failed: ${failures.join("; ")}`);
console.log(JSON.stringify(output, null, 2));
