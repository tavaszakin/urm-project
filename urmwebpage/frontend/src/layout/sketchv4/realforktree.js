// SketchV4 — Phase 1 real-fork tree.
//
// Orientation variables exist ONLY for real-forks, and the orientation assignment is
// a tree-global bottom-up DP over them (a later phase). This module builds that tree
// structure now, purely from branchPath ancestry:
//
//   rfParent(f)   -> the deepest real-fork whose branchPath is a strict prefix of f's
//   rfChildren(f) -> inverse of rfParent
//   rfRoots       -> real-forks with no real-fork ancestor
//   rfDepth(f)    -> raw branchPath length (== walk depth)
//   bottomUp      -> real-forks ordered deepest-first (DP summarize order)
//   lcaRF(a, b)   -> lowest common real-fork ancestor in this tree, or null
//
// Guard diamonds (trunk/interior/loop) are NOT nodes of this tree: they carry no
// orientation bit, so a real-fork's parent skips over any intervening guards.

function startsWith(path, prefix) {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}

export function buildRealForkTree(cfg, roles) {
  const { branchPathByNode } = cfg;
  const { realForkIds } = roles;

  const rfDepth = new Map();
  for (const f of realForkIds) rfDepth.set(f, (branchPathByNode.get(f) ?? []).length);

  // Parent = real-fork with the longest branchPath that is a strict prefix of f's.
  const rfParent = new Map();
  for (const f of realForkIds) {
    const fbp = branchPathByNode.get(f) ?? [];
    let parent = null;
    let bestLen = -1;
    for (const g of realForkIds) {
      if (g === f) continue;
      const gbp = branchPathByNode.get(g) ?? [];
      if (gbp.length < fbp.length && startsWith(fbp, gbp) && gbp.length > bestLen) {
        bestLen = gbp.length;
        parent = g;
      }
    }
    rfParent.set(f, parent);
  }

  const rfChildren = new Map(realForkIds.map((f) => [f, []]));
  const rfRoots = [];
  for (const f of realForkIds) {
    const p = rfParent.get(f);
    if (p) rfChildren.get(p).push(f); else rfRoots.push(f);
  }

  const bottomUp = [...realForkIds].sort((a, b) => (rfDepth.get(b) - rfDepth.get(a)) || (a < b ? -1 : 1));

  const ancestorsOf = (f) => {
    const chain = [];
    let cur = f;
    const seen = new Set();
    while (cur && !seen.has(cur)) { chain.push(cur); seen.add(cur); cur = rfParent.get(cur) ?? null; }
    return chain;
  };

  // Lowest common real-fork ancestor (includes the nodes themselves). Returns null when
  // the two live in disjoint real-fork subtrees (their crossing is not orientation-owned).
  const lcaRF = (a, b) => {
    if (!a || !b) return null;
    if (a === b) return a;
    const aChain = new Set(ancestorsOf(a));
    for (const g of ancestorsOf(b)) if (aChain.has(g)) return g;
    return null;
  };

  const rfTree = realForkIds.map((f) => ({
    id: f,
    depth: rfDepth.get(f),
    parent: rfParent.get(f) ?? null,
    children: rfChildren.get(f),
  }));

  return { rfTree, rfParent, rfChildren, rfRoots, rfDepth, bottomUp, lcaRF };
}
