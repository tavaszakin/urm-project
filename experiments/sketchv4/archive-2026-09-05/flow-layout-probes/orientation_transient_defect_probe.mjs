// Harness-only diagnosis of transient node-edge intrusions seen while evaluating
// bounded_sub i-22 and divides i-25. The score and all production geometry remain fixed.

import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildOrientationTransientDefectDiagnosisViews,
  buildRawRoleOrdinaryTerminalView,
} from "./ordinary_halt_experiment.mjs";

const CHECKPOINT_SHA = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const FIXTURES = ["minimization:bounded_sub", "characteristic:divides"];
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

function counts(candidate, stage) {
  const row = candidate[stage];
  return stage === "provisional"
    ? [row.nodeOverlapCount, row.properCrossingCount, row.nodeEdgeIntrusionCount]
    : [row.nodeOverlapCount, row.properCrossingCount, row.edgeOverlapCount, row.nodeEdgeIntrusionCount];
}

function eventPairCounts(candidate) {
  const countsByPair = {};
  for (const intrusion of candidate.provisional.nodeEdgeIntrusions) {
    const key = `${intrusion.edgeId} × ${intrusion.nodeId}`;
    countsByPair[key] = (countsByPair[key] ?? 0) + 1;
  }
  return countsByPair;
}

const failures = [];
const fixtureReports = [];
for (const fixture of FIXTURES) {
  const raw = buildRawRoleOrdinaryTerminalView(programs[fixture], fixture);
  const diagnosis = buildOrientationTransientDefectDiagnosisViews(raw);
  const report = {
    ...diagnosis.report,
    geometryDigests: {
      provisionalDefault: geometryDigest(diagnosis.provisionalDefault),
      completedDefault: geometryDigest(diagnosis.completedDefault),
      provisionalFlipped: geometryDigest(diagnosis.provisionalFlipped),
      completedFlipped: geometryDigest(diagnosis.completedFlipped),
    },
  };
  fixtureReports.push(report);
}

const bounded = fixtureReports.find((row) => row.fixture === "minimization:bounded_sub");
const divides = fixtureReports.find((row) => row.fixture === "characteristic:divides");

if (JSON.stringify(counts(bounded.defaultCandidate, "provisional")) !== JSON.stringify([0, 0, 1])) failures.push("bounded i-22 default provisional counts changed");
if (JSON.stringify(counts(bounded.defaultCandidate, "final")) !== JSON.stringify([0, 0, 0, 1])) failures.push("bounded i-22 default final counts changed");
if (JSON.stringify(counts(bounded.flippedCandidate, "provisional")) !== JSON.stringify([0, 0, 0])) failures.push("bounded i-22 flipped provisional counts changed");
if (JSON.stringify(counts(bounded.flippedCandidate, "final")) !== JSON.stringify([0, 0, 0, 0])) failures.push("bounded i-22 flipped final counts changed");
const boundedTrace = bounded.defaultCandidate.provisionalIntrusionTraces[0];
if (!boundedTrace
  || boundedTrace.provisional.edgeId !== "i-24-jump"
  || boundedTrace.provisional.nodeId !== "i-26"
  || boundedTrace.outcome !== "survives-unchanged"
  || boundedTrace.firstRemoval !== null) {
  failures.push("bounded i-22 intrusion did not persist exactly");
}

if (JSON.stringify(counts(divides.defaultCandidate, "provisional")) !== JSON.stringify([2, 1, 4])) failures.push("divides i-25 default provisional counts changed");
if (JSON.stringify(counts(divides.defaultCandidate, "final")) !== JSON.stringify([0, 0, 1, 0])) failures.push("divides i-25 default final counts changed");
if (JSON.stringify(counts(divides.flippedCandidate, "provisional")) !== JSON.stringify([2, 1, 3])) failures.push("divides i-25 flipped provisional counts changed");
if (JSON.stringify(counts(divides.flippedCandidate, "final")) !== JSON.stringify([0, 1, 1, 0])) failures.push("divides i-25 flipped final counts changed");
const expectedDefaultPairCounts = {
  "i-53-yes × i-54": 1,
  "i-55-jump × i-49": 1,
  "i-55-jump × i-50": 1,
  "i-57-cont × i-55": 1,
};
const expectedFlippedPairCounts = {
  "i-53-yes × i-54": 1,
  "i-57-cont × i-55": 2,
};
if (JSON.stringify(eventPairCounts(divides.defaultCandidate)) !== JSON.stringify(expectedDefaultPairCounts)) failures.push("divides default intrusion identity changed");
if (JSON.stringify(eventPairCounts(divides.flippedCandidate)) !== JSON.stringify(expectedFlippedPairCounts)) failures.push("divides flipped intrusion identity changed");
for (const candidate of [divides.defaultCandidate, divides.flippedCandidate]) {
  for (const trace of candidate.provisionalIntrusionTraces) {
    if (trace.outcome !== "disappears" || trace.firstRemoval?.afterFork !== "i-53" || trace.firstRemoval?.decision !== "flipped") {
      failures.push(`${trace.intrusionId}: was not first removed by i-53 flipped`);
    }
  }
}
if (bounded.laterForkChoicesDependOnCandidate || divides.laterForkChoicesDependOnCandidate) failures.push("a later fork decision unexpectedly depended on the focus candidate");

const output = {
  experiment: "provisional-versus-completed intrusion-aware orientation candidates",
  checkpoint: CHECKPOINT_SHA,
  fixedScore: "nodeOverlapCount + properCrossingCount + unrelatedNodeEdgeIntrusionCount",
  fixtureReports,
  diagnosis: {
    dividesI25ProvisionalCountAccounting: {
      defaultPairCounts: eventPairCounts(divides.defaultCandidate),
      flippedPairCounts: eventPairCounts(divides.flippedCandidate),
      explanation: "Both candidates contain i-53-yes × i-54. Default additionally contains i-55-jump × i-49 and i-55-jump × i-50; flipped instead has one extra segment-level i-57-cont × i-55 event (two segments rather than one). The net is 4 versus 3, not a single isolated pair.",
    },
    everyDividesProvisionalIntrusionFirstRemovedBy: { realForkId: "i-53", decision: "flipped" },
    boundedI22IntrusionPersistent: true,
    completedPreference: {
      boundedI22: "flipped (completed score 0 versus 1)",
      dividesI25: "default (completed score 0 versus 1)",
    },
    laterForkChoicesDifferByFocusCandidate: false,
    interpretation: "The i-25 signal is transient geometry controlled by unresolved i-53. Candidate completion exposes the correct preference. A blanket unresolved-geometry filter is not supported because i-22's persistent intrusion is also geometrically affected by unresolved i-10; distinguishing persistence would require testing unresolved alternatives.",
  },
  freeze: {
    productionFilesChanged: false,
    orientationMetricChanged: false,
    weightsChanged: false,
    edgeOverlapScored: false,
    lookaheadImplemented: false,
    repairApplied: false,
    defectsFiltered: false,
    laterForkPins: [],
  },
};

if (failures.length) throw new Error(`transient orientation diagnosis failed: ${failures.join("; ")}`);
console.log(JSON.stringify(output, null, 2));
