const SKETCH_V2_LAYOUT_MODE = "sketchV2";
const SKETCH_V2_ANGLE_TOLERANCE = 0.08;
const SKETCH_V2_LANE_CLEARANCE = 16;
const SKETCH_V2_DIAMOND_OBSTACLE_MARGIN = 24;

function isInstructionTarget(index, instructionCount) {
  return Number.isInteger(index) && index >= 0 && index < instructionCount;
}

function getInstructionNodes(layoutPlan) {
  return layoutPlan.nodes.filter((node) => Array.isArray(node.instructionIndices));
}

function buildInstructionNodeLookup(instructionNodes) {
  const lookup = new Map();
  instructionNodes.forEach((node) => {
    node.instructionIndices.forEach((index) => {
      if (Number.isInteger(index) && !lookup.has(index)) {
        lookup.set(index, node);
      }
    });
  });
  return lookup;
}

function appendMapList(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function getNodeSize(node, layout) {
  if (node.kind === "start" || node.kind === "halt") {
    return { width: layout.terminalWidth, height: layout.terminalHeight };
  }
  if (node.kind === "conditionalJump") {
    return { width: layout.diamondWidth, height: layout.diamondHeight };
  }
  if (node.kind === "block") {
    return { width: layout.blockNodeWidth, height: layout.blockNodeHeight };
  }
  return {
    width: node.kind === "unconditionalJump"
      ? layout.unconditionalNodeWidth
      : layout.actionNodeWidth,
    height: node.kind === "unconditionalJump"
      ? layout.unconditionalNodeHeight
      : layout.actionNodeHeight,
  };
}

function getNodeBoundsAt(node, position, layout) {
  const { width, height } = getNodeSize(node, layout);
  return {
    left: position.x - width / 2,
    right: position.x + width / 2,
    top: position.y - height / 2,
    bottom: position.y + height / 2,
    centerX: position.x,
    centerY: position.y,
  };
}

function getBottomPort(bounds) {
  return [bounds.centerX, bounds.bottom];
}

function getTopPort(bounds) {
  return [bounds.centerX, bounds.top];
}

function getLeftPort(bounds) {
  return [bounds.left, bounds.centerY];
}

function getRightPort(bounds) {
  return [bounds.right, bounds.centerY];
}

function interpolatePoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
  ];
}

function pointsEqual(left, right, epsilon = 0.001) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    Math.abs(left[0] - right[0]) <= epsilon &&
    Math.abs(left[1] - right[1]) <= epsilon;
}

function routeSegments(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points.slice(1).map((point, index) => ({
    start: points[index],
    end: point,
  }));
}

function distancePointToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.001) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function segmentOrientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function pointOnSegment(point, start, end) {
  return point[0] <= Math.max(start[0], end[0]) + 0.001 &&
    point[0] >= Math.min(start[0], end[0]) - 0.001 &&
    point[1] <= Math.max(start[1], end[1]) + 0.001 &&
    point[1] >= Math.min(start[1], end[1]) - 0.001;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < 0.001 && pointOnSegment(c, a, b)) return true;
  if (Math.abs(o2) < 0.001 && pointOnSegment(d, a, b)) return true;
  if (Math.abs(o3) < 0.001 && pointOnSegment(a, c, d)) return true;
  return Math.abs(o4) < 0.001 && pointOnSegment(b, c, d);
}

function segmentsOnlyMeetAtNonCollinearEndpoint(left, right) {
  const sharedEndpoint = pointsEqual(left.start, right.start) ||
    pointsEqual(left.start, right.end) ||
    pointsEqual(left.end, right.start) ||
    pointsEqual(left.end, right.end);
  if (!sharedEndpoint) return false;
  const collinear = Math.abs(segmentOrientation(left.start, left.end, right.start)) < 0.001 &&
    Math.abs(segmentOrientation(left.start, left.end, right.end)) < 0.001;
  return !collinear;
}

function segmentsAreCollinear(left, right) {
  return Math.abs(segmentOrientation(left.start, left.end, right.start)) < 0.001 &&
    Math.abs(segmentOrientation(left.start, left.end, right.end)) < 0.001;
}

function distanceBetweenSegments(leftStart, leftEnd, rightStart, rightEnd) {
  if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return 0;
  return Math.min(
    distancePointToSegment(leftStart, rightStart, rightEnd),
    distancePointToSegment(leftEnd, rightStart, rightEnd),
    distancePointToSegment(rightStart, leftStart, leftEnd),
    distancePointToSegment(rightEnd, leftStart, leftEnd),
  );
}

function segmentBoxDistance(start, end, box) {
  if (
    (start[0] >= box.left && start[0] <= box.right && start[1] >= box.top && start[1] <= box.bottom) ||
    (end[0] >= box.left && end[0] <= box.right && end[1] >= box.top && end[1] <= box.bottom)
  ) {
    return 0;
  }
  const corners = [
    [box.left, box.top],
    [box.right, box.top],
    [box.right, box.bottom],
    [box.left, box.bottom],
  ];
  const sides = corners.map((corner, index) => ({
    start: corner,
    end: corners[(index + 1) % corners.length],
  }));
  return Math.min(...sides.map((side) => distanceBetweenSegments(start, end, side.start, side.end)));
}

function boxDistance(left, right) {
  const dx = Math.max(0, Math.max(left.left - right.right, right.left - left.right));
  const dy = Math.max(0, Math.max(left.top - right.bottom, right.top - left.bottom));
  return Math.hypot(dx, dy);
}

function inflateBox(box, padding) {
  return {
    left: box.left - padding,
    right: box.right + padding,
    top: box.top - padding,
    bottom: box.bottom + padding,
    centerX: box.centerX,
    centerY: box.centerY,
  };
}

function isHaltEdge(edge, instructionCount) {
  return !isInstructionTarget(edge?.targetIndex, instructionCount) ||
    String(edge?.to ?? "").startsWith("halt");
}

function getRouteGeometryRole(edge, route = null, instructionCount = 0) {
  if (isHaltEdge(edge, instructionCount) || route?.routeKind === "sketchV2HaltExit") return "HALT";
  if (
    Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  ) {
    return "loop return";
  }
  if (route?.routeKind === "sketchV2AlreadyDrawnTarget") return "already-drawn target";
  if (edge?.branch) return "split exit";
  return "ordinary";
}

function getDiamondAnchors(bounds) {
  const bottomAnchor = [bounds.centerX, bounds.bottom];
  const leftAnchor = [bounds.left, bounds.centerY];
  const rightAnchor = [bounds.right, bounds.centerY];
  return {
    lowerLeftSideCenter: interpolatePoint(leftAnchor, bottomAnchor, 0.5),
    lowerRightSideCenter: interpolatePoint(rightAnchor, bottomAnchor, 0.5),
  };
}

function getAngleTangent(layout) {
  return Math.tan(Math.max(0.2, (layout.branchAngleDeg * Math.PI) / 180));
}

function buildSketchV2Parameters(layout) {
  const ordinaryStepY = Math.max(
    layout.actionNodeHeight + layout.verticalGap * 2.2,
    layout.diamondHeight + layout.verticalGap,
    82,
  );
  const splitStepY = Math.max(layout.diamondHeight + layout.verticalGap * 2.6, ordinaryStepY, 112);
  const splitStepX = Math.max(
    layout.localBranchTargetOffset * 1.75,
    layout.branchForkDx * 3.2,
    220,
  );
  return {
    ordinaryStepY,
    splitStepY,
    splitStepX,
    loopLaneDistance: Math.max(layout.loopLaneDistance * 1.8, 96),
    haltDistance: Math.max(layout.sideHaltDistance, 154),
  };
}

function getSplitDistance(params, depth) {
  return Math.max(72, params.splitStepX * (0.78 ** Math.max(0, depth)));
}

function makeRoute(edge, points, routeKind) {
  const labelPoint = edge?.branch ? interpolatePoint(points[0], points[points.length - 1], 0.42) : null;
  return {
    routeKind,
    points,
    labelX: labelPoint?.[0],
    labelY: labelPoint?.[1],
  };
}

function makeDiamondExitRoute({ edge, start, end, layout, alreadyDrawnTarget = false }) {
  const expectedDirection = edge.branch === "no" ? -1 : 1;
  if (!alreadyDrawnTarget) {
    return makeRoute(edge, [start, end], edge.branch === "no" ? "sketchV2NoSplitDiagonal" : "sketchV2YesSplitDiagonal");
  }

  const expectedTangent = getAngleTangent(layout);
  const directDx = end[0] - start[0];
  const directDy = end[1] - start[1];
  const directTangent = Math.abs(directDy / directDx);
  const targetOnRay = directDy > 0 &&
    directDx * expectedDirection > 0 &&
    Number.isFinite(directTangent) &&
    Math.abs(directTangent - expectedTangent) <= SKETCH_V2_ANGLE_TOLERANCE;

  if (targetOnRay) {
    return {
      ...makeRoute(edge, [start, end], "sketchV2AlreadyDrawnTarget"),
      sketchV2AlreadyDrawnTargetOnFixedAngleRay: true,
    };
  }

  const exitDx = Math.max(48, Math.min(120, Math.abs(directDx) * 0.35 || 72));
  const fixedExit = [
    start[0] + expectedDirection * exitDx,
    start[1] + exitDx * expectedTangent,
  ];
  return {
    ...makeRoute(edge, [start, fixedExit, end], "sketchV2AlreadyDrawnTarget"),
    sketchV2AlreadyDrawnTargetOnFixedAngleRay: false,
    sketchV2AlreadyDrawnTargetDiagnostic: "targetNotOnFixedAngleRay",
  };
}

function getOutgoingEdges(edges) {
  const outgoingBySource = new Map();
  edges.forEach((edge) => {
    if (Number.isInteger(edge.sourceIndex)) {
      appendMapList(outgoingBySource, edge.sourceIndex, edge);
    }
  });
  return outgoingBySource;
}

function placeNode(node, position, placedByNodeId, placementRows, placementKind, incomingEdge = null) {
  if (placedByNodeId.has(node.id)) return placedByNodeId.get(node.id);
  node.x = position.x;
  node.y = position.y;
  const placement = { node, x: position.x, y: position.y };
  placedByNodeId.set(node.id, placement);
  placementRows.push({
    order: placementRows.length,
    nodeId: node.id,
    instructionIndex: node.instructionIndex ?? null,
    edgeId: incomingEdge?.id ?? null,
    placementKind,
    x: position.x,
    y: position.y,
  });
  return placement;
}

function getPlacedNodeBoxes(placedByNodeId, layout) {
  return Array.from(placedByNodeId.values()).map((placement) => ({
    nodeId: placement.node.id,
    box: getNodeBoundsAt(placement.node, placement, layout),
  }));
}

function getExistingEdgeSegments(edgeRouteById, edgesById, instructionCount, ignoreEdgeId = null) {
  return Array.from(edgeRouteById.entries()).flatMap(([edgeId, route]) => {
    if (edgeId === ignoreEdgeId) return [];
    const edge = edgesById.get(edgeId) ?? null;
    return routeSegments(route.points).map((segment, segmentIndex) => ({
      ...segment,
      edgeId,
      segmentIndex,
      geometryRole: getRouteGeometryRole(edge, route, instructionCount),
      sourceNodeId: edge?.from ?? null,
      targetNodeId: edge?.to ?? null,
    }));
  });
}

function getProtectedSplitExitSegments(edgeRouteById, edgesById, instructionNodeByIndex, instructionCount) {
  return Array.from(edgeRouteById.entries()).flatMap(([edgeId, route]) => {
    const edge = edgesById.get(edgeId) ?? null;
    if (
      !edge?.branch ||
      !isInstructionTarget(edge.sourceIndex, instructionCount) ||
      !isInstructionTarget(edge.targetIndex, instructionCount) ||
      edge.targetIndex <= edge.sourceIndex ||
      instructionNodeByIndex.get(edge.sourceIndex)?.kind !== "conditionalJump"
    ) {
      return [];
    }
    const firstSegment = routeSegments(route.points)[0] ?? null;
    return firstSegment ? [{
      ...firstSegment,
      edgeId,
      sourceNodeId: edge.from ?? null,
      targetNodeId: edge.to ?? null,
    }] : [];
  });
}

function getCommittedNodeBoxes(placedByNodeId, layout, excludeNodeIds = new Set()) {
  return Array.from(placedByNodeId.values())
    .filter((placement) => !excludeNodeIds.has(placement.node.id))
    .map((placement) => ({
      nodeId: placement.node.id,
      geometryRole: placement.node.kind === "conditionalJump" ? "diamond node" : "node",
      box: placement.node.kind === "conditionalJump"
        ? inflateBox(getNodeBoundsAt(placement.node, placement, layout), SKETCH_V2_DIAMOND_OBSTACLE_MARGIN)
        : getNodeBoundsAt(placement.node, placement, layout),
    }));
}

function getCommittedEdgeSegments({
  edgeRouteById,
  edgesById,
  instructionCount,
  excludeEdgeIds = new Set(),
  excludeNodeIds = new Set(),
}) {
  return getExistingEdgeSegments(edgeRouteById, edgesById, instructionCount)
    .filter((segment) => (
      !excludeEdgeIds.has(segment.edgeId) &&
      !excludeNodeIds.has(segment.sourceNodeId) &&
      !excludeNodeIds.has(segment.targetNodeId)
	    ));
}

function getActivePendingCorridors(pendingCorridorByEdgeId, excludeEdgeIds = new Set()) {
  return Array.from(pendingCorridorByEdgeId.values())
    .filter((corridor) => (
      corridor &&
      corridor.removedOrder == null &&
      !excludeEdgeIds.has(corridor.pendingEdgeId)
    ));
}

function makePendingCorridorId(edge) {
  return `pending-${edge.id}`;
}

function makePendingBranchCorridor({
  edge,
  sourcePlacement,
  targetNode,
  position,
  layout,
  params,
  depth,
  branchPath,
  createdOrder,
}) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const targetBounds = getNodeBoundsAt(targetNode, position, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const start = edge.branch === "no" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
  const top = getTopPort(targetBounds);
  const bottom = getBottomPort(targetBounds);
  const continuationEnd = [bottom[0], bottom[1] + Math.max(params.ordinaryStepY * 0.75, SKETCH_V2_LANE_CLEARANCE * 3)];
  return {
    id: makePendingCorridorId(edge),
    ownerDiamond: edge.from ?? null,
    ownerInstructionIndex: edge.sourceIndex ?? null,
    pendingEdgeId: edge.id,
    targetNodeId: targetNode.id,
    targetInstructionIndex: edge.targetIndex ?? null,
    side: edge.branch ?? null,
    branchPath,
    splitDepth: depth,
    createdOrder,
    removedOrder: null,
    removedReason: null,
    convertedEdgeId: null,
    footprint: targetBounds,
    segments: [
      {
        start,
        end: top,
        corridorPart: "fixed-angle exit segment",
      },
      {
        start: bottom,
        end: continuationEnd,
        corridorPart: "continuation corridor",
      },
    ],
  };
}

function retirePendingBranchCorridor({
  edge,
  pendingCorridorByEdgeId,
  pendingCorridorRows,
  removedOrder,
  removedReason,
  convertedEdgeId = null,
}) {
  if (!edge) return;
  const corridor = pendingCorridorByEdgeId.get(edge.id);
  if (!corridor) return;
  corridor.removedOrder = removedOrder;
  corridor.removedReason = removedReason;
  corridor.convertedEdgeId = convertedEdgeId;
  pendingCorridorByEdgeId.delete(edge.id);
  const row = pendingCorridorRows.find((entry) => entry.id === corridor.id);
  if (row) {
    row.removedOrder = removedOrder;
    row.removedReason = removedReason;
    row.convertedEdgeId = convertedEdgeId;
  }
}

function findPendingCorridorNodeRejection({
  node,
  candidateBox,
  candidateEdgeId,
  pendingCorridorByEdgeId,
  excludePendingEdgeIds = new Set(),
}) {
  const corridors = getActivePendingCorridors(pendingCorridorByEdgeId, excludePendingEdgeIds);
  for (const corridor of corridors) {
    const footprintDistance = boxDistance(candidateBox, corridor.footprint);
    if (footprintDistance < SKETCH_V2_LANE_CLEARANCE) {
      return makePlacementRejection({
        candidateNodeId: node.id,
        candidateEdgeId,
        rejectionKind: "node-vs-pending-corridor",
        blockingGeometryId: corridor.id,
        blockingGeometryRole: "pending branch corridor",
        clearance: footprintDistance,
        pendingCorridorPart: "branch-start footprint",
      });
    }

    for (const segment of corridor.segments) {
      const distance = segmentBoxDistance(segment.start, segment.end, candidateBox);
      if (distance < SKETCH_V2_LANE_CLEARANCE) {
        return makePlacementRejection({
          candidateNodeId: node.id,
          candidateEdgeId,
          rejectionKind: "node-vs-pending-corridor",
          blockingGeometryId: corridor.id,
          blockingGeometryRole: "pending branch corridor",
          clearance: distance,
          pendingCorridorPart: segment.corridorPart,
        });
      }
    }
  }
  return null;
}

function findPendingCorridorRouteRejection({
  edge,
  route,
  pendingCorridorByEdgeId,
  excludePendingEdgeIds = new Set(),
}) {
  const segments = routeSegments(route.points);
  const corridors = getActivePendingCorridors(pendingCorridorByEdgeId, excludePendingEdgeIds);
  for (const segment of segments) {
    for (const corridor of corridors) {
      const footprintDistance = segmentBoxDistance(segment.start, segment.end, corridor.footprint);
      if (footprintDistance < SKETCH_V2_LANE_CLEARANCE) {
        return makePlacementRejection({
          candidateEdgeId: edge.id,
          rejectionKind: "edge-vs-pending-corridor",
          blockingGeometryId: corridor.id,
          blockingGeometryRole: "pending branch corridor",
          clearance: footprintDistance,
          candidatePoints: route.points,
          pendingCorridorPart: "branch-start footprint",
        });
      }

      for (const pendingSegment of corridor.segments) {
        const routeTouchesCorridorOwner = edge.from === corridor.ownerDiamond || edge.to === corridor.ownerDiamond;
        if (routeTouchesCorridorOwner && pendingSegment.corridorPart === "fixed-angle exit segment") {
          continue;
        }
        const distance = distanceBetweenSegments(
          segment.start,
          segment.end,
          pendingSegment.start,
          pendingSegment.end,
        );
        if (distance < SKETCH_V2_LANE_CLEARANCE) {
          return makePlacementRejection({
            candidateEdgeId: edge.id,
            rejectionKind: distance <= 0.001 ? "pending-corridor-overlap" : "edge-vs-pending-corridor",
            blockingGeometryId: corridor.id,
            blockingGeometryRole: "pending branch corridor",
            clearance: distance,
            candidatePoints: route.points,
            pendingCorridorPart: pendingSegment.corridorPart,
          });
        }
      }
    }
  }
  return null;
}

function pendingCorridorClearanceSummary({
  edge,
  points,
  pendingCorridorByEdgeId,
  excludePendingEdgeIds = new Set(),
}) {
  const segments = routeSegments(points);
  const corridors = getActivePendingCorridors(pendingCorridorByEdgeId, excludePendingEdgeIds);
  if (segments.length === 0 || corridors.length === 0) {
    return {
      nearestPendingBranchCorridorClearance: Infinity,
      nearestPendingBranchCorridorId: null,
      nearestPendingBranchCorridorPart: null,
    };
  }

  let nearest = {
    clearance: Infinity,
    corridorId: null,
    part: null,
  };
  segments.forEach((segment) => {
    corridors.forEach((corridor) => {
      const footprintDistance = segmentBoxDistance(segment.start, segment.end, corridor.footprint);
      if (footprintDistance < nearest.clearance) {
        nearest = {
          clearance: footprintDistance,
          corridorId: corridor.id,
          part: "branch-start footprint",
        };
      }
      corridor.segments.forEach((pendingSegment) => {
        const routeTouchesCorridorOwner = edge.from === corridor.ownerDiamond || edge.to === corridor.ownerDiamond;
        if (routeTouchesCorridorOwner && pendingSegment.corridorPart === "fixed-angle exit segment") {
          return;
        }
        const distance = distanceBetweenSegments(
          segment.start,
          segment.end,
          pendingSegment.start,
          pendingSegment.end,
        );
        if (distance < nearest.clearance) {
          nearest = {
            clearance: distance,
            corridorId: corridor.id,
            part: pendingSegment.corridorPart,
          };
        }
      });
    });
  });

  return {
    nearestPendingBranchCorridorClearance: nearest.clearance,
    nearestPendingBranchCorridorId: nearest.corridorId,
    nearestPendingBranchCorridorPart: nearest.part,
  };
}

function makePlacementRejection({
  candidateNodeId,
  candidateEdgeId,
  rejectionKind,
  blockingGeometryId,
  blockingGeometryRole,
  clearance,
  candidatePoints = null,
  pendingCorridorPart = null,
}) {
  return {
    candidateNodeId: candidateNodeId ?? null,
    candidateEdgeId: candidateEdgeId ?? null,
    rejectionKind,
    blockingGeometryId,
    blockingGeometryRole,
    clearance: Number.isFinite(clearance) ? clearance : null,
    candidatePoints,
    pendingCorridorPart,
  };
}

function findNodePlacementRejection({
  node,
  position,
  layout,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionCount,
  pendingCorridorByEdgeId = new Map(),
  excludeNodeIds = new Set(),
  excludePendingEdgeIds = new Set(),
  candidateEdgeId = null,
}) {
  const candidateBox = getNodeBoundsAt(node, position, layout);
  const nodeBoxes = getCommittedNodeBoxes(placedByNodeId, layout, new Set([...excludeNodeIds, node.id]));
  for (const entry of nodeBoxes) {
    const distance = boxDistance(candidateBox, entry.box);
    if (distance < SKETCH_V2_LANE_CLEARANCE) {
      return makePlacementRejection({
        candidateNodeId: node.id,
        candidateEdgeId,
        rejectionKind: "node-vs-node",
        blockingGeometryId: entry.nodeId,
        blockingGeometryRole: entry.geometryRole,
        clearance: distance,
      });
    }
  }

  const edgeSegments = getCommittedEdgeSegments({
    edgeRouteById,
    edgesById,
    instructionCount,
    excludeNodeIds: new Set([...excludeNodeIds, node.id]),
  });
  for (const segment of edgeSegments) {
    const distance = segmentBoxDistance(segment.start, segment.end, candidateBox);
    if (distance < SKETCH_V2_LANE_CLEARANCE) {
      return makePlacementRejection({
        candidateNodeId: node.id,
        candidateEdgeId,
        rejectionKind: "node-vs-edge-lane",
        blockingGeometryId: segment.edgeId,
        blockingGeometryRole: segment.geometryRole,
        clearance: distance,
      });
    }
  }

  const pendingCorridorRejection = findPendingCorridorNodeRejection({
    node,
    candidateBox,
    candidateEdgeId,
    pendingCorridorByEdgeId,
    excludePendingEdgeIds,
  });
  if (pendingCorridorRejection) return pendingCorridorRejection;

  return null;
}

function findRouteRejection({
  edge,
  route,
  layout,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionCount,
  pendingCorridorByEdgeId = new Map(),
  excludeNodeIds = new Set(),
  excludeEdgeNodeIds = null,
  excludeEdgeIds = new Set(),
  excludePendingEdgeIds = new Set(),
}) {
  const segments = routeSegments(route.points);
  const nodeBoxes = getCommittedNodeBoxes(placedByNodeId, layout, excludeNodeIds);
  for (const segment of segments) {
    for (const entry of nodeBoxes) {
      const distance = segmentBoxDistance(segment.start, segment.end, entry.box);
      if (distance < SKETCH_V2_LANE_CLEARANCE) {
        return makePlacementRejection({
          candidateEdgeId: edge.id,
          rejectionKind: "edge-vs-node",
          blockingGeometryId: entry.nodeId,
          blockingGeometryRole: entry.geometryRole,
          clearance: distance,
          candidatePoints: route.points,
        });
      }
    }
  }

  const edgeSegments = getCommittedEdgeSegments({
    edgeRouteById,
    edgesById,
    instructionCount,
    excludeEdgeIds: new Set([...excludeEdgeIds, edge.id]),
    excludeNodeIds: excludeEdgeNodeIds ?? excludeNodeIds,
  });
  for (const segment of segments) {
    for (const existing of edgeSegments) {
      const distance = distanceBetweenSegments(segment.start, segment.end, existing.start, existing.end);
      if (distance < SKETCH_V2_LANE_CLEARANCE) {
        const candidateRole = getRouteGeometryRole(edge, route, instructionCount);
        const haltConvergenceAllowed = candidateRole === "HALT" &&
          existing.geometryRole === "HALT" &&
          edge.to === existing.targetNodeId &&
          !segmentsAreCollinear(segment, existing);
        if (haltConvergenceAllowed || (
          candidateRole === "HALT" &&
          existing.geometryRole === "HALT" &&
          edge.to === existing.targetNodeId &&
          segmentsOnlyMeetAtNonCollinearEndpoint(segment, existing)
        )) continue;
        return makePlacementRejection({
          candidateEdgeId: edge.id,
          rejectionKind: distance <= 0.001 ? "edge-lane-overlap" : "edge-vs-edge-lane",
          blockingGeometryId: existing.edgeId,
          blockingGeometryRole: existing.geometryRole,
          clearance: distance,
          candidatePoints: route.points,
        });
      }
    }
  }

  const pendingCorridorRejection = findPendingCorridorRouteRejection({
    edge,
    route,
    pendingCorridorByEdgeId,
    excludePendingEdgeIds,
  });
  if (pendingCorridorRejection) return pendingCorridorRejection;

  return null;
}

function routeClearanceSummary({
  edge,
  points,
  layout,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  instructionCount,
  pendingCorridorByEdgeId = new Map(),
}) {
  const sourceNodeId = edge.from;
  const targetNodeId = edge.to;
  const nodeBoxes = getPlacedNodeBoxes(placedByNodeId, layout)
    .filter((entry) => entry.nodeId !== sourceNodeId && entry.nodeId !== targetNodeId);
  const diamondBoxes = Array.from(placedByNodeId.values())
    .filter((placement) => (
      placement.node.kind === "conditionalJump" &&
      placement.node.id !== sourceNodeId &&
      placement.node.id !== targetNodeId
    ))
    .map((placement) => ({
      nodeId: placement.node.id,
      box: inflateBox(
        getNodeBoundsAt(placement.node, placement, layout),
        SKETCH_V2_DIAMOND_OBSTACLE_MARGIN,
      ),
    }));
  const existingSegments = getExistingEdgeSegments(edgeRouteById, edgesById, instructionCount, edge.id)
    .filter((segment) => (
      segment.sourceNodeId !== sourceNodeId &&
      segment.targetNodeId !== sourceNodeId &&
      segment.sourceNodeId !== targetNodeId &&
      segment.targetNodeId !== targetNodeId
    ));
  const protectedSplitExitSegments = getProtectedSplitExitSegments(
    edgeRouteById,
    edgesById,
    instructionNodeByIndex,
    instructionCount,
  ).filter((segment) => (
    segment.sourceNodeId !== sourceNodeId &&
    segment.targetNodeId !== sourceNodeId &&
    segment.sourceNodeId !== targetNodeId &&
    segment.targetNodeId !== targetNodeId
  ));
  const segments = routeSegments(points);
  const nearestEdgeLaneClearance = existingSegments.length === 0 || segments.length === 0
    ? Infinity
    : Math.min(...segments.flatMap((segment) => (
        existingSegments.map((existing) => distanceBetweenSegments(
          segment.start,
          segment.end,
          existing.start,
          existing.end,
        ))
      )));
  const nearestNodeClearance = nodeBoxes.length === 0 || segments.length === 0
    ? Infinity
    : Math.min(...segments.flatMap((segment) => (
        nodeBoxes.map((nodeBox) => segmentBoxDistance(segment.start, segment.end, nodeBox.box))
      )));
  const nearestDiamondClearance = diamondBoxes.length === 0 || segments.length === 0
    ? Infinity
    : Math.min(...segments.flatMap((segment) => (
        diamondBoxes.map((diamondBox) => segmentBoxDistance(segment.start, segment.end, diamondBox.box))
      )));
  const nearestSplitExitLaneClearance = protectedSplitExitSegments.length === 0 || segments.length === 0
    ? Infinity
    : Math.min(...segments.flatMap((segment) => (
        protectedSplitExitSegments.map((splitSegment) => distanceBetweenSegments(
          segment.start,
          segment.end,
          splitSegment.start,
          splitSegment.end,
        ))
      )));
  const pendingCorridorSummary = pendingCorridorClearanceSummary({
    edge,
    points,
    pendingCorridorByEdgeId,
    excludePendingEdgeIds: new Set([edge.id]),
  });
  const nearestPendingBranchCorridorClearance =
    pendingCorridorSummary.nearestPendingBranchCorridorClearance;
  return {
    nearestEdgeLaneClearance,
    nearestNodeClearance,
    nearestDiamondClearance,
    nearestSplitExitLaneClearance,
    nearestPendingBranchCorridorClearance,
    nearestPendingBranchCorridorId: pendingCorridorSummary.nearestPendingBranchCorridorId,
    nearestPendingBranchCorridorPart: pendingCorridorSummary.nearestPendingBranchCorridorPart,
    passesThroughExpandedDiamondObstacle:
      nearestDiamondClearance < 0.001,
    overlapsProtectedSplitExitLane:
      nearestSplitExitLaneClearance < SKETCH_V2_LANE_CLEARANCE,
    overlapsUnrelatedEdgeLane:
      nearestEdgeLaneClearance < SKETCH_V2_LANE_CLEARANCE,
    overlapsProtectedPendingBranchCorridor:
      nearestPendingBranchCorridorClearance < SKETCH_V2_LANE_CLEARANCE,
    belowClearanceThreshold:
      nearestEdgeLaneClearance < SKETCH_V2_LANE_CLEARANCE ||
      nearestNodeClearance < SKETCH_V2_LANE_CLEARANCE ||
      nearestDiamondClearance < SKETCH_V2_LANE_CLEARANCE ||
      nearestSplitExitLaneClearance < SKETCH_V2_LANE_CLEARANCE ||
      nearestPendingBranchCorridorClearance < SKETCH_V2_LANE_CLEARANCE,
  };
}

function makeLoopReturnRoute({
  edge,
  fromBounds,
  toBounds,
  layout,
  params,
  depth,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  instructionCount,
  pendingCorridorByEdgeId = new Map(),
}) {
  const allNodeBoxes = getPlacedNodeBoxes(placedByNodeId, layout).map((entry) => entry.box);
  const leftBoundary = Math.min(fromBounds.left, toBounds.left, ...allNodeBoxes.map((box) => box.left));
  const rightBoundary = Math.max(fromBounds.right, toBounds.right, ...allNodeBoxes.map((box) => box.right));
  const laneStep = Math.max(params.loopLaneDistance * 0.45, SKETCH_V2_LANE_CLEARANCE * 2);
  const start = getLeftPort(fromBounds);
  const end = getLeftPort(toBounds);
  const candidates = [];

  for (let rank = 0; rank < 12; rank += 1) {
    const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
    const points = [start, [laneX, start[1]], [laneX, end[1]], end];
    candidates.push({
      side: "left",
      laneRank: rank,
      laneX,
      points,
      reason: rank === 0 ? "nearestOutsideLeftLane" : "fartherOutsideLeftLaneForClearance",
    });
  }

  for (let rank = 0; rank < 8; rank += 1) {
    const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
    const points = [getRightPort(fromBounds), [laneX, fromBounds.centerY], [laneX, toBounds.centerY], getRightPort(toBounds)];
    candidates.push({
      side: "right",
      laneRank: rank,
      laneX,
      points,
      reason: "rightOutsideLaneFallback",
    });
  }

	  const evaluated = candidates.map((candidate) => ({
	    ...candidate,
	    ...routeClearanceSummary({
      edge,
      points: candidate.points,
      layout,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionNodeByIndex,
      instructionCount,
	      pendingCorridorByEdgeId,
	    }),
	  }));
	  const accepted = evaluated.find((candidate) => !candidate.belowClearanceThreshold) ?? evaluated[0];
  const candidatePendingBranchCorridorConflictRows = evaluated
    .filter((candidate) => candidate.overlapsProtectedPendingBranchCorridor)
    .map((candidate) => ({
      edgeId: edge.id,
      side: candidate.side,
      laneRank: candidate.laneRank,
      laneX: candidate.laneX,
      blockerPendingCorridorId: candidate.nearestPendingBranchCorridorId,
      pendingCorridorPart: candidate.nearestPendingBranchCorridorPart,
      clearance: Number.isFinite(candidate.nearestPendingBranchCorridorClearance)
        ? candidate.nearestPendingBranchCorridorClearance
        : null,
      routePoints: candidate.points,
    }));
	  return {
	    ...makeRoute(edge, accepted.points, "sketchV2BackwardJump"),
	    sketchV2LoopReturnDiagnostic: {
      edgeId: edge.id,
      source: edge.from ?? null,
      target: edge.to ?? null,
      side: accepted.side,
      reason: accepted.reason,
      laneRank: accepted.laneRank,
      laneX: accepted.laneX,
      nearestUnrelatedEdgeLaneClearance: Number.isFinite(accepted.nearestEdgeLaneClearance)
        ? accepted.nearestEdgeLaneClearance
        : null,
      nearestSplitExitLaneClearance: Number.isFinite(accepted.nearestSplitExitLaneClearance)
        ? accepted.nearestSplitExitLaneClearance
        : null,
      nearestPendingBranchCorridorClearance: Number.isFinite(accepted.nearestPendingBranchCorridorClearance)
        ? accepted.nearestPendingBranchCorridorClearance
        : null,
      nearestPendingBranchCorridorId: accepted.nearestPendingBranchCorridorId ?? null,
      nearestPendingBranchCorridorPart: accepted.nearestPendingBranchCorridorPart ?? null,
      nearestDiamondClearance: Number.isFinite(accepted.nearestDiamondClearance)
        ? accepted.nearestDiamondClearance
        : null,
      nearestNodeClearance: Number.isFinite(accepted.nearestNodeClearance)
        ? accepted.nearestNodeClearance
        : null,
      passesThroughExpandedDiamondObstacle: accepted.passesThroughExpandedDiamondObstacle,
      overlapsProtectedSplitExitLane: accepted.overlapsProtectedSplitExitLane,
      overlapsUnrelatedEdgeLane: accepted.overlapsUnrelatedEdgeLane,
	      overlapsProtectedPendingBranchCorridor: accepted.overlapsProtectedPendingBranchCorridor,
      candidatePendingBranchCorridorConflictRows,
	      belowClearanceThreshold: accepted.belowClearanceThreshold,
	      threshold: SKETCH_V2_LANE_CLEARANCE,
      segments: routeSegments(accepted.points),
    },
  };
}

function routeBetweenPlacements({
  edge,
  sourcePlacement,
  targetPlacement,
  layout,
  params,
  depth = 0,
  alreadyDrawnTarget = false,
  placedByNodeId = new Map(),
  edgeRouteById = new Map(),
  edgesById = new Map(),
  instructionNodeByIndex = new Map(),
  instructionCount = 0,
  pendingCorridorByEdgeId = new Map(),
}) {
  const fromBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const toBounds = getNodeBoundsAt(targetPlacement.node, targetPlacement, layout);

  if (sourcePlacement.node.kind === "conditionalJump" && edge.branch) {
    const anchors = getDiamondAnchors(fromBounds);
    const start = edge.branch === "no"
      ? anchors.lowerLeftSideCenter
      : anchors.lowerRightSideCenter;
    const end = getTopPort(toBounds);
    return makeDiamondExitRoute({ edge, start, end, layout, alreadyDrawnTarget });
  }

  if (
    Number.isInteger(edge.sourceIndex) &&
    Number.isInteger(edge.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  ) {
    return makeLoopReturnRoute({
      edge,
      fromBounds,
      toBounds,
      layout,
      params,
      depth,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionNodeByIndex,
      instructionCount,
      pendingCorridorByEdgeId,
    });
  }

  if (targetPlacement.node.kind === "halt") {
    return makeRoute(edge, [getRightPort(fromBounds), getLeftPort(toBounds)], "sketchV2HaltExit");
  }

  return makeRoute(edge, [getBottomPort(fromBounds), getTopPort(toBounds)], "sketchV2Continuation");
}

function assignRoute(edge, route, edgeRouteById) {
  if (!edge || !route) return;
  edgeRouteById.set(edge.id, route);
  edge.sketchV2ReservedRoute = route;
}

function getBranchPosition({ edge, sourcePlacement, targetNode, layout, params, depth }) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const start = edge.branch === "no" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
  const direction = edge.branch === "no" ? -1 : 1;
  const distance = getSplitDistance(params, depth);
  const routeDy = distance * getAngleTangent(layout);
  const targetSize = getNodeSize(targetNode, layout);
  return {
    x: start[0] + direction * distance,
    y: start[1] + routeDy + targetSize.height / 2,
  };
}

function getBranchPlacementCandidate({ edge, sourcePlacement, targetNode, layout, params, depth, distanceScale = 1, extraY = 0 }) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const start = edge.branch === "no" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
  const direction = edge.branch === "no" ? -1 : 1;
  const distance = Math.max(48, getSplitDistance(params, depth) * distanceScale);
  const targetSize = getNodeSize(targetNode, layout);
  const position = {
    x: start[0] + direction * distance,
    y: start[1] + distance * getAngleTangent(layout) + targetSize.height / 2 + extraY,
  };
  const targetBounds = getNodeBoundsAt(targetNode, position, layout);
  return {
    position,
    route: makeDiamondExitRoute({
      edge,
      start,
      end: getTopPort(targetBounds),
      layout,
      alreadyDrawnTarget: false,
    }),
    distance,
    distanceScale,
    extraY,
  };
}

function getBranchPlacementCandidates(args) {
  return [1, 0.82, 1.18, 0.68, 1.36, 1.58, 0.56].map((distanceScale) => (
    getBranchPlacementCandidate({
      ...args,
      distanceScale,
      extraY: 0,
    })
  ));
}

function getContinuationPlacementCandidates({ position, params }) {
  return [0, 0.35, 0.7, 1.1].map((scale) => ({
    position: {
      x: position.x,
      y: position.y + params.ordinaryStepY * scale,
    },
    route: null,
    distanceScale: 1,
    extraY: params.ordinaryStepY * scale,
  }));
}

function evaluatePlacementCandidate({
  candidate,
  node,
  incomingEdge,
  sourcePlacement,
  layout,
  params,
  depth,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  instructionCount,
  pendingCorridorByEdgeId,
}) {
  const targetPlacement = { node, x: candidate.position.x, y: candidate.position.y };
  const route = candidate.route ?? (incomingEdge && sourcePlacement
    ? routeBetweenPlacements({
        edge: incomingEdge,
        sourcePlacement,
        targetPlacement,
        layout,
        params,
        depth,
        placedByNodeId,
        edgeRouteById,
        edgesById,
        instructionNodeByIndex,
        instructionCount,
        pendingCorridorByEdgeId,
      })
    : null);
  const nodeRejection = findNodePlacementRejection({
    node,
    position: candidate.position,
    layout,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionCount,
    pendingCorridorByEdgeId,
    candidateEdgeId: incomingEdge?.id ?? null,
  });
  if (nodeRejection) return { ...candidate, route, rejection: nodeRejection };
  const routeRejection = incomingEdge && route
    ? findRouteRejection({
        edge: incomingEdge,
        route,
        layout,
        placedByNodeId,
        edgeRouteById,
        edgesById,
        instructionCount,
        pendingCorridorByEdgeId,
        excludeNodeIds: new Set([incomingEdge.from, node.id]),
        excludeEdgeIds: new Set([incomingEdge.id]),
      })
    : null;
  return { ...candidate, route, rejection: routeRejection };
}

function chooseLegalPlacement({
  candidates,
  node,
  incomingEdge,
  sourcePlacement,
  layout,
  params,
  depth,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  instructionCount,
  pendingCorridorByEdgeId,
  placementRejectionRows,
}) {
  const evaluated = candidates.map((candidate) => evaluatePlacementCandidate({
    candidate,
    node,
    incomingEdge,
    sourcePlacement,
    layout,
    params,
    depth,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionNodeByIndex,
    instructionCount,
    pendingCorridorByEdgeId,
  }));
  evaluated
    .filter((candidate) => candidate.rejection)
    .forEach((candidate) => {
      placementRejectionRows.push({
        ...candidate.rejection,
        candidateX: candidate.position.x,
        candidateY: candidate.position.y,
        candidateDistanceScale: candidate.distanceScale ?? null,
        candidateExtraY: candidate.extraY ?? null,
      });
    });
  return evaluated.find((candidate) => !candidate.rejection) ?? null;
}

function getHaltPlacement({ edge, sourcePlacement, nodeById, layout, params, placedByNodeId, placementRows }) {
  const haltNode = nodeById.get(edge.to) ?? nodeById.get("halt");
  if (!haltNode) return null;
  const existing = placedByNodeId.get(haltNode.id);
  if (existing) return existing;
  return placeNode(
    haltNode,
    {
      x: sourcePlacement.x + params.haltDistance,
      y: sourcePlacement.y,
    },
    placedByNodeId,
    placementRows,
    "halt",
    edge,
  );
}

function getPlacedBounds(placedByNodeId, layout) {
  const boxes = getPlacedNodeBoxes(placedByNodeId, layout).map((entry) => entry.box);
  if (boxes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0, centerX: 0, centerY: 0 };
  }
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function getSharedHaltNode({ nodes, nodeById }) {
  const existingHalt = nodeById.get("halt") ?? nodes.find((node) => node.kind === "halt") ?? null;
  if (existingHalt) {
    existingHalt.id = "halt";
    existingHalt.label = existingHalt.label || "HALT";
    nodeById.set("halt", existingHalt);
    return existingHalt;
  }
  const haltNode = {
    id: "halt",
    kind: "halt",
    label: "HALT",
    instructionIndices: [],
    instructionIndex: null,
  };
  nodes.push(haltNode);
  nodeById.set("halt", haltNode);
  return haltNode;
}

function buildDeferredHaltRouteCandidates({ edge, sourcePlacement, haltPlacement, layout, params, placedByNodeId, haltIndex }) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const haltBounds = getNodeBoundsAt(haltPlacement.node, haltPlacement, layout);
  const placedBounds = getPlacedBounds(placedByNodeId, layout);
  const baseLaneX = Math.max(
    placedBounds.right + params.haltDistance,
    sourceBounds.right + params.haltDistance * 0.65,
    haltBounds.left - params.haltDistance * 0.45,
  );
  const laneStep = Math.max(SKETCH_V2_LANE_CLEARANCE * 3, params.loopLaneDistance * 0.5);
  const start = getRightPort(sourceBounds);
  const end = getLeftPort(haltBounds);
  const approachStep = Math.max(params.ordinaryStepY * 0.6, SKETCH_V2_LANE_CLEARANCE * 3);
  const approachOffsets = [
    -(haltIndex + 1) * approachStep,
    (haltIndex + 1) * approachStep,
    -(haltIndex + 2) * approachStep,
    (haltIndex + 2) * approachStep,
    -(haltIndex + 3) * approachStep,
    (haltIndex + 3) * approachStep,
  ];
  return Array.from({ length: 8 }, (_, rank) => {
    const laneX = baseLaneX + rank * laneStep;
    return approachOffsets.flatMap((approachOffset, approachRank) => {
      const approachY = end[1] + approachOffset;
      const minDogleg = Math.max(SKETCH_V2_LANE_CLEARANCE * 3, params.haltDistance * 0.35);
      const doglegXs = [
        start[0] + minDogleg,
        start[0] + minDogleg * 2.4,
        laneX,
      ].filter((value, index, values) => values.findIndex((candidate) => Math.abs(candidate - value) < 0.001) === index);
      return doglegXs.map((doglegX, doglegRank) => ({
        laneRank: rank,
        approachRank,
        doglegRank,
        laneX,
        doglegX,
        approachY,
        route: makeRoute(
          edge,
          Math.abs(approachY - start[1]) <= 0.001
            ? [start, [laneX, start[1]], end]
            : [start, [doglegX, start[1]], [doglegX, approachY], [laneX, approachY], end],
          "sketchV2HaltExit",
        ),
      }));
    });
  }).flat();
}

function commitDeferredHaltRoutes({
  haltExits,
  nodes,
  nodeById,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  pendingCorridorByEdgeId,
  placementRows,
  layout,
  params,
  instructionCount,
  failures,
}) {
  if (haltExits.length === 0) {
    return {
      sharedHaltNodeId: null,
      haltRows: [],
      haltConflictRows: [],
      haltCommittedBeforeOrdinaryPlacementComplete: false,
    };
  }

  const ordinaryPlacementCompleteOrder = placementRows.length - 1;
  const sharedHaltNode = getSharedHaltNode({ nodes, nodeById });
  const placedBounds = getPlacedBounds(placedByNodeId, layout);
  const sourceYs = haltExits
    .map((entry) => entry.sourcePlacement?.y)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const medianY = sourceYs.length > 0
    ? sourceYs[Math.floor(sourceYs.length / 2)]
    : placedBounds.centerY;
  const sharedHaltPosition = {
    x: placedBounds.right + params.haltDistance * 2.2,
    y: medianY,
  };
  const haltPlacement = placeNode(
    sharedHaltNode,
    sharedHaltPosition,
    placedByNodeId,
    placementRows,
    "deferredSharedHalt",
    null,
  );
  const haltRows = [];
  const haltConflictRows = [];

  haltExits.forEach(({ edge, sourcePlacement, depth, recordedOrder }, haltIndex) => {
    edge.to = sharedHaltNode.id;
    const candidates = buildDeferredHaltRouteCandidates({
      edge,
      sourcePlacement,
      haltPlacement,
      layout,
      params,
      placedByNodeId,
      haltIndex,
    });
    const evaluated = candidates.map((candidate) => {
      const rejection = findRouteRejection({
        edge,
        route: candidate.route,
        layout,
        placedByNodeId,
        edgeRouteById,
        edgesById,
        instructionCount,
        pendingCorridorByEdgeId,
        excludeNodeIds: new Set([edge.from, sharedHaltNode.id]),
        excludeEdgeNodeIds: new Set([edge.from]),
        excludeEdgeIds: new Set([edge.id]),
      });
      return { ...candidate, rejection };
    });
    const accepted = evaluated.find((candidate) => !candidate.rejection) ?? null;
    if (!accepted) {
      const firstRejection = evaluated[0]?.rejection ?? null;
      const failure = {
        edgeId: edge.id,
        reason: "sketchV2NoLegalHaltRoute",
        source: edge.from ?? null,
        target: sharedHaltNode.id,
        depth,
        firstRejection,
      };
      failures.push(failure);
      haltConflictRows.push(failure);
      return;
    }

    assignRoute(edge, {
      ...accepted.route,
      sketchV2DeferredHaltDiagnostic: {
        edgeId: edge.id,
        source: edge.from ?? null,
        target: sharedHaltNode.id,
        laneX: accepted.laneX,
        laneRank: accepted.laneRank,
        doglegX: accepted.doglegX,
        doglegRank: accepted.doglegRank,
        approachY: accepted.approachY,
        approachRank: accepted.approachRank,
        recordedOrder,
        committedOrder: placementRows.length,
        ordinaryPlacementCompleteOrder,
      },
    }, edgeRouteById);
    haltRows.push({
      edgeId: edge.id,
      source: edge.from ?? null,
      target: sharedHaltNode.id,
      laneX: accepted.laneX,
      laneRank: accepted.laneRank,
      doglegX: accepted.doglegX,
      doglegRank: accepted.doglegRank,
      approachY: accepted.approachY,
      approachRank: accepted.approachRank,
      recordedOrder,
      committedAfterOrdinaryPlacementComplete: true,
      routePoints: accepted.route.points,
    });
  });

  return {
    sharedHaltNodeId: sharedHaltNode.id,
    haltRows,
    haltConflictRows,
    haltCommittedBeforeOrdinaryPlacementComplete:
      haltRows.some((row) => row.committedAfterOrdinaryPlacementComplete !== true),
  };
}

function buildDiamondDiagnostics(edges, edgeRouteById, layout, instructionCount, instructionNodeByIndex) {
  const expectedTangent = getAngleTangent(layout);
  const rows = edges
    .filter((edge) => (
      edge.branch &&
      instructionNodeByIndex.get(edge.sourceIndex)?.kind === "conditionalJump"
    ))
    .map((edge) => {
      const route = edgeRouteById.get(edge.id) ?? null;
      const points = route?.points ?? [];
      const start = points[0] ?? null;
      const firstEnd = points[1] ?? null;
      const finalEnd = points[points.length - 1] ?? null;
      const dx = firstEnd && start ? firstEnd[0] - start[0] : null;
      const dy = firstEnd && start ? firstEnd[1] - start[1] : null;
      const finalDx = finalEnd && start ? finalEnd[0] - start[0] : null;
      const finalDy = finalEnd && start ? finalEnd[1] - start[1] : null;
      const routeTangent = Number.isFinite(dx) && Math.abs(dx) > 0.001 && Number.isFinite(dy)
        ? Math.abs(dy / dx)
        : null;
      const finalRouteTangent = Number.isFinite(finalDx) && Math.abs(finalDx) > 0.001 && Number.isFinite(finalDy)
        ? Math.abs(finalDy / finalDx)
        : null;
      const expectedDirection = edge.branch === "no" ? -1 : 1;
      const fixedAngle = Number.isFinite(routeTangent) &&
        Math.abs(routeTangent - expectedTangent) <= SKETCH_V2_ANGLE_TOLERANCE;
      const secondStart = points[1] ?? null;
      const secondEnd = points[2] ?? null;
      const firstSegmentAxisAligned = Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        (Math.abs(dx) <= 0.001 || Math.abs(dy) <= 0.001);
      const secondSegmentAxisAligned = secondStart && secondEnd &&
        (Math.abs(secondEnd[0] - secondStart[0]) <= 0.001 ||
          Math.abs(secondEnd[1] - secondStart[1]) <= 0.001);
      const lShaped = points.length === 3 && (firstSegmentAxisAligned || secondSegmentAxisAligned);
      const fixedAngleFirstSegment = Boolean(
        points.length >= 2 &&
        Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        dy > 0 &&
        dx * expectedDirection > 0 &&
        fixedAngle,
      );
      const strictFixedAngleToTarget = Boolean(
        points.length === 2 &&
        Number.isFinite(finalDx) &&
        Number.isFinite(finalDy) &&
        finalDy > 0 &&
        finalDx * expectedDirection > 0 &&
        Number.isFinite(finalRouteTangent) &&
        Math.abs(finalRouteTangent - expectedTangent) <= SKETCH_V2_ANGLE_TOLERANCE
      );
      const role = !isInstructionTarget(edge.targetIndex, instructionCount) || edge.to?.startsWith("halt")
        ? "HALT"
        : edge.targetIndex <= edge.sourceIndex
          ? "backward"
          : route?.routeKind === "sketchV2AlreadyDrawnTarget"
            ? "already-drawn target"
            : "ordinary new target";
      const usedException = role === "HALT" || role === "backward";
      return {
        edgeId: edge.id,
        branch: edge.branch,
        role,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        pointCount: points.length,
        usesTurn: points.length > 2,
        lShaped,
        routeKind: route?.routeKind ?? null,
        routeTangent,
        finalRouteTangent,
        expectedTangent,
        fixedAngleFirstSegment,
        strictFixedAngleToTarget,
        strictFixedAngleFailureDiagnostic: role === "already-drawn target" && !strictFixedAngleToTarget
          ? route?.sketchV2AlreadyDrawnTargetDiagnostic ?? "alreadyDrawnTargetNotOnFixedAngleRay"
          : null,
        usedException,
        sideOwnershipPreserved: Number.isFinite(dx) ? dx * expectedDirection > 0 : false,
        points,
      };
    });

  return {
    rows,
    lShapedRows: rows.filter((row) => row.lShaped),
    nonStraightRows: rows.filter((row) => (
      !row.usedException &&
      !row.fixedAngleFirstSegment
    )),
    sideOwnershipRows: rows.filter((row) => !row.usedException && !row.sideOwnershipPreserved),
  };
}

function buildLoopReturnDiagnostics(edgeRouteById) {
  return Array.from(edgeRouteById.entries())
    .map(([edgeId, route]) => route?.sketchV2LoopReturnDiagnostic
      ? { ...route.sketchV2LoopReturnDiagnostic, edgeId }
      : null)
    .filter(Boolean);
}

export function applySketchV2Layout(layoutPlan) {
  if (layoutPlan.layoutMode !== SKETCH_V2_LAYOUT_MODE) {
    return { layoutPlan, diagnostics: { sketchV2Enabled: false } };
  }

  const layout = layoutPlan.layout;
  const instructionCount = layoutPlan.analysis.program.length;
  const params = buildSketchV2Parameters(layout);
  const nodes = layoutPlan.nodes.map((node) => ({ ...node }));
  const edges = layoutPlan.edges.map((edge) => ({ ...edge }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const instructionNodes = getInstructionNodes({ nodes });
  const instructionNodeByIndex = buildInstructionNodeLookup(instructionNodes);
  const outgoingBySource = getOutgoingEdges(edges);
  const startNode = nodeById.get("start") ?? null;
  const placedByNodeId = new Map();
  const edgeRouteById = new Map();
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const placementRows = [];
  const traversalRows = [];
  const pendingYesStack = [];
  const haltExits = [];
  const placementRejectionRows = [];
  const pendingCorridorByEdgeId = new Map();
  const pendingCorridorRows = [];
  const failures = [];

  if (startNode) {
    placeNode(startNode, { x: 0, y: 0 }, placedByNodeId, placementRows, "start");
  }

  const connectToExistingOrHalt = ({ edge, sourcePlacement, depth }) => {
    if (!edge || !sourcePlacement) return false;
    if (isHaltEdge(edge, instructionCount)) {
      haltExits.push({
        edge,
        sourcePlacement,
        depth,
        recordedOrder: placementRows.length,
      });
      return true;
    }

    const targetNode = instructionNodeByIndex.get(edge.targetIndex);
    if (!targetNode) {
      failures.push({ edgeId: edge.id, reason: "targetNodeMissing" });
      return true;
    }
    const targetPlacement = placedByNodeId.get(targetNode.id);
    if (!targetPlacement) return false;
    const route = routeBetweenPlacements({
      edge,
      sourcePlacement,
      targetPlacement,
      layout,
      params,
      depth,
      alreadyDrawnTarget: true,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionNodeByIndex,
      instructionCount,
      pendingCorridorByEdgeId,
    });
    const rejection = findRouteRejection({
      edge,
      route,
      layout,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionCount,
      pendingCorridorByEdgeId,
      excludeNodeIds: new Set([edge.from, edge.to]),
      excludeEdgeIds: new Set([edge.id]),
    });
    if (rejection) {
      placementRejectionRows.push(rejection);
      failures.push({
        edgeId: edge.id,
        reason: "sketchV2NoLegalAlreadyDrawnTargetRoute",
        rejection,
        routeDiagnostic: route?.sketchV2LoopReturnDiagnostic ?? null,
      });
      return true;
    }
    assignRoute(edge, route, edgeRouteById);
    return true;
  };

  const walkFrom = ({
    instructionIndex,
    position,
    incomingEdge = null,
    depth = 0,
    placementKind = "continuation",
    branchPath = [],
  }) => {
    let index = instructionIndex;
    let nextPosition = position;
    let incoming = incomingEdge;
    let currentBranchPath = branchPath;

    if (incomingEdge?.branch) {
      retirePendingBranchCorridor({
        edge: incomingEdge,
        pendingCorridorByEdgeId,
        pendingCorridorRows,
        removedOrder: placementRows.length,
        removedReason: "poppedForDrawing",
        convertedEdgeId: incomingEdge.id,
      });
    }

    while (isInstructionTarget(index, instructionCount)) {
      const node = instructionNodeByIndex.get(index);
      if (!node) {
        failures.push({ instructionIndex: index, reason: "instructionNodeMissing" });
        return;
      }
      const existingPlacement = placedByNodeId.get(node.id);
      if (existingPlacement) {
        const sourcePlacement = incoming
          ? placedByNodeId.get(incoming.from)
          : null;
        if (incoming && sourcePlacement) {
          const route = routeBetweenPlacements({
            edge: incoming,
            sourcePlacement,
            targetPlacement: existingPlacement,
            layout,
            params,
            depth,
            alreadyDrawnTarget: true,
            placedByNodeId,
            edgeRouteById,
            edgesById,
            instructionNodeByIndex,
            instructionCount,
            pendingCorridorByEdgeId,
          });
          const rejection = findRouteRejection({
            edge: incoming,
            route,
            layout,
            placedByNodeId,
            edgeRouteById,
            edgesById,
            instructionCount,
            pendingCorridorByEdgeId,
            excludeNodeIds: new Set([incoming.from, incoming.to]),
            excludeEdgeIds: new Set([incoming.id]),
          });
          if (rejection) {
            placementRejectionRows.push(rejection);
            failures.push({
              edgeId: incoming.id,
              reason: "sketchV2NoLegalAlreadyDrawnTargetRoute",
              rejection,
              routeDiagnostic: route?.sketchV2LoopReturnDiagnostic ?? null,
            });
            return;
          }
          assignRoute(incoming, route, edgeRouteById);
        }
        return;
      }

      const sourcePlacement = incoming
        ? placedByNodeId.get(incoming.from)
        : null;
      const placementDepth = incoming?.branch ? Math.max(0, depth - 1) : depth;
      const candidates = incoming && sourcePlacement && incoming.branch && sourcePlacement.node.kind === "conditionalJump"
        ? getBranchPlacementCandidates({
            edge: incoming,
            sourcePlacement,
            targetNode: node,
            layout,
            params,
            depth: placementDepth,
          })
        : getContinuationPlacementCandidates({ position: nextPosition, params });
      const selectedCandidate = incoming && sourcePlacement
        ? chooseLegalPlacement({
            candidates,
            node,
            incomingEdge: incoming,
            sourcePlacement,
            layout,
            params,
            depth,
            placedByNodeId,
            edgeRouteById,
            edgesById,
            instructionNodeByIndex,
            instructionCount,
            pendingCorridorByEdgeId,
            placementRejectionRows,
          })
        : { position: nextPosition, route: null };
      if (!selectedCandidate) {
        failures.push({
          edgeId: incoming?.id ?? null,
          nodeId: node.id,
          reason: incoming?.branch
            ? "sketchV2NoLegalOrdinaryDiamondSplitPlacement"
            : "sketchV2NoLegalOrdinaryPlacement",
        });
        return;
      }

      const placement = placeNode(node, selectedCandidate.position, placedByNodeId, placementRows, placementKind, incoming);
      traversalRows.push({
        order: traversalRows.length,
        instructionIndex: index,
        nodeId: node.id,
        placementKind,
        depth,
      });

      if (incoming && selectedCandidate.route) {
        assignRoute(incoming, selectedCandidate.route, edgeRouteById);
      }

      const outgoing = outgoingBySource.get(index) ?? [];
      const noEdge = outgoing.find((edge) => edge.branch === "no") ?? null;
      const yesEdge = outgoing.find((edge) => edge.branch === "yes") ?? null;

      if (noEdge || yesEdge) {
        if (yesEdge) {
          if (!connectToExistingOrHalt({ edge: yesEdge, sourcePlacement: placement, depth: depth + 1 })) {
            const targetNode = instructionNodeByIndex.get(yesEdge.targetIndex);
            if (targetNode) {
              const pendingPosition = getBranchPosition({
                edge: yesEdge,
                sourcePlacement: placement,
                targetNode,
                layout,
                params,
                depth,
              });
              const pendingBranchPath = [...currentBranchPath, yesEdge.id];
              const pendingCorridor = makePendingBranchCorridor({
                edge: yesEdge,
                sourcePlacement: placement,
                targetNode,
                position: pendingPosition,
                layout,
                params,
                depth: depth + 1,
                branchPath: pendingBranchPath,
                createdOrder: placementRows.length,
              });
              pendingCorridorByEdgeId.set(yesEdge.id, pendingCorridor);
              pendingCorridorRows.push({
                ...pendingCorridor,
                footprint: { ...pendingCorridor.footprint },
                segments: pendingCorridor.segments.map((segment) => ({ ...segment })),
              });
              pendingYesStack.push({
                instructionIndex: yesEdge.targetIndex,
                position: pendingPosition,
                incomingEdge: yesEdge,
                depth: depth + 1,
                placementKind: "yesBranchTarget",
                branchPath: pendingBranchPath,
              });
            }
          }
        }

        if (!noEdge || connectToExistingOrHalt({ edge: noEdge, sourcePlacement: placement, depth: depth + 1 })) {
          return;
        }
        const noTargetNode = instructionNodeByIndex.get(noEdge.targetIndex);
        if (!noTargetNode) {
          failures.push({ edgeId: noEdge.id, reason: "noTargetNodeMissing" });
          return;
        }
        index = noEdge.targetIndex;
        nextPosition = getBranchPosition({
          edge: noEdge,
          sourcePlacement: placement,
          targetNode: noTargetNode,
          layout,
          params,
          depth,
        });
        incoming = noEdge;
        placementKind = "noBranchTarget";
        currentBranchPath = [...currentBranchPath, noEdge.id];
        depth += 1;
        continue;
      }

      const continuationEdge =
        outgoing.find((edge) => edge.targetIndex === index + 1) ??
        outgoing.find((edge) => Number.isInteger(edge.targetIndex)) ??
        outgoing[0] ??
        null;
      if (!continuationEdge || connectToExistingOrHalt({ edge: continuationEdge, sourcePlacement: placement, depth })) {
        return;
      }

      index = continuationEdge.targetIndex;
      nextPosition = {
        x: placement.x,
        y: placement.y + params.ordinaryStepY,
      };
      incoming = continuationEdge;
      placementKind = "continuation";
    }
  };

  const startEdge = edges.find((edge) => edge.id === "start-edge");
  if (startNode && startEdge && isInstructionTarget(0, instructionCount)) {
    walkFrom({
      instructionIndex: 0,
      position: { x: 0, y: params.ordinaryStepY },
      incomingEdge: startEdge,
      depth: 0,
      placementKind: "entry",
      branchPath: [],
    });
  }

  while (pendingYesStack.length > 0) {
    walkFrom(pendingYesStack.pop());
  }

  const unplacedInstructionNodes = instructionNodes.filter((node) => !placedByNodeId.has(node.id));
  if (unplacedInstructionNodes.length > 0) {
    failures.push({
      reason: "unplacedInstructionNodes",
      nodeIds: unplacedInstructionNodes.map((node) => node.id),
    });
  }

  const deferredHaltResult = commitDeferredHaltRoutes({
    haltExits,
    nodes,
    nodeById,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    pendingCorridorByEdgeId,
    placementRows,
    layout,
    params,
    instructionCount,
    failures,
  });

  const diamondDiagnostics = buildDiamondDiagnostics(
    edges,
    edgeRouteById,
    layout,
    instructionCount,
    instructionNodeByIndex,
  );
  const loopReturnDiagnostics = buildLoopReturnDiagnostics(edgeRouteById);
  const fallbackRequired = failures.length > 0;
  const diagnostics = {
    sketchV2Enabled: true,
    sketchV2FallbackUsed: fallbackRequired,
    sketchV2FallbackReason: fallbackRequired ? "sketchV2FirstPassPlacementFailed" : null,
    sketchV2FailureRows: failures,
    sketchV2PlacementRejectionRows: placementRejectionRows,
    sketchV2PlacementRows: placementRows,
    sketchV2TraversalRows: traversalRows,
    sketchV2PendingBranchCorridorRows: pendingCorridorRows,
    sketchV2PendingBranchCorridorConflictRows: placementRejectionRows.filter((row) => (
      row.blockingGeometryRole === "pending branch corridor"
    )),
    sketchV2DeferredHaltRows: deferredHaltResult.haltRows,
    sketchV2DeferredHaltConflictRows: deferredHaltResult.haltConflictRows,
    sketchV2HaltCommittedBeforeOrdinaryPlacementComplete:
      deferredHaltResult.haltCommittedBeforeOrdinaryPlacementComplete,
    sketchV2SharedHaltNodeId: deferredHaltResult.sharedHaltNodeId,
    sketchV2PendingYesLifoUsed: true,
    sketchV2DiamondExitRows: diamondDiagnostics.rows,
    sketchV2NonStraightDiamondExitRows: diamondDiagnostics.nonStraightRows,
    sketchV2LShapedDiamondExitRows: diamondDiagnostics.lShapedRows,
    sketchV2NoYesSideOwnershipRows: diamondDiagnostics.sideOwnershipRows,
    sketchV2LoopReturnRows: loopReturnDiagnostics,
    sketchV2LoopReturnBelowClearanceRows:
      loopReturnDiagnostics.filter((row) => row.belowClearanceThreshold),
    sketchV2LoopReturnDiamondObstacleRows:
      loopReturnDiagnostics.filter((row) => row.passesThroughExpandedDiamondObstacle),
    sketchV2LoopReturnSplitExitLaneConflictRows:
      loopReturnDiagnostics.filter((row) => row.overlapsProtectedSplitExitLane),
    sketchV2LoopReturnUnrelatedEdgeLaneConflictRows:
      loopReturnDiagnostics.filter((row) => row.overlapsUnrelatedEdgeLane),
    sketchV2OrdinaryDiamondSplitExitNotStraightFixedAngle:
      diamondDiagnostics.nonStraightRows.length > 0,
    sketchV2OrdinaryDiamondSplitExitLShaped:
      diamondDiagnostics.lShapedRows.length > 0,
    sketchV2NoYesSideOwnershipPreserved:
      diamondDiagnostics.sideOwnershipRows.length === 0,
    sketchV2Parameters: params,
  };

  if (fallbackRequired) {
    const error = new Error("sketchV2FirstPassPlacementFailed");
    error.sketchV2FallbackDiagnostics = diagnostics;
    throw error;
  }

  edges.forEach((edge) => {
    const route = edgeRouteById.get(edge.id);
    if (route) edge.sketchV2ReservedRoute = route;
  });
  const returnedNodes = deferredHaltResult.sharedHaltNodeId
    ? nodes.filter((node) => node.kind !== "halt" || node.id === deferredHaltResult.sharedHaltNodeId)
    : nodes;

  return {
    layoutPlan: {
      ...layoutPlan,
      nodes: returnedNodes,
      nodeMap: new Map(returnedNodes.map((node) => [node.id, node])),
      edges,
      analysis: {
        ...layoutPlan.analysis,
        layoutMode: SKETCH_V2_LAYOUT_MODE,
      },
      sketchV2PlacementDebug: diagnostics,
    },
    diagnostics,
  };
}
