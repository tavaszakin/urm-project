// Harness-only generalization probe: add unrelated node-edge intrusion count, at unit
// weight, to the scalar consumed by the unchanged bottom-up real-fork orientation pass.
// No production module, geometry rule, port, route, defect definition, pin, or repair changes.

import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildIntrusionAwareOrientationComparisonViews,
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
const EXPECTED_CHANGED_FORKS = {
  "minimization:bounded_sub": ["i-22"],
  "characteristic:divides": ["i-25"],
  "characteristic:eq": [],
  "primrec:basic": [],
  predecessor: [],
};
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const bitName = (orientation) => orientation?.no === "right" ? "flipped" : "default";

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

function orientationMap(view) {
  return Object.fromEntries([...view.orientationMap].map(([id, orientation]) => [id, bitName(orientation)]));
}

function finalDiagnostics(view) {
  const summary = summarizeView(view);
  return {
    nodeOverlapCount: summary.trueNodeOverlapCount,
    nodeOverlaps: summary.trueNodeOverlaps,
    properCrossingCount: summary.properCrossingCount,
    properCrossings: summary.properCrossings,
    edgeOverlapCount: summary.edgeOverlapCount,
    edgeOverlaps: summary.edgeOverlaps,
    unrelatedNodeEdgeIntrusionCount: summary.experimentalNodeEdgeIntrusionCount,
    unrelatedNodeEdgeIntrusions: summary.unrelatedNodeEdgeIntersections,
    oldProductionCost: summary.currentProductionStyleCost,
    intrusionAwareCost: summary.intrusionAwareOrientationCost,
    warnings: summary.warnings,
    fallbackOrRejectionFired: summary.fallbackOrRejectionFired,
  };
}

function conciseMaterialRow(row) {
  return {
    realForkId: row.realForkId,
    baselineDecision: row.baselineDecision,
    experimentalDecision: row.experimentalDecision,
    baselineMarginFlippedMinusDefault: row.baselineMarginFlippedMinusDefault,
    experimentalMarginFlippedMinusDefault: row.experimentalMarginFlippedMinusDefault,
    tieChanged: row.tieChanged,
    baselineCosts: {
      default: row.baselineEvaluation.default.oldProductionCost,
      flipped: row.baselineEvaluation.flipped.oldProductionCost,
    },
    experimentalCosts: {
      default: row.experimentalEvaluation.default.experimentalCost,
      flipped: row.experimentalEvaluation.flipped.experimentalCost,
    },
  };
}

const failures = [];
const fixtureReports = [];
for (const fixture of FIXTURES) {
  const raw = buildRawRoleOrdinaryTerminalView(programs[fixture], fixture);
  const result = buildIntrusionAwareOrientationComparisonViews(raw);
  const baselineDigest = geometryDigest(result.baseline);
  const experimentalDigest = geometryDigest(result.experimental);
  const changedForkIds = result.comparison.changedForks.map((row) => row.realForkId);
  const report = {
    fixture,
    baseline: {
      orientationMap: orientationMap(result.baseline),
      finalDiagnostics: finalDiagnostics(result.baseline),
      geometryDigest: baselineDigest,
      rareRepairCandidates: result.comparison.baselineRareRepairCandidates,
    },
    experimental: {
      orientationMap: orientationMap(result.experimental),
      finalDiagnostics: finalDiagnostics(result.experimental),
      geometryDigest: experimentalDigest,
      rareRepairCandidates: result.comparison.experimentalRareRepairCandidates,
      rareRepairApplied: false,
    },
    changedForkIds,
    changedForks: result.comparison.changedForks,
    materialUnchangedForks: result.comparison.materialUnchangedForks.map(conciseMaterialRow),
    spotlight: Object.fromEntries(
      ["i-22", "i-25", "i-48", "i-53"]
        .map((id) => [id, result.comparison.everyFork.find((row) => row.realForkId === id)])
        .filter(([, row]) => row),
    ),
  };
  fixtureReports.push(report);

  if (baselineDigest.sha256 !== EXPECTED_BASELINE_HASHES[fixture]) failures.push(`${fixture}: baseline hash mismatch`);
  if (JSON.stringify(changedForkIds) !== JSON.stringify(EXPECTED_CHANGED_FORKS[fixture])) failures.push(`${fixture}: unexpected changed fork set {${changedForkIds}}`);
  if (report.baseline.finalDiagnostics.fallbackOrRejectionFired || report.experimental.finalDiagnostics.fallbackOrRejectionFired) failures.push(`${fixture}: fallback or rejection fired`);
}

const bounded = fixtureReports.find((row) => row.fixture === "minimization:bounded_sub");
const boundedI22 = bounded.changedForks.find((row) => row.realForkId === "i-22");
if (!boundedI22
  || boundedI22.experimentalEvaluation.default.nodeOverlapCount !== 0
  || boundedI22.experimentalEvaluation.default.properCrossingCount !== 0
  || boundedI22.experimentalEvaluation.default.nodeEdgeIntrusionCount !== 1
  || boundedI22.experimentalEvaluation.default.experimentalCost !== 1
  || boundedI22.experimentalEvaluation.flipped.nodeOverlapCount !== 0
  || boundedI22.experimentalEvaluation.flipped.properCrossingCount !== 0
  || boundedI22.experimentalEvaluation.flipped.nodeEdgeIntrusionCount !== 0
  || boundedI22.experimentalEvaluation.flipped.experimentalCost !== 0
  || boundedI22.experimentalDecision !== "flipped") {
  failures.push("minimization:bounded_sub i-22 did not independently recover the 1/0 flip");
}
if (bounded.experimental.finalDiagnostics.unrelatedNodeEdgeIntrusionCount !== 0
  || bounded.experimental.finalDiagnostics.unrelatedNodeEdgeIntrusions.some((row) => row.edgeId === "i-24-jump" && row.nodeId === "i-26")) {
  failures.push("minimization:bounded_sub final layout retained i-24-jump × i-26");
}

const divides = fixtureReports.find((row) => row.fixture === "characteristic:divides");
if (divides.experimental.orientationMap["i-25"] !== "flipped"
  || divides.experimental.orientationMap["i-48"] !== "flipped"
  || divides.experimental.orientationMap["i-53"] !== "flipped") {
  failures.push("characteristic:divides i-25/i-48/i-53 orientation audit failed");
}
if (divides.baseline.finalDiagnostics.edgeOverlapCount !== 1 || divides.experimental.finalDiagnostics.edgeOverlapCount !== 1) {
  failures.push("characteristic:divides edge-overlap diagnostic changed");
}
if (!divides.experimental.rareRepairCandidates.some((row) => row.realForkId === "i-25" && row.baseTotal === 1 && row.repairedTotal === 0)) {
  failures.push("characteristic:divides rare-repair diagnostic did not expose i-25 counterexample");
}

const eq = fixtureReports.find((row) => row.fixture === "characteristic:eq");
if (eq.baseline.finalDiagnostics.edgeOverlapCount !== 1 || eq.experimental.finalDiagnostics.edgeOverlapCount !== 1) {
  failures.push("characteristic:eq edge-overlap diagnostic changed");
}

const output = {
  experiment: "intrusion-aware real-fork orientation cost",
  checkpoint: { commit: CHECKPOINT_SHA, expectedBaselineHashes: EXPECTED_BASELINE_HASHES },
  experimentalVariable: {
    baselineCost: "nodeOverlapCount + properCrossingCount",
    experimentalCost: "nodeOverlapCount + properCrossingCount + unrelatedNodeEdgeIntrusionCount",
    weights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    edgeOverlapScored: false,
    attachmentLegalityScored: false,
  },
  freeze: {
    productionFilesChanged: false,
    geometryConstructionChanged: false,
    routingChanged: false,
    portsChanged: false,
    loopGrammarChanged: false,
    adaptiveRayChanged: false,
    haltChanged: false,
    nodePlacementChanged: false,
    defectDefinitionsChanged: false,
    rareRepairBehaviorChanged: false,
    pins: [],
    postSelectionRepairApplied: false,
  },
  fixtureReports,
  conclusion: {
    boundedSubHypothesisConfirmed: true,
    boundedSubFinalIntrusionRemoved: true,
    counterexampleFound: true,
    counterexample: "characteristic:divides i-25 changes from a 3/3 production tie to a 7/6 intrusion-aware flip, leaving one final proper crossing; the unchanged rare-repair diagnostic identifies flipped→default as 1→0 but does not apply it",
    resultPromoted: false,
    resultCheckpointed: false,
  },
};

if (failures.length) throw new Error(`intrusion-aware orientation probe failed: ${failures.join("; ")}`);
console.log(JSON.stringify(output, null, 2));
