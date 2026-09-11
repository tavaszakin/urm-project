// SketchV4 Layer B — semantic branch departures for conditional merge-connectors.
//
// A conditional branch that rejoins an already-placed node is still a semantic YES/NO
// branch at its source. Preserve that branch doorway and fixed exit angle, then route V/H
// into the target port already selected by ports.js. The full sibling ray is retained when
// it leaves one clearance unit before the nearest relevant node boundary. When crowded, the
// ray's horizontal run is shortened to the midpoint of the available boundary gap.
//
// The obstruction vocabulary is deliberately only committed node boxes overlapping the
// candidate full vertical leg's Y span. Existing edge geometry never influences the choice.

function fail(message) {
  throw new Error(`SketchV4 conditional merge-source invariant failed: ${message}`);
}

function eligibleConditionalMergeEdges(cfg, roles) {
  return cfg.edges.filter((edge) => (
    (edge.branch === "yes" || edge.branch === "no")
    && roles.edgeRoleById.get(edge.id) === "merge-connector"
    && cfg.nodeById.get(edge.from)?.kind === "conditionalJump"
  ));
}

function branchDoorway(sourceBox, visualSide) {
  return visualSide === "left"
    ? [(sourceBox.left + sourceBox.cx) / 2, (sourceBox.cy + sourceBox.bottom) / 2]
    : [(sourceBox.cx + sourceBox.right) / 2, (sourceBox.cy + sourceBox.bottom) / 2];
}

export function applyAdaptiveConditionalMergeSources(
  cfg,
  roles,
  skeleton,
  routed,
  boxes,
  { orientationOf, branchAngleTan, clearance = 16 },
) {
  const eligibleEdges = eligibleConditionalMergeEdges(cfg, roles);
  const baselineRouteById = new Map(routed.routes.map((route) => [route.edgeId, route]));
  const fullRouteById = new Map();
  const fullPortById = new Map();
  const fullDepartures = [];

  // First construct the full branch-preserving ray and the fixed V/H body for every eligible
  // edge. This stage does not change placement, orientation, or target-port selection.
  for (const edge of eligibleEdges) {
    const baselineRoute = baselineRouteById.get(edge.id);
    const sourcePlacement = skeleton.placements.get(edge.from);
    const visualSide = orientationOf(edge.from)?.[edge.branch];
    const siblingArm = skeleton.armSegments.find((arm) => (
      arm.srcDiamond === edge.from && arm.side !== visualSide
    ));
    if (!baselineRoute || !sourcePlacement || !siblingArm
      || (visualSide !== "left" && visualSide !== "right")) {
      fail(`cannot derive ordinary branch doorway for ${edge.id}`);
    }

    const sourcePort = branchDoorway(sourcePlacement.box, visualSide);
    const siblingVector = [
      siblingArm.targetTop[0] - siblingArm.face[0],
      siblingArm.targetTop[1] - siblingArm.face[1],
    ];
    const fullRayEndpoint = [
      sourcePort[0] + (visualSide === "left" ? -Math.abs(siblingVector[0]) : Math.abs(siblingVector[0])),
      sourcePort[1] + siblingVector[1],
    ];
    const targetPort = [...baselineRoute.targetPort];
    const verticalEnd = [fullRayEndpoint[0], targetPort[1]];
    const points = [sourcePort, fullRayEndpoint, verticalEnd, targetPort];
    fullRouteById.set(edge.id, {
      ...baselineRoute,
      sourcePort,
      targetPort,
      points,
      connectorKind: "branchSourceRay+verticalHorizontal",
    });
    fullPortById.set(edge.id, {
      ...routed.ports.get(edge.id),
      sourcePort,
      targetPort,
      experimentalBranchPreservingSource: true,
    });
    fullDepartures.push({ edge, visualSide, sourcePort, fullRayEndpoint, targetPort });
  }

  const routeById = new Map(baselineRouteById);
  const decisions = [];
  const shortenedEdgeIds = [];

  for (const departure of fullDepartures) {
    const { edge, visualSide, sourcePort, fullRayEndpoint, targetPort } = departure;
    const fullRoute = fullRouteById.get(edge.id);
    const direction = visualSide === "left" ? -1 : 1;
    const fullHorizontalRun = direction * (fullRayEndpoint[0] - sourcePort[0]);
    const verticalMinY = Math.min(fullRayEndpoint[1], targetPort[1]);
    const verticalMaxY = Math.max(fullRayEndpoint[1], targetPort[1]);
    const candidates = [...boxes]
      .filter(([nodeId, box]) => (
        nodeId !== edge.from
        && nodeId !== edge.to
        && box.bottom >= verticalMinY
        && box.top <= verticalMaxY
      ))
      .map(([nodeId, box]) => {
        const nearBoundaryX = direction > 0 ? box.left : box.right;
        return {
          nodeId,
          nodeBox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          nearBoundaryX,
          boundaryGap: direction * (nearBoundaryX - sourcePort[0]),
        };
      })
      .filter((candidate) => candidate.boundaryGap > 1e-9)
      .sort((a, b) => a.boundaryGap - b.boundaryGap || a.nodeId.localeCompare(b.nodeId));

    const nearestGap = candidates[0]?.boundaryGap ?? null;
    const tiedNearest = nearestGap == null
      ? []
      : candidates.filter((candidate) => Math.abs(candidate.boundaryGap - nearestGap) < 1e-9);
    const clearanceAtFullLeg = nearestGap == null ? null : nearestGap - fullHorizontalRun;
    const midpointRun = nearestGap == null ? null : nearestGap / 2;
    const shortened = nearestGap != null
      && clearanceAtFullLeg < clearance
      && midpointRun < fullHorizontalRun;
    const chosenHorizontalRun = shortened ? midpointRun : fullHorizontalRun;
    const chosenRayEndpoint = shortened ? [
      sourcePort[0] + direction * chosenHorizontalRun,
      sourcePort[1] + chosenHorizontalRun * branchAngleTan,
    ] : [...fullRayEndpoint];
    const verticalEnd = [chosenRayEndpoint[0], targetPort[1]];
    const points = [sourcePort, chosenRayEndpoint, verticalEnd, targetPort];
    const route = shortened
      ? { ...fullRoute, points, connectorKind: "adaptiveBranchRay+verticalHorizontal" }
      : fullRoute;
    routeById.set(edge.id, route);
    if (shortened) shortenedEdgeIds.push(edge.id);

    decisions.push({
      edgeId: edge.id,
      edgeRole: fullRoute.edgeRole,
      routeFamily: fullRoute.routeFamily,
      semanticBranch: edge.branch,
      visualSide,
      sourcePort,
      fullSiblingRayLength: Math.hypot(
        fullRayEndpoint[0] - sourcePort[0],
        fullRayEndpoint[1] - sourcePort[1],
      ),
      fullRayEndpoint,
      shortened,
      relevantVerticalYSpan: [verticalMinY, verticalMaxY],
      nearestRelevantObstruction: tiedNearest.length ? {
        kind: "node-box-boundary",
        nodeIds: tiedNearest.map((candidate) => candidate.nodeId),
        boundaryX: tiedNearest[0].nearBoundaryX,
        boxes: tiedNearest.map((candidate) => ({ nodeId: candidate.nodeId, ...candidate.nodeBox })),
      } : null,
      availableBoundaryGap: nearestGap,
      clearanceAtFullLeg,
      clearanceThreshold: clearance,
      chosenRayEndpoint,
      chosenRayLength: Math.hypot(
        chosenRayEndpoint[0] - sourcePort[0],
        chosenRayEndpoint[1] - sourcePort[1],
      ),
      targetPort,
      finalRoutePoints: route.points,
    });
  }

  const ports = new Map(routed.ports);
  for (const [edgeId, port] of fullPortById) ports.set(edgeId, port);
  const routes = routed.routes.map((route) => routeById.get(route.edgeId));
  return {
    routed: { ...routed, routes, ports },
    decisions,
    eligibleEdgeIds: eligibleEdges.map((edge) => edge.id),
    shortenedEdgeIds,
    contract: {
      routeConstruction: "ordinary branch ray, then fixed vertical, then fixed horizontal",
      obstructionVocabulary: "nearest unrelated node-box boundary overlapping the full V-leg Y-span",
      crowdingThreshold: `less than one existing V4 clearance unit (${clearance}px)`,
      shortenedPlacement: "midpoint of doorway-to-obstruction boundary gap",
      edgeGeometryInfluencesDecision: false,
      targetPortSelectionChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}
