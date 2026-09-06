// Harness-only census of positional departure/body/arrival segment ownership.
// This diagnostic reproduces ordinary provisional D/F candidates but never adds an
// intrusion score or changes an orientation decision.

import fs from "node:fs";

import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
  summarizeView,
} from "./current_harness.mjs";
import { classifyViewIntrusionsBySegmentPhase } from "./segment_phase_intrusion_ownership.mjs";

const CHECKPOINT = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const FIXTURES = [
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
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
const WHOLE_EDGE_CASES = [
  ["minimization:bounded_sub", "i-12", "F", "i-12-yes", "i-16"],
  ["characteristic:divides", "i-38", "F", "i-38-yes", "i-42"],
  ["characteristic:divides", "i-15", "F", "i-15-yes", "i-19"],
  ["characteristic:divides", "i-53", "D", "i-53-yes", "i-54"],
  ["characteristic:eq", "i-31", "F", "i-31-yes", "i-35"],
  ["characteristic:eq", "i-11", "F", "i-11-yes", "i-15"],
  ["predecessor", "i-0", "F", "i-0-yes", "i-4"],
];
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const bitName = (orientation) => orientation?.no === "right" ? "F" : "D";
const countBy = (rows, predicate) => rows.filter(predicate).length;
const countPhase = (rows, phase) => countBy(rows, (row) => row.phase === phase);
const countClassification = (rows, classification) => countBy(rows, (row) => row.phaseClassification === classification);

function census(rows) {
  const previousSourceDirect = rows.filter((row) => row.sourcePathDirectlyAttributable);
  const previousWholeEdgeFalsePositives = rows.filter((row) => row.wholeEdgeDepartureRisk);
  return {
    intrusionEvents: rows.length,
    phase: {
      departure: countPhase(rows, "departure"),
      body: countPhase(rows, "body"),
      arrival: countPhase(rows, "arrival"),
      directSingleSegment: countPhase(rows, "direct"),
    },
    ownership: {
      directlyAttributable: countClassification(rows, "directly-attributable"),
      unattributed: countClassification(rows, "unattributed"),
      bodyUnowned: countClassification(rows, "body-unowned"),
      directSegmentUnresolved: countClassification(rows, "direct-segment-unresolved"),
      ambiguous: countClassification(rows, "ambiguous"),
      multiFork: countBy(rows, (row) => row.phaseAppearsAttributableToMultipleForks),
    },
    endpointDiagnostics: {
      departureArrivalMembershipDisagreements: countBy(rows, (row) => !row.endpointMembershipsAgree),
      departureArrivalExactPathDisagreements: countBy(rows, (row) => !row.endpointExactPathsAgree),
      directMembershipAgreements: countBy(rows, (row) => row.phase === "direct" && row.endpointMembershipsAgree),
      directMembershipDisagreements: countBy(rows, (row) => row.phase === "direct" && !row.endpointMembershipsAgree),
      directExactPathAgreements: countBy(rows, (row) => row.phase === "direct" && row.endpointExactPathsAgree),
      directExactPathDisagreements: countBy(rows, (row) => row.phase === "direct" && !row.endpointExactPathsAgree),
    },
    sourcePathComparison: {
      previouslyDirect: previousSourceDirect.length,
      retained: countBy(previousSourceDirect, (row) => row.phaseDirectlyAttributable),
      lost: countBy(previousSourceDirect, (row) => !row.phaseDirectlyAttributable),
      gained: countBy(rows, (row) => !row.sourcePathDirectlyAttributable && row.phaseDirectlyAttributable),
      changedEitherDirection: countBy(rows, (row) => row.previousSourceAttributionChanged),
    },
    wholeEdgeFalsePositiveComparison: {
      previousFalsePositives: previousWholeEdgeFalsePositives.length,
      disappeared: countBy(previousWholeEdgeFalsePositives, (row) => !row.phaseDirectlyAttributable),
      remaining: countBy(previousWholeEdgeFalsePositives, (row) => row.phaseDirectlyAttributable),
    },
    bodyEndpointConsensusDirect: countBy(rows, (row) => row.bodyEndpointConsensusDirect),
    newArrivalAttributions: countBy(rows, (row) => row.phase === "arrival"
      && row.phaseDirectlyAttributable
      && !row.sourcePathDirectlyAttributable),
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
    arrivalPath: row.arrivalPath,
    phasePath: row.phasePath,
    nodeBranchPath: row.nodeBranchPath,
    oldSourcePathAttribution: row.sourcePathClassification,
    oldWholeEdgeAttribution: row.departurePathClassification,
    phaseClassification: row.phaseClassification,
    attributedForks: row.phaseAttributableForks,
    endpointMembershipsAgree: row.endpointMembershipsAgree,
    endpointExactPathsAgree: row.endpointExactPathsAgree,
    departureMembership: row.departureInterpretation.pathMembership,
    arrivalMembership: row.arrivalInterpretation.pathMembership,
    nodeMembership: row.departureInterpretation.nodeMembership,
    bodyEndpointConsensusDirect: row.bodyEndpointConsensusDirect,
  };
}

function candidateReport({ fixture, focusFork, candidate, view }) {
  const summary = summarizeView(view);
  const intrusions = classifyViewIntrusionsBySegmentPhase(
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
    phaseClassifications: intrusions.length,
    allForkMultiplicityTests: intrusions.length * raw.roles.realForkIds.length,
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
const ownedCount = (candidate) => candidate.census.ownership.directlyAttributable;

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
const wholeEdgeCases = WHOLE_EDGE_CASES.flatMap(([fixture, focusFork, candidate, edgeId, nodeId]) =>
  eventsFor(fixture, focusFork, candidate, edgeId, nodeId).map(eventRecord));
const directSegmentEvents = allIntrusions.filter((row) => row.phase === "direct");
const lostSourceAttributions = allIntrusions.filter((row) => row.sourcePathDirectlyAttributable
  && !row.phaseDirectlyAttributable);
const gainedPhaseAttributions = allIntrusions.filter((row) => !row.sourcePathDirectlyAttributable
  && row.phaseDirectlyAttributable);
const bodyConsensusConflicts = allIntrusions.filter((row) => row.bodyEndpointConsensusDirect);
const newArrivalAttributions = allIntrusions.filter((row) => row.phase === "arrival"
  && row.phaseDirectlyAttributable
  && !row.sourcePathDirectlyAttributable);

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
    rawCounts: {
      D: dividesI25Default.intrusions.length,
      F: dividesI25Flipped.intrusions.length,
    },
    ownedCounts: { D: ownedCount(dividesI25Default), F: ownedCount(dividesI25Flipped) },
  },
  wholeEdgeCases,
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
if (JSON.stringify(requiredCases.boundedSubI22.ownedCounts) !== JSON.stringify({ D: 1, F: 0 })) {
  failures.push("bounded_sub i-22 phase-local ownership is not D=1/F=0");
}
if (requiredCases.boundedSubI22.default.length !== 1
  || requiredCases.boundedSubI22.default[0].phase !== "departure"
  || requiredCases.boundedSubI22.default[0].phaseClassification !== "directly-attributable") {
  failures.push("bounded_sub i-24-jump × i-26 is not a departure-phase attribution");
}
if (JSON.stringify(requiredCases.dividesI25.ownedCounts) !== JSON.stringify({ D: 0, F: 0 })) {
  failures.push("divides i-25 gained a phase-local attribution");
}
if (wholeEdgeCases.length !== 7
  || wholeEdgeCases.some((row) => row.oldWholeEdgeAttribution !== "directly-attributable"
    || row.phase !== "arrival"
    || row.phaseClassification === "directly-attributable")) {
  failures.push("one of the seven whole-edge false positives did not disappear in arrival phase");
}

const report = {
  experiment: "segment-phase local intrusion-ownership census",
  checkpoint: CHECKPOINT,
  phaseModel: {
    multiSegment: "first segment = departure; last segment = arrival; strictly intermediate segments = body",
    departurePath: "source node branch path, plus a semantic yes/no token only when the edge directly leaves the focus real fork",
    arrivalPath: "target node branch path",
    bodyPath: null,
    directSingleSegment: "compare departure and arrival membership at the focus fork; disagreement is unresolved",
    directAgreementScope: "same membership status and immediate side at the focus fork; exact full-path agreement is also reported",
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
    phaseClassifications: allIntrusions.length,
    allForkMultiplicityTests: fixtureReports.reduce((sum, row) => sum + row.allForkMultiplicityTests, 0),
    elapsedMs: fixtureReports.reduce((sum, row) => sum + row.elapsedMs, 0),
    sourcePathMedianMs: 398,
    departureAugmentedMedianMs: 407.6,
  },
  census: census(allIntrusions),
  fixtureCensus: fixtureReports.map((row) => ({
    fixture: row.fixture,
    realForkCount: row.realForkCount,
    candidateDiagramRealizations: row.candidateDiagramRealizations,
    phaseClassifications: row.phaseClassifications,
    elapsedMs: row.elapsedMs,
    census: row.census,
  })),
  requiredCases,
  sourcePathComparison: {
    lostAttributions: lostSourceAttributions.map(eventRecord),
    gainedAttributions: gainedPhaseAttributions.map(eventRecord),
  },
  bodyAudit: {
    endpointConsensusDirectCount: bodyConsensusConflicts.length,
    events: bodyConsensusConflicts.map(eventRecord),
  },
  arrivalAudit: {
    newAttributionCount: newArrivalAttributions.length,
    events: newArrivalAttributions.map(eventRecord),
  },
  directSegmentAudit: {
    eventCount: directSegmentEvents.length,
    membershipAgreementCount: countBy(directSegmentEvents, (row) => row.endpointMembershipsAgree),
    membershipDisagreementCount: countBy(directSegmentEvents, (row) => !row.endpointMembershipsAgree),
    exactPathAgreementCount: countBy(directSegmentEvents, (row) => row.endpointExactPathsAgree),
    exactPathDisagreementCount: countBy(directSegmentEvents, (row) => !row.endpointExactPathsAgree),
    unresolvedCount: countBy(directSegmentEvents, (row) => row.directSegmentUnresolved),
    directlyAttributableCount: countBy(directSegmentEvents, (row) => row.phaseDirectlyAttributable),
    events: directSegmentEvents.map(eventRecord),
  },
  conclusion: {
    boundedSubI22Preserved: JSON.stringify(requiredCases.boundedSubI22.ownedCounts) === JSON.stringify({ D: 1, F: 0 }),
    dividesI25Unaffected: JSON.stringify(requiredCases.dividesI25.ownedCounts) === JSON.stringify({ D: 0, F: 0 }),
    allSevenWholeEdgeFalsePositivesDisappear: wholeEdgeCases.length === 7
      && wholeEdgeCases.every((row) => row.phaseClassification !== "directly-attributable"),
    scoringExperimentRun: false,
    resultPromoted: false,
    resultCheckpointed: false,
  },
  fixtureReports,
};

if (failures.length) throw new Error(`segment-phase intrusion census failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
