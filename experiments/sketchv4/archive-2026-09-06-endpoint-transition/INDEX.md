# SketchV4 endpoint-transition experiment index (items 14-18)

Continues the numbering of `../archive-2026-09-05/INDEX.md`. This index is documentation
only. All listed work is harness-only, was developed as ignored working files after commit
`ba1260c` ("Archive SketchV4 experiment history and slim active harness"), and made no
production-source change. Baseline for every item is the composed loop-endpoints
checkpoint reproduction (`9f166f24721e7125ec9c0105e8960c6273d8d932`) built by the active
`current_harness.mjs`. Each probe report was re-validated on 2026-09-06: all internal
assertions pass (`exit 0`).

## 14. Source-path intrusion-ownership census

- **Date/order:** 2026-09-06, first post-cleanup diagnostic.
- **Hypothesis:** an unrelated node-edge intrusion can be attributed to a focus fork's
  D/F side purely from the branch path of the intruding edge's source node.
- **Result:** required cases separate (`bounded_sub` `i-22` owned 1/0, `divides` `i-25`
  0/0), but the rule is blind to semantic branches departing the focus fork itself: at
  focus `i-53`, `i-53-yes` departs the yes child while the source node carries no `i-53`
  child token. `scoringExperimentJustified: false`.
- **Status:** completed census; insufficient as a final rule; superseded by item 15.
- **Artifacts:** `flow-layout-probes/local_intrusion_ownership.mjs`,
  `flow-layout-probes/local_intrusion_ownership_probe.{mjs,json}`.

## 15. Departure-augmented ownership census

- **Date/order:** 2026-09-06, after item 14.
- **Hypothesis:** appending the direct semantic YES/NO departure token to the source path
  removes the direct-departure blind spot.
- **Result:** all seven blind departures recovered; `i-22` preserved, `i-25` unaffected;
  but a whole-edge counterexample appeared — departure identity falsely extends across
  entire merge connectors, so a segment-level concept is necessary.
- **Status:** completed census; whole-edge attribution rejected; superseded by item 16.
- **Artifacts:** `flow-layout-probes/departure_augmented_intrusion_ownership_probe.{mjs,json}`.

## 16. Segment-phase ownership census

- **Date/order:** 2026-09-06, after item 15.
- **Hypothesis:** positional segment phases (first = departure, middle = body, final =
  arrival) scope departure identity correctly.
- **Result:** `i-22` preserved, `i-25` unaffected, all seven whole-edge false positives
  disappear; but compelling body conflicts are stranded and one long final segment
  produces a false target-owned arrival (`divides` `i-3`).
- **Status:** completed census; phases alone insufficient; superseded by item 17.
- **Artifacts:** `flow-layout-probes/segment_phase_intrusion_ownership{,_probe}.mjs`,
  `flow-layout-probes/segment_phase_intrusion_ownership_probe.json`,
  `flow-layout-probes/segment_phase_intrusion_experiment.html`,
  `flow-layout-probes/segment_phase_visual_viewer.mjs`.

## 17. Endpoint-transition ownership census

- **Date/order:** 2026-09-06, after item 16; the frozen ownership grammar.
- **Hypothesis:** classify each segment phase by structural endpoint states relative to
  the focus fork (departureSide = source ancestry + direct semantic token; targetSide =
  target ancestry; states YES/NO/OUTSIDE), owning same-side bodies, same-side and
  OUTSIDE->side arrivals, withholding opposite-side arrivals.
- **Result:** clean on all five fixtures — `i-22` preserved (1/0), `i-25` unaffected
  (0/0), all eight body conflicts recovered with no false body attribution, the bad
  `divides` `i-3` arrival corrected, all seven plausible target-local arrivals retained,
  no ambiguity or multi-fork attribution. `NO -> YES` and arrival-phase `OUTSIDE -> NO`
  have no fixture coverage.
- **Status:** completed census; adopted as the frozen grammar for item 18. Not promoted.
- **Artifacts:** `flow-layout-probes/endpoint_transition_intrusion_ownership{,_probe}.mjs`,
  `flow-layout-probes/endpoint_transition_intrusion_ownership_probe.json`,
  `flow-layout-probes/endpoint_transition_intrusion_experiment.html`,
  `flow-layout-probes/endpoint_transition_visual_viewer.mjs`.

## 18. Endpoint-transition local scoring experiment

- **Date/order:** 2026-09-06, final experiment before parking the research line.
- **Hypothesis:** candidate orientation cost = node overlaps + proper crossings +
  intrusions locally owned by the focus fork (frozen item-17 grammar); local
  two-candidate selector, deepest-first, strict improvement, tie -> default; no
  completion, lookahead, recursion, or repair.
- **Result:** exactly one fork changes across all five fixtures —
  `minimization:bounded_sub` `i-22` -> **F** from owned counts 1/0, removing the
  `i-24-jump x i-26` intrusion (final diagnostics 0/0/0/0). `divides` `i-25` is protected
  (raw intrusions 4/3 would flip it; owned 0/0 keep it **D**); `i-48`/`i-53` remain
  **F**; the independently rerun control selector reproduces the checkpoint exactly.
  Median selection cost 236ms vs 200ms control across the five fixtures (54 candidate
  realizations per sweep). Untested directions remain (`NO -> YES`, arrival
  `OUTSIDE -> NO`).
- **Status:** completed experimentally; **not promoted, not checkpointed, production
  behavior unchanged**; research line PARKED here by explicit decision.
- **Geometry hashes:** the report records diagnostics and decisions, not canonical
  hashes. The control path reproduces the checkpoint orientation maps exactly (durable
  hashes re-verified separately via `verify_current.mjs`); the experimental `i-22 -> F`
  outcome matches item 09's forced flip, whose geometry hash
  (`e49dd79e4a06ecec0363046dde45f738912cfc851f921a109f5800fb28e10ea2`) is recorded there.
- **Artifacts:** `flow-layout-probes/endpoint_transition_intrusion_scoring{,_probe}.mjs`,
  `flow-layout-probes/endpoint_transition_intrusion_scoring_probe.json`,
  `flow-layout-probes/endpoint_transition_intrusion_scoring_experiment.html`,
  `flow-layout-probes/endpoint_transition_intrusion_scoring_visual_viewer.mjs`.

## If this line is resumed

The natural next steps recorded at parking time: exercise the uncovered transition
directions (`NO -> YES`, arrival `OUTSIDE -> NO`) on fixtures that produce them, then
decide whether the item-18 scoring rule becomes the production orientation cost.
