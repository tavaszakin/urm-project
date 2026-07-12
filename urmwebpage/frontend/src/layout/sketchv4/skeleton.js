// SketchV4 — Phase 2 role-based constant-pitch skeleton placement.
//
// Pure/deterministic. Places every node in ONE forward pass from the Phase-1 outputs
// (cfg DFS order + structural roles + held orientation). No 24-step candidate ladder,
// no route-and-reject loop, no global leftBoundary, no depth*18 lane term.
// This reproduces the validated L2 placement (routability_l2_probe.buildL2) but driven
// by the clean Phase-1 role table instead of re-deriving structure from SketchV3.
//
// Split spacing IS depth-sensitive (restored manual grammar): a diamond's branch arms
// reach outward by branchReachForDepth(depth), so the first/outer splits open wider than
// nested ones (mirrors SketchV3 getSplitDistance's 0.78^depth decay). This is a placement
// scale only — it changes WHERE branch children land, never how edges are routed/attached.
//
// Construction: replay cfg.dfsOrder (parents always precede children) and position each
// node from its single PLACING edge (cfg.incomingEdgeByNode) by that edge's role:
//   - entry-link          -> spine origin (0, ordinaryPitch)
//   - setup-link          -> straight down from parent at setupPitch (pre-decision chain)
//   - spine-continuation  -> straight down from parent at ordinaryPitch
//                            (covers ordinary continuations AND the trunk-guard survivor,
//                             which stays on the spine beneath its diamond)
//   - branch-exit         -> on the parent diamond's fixed-angle ray at a depth-scaled
//                            reach (outer splits wider than nested; see branchReachForDepth)
//
// merge-connector / loop-return / halt-exit edges never PLACE a node (their target is
// already placed, backward, or the sink), so they fall out of the replay and are
// returned as INERT placeholders for later phases (lanes/HALT/routing). No rails, no
// HALT sink, no routed edges are computed here.

const DEFAULT_ORIENTATION = { no: "left", yes: "right" };

// The two fixed exit "faces" of a diamond: quarter-width out, quarter-height down from
// its center (matches L2's LL/LR). A branch leaves from the face on its visual side.
function diamondFaces(box) {
  const LL = [(box.left + box.cx) / 2, (box.cy + box.bottom) / 2];
  const LR = [(box.cx + box.right) / 2, (box.cy + box.bottom) / 2];
  return { LL, LR };
}

// Depth-sensitive outward branch reach — restores the manual visual grammar lost when V4
// went to constant-pitch placement: the first/outer split (depth 0) opens widest, and each
// nested level is progressively more compact so it fits inside its parent's corridor. Mirrors
// SketchV3 getSplitDistance (`max(72, splitStepX * 0.78^depth)`), re-anchored to V4's
// branchRayDistance base with a modest outer boost and a compact floor. Pure geometry: only
// the diamond's split depth (cfg.depthByNode) scales the ray length; angle/route/ports unchanged.
// Reach profile (RAY=126): d0:183 d1:143 d2:111 d3:87 d4+:80 — wider at every depth than the
// first depth pass (164/128/100/78/76), restoring outer/mid breathing room while keeping the
// 0.78^depth shape. Tuned against the COLLAPSE-ON production path (the path the user inspects):
// this is the WIDEST profile that adds no new crossing on the primary fixture divisor_count
// (stays at its baseline 1) and it also reduces characteristic:divides crossings (5->4). Going
// wider hits a sharp cliff — boost>=1.5 / floor>=84 trades 3 node-overlaps for 7+ edge
// crossings on the collapsed divisor_count (see .sketchv3-harness/split_profile_collapseon_probe.mjs).
const BRANCH_RAY_DEPTH_DECAY = 0.78; // recovered SketchV3 per-depth decay factor
const BRANCH_RAY_OUTER_BOOST = 1.45; // depth-0 outward reach = 126*1.45 ≈ 183
const BRANCH_RAY_MIN = 80;           // breathing-room floor for deep nesting (SketchV3 used 72)
// decay/boost/min are overridable via pitch (defaults reproduce the restored grammar;
// a probe can pass decay=1, boost=1 to recover the old uniform ray for A/B measurement).
function branchReachForDepth(baseRay, depth, opts = {}) {
  const decay = opts.decay ?? BRANCH_RAY_DEPTH_DECAY;
  const boost = opts.boost ?? BRANCH_RAY_OUTER_BOOST;
  const min = opts.min ?? BRANCH_RAY_MIN;
  return Math.max(min, baseRay * boost * (decay ** Math.max(0, depth)));
}

export function buildSkeleton(cfg, roles, options) {
  const { orientationOf, sizeForKind, branchAngleTan, pitch } = options;
  const { setupPitch, ordinaryPitch, branchRayDistance } = pitch;
  const RAY = branchRayDistance;
  const reachOpts = { decay: pitch.branchRayDepthDecay, boost: pitch.branchRayOuterBoost, min: pitch.branchRayMin };
  const tan = branchAngleTan;

  const { nodeById, edgeById, edges, dfsOrder, incomingEdgeByNode } = cfg;
  const { nodeRoleById, edgeRoleById } = roles;

  const warnings = [];
  const placements = new Map(); // nodeId -> { cx, cy, box, kind, index, role }

  const boxAt = (cx, cy, kind) => {
    const [w, h] = sizeForKind(kind);
    return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, cx, cy, w, h };
  };
  const place = (nodeId, cx, cy) => {
    const node = nodeById.get(nodeId);
    const p = { cx, cy, box: boxAt(cx, cy, node.kind), kind: node.kind, index: node.instructionIndex, role: nodeRoleById.get(nodeId) };
    placements.set(nodeId, p);
    return p;
  };
  const sideFor = (edge) => {
    const ori = orientationOf(edge.from) ?? DEFAULT_ORIENTATION;
    return ori[edge.branch] ?? (edge.branch === "no" ? "left" : "right");
  };

  // start anchors the spine at the origin.
  place(cfg.entryNodeId, 0, 0);

  // ---- single forward placement pass ----
  for (const nodeId of dfsOrder) {
    const placingEdgeId = incomingEdgeByNode.get(nodeId);
    if (placingEdgeId === "entry") { place(nodeId, 0, ordinaryPitch); continue; }

    const edge = edgeById.get(placingEdgeId);
    const parent = edge ? placements.get(edge.from) : null;
    if (!edge || !parent) { warnings.push({ nodeId, reason: "missingPlacingEdgeOrParent", placingEdgeId }); place(nodeId, 0, ordinaryPitch); continue; }

    const role = edgeRoleById.get(placingEdgeId);
    const [, targetHeight] = sizeForKind(nodeById.get(nodeId).kind);

    if (role === "branch-exit") {
      const side = sideFor(edge);
      // Outer splits open wider than nested ones: scale the ray by the parent diamond's depth.
      const reach = branchReachForDepth(RAY, cfg.depthByNode.get(edge.from) ?? 0, reachOpts);
      const { LL, LR } = diamondFaces(parent.box);
      const face = side === "left" ? LL : LR;
      const topX = face[0] + (side === "left" ? -reach : reach);
      const topY = face[1] + reach * tan;
      place(nodeId, topX, topY + targetHeight / 2);
    } else if (role === "setup-link") {
      place(nodeId, parent.cx, parent.cy + setupPitch);
    } else if (role === "spine-continuation") {
      place(nodeId, parent.cx, parent.cy + ordinaryPitch);
    } else {
      // A placing edge should only ever be entry/branch-exit/spine-continuation/setup-link.
      warnings.push({ nodeId, reason: "unexpectedPlacingEdgeRole", role, placingEdgeId });
      place(nodeId, parent.cx, parent.cy + ordinaryPitch);
    }
  }

  // ---- branch arm segments (fresh fixed-angle rays only; merge-connectors excluded) ----
  const armSegments = [];
  for (const edge of edges) {
    if (edgeRoleById.get(edge.id) !== "branch-exit") continue;
    const parent = placements.get(edge.from);
    const target = placements.get(edge.to);
    if (!parent || !target) continue;
    const side = sideFor(edge);
    const { LL, LR } = diamondFaces(parent.box);
    const face = side === "left" ? LL : LR;
    const targetTop = [target.cx, target.box.top];
    armSegments.push({ edgeId: edge.id, srcDiamond: edge.from, targetId: edge.to, side, face, targetTop, points: [face, targetTop] });
  }

  // ---- inert placeholders for later phases (ids only; no geometry computed yet) ----
  const edgesByRole = (role) =>
    edges.filter((e) => edgeRoleById.get(e.id) === role)
      .map((e) => ({ id: e.id, from: e.from, to: e.to, branch: e.branch, sourceIndex: e.sourceIndex, targetIndex: e.targetIndex }));
  const loopReturnEdges = edgesByRole("loop-return");
  const haltExitEdges = edgesByRole("halt-exit");
  const mergeConnectorEdges = edgesByRole("merge-connector");

  // ---- bounds of placed nodes only (NO HALT sink, NO rails — those are later phases) ----
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of placements.values()) {
    minX = Math.min(minX, p.box.left); maxX = Math.max(maxX, p.box.right);
    minY = Math.min(minY, p.box.top); maxY = Math.max(maxY, p.box.bottom);
  }
  const bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };

  return {
    placements,
    armSegments,
    loopReturnEdges,
    haltExitEdges,
    mergeConnectorEdges,
    bounds,
    pitchTable: { setupPitch, ordinaryPitch, branchRayDistance },
    warnings,
  };
}
