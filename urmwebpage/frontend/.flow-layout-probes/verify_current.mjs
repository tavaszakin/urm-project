import crypto from "node:crypto";
import fs from "node:fs";

import {
  buildCurrentCheckpointView,
  canonicalGeometry,
  namedOrientationMap,
} from "./current_harness.mjs";

const CHECKPOINT = "9f166f24721e7125ec9c0105e8960c6273d8d932";
const EXPECTED = {
  "minimization:bounded_sub": {
    bytes: 6052,
    sha256: "3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65",
    orientation: { "i-10": "default", "i-12": "default", "i-15": "default", "i-22": "default" },
  },
  "characteristic:divides": {
    bytes: 19215,
    sha256: "72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd",
    orientation: {
      "i-13": "default", "i-15": "default", "i-18": "default", "i-25": "default",
      "i-3": "default", "i-36": "default", "i-38": "default", "i-4": "default",
      "i-41": "default", "i-48": "flipped", "i-53": "flipped",
    },
  },
  "characteristic:eq": {
    bytes: 13261,
    sha256: "0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990",
    orientation: {
      "i-11": "default", "i-14": "default", "i-29": "default", "i-31": "default",
      "i-34": "default", "i-43": "default", "i-46": "default", "i-9": "default",
    },
  },
  "primrec:basic": {
    bytes: 4938,
    sha256: "e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f",
    orientation: { "i-13": "default", "i-5": "default" },
  },
  predecessor: {
    bytes: 2324,
    sha256: "167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926",
    orientation: { "i-0": "default", "i-2": "default" },
  },
};

const programs = JSON.parse(fs.readFileSync(new URL("../.sketchv3-harness/programs.json", import.meta.url), "utf8"));
const results = [];
for (const [fixture, expected] of Object.entries(EXPECTED)) {
  const started = performance.now();
  const view = buildCurrentCheckpointView(programs[fixture], fixture);
  const canonical = canonicalGeometry(view);
  const actual = {
    bytes: canonical.length,
    sha256: crypto.createHash("sha256").update(canonical).digest("hex"),
    orientation: namedOrientationMap(view),
  };
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256
    || JSON.stringify(actual.orientation) !== JSON.stringify(expected.orientation)) {
    throw new Error(`${fixture}: checkpoint reproduction mismatch\nexpected ${JSON.stringify(expected)}\nactual ${JSON.stringify(actual)}`);
  }
  results.push({ fixture, ...actual, elapsedMs: Math.round((performance.now() - started) * 10) / 10 });
}

console.log(JSON.stringify({ checkpoint: CHECKPOINT, results }, null, 2));
