# Active SketchV4 harness

This directory contains only the current checkpoint reproduction and cheap viewer support.
The normal page constructs one selected fixture and one card. It does not import historical
experiments, recursive/exhaustive orientation machinery, or historical JSON reports.

- `ordinary_halt_experiment.html` — current viewer URL and shell.
- `current_viewer.mjs` — one-card viewer only.
- `current_harness.mjs` — minimal tree-shaken geometry builder for the promoted composed
  loop-endpoints checkpoint. It also exports `buildComposedLoopEndpointRealizer`,
  `buildRawRoleOrdinaryTerminalBase`, and `unrelatedNodeEdgeIntersections`, which the
  archived endpoint-transition probes import when restored; the exports do not change
  checkpoint geometry.
- `verify_current.mjs` — opt-in Node verification for all five hashes and orientation maps.
- `history.html` — static pointer to the archives; it imports no scripts.

Run the active verification from `urmwebpage/frontend`:

```sh
node .flow-layout-probes/verify_current.mjs
```

## Parked research: endpoint-transition orientation scoring (2026-09-06)

Truthful stopping point for the local-orientation research line:

- endpoint-transition ownership census: **completed** (source-path, departure-augmented,
  segment-phase, and endpoint-transition censuses; clean on the five fixtures).
- endpoint-transition local scoring experiment: **completed experimentally** —
  cost = node overlaps + proper crossings + focus-fork-owned intrusions; local
  two-candidate selector, strict improvement, tie -> default; no completion, lookahead,
  recursion, or repair.
- Result: only `minimization:bounded_sub` `i-22` changes (-> **F**, owned intrusions 1/0,
  removing the `i-24-jump x i-26` intrusion; final diagnostics 0/0/0/0).
  `characteristic:divides` `i-25` stays **D** (raw intrusions 4/3, owned 0/0);
  `i-48`/`i-53` remain **F**. Untested directions: `NO -> YES`, arrival `OUTSIDE -> NO`.
- Promoted: **no**. Checkpointed: **no**. Production behavior: **unchanged** —
  `verify_current.mjs` still reproduces all five durable hashes with `i-22` default.
- Research status: **PARKED**.

Scripts, visual shells, and captured reports live at
`experiments/sketchv4/archive-2026-09-06-endpoint-transition/` (items 14-18, own README,
index, and integrity digest). The earlier complete history is at
`experiments/sketchv4/archive-2026-09-05/`, outside the Vite root. The narrow
`bounded_sub` `i-22` comparison remains there as an explicit, non-promoted reference.
