import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PARITY_FIXTURES,
  PARITY_STAGES,
  canonicalGeometryFromSnapshot,
  compareSnapshots,
  geometryDelta,
  snapshotFromView,
  stableStringify,
} from "../lib/parity_data.mjs";
import { buildCheckpointStageView } from "../../../../urmwebpage/frontend/.flow-layout-probes/current_harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const PACKAGE = path.resolve(HERE, "..");
const MANIFEST_PATH = path.join(PACKAGE, "manifest.json");
const PROGRAMS_PATH = path.join(ROOT, "experiments/sketchv4/archive-2026-09-05/programs.json");
const DEFAULT_CANDIDATE = path.join(ROOT, "urmwebpage/frontend/.flow-layout-probes/current_harness.mjs");

function usage(message = null) {
  if (message) console.error(`error: ${message}\n`);
  console.error(`Usage:
  node ${path.relative(ROOT, fileURLToPath(import.meta.url))} --stage A --fixture characteristic:divides
  node ${path.relative(ROOT, fileURLToPath(import.meta.url))} --stage E --all
  node ${path.relative(ROOT, fileURLToPath(import.meta.url))} --all-stages --all

Options:
  --candidate-module PATH   module exporting buildParityCandidate or buildCheckpointStageView
  --json                    emit a machine-readable result
`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { stages: [], fixtures: [], json: false, candidateModule: DEFAULT_CANDIDATE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--stage") args.stages.push(String(argv[++index] ?? "").toUpperCase());
    else if (arg === "--fixture") args.fixtures.push(argv[++index] ?? "");
    else if (arg === "--all-stages") args.stages = [...PARITY_STAGES];
    else if (arg === "--all") args.fixtures = [...PARITY_FIXTURES];
    else if (arg === "--candidate-module") args.candidateModule = path.resolve(ROOT, argv[++index] ?? "");
    else if (arg === "--json") args.json = true;
    else usage(`unknown option ${arg}`);
  }
  if (args.stages.length === 0) usage("choose --stage or --all-stages");
  if (args.fixtures.length === 0) usage("choose --fixture or --all");
  for (const stage of args.stages) if (!PARITY_STAGES.includes(stage)) usage(`unknown stage ${stage}`);
  for (const fixture of args.fixtures) if (!PARITY_FIXTURES.includes(fixture)) usage(`unknown fixture ${fixture}`);
  return {
    ...args,
    stages: [...new Set(args.stages)],
    fixtures: [...new Set(args.fixtures)],
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function addGeometryDigest(snapshot) {
  const canonical = canonicalGeometryFromSnapshot(snapshot);
  snapshot.geometry = { canonicalBytes: canonical.length, sha256: sha256(canonical) };
  return snapshot;
}

function readJson(absolute) {
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function firstValueDifference(expected, actual, at = "") {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    return { path: at || "$", expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return { path: at || "$", expected, actual };
    if (expected.length !== actual.length) {
      return { path: `${at || "$"}.length`, expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const result = firstValueDifference(expected[index], actual[index], `${at}[${index}]`);
      if (result) return result;
    }
    return null;
  }
  if (typeof expected === "object") {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
        return { path: `${at || "$"}.${key}`, expected: expected[key], actual: actual[key] };
      }
      const result = firstValueDifference(expected[key], actual[key], `${at || "$"}.${key}`);
      if (result) return result;
    }
    return null;
  }
  return { path: at || "$", expected, actual };
}

function rowIndex(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function collectionDetail(referenceRows, candidateRows, delta, key) {
  const reference = rowIndex(referenceRows, key);
  const candidate = rowIndex(candidateRows, key);
  const id = delta.added[0] ?? delta.removed[0] ?? delta.changed[0];
  if (!id) return null;
  return {
    id,
    kind: delta.added.includes(id) ? "added" : delta.removed.includes(id) ? "removed" : "changed",
    difference: firstValueDifference(reference.get(id), candidate.get(id)),
  };
}

function parityFailures(reference, candidate) {
  const delta = compareSnapshots(reference, candidate);
  const failures = [];
  if (reference.geometry.sha256 !== candidate.geometry.sha256) {
    failures.push({
      type: "hash mismatch",
      expected: reference.geometry.sha256,
      actual: candidate.geometry.sha256,
    });
  }
  if (delta.orientationDiffCount) {
    failures.push({
      type: "orientation mismatch",
      delta: delta.orientation,
      first: collectionDetail(reference.orientation, candidate.orientation, delta.orientation, "id"),
    });
  }
  if (delta.nodeDiffCount) {
    failures.push({
      type: "node-box mismatch",
      delta: delta.nodes,
      first: collectionDetail(reference.nodes, candidate.nodes, delta.nodes, "id"),
    });
  }
  if (delta.routeDiffCount) {
    failures.push({
      type: "route mismatch",
      delta: delta.routes,
      first: collectionDetail(reference.routes, candidate.routes, delta.routes, "edgeId"),
    });
  }
  if (delta.portDiffCount) {
    failures.push({
      type: "port mismatch",
      delta: delta.ports,
      first: collectionDetail(reference.ports, candidate.ports, delta.ports, "edgeId"),
    });
  }
  const terminalDifference = firstValueDifference(reference.terminal, candidate.terminal);
  if (terminalDifference) failures.push({ type: "terminal mismatch", first: terminalDifference });
  if (failures.length) {
    failures.push({
      type: "unexpected changed object",
      nodes: delta.nodes,
      routes: delta.routes,
      ports: delta.ports,
      orientation: delta.orientation,
      terminalChanged: delta.terminalChanged,
    });
  }
  return failures;
}

function layerBContractFailures(referenceA, referenceB, candidate, view) {
  const failures = [];
  const expectedEvidence = referenceB.diagnostics.stageEvidence;
  const actualEvidence = candidate.diagnostics.stageEvidence;
  for (const field of [
    "eligibleConditionalMergeEdgeIds",
    "adaptiveChangedEdgeIds",
    "adaptiveDecisions",
  ]) {
    const difference = firstValueDifference(expectedEvidence[field], actualEvidence[field]);
    if (difference) failures.push({ type: `Layer B ${field} mismatch`, first: difference });
  }

  const structurallyEligible = view.cfg.edges
    .filter((edge) => (
      (edge.branch === "yes" || edge.branch === "no")
      && view.roles.edgeRoleById.get(edge.id) === "merge-connector"
      && view.cfg.nodeById.get(edge.from)?.kind === "conditionalJump"
    ))
    .map((edge) => edge.id);
  const eligibilityDifference = firstValueDifference(
    expectedEvidence.eligibleConditionalMergeEdgeIds,
    structurallyEligible,
  );
  if (eligibilityDifference) {
    failures.push({ type: "Layer B structural eligibility mismatch", first: eligibilityDifference });
  }

  const routesA = rowIndex(referenceA.routes, "edgeId");
  const routesB = rowIndex(candidate.routes, "edgeId");
  const portsA = rowIndex(referenceA.ports, "edgeId");
  const portsB = rowIndex(candidate.ports, "edgeId");
  const nodesB = rowIndex(candidate.nodes, "id");
  const orientationB = rowIndex(candidate.orientation, "id");
  const decisionById = rowIndex(actualEvidence.adaptiveDecisions, "edgeId");

  for (const edgeId of structurallyEligible) {
    const edge = view.cfg.edgeById.get(edgeId);
    const beforeRoute = routesA.get(edgeId);
    const afterRoute = routesB.get(edgeId);
    const beforePort = portsA.get(edgeId);
    const afterPort = portsB.get(edgeId);
    const decision = decisionById.get(edgeId);
    const orientation = orientationB.get(edge.from);
    const visualSide = orientation?.[edge.branch];
    const sourceBox = nodesB.get(edge.from)?.box;
    const siblingArm = view.skeleton.armSegments.find((arm) => (
      arm.srcDiamond === edge.from && arm.side !== visualSide
    ));
    const expectedSourcePort = visualSide === "left"
      ? [(sourceBox.left + sourceBox.cx) / 2, (sourceBox.cy + sourceBox.bottom) / 2]
      : [(sourceBox.cx + sourceBox.right) / 2, (sourceBox.cy + sourceBox.bottom) / 2];
    for (const [label, expected, actual] of [
      ["target route port", beforeRoute?.targetPort, afterRoute?.targetPort],
      ["target port record", beforePort?.targetPort, afterPort?.targetPort],
      ["semantic branch doorway", expectedSourcePort, afterRoute?.sourcePort],
      ["route/port source agreement", afterRoute?.sourcePort, afterPort?.sourcePort],
    ]) {
      const difference = firstValueDifference(expected, actual);
      if (difference) failures.push({ type: `Layer B ${edgeId} ${label} mismatch`, first: difference });
    }
    const points = afterRoute?.points ?? [];
    if (points.length !== 4
      || points[1]?.[0] !== points[2]?.[0]
      || points[2]?.[1] !== points[3]?.[1]
      || firstValueDifference(points[3], afterRoute?.targetPort)) {
      failures.push({ type: `Layer B ${edgeId} route is not ray→vertical→horizontal` });
    }
    const rayDx = Math.abs((decision?.chosenRayEndpoint?.[0] ?? 0) - (decision?.sourcePort?.[0] ?? 0));
    const rayDy = (decision?.chosenRayEndpoint?.[1] ?? 0) - (decision?.sourcePort?.[1] ?? 0);
    const siblingDx = Math.abs((siblingArm?.targetTop?.[0] ?? 0) - (siblingArm?.face?.[0] ?? 0));
    const siblingDy = (siblingArm?.targetTop?.[1] ?? 0) - (siblingArm?.face?.[1] ?? 0);
    if (!siblingArm || rayDx <= 0 || siblingDx <= 0
      || Math.abs(rayDy / rayDx - siblingDy / siblingDx) > 1e-9) {
      failures.push({ type: `Layer B ${edgeId} source ray did not preserve the sibling exit angle` });
    }
    if (decision?.shortened) {
      const direction = visualSide === "left" ? -1 : 1;
      const run = direction * (decision.chosenRayEndpoint[0] - decision.sourcePort[0]);
      if (Math.abs(run - decision.availableBoundaryGap / 2) > 1e-9) {
        failures.push({ type: `Layer B ${edgeId} shortened ray is not at the boundary-gap midpoint` });
      }
    } else if (firstValueDifference(decision?.fullRayEndpoint, decision?.chosenRayEndpoint)) {
      failures.push({ type: `Layer B ${edgeId} clear full sibling ray was not retained` });
    }
  }

  if (view.conditionalMergeSources?.contract?.edgeGeometryInfluencesDecision !== false) {
    failures.push({ type: "Layer B edge geometry influenced adaptive shortening" });
  }
  return failures;
}

function layerCContractFailures(referenceB, referenceC, candidate, view) {
  const failures = [];
  const expectedEvidence = referenceC.diagnostics.stageEvidence.i57CompatibilityRoute;
  const actualEvidence = candidate.diagnostics.stageEvidence.i57CompatibilityRoute;
  const evidenceDifference = firstValueDifference(expectedEvidence, actualEvidence);
  if (evidenceDifference) failures.push({ type: "Layer C reentry evidence mismatch", first: evidenceDifference });

  const expectedEdgeIds = expectedEvidence ? [expectedEvidence.edgeId] : [];
  const selectedDifference = firstValueDifference(expectedEdgeIds, view.sameSideReentries.eligibleEdgeIds);
  if (selectedDifference) failures.push({ type: "Layer C structural selector mismatch", first: selectedDifference });

  for (const record of view.sameSideReentries.records) {
    const route = view.routed.routes.find((candidateRoute) => candidateRoute.edgeId === record.edgeId);
    const port = view.routed.ports.get(record.edgeId);
    const sourceBox = view.boxes.get(route?.source);
    const targetBox = view.boxes.get(route?.target);
    const expectedSource = sourceBox && [sourceBox.right, sourceBox.cy];
    const expectedTarget = targetBox && [targetBox.right, targetBox.cy];
    const expectedCorridorX = Math.max(sourceBox?.right ?? -Infinity, targetBox?.right ?? -Infinity) + 16;
    for (const [label, expected, actual] of [
      ["source right-centre", expectedSource, route?.sourcePort],
      ["target right-centre", expectedTarget, route?.targetPort],
      ["source port record", route?.sourcePort, port?.sourcePort],
      ["target port record", route?.targetPort, port?.targetPort],
    ]) {
      const difference = firstValueDifference(expected, actual);
      if (difference) failures.push({ type: `Layer C ${record.edgeId} ${label} mismatch`, first: difference });
    }
    const points = route?.points ?? [];
    if (points.length !== 4
      || points[0]?.[1] !== points[1]?.[1]
      || points[1]?.[0] !== points[2]?.[0]
      || points[2]?.[1] !== points[3]?.[1]
      || points[1]?.[0] !== expectedCorridorX) {
      failures.push({ type: `Layer C ${record.edgeId} route is not exact right/right H/V/H` });
    }
  }

  const contract = view.sameSideReentries.contract;
  for (const field of [
    "fixtureIdentityUsed",
    "edgeIdentityUsed",
    "instructionIndexUsed",
    "terminalIdentityUsed",
    "frozenCoordinatesUsed",
    "routeFamilyChanged",
    "automaticRepairAfterConstruction",
    "obstacleSearchUsed",
  ]) {
    if (contract[field] !== false) failures.push({ type: `Layer C contract ${field} must remain false` });
  }

  const beforeI25 = referenceB.diagnostics.orientationResult?.rows?.find((row) => row.realForkId === "i-25");
  const afterI25 = view.orientationResult?.rows?.find((row) => row.realForkId === "i-25");
  if (referenceC.fixture === "characteristic:divides") {
    const expectedBefore = { costDefault: 4, costFlipped: 3, v4AssignedBit: "flipped" };
    const expectedAfter = { costDefault: 3, costFlipped: 3, v4AssignedBit: "default" };
    for (const [label, row, expected] of [
      ["Stage B i-25", beforeI25, expectedBefore],
      ["Stage C i-25", afterI25, expectedAfter],
    ]) {
      for (const [field, value] of Object.entries(expected)) {
        if (row?.[field] !== value) failures.push({ type: `${label} ${field} mismatch`, expected: value, actual: row?.[field] });
      }
    }
  }
  return failures;
}

function layerDContractFailures(referenceC, referenceD, candidate, view) {
  const failures = [];
  const expectedEvidence = referenceD.diagnostics.stageEvidence;
  const actualEvidence = candidate.diagnostics.stageEvidence;
  for (const field of [
    "loopSourceChanges",
    "loopReturnEdgeCount",
    "legalLoopSourceCount",
    "legalLoopTargetCount",
    "loopTargetChanges",
  ]) {
    const difference = firstValueDifference(expectedEvidence[field], actualEvidence[field]);
    if (difference) failures.push({ type: `Layer D ${field} mismatch`, first: difference });
  }

  const expectedDelta = geometryDelta(referenceC, referenceD);
  const expectedChangedIds = expectedDelta.routes.changed;
  const actualChangedIds = [...view.generalizedLoopSources.changedEdgeIds].sort();
  const changedDifference = firstValueDifference(expectedChangedIds, actualChangedIds);
  if (changedDifference) failures.push({ type: "Layer D changed-route census mismatch", first: changedDifference });

  const loopRoutes = view.routed.routes.filter((route) => route.edgeRole === "loop-return");
  const consideredDifference = firstValueDifference(
    loopRoutes.map((route) => route.edgeId),
    view.generalizedLoopSources.consideredEdgeIds,
  );
  if (consideredDifference) failures.push({ type: "Layer D structural loop-return selector mismatch", first: consideredDifference });

  const routeById = rowIndex(view.routed.routes, "edgeId");
  for (const record of view.generalizedLoopSources.records) {
    const route = routeById.get(record.edgeId);
    const port = view.routed.ports.get(record.edgeId);
    const sourceBox = view.boxes.get(route?.source);
    for (const [description, expected, actual] of [
      ["target route port", record.targetPort, route?.targetPort],
      ["target port record", record.oldTargetPortRecord, record.newTargetPortRecord],
      ["rail", record.railCoord, route?.railCoord],
      ["final points", record.newRoutePoints, route?.points],
    ]) {
      const difference = firstValueDifference(expected, actual);
      if (difference) failures.push({ type: `Layer D ${record.edgeId} ${description} mismatch`, first: difference });
    }
    if (record.bodyClassification === "vertical-first") {
      for (const [description, expected, actual] of [
        ["bottom-center source", [sourceBox?.cx, sourceBox?.bottom], route?.sourcePort],
        ["source port record", route?.sourcePort, port?.sourcePort],
        ["unchanged bend row", [sourceBox?.cx, record.bendRow], route?.points?.[1]],
        ["unchanged route suffix", record.oldRoutePoints.slice(2), record.newRoutePoints.slice(2)],
      ]) {
        const difference = firstValueDifference(expected, actual);
        if (difference) failures.push({ type: `Layer D ${record.edgeId} ${description} mismatch`, first: difference });
      }
      if (!record.routeChanged || record.newAttachmentLegality?.source !== true) {
        failures.push({ type: `Layer D ${record.edgeId} vertical-first source was not made legal` });
      }
    } else if (record.bodyClassification !== "lateral-first"
      || record.routeChanged
      || firstValueDifference(record.oldRoutePoints, record.newRoutePoints)) {
      failures.push({ type: `Layer D ${record.edgeId} lateral-first route was not preserved` });
    }
  }

  const contract = view.generalizedLoopSources.contract;
  for (const field of [
    "fixtureIdentityUsed",
    "edgeIdentityUsed",
    "instructionIndexUsed",
    "terminalIdentityUsed",
    "frozenCoordinatesUsed",
    "loopReturnRailsChanged",
    "loopBendRowsChanged",
    "targetPortSelectionChanged",
    "targetEntryGeometryChanged",
    "nodePositionsChanged",
    "orientationPolicyChanged",
    "nonLoopRoutesChanged",
    "automaticRepairAfterConstruction",
    "obstacleSearchUsed",
  ]) {
    if (contract[field] !== false) failures.push({ type: `Layer D contract ${field} must remain false` });
  }
  if (actualEvidence.loopTargetChanges.length !== 0
    || Object.hasOwn(view, "generalizedLoopTargets")
    || [...view.routed.ports.values()].some((record) => record.experimentalGeneralizedTargetPort)) {
    failures.push({ type: "Stage E target attachment appeared in Layer D" });
  }
  return failures;
}

function verifyReferenceIntegrity(manifest, cache, stage, fixture) {
  const expected = manifest.stageHashes[stage][fixture];
  const absolute = path.join(PACKAGE, expected.reference);
  const bytes = fs.readFileSync(absolute);
  const fileHash = sha256(bytes);
  if (fileHash !== manifest.referenceFileSha256[expected.reference]) {
    throw new Error(`${stage}/${fixture}: frozen reference file SHA mismatch`);
  }
  const snapshot = JSON.parse(bytes.toString("utf8"));
  if (bytes.toString("utf8") !== stableStringify(snapshot, 2)) {
    throw new Error(`${stage}/${fixture}: frozen reference serialization is not stable`);
  }
  if (snapshot.schemaVersion !== manifest.schemaVersion || snapshot.stage !== stage || snapshot.fixture !== fixture) {
    throw new Error(`${stage}/${fixture}: frozen reference identity/schema mismatch`);
  }
  if (snapshot.provenance.sourceCheckpoint !== manifest.provenance.sourceCheckpoint.commit
    || snapshot.provenance.sourceHarnessCommit !== manifest.provenance.sourceHarnessCommit
    || snapshot.provenance.fixtureSnapshotSha256 !== manifest.provenance.fixtureSnapshotSha256
    || snapshot.provenance.archiveContentSetSha256 !== manifest.provenance.archiveContentSetSha256) {
    throw new Error(`${stage}/${fixture}: frozen reference provenance mismatch`);
  }
  const canonical = canonicalGeometryFromSnapshot(snapshot);
  const geometryHash = sha256(canonical);
  if (geometryHash !== expected.sha256 || geometryHash !== snapshot.geometry.sha256) {
    throw new Error(`${stage}/${fixture}: frozen reference geometry hash mismatch`);
  }
  if (canonical.length !== expected.canonicalBytes || canonical.length !== snapshot.geometry.canonicalBytes) {
    throw new Error(`${stage}/${fixture}: frozen canonical byte count mismatch`);
  }
  cache[stage] ??= {};
  cache[stage][fixture] = snapshot;
  return snapshot;
}

function verifyFrozenTransitionDeltas(manifest, cache) {
  for (const transition of ["BASE_TO_A", "A_TO_B", "B_TO_C", "C_TO_D", "D_TO_E"]) {
    const [before, after] = transition.split("_TO_");
    for (const fixture of PARITY_FIXTURES) {
      const actual = geometryDelta(cache[before][fixture], cache[after][fixture]);
      const expected = manifest.expectedDeltas.normalOrientation[transition][fixture];
      const difference = firstValueDifference(expected, actual);
      if (difference) {
        throw new Error(`${transition}/${fixture}: frozen expected-delta assertion mismatch at ${difference.path}`);
      }
    }
  }
}

async function loadCandidateBuilder(candidatePath) {
  const module = await import(pathToFileURL(candidatePath).href);
  const builder = module.buildParityCandidate ?? module.buildCheckpointStageView;
  if (typeof builder !== "function") {
    throw new Error(`${candidatePath} must export buildParityCandidate or buildCheckpointStageView`);
  }
  return builder;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(MANIFEST_PATH);
  const programs = readJson(PROGRAMS_PATH);
  const references = {};

  // Every run verifies the entire immutable reference set and the stored normal-stage deltas.
  for (const stage of PARITY_STAGES) {
    for (const fixture of PARITY_FIXTURES) verifyReferenceIntegrity(manifest, references, stage, fixture);
  }
  verifyFrozenTransitionDeltas(manifest, references);

  const buildCandidate = await loadCandidateBuilder(args.candidateModule);
  const rows = [];
  let failed = false;
  for (const stage of args.stages) {
    for (const fixture of args.fixtures) {
      const view = await buildCandidate(programs[fixture], fixture, stage);
      const candidate = addGeometryDigest(snapshotFromView(view, fixture, stage, {
        comparisonSource: path.relative(ROOT, args.candidateModule),
      }));
      const reference = references[stage][fixture];
      const failures = parityFailures(reference, candidate);
      if (stage === "B") {
        failures.push(...layerBContractFailures(references.A[fixture], references.B[fixture], candidate, view));
      }
      if (["C", "D"].includes(stage)) {
        failures.push(...layerCContractFailures(references.B[fixture], references.C[fixture], candidate, view));
      }
      if (stage === "C") {
        const fixedOrientationMap = new Map(reference.orientation.map((row) => [row.id, { no: row.no, yes: row.yes }]));
        const fixedBView = buildCheckpointStageView(programs[fixture], fixture, "B", { orientationMap: fixedOrientationMap });
        const fixedB = snapshotFromView(fixedBView, fixture, "B", { comparisonSource: "tested checkpoint harness" });
        const fixedCView = await buildCandidate(programs[fixture], fixture, "C", { orientationMap: fixedOrientationMap });
        const fixedC = snapshotFromView(fixedCView, fixture, "C", { comparisonSource: "live production fixed orientation" });
        const expectedFixedDelta = manifest.expectedDeltas.fixedOrientation.B_TO_C[fixture];
        const actualFixedDelta = geometryDelta(fixedB, fixedC);
        const fixedDifference = firstValueDifference(expectedFixedDelta, actualFixedDelta);
        if (fixedDifference) {
          failures.push({
            type: "fixed-orientation B→C delta mismatch",
            first: fixedDifference,
            expected: expectedFixedDelta,
            actual: actualFixedDelta,
          });
        }
      }
      if (stage === "D") {
        failures.push(...layerDContractFailures(references.C[fixture], reference, candidate, view));
        const fixedOrientationMap = new Map(reference.orientation.map((row) => [row.id, { no: row.no, yes: row.yes }]));
        const fixedCView = buildCheckpointStageView(programs[fixture], fixture, "C", { orientationMap: fixedOrientationMap });
        const fixedC = snapshotFromView(fixedCView, fixture, "C", { comparisonSource: "tested checkpoint harness" });
        const fixedDView = await buildCandidate(programs[fixture], fixture, "D", { orientationMap: fixedOrientationMap });
        const fixedD = snapshotFromView(fixedDView, fixture, "D", { comparisonSource: "live production fixed orientation" });
        const expectedFixedDelta = manifest.expectedDeltas.fixedOrientation.C_TO_D[fixture];
        const actualFixedDelta = geometryDelta(fixedC, fixedD);
        const fixedDifference = firstValueDifference(expectedFixedDelta, actualFixedDelta);
        if (fixedDifference) {
          failures.push({
            type: "fixed-orientation C→D delta mismatch",
            first: fixedDifference,
            expected: expectedFixedDelta,
            actual: actualFixedDelta,
          });
        }
      }
      // Production stages are also characterized against their immutable predecessor. Checking
      // that stored transition explicitly makes an accidental out-of-layer change immediately
      // visible, in addition to whole-layout parity.
      const transition = stage === "A" ? "BASE_TO_A"
        : stage === "B" ? "A_TO_B"
          : stage === "C" ? "B_TO_C"
            : stage === "D" ? "C_TO_D"
            : null;
      if (transition) {
        const priorStage = transition.split("_TO_")[0];
        const expectedDelta = manifest.expectedDeltas.normalOrientation[transition][fixture];
        const actualDelta = geometryDelta(references[priorStage][fixture], candidate);
        const difference = firstValueDifference(expectedDelta, actualDelta);
        if (difference) {
          failures.push({
            type: `${transition.replace("_TO_", "→")} delta mismatch`,
            first: difference,
            expected: expectedDelta,
            actual: actualDelta,
          });
        }
      }
      failed ||= failures.length > 0;
      rows.push({
        stage,
        fixture,
        status: failures.length ? "FAIL" : "PASS",
        expectedHash: reference.geometry.sha256,
        actualHash: candidate.geometry.sha256,
        failures,
      });
    }
  }

  if (args.json) {
    console.log(stableStringify({
      status: failed ? "FAIL" : "PASS",
      candidateModule: path.relative(ROOT, args.candidateModule),
      referenceIntegrity: "PASS (30 files and five stage transitions)",
      results: rows,
    }, 2));
  } else {
    console.log(`Reference integrity: PASS (30 files and five stage transitions)`);
    console.log(`Candidate: ${path.relative(ROOT, args.candidateModule)}`);
    for (const row of rows) {
      console.log(`${row.status} ${row.stage} ${row.fixture} ${row.actualHash}`);
      for (const failure of row.failures) console.log(`  ${failure.type}: ${stableStringify(failure)}`.trimEnd());
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
