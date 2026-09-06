# SketchV4 experiment archive recovery

This directory is a byte-preserved snapshot of the completed `.flow-layout-probes`
workspace removed from the Vite-watched frontend tree on 2026-09-05. It contains successful,
failed, provisional, and diagnostic-only experiments. Nothing here is imported by the active
viewer or the production frontend entry.

The 35 original files total 2,059,991 bytes. Their normalized content-set SHA-256 is
`2c5a07b33abc61a758ec7017c825389d065c0e73902a2a92a67cb74ce115a833`.
Three committed checkpoint manifests and a fixture snapshot were added to make the archive
self-describing and recoverable.

## What is directly inspectable

- `INDEX.md` is the cheap-to-load experiment catalog.
- `flow-layout-probes/*.json` are completed reports and can be read without running code.
- `flow-layout-probes/overlays/index.html` and its SVGs are static historical evidence.
- `flow-layout-probes/ordinary_halt_experiment.{html,mjs}` are the final pre-cleanup historical
  viewer and monolithic experiment implementation.
- `flow-layout-probes/*CHECKPOINT.md` record the three durable harness checkpoints.
- `programs.json` is the exact fixture input snapshot used by the archived probes.

## Safe execution recovery

The archived modules preserve their original relative imports, so they are evidence snapshots,
not live modules in their archive location. Run one only after restoring it into an isolated Git
worktree at its recorded checkpoint or baseline. Do not overwrite the active harness and do not
move any checkpoint ref.

For the final checkpoint, create a detached worktree and then copy the snapshot into its original
locations:

```sh
git worktree add --detach /absolute/path/to/sketchv4-history \
  sketchv4-loop-endpoints-composed-checkpoint
cp -R experiments/sketchv4/archive-2026-09-05/flow-layout-probes/. \
  /absolute/path/to/sketchv4-history/urmwebpage/frontend/.flow-layout-probes/
cp experiments/sketchv4/archive-2026-09-05/programs.json \
  /absolute/path/to/sketchv4-history/urmwebpage/frontend/.sketchv3-harness/programs.json
```

The earlier committed stages are also directly recoverable from their durable refs:

- `sketchv4-ordinary-halt-adaptive-reentry-checkpoint`
- `sketchv4-loop-source-composed-checkpoint`
- `sketchv4-loop-endpoints-composed-checkpoint`

Probe reports created after the final checkpoint were intentionally never promoted. Their scripts
and outputs are preserved together here; restore the matching pairs when reproducing them.

## Integrity check

From this directory, the original content-set digest can be recomputed without executing any
probe:

```sh
find flow-layout-probes -type f ! -name '*CHECKPOINT.md' -exec shasum -a 256 {} \; \
  | sed 's#  flow-layout-probes/#  #' \
  | sort \
  | shasum -a 256
```

Expected result: `2c5a07b33abc61a758ec7017c825389d065c0e73902a2a92a67cb74ce115a833`.
