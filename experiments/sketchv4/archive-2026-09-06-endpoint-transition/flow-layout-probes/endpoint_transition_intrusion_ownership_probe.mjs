// Harness-only census of the fixed endpoint-state / segment-phase transition table.
// It reproduces ordinary provisional D/F candidates without scoring intrusions.

import fs from "node:fs";

import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
  summarizeView,
} from "./current_harness.mjs";
import { classifyViewIntrusionsByEndpointTransition } from "./endpoint_transition_intrusion_ownership.mjs";

const CHECKPOINT = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const FIXTURES = [
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
];
const TRANSITIONS = [
  "YES → YES", "YES → NO", "YES → OUTSIDE",
  "NO → NO", "NO → YES", "NO → OUTSIDE",
  "OUTSIDE → YES", "OUTSIDE → NO", "OUTSIDE → OUTSIDE",
];
const DEFAULT = Object.freeze({ no: "left", yes: "right" });
const FLIPPED = Object.freeze({ no: "right", yes: "left" });
const EXPECTED_CONTROL_ORIENTATIONS = {
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
const ORIGINAL_WHOLE_EDGE_FALSE_POSITIVES = [
  ["minimization:bounded_sub", "i-12", "F", "i-12-yes", "i-16"],
  ["characteristic:divides", "i-38", "F", "i-38-yes", "i-42"],
  ["characteristic:divides", "i-15", "F", "i-15-yes", "i-19"],
  ["characteristic:divides", "i-53", "D", "i-53-yes", "i-54"],
  ["characteristic:eq", "i-31", "F", "i-31-yes", "i-35"],
  ["characteristic:eq", "i-11", "F", "i-11-yes", "i-15"],
  ["predecessor", "i-0", "F", "i-0-yes", "i-4"],
];
const PLAUSIBLE_TARGET_LOCAL_ARRIVALS = [
  ["minimization:bounded_sub", "i-15", "F", "i-12-yes", "i-16"],
  ["characteristic:divides", "i-41", "F", "i-38-yes", "i-42"],
  ["characteristic:divides", "i-18", "F", "i-15-yes", "i-19"],
  ["characteristic:divides", "i-4", "F", "i-53-yes", "i-5"],
  ["characteristic:eq", "i-34", "F", "i-31-yes", "i-35"],
  ["characteristic:eq", "i-14", "F", "i-11-yes", "i-15"],
  ["predecessor", "i-2", "F", "i-0-yes", "i-4"],
];
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const bitName = (orientation) => orientation?.no === "right" ? "F" : "D";
const countBy = (rows, predicate) => rows.filter(predicate).length;

function transitionCensus(rows) {
  return Object.fromEntries(TRANSITIONS.map((transition) => {
    const selected = rows.filter((row) => row.transition === transition);
    return [transition, {
      intrusionEvents: selected.length,
      departureEvents: countBy(selected, (row) => row.phase === "departure"),
      bodyEvents: countBy(selected, (row) => row.phase === "body"),
      arrivalEvents: countBy(selected, (row) => row.phase === "arrival"),
      directEvents: countBy(selected, (row) => row.phase === "direct"),
      attributedEvents: countBy(selected, (row) => row.directlyAttributable),
      unattributedEvents: countBy(selected, (row) => row.classification === "unattributed"),
      unresolvedEvents: countBy(selected, (row) => row.classification === "direct-segment-unresolved"),
      ambiguousEvents: countBy(selected, (row) => row.classification === "ambiguous"),
      ownedSegmentEvents: countBy(selected, (row) => row.segmentSide != null),
      unownedSegmentEvents: countBy(selected, (row) => row.segmentSide == null),
    }];
  }));
}

function census(rows) {
  return {
    intrusionEvents: rows.length,
    transitionClasses: transitionCensus(rows),
    directlyAttributable: countBy(rows, (row) => row.directlyAttributable),
    unattributed: countBy(rows, (row) => row.classification === "unattributed"),
    directSegmentUnresolved: countBy(rows, (row) => row.directSegmentUnresolved),
    ambiguous: countBy(rows, (row) => row.ambiguous),
    multiFork: countBy(rows, (row) => row.transitionAppearsAttributableToMultipleForks),
    ownedSegmentEvents: countBy(rows, (row) => row.segmentSide != null),
    unownedSegmentEvents: countBy(rows, (row) => row.segmentSide == null),
    positionalPhaseAttributionsChanged: countBy(rows, (row) => row.positionalPhaseAttributionChanged),
  };
}

function eventRecord(row) {
  return {
    fixture: row.fixture,
    focusFork: row.focusFork,
    candidate: row.candidate,
    edgeId: row.edgeId,
    nodeId: row.nodeId,
    segmentIndex: row.segmentIndex,
    intersectingSegment: row.intersectingSegment,
    intersectionInterval: row.intersectionInterval,
    routeSegmentCount: row.routeSegmentCount,
    edgeSource: row.edgeSource,
    edgeTarget: row.edgeTarget,
    edgeRole: row.edgeRole,
    routeFamily: row.routeFamily,
    phase: row.phase,
    sourceBranchPath: row.sourceBranchPath,
    semanticDepartureToken: row.semanticDepartureToken,
    departurePath: row.departurePath,
    targetPath: row.targetPath,
    nodePath: row.nodePath,
    departureState: row.departureState,
    targetState: row.targetState,
    transition: row.transition,
    segmentSide: row.segmentSide,
    ownershipReason: row.ownershipReason,
    positionalPhaseClassification: row.positionalPhaseClassification,
    transitionClassification: row.classification,
    attributedForks: row.transitionAttributableForks,
  };
}

function candidateReport({ fixture, focusFork, candidate, view }) {
  const summary = summarizeView(view);
  const intrusions = classifyViewIntrusionsByEndpointTransition(
    view,
    focusFork,
    { fixture, candidate },
    { scanAllForks: true },
  );
  return {
    focusFork,
    candidate,
    productionCost: view.defects.total,
    nodeOverlapCount: summary.trueNodeOverlapCount,
    properCrossingCount: summary.properCrossingCount,
    census: census(intrusions),
    intrusions,
  };
}

function orientationSweepCensus(program, fixture) {
  const raw = buildRawRoleOrdinaryTerminalBase(program, fixture);
  const { realizeEndpoints } = buildComposedLoopEndpointRealizer(raw);
  const orientationMap = new Map(raw.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const candidates = [];
  let candidateDiagramRealizations = 0;
  const started = performance.now();
  for (const focusFork of raw.tree.bottomUp) {
    orientationMap.set(focusFork, { ...DEFAULT });
    const defaultView = realizeEndpoints(orientationMap);
    candidateDiagramRealizations += 1;
    const defaultCandidate = candidateReport({ fixture, focusFork, candidate: "D", view: defaultView });

    orientationMap.set(focusFork, { ...FLIPPED });
    const flippedView = realizeEndpoints(orientationMap);
    candidateDiagramRealizations += 1;
    const flippedCandidate = candidateReport({ fixture, focusFork, candidate: "F", view: flippedView });

    const chooseFlipped = flippedCandidate.productionCost < defaultCandidate.productionCost;
    orientationMap.set(focusFork, { ...(chooseFlipped ? FLIPPED : DEFAULT) });
    candidates.push(defaultCandidate, flippedCandidate);
  }
  const elapsedMs = performance.now() - started;
  const intrusions = candidates.flatMap((candidate) => candidate.intrusions);
  return {
    fixture,
    realForkCount: raw.roles.realForkIds.length,
    bottomUpOrder: raw.tree.bottomUp,
    productionOrientationMap: Object.fromEntries([...orientationMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, orientation]) => [id, bitName(orientation)])),
    candidateDiagramRealizations,
    focusTransitionClassifications: intrusions.length,
    allForkTransitionClassifications: intrusions.length * raw.roles.realForkIds.length,
    elapsedMs,
    census: census(intrusions),
    candidates,
  };
}

const fixtureReports = FIXTURES.map((fixture) => orientationSweepCensus(programs[fixture], fixture));
const allIntrusions = fixtureReports.flatMap((fixture) => fixture.candidates.flatMap((candidate) => candidate.intrusions));
const candidateFor = (fixture, focusFork, candidate) => fixtureReports
  .find((row) => row.fixture === fixture)?.candidates
  .find((row) => row.focusFork === focusFork && row.candidate === candidate);
const eventsFor = (fixture, focusFork, candidate, edgeId, nodeId) => candidateFor(fixture, focusFork, candidate)
  .intrusions.filter((row) => row.edgeId === edgeId && row.nodeId === nodeId);
const recordsFor = (cases) => cases.flatMap(([fixture, focusFork, candidate, edgeId, nodeId]) =>
  eventsFor(fixture, focusFork, candidate, edgeId, nodeId).map(eventRecord));
const ownedCount = (candidate) => countBy(candidate.intrusions, (row) => row.directlyAttributable);

const boundedDefault = candidateFor("minimization:bounded_sub", "i-22", "D");
const boundedFlipped = candidateFor("minimization:bounded_sub", "i-22", "F");
const dividesI25Default = candidateFor("characteristic:divides", "i-25", "D");
const dividesI25Flipped = candidateFor("characteristic:divides", "i-25", "F");
const knownDividesPairs = [
  ["i-53-yes", "i-54"],
  ["i-55-jump", "i-49"],
  ["i-55-jump", "i-50"],
  ["i-57-cont", "i-55"],
];
const previousBodyConflicts = allIntrusions.filter((row) => row.bodyEndpointConsensusDirect);
const ownedBodyIntrusions = allIntrusions.filter((row) => row.phase === "body" && row.directlyAttributable);
const newBodyAttributionsWithoutEndpointConsensus = ownedBodyIntrusions
  .filter((row) => !row.bodyEndpointConsensusDirect);
const badArrival = eventsFor("characteristic:divides", "i-3", "F", "i-53-yes", "i-54");
const plausibleArrivals = recordsFor(PLAUSIBLE_TARGET_LOCAL_ARRIVALS)
  .filter((row) => row.phase === "arrival");
const originalWholeEdgeFalsePositives = recordsFor(ORIGINAL_WHOLE_EDGE_FALSE_POSITIVES);
const lostPositionalArrivalAttributions = allIntrusions.filter((row) => row.phase === "arrival"
  && row.positionalPhaseDirectlyAttributable
  && !row.directlyAttributable);
const oppositeTransitionUnowned = allIntrusions.filter((row) => (row.transition === "YES → NO" || row.transition === "NO → YES")
  && (row.phase === "body" || row.phase === "arrival")
  && row.segmentSide == null);

const requiredCases = {
  boundedSubI22: {
    default: eventsFor("minimization:bounded_sub", "i-22", "D", "i-24-jump", "i-26").map(eventRecord),
    flipped: eventsFor("minimization:bounded_sub", "i-22", "F", "i-24-jump", "i-26").map(eventRecord),
    ownedCounts: { D: ownedCount(boundedDefault), F: ownedCount(boundedFlipped) },
  },
  dividesI25: {
    default: knownDividesPairs.flatMap(([edgeId, nodeId]) => dividesI25Default.intrusions
      .filter((row) => row.edgeId === edgeId && row.nodeId === nodeId)).map(eventRecord),
    flipped: knownDividesPairs.flatMap(([edgeId, nodeId]) => dividesI25Flipped.intrusions
      .filter((row) => row.edgeId === edgeId && row.nodeId === nodeId)).map(eventRecord),
    rawCounts: { D: dividesI25Default.intrusions.length, F: dividesI25Flipped.intrusions.length },
    ownedCounts: { D: ownedCount(dividesI25Default), F: ownedCount(dividesI25Flipped) },
  },
  bodyConflicts: previousBodyConflicts.map(eventRecord),
  badArrival: badArrival.map(eventRecord),
  plausibleTargetLocalArrivals: plausibleArrivals,
  originalWholeEdgeFalsePositives,
};

const failures = [];
if (fixtureReports.reduce((sum, row) => sum + row.realForkCount, 0) !== 27) failures.push("real-fork census is no longer 27");
if (fixtureReports.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0) !== 54) failures.push("candidate realization census is no longer 54");
if (allIntrusions.length !== 136) failures.push("intrusion-event census is no longer 136");
for (const fixtureReport of fixtureReports) {
  if (JSON.stringify(fixtureReport.productionOrientationMap) !== JSON.stringify(EXPECTED_CONTROL_ORIENTATIONS[fixtureReport.fixture])) {
    failures.push(`${fixtureReport.fixture}: production control orientation sequence changed`);
  }
}
if (JSON.stringify(requiredCases.boundedSubI22.ownedCounts) !== JSON.stringify({ D: 1, F: 0 })) failures.push("bounded_sub i-22 is not D=1/F=0");
if (JSON.stringify(requiredCases.dividesI25.ownedCounts) !== JSON.stringify({ D: 0, F: 0 })) failures.push("divides i-25 gained an owned intrusion");
if (previousBodyConflicts.length !== 8 || previousBodyConflicts.some((row) => !row.directlyAttributable)) failures.push("the eight endpoint-consensus body conflicts were not all recovered");
if (badArrival.length !== 1 || badArrival[0].directlyAttributable || badArrival[0].transition !== "YES → NO") failures.push("the divides i-3 opposite-transition arrival false positive remains");
if (plausibleArrivals.length !== 7 || plausibleArrivals.some((row) => row.transitionClassification !== "directly-attributable")) {
  failures.push(`a plausible target-local arrival was lost: ${JSON.stringify(plausibleArrivals.map((row) => ({
    focusFork: row.focusFork,
    edgeId: row.edgeId,
    nodeId: row.nodeId,
    transition: row.transition,
    result: row.transitionClassification,
  })))}`);
}
if (originalWholeEdgeFalsePositives.length !== 7 || originalWholeEdgeFalsePositives.some((row) => row.transitionClassification === "directly-attributable")) failures.push("an original whole-edge false positive returned");

const focusTransitionClassifications = allIntrusions.length;
const allForkTransitionClassifications = fixtureReports.reduce((sum, row) => sum + row.allForkTransitionClassifications, 0);
const transitionRuleMembershipLookups = (focusTransitionClassifications + allForkTransitionClassifications) * 3;
const priorComparisonLayerMembershipLookups = focusTransitionClassifications * 10;
const report = {
  experiment: "endpoint-state / segment-phase intrusion-ownership census",
  checkpoint: CHECKPOINT,
  transitionTable: {
    departure: "assign departureSide when YES/NO; otherwise unowned",
    body: "assign only YES→YES or NO→NO to the common side",
    arrival: "assign targetSide only for same-side or OUTSIDE→YES/NO transitions",
    oppositeArrival: "YES→NO and NO→YES remain unowned",
    targetOutsideArrival: "YES/NO→OUTSIDE remains unowned",
    directSingleSegment: "preserve immediate-side endpoint consensus; disagreement is unresolved",
    routeFamilyExceptions: false,
  },
  freeze: {
    productionFilesChanged: false,
    geometryConstructionChanged: false,
    orientationOrderChanged: false,
    productionOrientationScoreChanged: false,
    experimentalOrientationScoreAdded: false,
    pins: [],
    lookaheadOrCompletion: false,
    recursiveOrExhaustiveSearch: false,
    repairOrPathfinding: false,
  },
  work: {
    realForks: fixtureReports.reduce((sum, row) => sum + row.realForkCount, 0),
    candidateDiagramRealizations: fixtureReports.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0),
    intrusionEvents: allIntrusions.length,
    focusTransitionClassifications,
    allForkTransitionClassifications,
    transitionClassificationCalls: focusTransitionClassifications + allForkTransitionClassifications,
    transitionRuleMembershipLookups,
    priorComparisonLayerMembershipLookups,
    totalHarnessMembershipLookups: transitionRuleMembershipLookups + priorComparisonLayerMembershipLookups,
    elapsedMs: fixtureReports.reduce((sum, row) => sum + row.elapsedMs, 0),
    sourcePathMedianMs: 398,
    departureAugmentedMedianMs: 407.6,
    positionalPhaseMedianMs: 409.1,
  },
  census: census(allIntrusions),
  fixtureCensus: fixtureReports.map((row) => ({
    fixture: row.fixture,
    realForkCount: row.realForkCount,
    candidateDiagramRealizations: row.candidateDiagramRealizations,
    focusTransitionClassifications: row.focusTransitionClassifications,
    elapsedMs: row.elapsedMs,
    census: row.census,
  })),
  requiredCases,
  bodyAudit: {
    previousConvincingConflicts: previousBodyConflicts.length,
    recovered: countBy(previousBodyConflicts, (row) => row.directlyAttributable),
    ownedBodyIntrusionCount: ownedBodyIntrusions.length,
    newAttributionsWithoutPreviousEndpointConsensus: newBodyAttributionsWithoutEndpointConsensus.length,
    ownedEvents: ownedBodyIntrusions.map(eventRecord),
    possibleNewFalsePositives: newBodyAttributionsWithoutEndpointConsensus.map(eventRecord),
  },
  arrivalAudit: {
    positionalAttributionsLost: lostPositionalArrivalAttributions.length,
    lostEvents: lostPositionalArrivalAttributions.map(eventRecord),
    badI3ArrivalCorrected: badArrival.length === 1 && !badArrival[0].directlyAttributable,
    plausibleTargetLocalArrivalsRetained: countBy(plausibleArrivals, (row) => row.transitionClassification === "directly-attributable"),
  },
  unresolvedStructuralAudit: {
    oppositeTransitionBodyOrArrivalEvents: oppositeTransitionUnowned.length,
    events: oppositeTransitionUnowned.map(eventRecord),
  },
  conclusion: {
    boundedSubI22Preserved: JSON.stringify(requiredCases.boundedSubI22.ownedCounts) === JSON.stringify({ D: 1, F: 0 }),
    dividesI25Unaffected: JSON.stringify(requiredCases.dividesI25.ownedCounts) === JSON.stringify({ D: 0, F: 0 }),
    allEightBodyConflictsRecovered: previousBodyConflicts.length === 8 && previousBodyConflicts.every((row) => row.directlyAttributable),
    bodyFalsePositiveCandidateFound: newBodyAttributionsWithoutEndpointConsensus.length > 0,
    badI3ArrivalCorrected: badArrival.length === 1 && !badArrival[0].directlyAttributable,
    allSevenPlausibleArrivalsRetained: plausibleArrivals.length === 7 && plausibleArrivals.every((row) => row.transitionClassification === "directly-attributable"),
    allOriginalWholeEdgeFalsePositivesRemainGone: originalWholeEdgeFalsePositives.length === 7
      && originalWholeEdgeFalsePositives.every((row) => row.transitionClassification !== "directly-attributable"),
    ambiguityIntroduced: allIntrusions.some((row) => row.ambiguous),
    scoringExperimentRun: false,
    resultPromoted: false,
    resultCheckpointed: false,
  },
  fixtureReports,
};

if (failures.length) throw new Error(`endpoint-transition intrusion census failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
