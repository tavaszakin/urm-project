# SketchV4 composed loop-endpoints checkpoint

This local checkpoint preserves the harness-only current baseline named:

`Ordinary HALT — composed generalized loop endpoints`

It is an experimental record, not production behavior.

## Git provenance

- Promotion parent/candidate: `4eec3807303d763b8095172eadfe114b84134976`
- Continuation branch at capture: `continuation/sketchv4-ordinary-halt-main-view`
- Checkpoint branch: `checkpoint/sketchv4-loop-endpoints-composed`
- Annotated tag: `sketchv4-loop-endpoints-composed-checkpoint`
- Checkpoint commit: the commit containing this manifest, referenced by both checkpoint refs above.
- Resolve its exact SHA with:

  ```sh
  git rev-parse checkpoint/sketchv4-loop-endpoints-composed
  git rev-parse 'sketchv4-loop-endpoints-composed-checkpoint^{}'
  ```

The literal containing-commit SHA cannot be embedded in a file inside that same commit because
changing the file changes the commit hash. The annotated tag object records the exact target,
and the resolved SHA is reported when the checkpoint is created.

This checkpoint descends from, but does not move or replace, either earlier durable checkpoint:

- Adaptive/reentry checkpoint
  - commit: `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`
  - branch: `checkpoint/sketchv4-ordinary-halt-adaptive-reentry`
  - annotated tag: `sketchv4-ordinary-halt-adaptive-reentry-checkpoint`
- Composed loop-source checkpoint
  - commit: `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`
  - branch: `checkpoint/sketchv4-loop-source-composed`
  - annotated tag: `sketchv4-loop-source-composed-checkpoint`

Lineage after the composed loop-source checkpoint:

```text
probe i-52 upper-left target attachment
→ refine it to a direct approach-line/incident-ray intersection
→ generalize illegal backward-loop target attachment across all fixtures
→ compose source and target endpoint rules into normal orientation selection
→ promote the composed endpoint result to current baseline
```

## Preserved composition

Every orientation candidate is realized with this complete harness-only stack before normal,
unpinned orientation scoring:

1. synthetic ordinary HALT;
2. raw transformed roles;
3. branch-preserving conditional merge sources;
4. adaptive branch-ray lengths and V/H merge bodies;
5. divides-only `i-57-cont` right-to-right H/V/H reentry, where applicable;
6. generalized backward-loop source attachment;
7. generalized backward-loop target attachment.

No post-selection repair is applied.

### Generalized loop-source rule

```text
vertical-first backward-loop body
→ bottom-center source port
→ vertical descent to the existing bend row

lateral-first backward-loop body
→ retain the existing side-center source attachment
```

Backward-loop status continues to determine the existing loop side, rail, bend row, target
attachment, and route suffix. It does not force the source port.

### Generalized loop-target rule

```text
existing target attachment is legal
→ preserve the complete route byte-identically

existing target attachment is illegal
→ inspect existing named target ports and legal incident rays
→ require exactly one structurally compatible ray that intersects the existing final approach line
→ replace only the final suffix with approach-line intersection → target port
```

The target rule uses no fixed-length stub, crossing score, clearance score, obstacle search, or
defect-based port choice. If zero or multiple compatible named ports qualify, the route remains
unchanged and the ambiguity is reported.

## Exact geometry digests and diagnostics

The canonical payload is compact `JSON.stringify` of an object whose keys, in order, are
`nodeBoxes`, `routes`, and `orientation`; entries are sorted by node, edge, or fork ID, and the
values are:

```text
nodeBoxes:  [id,left,right,top,bottom,cx,cy,w,h]
routes:     [edgeId,source,target,sourcePort,targetPort,points]
orientation:[forkId,noSide,yesSide]
```

Numbers use exact JavaScript serialization precision; no rounding is applied.

| Fixture | Canonical bytes | SHA-256 | Crossings | Edge overlaps | Node overlaps | Unrelated node-edge intrusions |
|---|---:|---|---:|---:|---:|---:|
| `minimization:bounded_sub` | 6,052 | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | 0 | 0 | 0 | 1 |
| `characteristic:divides` | 19,215 | `72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd` | 0 | 1 | 0 | 0 |
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
endpoint-composition probe. In `characteristic:divides`, `i-25` remains default on a `3 / 3`
tie, and only `i-48` and `i-53` are flipped.

## Backward-loop endpoint census

The generalized source rule changes exactly three vertical-first loop sources relative to the
pre-source-rule geometry:

- `characteristic:divides` `i-27-jump`
- `characteristic:divides` `i-52-jump`
- `primrec:basic` `i-19-jump`

The other thirteen backward-loop source routes remain unchanged.

The generalized target rule changes exactly one route:

- `characteristic:divides` `i-52-jump -> i-4`

Its exact direct incident-ray suffix is:

```text
[-922, 361.1467672771852]
→ [-317.2869565217391, 361.1467672771852]
→ [-223.7, 413.6467672771852]
```

All other already-legal loop targets remain byte-identical. No ambiguity is present in the five
recorded fixtures. All sixteen backward loops have legal source and target attachments:

- `minimization:bounded_sub`: `i-17-jump`, `i-20-jump`, `i-24-jump`
- `characteristic:divides`: `i-20-jump`, `i-23-jump`, `i-27-jump`, `i-43-jump`, `i-46-jump`, `i-52-jump`
- `characteristic:eq`: `i-16-jump`, `i-19-jump`, `i-36-jump`, `i-39-jump`
- `primrec:basic`: `i-16-jump`, `i-19-jump`
- `predecessor`: `i-5-jump`

No non-loop route or node geometry changes relative to the composed source checkpoint.

## Known unresolved issues

- `characteristic:divides`: `i-55-jump x i-57-cont` retains its shared final approach overlap.
- `minimization:bounded_sub`: `i-24-jump` retains its unrelated-node intrusion through `i-26`.
- `characteristic:eq`: `i-46-yes x i-47-cont` retains its edge overlap.
- `characteristic:divides`: the remaining visual concern around `i-38` is unchanged.

These are preserved evidence and were not repaired while creating this checkpoint.

## Safe inspection and restoration

Inspect the exact checkpoint without touching an existing working tree:

```sh
git worktree add --detach /absolute/path/to/sketchv4-loop-endpoints-checkpoint \
  sketchv4-loop-endpoints-composed-checkpoint
```

Verify both new checkpoint refs resolve to the same commit:

```sh
git rev-parse checkpoint/sketchv4-loop-endpoints-composed
git rev-parse 'sketchv4-loop-endpoints-composed-checkpoint^{}'
```

Restore only the recorded harness/viewer files into another safe working tree:

```sh
git restore --source=sketchv4-loop-endpoints-composed-checkpoint --worktree -- \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.mjs \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_experiment.html \
  urmwebpage/frontend/.flow-layout-probes/ordinary_halt_loop_endpoints_composed_CHECKPOINT.md
```

Do not move, amend, delete, or retag this checkpoint or either earlier SketchV4 recovery point.
