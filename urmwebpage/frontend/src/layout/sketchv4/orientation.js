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
//   - primary score remains total defects (node overlaps + crossing pairs);
//   - on a primary tie, compare focus-owned node-edge intrusions lazily;
//   - stop at a zero default count; flipped must strictly improve the secondary count;
//   - default tie-break: prefer no-left / yes-right.
// Manual pins are hard constraints. Global search is demoted to a RARE diagnostic repair.
//
// orientation.js owns the DP only; the caller injects `evaluate(realForkMap) -> { total }`,
// which realizes the candidate through the production pipeline and scores it via
// defects.js. The production oracle also supplies evaluateOwnedIntrusions() over that
// same candidate. Historical primary-only harness oracles may omit this optional method.

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
    const defaultEvaluation = evaluate(map, f);
    const costDefault = defaultEvaluation.total;
    map.set(f, { ...FLIPPED });
    const flippedEvaluation = evaluate(map, f);
    const costFlipped = flippedEvaluation.total;
    const primaryTie = costDefault === costFlipped;
    let ownedDefault = null, ownedFlipped = null;
    if (primaryTie) {
      ownedDefault = defaultEvaluation.evaluateOwnedIntrusions?.() ?? 0;
      if (ownedDefault > 0) {
        ownedFlipped = flippedEvaluation.evaluateOwnedIntrusions?.() ?? 0;
      }
    }
    const secondaryImprovement = ownedFlipped !== null && ownedFlipped < ownedDefault;

    let chosen, strict, why;
    if (costFlipped < costDefault || secondaryImprovement) { map.set(f, { ...FLIPPED }); chosen = "flipped"; strict = true; why = secondaryImprovement ? "primary tie -> fewer owned intrusions" : "flip strictly reduces total defects"; }
    else { map.set(f, { ...DEFAULT }); chosen = "default"; strict = false; why = primaryTie && ownedDefault === 0 ? "primary tie -> default owned count is zero" : primaryTie && ownedFlipped > ownedDefault ? "primary tie -> default has fewer owned intrusions" : primaryTie ? "tie -> default" : "default strictly better"; }

    rows.push({ realForkId: f, defaultBit: "default", v4AssignedBit: chosen, isPinned: false, costDefault, costFlipped, chosenCost: Math.min(costDefault, costFlipped), tieBreakReason: why, strictImprovement: strict, parentRealFork: parentOf(f), childRealForks: childrenOf(f), ownedDefault, ownedFlipped });
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
