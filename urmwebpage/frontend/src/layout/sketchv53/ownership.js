// SketchV4 — Phase 1 ownership / branch-path table.
//
// branchPath is intrinsic to the cfg DFS (computed once there, in cfg.js); this
// module is its PUBLIC interface and adds the derived ownership helpers later phases
// need (orientation, lane bundles). All derived, all pure:
//
//   branchPath(nodeId)      -> array of branch-edge tokens (`i-48-no`, ...)
//   ownerOf(nodeId)         -> { fork, side } of the deepest enclosing real-fork, or null
//   whichArm(nodeId)        -> same as ownerOf (named for the lane phase)
//   nca(a, b)               -> nearest-common-ancestor branch-path prefix (longest common prefix)
//   subtreeExtent(prefix)   -> { nodeIds } whose branchPath starts with the given prefix
//
// ownerOf keys off the structural ROLE (real-fork) rather than every diamond, so
// guard decisions (trunk/interior/loop) on the way down do not count as owners.

function parseToken(token) {
  const m = /^i-(\d+)-(yes|no)$/.exec(String(token));
  return m ? { forkId: `i-${m[1]}`, side: m[2] } : null;
}

function commonPrefix(a, b) {
  const out = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) out.push(a[i]); else break;
  }
  return out;
}

function startsWith(path, prefix) {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}

export function computeOwnership(cfg, roles) {
  const { branchPathByNode } = cfg;
  const { realForkSet } = roles;

  const branchPath = (nodeId) => branchPathByNode.get(nodeId) ?? [];

  // Deepest real-fork decision in the path = the subtree this node belongs to.
  const ownerOf = (nodeId) => {
    const bp = branchPath(nodeId);
    for (let i = bp.length - 1; i >= 0; i--) {
      const parsed = parseToken(bp[i]);
      if (parsed && realForkSet.has(parsed.forkId)) {
        return { fork: parsed.forkId, side: parsed.side, depthInPath: i };
      }
    }
    return null; // on the trunk, owned by no real-fork
  };

  const whichArm = ownerOf;

  const nca = (a, b) => commonPrefix(branchPath(a), branchPath(b));

  // All placed instruction nodes whose branchPath starts with `prefix`. This is the
  // local subtree used later for LOCAL lane anchoring (never a global diagram bound).
  const subtreeExtent = (prefix) => {
    const nodeIds = [];
    for (const [nodeId, bp] of branchPathByNode) {
      if (startsWith(bp, prefix)) nodeIds.push(nodeId);
    }
    return { prefix: prefix.slice(), nodeIds };
  };

  return { branchPath, ownerOf, whichArm, nca, subtreeExtent };
}
