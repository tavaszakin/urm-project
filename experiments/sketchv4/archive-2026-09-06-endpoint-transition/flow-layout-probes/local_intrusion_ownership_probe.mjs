// Harness-only census for attributing provisional unrelated node-edge intrusions to the
// focus real fork. The tested rule uses only existing CFG branch-path metadata:
// the edge belongs to the branch containing its source, and an event is focus-owned iff
// the edge source and intruded node have opposite i-N-{yes,no} tokens for that focus fork.

import fs from "node:fs";

import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
  summarizeView,
} from "./current_harness.mjs";
import { classifyViewIntrusions } from "./local_intrusion_ownership.mjs";

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
const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));

const bitName = (orientation) => orientation?.no === "right" ? "F" : "D";

function countBy(rows, predicate) {
  return rows.filter(predicate).length;
}

function summarizeCensus(rows) {
  const rawPairKeys = new Set(rows.map((row) => `${row.fixture ?? "unknown"}: ${row.edgeId} × ${row.nodeId}`));
  return {
    rawIntrusionEvents: rows.length,
    rawIntrusionPairs: rawPairKeys.size,
    directlyAttributableEvents: countBy(rows, (row) => row.classification === "directly-attributable"),
    unattributedEvents: countBy(rows, (row) => row.classification === "unattributed"),
    ambiguousEvents: countBy(rows, (row) => row.classification === "ambiguous"),
    sourceTargetDisagreementEvents: countBy(rows, (row) => !["same-side", "both-outside"].includes(row.sourceTargetRelationship)),
    multipleForkAttributionEvents: countBy(rows, (row) => row.appearsAttributableToMultipleForks),
    targetOnlyOppositeMembershipEvents: countBy(rows, (row) => !row.directlyAttributable
      && row.targetMembership.status === "member"
      && row.nodeMembership.status === "member"
      && row.targetMembership.side !== row.nodeMembership.side),
    sourcePathBlindSemanticDepartureEvents: countBy(rows, (row) => row.sourcePathBlindSemanticDeparture),
  };
}

function candidateReport({ fixture, focusFork, candidate, view }) {
  const summary = summarizeView(view);
  const intrusions = classifyViewIntrusions(view, focusFork, { fixture, candidate }, { scanAllForks: true });
  return {
    focusFork,
    candidate,
    productionCost: view.defects.total,
    nodeOverlapCount: summary.trueNodeOverlapCount,
    properCrossingCount: summary.properCrossingCount,
    rawIntrusionCount: intrusions.length,
    directlyAttributableIntrusionCount: countBy(intrusions, (row) => row.directlyAttributable),
    intrusions,
  };
}

function orientationSweepCensus(program, fixture) {
  const raw = buildRawRoleOrdinaryTerminalBase(program, fixture);
  const { realizeEndpoints } = buildComposedLoopEndpointRealizer(raw);
  const orientationMap = new Map(raw.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const candidates = [];
  const decisions = [];
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
    decisions.push({
      focusFork,
      productionCostD: defaultCandidate.productionCost,
      productionCostF: flippedCandidate.productionCost,
      decision: chooseFlipped ? "F" : "D",
    });
  }
  const elapsedMs = performance.now() - started;
  const intrusions = candidates.flatMap((candidate) => candidate.intrusions);
  return {
    fixture,
    realForkCount: raw.roles.realForkIds.length,
    bottomUpOrder: raw.tree.bottomUp,
    candidateDiagramRealizations,
    focusAttributionTests: intrusions.length,
    allForkMultiplicityTests: intrusions.length * raw.roles.realForkIds.length,
    elapsedMs,
    productionOrientationMap: Object.fromEntries([...orientationMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, orientation]) => [id, bitName(orientation)])),
    decisions,
    census: summarizeCensus(intrusions),
    candidates,
  };
}

const fixtureReports = FIXTURES.map((fixture) => orientationSweepCensus(programs[fixture], fixture));
const allIntrusions = fixtureReports.flatMap((report) => report.candidates.flatMap((candidate) => candidate.intrusions));
const candidateFor = (fixture, focusFork, candidate) => fixtureReports
  .find((row) => row.fixture === fixture)?.candidates
  .find((row) => row.focusFork === focusFork && row.candidate === candidate);
const knownEventRows = (candidate, edgeId, nodeId) => candidate.intrusions
  .filter((row) => row.edgeId === edgeId && row.nodeId === nodeId);

const boundedDefault = candidateFor("minimization:bounded_sub", "i-22", "D");
const boundedFlipped = candidateFor("minimization:bounded_sub", "i-22", "F");
const dividesDefault = candidateFor("characteristic:divides", "i-25", "D");
const dividesFlipped = candidateFor("characteristic:divides", "i-25", "F");
const dividesI53Default = candidateFor("characteristic:divides", "i-53", "D");
const requiredCases = {
  boundedSubI22: {
    default: knownEventRows(boundedDefault, "i-24-jump", "i-26"),
    flipped: knownEventRows(boundedFlipped, "i-24-jump", "i-26"),
    localOwnedCounts: {
      D: boundedDefault.directlyAttributableIntrusionCount,
      F: boundedFlipped.directlyAttributableIntrusionCount,
    },
  },
  dividesI25: {
    default: [
      ["i-53-yes", "i-54"],
      ["i-55-jump", "i-49"],
      ["i-55-jump", "i-50"],
      ["i-57-cont", "i-55"],
    ].flatMap(([edgeId, nodeId]) => knownEventRows(dividesDefault, edgeId, nodeId)),
    flipped: [
      ["i-53-yes", "i-54"],
      ["i-55-jump", "i-49"],
      ["i-55-jump", "i-50"],
      ["i-57-cont", "i-55"],
    ].flatMap(([edgeId, nodeId]) => knownEventRows(dividesFlipped, edgeId, nodeId)),
    localOwnedCounts: {
      D: dividesDefault.directlyAttributableIntrusionCount,
      F: dividesFlipped.directlyAttributableIntrusionCount,
    },
    rawCounts: { D: dividesDefault.rawIntrusionCount, F: dividesFlipped.rawIntrusionCount },
  },
};
const sourcePathBlindSemanticDepartures = allIntrusions.filter((row) => row.sourcePathBlindSemanticDeparture);
const targetOnlyOppositeMemberships = allIntrusions.filter((row) => !row.directlyAttributable
  && row.targetMembership.status === "member"
  && row.nodeMembership.status === "member"
  && row.targetMembership.side !== row.nodeMembership.side);
const i53DirectDepartureCounterexample = knownEventRows(dividesI53Default, "i-53-yes", "i-54");

const failures = [];
if (fixtureReports.reduce((sum, row) => sum + row.realForkCount, 0) !== 27) failures.push("real-fork census is no longer 27");
if (fixtureReports.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0) !== 54) failures.push("candidate realization census is no longer 54");
if (requiredCases.boundedSubI22.default.length !== 1 || requiredCases.boundedSubI22.flipped.length !== 0) failures.push("bounded_sub i-24-jump × i-26 event identity changed");
if (requiredCases.dividesI25.rawCounts.D !== 4 || requiredCases.dividesI25.rawCounts.F !== 3) failures.push("divides i-25 provisional raw intrusion totals changed");
if (i53DirectDepartureCounterexample.length !== 1
  || i53DirectDepartureCounterexample[0].edgeBranch !== "yes"
  || i53DirectDepartureCounterexample[0].nodeMembership.side !== "no"
  || i53DirectDepartureCounterexample[0].sourceMembership.status !== "outside"
  || i53DirectDepartureCounterexample[0].classification !== "unattributed") {
  failures.push("divides i-53 direct-departure source-path counterexample changed");
}

const requiredCasesSeparate = requiredCases.boundedSubI22.localOwnedCounts.D === 1
  && requiredCases.boundedSubI22.localOwnedCounts.F === 0
  && requiredCases.dividesI25.localOwnedCounts.D === 0
  && requiredCases.dividesI25.localOwnedCounts.F === 0;
const simpleDiagnosticSurvived = false;

const report = {
  experiment: "local intrusion-ownership structural census",
  checkpoint: CHECKPOINT,
  variable: "diagnostic classification only",
  attributionRule: {
    edgeSideMembership: "existing branch path of the edge source",
    nodeSideMembership: "existing branch path of the intruded node",
    directAttribution: "source and node paths each contain exactly one token for focus fork f, and those tokens name opposite yes/no immediate children",
    targetPathUse: "diagnostic only; never changes attribution",
    segmentOwnershipModel: false,
  },
  freeze: {
    productionFilesChanged: false,
    geometryConstructionChanged: false,
    orientationOrderChanged: false,
    productionOrientationScoreChanged: false,
    pins: [],
    lookaheadOrCompletion: false,
    repairOrPathfinding: false,
  },
  work: {
    realForks: fixtureReports.reduce((sum, row) => sum + row.realForkCount, 0),
    candidateDiagramRealizations: fixtureReports.reduce((sum, row) => sum + row.candidateDiagramRealizations, 0),
    focusAttributionTests: fixtureReports.reduce((sum, row) => sum + row.focusAttributionTests, 0),
    allForkMultiplicityTests: fixtureReports.reduce((sum, row) => sum + row.allForkMultiplicityTests, 0),
    elapsedMs: fixtureReports.reduce((sum, row) => sum + row.elapsedMs, 0),
  },
  census: summarizeCensus(allIntrusions),
  sourceTargetDisagreements: allIntrusions.filter((row) => !["same-side", "both-outside"].includes(row.sourceTargetRelationship)),
  targetOnlyOppositeMemberships,
  sourcePathBlindSemanticDepartures,
  multipleForkAttributions: allIntrusions.filter((row) => row.appearsAttributableToMultipleForks),
  ambiguousEvents: allIntrusions.filter((row) => row.classification === "ambiguous"),
  requiredCases,
  fixtureReports,
  conclusion: {
    requiredCasesSeparate,
    simpleDiagnosticSurvived,
    scoringExperimentJustified: false,
    sourceTargetDisagreementsAreDiagnosticOnly: true,
    sourceTargetDisagreementInterpretation: "Jumps and reentries often end outside the source branch. Target paths cannot replace source paths wholesale, but they expose the direct-departure blind spot.",
    counterexample: "At focus i-53, edge i-53-yes semantically departs the yes child while i-54 is in i-53/no; the source node i-53 has no i-53 child token, so source-path attribution incorrectly leaves the event unattributed.",
    scoringExperimentRun: false,
    stopReason: "Source-path attribution is insufficient for a direct focus-fork departure, so the counterexample discipline stops before changing orientation scoring.",
    resultPromoted: false,
    resultCheckpointed: false,
  },
  scoringExperiment: null,
};

if (failures.length) throw new Error(`local intrusion-ownership census failed: ${failures.join("; ")}`);
console.log(JSON.stringify(report, null, 2));
