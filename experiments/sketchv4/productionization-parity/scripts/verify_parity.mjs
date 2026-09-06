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
