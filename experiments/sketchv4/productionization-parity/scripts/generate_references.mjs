import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildCheckpointStageView,
} from "../../../../urmwebpage/frontend/.flow-layout-probes/current_harness.mjs";
import {
  PARITY_FIXTURES,
  PARITY_SCHEMA_VERSION,
  PARITY_STAGES,
  canonicalGeometryFromSnapshot,
  fixtureSlug,
  geometryDelta,
  referenceRelativePath,
  snapshotFromView,
  stableStringify,
} from "../lib/parity_data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const PACKAGE = path.resolve(HERE, "..");
const REFERENCES = path.join(PACKAGE, "references");
const ARCHIVE = path.join(ROOT, "experiments/sketchv4/archive-2026-09-05");
const PROGRAMS_PATH = path.join(ARCHIVE, "programs.json");

const TARGET_CHECKPOINT = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const SOURCE_HARNESS_COMMIT = "990d9f7c21f35ff16239eeea027c767ec683f922";
const ARCHIVE_DIGEST = "2c5a07b33abc61a758ec7017c825389d065c0e73902a2a92a67cb74ce115a833";
const FIXTURE_DIGEST = "e77a35d377920b7546b406eaa9d7f6e788a7208d8433ea2e798f6d740d7120f5";
const GENERATION_DATE = "2026-09-06";

const EXPECTED_HASHES = {
  BASE: {
    "minimization:bounded_sub": "09979c3772117058460fbbc8c7af00e778f9b8666975388a263dd34a3d846ec3",
    "characteristic:divides": "8a7511f00ddf6e24e5713b5a0e54e895821817c3936a0d8a0029f63cb2d1800b",
    "characteristic:eq": "fc65f1267c4dd46587df5befd03f304824b9e0d8cd1b02b21167c4d3ade5123f",
    "primrec:basic": "475edf94da4d479ab532f3a29008603ff803cc4b440ddd94118f16153648a1ce",
    predecessor: "b81fb7d2f71c3c6c8d6956f44d75f45cccc982687cb236790779c3209c1308b4",
  },
  A: {
    "minimization:bounded_sub": "94718bf10822533e711d62fa9b4eaaacba28ce0a775701738a89a5a8904f6cf9",
    "characteristic:divides": "fe21090d207cb59ae6de696dec41edef7db8feb2accecfe4e8446e10c3a36973",
    "characteristic:eq": "13d46e825aece6233ffc1b5e806ad85367ad193104c4cfa9c0e4593e3f788011",
    "primrec:basic": "be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f",
    predecessor: "09be6cd8dadc7978e345333cab7009ae22161fda0249c41073594c5ae92ff6fc",
  },
  B: {
    "minimization:bounded_sub": "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
    "characteristic:divides": "c8eb0fc0f5529b32bddbd4f81a59bb52ca0abd8c64eabd4333ab1e08ee0a9fbe",
    "characteristic:eq": "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
    "primrec:basic": "be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f",
    predecessor: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
  },
  C: {
    "minimization:bounded_sub": "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
    "characteristic:divides": "0122c288cfb31b2c76206e6cb27c57a6c892e5c654dd56bad18d190e20d3bb92",
    "characteristic:eq": "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
    "primrec:basic": "be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f",
    predecessor: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
  },
  D: {
    "minimization:bounded_sub": "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
    "characteristic:divides": "2a9354a026f3191452d8c16e05f7c648652c0f2f1299bd85b5850641da454341",
    "characteristic:eq": "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
    "primrec:basic": "e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f",
    predecessor: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
  },
  E: {
    "minimization:bounded_sub": "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
    "characteristic:divides": "72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd",
    "characteristic:eq": "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
    "primrec:basic": "e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f",
    predecessor: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
  },
};

const EXPECTED_ELIGIBLE = {
  "minimization:bounded_sub": ["i-12-yes"],
  "characteristic:divides": ["i-15-yes", "i-38-yes", "i-53-yes"],
  "characteristic:eq": ["i-11-yes", "i-31-yes", "i-46-yes"],
  "primrec:basic": [],
  predecessor: ["i-0-yes"],
};

const EXPECTED_SHORTENED = {
  "minimization:bounded_sub": [],
  "characteristic:divides": ["i-15-yes", "i-38-yes"],
  "characteristic:eq": [],
  "primrec:basic": [],
  predecessor: [],
};

const EXPECTED_LOOP_SOURCE_CHANGES = {
  "minimization:bounded_sub": [],
  "characteristic:divides": ["i-27-jump", "i-52-jump"],
  "characteristic:eq": [],
  "primrec:basic": ["i-19-jump"],
  predecessor: [],
};

function sha256(bufferOrText) {
  return crypto.createHash("sha256").update(bufferOrText).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

function archiveContentDigest() {
  const base = path.join(ARCHIVE, "flow-layout-probes");
  const lines = walkFiles(base)
    .filter((file) => !file.endsWith("CHECKPOINT.md"))
    .map((file) => `${sha256(fs.readFileSync(file))}  ${path.relative(base, file)}\n`)
    .sort();
  return sha256(lines.join(""));
}

function assertEqual(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label}\nexpected ${stableStringify(expected, 2)}actual ${stableStringify(actual, 2)}`);
  }
}

function assertIds(deltaPart, expected, label) {
  assertEqual(deltaPart, { added: [], removed: [], changed: [...expected].sort() }, label);
}

function orientationObject(snapshot) {
  return Object.fromEntries(snapshot.orientation.map((row) => [row.id, row.bit]));
}

function loadPrograms() {
  const programs = JSON.parse(fs.readFileSync(PROGRAMS_PATH, "utf8"));
  for (const fixture of PARITY_FIXTURES) {
    if (!Array.isArray(programs[fixture])) throw new Error(`fixture snapshot is missing ${fixture}`);
  }
  return programs;
}

function preflight() {
  if (git("rev-parse", "HEAD") !== SOURCE_HARNESS_COMMIT) {
    throw new Error(`generation must start at source harness HEAD ${SOURCE_HARNESS_COMMIT}`);
  }
  for (const ref of [
    "checkpoint/sketchv4-loop-endpoints-composed",
    "sketchv4-loop-endpoints-composed-checkpoint^{}",
    "refs/remotes/origin/checkpoint/sketchv4-loop-endpoints-composed",
  ]) {
    if (git("rev-parse", ref) !== TARGET_CHECKPOINT) throw new Error(`checkpoint ref moved: ${ref}`);
  }
  if (archiveContentDigest() !== ARCHIVE_DIGEST) throw new Error("archive content digest mismatch");
  if (sha256(fs.readFileSync(PROGRAMS_PATH)) !== FIXTURE_DIGEST) throw new Error("fixture snapshot digest mismatch");
  if (fs.existsSync(path.join(PACKAGE, "manifest.json")) && !process.argv.includes("--reviewed-replace")) {
    throw new Error("references already exist; refusing to regenerate characterization evidence without --reviewed-replace");
  }
}

function addGeometryDigest(snapshot) {
  const canonical = canonicalGeometryFromSnapshot(snapshot);
  snapshot.geometry = {
    canonicalBytes: canonical.length,
    sha256: sha256(canonical),
  };
  return snapshot;
}

function makeSnapshot(view, fixture, stage) {
  return addGeometryDigest(snapshotFromView(view, fixture, stage, {
    sourceCheckpoint: TARGET_CHECKPOINT,
    sourceHarnessCommit: SOURCE_HARNESS_COMMIT,
    fixtureSnapshotSha256: FIXTURE_DIGEST,
    archiveContentSetSha256: ARCHIVE_DIGEST,
    generatedOn: GENERATION_DATE,
  }));
}

preflight();
const programs = loadPrograms();
const snapshots = Object.fromEntries(PARITY_STAGES.map((stage) => [stage, {}]));
const views = Object.fromEntries(PARITY_STAGES.map((stage) => [stage, {}]));
const stageHashes = {};
const orientationMaps = {};
const referenceFiles = {};

for (const stage of PARITY_STAGES) {
  stageHashes[stage] = {};
  orientationMaps[stage] = {};
  for (const fixture of PARITY_FIXTURES) {
    const view = buildCheckpointStageView(programs[fixture], fixture, stage);
    const snapshot = makeSnapshot(view, fixture, stage);
    const expectedHash = EXPECTED_HASHES[stage][fixture];
    if (snapshot.geometry.sha256 !== expectedHash) {
      throw new Error(`${stage}/${fixture}: expected ${expectedHash}, got ${snapshot.geometry.sha256}`);
    }
    views[stage][fixture] = view;
    snapshots[stage][fixture] = snapshot;
    const relative = referenceRelativePath(stage, fixture);
    const contents = stableStringify(snapshot, 2);
    const absolute = path.join(PACKAGE, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
    stageHashes[stage][fixture] = { ...snapshot.geometry, reference: relative };
    orientationMaps[stage][fixture] = orientationObject(snapshot);
    referenceFiles[relative] = sha256(contents);
  }
}

const transitionDeltas = {};
for (const [beforeStage, afterStage] of [["BASE", "A"], ["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]) {
  const transition = `${beforeStage}_TO_${afterStage}`;
  transitionDeltas[transition] = {};
  for (const fixture of PARITY_FIXTURES) {
    transitionDeltas[transition][fixture] = geometryDelta(
      snapshots[beforeStage][fixture],
      snapshots[afterStage][fixture],
    );
  }
}

for (const fixture of PARITY_FIXTURES) {
  const delta = transitionDeltas.A_TO_B[fixture];
  assertIds(delta.nodes, [], `A->B ${fixture} node delta`);
  assertIds(delta.orientation, [], `A->B ${fixture} orientation delta`);
  assertIds(delta.routes, EXPECTED_ELIGIBLE[fixture], `A->B ${fixture} route delta`);
  assertIds(delta.ports, EXPECTED_ELIGIBLE[fixture], `A->B ${fixture} port delta`);
  const evidence = snapshots.B[fixture].diagnostics.stageEvidence;
  assertEqual(evidence.eligibleConditionalMergeEdgeIds, EXPECTED_ELIGIBLE[fixture], `B ${fixture} eligible merge set`);
  assertEqual(evidence.adaptiveChangedEdgeIds, EXPECTED_SHORTENED[fixture], `B ${fixture} shortened merge set`);
}

const fixedOrientationDeltas = { B_TO_C: {}, C_TO_D: {}, D_TO_E: {} };
for (const fixture of PARITY_FIXTURES) {
  const cOrientation = views.C[fixture].orientationMap;
  const fixedB = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "B", { orientationMap: cOrientation }), fixture, "B");
  const fixedC = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "C", { orientationMap: cOrientation }), fixture, "C");
  fixedOrientationDeltas.B_TO_C[fixture] = geometryDelta(fixedB, fixedC);
  const expectedC = fixture === "characteristic:divides" ? ["i-57-cont"] : [];
  assertIds(fixedOrientationDeltas.B_TO_C[fixture].nodes, [], `fixed B->C ${fixture} node delta`);
  assertIds(fixedOrientationDeltas.B_TO_C[fixture].orientation, [], `fixed B->C ${fixture} orientation delta`);
  assertIds(fixedOrientationDeltas.B_TO_C[fixture].routes, expectedC, `fixed B->C ${fixture} route delta`);
  assertIds(fixedOrientationDeltas.B_TO_C[fixture].ports, expectedC, `fixed B->C ${fixture} port delta`);

  const dOrientation = views.D[fixture].orientationMap;
  const fixedCForD = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "C", { orientationMap: dOrientation }), fixture, "C");
  const fixedD = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "D", { orientationMap: dOrientation }), fixture, "D");
  fixedOrientationDeltas.C_TO_D[fixture] = geometryDelta(fixedCForD, fixedD);
  assertIds(fixedOrientationDeltas.C_TO_D[fixture].nodes, [], `fixed C->D ${fixture} node delta`);
  assertIds(fixedOrientationDeltas.C_TO_D[fixture].orientation, [], `fixed C->D ${fixture} orientation delta`);
  assertIds(fixedOrientationDeltas.C_TO_D[fixture].routes, EXPECTED_LOOP_SOURCE_CHANGES[fixture], `fixed C->D ${fixture} route delta`);
  assertIds(fixedOrientationDeltas.C_TO_D[fixture].ports, EXPECTED_LOOP_SOURCE_CHANGES[fixture], `fixed C->D ${fixture} port delta`);
  for (const row of snapshots.D[fixture].diagnostics.stageEvidence.loopSourceChanges) {
    if (!row.unchanged.rail.unchanged || !row.unchanged.bendRow.unchanged
      || !row.unchanged.targetAttachment.unchanged || !row.unchanged.routeSuffix.unchanged) {
      throw new Error(`D ${fixture}/${row.edgeId}: source change did not preserve rail, bend row, target attachment, and route suffix`);
    }
  }

  const eOrientation = views.E[fixture].orientationMap;
  const fixedDForE = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "D", { orientationMap: eOrientation }), fixture, "D");
  const fixedE = makeSnapshot(buildCheckpointStageView(programs[fixture], fixture, "E", { orientationMap: eOrientation }), fixture, "E");
  fixedOrientationDeltas.D_TO_E[fixture] = geometryDelta(fixedDForE, fixedE);
  const expectedE = fixture === "characteristic:divides" ? ["i-52-jump"] : [];
  assertIds(fixedOrientationDeltas.D_TO_E[fixture].nodes, [], `fixed D->E ${fixture} node delta`);
  assertIds(fixedOrientationDeltas.D_TO_E[fixture].orientation, [], `fixed D->E ${fixture} orientation delta`);
  assertIds(fixedOrientationDeltas.D_TO_E[fixture].routes, expectedE, `fixed D->E ${fixture} route delta`);
  assertIds(fixedOrientationDeltas.D_TO_E[fixture].ports, expectedE, `fixed D->E ${fixture} port delta`);
}

const finalBoundedOrientation = orientationMaps.E["minimization:bounded_sub"];
const finalDividesOrientation = orientationMaps.E["characteristic:divides"];
if (finalBoundedOrientation["i-22"] !== "default") throw new Error("E bounded_sub i-22 must remain default");
if (finalDividesOrientation["i-25"] !== "default") throw new Error("E divides i-25 must remain default");
assertEqual(
  Object.entries(finalDividesOrientation).filter(([, bit]) => bit === "flipped").map(([id]) => id).sort(),
  ["i-48", "i-53"],
  "E divides flipped orientation set",
);
const i25Row = snapshots.C["characteristic:divides"].diagnostics.orientationResult.rows
  .find((row) => row.realForkId === "i-25");
if (!i25Row || i25Row.costDefault !== 3 || i25Row.costFlipped !== 3 || i25Row.v4AssignedBit !== "default") {
  throw new Error("C divides i-25 must be default on a 3/3 tie");
}
const i57Evidence = snapshots.C["characteristic:divides"].diagnostics.stageEvidence.i57CompatibilityRoute;
assertEqual(i57Evidence.newSourcePort, i57Evidence.newRoutePoints[0], "C divides i-57 right source port");
assertEqual(i57Evidence.newTargetPort, i57Evidence.newRoutePoints.at(-1), "C divides i-57 right target port");
if (i57Evidence.routeShape !== "right port -> H -> V -> H -> right port") {
  throw new Error("C divides i-57 must retain the explicit right/right H/V/H checkpoint route");
}
const finalSuffix = snapshots.E["characteristic:divides"].diagnostics.stageEvidence.loopTargetChanges
  .find((row) => row.edgeId === "i-52-jump")?.newRouteSuffix;
assertEqual(finalSuffix, [
  [-922, 361.1467672771852],
  [-317.2869565217391, 361.1467672771852],
  [-223.7, 413.6467672771852],
], "E divides i-52 final suffix");
const finalLoopTargetCount = PARITY_FIXTURES.reduce(
  (total, fixture) => total + snapshots.E[fixture].diagnostics.stageEvidence.legalLoopTargetCount,
  0,
);
if (finalLoopTargetCount !== 16) throw new Error(`E expected 16 legal loop targets, got ${finalLoopTargetCount}`);

const manifest = {
  schemaVersion: PARITY_SCHEMA_VERSION,
  title: "SketchV4 productionization parity characterization",
  warning: "These reference files are characterization evidence. Do not regenerate them to make a later production implementation pass.",
  provenance: {
    generatedOn: GENERATION_DATE,
    sourceCheckpoint: {
      commit: TARGET_CHECKPOINT,
      branch: "checkpoint/sketchv4-loop-endpoints-composed",
      tag: "sketchv4-loop-endpoints-composed-checkpoint",
    },
    sourceHarnessCommit: SOURCE_HARNESS_COMMIT,
    archiveContentSetSha256: ARCHIVE_DIGEST,
    fixtureSnapshot: "experiments/sketchv4/archive-2026-09-05/programs.json",
    fixtureSnapshotSha256: FIXTURE_DIGEST,
    laterEndpointTransitionResearchIncluded: false,
  },
  fixtures: PARITY_FIXTURES,
  stages: PARITY_STAGES,
  stageDependencyOrder: ["BASE", "A", "B", "C", "D", "E"],
  stageStacks: Object.fromEntries(PARITY_STAGES.map((stage) => [
    stage,
    snapshots[stage]["characteristic:divides"].stageTransformStack,
  ])),
  stageHashes,
  orientationMaps,
  referenceFileSha256: referenceFiles,
  expectedDeltas: {
    normalOrientation: transitionDeltas,
    fixedOrientation: fixedOrientationDeltas,
    eligibleConditionalMergeEdges: EXPECTED_ELIGIBLE,
    adaptivelyShortenedEdges: EXPECTED_SHORTENED,
    loopSourceChangedEdges: EXPECTED_LOOP_SOURCE_CHANGES,
    i57Compatibility: {
      fixture: "characteristic:divides",
      edgeId: "i-57-cont",
      normalOrientationConsequence: { realForkId: "i-25", bit: "default", costDefault: 3, costFlipped: 3 },
      route: snapshots.C["characteristic:divides"].diagnostics.stageEvidence.i57CompatibilityRoute,
    },
    loopSourceChanges: Object.fromEntries(PARITY_FIXTURES.map((fixture) => [
      fixture,
      snapshots.D[fixture].diagnostics.stageEvidence.loopSourceChanges,
    ])),
    loopTargetChanges: Object.fromEntries(PARITY_FIXTURES.map((fixture) => [
      fixture,
      snapshots.E[fixture].diagnostics.stageEvidence.loopTargetChanges,
    ])),
    finalLegalLoopTargetCount: finalLoopTargetCount,
  },
  acceptedFinalDefects: {
    "minimization:bounded_sub": ["i-24-jump × i-26 intrusion"],
    "characteristic:divides": ["i-55-jump × i-57-cont overlap", "i-38 deferred visual concern"],
    "characteristic:eq": ["i-46-yes × i-47-cont overlap"],
    "primrec:basic": [],
    predecessor: [],
  },
  commands: {
    generate: "node experiments/sketchv4/productionization-parity/scripts/generate_references.mjs",
    verifyOne: "node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --stage A --fixture characteristic:divides",
    verifyFinal: "node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --stage E --all",
    verifyEverything: "node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --all-stages --all",
    viewer: "cd urmwebpage/frontend && npx vite --config ../../experiments/sketchv4/productionization-parity/vite.config.mjs",
  },
  restoration: {
    checkpointInspection: "git worktree add --detach /absolute/path/to/sketchv4-loop-endpoints-checkpoint sketchv4-loop-endpoints-composed-checkpoint",
    intentionalReplacementPolicy: "Replace references only in a separate reviewed change that explains why the target checkpoint changed; use --reviewed-replace only as part of that change.",
  },
  broaderRegressionFixtureList: "experiments/sketchv4/productionization-parity/BROADER_REGRESSION_FIXTURES.md",
};

fs.writeFileSync(path.join(PACKAGE, "manifest.json"), stableStringify(manifest, 2));
console.log(JSON.stringify({
  generated: PARITY_STAGES.length * PARITY_FIXTURES.length,
  checkpoint: TARGET_CHECKPOINT,
  stageHashes,
}, null, 2));
