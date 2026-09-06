// Harness-only refinement of the source-path intrusion-ownership census.
// Adds exactly one diagnostic variable: a semantic yes/no departure token for an edge
// directly leaving the focus real fork. It never changes orientation scoring or geometry.

import fs from "node:fs";

import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
  summarizeView,
} from "./current_harness.mjs";
import { classifyViewIntrusionsWithDepartureAugmentation } from "./local_intrusion_ownership.mjs";

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
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const bitName = (orientation) => orientation?.no === "right" ? "F" : "D";
const countBy = (rows, predicate) => rows.filter(predicate).length;
const isDisagreement = (relationship) => !["same-side", "both-outside"].includes(relationship);
const isPreviousTargetOnlyOpposite = (row) => !row.sourcePathDirectlyAttributable
  && row.targetMembership.status === "member"
  && row.nodeMembership.status === "member"
  && row.targetMembership.side !== row.nodeMembership.side;

function beforeCensus(rows) {
  return {
    rawIntrusionEvents: rows.length,
    directlyAttributableEvents: countBy(rows, (row) => row.sourcePathDirectlyAttributable),
    unattributedEvents: countBy(rows, (row) => row.sourcePathClassification === "unattributed"),
    ambiguousEvents: countBy(rows, (row) => row.sourcePathClassification === "ambiguous"),
    multiForkAttributionEvents: countBy(rows, (row) => row.sourcePathAttributableForks.length > 1),
    sourceTargetDisagreementEvents: countBy(rows, (row) => isDisagreement(row.sourcePathTargetRelationship)),
    sourcePathBlindDepartureEvents: countBy(rows, (row) => row.sourcePathBlindSemanticDeparture),
  };
}

function afterCensus(rows) {
  return {
    rawIntrusionEvents: rows.length,
    directlyAttributableEvents: countBy(rows, (row) => row.departurePathDirectlyAttributable),
    unattributedEvents: countBy(rows, (row) => row.departurePathClassification === "unattributed"),
    ambiguousEvents: countBy(rows, (row) => row.departurePathClassification === "ambiguous"),
    multiForkAttributionEvents: countBy(rows, (row) => row.departureAppearsAttributableToMultipleForks),
    departureTargetDisagreementEvents: countBy(rows, (row) => isDisagreement(row.departureTargetRelationship)),
    sourcePathBlindDepartureEventsRemaining: countBy(rows, (row) => row.sourcePathBlindDepartureRemaining),
    sourcePathBlindDepartureEventsRecovered: countBy(rows, (row) => row.sourcePathBlindDepartureRecovered),
    classificationsChangedSolelyByDepartureToken: countBy(rows, (row) => row.classificationChangedSolelyByDepartureToken),
  };
}

function candidateReport({ fixture, focusFork, candidate, view }) {
  const summary = summarizeView(view);
  const intrusions = classifyViewIntrusionsWithDepartureAugmentation(
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
    before: beforeCensus(intrusions),
    after: afterCensus(intrusions),
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
    focusAttributionTests: intrusions.length,
    allForkMultiplicityTests: intrusions.length * raw.roles.realForkIds.length,
    elapsedMs,
    before: beforeCensus(intrusions),
    after: afterCensus(intrusions),
    candidates,
  };
}

function directlyAttributedRecord(row) {
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
    isFinalSegment: row.isFinalSegment,
    edgeSource: row.edgeSource,
    edgeTarget: row.edgeTarget,
    edgeBranch: row.edgeBranch,
    edgeRole: row.edgeRole,
    routeFamily: row.routeFamily,
    sourceBranchPath: row.sourceBranchPath,
    semanticDepartureToken: row.semanticDepartureToken,
    edgeDeparturePath: row.edgeDeparturePath,
    targetBranchPath: row.targetBranchPath,
    nodeBranchPath: row.nodeBranchPath,
    sourcePathClassification: row.sourcePathClassification,
    departurePathClassification: row.departurePathClassification,
    attributedForks: row.departureAttributableForks,
    classificationChangedSolelyByDepartureToken: row.classificationChangedSolelyByDepartureToken,
    departureTargetRelationship: row.departureTargetRelationship,
    departureTargetRegionMismatch: row.departureTargetRegionMismatch,
    wholeEdgeDepartureRisk: row.wholeEdgeDepartureRisk,
  };
}

const fixtureReports = FIXTURES.map((fixture) => orientationSweepCensus(programs[fixture], fixture));
const allIntrusions = fixtureReports.flatMap((report) => report.candidates.flatMap((candidate) => candidate.intrusions));
const candidateFor = (fixture, focusFork, candidate) => fixtureReports
  .find((row) => row.fixture === fixture)?.candidates
  .find((row) => row.focusFork === focusFork && row.candidate === candidate);
const eventRows = (candidate, edgeId, nodeId) => candidate.intrusions
  .filter((row) => row.edgeId === edgeId && row.nodeId === nodeId);
const ownedCount = (candidate, phase) => phase === "before"
  ? candidate.before.directlyAttributableEvents
  : candidate.after.directlyAttributableEvents;

const boundedDefault = candidateFor("minimization:bounded_sub", "i-22", "D");
const boundedFlipped = candidateFor("minimization:bounded_sub", "i-22", "F");
const dividesI25Default = candidateFor("characteristic:divides", "i-25", "D");
const dividesI25Flipped = candidateFor("characteristic:divides", "i-25", "F");
const dividesI53Default = candidateFor("characteristic:divides", "i-53", "D");
const knownDividesPairs = [
  ["i-53-yes", "i-54"],
  ["i-55-jump", "i-49"],
  ["i-55-jump", "i-50"],
  ["i-57-cont", "i-55"],
];
const requiredCases = {
  boundedSubI22: {
    default: eventRows(boundedDefault, "i-24-jump", "i-26").map(directlyAttributedRecord),
    flipped: eventRows(boundedFlipped, "i-24-jump", "i-26").map(directlyAttributedRecord),
    ownedCounts: {
      before: { D: ownedCount(boundedDefault, "before"), F: ownedCount(boundedFlipped, "before") },
      after: { D: ownedCount(boundedDefault, "after"), F: ownedCount(boundedFlipped, "after") },
    },
  },
  dividesI25: {
    default: knownDividesPairs.flatMap(([edgeId, nodeId]) => eventRows(dividesI25Default, edgeId, nodeId)).map(directlyAttributedRecord),
    flipped: knownDividesPairs.flatMap(([edgeId, nodeId]) => eventRows(dividesI25Flipped, edgeId, nodeId)).map(directlyAttributedRecord),
    rawCounts: { D: dividesI25Default.before.rawIntrusionEvents, F: dividesI25Flipped.before.rawIntrusionEvents },
    ownedCounts: {
      before: { D: ownedCount(dividesI25Default, "before"), F: ownedCount(dividesI25Flipped, "before") },
      after: { D: ownedCount(dividesI25Default, "after"), F: ownedCount(dividesI25Flipped, "after") },
    },
  },
  dividesI53DirectDeparture: eventRows(dividesI53Default, "i-53-yes", "i-54").map(directlyAttributedRecord),
};

const previousBlindDepartures = allIntrusions.filter((row) => row.sourcePathBlindSemanticDeparture);
const changedByDepartureToken = allIntrusions.filter((row) => row.classificationChangedSolelyByDepartureToken);
const previousTargetOnlyOppositeEvents = allIntrusions.filter(isPreviousTargetOnlyOpposite);
const directlyAttributedEvents = allIntrusions.filter((row) => row.departurePathDirectlyAttributable);
const wholeEdgeDepartureCounterexamples = directlyAttributedEvents.filter((row) => row.wholeEdgeDepartureRisk);

const failures = [];
if (fixtureReports.reduce((sum, row) => sum + row.realForkCount, 0) !== 27) failures.push("real-fork census is no longer 27");
if (fixtureReports.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0) !== 54) failures.push("candidate realization census is no longer 54");
for (const fixtureReport of fixtureReports) {
  if (JSON.stringify(fixtureReport.productionOrientationMap) !== JSON.stringify(EXPECTED_CONTROL_ORIENTATIONS[fixtureReport.fixture])) {
    failures.push(`${fixtureReport.fixture}: production control orientation sequence changed`);
  }
}
if (JSON.stringify(beforeCensus(allIntrusions)) !== JSON.stringify({
  rawIntrusionEvents: 136,
  directlyAttributableEvents: 23,
  unattributedEvents: 113,
  ambiguousEvents: 0,
  multiForkAttributionEvents: 0,
  sourceTargetDisagreementEvents: 60,
  sourcePathBlindDepartureEvents: 7,
})) failures.push("source-path control census no longer matches the previous probe");
if (JSON.stringify(requiredCases.boundedSubI22.ownedCounts.after) !== JSON.stringify({ D: 1, F: 0 })) failures.push("bounded_sub i-22 departure-augmented ownership changed");
if (JSON.stringify(requiredCases.dividesI25.rawCounts) !== JSON.stringify({ D: 4, F: 3 })) failures.push("divides i-25 raw intrusion totals changed");
if (JSON.stringify(requiredCases.dividesI25.ownedCounts.after) !== JSON.stringify({ D: 0, F: 0 })) failures.push("divides i-25 gained a departure-owned intrusion");
if (previousBlindDepartures.length !== 7 || changedByDepartureToken.length !== 7) failures.push("departure augmentation did not isolate exactly the seven prior blind departures");
if (previousBlindDepartures.some((row) => !row.sourcePathBlindDepartureRecovered)) failures.push("a prior source-path blind departure was not recovered");
const i53 = requiredCases.dividesI53DirectDeparture[0];
if (requiredCases.dividesI53DirectDeparture.length !== 1
  || i53.semanticDepartureToken !== "i-53-yes"
  || JSON.stringify(i53.edgeDeparturePath) !== JSON.stringify(["i-3-yes", "i-53-yes"])
  || JSON.stringify(i53.nodeBranchPath) !== JSON.stringify(["i-3-yes", "i-53-no"])
  || i53.departurePathClassification !== "directly-attributable") {
  failures.push("divides i-53 direct departure was not recovered exactly");
}

const report = {
  experiment: "departure-augmented local intrusion-ownership census",
  checkpoint: CHECKPOINT,
  variable: "append the semantic yes/no token only to an edge directly leaving the focus real fork",
  attributionRule: {
    sourcePathControl: "existing branch path of edge source",
    departureAugmentation: "if edge.from === focus real fork and edge.branch is yes/no, append focusFork-edge.branch; otherwise preserve source path",
    nodeMembership: "existing branch path of intruded node",
    directAttribution: "departure path and node path contain opposite immediate yes/no children of focus fork",
    targetPathUse: "diagnostic only",
    wholeEdgeAssumptionUnderAudit: true,
    segmentOwnershipModel: false,
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
    focusAttributionTests: fixtureReports.reduce((sum, row) => sum + row.focusAttributionTests, 0),
    allForkMultiplicityTests: fixtureReports.reduce((sum, row) => sum + row.allForkMultiplicityTests, 0),
    elapsedMs: fixtureReports.reduce((sum, row) => sum + row.elapsedMs, 0),
    previousMedianMs: 398,
  },
  before: beforeCensus(allIntrusions),
  after: afterCensus(allIntrusions),
  requiredCases,
  previousBlindDepartures: previousBlindDepartures.map(directlyAttributedRecord),
  changedByDepartureToken: changedByDepartureToken.map(directlyAttributedRecord),
  previousTargetOnlyOppositeAudit: {
    eventCount: previousTargetOnlyOppositeEvents.length,
    becameDirectlyAttributedByDepartureToken: countBy(previousTargetOnlyOppositeEvents, (row) => row.classificationChangedSolelyByDepartureToken && row.departurePathDirectlyAttributable),
    events: previousTargetOnlyOppositeEvents.map(directlyAttributedRecord),
  },
  directlyAttributedEvents: directlyAttributedEvents.map(directlyAttributedRecord),
  wholeEdgeAudit: {
    riskDefinition: "newly attributed by a departure token, intrusion is on a later segment, and target ancestry is outside or opposite the departure child",
    counterexampleCount: wholeEdgeDepartureCounterexamples.length,
    counterexamples: wholeEdgeDepartureCounterexamples.map(directlyAttributedRecord),
  },
  fixtureReports,
  conclusion: {
    allSevenBlindDeparturesRecovered: previousBlindDepartures.length === 7
      && previousBlindDepartures.every((row) => row.sourcePathBlindDepartureRecovered),
    boundedSubI22Preserved: JSON.stringify(requiredCases.boundedSubI22.ownedCounts.after) === JSON.stringify({ D: 1, F: 0 }),
    dividesI25Unaffected: JSON.stringify(requiredCases.dividesI25.ownedCounts.after) === JSON.stringify({ D: 0, F: 0 }),
    wholeEdgeDepartureCounterexampleFound: wholeEdgeDepartureCounterexamples.length > 0,
    segmentLevelConceptAppearsNecessary: wholeEdgeDepartureCounterexamples.length > 0,
    scoringExperimentRun: false,
    resultPromoted: false,
    resultCheckpointed: false,
  },
};

if (failures.length) throw new Error(`departure-augmented intrusion census failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
