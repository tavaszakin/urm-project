// Harness-only scoring experiment for the frozen endpoint-transition ownership
// grammar. The selector is local and provisional: two ordinary candidates per
// focus fork, deepest-first, strict improvement, default on ties.

import fs from "node:fs";

import { runLocalOrientationSweep } from "./endpoint_transition_intrusion_scoring.mjs";

const CHECKPOINT = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const FIXTURES = [
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
];
const EXPECTED_CHECKPOINT_ORIENTATIONS = {
  "minimization:bounded_sub": { "i-10": "D", "i-12": "D", "i-15": "D", "i-22": "D" },
  "characteristic:divides": {
    "i-13": "D", "i-15": "D", "i-18": "D", "i-25": "D", "i-3": "D",
    "i-36": "D", "i-38": "D", "i-4": "D", "i-41": "D", "i-48": "F", "i-53": "F",
  },
  "characteristic:eq": {
    "i-11": "D", "i-14": "D", "i-29": "D", "i-31": "D",
    "i-34": "D", "i-43": "D", "i-46": "D", "i-9": "D",
  },
  "primrec:basic": { "i-13": "D", "i-5": "D" },
  predecessor: { "i-0": "D", "i-2": "D" },
};
const EXPECTED_FINAL_DIAGNOSTICS = {
  "minimization:bounded_sub": [0, 0, 0, 0],
  "characteristic:divides": [0, 1, 0, 0],
  "characteristic:eq": [0, 1, 0, 0],
  "primrec:basic": [0, 0, 0, 0],
  predecessor: [0, 0, 0, 0],
};
const BENCHMARK_TRIALS = 7;
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const relationName = (relation) => relation === 0 ? "tie" : relation < 0 ? "F-lower" : "D-lower";
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function eventRecord(row) {
  return {
    fixture: row.fixture,
    focusFork: row.focusFork,
    candidate: row.candidate,
    phase: row.phase,
    transition: row.transition,
    segmentSide: row.segmentSide,
    ownershipReason: row.ownershipReason,
    edgeId: row.edgeId,
    nodeId: row.nodeId,
    segmentIndex: row.segmentIndex,
    routeSegmentCount: row.routeSegmentCount,
    intersectingSegment: row.intersectingSegment,
    intersectionInterval: row.intersectionInterval,
    edgeSource: row.edgeSource,
    edgeTarget: row.edgeTarget,
    edgeBranch: row.edgeBranch,
    edgeRole: row.edgeRole,
    routeFamily: row.routeFamily,
    sourceBranchPath: row.sourceBranchPath,
    semanticDepartureToken: row.semanticDepartureToken,
    departurePath: row.departurePath,
    targetPath: row.targetPath,
    nodePath: row.nodePath,
    departureState: row.departureState,
    targetState: row.targetState,
    nodeSide: row.nodeMembership.side?.toUpperCase() ?? null,
    directlyAttributable: row.directlyAttributable,
  };
}

function costRecord(metrics) {
  return {
    nodeOverlaps: metrics.nodeOverlaps,
    properCrossings: metrics.properCrossings,
    ownedIntrusions: metrics.ownedIntrusionCount,
    rawIntrusions: metrics.rawIntrusionCount,
    productionTotal: metrics.productionCost,
    transitionAwareTotal: metrics.total,
    ownedEvents: metrics.ownedIntrusions.map(eventRecord),
  };
}

function candidateRecord(row, checkpointDecision) {
  return {
    fixture: row.fixture,
    focusFork: row.focusFork,
    checkpointDecision,
    decision: row.decision,
    default: costRecord(row.default),
    flipped: costRecord(row.flipped),
    productionRelation: relationName(row.productionRelation),
    transitionAwareRelation: relationName(row.transitionAwareRelation),
    productionTieChanged: row.productionRelation === 0 && row.transitionAwareRelation !== 0,
    transitionAwareTieCreated: row.productionRelation !== 0 && row.transitionAwareRelation === 0,
    productionMarginDMinusF: row.default.productionCost - row.flipped.productionCost,
    transitionAwareMarginDMinusF: row.default.total - row.flipped.total,
  };
}

function finalDiagnostics(result) {
  const summary = result.finalSummary;
  return {
    properCrossings: summary.properCrossingCount,
    edgeOverlaps: summary.edgeOverlapCount,
    nodeOverlaps: summary.trueNodeOverlapCount,
    nodeEdgeIntrusions: summary.experimentalNodeEdgeIntrusionCount,
    properCrossingDetails: summary.properCrossings,
    edgeOverlapDetails: summary.edgeOverlaps,
    nodeOverlapDetails: summary.trueNodeOverlaps,
    nodeEdgeIntrusionDetails: summary.unrelatedNodeEdgeIntersections,
  };
}

function changedForks(checkpointMap, experimentalMap) {
  return Object.keys(experimentalMap).filter((forkId) => checkpointMap[forkId] !== experimentalMap[forkId]);
}

function sumRuntime(results, field) {
  return results.reduce((sum, result) => sum + result.runtime[field], 0);
}

function runAll(ownedIntrusionScoring) {
  return FIXTURES.map((fixture) => runLocalOrientationSweep(
    programs[fixture],
    fixture,
    { ownedIntrusionScoring },
  ));
}

const reportStarted = performance.now();
const checkpointRuns = runAll(false);
const experimentalRuns = runAll(true);
const allCandidateRecords = experimentalRuns.flatMap((result) => result.candidates.map((row) => candidateRecord(
  row,
  EXPECTED_CHECKPOINT_ORIENTATIONS[result.fixture][row.focusFork],
)));
const allOwnedEvents = allCandidateRecords.flatMap((row) => [
  ...row.default.ownedEvents,
  ...row.flipped.ownedEvents,
]);
const fixtureComparisons = experimentalRuns.map((experimental, index) => {
  const checkpoint = checkpointRuns[index];
  return {
    fixture: experimental.fixture,
    checkpointOrientationMap: checkpoint.orientationMap,
    expectedCheckpointOrientationMap: EXPECTED_CHECKPOINT_ORIENTATIONS[experimental.fixture],
    transitionAwareOrientationMap: experimental.orientationMap,
    changedForks: changedForks(checkpoint.orientationMap, experimental.orientationMap),
    finalDiagnostics: finalDiagnostics(experimental),
    controlFinalDiagnostics: finalDiagnostics(checkpoint),
    bottomUpOrder: experimental.bottomUpOrder,
    candidates: allCandidateRecords.filter((row) => row.fixture === experimental.fixture),
  };
});

const findCandidate = (fixture, focusFork) => allCandidateRecords
  .find((row) => row.fixture === fixture && row.focusFork === focusFork);
const boundedI22 = findCandidate("minimization:bounded_sub", "i-22");
const dividesI25 = findCandidate("characteristic:divides", "i-25");
const dividesI48 = findCandidate("characteristic:divides", "i-48");
const dividesI53 = findCandidate("characteristic:divides", "i-53");
const affectedCandidates = allCandidateRecords.filter((row) =>
  row.default.ownedIntrusions > 0 || row.flipped.ownedIntrusions > 0);
const marginChangedCandidates = allCandidateRecords.filter((row) =>
  row.default.ownedIntrusions !== row.flipped.ownedIntrusions);
const tiesChanged = allCandidateRecords.filter((row) =>
  row.productionTieChanged || row.transitionAwareTieCreated);
const bodyOwnedSignals = allOwnedEvents.filter((row) => row.phase === "body"
  && row.ownershipReason === "same-side-endpoint-consensus");
const targetLocalArrivalSignals = allOwnedEvents.filter((row) => row.phase === "arrival"
  && row.ownershipReason === "target-side-from-outside");
const changedForkAudits = fixtureComparisons.flatMap((fixture) => fixture.changedForks.map((focusFork) => {
  const candidate = findCandidate(fixture.fixture, focusFork);
  return {
    fixture: fixture.fixture,
    focusFork,
    checkpointDecision: candidate.checkpointDecision,
    transitionAwareDecision: candidate.decision,
    default: candidate.default,
    flipped: candidate.flipped,
    ownedIntrusionsResponsible: [
      ...candidate.default.ownedEvents,
      ...candidate.flipped.ownedEvents,
    ],
    finalDiagnostics: fixture.finalDiagnostics,
  };
}));
const reportCoreCompletedMs = performance.now() - reportStarted;

// Warm both paths before taking alternating timing samples. These repetitions
// measure the same local algorithms; the logical experiment above still uses
// exactly one 54-candidate sweep per selector.
runAll(false);
runAll(true);
const benchmark = [];
for (let trial = 0; trial < BENCHMARK_TRIALS; trial += 1) {
  const control = runAll(false);
  const experimental = runAll(true);
  benchmark.push({
    trial: trial + 1,
    controlSelectionMs: sumRuntime(control, "selectionMs"),
    experimentalSelectionMs: sumRuntime(experimental, "selectionMs"),
    controlTotalProbeMs: sumRuntime(control, "totalProbeMs"),
    experimentalTotalProbeMs: sumRuntime(experimental, "totalProbeMs"),
  });
}

const failures = [];
for (const fixture of fixtureComparisons) {
  if (JSON.stringify(fixture.checkpointOrientationMap) !== JSON.stringify(fixture.expectedCheckpointOrientationMap)) {
    failures.push(`${fixture.fixture}: independently rerun checkpoint selector changed`);
  }
  const actualDiagnostics = [
    fixture.finalDiagnostics.properCrossings,
    fixture.finalDiagnostics.edgeOverlaps,
    fixture.finalDiagnostics.nodeOverlaps,
    fixture.finalDiagnostics.nodeEdgeIntrusions,
  ];
  if (JSON.stringify(actualDiagnostics) !== JSON.stringify(EXPECTED_FINAL_DIAGNOSTICS[fixture.fixture])) {
    failures.push(`${fixture.fixture}: unexpected final diagnostics ${JSON.stringify(actualDiagnostics)}`);
  }
}
if (experimentalRuns.reduce((sum, row) => sum + row.realForkCount, 0) !== 27) failures.push("real-fork count is not 27");
if (experimentalRuns.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0) !== 54) failures.push("experimental candidate realization count is not 54");
if (boundedI22.decision !== "F" || boundedI22.default.ownedIntrusions !== 1 || boundedI22.flipped.ownedIntrusions !== 0) failures.push("bounded_sub i-22 did not select F from owned count 1/0");
if (dividesI25.decision !== "D" || dividesI25.default.rawIntrusions !== 4 || dividesI25.flipped.rawIntrusions !== 3 || dividesI25.default.ownedIntrusions !== 0 || dividesI25.flipped.ownedIntrusions !== 0) failures.push("divides i-25 regression failed");
if (dividesI48.decision !== "F" || dividesI53.decision !== "F") failures.push("divides i-48/i-53 did not remain F/F");
const dividesFinal = fixtureComparisons.find((row) => row.fixture === "characteristic:divides").finalDiagnostics;
if (dividesFinal.properCrossingDetails.some((row) => [row.edgeA, row.edgeB].includes("i-27-jump") && [row.edgeA, row.edgeB].includes("i-33-cont"))) failures.push("divides i-27-jump × i-33-cont returned");
const changed = fixtureComparisons.flatMap((row) => row.changedForks.map((focusFork) => `${row.fixture}:${focusFork}`));
if (JSON.stringify(changed) !== JSON.stringify(["minimization:bounded_sub:i-22"])) failures.push(`unexpected changed forks: ${JSON.stringify(changed)}`);

const report = {
  experiment: "endpoint-transition intrusion local scoring",
  checkpoint: CHECKPOINT,
  scoringRule: {
    candidateCost: "node-node overlaps + proper edge-edge crossings + focus-fork-owned node-edge intrusions",
    weights: { nodeOverlap: 1, properCrossing: 1, ownedIntrusion: 1 },
    rawUnownedIntrusionsAffectDecision: false,
    order: "existing deepest-first real-fork order",
    decision: "flip only on strict improvement; tie selects default",
    candidateState: "ordinary provisional D/F realization only",
  },
  frozenOwnershipGrammar: {
    departureSide: "source ancestry plus direct semantic YES/NO departure token",
    targetSide: "target ancestry",
    states: ["YES", "NO", "OUTSIDE"],
    departure: "YES/NO owns departure; OUTSIDE is unowned",
    body: "only YES→YES and NO→NO own the body",
    arrival: "same-side and OUTSIDE→YES/NO own arrival; opposite-side and target-OUTSIDE are withheld/unowned",
    direct: "immediate-side endpoint consensus",
  },
  invariants: {
    productionFilesChanged: false,
    geometryChanged: false,
    routeOrPortChanges: false,
    orientationOrderChanged: false,
    weightsChanged: false,
    pins: [],
    lookaheadOrCompletion: false,
    recursionOrGlobalSearch: false,
    repair: false,
    promotion: false,
    checkpointCreated: false,
  },
  fixtureComparisons,
  everyForkCostDecomposition: allCandidateRecords,
  changedForkAudits,
  requiredCases: {
    boundedSubI22: boundedI22,
    boundedFinalIntrusionAbsent: fixtureComparisons
      .find((row) => row.fixture === "minimization:bounded_sub")
      .finalDiagnostics.nodeEdgeIntrusionDetails
      .every((row) => row.edgeId !== "i-24-jump" || row.nodeId !== "i-26"),
    dividesI25,
    dividesFinalI27JumpByI33ContAbsent: !dividesFinal.properCrossingDetails.some((row) =>
      [row.edgeA, row.edgeB].includes("i-27-jump") && [row.edgeA, row.edgeB].includes("i-33-cont")),
    dividesI48,
    dividesI53,
  },
  generalizationAudit: {
    candidatesWithAnyOwnedSignal: affectedCandidates,
    candidatesWhoseMarginChanges: marginChangedCandidates,
    bodyOwnedSignals,
    bodyOwnedSignalCount: bodyOwnedSignals.length,
    targetLocalOutsideToArrivalSignals: targetLocalArrivalSignals,
    targetLocalOutsideToArrivalSignalCount: targetLocalArrivalSignals.length,
    productionTiesChanged: tiesChanged,
    unvalidatedFixtureDirections: ["NO → YES", "arrival-phase OUTSIDE → NO"],
  },
  work: {
    realForks: experimentalRuns.reduce((sum, row) => sum + row.realForkCount, 0),
    experimentalCandidateDiagramRealizations: experimentalRuns.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0),
    separateControlCandidateDiagramRealizations: checkpointRuns.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0),
    ownedIntrusionClassifications: experimentalRuns.reduce((sum, row) => sum + row.classifiedIntrusionCount, 0),
    localMembershipReads: experimentalRuns.reduce((sum, row) => sum + row.membershipReads, 0),
    diagnosticAllForkClassificationInSelector: false,
    oneFinalNonCandidateRealizationPerFixture: true,
    measuredBenchmarkTrials: BENCHMARK_TRIALS,
    measuredBenchmarkCandidateRealizationsPerPath: 54,
    singleRun: {
      controlSelectionMs: sumRuntime(checkpointRuns, "selectionMs"),
      experimentalSelectionMs: sumRuntime(experimentalRuns, "selectionMs"),
      controlTotalProbeMs: sumRuntime(checkpointRuns, "totalProbeMs"),
      experimentalTotalProbeMs: sumRuntime(experimentalRuns, "totalProbeMs"),
      reportCoreCompletedMs,
    },
    benchmark,
    median: {
      controlSelectionMs: median(benchmark.map((row) => row.controlSelectionMs)),
      experimentalSelectionMs: median(benchmark.map((row) => row.experimentalSelectionMs)),
      controlTotalProbeMs: median(benchmark.map((row) => row.controlTotalProbeMs)),
      experimentalTotalProbeMs: median(benchmark.map((row) => row.experimentalTotalProbeMs)),
    },
    priorCensusMediansMs: {
      sourcePath: 398,
      departureToken: 407.6,
      positionalPhase: 409.1,
      endpointTransition: 457,
    },
  },
  conclusion: {
    onlyExpectedForkChanged: changed.length === 1 && changed[0] === "minimization:bounded_sub:i-22",
    boundedSubSignalRecovered: boundedI22.decision === "F",
    dividesI25ProtectedFromRawIntrusions: dividesI25.decision === "D",
    dividesI48AndI53Preserved: dividesI48.decision === "F" && dividesI53.decision === "F",
    unexpectedOrientationChange: false,
    finalDiagnosticsMatchExpected: failures.length === 0,
    evidenceScope: "supported on the current five fixtures; untested directions remain",
    scoringExperimentRun: true,
    resultPromoted: false,
    resultCheckpointed: false,
  },
};

if (failures.length) throw new Error(`endpoint-transition scoring experiment failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
