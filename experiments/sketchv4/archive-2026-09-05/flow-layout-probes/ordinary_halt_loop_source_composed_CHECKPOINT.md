# SketchV4 composed loop-source checkpoint

This local checkpoint preserves the harness-only current baseline named:

`Ordinary HALT — composed adaptive merges + generalized loop sources`

It is an experimental record, not production behavior.

## Git provenance

- Promotion parent: `d5eafae37704049164f39532fc1fcb7c94a2d3d9`
- Continuation branch at capture: `continuation/sketchv4-ordinary-halt-main-view`
- Checkpoint branch: `checkpoint/sketchv4-loop-source-composed`
- Annotated tag: `sketchv4-loop-source-composed-checkpoint`
- Checkpoint commit: the commit containing this manifest, referenced by both checkpoint refs above.
- Resolve its exact SHA with:

  ```sh
  git rev-parse checkpoint/sketchv4-loop-source-composed
  git rev-parse 'sketchv4-loop-source-composed-checkpoint^{}'
  ```

The literal containing-commit SHA cannot be embedded in a file inside that same commit because
changing the file changes the commit hash. The annotated tag object records the exact target,
and the resolved SHA is reported when the checkpoint is created.

This checkpoint descends from, but does not move or replace, the earlier durable checkpoint:

- Earlier checkpoint commit: `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`
- Earlier checkpoint branch: `checkpoint/sketchv4-ordinary-halt-adaptive-reentry`
- Earlier annotated tag: `sketchv4-ordinary-halt-adaptive-reentry-checkpoint`
- Original production parent: `93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1`

Lineage after the earlier checkpoint:

```text
promote combined adaptive/reentry viewer
→ expose adaptive current baselines for all fixtures
→ probe outward loop source stubs
→ compare side versus bottom source attachment
→ generalize the loop-source rule across all fixtures
→ compose that rule into normal orientation selection
→ promote the composed result to current baseline
```

## Preserved composition

Every orientation candidate is realized with this complete harness-only stack before normal,
unpinned orientation scoring:

1. synthetic ordinary HALT;
2. raw transformed roles;
3. branch-preserving conditional merge sources;
4. adaptive branch-ray lengths and V/H merge bodies;
5. divides-only `i-57-cont` right-to-right H/V/H reentry, where applicable;
6. generalized backward-loop source attachment.

No post-selection repair is applied.

The generalized loop-source rule is:

```text
vertical-first backward loop
→ bottom-center source port
→ vertical descent to the existing bend row

lateral-first backward loop
→ retain the existing side-center source attachment
```

Backward-loop status continues to determine the existing loop side, rail, bend row, target
attachment, and route suffix. It does not force the source port.

## Exact geometry digests and diagnostics

Canonical payload definition is unchanged from the earlier checkpoint: compact `JSON.stringify`
of sorted `nodeBoxes`, `routes`, and `orientation`, using exact JavaScript number serialization.

| Fixture | Canonical bytes | SHA-256 | Crossings | Edge overlaps | Node overlaps | Unrelated node-edge intrusions |
|---|---:|---|---:|---:|---:|---:|
| `minimization:bounded_sub` | 6,052 | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | 0 | 0 | 0 | 1 |
| `characteristic:divides` | 19,203 | `2a9354a026f3191452d8c16e05f7c648652c0f2f1299bd85b5850641da454341` | 0 | 1 | 0 | 0 |
| `characteristic:eq` | 13,261 | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` | 0 | 1 | 0 | 0 |
| `primrec:basic` | 4,938 | `e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f` | 0 | 0 | 0 | 0 |
| `predecessor` | 2,324 | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` | 0 | 0 | 0 | 0 |

## Orientation maps

`default` means `NO -> left, YES -> right`; `flipped` means the reverse.

- `minimization:bounded_sub`
  - default: `i-10`, `i-12`, `i-15`, `i-22`
  - flipped: none
- `characteristic:divides`
  - default: `i-3`, `i-4`, `i-13`, `i-15`, `i-18`, `i-25`, `i-36`, `i-38`, `i-41`
  - flipped: `i-48`, `i-53`
- `characteristic:eq`
  - default: `i-9`, `i-11`, `i-14`, `i-29`, `i-31`, `i-34`, `i-43`, `i-46`
  - flipped: none
- `primrec:basic`
  - default: `i-5`, `i-13`
  - flipped: none
- `predecessor`
  - default: `i-0`, `i-2`
  - flipped: none

The composed orientation pass uses an empty pin map. Its final maps match the successful
composition probe. In `characteristic:divides`, `i-25` remains default on a `3 / 3` tie.

## Backward-loop census

The generalized rule changes exactly three vertical-first loop sources:

- `characteristic:divides` `i-27-jump`
  - source: `[-385.7519704,1545.6799996697519]` -> `[-341.7519704,1560.6799996697519]`
  - rail: `-878`; bend row: `1934.1326071255528`
  - source/target/overall attachment: `false/true/false` -> `true/true/true`
- `characteristic:divides` `i-52-jump`
  - source: `[-171.35066960000003,2440.5852145813533]` -> `[-127.35066960000003,2455.5852145813533]`
  - rail: `-922`; bend row: `2829.037822037154`
  - source/target/overall attachment: `false/false/false` -> `true/false/false`
- `primrec:basic` `i-19-jump`
  - source: `[-84.19399999999999,1382.1912457533895]` -> `[-40.19399999999999,1397.1912457533895]`
  - rail: `-494`; bend row: `1446.1912457533895`
  - source/target/overall attachment: `false/true/false` -> `true/true/true`

The other thirteen backward loops retain their complete route geometry:

- `minimization:bounded_sub`: `i-17-jump`, `i-20-jump`, `i-24-jump`
- `characteristic:divides`: `i-20-jump`, `i-23-jump`, `i-43-jump`, `i-46-jump`
- `characteristic:eq`: `i-16-jump`, `i-19-jump`, `i-36-jump`, `i-39-jump`
- `primrec:basic`: `i-16-jump`
- `predecessor`: `i-5-jump`

All sixteen loop source attachments are legal. Fifteen target attachments are legal; the
unchanged `i-52-jump -> i-4` target attachment remains deliberately illegal.

## Known unresolved issues

- `characteristic:divides`: `i-52-jump -> i-4` target attachment remains illegal.
- `characteristic:divides`: `i-55-jump x i-57-cont` retains its shared final approach overlap.
- `minimization:bounded_sub`: `i-24-jump` retains its unrelated-node intrusion through `i-26`.
- `characteristic:eq`: `i-46-yes x i-47-cont` retains its edge overlap.
- `characteristic:divides`: the remaining visual concern around `i-38` is unchanged.

These are preserved evidence and were not repaired while creating this checkpoint.

## Safe inspection and restoration

Inspect the exact checkpoint without touching an existing working tree:

```sh
git worktree add --detach /absolute/path/to/sketchv4-loop-source-checkpoint \
  sketchv4-loop-source-composed-checkpoint
```

Verify both checkpoint refs resolve to the same commit:

```sh
git rev-parse checkpoint/sketchv4-loop-source-composed
git rev-parse 'sketchv4-loop-source-composed-checkpoint^{}'
```

Restore only the recorded harness/viewer files into another safe working tree:

```sh
git restore --source=sketchv4-loop-source-composed-checkpoint --worktree -- \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.mjs \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.html \
  urmwebpage/frontend/.sketchv3-harness/programs.json \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_loop_source_composed_CHECKPOINT.md
```

Do not move, amend, delete, or retag either this checkpoint or the earlier
`sketchv4-ordinary-halt-adaptive-reentry-checkpoint` recovery point.
