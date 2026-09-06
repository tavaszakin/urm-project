# SketchV4 ordinary-HALT adaptive-reentry checkpoint

This local checkpoint preserves the harness-only view named:

`Ordinary HALT — adaptive merges + right-side reentry`

It is an experimental record, not production behavior or a proposed production rule.

## Git provenance

- Captured from branch: `recovery/beta-flow-working-baseline`
- Parent production HEAD: `93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1`
- Checkpoint branch: `checkpoint/sketchv4-ordinary-halt-adaptive-reentry`
- Annotated tag: `sketchv4-ordinary-halt-adaptive-reentry-checkpoint`

Original working-tree status at capture (none of these pre-existing changes are included in this checkpoint):

```text
 M .gitignore
 M urmwebpage/compiler.py
 M urmwebpage/frontend/src/components/ByHandEvaluationCard.jsx
 M urmwebpage/frontend/src/components/FunctionDefinitionPreview.jsx
 M urmwebpage/frontend/src/components/FunctionExpressionView.jsx
 M urmwebpage/frontend/src/components/FunctionRunner.jsx
 M urmwebpage/frontend/src/components/FunctionSpecBuilder.jsx
 M urmwebpage/frontend/src/components/SketchV3FlowDiagram.jsx
 M urmwebpage/frontend/src/functionMetadata.js
 M urmwebpage/main.py
 M urmwebpage/test_primitive_recursion_flat.py
?? urmwebpage/.claude/skills/flow-layout-probe/
?? urmwebpage/fixture_kinds.py
?? urmwebpage/fixture_metrics.py
?? urmwebpage/scripts/
?? urmwebpage/test_fixture_metrics.py
?? urmwebpage/test_function_kind_smoke.py
?? urmwebpage/test_substitution.py
```

## Captured files and SHA-256

```text
912f9848ee59e67e1ccabd459ea6828078cdff2cc16cef866457d32280d7be62  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.mjs
b7806186ae09848ed3dcff25beae575e872fcc7d0fd1cc27ceaa46523db58df8  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.html
e77a35d377920b7546b406eaa9d7f6e788a7208d8433ea2e798f6d740d7120f5  urmwebpage/frontend/.sketchv3-harness/programs.json
```

The harness module contains the complete pipeline experiment and viewer integration. The HTML file is its local viewer shell. `programs.json` is the ignored fixture source loaded by the viewer, including `characteristic:divides`. Production modules are deliberately not duplicated: they are supplied by the recorded parent production HEAD.

## Combined-view geometry digest

For `characteristic:divides`, the combined view's canonical exact-geometry SHA-256 is:

```text
0122c288cfb31b2c76206e6cb27c57a6c892e5c654dd56bad18d190e20d3bb92
```

Canonical payload definition: compact `JSON.stringify` of an object whose keys, in order, are `nodeBoxes`, `routes`, and `orientation`; node and orientation entries are sorted by node ID, route entries are sorted by edge ID, and the values are:

```text
nodeBoxes:  [id,left,right,top,bottom,cx,cy,w,h]
routes:     [edgeId,source,target,sourcePort,targetPort,points]
orientation:[forkId,noSide,yesSide]
```

The canonical JSON is 19,203 bytes in this checkpoint. Numbers are hashed at their exact JavaScript serialization precision; no rounding is applied.

## Preserved experiment

The combined view includes, in this order:

1. synthetic ordinary terminal `i-(N+1)` instead of special HALT placement/routing;
2. raw role classification of the transformed CFG;
3. semantic YES/NO source ports and fixed branch angles for eligible conditional merge-connectors;
4. adaptive branch-ray selection with a full sibling ray in open space and midpoint shortening where nearby committed node geometry crowds it;
5. V-then-H merge bodies;
6. `i-57-cont -> i-58` right-center to right-center H/V/H reentry;
7. normal orientation selection using the combined geometry.

Adaptive decisions for `characteristic:divides`:

- `i-15-yes`: adaptively shortened; full sibling length `103.37867300196234`.
- `i-38-yes`: adaptively shortened; full sibling length `95.38906342687574`.
- `i-53-yes`: full ray retained; length `169.91892340887955`.

`i-25` candidate costs are default `3` and flipped `3`; normal tie-breaking retains the default mapping (`NO -> left`, `YES -> right`).

Final independent diagnostics:

```text
proper crossings:                 0
edge overlaps:                    1
node-node overlaps:               0
unrelated node-edge intrusions:   0
```

The remaining edge overlap is `i-55-jump x i-57-cont`, over:

```text
[[117.64933039999997,2522.5852145813533],
 [133.64933039999997,2522.5852145813533]]
```

The `i-57-cont -> i-58` rule is:

```text
source = i-57 right-center
target = i-58 right-center
corridorX = max(source.right, target.right) + 16
route = source -> [corridorX, source.y] -> [corridorX, target.y] -> target
```

Exact preserved route:

```text
[[3.8060000000000116,626.1912457533896],
 [133.64933039999997,626.1912457533896],
 [133.64933039999997,2522.5852145813533],
 [117.64933039999997,2522.5852145813533]]
```

## Safe inspection and restoration

Open the checkpoint without touching an existing working tree:

```sh
git worktree add --detach /absolute/path/to/sketchv4-checkpoint-view sketchv4-ordinary-halt-adaptive-reentry-checkpoint
```

Restore only the harness/viewer files and their ignored fixture dependency into a future working tree (this does not update its index unless separately requested):

```sh
git restore --source=sketchv4-ordinary-halt-adaptive-reentry-checkpoint --worktree -- \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.mjs \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.html \
  urmwebpage/frontend/.sketchv3-harness/programs.json
```

Reconstruct the complete checkpoint safely as production at the recorded parent HEAD plus these ignored harness files:

```sh
git worktree add --detach /absolute/path/to/sketchv4-exact-state 93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1
git -C /absolute/path/to/sketchv4-exact-state restore \
  --source=sketchv4-ordinary-halt-adaptive-reentry-checkpoint --worktree -- \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.mjs \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.html \
  urmwebpage/frontend/.sketchv3-harness/programs.json
```

This checkpoint intentionally excludes the unrelated dirty production files listed above. If changing an existing production working tree rather than creating the safe separate worktree, first make it clean, then switch or detach it at the recorded parent HEAD; do not reset a dirty tree merely to inspect this checkpoint.
