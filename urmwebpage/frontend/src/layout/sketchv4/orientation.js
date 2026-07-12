// SketchV4 — Phase 5 orientation assignment (corrected, L3-validated model).
//
// ONE bit per REAL-FORK. trunk-guards, interior-guards, loop-guards and HALT-only arms are
// NOT orientable (role/routeFamily-determined; held fixed by the caller). Traversal and
// ownership are fixed; orientation only maps each real-fork's two owned arms to visual
// left/right. visualSide = ownership × orientation.
//
// Assignment = tree-global bottom-up DP:
//   - objective = TOTAL realized layout defects (node overlaps + crossings), NOT
//     branch-vs-branch-only (L3 refuted bvb-only: bvb = 0 under every orientation in V4
//     geometry, so it gives zero signal);
//   - strict-improvement gate: flip a fork iff it STRICTLY reduces total defects — this is
//     the anti-thrash mechanism (a routeFamily residual that no flip fixes, e.g. eq, is
//     left alone), NOT a narrowed objective;
//   - default tie-break: prefer no-left / yes-right.
// Manual pins are hard constraints. Global search is demoted to a RARE diagnostic repair.
//
// orientation.js owns the DP only; the caller injects `evaluate(realForkMap) -> { total }`,
// which realizes the candidate through skeleton->lanes->halt->routing and scores it via
// defects.js. (Realized-candidate evaluation; the lightweight structural predictor stays
// deferred.)

const DEFAULT = { no: "left", yes: "right" };
const FLIPPED = { no: "right", yes: "left" };
const bitName = (o) => (o && o.no === "right" ? "flipped" : "default");

export function assignOrientation({ realForks, bottomUp, rfParent, rfChildren, evaluate, pins }) {
  const pinMap = pins ?? new Map();
  const parentOf = (f) => (rfParent && rfParent.get(f)) ?? null;
  const childrenOf = (f) => (rfChildren && rfChildren.get(f)) ?? [];

  // current assignment (mutated as the DP descends bottom-up; deeper forks already decided)
  const map = new Map(realForks.map((f) => [f, pinMap.has(f) ? { ...pinMap.get(f) } : { ...DEFAULT }]));
  const rows = [];

  for (const f of bottomUp) {
    if (pinMap.has(f)) {
      rows.push({ realForkId: f, defaultBit: "default", v4AssignedBit: bitName(pinMap.get(f)), isPinned: true, costDefault: null, costFlipped: null, chosenCost: evaluate(map).total, tieBreakReason: "pinned (hard constraint)", strictImprovement: false, parentRealFork: parentOf(f), childRealForks: childrenOf(f) });
      continue;
    }
    map.set(f, { ...DEFAULT });
    const costDefault = evaluate(map).total;
    map.set(f, { ...FLIPPED });
    const costFlipped = evaluate(map).total;

    let chosen, strict, why;
    if (costFlipped < costDefault) { map.set(f, { ...FLIPPED }); chosen = "flipped"; strict = true; why = "flip strictly reduces total defects"; }
    else { map.set(f, { ...DEFAULT }); chosen = "default"; strict = false; why = costFlipped === costDefault ? "tie -> default" : "default strictly better"; }

    rows.push({ realForkId: f, defaultBit: "default", v4AssignedBit: chosen, isPinned: false, costDefault, costFlipped, chosenCost: Math.min(costDefault, costFlipped), tieBreakReason: why, strictImprovement: strict, parentRealFork: parentOf(f), childRealForks: childrenOf(f) });
  }

  // ---- rare repair (DIAGNOSTIC ONLY): a single extra flip on top of the DP result that
  // would strictly reduce total defects (catches greedy bottom-up misses where flips
  // interact). Not applied as core behavior. ----
  const finalTotal = evaluate(map).total;
  const rareRepairCandidates = [];
  for (const f of bottomUp) {
    if (pinMap.has(f)) continue;
    const cur = map.get(f);
    const alt = cur.no === "left" ? { ...FLIPPED } : { ...DEFAULT };
    map.set(f, alt);
    const t = evaluate(map).total;
    if (t < finalTotal) rareRepairCandidates.push({ realForkId: f, from: bitName(cur), to: bitName(alt), baseTotal: finalTotal, repairedTotal: t });
    map.set(f, cur);
  }

  return { orientationMap: map, rows, finalTotal, rareRepairCandidates };
}
