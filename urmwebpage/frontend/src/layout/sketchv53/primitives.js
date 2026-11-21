// Explicit research primitive. The automatic scheduler does not select a fresh
// lateral placement: choosing it instead of a V5 diagonal needs a separate rule.
export function proposeHorizontalExtension(state, { edge, node, role, orientation,
  side, gap = 126, visual = {} }) {
  const source = state.placements.get(edge.from);
  const direction = side ?? (source.kind === "conditionalJump" ? source.branchOrientation[edge.branch] : null);
  if (!["left", "right"].includes(direction) || !Number.isFinite(gap) || gap <= 0) {
    throw new Error("Horizontal extension needs an explicit side and positive gap");
  }
  const sizeForKind = visual.sizeForKind ?? ((kind) => kind === "conditionalJump" ? [82, 46] : [88, 30]);
  const [w, h] = sizeForKind(node.kind), sign = direction === "left" ? -1 : 1;
  const sourcePort = [direction === "left" ? source.box.left : source.box.right, source.cy];
  const targetPort = [sourcePort[0] + sign * gap, source.cy];
  const cx = targetPort[0] + sign * w / 2, cy = source.cy;
  const placement = { cx, cy, kind: node.kind, index: node.instructionIndex, role,
    ...(node.kind === "conditionalJump" ? { branchOrientation: orientation ?? { no: "left", yes: "right" } } : {}),
    box: { cx, cy, w, h, left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 } };
  const route = { edgeId: edge.id, source: edge.from, target: edge.to,
    edgeRole: edge.branch ? "branch-exit" : "spine-continuation", routeFamily: edge.branch ? "branch-exit" : "spine",
    ...(edge.branch ? { branch: edge.branch, branchSide: source.branchOrientation[edge.branch] } : {}),
    connectorKind: "horizontal-extension", portPolicyCase: "v51-horizontal-extension",
    attachmentDirection: direction, sourcePort, targetPort, points: [sourcePort, targetPort] };
  return { nodeId: node.id, placement, placingEdgeId: edge.id, route,
    portSelection: { sourcePort, targetPort, changed: false, portPolicyCase: route.portPolicyCase } };
}

// One atomic bottom→top stroke and a fresh child on the source column. The
// logical branch and its held side remain independent of the actual port.
export function proposeBottomExtension(state, { edge, node, role, orientation,
  depth = 0, resumed = false, visual = {} }) {
  const source = state.placements.get(edge.from);
  const sizeForKind = visual.sizeForKind ?? ((kind) => kind === "conditionalJump" ? [82, 46] : [88, 30]);
  const [w, h] = sizeForKind(node.kind);
  const cx = source.cx, cy = source.cy + (visual.pitch?.ordinaryPitch ?? 82);
  const placement = { cx, cy, kind: node.kind, index: node.instructionIndex, role,
    ...(node.kind === "conditionalJump" ? { branchOrientation: orientation ?? { no: "left", yes: "right" } } : {}),
    box: { cx, cy, w, h, left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 } };
  const sourcePort = [source.cx, source.box.bottom], targetPort = [cx, placement.box.top];
  const route = { edgeId: edge.id, source: edge.from, target: edge.to,
    edgeRole: "branch-exit", routeFamily: "branch-exit", branch: edge.branch,
    branchSide: source.branchOrientation?.[edge.branch], branchDepth: depth, branchResumed: resumed,
    connectorKind: "bottom-extension", portPolicyCase: "v51-bottom-extension",
    experimentalExtension: "fresh-bottom", attachmentDirection: "down",
    sourcePort, targetPort, points: [sourcePort, targetPort] };
  return { nodeId: node.id, placement, placingEdgeId: edge.id, route,
    portSelection: { sourcePort, targetPort, changed: false, portPolicyCase: route.portPolicyCase } };
}
