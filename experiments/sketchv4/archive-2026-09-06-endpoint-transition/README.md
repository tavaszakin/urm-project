# SketchV4 endpoint-transition orientation research archive (2026-09-06)

This directory is the continuation of `../archive-2026-09-05/`. It preserves the
endpoint-transition intrusion-ownership research line developed on 2026-09-06, after the
workspace cleanup commit (`ba1260c`), as ignored working files in
`urmwebpage/frontend/.flow-layout-probes/`. Those files were moved here unchanged; nothing
here is imported by the active viewer or the production frontend entry.

## Research status: PARKED

- endpoint-transition ownership census: **completed** (items 14-17 in `INDEX.md`).
- endpoint-transition local scoring experiment: **completed experimentally** (item 18).
- Result (from the scoring probe's own passing assertions and report):
  - `minimization:bounded_sub` `i-22` -> **F** (owned intrusions default 1 / flipped 0);
    final diagnostics become 0/0/0/0 (the `i-24-jump x i-26` intrusion is removed).
  - `characteristic:divides` `i-25` -> **D** (raw intrusions default 4 / flipped 3 would
    have flipped it; owned intrusions 0/0 protect it).
  - `characteristic:divides` `i-48` and `i-53` remain **F**; no other fork changes on any
    of the five fixtures.
  - Untested transition directions remain: `NO -> YES` and arrival-phase `OUTSIDE -> NO`.
- Promoted: **no**. Checkpointed: **no**. Production layout behavior: **unchanged** —
  the checkpoint reproduction still selects `i-22` default and reproduces all five durable
  hashes (see `.flow-layout-probes/verify_current.mjs`).

## Contents

`flow-layout-probes/` holds five script/report pairs plus pure classifier modules and
isolated visual shells:

| # | Experiment | Script(s) | Report |
|---|---|---|---|
| 14 | Source-path ownership census | `local_intrusion_ownership{,_probe}.mjs` | `local_intrusion_ownership_probe.json` |
| 15 | Departure-augmented census | `departure_augmented_intrusion_ownership_probe.mjs` | `..._probe.json` |
| 16 | Segment-phase census | `segment_phase_intrusion_ownership{,_probe}.mjs`, `segment_phase_intrusion_experiment.html`, `segment_phase_visual_viewer.mjs` | `segment_phase_intrusion_ownership_probe.json` |
| 17 | Endpoint-transition census | `endpoint_transition_intrusion_ownership{,_probe}.mjs`, `endpoint_transition_intrusion_experiment.html`, `endpoint_transition_visual_viewer.mjs` | `endpoint_transition_intrusion_ownership_probe.json` |
| 18 | Endpoint-transition local scoring | `endpoint_transition_intrusion_scoring{,_probe}.mjs`, `endpoint_transition_intrusion_scoring_experiment.html`, `endpoint_transition_intrusion_scoring_visual_viewer.mjs` | `endpoint_transition_intrusion_scoring_probe.json` |

The `.json` reports were captured on 2026-09-06 by running each probe once from
`urmwebpage/frontend` against the active `current_harness.mjs` and the fixture snapshot
`.sketchv3-harness/programs.json` (byte-identical to `../archive-2026-09-05/programs.json`,
SHA-256 `e77a35d377920b7546b406eaa9d7f6e788a7208d8433ea2e798f6d740d7120f5`). Every probe
exited 0, i.e. all built-in assertions passed. Reports are deterministic except the
runtime/benchmark samples.

## Safe execution recovery

The archived modules preserve their original relative imports, so they are evidence
snapshots, not live modules in their archive location. To re-run one:

```sh
cp experiments/sketchv4/archive-2026-09-06-endpoint-transition/flow-layout-probes/*.mjs \
   experiments/sketchv4/archive-2026-09-06-endpoint-transition/flow-layout-probes/*.html \
   urmwebpage/frontend/.flow-layout-probes/
cp experiments/sketchv4/archive-2026-09-05/programs.json \
   urmwebpage/frontend/.sketchv3-harness/programs.json   # if not already present
cd urmwebpage/frontend && node .flow-layout-probes/<probe>.mjs
```

The probes require the `current_harness.mjs` that exports
`buildComposedLoopEndpointRealizer`, `buildRawRoleOrdinaryTerminalBase`, and
`unrelatedNodeEdgeIntersections` (the version committed together with this archive).
Copied-back files are gitignored and can be deleted afterwards; do not add them to the
normal Vite module graph.

## Integrity check

```sh
find flow-layout-probes -type f -exec shasum -a 256 {} \; \
  | sed 's#  flow-layout-probes/#  #' \
  | sort \
  | shasum -a 256
```

Expected result: `f381c34becfd389b2485e00542fe3be63f41b404d2be2adccb41c56358c9d2ef`
(20 files, 4,210,743 bytes).
