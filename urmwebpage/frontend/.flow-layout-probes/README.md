# Active SketchV4 harness

This directory contains only the current checkpoint reproduction and cheap viewer support.
The normal page constructs one selected fixture and one card. It does not import historical
experiments, recursive/exhaustive orientation machinery, or historical JSON reports.

- `ordinary_halt_experiment.html` — current viewer URL and shell.
- `current_viewer.mjs` — one-card viewer only.
- `current_harness.mjs` — minimal tree-shaken geometry builder for the promoted composed
  loop-endpoints checkpoint.
- `verify_current.mjs` — opt-in Node verification for all five hashes and orientation maps.
- `history.html` — static pointer to the archive; it imports no scripts.

Run the active verification from `urmwebpage/frontend`:

```sh
node .flow-layout-probes/verify_current.mjs
```

The complete history is at `experiments/sketchv4/archive-2026-09-05/`, outside the Vite root.
The narrow `bounded_sub` `i-22` comparison remains there as an explicit, non-promoted reference.
