# SketchV4 experiment index

This index is documentation only. It does not import modules, parse reports, or recreate geometry.
Unless stated otherwise, all listed work is harness-only and made no production-source change.

## Durable baseline hashes

The current/checkpoint canonical geometry definition is the compact JSON of sorted node boxes,
routes, and orientation entries recorded in the checkpoint manifest.

| Fixture | Bytes | SHA-256 |
|---|---:|---|
| `minimization:bounded_sub` | 6,052 | `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65` |
| `characteristic:divides` | 19,215 | `72995a166e8ed11f62d9cad0d9d6fea364b7bc9080cf2eceb7b53f630b234efd` |
| `characteristic:eq` | 13,261 | `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990` |
| `primrec:basic` | 4,938 | `e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f` |
| `predecessor` | 2,324 | `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926` |

## 01. Port-attachment grammar audit and overlays

- **Date/order:** 2026-07-01 overlay capture; 2026-07-12 24-fixture grammar audit.
- **Hypothesis:** named source/target ports and their incident directions can be audited independently and visualized without mutating layout.
- **Baseline/checkpoint:** then-current production SketchV4 `v4Assigned`; no commit was recorded in these artifacts.
- **Relevant commit:** not recorded in the artifact.
- **Result:** static base/overlay SVGs for eight fixtures and a 24-fixture attachment report were produced.
- **Status:** completed diagnostic evidence; not a promoted geometry change.
- **Geometry hashes:** per-file SVG hashes are preserved by the archive content-set digest; report values remain in JSON.
- **Artifacts:** `flow-layout-probes/grammar_overlay_probe.{mjs,json}`, `flow-layout-probes/port_attachment_grammar_probe.{mjs,json}`, `flow-layout-probes/overlays/`.

## 02. Ordinary-HALT development history

- **Date/order:** captured 2026-09-02; first stage of the ordinary-terminal line.
- **Hypothesis:** replacing the special HALT sink with a synthetic ordinary instruction before structural traversal would allow the normal SketchV4 stages to place and route it.
- **Baseline/checkpoint:** production parent `93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1`; adaptive/reentry checkpoint `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`.
- **Relevant commit:** `2cbcc69130fd549a602a66e5a7febdd7f3d38c42` (the development sequence was checkpointed as one harness commit).
- **Result:** ordinary action geometry replaced special HALT placement/routing while preserving a recoverable experimental pipeline and purity assertions.
- **Status:** successful harness baseline; checkpointed, never promoted to production behavior.
- **Geometry hashes:** checkpoint `characteristic:divides` combined hash `0122c288cfb31b2c76206e6cb27c57a6c892e5c654dd56bad18d190e20d3bb92`.
- **Artifacts:** `flow-layout-probes/ordinary_halt_experiment.{mjs,html}`, `flow-layout-probes/ordinary_halt_adaptive_reentry_CHECKPOINT.md`.

## 03. Adaptive conditional-merge sources

- **Date/order:** developed before and captured on 2026-09-02 with the ordinary-HALT checkpoint.
- **Hypothesis:** semantic branch source ports, fixed branch angles, V/H merge bodies, and a bounded adaptive ray length could remove merge defects without global repair.
- **Baseline/checkpoint:** production parent `93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1`; checkpoint `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`.
- **Relevant commit:** `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`; multi-fixture viewer follow-up `4aa27e437dc806b7cc3d1b6f9ceddefac23a6ff0`.
- **Result:** full sibling rays remained in open space; `i-15-yes` and `i-38-yes` in divides shortened only where committed geometry crowded them.
- **Status:** successful harness component; later composed into checkpoint baselines.
- **Geometry hashes:** included in the adaptive checkpoint hash above and later durable hashes.
- **Artifacts:** historical viewer/module and `ordinary_halt_adaptive_reentry_CHECKPOINT.md`.

## 04. `i-57` reentry work

- **Date/order:** captured 2026-09-02.
- **Hypothesis:** a divides-only right-center to right-center H/V/H connector for `i-57-cont -> i-58` would preserve the desired reentry and remove the more serious crossing.
- **Baseline/checkpoint:** adaptive ordinary-HALT work over production parent `93b3626c303d3013ed42a7ba0f0b35cae2c5e2e1`.
- **Relevant commit:** `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`.
- **Result:** reentry was retained with zero proper crossings; a known `i-55-jump × i-57-cont` edge overlap remained documented.
- **Status:** successful narrow exception in the harness; checkpointed, not production behavior.
- **Geometry hashes:** adaptive checkpoint divides hash `0122c288cfb31b2c76206e6cb27c57a6c892e5c654dd56bad18d190e20d3bb92`.
- **Artifacts:** historical viewer/module and adaptive checkpoint manifest.

## 05. Loop-source experiments and composition

- **Date/order:** 2026-09-03, in order: outward stubs, side-vs-bottom comparison, generalized rule, composition; promoted as a harness checkpoint 2026-09-05.
- **Hypothesis:** vertical-first backward loops should use a bottom-center departure while lateral-first loops retain an outward side departure.
- **Baseline/checkpoint:** adaptive/reentry checkpoint `2cbcc69130fd549a602a66e5a7febdd7f3d38c42`; composed-source checkpoint `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`.
- **Relevant commits:** `e90292e6e83133a3b14731df3fb3f50ab2e731d0`, `2088f4c1cdee8be8554bcededf0111b64019f692`, `c41b8a2560646995269d81787514bada4a38ceaf`, `d5eafae37704049164f39532fc1fcb7c94a2d3d9`, `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`.
- **Result:** exactly `i-27-jump`, `i-52-jump`, and primrec `i-19-jump` changed source attachment; all 16 loop sources became legal.
- **Status:** successful and checkpointed in the harness; all earlier alternatives remain in the historical module.
- **Geometry hashes:** source checkpoint hashes: bounded `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65`, divides `2a9354a026f3191452d8c16e05f7c648652c0f2f1299bd85b5850641da454341`, eq `0dead3046499c21957c0cf59cd0950f83d6af903bd04307c72f154ca8ca07990`, primrec `e06058db84d418002da1194801c561efd33708c894213fe00a6db6830495536f`, predecessor `167acfeec41d4523bd623f3450151b219a17b443f8a082143ab93dea2cd65926`.
- **Artifacts:** historical viewer/module and `ordinary_halt_loop_source_composed_CHECKPOINT.md`.

## 06. `i-52` target dogleg and direct-ray experiments

- **Date/order:** 2026-09-05; fixed local dogleg first, direct approach-line/incident-ray intersection second.
- **Hypothesis:** the illegal left-center/north target approach to divides `i-4` could terminate on its declared upper-left port without disturbing the existing approach geometry.
- **Baseline/checkpoint:** composed loop-source checkpoint `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`.
- **Relevant commits:** `4bb935f4dc975a2c9f258a742a433f80bfc83b0c`, `aa33d4e7b36b2e7a981d54c1edeb4516153c85f9`; earlier target-order probe based on checkpoint `2cbcc69130fd549a602a66e5a7febdd7f3d38c42` is in `diamond_loop_target_attachment_probe.*`.
- **Result:** both established legal target geometry; the direct ray removed the arbitrary fixed 16px target stub and became the generalization basis.
- **Status:** dogleg superseded but preserved; direct-ray result successful and later generalized.
- **Geometry hashes:** exact route evidence and checkpoint comparisons are recorded in the JSON and later endpoint hash.
- **Artifacts:** historical viewer/module and `flow-layout-probes/diamond_loop_target_attachment_probe.{mjs,json}`.

## 07. Loop-target generalization

- **Date/order:** 2026-09-05, after the direct `i-52` ray.
- **Hypothesis:** change an illegal loop target only when exactly one declared diagonal port ray intersects the existing directed final approach segment; preserve every already-legal target byte-for-byte.
- **Baseline/checkpoint:** composed loop-source checkpoint `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`.
- **Relevant commit:** `fb3551afeedff89d6866da35f4c00b9c77eb8737`.
- **Result:** only divides `i-52-jump -> i-4` changed; all 16 loop target attachments became legal with no ambiguity.
- **Status:** successful and composed into the final harness checkpoint.
- **Geometry hashes:** represented in the final durable hash table above.
- **Artifacts:** historical viewer/module and final endpoint checkpoint manifest.

## 08. Loop-endpoint composition

- **Date/order:** probe 2026-09-05; harness checkpoint promoted later the same day.
- **Hypothesis:** generalized loop-source and target rules remain stable when realized inside every fresh, unpinned normal orientation candidate rather than repaired after selection.
- **Baseline/checkpoint:** source checkpoint `c25bc54c4364b6ff9af3e903d8b929bf6d0a265f`; final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Relevant commits:** probe `4eec3807303d763b8095172eadfe114b84134976`; promotion `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Result:** all five fixtures reproduced stable orientations; the final checkpoint differs from the source checkpoint only in the intended divides target suffix.
- **Status:** successful current harness baseline; checkpointed, still not production layout behavior.
- **Geometry hashes:** the five durable hashes at the top of this index.
- **Artifacts:** historical viewer/module and `ordinary_halt_loop_endpoints_composed_CHECKPOINT.md`.

## 09. `bounded_sub` `i-22` forced flip

- **Date/order:** 2026-09-05, first post-checkpoint local comparison.
- **Hypothesis:** forcing only `i-22` flipped removes `i-24-jump × i-26` without adding a crossing, overlap, attachment failure, or unrelated geometry change.
- **Baseline/checkpoint:** final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Relevant commit:** no new commit; ignored harness result anchored to `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Result:** confirmed; production orientation cost remained a 0/0 tie and therefore did not distinguish the candidates.
- **Status:** completed diagnostic, not promoted; the flip remains an archive-only reference.
- **Geometry hashes:** baseline `3730839d2267f10d1878cf1404da003b08e345cb049f3ed48144cce1142efb65`; forced `e49dd79e4a06ecec0363046dde45f738912cfc851f921a109f5800fb28e10ea2`.
- **Artifacts:** `flow-layout-probes/bounded_sub_i22_flip_probe.{mjs,json}` and historical viewer mode `i22-flip`.

## 10. Provisional intrusion-aware orientation

- **Date/order:** 2026-09-05, after the forced-flip result.
- **Hypothesis:** adding unit-weight unrelated node-edge intrusions to the existing node-overlap/crossing orientation cost would generalize the `i-22` improvement.
- **Baseline/checkpoint:** final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Relevant commit:** no new commit; ignored harness result anchored to the checkpoint.
- **Result:** removed the bounded-sub intrusion but exposed a counterexample: divides `i-25` changed on a provisional 7/6 signal and left a proper crossing.
- **Status:** failed as a general rule; explicitly not promoted or checkpointed.
- **Geometry hashes:** all checkpoint and candidate hashes are recorded per fixture in the report.
- **Artifacts:** `flow-layout-probes/intrusion_aware_orientation_probe.{mjs,json}` and historical viewer mode `intrusion-aware-orientation`.

## 11. Transient-defect diagnosis

- **Date/order:** 2026-09-05, after the provisional counterexample.
- **Hypothesis:** divides `i-25` was reacting to temporary geometry from unresolved later fork `i-53`, whereas the bounded `i-22` intrusion persisted after completion.
- **Baseline/checkpoint:** final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932` with the same N/C/I score held constant.
- **Relevant commit:** no new commit; ignored harness result anchored to the checkpoint.
- **Result:** confirmed the transient `i-25` signal and persistent `i-22` signal; a blanket unresolved-geometry filter was not supported.
- **Status:** completed diagnosis; no new rule or repair promoted.
- **Geometry hashes:** provisional and completed candidate digests are in the report.
- **Artifacts:** `flow-layout-probes/orientation_transient_defect_probe.{mjs,json}` and historical viewer mode `orientation-transient-diagnosis`.

## 12. One-step completed-candidate orientation

- **Date/order:** 2026-09-05, after transient diagnosis.
- **Hypothesis:** temporarily completing the unresolved suffix with the normal production orientation policy before scoring each focus candidate would avoid transient decisions.
- **Baseline/checkpoint:** final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Relevant commit:** no new commit; ignored harness result anchored to the checkpoint.
- **Result:** selected the desired bounded `i-22` flip and preserved divides `i-25` default. Seven early rollout suffixes differed from the eventual experimental suffix, but none reversed a decision in the five fixtures.
- **Status:** successful on recorded fixtures but internally inconsistent as a general oracle; not promoted.
- **Geometry hashes:** bounded result `e49dd79e4a06ecec0363046dde45f738912cfc851f921a109f5800fb28e10ea2`; unchanged fixtures retain their durable checkpoint hashes.
- **Artifacts:** `flow-layout-probes/completed_candidate_orientation_probe.{mjs,json}` and historical viewer mode `completed-candidate-orientation`.

## 13. Self-consistent recursive/global N/C/I oracle

- **Date/order:** 2026-09-05, final completed probe before cleanup.
- **Hypothesis:** recursively applying the same completed-candidate policy to every suffix would remove rollout inconsistency; exhaustive enumeration could independently audit global optimality.
- **Baseline/checkpoint:** final checkpoint `9f166f24721e7125ec9c0105e8960c6273d8d932`.
- **Relevant commit:** no new commit; ignored harness result anchored to the checkpoint.
- **Result:** zero selected-suffix mismatches; the recursive result matched a global N/C/I minimum for all fixtures and matched every one-step decision. The exhaustive audit realized 16, 2,048, 256, 4, and 4 maps respectively.
- **Status:** completed proof/diagnostic evidence; deliberately not optimized, promoted, checkpointed, or used by the active viewer.
- **Geometry hashes:** bounded recursive `e49dd79e4a06ecec0363046dde45f738912cfc851f921a109f5800fb28e10ea2`; the other four recursive results retain their durable checkpoint hashes.
- **Artifacts:** `flow-layout-probes/self_consistent_completed_candidate_probe.{mjs,json}` and historical viewer mode `self-consistent-orientation`.

## Recovery summary

The archived monolith contains every historical viewer constructor listed above, while the paired
JSON reports preserve post-checkpoint diagnostics. For exact committed-stage recovery, prefer the
three checkpoint tags documented in `README.md`. For ignored post-checkpoint work, restore the
archived module/report pair into an isolated final-checkpoint worktree with the archived
`programs.json`. Failed experiments are retained intentionally.
