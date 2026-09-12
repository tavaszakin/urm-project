// SketchV4 Layer C — same-side continuation reentry.
//
// A continuation can converge beside an explicit-jump merge into the same already-placed
// target. In that structural case the continuation owns a genuine right/right attachment:
// leave the source at right-centre, travel outward to one clearance column beyond both
// boxes, descend there, and approach the target horizontally at right-centre.
//
// The selector is deliberately semantic/structural. It contains no fixture, edge-ID,
// instruction-index, terminal-identity, or frozen-coordinate checks.

const rightCenter = (box) => [box.right, box.cy];

function structuralCandidates(cfg, roles, boxes) {
  const candidates = [];
  for (const edge of cfg.edges) {
    const sourceNode = cfg.nodeById.get(edge.from);
    const targetNode = cfg.nodeById.get(edge.to);
    const sourceBox = boxes.get(edge.from);
    const targetBox = boxes.get(edge.to);
    if (roles.edgeRoleById.get(edge.id) !== "merge-connector"
      || edge.branch != null
      || sourceNode?.kind !== "action"
      || targetNode?.kind !== "action"
      || !sourceBox
      || !targetBox) {
      continue;
    }

    const explicitMergeSibling = cfg.edges.find((sibling) => (
      sibling.id !== edge.id
      && sibling.to === edge.to
      && roles.edgeRoleById.get(sibling.id) === "merge-connector"
      && cfg.nodeById.get(sibling.from)?.kind === "unconditionalJump"
    ));
    if (explicitMergeSibling) candidates.push({ edge, sourceBox, targetBox, explicitMergeSibling });
  }
  return candidates;
}

export function applySameSideContinuationReentries(cfg, roles, routed, boxes, { clearance = 16 } = {}) {
  const routeById = new Map(routed.routes.map((route) => [route.edgeId, route]));
  const ports = new Map(routed.ports);
  const records = [];

  for (const { edge, sourceBox, targetBox, explicitMergeSibling } of structuralCandidates(
    cfg,
    roles,
    boxes,
  )) {
    const baselineRoute = routeById.get(edge.id);
    const baselinePort = ports.get(edge.id);
    if (!baselineRoute || !baselinePort) continue;

    const sourcePort = rightCenter(sourceBox);
    const targetPort = rightCenter(targetBox);
    const corridorX = Math.max(sourceBox.right, targetBox.right) + clearance;
    const points = [
      sourcePort,
      [corridorX, sourcePort[1]],
      [corridorX, targetPort[1]],
      targetPort,
    ];
    const route = {
      ...baselineRoute,
      sourcePort,
      targetPort,
      points,
      connectorKind: "sideEntryJog",
    };
    routeById.set(edge.id, route);
    ports.set(edge.id, {
      ...baselinePort,
      sourcePort,
      targetPort,
      sideEntryJogX: corridorX,
      experimentalRightToRightHvh: true,
    });
    records.push({
      edgeId: edge.id,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      connectorKind: route.connectorKind,
      routeShape: "right port -> H -> V -> H -> right port",
      corridorRule: "max(sourceBox.right, targetBox.right) + existing V4 clearance",
      clearance,
      corridorX,
      explicitMergeSiblingEdgeId: explicitMergeSibling.id,
      oldSourcePort: [...baselineRoute.sourcePort],
      newSourcePort: sourcePort,
      oldTargetPort: [...baselineRoute.targetPort],
      newTargetPort: targetPort,
      oldRoutePoints: baselineRoute.points.map((point) => [...point]),
      newRoutePoints: points,
    });
  }

  return {
    routed: {
      ...routed,
      routes: routed.routes.map((route) => routeById.get(route.edgeId)),
      ports,
    },
    records,
    eligibleEdgeIds: records.map((record) => record.edgeId),
    contract: {
      selector: "action fallthrough merge sharing an already-placed target with an explicit-jump merge",
      routeShape: "right port -> H -> V -> H -> right port",
      corridorRule: "max(sourceBox.right, targetBox.right) + existing V4 clearance",
      fixtureIdentityUsed: false,
      edgeIdentityUsed: false,
      instructionIndexUsed: false,
      terminalIdentityUsed: false,
      frozenCoordinatesUsed: false,
      routeFamilyChanged: false,
      automaticRepairAfterConstruction: false,
      obstacleSearchUsed: false,
    },
  };
}
