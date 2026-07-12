# SketchV4 Visual Grammar — Constitution v0.1

Status: **living rulebook, not a finished constitution.**
Seeded: 2026-07-01, from the SketchV4 visual-grammar discovery audit (probe evidence in
`frontend/.flow-layout-probes/port_attachment_grammar_probe.{mjs,json}`).
Scope: **SketchV4 only** (`src/layout/sketchv4/`). SketchV3 and older engines appear only as
design history. This document changes no behavior; it records what the behavior *is*, what it
*should be*, and which of those two claims is actually settled.

---

## 0. Why this document exists (the authority problem)

The audit's central finding: V4's geometry is nearly clean by scoreboard (0–1 crossings on all
24 `METRIC_FIXTURES`), but the visual grammar itself is **split across four authorities that
disagree and have no arbiter**:

| Authority | What it governs | Its power today |
|---|---|---|
| `defects.js` (`evaluateDefects`) | node overlaps + edge crossings | **enforced** — it is the orientation DP's objective (`total = nodeOverlapCount + crossingCount`) |
| `attachmentStubs.js` (`validateEdgeAttachments`) | legal port + incident direction per node shape and edge role | **declared but toothless** — ~160 self-violations across the fixture set, reported in `sketchV4Summary.illegalLocalAttachmentEndpointCount`, consumed by nothing |
| `routing.js` escape hatches (`clearY`, `nodeEntryY`, `clearParallelLoopRailY`) | actual route shapes when the ideal shape is blocked | **implicit** — governed by no declared rule; source of most stub violations |
| adapter/rendering (`BetaFlowDiagram.jsx`: `labelPointForPolyline`, viewport, debug tint) | label anchors, viewBox, debug overlays | **outside the pipeline entirely** — no diagnostic can even see a label |

A diagram can therefore be "clean" by the enforced metric while violating the declared grammar
26 times (divisor_count). That gap is where ad hoc patches breed. **This rulebook is the
intended arbiter:** every visual decision should trace to a rule here, with an explicit status,
an owning pipeline stage, and probe evidence. When code and rulebook disagree, that is a defect
in one of them — file a defect card (§6) and decide which.

---

## 1. Purpose and non-goals

**Purpose.** SketchV4 is a **rule-based visual grammar for URM control-flow diagrams**. The
target is human-readable program structure: a diagram should explain control flow the way a
careful hand sketch would — visible decision doorways, downward continuation, loop returns that
look like loop returns, a HALT that does not dominate the story.

**Non-goals.**
- Not a generic graph-layout engine. No barycenter crossing minimization, no force-direction,
  no free obstacle-avoiding pathfinding. Structure (roles, ownership, orientation) decides
  geometry; geometry never reorders structure.
- Compactness is **secondary** to grammar correctness and readability. Area/aspect complaints
  are recorded (Q9) but never outrank a grammar rule.
- "No crossings" and "no overlaps" are useful but **insufficient**. A diagram can be
  geometrically legal and visually wrong (wrong doorway, drifted label, jammed port, clipped
  corner). The enforced defect total is a floor, not the definition of correct.

---

## 2. Rule lifecycle

Every rule and defect card carries exactly one status:

| Status | Meaning |
|---|---|
| `observed` | someone saw it; captured as a defect card, not yet measured |
| `hypothesis` | candidate rule stated falsifiably; scope/counterexamples not yet swept |
| `validated` | probe evidence across the fixture set confirms the phenomenon and scope |
| `adopted` | written into this constitution as the intended rule (may not be enforced yet) |
| `enforced` | mechanically guaranteed — by construction in the pipeline, or counted in the enforced defect objective, or gated in the harness |
| `diagnostic-only` | deliberately measured and reported but never fed back into layout |
| `rejected-with-counterexamples` | considered and refused; the counterexamples are retained here (half the value of a constitution is remembering why not) |

**Amendment procedure** (the defect→rule loop from the audit):
1. Capture the suspicion as a defect card (§6 template). Cards are cheap; file even "this feels off."
2. Classify against this rulebook: violates an existing rule (bug) / reveals a rule is
   underspecified (amend) / implies a missing rule (draft).
3. Quantify scope with a non-mutating probe in `frontend/.flow-layout-probes/` over all
   `METRIC_FIXTURES` (see the `flow-layout-probe` skill).
4. Sweep for counterexamples — fixtures where enforcing the candidate would make a good diagram worse.
5. Move the status forward (or to `rejected-with-counterexamples`). Statuses only move with
   evidence attached.
6. Every rule names **one owning pipeline stage** (§3). A rule that cannot name its stage is
   two rules — split it.

Rules are numbered `R#` (accepted/near-accepted), open questions `Q#`, defect cards `C#`.
Numbers are never reused.

---

## 3. Pipeline ownership map

Runtime order and the single entry point are `pipeline.js` (`buildLayout`). Each kind of
visual decision has exactly one owner:

| Visual decision | Owning stage | Module / function |
|---|---|---|
| what a node/edge *is* (role, re-entry tags) | role classification | `roles.js` `classifyRoles`; CFG + DFS order in `cfg.js` `buildCfg` |
| which subtree owns a node; arm/side identity | ownership | `ownership.js` `computeOwnership` (`ownerOf`, `nca`, `subtreeExtent`); `realforktree.js` `buildRealForkTree` |
| which arm of a real-fork goes visually left/right | orientation | `orientation.js` `assignOrientation` (bottom-up DP); guard arms fixed by `pipeline.js` `roleGuardOrientation` |
| where nodes sit | placement/skeleton | `skeleton.js` `buildSkeleton` (`diamondFaces`, `branchReachForDepth`) |
| which rail a loop-return uses | lanes | `lanes.js` `computeLanes` (laneBundle = nestingGroup × side × routeFamily, LOCAL anchors) |
| where the shared sink sits; band order | HALT policy | `halt.js` `placeHalt` |
| which port an edge uses at each end | ports/stubs | `ports.js` `selectPorts` (only two real policies today: `halt-shared-corridor`, `merge-side-entry`); legality vocabulary in `attachmentStubs.js` (`DIAMOND_PORTS`, `RECTANGLE_PORTS`, `TERMINAL_PORTS`, `roleConstraints`) |
| the waypoints between ports | route shape | `routing.js` `routeEdges` (per-routeFamily bodies: `mergeTopConnector`, `mergeSideConnector`, `mergeSideJogConnector` (R17), loop rail shape, halt corridor; escape hatches `clearY`, `nodeEntryY`, `clearParallelLoopRailY`) |
| edge labels (yes/no anchors) | labels — **currently unowned by the pipeline** | adapter only: `BetaFlowDiagram.jsx` `labelPointForPolyline` + `SKETCHV4_BRANCH_LABEL_OFFSET` (see Q4/C5; a label phase is a planned stage, not an existing one) |
| measurement and reporting | diagnostics | `defects.js` `evaluateDefects` (enforced objective); `diagnostics.js` `buildDiagnostics` (read-only records incl. `sketchV4AttachmentRecords`, `sketchV4PortRecords`) |
| viewport, SVG, debug tinting, fallback | adapter/rendering | `BetaFlowDiagram.jsx` `computePrimaryLayoutPlan` → `buildSketchV4LayoutPlan` (`?flowLayout=sketchv4`, `?flowDebugPorts=1`, SketchV3 fallback on error) |

Seam warnings (where rules most easily fall between owners):
- **ports ↔ route shape**: `ports.js` picks *which* port with no footprint knowledge;
  `routing.js` builds the body trusting it. C3 lives exactly here.
- **pipeline ↔ adapter**: labels and viewport happen after the grammar has finished; a grammar
  that says "labels attach to the correct visual part of the edge" cannot currently be checked.

---

## 4. Accepted / near-accepted rules

Only rules that are genuinely stable. Everything else is in §5/§7.

### 4.1 Hard invariants — `enforced` (by construction unless noted)

- **R1 — Draw order.** DFS from instruction 0; no-branch inline, yes-branch LIFO-deferred;
  placed-once (first DFS path owns the node). `cfg.js` `buildCfg` walk. Carried from SketchV3
  as the irreducible traversal grammar.
- **R2 — One role per element.** Every node and edge gets exactly one structural role, computed
  once in `roles.js`; re-entry tags (`loop-header`, `merge-target`) are additive, never
  replacing. Node roles: `start, shared-sink, setup-node, trunk-member, subtree-member,
  real-fork, trunk-guard, interior-guard, loop-guard, mixed-guard, degenerate`. Edge roles:
  `entry-link, setup-link, spine-continuation, branch-exit, merge-connector, loop-return,
  halt-exit`.
- **R3 — Structural gates over local shape.** Role discrimination may use structural position
  (e.g. trunk-guard requires depth-0 **and** survivor-falls-through), never raw local CFG shape
  alone. `roles.js` pass 1. (Design history: the V3 dogleg fix failed until gated this way.)
- **R4 — START anchors the spine at the origin;** entry drops one `ordinaryPitch`.
  `buildSkeleton`. (What "top-centered" means beyond this is open — Q8.)
- **R5 — Ordinary continuation goes straight down** at fixed pitch (`setup-link` at
  `setupPitch`, `spine-continuation` at `ordinaryPitch`); the trunk-guard's survivor is a
  spine-continuation and stays in-column beneath its diamond.
- **R6 — Branch doorways are diamond lower faces.** `branch-exit` edges leave from the LL/LR
  quarter-points (`diamondFaces`) as **straight fixed-angle rays** to the child's top. The ray
  is the branch idiom; branch exits are never orthogonalized.
- **R7 — Outer splits open wider than nested.** Branch reach is depth-scaled by geometric
  decay with an outer boost and a floor (`branchReachForDepth`) — placement scale only, never
  routing. Status: `enforced` mechanism, `adopted` shape; all numbers live in §4.3.
- **R8 — Orientation bits exist only on real-forks.** Guards are non-orientable: the HALT arm
  goes to the HALT-bearing side, the survivor opposite (`roleGuardOrientation`). Loop-guards
  fall through to default (unexercised by the canonical set — flag if ever exercised).
- **R9 — Orientation assignment** is a tree-global bottom-up DP over real-forks; objective =
  total realized defects; **flip only on strict improvement** (anti-thrash); tie-break =
  default `no:left / yes:right`; manual pins are hard constraints; global search is demoted to
  the `rareRepairCandidates` diagnostic. `orientation.js`.
- **R10 — Ownership = branchPath.** `ownerOf` keys off real-forks only; guard decisions on the
  way down are not owners. `ownership.js`.
- **R11 — Lane bundles with LOCAL anchors.** `laneBundle = nestingGroup × side × routeFamily`;
  anchor = the owner subtree's extent on the placement (never a global diagram bound);
  laneIndex by span (inner span → inner rail); no global depth term. Coupling of unrelated
  spans is surfaced (`sharesBundleWithRelatedOnly`, `interleavingConflict`), never hidden.
  `lanes.js`.
- **R12 — HALT-outermost band order** on the HALT side: `[body] → [loop rails] → [HALT band] →
  [sink]`; sink X = `max(body extent, outermost same-side rail) + band offset` (`placeHalt`),
  so a same-side loop rail can never end up outside the band (the fix for the V3 minimization
  `i-24` graze); HALT approaches and loop rails are separate routeFamilies that never share
  lane numbering. `haltBandReserved` / `loopRailInsideHaltBand` report compliance.
- **R13 — One route shape per routeFamily.** spine/setup/entry = straight bottom→top; branch =
  the R6 ray; merge-connector = orthogonal connector to an already-placed target (never a fresh
  ray); loop-return = its lane rail with the source/target-offset shape; halt-exit = shared
  corridor column + stacked sink landings. `routing.js` `routeEdges`.
- **R14 — Port selection is one explicit pass** (`ports.js` `selectPorts`) running before route
  bodies; every edge gets a recorded selected-vs-default port (`changed` flag) for diagnostics.
- **R17 — Merge side-entry approaches from outside.** A merge-connector's side-entry must reach
  its side port from strictly outside the target's x-extent plus clearance. Split per the
  one-owner principle: `selectPorts` owns the footprint TEST (drop column inside
  `[tb.left − clearance, tb.right + clearance]` ⇒ record `sideEntryJogX`, the column just
  beyond the box edge); `routing.js` `mergeSideJogConnector` owns the jog BODY (stop the drop
  just above the target, jog outward, descend beside the box, enter the side face from
  outside — `connectorKind: "sideEntryJog"`). Same-row side entries keep `sideStraight`
  unchanged. Enforced by construction 2026-07-01; born as C3.
- **R15 — Diagnostics never feed back.** The only sanctioned defect→layout path is orientation
  deliberately calling `evaluateDefects` as its objective. `buildDiagnostics` is read-only and
  byte-identical on/off (asserted by the phase-6 harness).
- **R16 — Enforced defect objective** = `nodeOverlapCount + crossingCount`, with crossings
  classified by routeFamily and orientation-addressability (`classifyCrossing`,
  `lcaRF`). Additions to this total are a constitution act, not a tuning act (see §8,
  "scalar aesthetic scoring" hazard).

### 4.2 Soft preferences — `adopted` (intended, but tie-breaks/costs, not guarantees)

- **P1 —** Default orientation reads `no:left / yes:right`; flips must earn their keep (R9's
  strict gate is the mechanism).
- **P2 —** 16px clearance around nodes is *preferred*; violations are counted
  (`placementClearanceFailureCount`) but only true overlaps enter the enforced total.
- **P3 —** Parallel loop-rail horizontals repel to 3× clearance
  (`clearParallelLoopRailY`); adjustments are recorded
  (`parallelRailAdjustmentRecords`), residual conflicts reported
  (`findParallelRailConflicts`). `diagnostic-only` residue is acceptable.
- **P4 —** HALT approaches share one corridor trunk (`corridorX`) with stacked landings rather
  than fanning into per-slot band lanes (`halt-shared-corridor` vs recorded
  `defaultCorridorX`). The corridor mechanism is construction behavior today; it stays a
  preference because the landing shape for co-row sources is unresolved (near-collinear
  doubled horizontals, visible on predecessor's render — observed, no Q assigned yet).
- **P5 —** A candidate rule enters the pipeline as an option/flag (the way `orientationSource`
  does) and lives harness-only until `adopted`.

### 4.3 Parameters (NOT rules — never cite these as grammar)

`setupPitch 54`, `ordinaryPitch 82`, `branchRayDistance 126`, ray profile
(boost 1.45 / decay 0.78 / floor 80 → d0:183 d1:143 d2:111 d3:87 d4+:80),
`BASE_GUTTER 40`, `LANE_STEP 44`, `HALT_BAND_OFFSET 154`, `clearance 16`,
`SKETCHV4_BRANCH_LABEL_OFFSET 12`, stub epsilons (`PORT_EPSILON 1.25`, `AXIS_EPSILON 0.75`),
`PARALLEL_LOOP_RAIL_CLEARANCE_FACTOR 3`, `MIN_PARALLEL_LOOP_RAIL_OVERLAP 8`,
`columnTolerance 1` (`ports.js` `colTol`), escape-hatch iteration caps (20/40). These are calibrations of rules; changing one is tuning,
changing what it *means* is an amendment.

### 4.4 Declared-but-contested: the attachment-stub grammar — `diagnostic-only`

`attachmentStubs.js` declares the local legality vocabulary (shape × named port × incident
direction × edge-role constraints) and `sketchV4AttachmentRecords` applies it to every route
endpoint. It is the right *formalism* for port/stub rules — and it currently **disagrees with
the intended idiom in at least one place** (C1) and is violated by escape hatches in others
(C2). Its contents are therefore *not* accepted rules yet; they are the raw material Q1–Q3
adjudicate. Do not enforce it wholesale; do not delete it — arbitrate it.

---

## 5. Unresolved constitution questions

Open. Do **not** treat any of these as settled; each cites its defect card and evidence.

- **Q1 — How does a diagonal branch ray legally terminate at a box?** (C1) The stub grammar
  demands due-`north` entry at a rectangle's top port; the R6 ray arrives `north-east`/
  `north-west` — 133 declared-illegal endpoints across all fixtures, yet the drawings look like
  the intended hand sketch. Options: (A) legalize NE/NW top-port arrival role-scoped to
  `branch-exit` (mirroring `TERMINAL_PORTS.roleConstraints`); (B) require a short vertical
  entry stub on every ray. Research note: continuity findings (§8) weigh against B's extra
  bends. **Decision needed: spec change, not code change.**
- **Q2 — Minimum outward stub for side-port exits?** (C2) May an edge exit a left/right port
  and immediately run vertically along its own node's edge? Escape hatches do this today
  (15 loop-return + 2 halt sources heading `south` off a side port). Candidate rule: first
  segment from a side port runs perpendicular-outward ≥ stub-length before turning (standard
  port-constraint practice). No counterexample found yet — still `hypothesis` until swept.
- **Q3 — Must distinct edges land on distinct port points?** (C4) Today: merge + placing-ray
  share a target's top port; two loop rails share one left-port point. Candidate: Kandinsky
  slotting (center edge straight, others offset) for node landings, family trunks (P4 corridor)
  exempt. Which family yields the center is undecided.
- **Q4 — Where do branch labels belong?** (C5) Current adapter behavior = arclength midpoint of
  the whole route + 12px perpendicular nudge. Candidate: decision labels anchor at fixed offset
  along the **first** segment out of the diamond (the doorway). Needs a per-side offset rule to
  avoid twin-label collisions, and a label phase to own it (§3).
- **Q5 — Does a merge arm of a real-fork deserve a branch doorway?** A real-fork whose yes-arm
  is a merge-connector exits the diamond's **bottom tip** (continuation look) while its sibling
  gets a side-face ray (decision look) — e.g. divides `i-53`/`i-38`, eq `i-11`/`i-31`. Should
  merge arms exit via their owned side face first? Interacts with Q3 and C3. Candidate owner
  if adopted: ports (`selectPorts` doorway choice), with the body shape following in route
  shape. `hypothesis`.
- **Q6 — Loop-side vs HALT-side conflict.** (C6) A trunk-target loop whose entry arm sits on
  the HALT side forces a rail × halt-exit crossing (minimization:bounded_sub `i-24-jump ×
  i-25-cont`, the known residual). Options: (a) route trunk-target loops on the non-HALT side;
  (b) halt-exits detour below same-side rails; (c) legalize a single perpendicular rail×halt
  crossing in the band region as a sanctioned idiom. Audit lean: (c), supported by
  crossing-angle research — recorded as a lean, **not** a decision.
- **Q7 — HALT sink vertical convention.** Current: sink Y = median of exit source rows
  (`placeHalt`), which puts HALT at the *top*-right for predecessor and divides. Hand sketches
  usually end at the bottom. Candidates: median-of-exits (current) / below last trunk row /
  bottom-of-flow. No evidence collected yet — `observed`.
- **Q8 — What does "top-centered START" mean?** Spine-anchored at origin (current, R4) or
  centered in the rendered canvas (rails and HALT band shift the canvas asymmetrically)?
  Affects adapter viewport policy only, today. `observed`.
- **Q9 — Rhythm/aspect for mega-tall diagrams.** divisor_count renders 1491×19805. Compactness
  stays secondary by charter (§1), but "uniform pitch = visual rhythm" is an unstated rule and
  chain segmentation is unexplored. Deliberately deferred; recorded so it stops resurfacing as
  ad hoc spacing patches (design history: three dedicated-param spacing patches in V3 preceded
  the V4 rewrite).

---

## 6. Defect-card template

```
DEFECT CARD C<n> — <short name>
Fixture + locus:      program(s), edge/node ids, screenshot crop or SVG path
Observed defect:      what is visibly wrong (one sentence)
Why it looks wrong:   the perceptual/semantic principle violated (Gestalt/convention/semantics)
Implied visual rule:  candidate rule, stated falsifiably
Scope:                which roles / routeFamilies / depths it governs
Counterexamples:      cases where the rule must NOT apply (or "none found — swept <date>")
Implementation locus: file/function that would own the fix (one owning stage — §3)
Diagnostic evidence:  probe path + the numbers; diagnostics fields that expose it
Status:               observed | hypothesis | validated | adopted | enforced |
                      diagnostic-only | rejected-with-counterexamples
Decision needed:      the constitution question it feeds (Q#), or "none — mechanical"
```

---

## 7. Seed defect cards (from the 2026-07-01 audit)

All probe numbers from `port_attachment_grammar_probe.json` over the 24 `METRIC_FIXTURES`
unless noted; renders inspected: predecessor, characteristic:eq, characteristic:divides,
minimization:bounded_sub (`.sketchv3-harness/screenshots/`).

**C1 — Ray terminus vs top-port stub.** Branch-exit rays land on rectangle top ports with
incident `north-east` (72×) / `north-west` (61×); stub grammar expects `north`. All fixtures
with branches; even predecessor's only two branch edges are flagged. Looks *fine* in renders —
the declared rule and the intended idiom disagree, so this is a defect **of the spec**.
Implied rule: adjudicate Q1. Locus: `attachmentStubs.js` port tables (`RECTANGLE_PORTS` +
role-scoped stubs), not routing. Status: `validated` (spec conflict). Decision: **Q1**.

**C2 — Side-port exit heading south (missing outward stub).** When `clearY` re-drops a
loop-return's exit row, the route leaves the LEFT port then runs `south` hugging its own box
(15×); `nodeEntryY` does the same off halt sources' RIGHT ports (2×); 3 more loop-return
*targets* entered `north` at a left port. V3's "SW-dogleg" ghost reborn inside V4's escape
hatches. Implied rule: minimum outward stub before turning (Q2), plus the meta-rule: **an
escape hatch may move a segment, but the moved segment must still satisfy the stub grammar.**
Locus: loop-return and halt-exit body builders in `routing.js` `routeEdges`. Status:
`validated`. Decision: **Q2** (sweep counterexamples, then adopt).

**C3 — Merge side-entry clips the target box.** `ports.js` chooses `merge-side-entry` by
comparing centers only (`sBox.cx > tBox.cx`); `routing.js` `mergeSideConnector` drops at the
source's cx, which can sit *inside* the target's footprint → the descent passes through the
box and enters the right port from the `west`. 7 confirmed: eq `i-11-yes`→`i-17` (13px) and
`i-31-yes`→`i-37` (20px), divides `i-15-yes`→`i-21` (37px), bounded_sub `i-3-yes`→`i-9` (13px),
characteristic:leq, characteristic:lt, subst:diagonal_divides. Wrong under **any** plausible
rulebook — the only audit finding whose direction is already forced. Implied rule: a
side-entry approach comes from strictly outside the target's x-extent (with clearance); jog
outward first if the source column overlaps the footprint. Counterexamples: none possible.
Locus: the `ports.js`↔`routing.js` seam — split per §2's one-owner principle: the footprint
test in `selectPorts` (`sideEntryJogX`), the outward jog in `mergeSideJogConnector`. Status:
**`enforced` (2026-07-01, as R17).** After-fix probe evidence
(`port_attachment_grammar_probe.mjs`, geometric interior-clip metric): clips 7→0 on all 24
fixtures; the 7 target-west illegal endpoints gone (160→153 total), no new illegal kinds;
defect totals, placements, orientation flips, and every non-merge polyline byte-identical;
renderBounds unchanged. One additional rule-correct reroute beyond the 7 clip cases:
divisor_count `i-274-cont` (drop column 11px from the box edge — inside the 16px clearance
band, so the rule fires on the near-graze too). Decision: none — mechanical.

**C4 — Port jam: distinct edges sharing one port point.** divides `i-44` top port receives its
placing ray (`i-41-yes`) **and** a column-aligned merge (`i-38-yes`); divides `i-4` left port
receives two loop rails (`i-27-jump`, `i-52-jump`); divisor_count 4 jams (incl. two
merge-connectors on `i-275`); diagonal_divides 3. Two control-flow facts collapse into one
visual event; in-degree becomes uncountable. Implied rule: distinct approaches at shared ports
(Q3) — slotting exists in-house already (`landingSlot` on the sink). Scope limit: family trunk
columns (P4) are exempt; the rule is about *node landings*. Locus: `ports.js` (new policy).
Status: `validated`. Decision: **Q3**.

**C5 — Branch-label drift on long routes.** Labels use arclength midpoint of the entire route
(`labelPointForPolyline`): plain rays land a consistent 109–133px from their diamond, but
halt/merge branch arms drift 165–266px — predecessor's `i-0-yes` "yes" sits next to the *sink*,
~500px of route from the decision it describes. Convention says yes/no belongs at the decision
doorway. Implied rule: Q4 doorway anchoring. Known-good today: labels never land *on* a node
box (0/74 in `_v4_grammar_audit.json`); no label-vs-edge check exists at all. Locus: adapter
`labelPointForPolyline` today; properly a new label phase (§3). Status: `validated`.
Decision: **Q4**.

**C6 — Loop rail × HALT-exit forced crossing.** minimization:bounded_sub: rail `24→2` (side =
entry-arm side, per `computeLanes`) must cross `25→HALT` at 90° inside the band region — the
canonical-set residual (phase-9: `i-24-jump × i-25-cont:loopReturn`; note
`minimization(add)` in METRIC_FIXTURES scores 0, so this card's fixture is the canonical
minimization:bounded_sub). Arguably not wrong: orthogonal, isolated, off-spine; hand sketches
accept it. Implied rule: one of Q6's (a)/(b)/(c). Counterexample to (a): a whole-program loop
rerouted to the non-HALT side would drag a rail across the opposite subtree. Locus:
`lanes.js` side derivation / `halt.js` band policy / or constitution text legalizing it.
Status: `hypothesis`. Decision: **Q6**.

---

## 8. Research imports

Screened against "reusable visual grammar for URM control flow, hand-sketch readability"
(sources in the 2026-07-01 audit).

**Directly applicable**
- **Port constraints** (layered drawing with fixed-side/fixed-position ports): generate routes
  *subject to* port constraints instead of validating after; the minimum-outward-stub
  convention feeds Q2.
- **Kandinsky model** (multiple edges per side; center edge straight, others bend away): the
  ready-made shape for Q3's shared-port slotting.
- **CFG-specific layout** (VEIL 2025: dominator-based, execution-order-preserving, back edges
  as a distinct sparse family): independent validation of the whole V4 bet; execution order and
  loop/back-edge conventions are first-class, general-purpose layout misrepresents CFGs.
  Assumption to state: URM's compiler emits structured programs, so `branchPath` ownership
  plays the role dominance plays there — hand-written URM could break this.
- **Empirical aesthetics** (Purchase; Ware et al. eyetracking): crossings are the top cost,
  but specifically **crossings on the path being read**, not the global count; **path
  continuity is second and under-rated**; bends matter less than either. Feeds: a future
  skeleton-weighted defect cost (spine crossing ≫ gutter crossing) as a *constitution act* on
  R16; supports the straight-ray idiom; weighs against Q1 option B.

**Loosely inspirational**
- Topology–Shape–Metrics phase separation (take the phase purity, ignore bend-minimization);
  crossing-angle results (near-perpendicular crossings read best — informs Q6 lean (c));
  Gestalt vocabulary (continuity/proximity/common fate — the "why it looks wrong" language for
  cards); flowchart conventions (yes/no adjacent to the diamond — motivates Q4); mental-map /
  layout-stability work (→ motif-stability idea: the same macro should render near-identically
  when embedded; first test pair divides vs subst:diagonal_divides, today 0 vs 1 defects).

**Dangerous — do not import**
- **Sugiyama barycenter crossing minimization:** reorders siblings, destroying branch
  ownership, side semantics, orientation-as-meaning. The most tempting bad import.
- **Generic obstacle-avoiding pathfinding** (libavoid-style/A*): produces "edge pulled toward
  whatever space exists." Admissible only as a constrained solver *inside* a family's declared
  channel (its lane/corridor) with stub-legal endpoints — and even then a last resort behind
  closed-form family shapes.
- **Scalar aesthetic scoring** (stress/symmetry/area blends): optimizing a beauty scalar is how
  geometrically-legal-but-visually-wrong happens. The discrete rule + named-residual model is
  the project's epistemology; guard R16's `total` accordingly.
- **Force-directed layout:** no execution order, no lanes, no ports. Not even inspirational.

---

## 9. Next steps (v0.1 recommendations)

1. **Best next design/adjudication task:** decide **Q1, Q2, Q3** — the three stub-grammar
   questions. They are decisions, not code: every other port/route rule is written in the stub
   grammar's language, so its semantics must settle first. Output = status changes in §5 and an
   amended `attachmentStubs.js` *spec* (tables/roleConstraints), still `diagnostic-only`.
2. ~~Safest narrow implementation task: C3.~~ **Done (v0.2, 2026-07-01)** — shipped as R17;
   evidence on the C3 card. The regression metric is the geometric interior-clip test in
   `port_attachment_grammar_probe.mjs` (`mergeBoxClips` must stay 0). No new narrow
   implementation task is forced by current evidence; the next code change should wait for a
   Q1–Q3 adjudication.
3. ~~Best harness-only probe to add: the grammar-overlay SVG mode.~~ **Built (2026-07-01)** —
   `.flow-layout-probes/grammar_overlay_probe.mjs` → `overlays/index.html` (per-layer
   toggles) + per-fixture `*_base.svg` / `*_overlay.svg`. Layers: stub-illegal endpoint rings
   (from `sketchV4AttachmentRecords`), port-occupancy badges, label-anchor markers with
   leaders, ancestry tints (`ownerOf`), HALT band / corridor / lane strips, edge-role text
   (hidden by default). The overlay file is provably base + appended `<g>` layers, and the
   probe hash-checks its geometry against the C3 acceptance run. Remaining probe suggestion:
   the legality-trend gate (golden per-fixture counts of illegal endpoints by
   family/direction; fail on new kinds, warn on increases) — most useful **after** Q1 is
   adjudicated, since ray-terminus endpoints currently dominate the counts.

---

*Change log*
- v0.1 (2026-07-01): seeded from the visual-grammar discovery audit. R1–R16, P1–P5, Q1–Q9,
  C1–C6. No behavior changed; nothing newly enforced.
- v0.1.1 (2026-07-01): verification pass. Corrected R12's sink-X claim to match `placeHalt`
  (`max(body extent, outermost rail) + offset`, not rail-only); moved R7's literal constants
  fully into §4.3; added missing §4.3 constants (parallel-rail clearance factor / min overlap,
  `columnTolerance`); clarified P4 (corridor mechanism is construction behavior, co-row
  landing shape stays open); gave Q5 a candidate owner; C3 fixture names made exact plus
  one-owner split note. No behavior changed; nothing newly enforced.
- v0.2.1 (2026-07-01): grammar-overlay probe built (harness-only; §9.3 updated with
  location and layer list). Overlay evidence: ray-terminus endpoints (Q1) are 91 of 102
  illegal endpoints on the 8 rendered fixtures — Q1 is the adjudication bottleneck. No
  behavior change.
- v0.2 (2026-07-01): **R17 added and enforced** (merge side-entry approaches from outside) —
  the first defect card to complete the full lifecycle (observed → validated → adopted →
  enforced). C3 marked enforced with after-fix probe evidence (clips 7→0, illegal endpoints
  160→153, everything else byte-identical; one rule-correct near-graze reroute,
  divisor_count `i-274-cont`). §3 route-shape row and §9 updated. Behavior change scoped to
  `selectPorts` (footprint test → `sideEntryJogX`) and `routing.js`
  (`mergeSideJogConnector`); no other family, label, slotting, or diagnostics change.
