# Broader SketchV4 regression inputs

These inputs are a regression-detection set, not canonical geometry targets. Commit 0 intentionally
does not store layout snapshots or require visually perfect output for them. Once production reaches
the five-fixture parity contract, run the then-native SketchV4 pipeline over this list and triage
regressions without folding unrelated fixes into the productionization ladder.

## 24 compiler/fixture-metrics cases

The maintained source is `urmwebpage/fixture_kinds.py` (`METRIC_FIXTURES`); the checked metric
materialization is `urmwebpage/.fixture-metrics/fixtures_metrics.json`.

1. `zero`
2. `successor`
3. `predecessor`
4. `constant(3)`
5. `projection(1,2)`
6. `add`
7. `bounded_sub`
8. `multiplication`
9. `exponentiation`
10. `factorial`
11. `geometric_sum`
12. `divisor_count`
13. `characteristic:leq`
14. `characteristic:lt`
15. `characteristic:eq`
16. `characteristic:divides`
17. `compose(succ,succ)`
18. `primrec(zero,succ)`
19. `minimization(add)`
20. `subst:double`
21. `subst:square`
22. `subst:diagonal_divides`
23. `subst:add_succ`
24. `subst:succ_add`

The five exact-contract fixtures remain the separately frozen `minimization:bounded_sub`,
`characteristic:divides`, `characteristic:eq`, `primrec:basic`, and `predecessor` snapshots.

## Raw-program built-ins

Also smoke-test the nonempty programs maintained in
`urmwebpage/frontend/src/utils/encodingPresets.js`: `zero`, `successor`, `identity`, `constant-2`,
`projection-transfer`, `addition-loop`, `increment-until-equal`, and `truncated-subtraction`.
The Playground projections in `urmwebpage/frontend/src/utils/playgroundPresets.js` cover blank,
increment R0, zero R0, copy R0→R1, and the shared addition loop; blank should be checked as a
graceful empty-program case rather than a visual-quality target.

For each broader input, record only whether layout completes, SVG/coordinates are finite, edge and
node IDs remain internally consistent, endpoint diagnostics do not regress unexpectedly, and the
viewer remains responsive. Do not update the 30 canonical references from these results.
