// SketchV4 — Phase 3 loop-return lane bundles with LOCAL anchors.
//
// Pure/deterministic. Implements the validated lane model:
//
//   laneBundle = nestingGroup × side × routeFamily
//   laneAnchor = the nestingGroup's LOCAL extent (min-left / max-right of the loop's
//                NCA-ownerSubtree on the Phase-2 placement) — NOT a global diagram bound
//   laneIndex  = span/nesting order within the bundle (inner span -> inner rail)
//   laneOffset = baseGutter + laneIndex * laneStep   (NO depth*18 term)
//   railCoord  = laneAnchor ∓ laneOffset
//
// nestingGroup = same-side loop returns whose local anchor coincides (anchor-neighborhood
// bucketing). Nested same-side loops share one bundle (their anchors coincide); sibling-
// disjoint subtrees resolve to different local anchors -> different bundles. A bucket that
// would couple unrelated (disjoint, non-nesting) spans is SURFACED via
// sharesBundleWithRelatedOnly=false and interleavingConflict, never hidden.
//
// Only the LOOP SIDE is newly derived here (Phase 2 reused SketchV3's recorded side):
// side = visual side of the branch token that enters the loop body from its header,
// under the HELD orientation. This reproduces SketchV3's side when orientation is held.

const BASE_GUTTER = 40;
const LANE_STEP = 44;

function parseToken(token) {
  const m = /^i-(\d+)-(yes|no)$/.exec(String(token));
  return m ? { forkId: `i-${m[1]}`, branch: m[2] } : null;
}
function startsWith(path, prefix) {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}
function visualSide(token, orientationOf) {
  const p = parseToken(token);
  if (!p) return null;
  const o = orientationOf(p.forkId);
  return (o && o[p.branch]) ?? (p.branch === "no" ? "left" : "right");
}

export function computeLanes(cfg, roles, ownership, skeleton, options) {
  const { orientationOf, baseGutter = BASE_GUTTER, laneStep = LANE_STEP, round = Math.round } = options;
  const placements = skeleton.placements;
  const warnings = [];

  // ---- collect loop-return edges with local-anchor inputs ----
  const loops = [];
  for (const edge of cfg.edges) {
    if (roles.edgeRoleById.get(edge.id) !== "loop-return") continue;
    const source = edge.from, target = edge.to;
    const sBP = ownership.branchPath(source), tBP = ownership.branchPath(target);
    const ownerA = ownership.nca(source, target); // longest common prefix = NCA-ownerSubtree

    // loop side under the held orientation
    let side;
    if (startsWith(sBP, tBP)) {
      const entryToken = sBP[tBP.length]; // branch INTO the loop body from its header
      side = (entryToken && visualSide(entryToken, orientationOf))
        || (tBP.length ? visualSide(tBP[tBP.length - 1], orientationOf) : null)
        || "left";
    } else {
      side = (sBP.length ? visualSide(sBP[sBP.length - 1], orientationOf) : null) || "left";
      warnings.push({ edgeId: edge.id, reason: "loopTargetNotAncestor", note: "side derived from source's deepest token" });
    }

    // LOCAL anchor = extent of the owner subtree on the Phase-2 placement
    let anchor = side === "left" ? Infinity : -Infinity;
    for (const id of ownership.subtreeExtent(ownerA).nodeIds) {
      const p = placements.get(id);
      if (!p) continue;
      anchor = side === "left" ? Math.min(anchor, p.box.left) : Math.max(anchor, p.box.right);
    }

    // own-body extent over the loop's index span
    const lo = Math.min(edge.sourceIndex, edge.targetIndex), hi = Math.max(edge.sourceIndex, edge.targetIndex);
    let bodyL = Infinity, bodyR = -Infinity;
    for (const p of placements.values()) {
      if (p.index != null && p.index >= lo && p.index <= hi) { bodyL = Math.min(bodyL, p.box.left); bodyR = Math.max(bodyR, p.box.right); }
    }

    loops.push({ edge, source, target, sIdx: edge.sourceIndex, tIdx: edge.targetIndex, lo, hi, span: hi - lo, side, routeFamily: "loop-return", ownerA, anchor, bodyL, bodyR });
  }

  // ---- nestingGroup buckets: same side + same rounded local anchor ----
  const buckets = new Map();
  for (const L of loops) {
    const nestingGroupId = `${L.side}@${round(L.anchor)}`;
    (buckets.get(nestingGroupId) ?? buckets.set(nestingGroupId, []).get(nestingGroupId)).push(L);
  }

  const nests = (a, b) => (a.lo >= b.lo && a.hi <= b.hi) || (b.lo >= a.lo && b.hi <= a.hi);
  const overlaps = (a, b) => Math.max(a.lo, b.lo) <= Math.min(a.hi, b.hi);

  const laneRecords = [];
  let interleavingConflictCount = 0;
  for (const [nestingGroupId, members] of buckets) {
    const side = members[0].side, anchor = members[0].anchor;
    // count true interleavings (overlap but neither nests) once per pair in this bucket
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      if (overlaps(members[i], members[j]) && !nests(members[i], members[j])) interleavingConflictCount++;
    }
    const ordered = [...members].sort((a, b) => a.span - b.span || a.lo - b.lo); // inner span -> inner rail
    ordered.forEach((L, laneIndex) => {
      const laneOffset = baseGutter + laneIndex * laneStep;
      const rail = side === "left" ? anchor - laneOffset : anchor + laneOffset;
      const width = side === "left" ? L.bodyL - rail : rail - L.bodyR;
      let interleaving = false, relatedOnly = true;
      for (const M of ordered) {
        if (M === L) continue;
        if (overlaps(L, M) && !nests(L, M)) interleaving = true;
        if (!overlaps(L, M) && !nests(L, M)) relatedOnly = false; // disjoint sibling sharing a bucket
      }
      laneRecords.push({
        edgeId: L.edge.id, source: L.source, target: L.target, sourceIndex: L.sIdx, targetIndex: L.tIdx,
        span: L.span, side, routeFamily: L.routeFamily, nestingGroupId, laneBundleId: `${L.routeFamily}|${nestingGroupId}`,
        laneAnchor: round(anchor), laneIndex, laneOffset, railCoord: round(rail),
        bodyLeft: round(L.bodyL), bodyRight: round(L.bodyR), widthBeyondOwnBody: round(width),
        sharesBundleWithRelatedOnly: relatedOnly, interleavingConflict: interleaving,
      });
    });
  }

  return { laneRecords, bundleCount: buckets.size, interleavingConflictCount, loopCount: loops.length, warnings };
}
