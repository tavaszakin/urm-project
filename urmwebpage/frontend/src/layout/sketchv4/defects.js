// SketchV4 — Phase 5 defect evaluator.
//
// Pure/deterministic. Evaluates a REALIZED V4 layout (routes + node boxes) and classifies
// every defect. Shared by orientation.js (as the cost oracle over candidate orientations)
// and, later, by the diagnostics report layer. It NEVER mutates layout — the only
// sanctioned defect->layout path is orientation deliberately calling this as its objective.
//
// total = nodeOverlapCount + crossingCount  (the two primary defect classes; this matches
// the L3 objective). Each crossing is classified by routeFamily and, for branch-vs-branch,
// by lowest-common real-fork ancestor so the orientation pass can tell which defects a
// real-fork flip could address vs. which are routeFamily/route-shape (and must be left).

function orient2(a, b, c) { return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]); }
function properCross(a, b, c, d) { const o1 = orient2(a, b, c), o2 = orient2(a, b, d), o3 = orient2(c, d, a), o4 = orient2(c, d, b); return o1 * o2 < -1e-3 && o3 * o4 < -1e-3; }
function collinearOverlap(a, b, c, d) { if (Math.abs(orient2(a, b, c)) > 1e-2 || Math.abs(orient2(a, b, d)) > 1e-2) return false; const hz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]); const lo1 = Math.min(hz ? a[0] : a[1], hz ? b[0] : b[1]), hi1 = Math.max(hz ? a[0] : a[1], hz ? b[0] : b[1]); const lo2 = Math.min(hz ? c[0] : c[1], hz ? d[0] : d[1]), hi2 = Math.max(hz ? c[0] : c[1], hz ? d[0] : d[1]); return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 1.0; }
function segs(p) { const o = []; for (let i = 1; i < p.length; i++) o.push([p[i - 1], p[i]]); return o; }

const SPINE_FAMILIES = new Set(["entry", "setup", "spine"]);

// A crossing's family + whether a real-fork flip could address it.
function classifyCrossing(A, B, context) {
  const fa = A.routeFamily, fb = B.routeFamily;
  if (fa === "loop-return" || fb === "loop-return") return { crossingKind: "loop-rail", assignedTo: "loopReturn", orientationAddressable: false };
  if (fa === "halt" || fb === "halt") return { crossingKind: "halt", assignedTo: "routeFamily", orientationAddressable: false };
  if (fa === "merge-connector" || fb === "merge-connector") return { crossingKind: "merge", assignedTo: "connectorShape", orientationAddressable: false };
  if (fa === "branch-exit" && fb === "branch-exit") {
    const lca = context.lcaRF ? context.lcaRF(A.source, B.source) : null;
    const orientable = lca != null && (!context.realForkSet || context.realForkSet.has(lca));
    return { crossingKind: "branch-vs-branch", assignedTo: orientable ? "orientation" : "placement", orientationAddressable: orientable, LCARealFork: lca };
  }
  if (SPINE_FAMILIES.has(fa) || SPINE_FAMILIES.has(fb)) return { crossingKind: "spine", assignedTo: "routing", orientationAddressable: false };
  return { crossingKind: "other", assignedTo: "unknown", orientationAddressable: false };
}

export function evaluateDefects(layout, context = {}, options = {}) {
  const { routes, boxes } = layout; // boxes: Map<id, box> including the HALT sink
  const clearance = options.clearance ?? 16;
  const tag = `${options.program ?? ""}|${options.orientationSource ?? ""}`;
  const defects = [];
  let n = 0;
  const newId = () => `${tag}#${n++}`;

  // ---- node overlaps + placement clearance ----
  const boxList = [...boxes.entries()];
  let nodeOverlapCount = 0, placementClearanceFailureCount = 0;
  for (let i = 0; i < boxList.length; i++) for (let j = i + 1; j < boxList.length; j++) {
    const [ia, A] = boxList[i], [ib, B] = boxList[j];
    const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
    const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (ox > -clearance && oy > -clearance) {
      placementClearanceFailureCount++;
      if (ox > 1 && oy > 1) {
        nodeOverlapCount++;
        // A node overlap under a bad orientation IS what a real-fork flip separates (the L3
        // finding for divides) — so it is orientation-addressable in principle; the DP's
        // strict-improvement gate is the actual arbiter (wouldFlipHelp set by orientation.js).
        defects.push({ defectId: newId(), defectKind: "node-overlap", nodeA: ia, nodeB: ib, crossingKind: null, edgeA: null, edgeB: null, assignedTo: "placement", orientationAddressable: true, wouldFlipHelp: null, LCARealFork: null, notes: "box overlap; orientation flips can separate arms" });
      }
    }
  }

  // ---- crossings + edge overlaps ----
  const E = routes.filter((e) => Array.isArray(e.points) && e.points.length >= 2);
  let crossingCount = 0, edgeOverlapCount = 0, branchVsBranchCrossingCount = 0;
  let routeFamilyConflictCount = 0, laneBundleConflictCount = 0, excludedDiamondInBranchCrossingCount = 0;
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const A = E[i], B = E[j];
    const shared = (A.source === B.source || A.source === B.target || A.target === B.source || A.target === B.target);
    let xc = false, oc = false;
    for (const [a, b] of segs(A.points)) for (const [c, d] of segs(B.points)) {
      if (properCross(a, b, c, d)) { if (!shared) xc = true; }
      else if (collinearOverlap(a, b, c, d)) { if (!shared) oc = true; }
    }
    if (xc) {
      crossingCount++;
      const cls = classifyCrossing(A, B, context);
      if (cls.crossingKind === "branch-vs-branch") { branchVsBranchCrossingCount++; if (!cls.orientationAddressable) excludedDiamondInBranchCrossingCount++; }
      if (cls.crossingKind === "loop-rail" || cls.crossingKind === "halt") routeFamilyConflictCount++;
      if (cls.crossingKind === "loop-rail") laneBundleConflictCount++;
      defects.push({ defectId: newId(), defectKind: "crossing", crossingKind: cls.crossingKind, edgeA: A.edgeId, edgeB: B.edgeId, nodeA: null, nodeB: null, assignedTo: cls.assignedTo, orientationAddressable: cls.orientationAddressable, wouldFlipHelp: cls.orientationAddressable ? null : false, LCARealFork: cls.LCARealFork ?? null, notes: cls.crossingKind === "branch-vs-branch" ? "branch arms; LCA real-fork owns it" : "route-shape / routeFamily; not orientation-addressable" });
    }
    if (oc) edgeOverlapCount++;
  }

  const total = nodeOverlapCount + crossingCount;
  return {
    total,
    nodeOverlapCount, edgeOverlapCount, crossingCount, placementClearanceFailureCount,
    routeFamilyConflictCount, laneBundleConflictCount, branchVsBranchCrossingCount, excludedDiamondInBranchCrossingCount,
    defects,
  };
}
