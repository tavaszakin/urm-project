// SketchV4 — Phase 1 structural role classifier.
//
// ONE classification computed once, replacing SketchV3's three overlapping partial
// classifiers (getLocalRole / getRouteGeometryRole / classifyOrdinaryRouteEdge).
// Every node gets exactly one base node-role; every edge gets exactly one edge-role;
// re-entry tags (loop-header / merge-target) are ADDITIVE and never replace a base
// role. Geometry is NOT decided here — only structural identity.
//
// Discrimination uses a structural-position gate, not raw local CFG shape alone.
// The decisive example is the trunk-guard vs interior-guard split: both are a
// conditionalJump with one HALT arm + one forward survivor, but only a depth-0
// (on-trunk) guard is a trunk-guard. depth === branchPath.length is an invariant of
// the V4/SketchV3 walk, so the gate is `branchPath.length === 0` (see cfg.js).

// Parse the source instruction index out of a branchPath token (`i-48-no` -> 48).
function tokenSourceIndex(token) {
  const m = /^i-(\d+)-(yes|no)$/.exec(String(token));
  return m ? Number(m[1]) : null;
}

export function classifyRoles(cfg) {
  const { nodes, nodeByIndex, edges, outgoingByIndex, depthByNode, branchPathByNode, incomingEdgeByNode, setupBoundary } = cfg;

  const nodeRoleById = new Map();
  const edgeRoleById = new Map();
  const reentryTagsByNode = new Map(); // nodeId -> Set<string>
  const realForkIds = [];
  const warnings = [];

  const addTag = (nodeId, tag) => {
    let s = reentryTagsByNode.get(nodeId);
    if (!s) { s = new Set(); reentryTagsByNode.set(nodeId, s); }
    s.add(tag);
  };

  // ---- Pass 1: diamond node-roles (conditionalJump only) ----
  // real-fork  : both branches lead to ordinary forward subtrees (orientable).
  // trunk-guard: depth-0 guard, one HALT arm, survivor falls through to src+1 (spine).
  // interior-guard: same HALT-guard shape but depth >= 1 (inside an arm; keeps column).
  // loop-guard : one branch is a backward loop-return, neither is HALT.
  // mixed-guard: a HALT arm AND a loop arm (degenerate mix; not orientable).
  for (const node of nodes) {
    if (node.kind !== "conditionalJump") continue;
    const i = node.instructionIndex;
    const out = outgoingByIndex.get(i) ?? {};
    const yesE = out.yes;
    const noE = out.no;
    if (!yesE || !noE) { nodeRoleById.set(node.id, "degenerate"); warnings.push({ kind: "degenerateDiamond", nodeId: node.id }); continue; }
    const yH = yesE.isHalt, nH = noE.isHalt, yL = yesE.isLoop, nL = noE.isLoop;
    const depth = depthByNode.get(node.id) ?? 0;
    let role;
    if (!yH && !nH && !yL && !nL) {
      role = "real-fork";
    } else if ((yL || nL) && !(yH || nH)) {
      role = "loop-guard";
    } else if ((yH || nH) && !(yL || nL)) {
      const survivorFallsThrough = (nH && yesE.targetIndex === i + 1) || (yH && noE.targetIndex === i + 1);
      role = (depth === 0 && survivorFallsThrough) ? "trunk-guard" : "interior-guard";
    } else {
      role = "mixed-guard";
      warnings.push({ kind: "mixedGuard", nodeId: node.id, detail: "diamond has both a HALT arm and a loop arm" });
    }
    nodeRoleById.set(node.id, role);
    if (role === "real-fork") realForkIds.push(node.id);
  }

  // ---- Pass 2: non-diamond positional node-roles ----
  // trunkDepth = number of branchPath tokens whose source diamond is NOT a trunk-guard
  // (i.e. real-fork / interior-guard / loop-guard decisions). trunkDepth === 0 means the
  // node sits on the main spine (only trunk-guard survivors above it) => trunk-member;
  // otherwise it lives inside a fork/guard arm => subtree-member. This is the structural
  // reading of the spec's "depth-0 survivor": a trunk-guard survivor keeps a branchPath
  // token (raw depth >= 1) yet remains on the trunk.
  const trunkDepthOf = (nodeId) => {
    const bp = branchPathByNode.get(nodeId) ?? [];
    let d = 0;
    for (const token of bp) {
      const srcIdx = tokenSourceIndex(token);
      const srcRole = srcIdx == null ? null : nodeRoleById.get(`i-${srcIdx}`);
      if (srcRole !== "trunk-guard") d += 1;
    }
    return d;
  };

  for (const node of nodes) {
    if (node.kind === "start") { nodeRoleById.set(node.id, "start"); continue; }
    if (node.kind === "halt") { nodeRoleById.set(node.id, "shared-sink"); continue; }
    if (node.kind === "conditionalJump") continue; // already classified
    // action or unconditionalJump
    const i = node.instructionIndex;
    let role;
    if (i < setupBoundary) role = "setup-node";
    else if (trunkDepthOf(node.id) === 0) role = "trunk-member";
    else role = "subtree-member";
    nodeRoleById.set(node.id, role);
  }

  // ---- Edge roles ----
  // Priority: entry > halt-exit (target is the sink) > loop-return (backward) >
  // merge-connector (forward to an already-placed node) > spine-continuation /
  // branch-exit / setup-link (tree edges that placed their target).
  const isSurvivorOfTrunkGuard = (edge) => {
    if (!edge.branch) return false;
    if (nodeRoleById.get(edge.from) !== "trunk-guard") return false;
    return !edge.isHalt; // the survivor is the non-HALT arm of the guard
  };

  for (const edge of edges) {
    let role;
    if (edge.id === "entry") {
      role = "entry-link";
    } else if (edge.isHalt) {
      role = "halt-exit"; // only edges into the terminal sink; an edge to the last *instruction* is NOT halt
    } else if (edge.isLoop) {
      role = "loop-return"; // backward edge (target <= source), never a forward merge
    } else if (incomingEdgeByNode.get(edge.to) !== edge.id) {
      role = "merge-connector"; // forward re-entry: target was placed by a different (earlier) edge
    } else if (edge.branch) {
      role = isSurvivorOfTrunkGuard(edge) ? "spine-continuation" : "branch-exit";
    } else if (
      edge.sourceIndex != null &&
      edge.sourceIndex < setupBoundary &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex < setupBoundary
    ) {
      role = "setup-link";
    } else {
      role = "spine-continuation";
    }
    edgeRoleById.set(edge.id, role);

    // ---- Additive re-entry tags (decorate the TARGET; never replace its base role) ----
    if (role === "loop-return") addTag(edge.to, "loop-header");
    if (role === "merge-connector") addTag(edge.to, "merge-target");
  }

  return {
    nodeRoleById,
    edgeRoleById,
    reentryTagsByNode,
    realForkIds,
    realForkSet: new Set(realForkIds),
    warnings,
  };
}
