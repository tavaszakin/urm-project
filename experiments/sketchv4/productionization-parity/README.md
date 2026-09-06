# SketchV4 productionization parity evidence

This directory freezes the characterization contract for moving the mature SketchV4
checkpoint into production. It is deliberately outside `src/` and is not imported by the
normal frontend. The target is exactly checkpoint
`9f166f24721e7125ec9c0105e8960c6273d8d932`; later endpoint-transition research is excluded.

> These reference files are characterization evidence. Do not regenerate them to make a later production implementation pass.

Any intentional replacement requires a separate reviewed change that explains why the
target changed. The generator refuses to overwrite an existing manifest unless its explicit
reviewed-replacement flag is supplied.

## Contents and provenance

- `manifest.json` is the machine-readable authority: provenance, file checksums, stage
  stacks, all hashes and orientation maps, normal- and fixed-orientation deltas, exact endpoint
  evidence, accepted defects, and commands.
- `references/{base,a,b,c,d,e}/` contains 30 stable JSON snapshots. Each records the fixture
  and stage identities, exact node boxes, exact route point arrays, source/target ports,
  terminal, orientation map, geometry hash, and relevant harness diagnostics.
- `scripts/generate_references.mjs` calls the existing tested harness transformations. It does
  not reimplement layout rules.
- `scripts/verify_parity.mjs` checks all reference-file SHA-256 values and stored transition
  deltas before comparing the selected live candidates structurally.
- `viewer.html` and `viewer.mjs` are the isolated, lazy parity viewer.
- `BROADER_REGRESSION_FIXTURES.md` records non-canonical regression inputs without freezing
  their geometry.

Generation was gated on:

```text
source harness commit: 990d9f7c21f35ff16239eeea027c767ec683f922
checkpoint commit/ref:  9f166f24721e7125ec9c0105e8960c6273d8d932
archive content digest: 2c5a07b33abc61a758ec7017c825389d065c0e73902a2a92a67cb74ce115a833
fixture snapshot digest:e77a35d377920b7546b406eaa9d7f6e788a7208d8433ea2e798f6d740d7120f5
generation date:        2026-09-06
```

The local checkpoint branch, annotated tag dereference, and remote-tracking checkpoint branch
were all required to resolve to the checkpoint commit before generation.

## Stage ladder and hashes

| Stage | `minimization:bounded_sub` | `characteristic:divides` | `characteristic:eq` | `primrec:basic` | `predecessor` |
| --- | --- | --- | --- | --- | --- |
| BASE | `09979c3772117058460fbbc8c7af00e778f9b8666975388a263dd34a3d846ec3` | `8a7511f00ddf6e24e5713b5a0e54e895821817c3936a0d8a0029f63cb2d1800b` | `fc65f1267c4dd46587df5befd03f304824b9e0d8cd1b02b21167c4d3ade5123f` | `475edf94da4d479ab532f3a29008603ff803cc4b440ddd94118f16153648a1ce` | `b81fb7d2f71c3c6c8d6956f44d75f45cccc982687cb236790779c3209c1308b4` |
| A | `94718bf10822533e711d62fa9b4eaaacba28ce0a775701738a89a5a8904f6cf9` | `fe21090d207cb59ae6de696dec41edef7db8feb2accecfe4e8446e10c3a36973` | `13d46e825aece6233ffc1b5e806ad85367ad193104c4cfa9c0e4593e3f788011` | `be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f` | `09be6cd8dadc7978e345333cab7009ae22161fda0249c41073594c5ae92ff6fc` |
| B | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | `c8eb0fc0f5529b32bddbd4f81a59bb52ca0abd8c64eabd4333ab1e08ee0a9fbe` | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` | `be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f` | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` |
| C | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | `0122c288cfb31b2c76206e6cb27c57a6c892e5c654dd56bad18d190e20d3bb92` | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` | `be2c021566d0774fe63eb885ca90a7a4f00a9f596b2adddc9c6d5a019ea2e32f` | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` |
| D | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | `2a9354a026f3191452d8c16e05f7c648652c0f2f1299bd85b5850641da454341` | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` | `e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f` | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` |
| E | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` | `72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd` | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` | `e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f` | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` |

The execution order is native production V4 (BASE), ordinary synthetic terminal (A), adaptive
conditional merge doorways/rays (B), the explicit `characteristic:divides` `i-57` right/right
H/V/H compatibility route (C), generalized backward-loop source attachment (D), then generalized
backward-loop target attachment (E).

The only orientation-map changes across the ladder are:

- BASE has `divides` `i-48` and `i-53` flipped; A/B additionally flip `i-25`.
- C restores `i-25` to default on a frozen 3/3 tie; D/E retain that map.
- A introduces the synthetic-terminal-derived real-fork entries `eq i-46` and `predecessor i-0`,
  both default. All other recorded bits are unchanged.
- `bounded_sub i-22` is default at every stage. No later `i-22` result is represented.

## Expected-delta contract

`manifest.json.expectedDeltas` is the exact authority, including added, removed, and changed IDs
for every fixture at every adjacent normal-orientation stage. It additionally freezes the
fixed-orientation isolation checks below.

- BASE → A replaces `halt` with an ordinary instruction terminal (`i-26`, `i-58`, `i-48`,
  `i-21`, or `i-7` by fixture). The manifest records every consequent terminal, node, route,
  port, and orientation difference; these are intentionally not narrowed to a local-route
  allowlist because the CFG/role change can move downstream geometry.
- A → B may change route and port records only for: bounded `i-12-yes`; divides `i-15-yes`,
  `i-38-yes`, `i-53-yes`; eq `i-11-yes`, `i-31-yes`, `i-46-yes`; predecessor `i-0-yes`;
  primrec none. Only divides `i-15-yes` and `i-38-yes` actually shorten their full rays.
- B → C, under C's fixed orientation, may change only divides `i-57-cont` route and port.
  Its exact right/right H/V/H points are
  `[[3.8060000000000116,626.1912457533896],[133.64933039999997,626.1912457533896],[133.64933039999997,2522.5852145813533],[117.64933039999997,2522.5852145813533]]`;
  the first and last points are the exact right-side source and target ports. Normal orientation
  then restores divides `i-25` to default on the 3/3 tie.
- C → D, at fixed orientation, may change only divides `i-27-jump`, divides `i-52-jump`, and
  primrec `i-19-jump` route/port records. Their evidence records old/new source ports and proves
  unchanged rail, bend row, and target attachment.
- D → E, at fixed orientation, may change only divides `i-52-jump` route/port records. Its final
  suffix is exactly
  `[[-922,361.1467672771852],[-317.2869565217391,361.1467672771852],[-223.7,413.6467672771852]]`.
  All 16 loop targets across the canonical fixtures are legal at E.

Accepted E annotations are frozen but are not blockers: bounded `i-24-jump × i-26` intrusion;
divides `i-55-jump × i-57-cont` overlap and deferred `i-38` concern; eq
`i-46-yes × i-47-cont` overlap.

## Verify

Compare one live harness realization:

```sh
node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --stage A --fixture characteristic:divides
```

Compare final E for all five fixtures, or the full 30-case ladder:

```sh
node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --stage E --all
node experiments/sketchv4/productionization-parity/scripts/verify_parity.mjs --all-stages --all
```

Every invocation first verifies all 30 static file checksums and the five frozen normal-stage
transition maps. Failures distinguish hash, orientation, node-box, route, port, terminal, and
unexpected-object changes and print the first structural value difference. A future production
adapter can be selected with `--candidate-module PATH`; it must export `buildParityCandidate`
or `buildCheckpointStageView` with the documented `(program, fixture, stage)` signature.

## Visual viewer

From the repository root:

```sh
cd urmwebpage/frontend
npx vite --config ../../experiments/sketchv4/productionization-parity/vite.config.mjs
```

Then open:

```text
http://127.0.0.1:4174/experiments/sketchv4/productionization-parity/viewer.html
```

The dedicated Vite config keeps its cache in the system temporary directory, outside the worktree.
The page fetches one reference and constructs one live fixture/stage selection at a time. It has
the required A/B/C/D/E focus presets and an optional overlaid diff. It imports only the small
shared snapshot utility and current harness entry point; no production page, navigation, or
historical viewer imports it.

## Restore and inspect

To inspect the durable layout checkpoint separately without moving the current branch:

```sh
git worktree add --detach /absolute/path/to/sketchv4-loop-endpoints-checkpoint sketchv4-loop-endpoints-composed-checkpoint
```

Do not regenerate on a production mismatch. Inspect the static JSON and run the verifier. If the
target itself is intentionally superseded, make a separate reviewed evidence-replacement commit,
update the pinned provenance and expectations, and explain the target change in that review.
