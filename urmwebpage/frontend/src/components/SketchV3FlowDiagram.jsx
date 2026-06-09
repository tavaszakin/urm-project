const SKETCH_V3_LAYOUT_MODE = "sketchV3";
const SKETCH_V3_ANGLE_TOLERANCE = 0.08;
const SKETCH_V3_LANE_CLEARANCE = 16;
const SKETCH_V3_DIAMOND_OBSTACLE_MARGIN = 24;

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
  if (isHaltEdge(edge, instructionCount) || route?.routeKind === "sketchV3HaltExit") return "HALT";
  if (
    Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  ) {
    return "loop return";
  }
  if (route?.routeKind === "sketchV3AlreadyDrawnTarget") return "already-drawn target";
  if (edge?.branch) return "split exit";
  return "ordinary";
}

function classifyOrdinaryRouteEdge(edge, sourceRecord = null, targetRecord = null, instructionCount = 0) {
  if (isHaltEdge(edge, instructionCount)) return "halt-exit";
  if (
    Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  ) {
    return "loop-back";
  }
  if (
    Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex === edge.sourceIndex + 1
  ) {
    return "fallthrough";
  }
  const sourcePath = sourceRecord?.branchPath ?? [];
  const targetPath = targetRecord?.branchPath ?? [];
  const sharedPrefixLength = sourcePath.findIndex((entry, index) => entry !== targetPath[index]);
  const prefixLength = sharedPrefixLength === -1
    ? Math.min(sourcePath.length, targetPath.length)
    : sharedPrefixLength;
  if (sourcePath.length !== targetPath.length && prefixLength === Math.min(sourcePath.length, targetPath.length)) {
    return "branch-rejoin";
  }
  return "forward-jump";
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

function buildSketchV3Parameters(layout) {
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
    return makeRoute(edge, [start, end], edge.branch === "no" ? "sketchV3NoSplitDiagonal" : "sketchV3YesSplitDiagonal");
  }

  const expectedTangent = getAngleTangent(layout);
  const directDx = end[0] - start[0];
  const directDy = end[1] - start[1];
  const directTangent = Math.abs(directDy / directDx);
  const targetOnRay = directDy > 0 &&
    directDx * expectedDirection > 0 &&
    Number.isFinite(directTangent) &&
    Math.abs(directTangent - expectedTangent) <= SKETCH_V3_ANGLE_TOLERANCE;

  if (targetOnRay) {
    return {
      ...makeRoute(edge, [start, end], "sketchV3AlreadyDrawnTarget"),
      sketchV3AlreadyDrawnTargetOnFixedAngleRay: true,
    };
  }

  const exitDx = Math.max(48, Math.min(120, Math.abs(directDx) * 0.35 || 72));
  const fixedExit = [
    start[0] + expectedDirection * exitDx,
    start[1] + exitDx * expectedTangent,
  ];
  return {
    ...makeRoute(edge, [start, fixedExit, end], "sketchV3AlreadyDrawnTarget"),
    sketchV3AlreadyDrawnTargetOnFixedAngleRay: false,
    sketchV3AlreadyDrawnTargetDiagnostic: "targetNotOnFixedAngleRay",
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

function clonePoint(point) {
  return Array.isArray(point) ? [point[0], point[1]] : null;
}

function clonePoints(points) {
  return Array.isArray(points)
    ? points.map((point) => clonePoint(point)).filter(Boolean)
    : [];
}

function cloneBounds(bounds) {
  return bounds
    ? {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        centerX: bounds.centerX,
        centerY: bounds.centerY,
      }
    : null;
}

function cloneBranchPath(branchPath) {
  return Array.isArray(branchPath) ? [...branchPath] : [];
}

function branchPathStartsWith(branchPath, prefix) {
  if (!Array.isArray(branchPath) || !Array.isArray(prefix)) return false;
  if (prefix.length > branchPath.length) return false;
  return prefix.every((entry, index) => entry === branchPath[index]);
}

function getBranchSideFromPathEntry(entry) {
  if (typeof entry !== "string") return null;
  if (entry.endsWith("-yes")) return "right";
  if (entry.endsWith("-no")) return "left";
  return null;
}

function getSiblingBranchPathEntry(entry) {
  if (typeof entry !== "string") return null;
  if (entry.endsWith("-yes")) return `${entry.slice(0, -4)}-no`;
  if (entry.endsWith("-no")) return `${entry.slice(0, -3)}-yes`;
  return null;
}

function hasDeferredHaltExitInBranchPath(drawingState, branchPath) {
  if (!drawingState || !Array.isArray(branchPath)) return false;
  return drawingState.haltExits.some((haltExit) => (
    branchPathStartsWith(haltExit.sourceBranchPath ?? [], branchPath)
  ));
}

function getPreferredLoopReturnSide({ edge, drawingState }) {
  if (
    !edge ||
    !drawingState ||
    !Number.isInteger(edge.sourceIndex) ||
    !Number.isInteger(edge.targetIndex) ||
    edge.targetIndex > edge.sourceIndex
  ) {
    return null;
  }
  const sourceRecord = drawingState.nodesById.get(edge.from) ?? null;
  const targetRecord = drawingState.nodesById.get(edge.to) ?? null;
  const sourceBranchPath = sourceRecord?.branchPath ?? [];
  const targetBranchPath = targetRecord?.branchPath ?? [];
  if (
    sourceBranchPath.length === 0 ||
    !branchPathStartsWith(sourceBranchPath, targetBranchPath)
  ) {
    return null;
  }
  const firstExtraEntry = sourceBranchPath[targetBranchPath.length];
  if (!firstExtraEntry) return null;
  return getBranchSideFromPathEntry(firstExtraEntry) ?? null;
}

function getIncomingSide(incomingEdge) {
  if (!incomingEdge) return null;
  if (incomingEdge.branch === "yes" || incomingEdge.branch === "no") return incomingEdge.branch;
  if (incomingEdge.id === "start-edge") return "entry";
  return "continuation";
}

function getLocalRole(node, placementKind) {
  if (node.kind === "conditionalJump") return "diamond";
  if (node.kind === "start") return "start";
  if (node.kind === "halt") return "halt";
  return placementKind ?? "continuation";
}

function makeInitialNodeRecord(node) {
  return {
    id: node.id,
    instructionIndex: Number.isInteger(node.instructionIndex) ? node.instructionIndex : null,
    x: null,
    y: null,
    bounds: null,
    placedOrder: null,
    incomingEdgeId: null,
    incomingSide: null,
    parentDiamondId: null,
    branchPath: [],
    localRole: getLocalRole(node, null),
  };
}

function makeInitialEdgeRecord(edge) {
  return {
    id: edge.id,
    sourceId: edge.from ?? null,
    targetId: edge.to ?? null,
    role: edge.branch ? `${edge.branch} branch` : "uncommitted",
    routePoints: [],
    sourceBranchPath: [],
    targetBranchPath: [],
    committedOrder: null,
  };
}

function makeDiamondRecord({ node, placement, layout, branchPath, existingRecord = null }) {
  const bounds = getNodeBoundsAt(node, placement, layout);
  const anchors = getDiamondAnchors(bounds);
  const tangent = getAngleTangent(layout);
  const rayDx = 72;
  return {
    id: node.id,
    instructionIndex: Number.isInteger(node.instructionIndex) ? node.instructionIndex : null,
    branchPath: cloneBranchPath(branchPath),
    noExitRay: {
      start: clonePoint(anchors.lowerLeftSideCenter),
      end: [anchors.lowerLeftSideCenter[0] - rayDx, anchors.lowerLeftSideCenter[1] + rayDx * tangent],
    },
    yesExitRay: {
      start: clonePoint(anchors.lowerRightSideCenter),
      end: [anchors.lowerRightSideCenter[0] + rayDx, anchors.lowerRightSideCenter[1] + rayDx * tangent],
    },
    noBranchStart: clonePoint(anchors.lowerLeftSideCenter),
    yesBranchStart: clonePoint(anchors.lowerRightSideCenter),
    pendingBranchIds: existingRecord?.pendingBranchIds ? [...existingRecord.pendingBranchIds] : [],
    protectedCorridorIds: existingRecord?.protectedCorridorIds ? [...existingRecord.protectedCorridorIds] : [],
  };
}

function createSketchV3DrawingState({ nodes, edges }) {
  return {
    nodesById: new Map(nodes.map((node) => [node.id, makeInitialNodeRecord(node)])),
    diamondsById: new Map(),
    edgesById: new Map(edges.map((edge) => [edge.id, makeInitialEdgeRecord(edge)])),
    pendingBranches: [],
    pendingCorridors: new Map(),
    haltExits: [],
    activeBranchPath: [],
    diagnostics: {
      branchPathRows: [],
      pendingBranchRows: [],
    },
  };
}

function recordNodePlacement({
  drawingState,
  node,
  placement,
  layout,
  placedOrder,
  incomingEdge = null,
  placementKind,
  branchPath = [],
}) {
  if (!drawingState) return;
  const bounds = getNodeBoundsAt(node, placement, layout);
  const record = {
    id: node.id,
    instructionIndex: Number.isInteger(node.instructionIndex) ? node.instructionIndex : null,
    x: placement.x,
    y: placement.y,
    bounds: cloneBounds(bounds),
    placedOrder,
    incomingEdgeId: incomingEdge?.id ?? null,
    incomingSide: getIncomingSide(incomingEdge),
    parentDiamondId: incomingEdge?.branch ? incomingEdge.from ?? null : null,
    branchPath: cloneBranchPath(branchPath),
    localRole: getLocalRole(node, placementKind),
  };
  drawingState.nodesById.set(node.id, record);
  drawingState.diagnostics.branchPathRows.push({
    nodeId: node.id,
    instructionIndex: record.instructionIndex,
    placedOrder,
    branchPath: cloneBranchPath(record.branchPath),
  });

  if (node.kind === "conditionalJump") {
    const existingRecord = drawingState.diamondsById.get(node.id) ?? null;
    drawingState.diamondsById.set(node.id, makeDiamondRecord({
      node,
      placement,
      layout,
      branchPath,
      existingRecord,
    }));
  }
}

function recordEdgeCommit({ drawingState, edge, route, committedOrder, instructionCount }) {
  if (!drawingState || !edge || !route) return;
  const sourceRecord = drawingState.nodesById.get(edge.from) ?? null;
  const targetRecord = drawingState.nodesById.get(edge.to) ?? null;
  drawingState.edgesById.set(edge.id, {
    id: edge.id,
    sourceId: edge.from ?? null,
    targetId: edge.to ?? null,
    role: getRouteGeometryRole(edge, route, instructionCount),
    routePoints: clonePoints(route.points),
    sourceBranchPath: cloneBranchPath(sourceRecord?.branchPath),
    targetBranchPath: cloneBranchPath(targetRecord?.branchPath),
    committedOrder,
  });
}

function recordPendingBranchQueued({ drawingState, pendingBranch }) {
  if (!drawingState || !pendingBranch?.incomingEdge) return null;
  const edge = pendingBranch.incomingEdge;
  const record = {
    id: `pending-branch-${edge.id}`,
    edgeId: edge.id,
    sourceId: edge.from ?? null,
    targetId: edge.to ?? null,
    targetInstructionIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
    side: edge.branch ?? null,
    branchPath: cloneBranchPath(pendingBranch.branchPath),
    pushedOrder: pendingBranch.pushedOrder ?? null,
    poppedOrder: null,
    status: "queued",
  };
  drawingState.pendingBranches.push(record);
  drawingState.diagnostics.pendingBranchRows.push(record);

  const diamond = drawingState.diamondsById.get(edge.from);
  if (diamond && !diamond.pendingBranchIds.includes(record.id)) {
    diamond.pendingBranchIds.push(record.id);
  }

  return record;
}

function popPendingBranch(drawingState, pendingBranchStack, poppedOrder) {
  const pendingBranch = pendingBranchStack.pop();
  if (!pendingBranch) return null;
  const record = drawingState?.pendingBranches.find((entry) => (
    entry.id === pendingBranch.pendingBranchRecordId
  ));
  if (record) {
    record.status = "drawing";
    record.poppedOrder = poppedOrder;
  }
  return pendingBranch;
}

function recordPendingCorridorCreated({ drawingState, corridor }) {
  if (!drawingState || !corridor) return;
  drawingState.pendingCorridors.set(corridor.pendingEdgeId, corridor);
  const diamond = drawingState.diamondsById.get(corridor.ownerDiamond);
  if (diamond && !diamond.protectedCorridorIds.includes(corridor.id)) {
    diamond.protectedCorridorIds.push(corridor.id);
  }
}

function recordPendingCorridorRetired({
  drawingState,
  edge,
  removedOrder,
  removedReason,
  convertedEdgeId = null,
}) {
  if (!drawingState || !edge) return;
  const corridor = drawingState.pendingCorridors.get(edge.id);
  if (!corridor) return;
  corridor.removedOrder = removedOrder;
  corridor.removedReason = removedReason;
  corridor.convertedEdgeId = convertedEdgeId;
  drawingState.pendingCorridors.delete(edge.id);
}

function recordHaltExitDeferred({ drawingState, edge, sourcePlacement, depth, recordedOrder }) {
  if (!drawingState || !edge) return null;
  const sourceRecord = drawingState.nodesById.get(edge.from) ?? null;
  const record = {
    id: `halt-exit-${edge.id}`,
    edgeId: edge.id,
    sourceId: edge.from ?? null,
    originalTargetId: edge.to ?? null,
    sharedHaltNodeId: null,
    sourceBranchPath: cloneBranchPath(sourceRecord?.branchPath),
    depth,
    recordedOrder,
    routedOrder: null,
    routePoints: [],
  };
  drawingState.haltExits.push(record);
  return record;
}

function recordHaltExitRouted({ drawingState, haltExitRecordId, sharedHaltNodeId, route, routedOrder }) {
  if (!drawingState || !haltExitRecordId) return;
  const record = drawingState.haltExits.find((entry) => entry.id === haltExitRecordId);
  if (!record) return;
  record.sharedHaltNodeId = sharedHaltNodeId;
  record.routedOrder = routedOrder;
  record.routePoints = clonePoints(route?.points);
}

function serializeMapRecords(map) {
  return Object.fromEntries(Array.from(map.entries()).map(([key, value]) => [key, value]));
}

function serializeDrawingState(drawingState) {
  const nodeRecords = Array.from(drawingState.nodesById.values());
  const diamondRecords = Array.from(drawingState.diamondsById.values());
  const edgeRecords = Array.from(drawingState.edgesById.values());
  const pendingCorridorRecords = Array.from(drawingState.pendingCorridors.values());
  return {
    nodesById: serializeMapRecords(drawingState.nodesById),
    diamondsById: serializeMapRecords(drawingState.diamondsById),
    edgesById: serializeMapRecords(drawingState.edgesById),
    pendingBranches: drawingState.pendingBranches.map((record) => ({ ...record })),
    pendingCorridors: serializeMapRecords(drawingState.pendingCorridors),
    haltExits: drawingState.haltExits.map((record) => ({ ...record })),
    activeBranchPath: cloneBranchPath(drawingState.activeBranchPath),
    diagnostics: {
      placedNodeCount: nodeRecords.filter((record) => record.placedOrder != null).length,
      diamondCount: diamondRecords.length,
      committedEdgeCount: edgeRecords.filter((record) => record.committedOrder != null).length,
      activePendingBranchCount: drawingState.pendingBranches.filter((record) => record.status === "queued").length,
      activePendingCorridorCount: pendingCorridorRecords.length,
      haltExitCount: drawingState.haltExits.length,
    },
  };
}

function placeNode(
  node,
  position,
  placedByNodeId,
  placementRows,
  placementKind,
  incomingEdge = null,
  drawingState = null,
  layout = null,
  branchPath = [],
) {
  if (placedByNodeId.has(node.id)) return placedByNodeId.get(node.id);
  node.x = position.x;
  node.y = position.y;
  const placement = { node, x: position.x, y: position.y };
  placedByNodeId.set(node.id, placement);
  const placedOrder = placementRows.length;
  placementRows.push({
    order: placedOrder,
    nodeId: node.id,
    instructionIndex: node.instructionIndex ?? null,
    edgeId: incomingEdge?.id ?? null,
    placementKind,
    x: position.x,
    y: position.y,
  });
  if (drawingState && layout) {
    recordNodePlacement({
      drawingState,
      node,
      placement,
      layout,
      placedOrder,
      incomingEdge,
      placementKind,
      branchPath,
    });
  }
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
        ? inflateBox(getNodeBoundsAt(placement.node, placement, layout), SKETCH_V3_DIAMOND_OBSTACLE_MARGIN)
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
  const continuationEnd = [bottom[0], bottom[1] + Math.max(params.ordinaryStepY * 0.75, SKETCH_V3_LANE_CLEARANCE * 3)];
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

function makePendingHaltExitCorridor({
  edge,
  sourcePlacement,
  layout,
  params,
  createdOrder,
  branchPath = [],
}) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const bottomStart = getBottomPort(sourceBounds);
  const sourceExitY = bottomStart[1] + Math.max(params.ordinaryStepY * 0.6, SKETCH_V3_LANE_CLEARANCE * 3);
  const verticalEnd = [bottomStart[0], sourceExitY];
  return {
    id: `pending-halt-${edge.id}`,
    ownerDiamond: null,
    ownerInstructionIndex: edge.sourceIndex ?? null,
    pendingEdgeId: edge.id,
    targetNodeId: edge.to ?? "halt",
    targetInstructionIndex: null,
    side: "halt",
    branchPath,
    splitDepth: null,
    createdOrder,
    removedOrder: null,
    removedReason: null,
    convertedEdgeId: null,
    footprint: {
      left: bottomStart[0] - 0.5,
      right: bottomStart[0] + 0.5,
      top: Math.min(bottomStart[1], sourceExitY),
      bottom: Math.max(bottomStart[1], sourceExitY),
      centerX: bottomStart[0],
      centerY: (bottomStart[1] + sourceExitY) / 2,
    },
    segments: [
      {
        start: bottomStart,
        end: verticalEnd,
        corridorPart: "halt-source-egress",
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
  drawingState = null,
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
  recordPendingCorridorRetired({
    drawingState,
    edge,
    removedOrder,
    removedReason,
    convertedEdgeId,
  });
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
    if (footprintDistance < SKETCH_V3_LANE_CLEARANCE) {
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
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
      if (footprintDistance < SKETCH_V3_LANE_CLEARANCE) {
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
        if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
    if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
    if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
        const candidateRole = getRouteGeometryRole(edge, route, instructionCount);
        const haltConvergenceAllowed = candidateRole === "HALT" &&
          existing.geometryRole === "HALT" &&
          edge.to === existing.targetNodeId &&
          !segmentsAreCollinear(segment, existing);
        const haltOverLoopReturnAllowed = candidateRole === "HALT" &&
          existing.geometryRole === "loop return" &&
          !segmentsAreCollinear(segment, existing);
        if (haltConvergenceAllowed || haltOverLoopReturnAllowed || (
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

function collectRouteBlockingRows({
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
  limit = 8,
}) {
  const rows = [];
  const segments = routeSegments(route?.points ?? []);
  const candidateRole = getRouteGeometryRole(edge, route, instructionCount);
  const addRow = (row) => {
    rows.push({
      ...row,
      clearance: Number.isFinite(row.clearance) ? row.clearance : null,
    });
  };

  const nodeBoxes = getCommittedNodeBoxes(placedByNodeId, layout, excludeNodeIds);
  for (const segment of segments) {
    for (const entry of nodeBoxes) {
      const distance = segmentBoxDistance(segment.start, segment.end, entry.box);
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
        addRow({
          blockerKind: "node",
          blockingGeometryId: entry.nodeId,
          blockingGeometryRole: entry.geometryRole,
          clearance: distance,
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
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
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
        addRow({
          blockerKind: "edge",
          blockingGeometryId: existing.edgeId,
          blockingGeometryRole: existing.geometryRole,
          clearance: distance,
        });
      }
    }
  }

  const corridors = getActivePendingCorridors(pendingCorridorByEdgeId, excludePendingEdgeIds);
  for (const segment of segments) {
    for (const corridor of corridors) {
      const footprintDistance = segmentBoxDistance(segment.start, segment.end, corridor.footprint);
      if (footprintDistance < SKETCH_V3_LANE_CLEARANCE) {
        addRow({
          blockerKind: "pending-corridor",
          blockingGeometryId: corridor.id,
          blockingGeometryRole: "pending branch corridor",
          clearance: footprintDistance,
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
        if (distance < SKETCH_V3_LANE_CLEARANCE) {
          addRow({
            blockerKind: "pending-corridor",
            blockingGeometryId: corridor.id,
            blockingGeometryRole: "pending branch corridor",
            clearance: distance,
            pendingCorridorPart: pendingSegment.corridorPart,
          });
        }
      }
    }
  }

  rows.sort((left, right) => (
    (left.clearance ?? Infinity) - (right.clearance ?? Infinity)
  ));
  return {
    rows: rows.slice(0, limit),
    omittedCount: Math.max(0, rows.length - limit),
  };
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
        SKETCH_V3_DIAMOND_OBSTACLE_MARGIN,
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
      nearestSplitExitLaneClearance < SKETCH_V3_LANE_CLEARANCE,
    overlapsUnrelatedEdgeLane:
      nearestEdgeLaneClearance < SKETCH_V3_LANE_CLEARANCE,
    overlapsProtectedPendingBranchCorridor:
      nearestPendingBranchCorridorClearance < SKETCH_V3_LANE_CLEARANCE,
    belowClearanceThreshold:
      nearestEdgeLaneClearance < SKETCH_V3_LANE_CLEARANCE ||
      nearestNodeClearance < SKETCH_V3_LANE_CLEARANCE ||
      nearestDiamondClearance < SKETCH_V3_LANE_CLEARANCE ||
      nearestSplitExitLaneClearance < SKETCH_V3_LANE_CLEARANCE ||
      nearestPendingBranchCorridorClearance < SKETCH_V3_LANE_CLEARANCE,
  };
}

function makeRouteCandidateDiagnostic(candidate, rejection = null, blockerRows = null) {
  const route = candidate.route ?? null;
  const points = route?.points ?? candidate.points ?? [];
  return {
    side: candidate.side ?? null,
    direction: candidate.direction ?? candidate.side ?? null,
    reason: candidate.reason ?? null,
    laneRank: candidate.laneRank ?? null,
    laneX: candidate.laneX ?? null,
    doglegX: candidate.doglegX ?? null,
    doglegRank: candidate.doglegRank ?? null,
    approachY: candidate.approachY ?? null,
    approachRank: candidate.approachRank ?? null,
    sourceExit: candidate.sourceExit ?? null,
    sourceExitY: candidate.sourceExitY ?? null,
    sourceExitRank: candidate.sourceExitRank ?? null,
    targetEntry: candidate.targetEntry ?? null,
    finalStyle: candidate.finalStyle ?? null,
    routePoints: clonePoints(points),
    accepted: !rejection,
    firstRejection: rejection ? { ...rejection } : null,
    blockingRows: blockerRows?.rows ?? [],
    omittedBlockingRowCount: blockerRows?.omittedCount ?? 0,
  };
}

function buildLoopReturnRouteCandidates({ edge, fromBounds, toBounds, layout, params, depth, placedByNodeId }) {
  const allNodeBoxes = getPlacedNodeBoxes(placedByNodeId, layout).map((entry) => entry.box);
  const leftBoundary = Math.min(fromBounds.left, toBounds.left, ...allNodeBoxes.map((box) => box.left));
  const rightBoundary = Math.max(fromBounds.right, toBounds.right, ...allNodeBoxes.map((box) => box.right));
  const placedBounds = getPlacedBounds(placedByNodeId, layout);
  const laneStep = Math.max(params.loopLaneDistance * 0.45, SKETCH_V3_LANE_CLEARANCE * 2);
  const leftStart = getLeftPort(fromBounds);
  const leftEnd = getLeftPort(toBounds);
  const rightStart = getRightPort(fromBounds);
  const rightEnd = getRightPort(toBounds);
  const targetEntryPorts = [
    {
      targetEntry: "target-top",
      end: getTopPort(toBounds),
      directionSuffix: "top-target-entry",
      reason: "outsideLaneTopTargetEntryForRejoinClearance",
    },
    {
      targetEntry: "target-bottom",
      end: getBottomPort(toBounds),
      directionSuffix: "bottom-target-entry",
      reason: "outsideLaneBottomTargetEntryForRejoinClearance",
    },
  ];
  const targetOffsetStep = Math.max(SKETCH_V3_LANE_CLEARANCE * 2, params.ordinaryStepY * 0.35);
  const sourceOffsetStep = Math.max(SKETCH_V3_LANE_CLEARANCE * 2, params.ordinaryStepY * 0.35);
  const globalSourceExitStep = Math.max(laneStep, params.ordinaryStepY * 0.55);
  const targetOffsetRankCount = 4;
  const sourceExitOffsets = [
    {
      sourceExit: "source-bottom-offset",
      offsetDirection: 1,
      directionSuffix: "source-bottom-offset",
      reason: "outsideLaneSourceBottomOffsetForPeerRowClearance",
    },
    {
      sourceExit: "source-top-offset",
      offsetDirection: -1,
      directionSuffix: "source-top-offset",
      reason: "outsideLaneSourceTopOffsetForPeerRowClearance",
    },
  ];
  const targetOffsetEntryPorts = [
    {
      targetEntry: "target-top-offset",
      end: getTopPort(toBounds),
      offsetDirection: -1,
      directionSuffix: "top-offset-target-entry",
      reason: "outsideLaneTopOffsetTargetEntryForRejoinClearance",
    },
    {
      targetEntry: "target-bottom-offset",
      end: getBottomPort(toBounds),
      offsetDirection: 1,
      directionSuffix: "bottom-offset-target-entry",
      reason: "outsideLaneBottomOffsetTargetEntryForRejoinClearance",
    },
  ];
  const candidates = [];

  for (let rank = 0; rank < 12; rank += 1) {
    const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
    const points = [leftStart, [laneX, leftStart[1]], [laneX, leftEnd[1]], leftEnd];
    candidates.push({
      side: "left",
      direction: "left-outside",
      laneRank: rank,
      laneX,
      points,
      targetEntry: "left-side-center",
      reason: rank === 0 ? "nearestOutsideLeftLane" : "fartherOutsideLeftLaneForClearance",
    });
  }

  for (const entry of targetEntryPorts) {
    for (let rank = 0; rank < 12; rank += 1) {
      const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
      const points = [leftStart, [laneX, leftStart[1]], [laneX, entry.end[1]], entry.end];
      candidates.push({
        side: "left",
        direction: `left-outside-${entry.directionSuffix}`,
        laneRank: rank,
        laneX,
        points,
        targetEntry: entry.targetEntry,
        reason: entry.reason,
      });
    }
  }

  for (const sourceOffset of sourceExitOffsets) {
    for (let sourceExitRank = 0; sourceExitRank < 8; sourceExitRank += 1) {
      const sourceExitY = leftStart[1] + sourceOffset.offsetDirection * sourceOffsetStep * (sourceExitRank + 1);
      for (let rank = 0; rank < 12; rank += 1) {
        const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
        const points = [leftStart, [leftStart[0], sourceExitY], [laneX, sourceExitY], [laneX, leftEnd[1]], leftEnd];
        candidates.push({
          side: "left",
          direction: `left-outside-${sourceOffset.directionSuffix}`,
          laneRank: rank,
          laneX,
          sourceExit: sourceOffset.sourceExit,
          sourceExitY,
          sourceExitRank,
          points,
          targetEntry: "left-side-center",
          reason: sourceOffset.reason,
        });
      }
    }
  }

  for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
    const sourceExitY = Math.max(
      leftStart[1] + sourceOffsetStep * (sourceExitRank + 1),
      placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
    );
    for (const entry of targetOffsetEntryPorts) {
      for (let offsetRank = 0; offsetRank < targetOffsetRankCount; offsetRank += 1) {
        const approachY = entry.end[1] + entry.offsetDirection * targetOffsetStep * (offsetRank + 1);
        for (let rank = 0; rank < 12; rank += 1) {
          const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
          const points = [
            leftStart,
            [leftStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, approachY],
            [entry.end[0], approachY],
            entry.end,
          ];
          candidates.push({
            side: "left",
            direction: `left-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            approachY,
            approachRank: offsetRank,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: `outsideLaneGlobalBottomSourceExit+${entry.reason}`,
          });
        }
      }
    }
  }

  for (const entry of targetOffsetEntryPorts) {
    for (let offsetRank = 0; offsetRank < targetOffsetRankCount; offsetRank += 1) {
      const approachY = entry.end[1] + entry.offsetDirection * targetOffsetStep * (offsetRank + 1);
      for (let rank = 0; rank < 12; rank += 1) {
        const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
        const points = [leftStart, [laneX, leftStart[1]], [laneX, approachY], [entry.end[0], approachY], entry.end];
        candidates.push({
          side: "left",
          direction: `left-outside-${entry.directionSuffix}`,
          laneRank: rank,
          laneX,
          approachY,
          approachRank: offsetRank,
          points,
          targetEntry: entry.targetEntry,
          reason: entry.reason,
        });
      }
    }
  }

  for (let rank = 0; rank < 8; rank += 1) {
    const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
    const points = [rightStart, [laneX, rightStart[1]], [laneX, rightEnd[1]], rightEnd];
    candidates.push({
      side: "right",
      direction: "right-outside",
      laneRank: rank,
      laneX,
      points,
      targetEntry: "right-side-center",
      reason: "rightOutsideLaneFallback",
    });
  }

  for (const entry of targetEntryPorts) {
    for (let rank = 0; rank < 8; rank += 1) {
      const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
      const points = [rightStart, [laneX, rightStart[1]], [laneX, entry.end[1]], entry.end];
      candidates.push({
        side: "right",
        direction: `right-outside-${entry.directionSuffix}`,
        laneRank: rank,
        laneX,
        points,
        targetEntry: entry.targetEntry,
        reason: entry.reason,
      });
    }
  }

  for (const sourceOffset of sourceExitOffsets) {
    for (let sourceExitRank = 0; sourceExitRank < 8; sourceExitRank += 1) {
      const sourceExitY = rightStart[1] + sourceOffset.offsetDirection * sourceOffsetStep * (sourceExitRank + 1);
      for (let rank = 0; rank < 8; rank += 1) {
        const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
        const points = [rightStart, [rightStart[0], sourceExitY], [laneX, sourceExitY], [laneX, rightEnd[1]], rightEnd];
        candidates.push({
          side: "right",
          direction: `right-outside-${sourceOffset.directionSuffix}`,
          laneRank: rank,
          laneX,
          sourceExit: sourceOffset.sourceExit,
          sourceExitY,
          sourceExitRank,
          points,
          targetEntry: "right-side-center",
          reason: sourceOffset.reason,
        });
      }
    }
  }

  for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
    const sourceExitY = Math.max(
      rightStart[1] + sourceOffsetStep * (sourceExitRank + 1),
      placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
    );
    for (const entry of targetOffsetEntryPorts) {
      for (let offsetRank = 0; offsetRank < targetOffsetRankCount; offsetRank += 1) {
        const approachY = entry.end[1] + entry.offsetDirection * targetOffsetStep * (offsetRank + 1);
        for (let rank = 0; rank < 8; rank += 1) {
          const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
          const points = [
            rightStart,
            [rightStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, approachY],
            [entry.end[0], approachY],
            entry.end,
          ];
          candidates.push({
            side: "right",
            direction: `right-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            approachY,
            approachRank: offsetRank,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: `outsideLaneGlobalBottomSourceExit+${entry.reason}`,
          });
        }
      }
    }
  }

  for (const entry of targetOffsetEntryPorts) {
    for (let offsetRank = 0; offsetRank < targetOffsetRankCount; offsetRank += 1) {
      const approachY = entry.end[1] + entry.offsetDirection * targetOffsetStep * (offsetRank + 1);
      for (let rank = 0; rank < 8; rank += 1) {
        const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
        const points = [rightStart, [laneX, rightStart[1]], [laneX, approachY], [entry.end[0], approachY], entry.end];
        candidates.push({
          side: "right",
          direction: `right-outside-${entry.directionSuffix}`,
          laneRank: rank,
          laneX,
          approachY,
          approachRank: offsetRank,
          points,
          targetEntry: entry.targetEntry,
          reason: entry.reason,
        });
      }
    }
  }

  return candidates.map((candidate) => ({
    ...candidate,
    route: makeRoute(edge, candidate.points, "sketchV3BackwardJump"),
  }));
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
  preferredSide = null,
}) {
  const candidates = buildLoopReturnRouteCandidates({
    edge,
    fromBounds,
    toBounds,
    layout,
    params,
    depth,
    placedByNodeId,
  });

  const clearanceEvaluated = candidates.map((candidate) => ({
	    ...candidate,
	    ...routeClearanceSummary({
      edge,
      points: candidate.route.points,
      layout,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionNodeByIndex,
      instructionCount,
	      pendingCorridorByEdgeId,
	    }),
	  }));
  const legalityEvaluated = clearanceEvaluated.map((candidate) => {
    const rejection = findRouteRejection({
      edge,
      route: candidate.route,
      layout,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionCount,
      pendingCorridorByEdgeId,
      excludeNodeIds: new Set([edge.from, edge.to]),
      excludeEdgeIds: new Set([edge.id]),
    });
    const blockerRows = collectRouteBlockingRows({
      edge,
      route: candidate.route,
      layout,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      instructionCount,
      pendingCorridorByEdgeId,
      excludeNodeIds: new Set([edge.from, edge.to]),
      excludeEdgeIds: new Set([edge.id]),
    });
    return {
      ...candidate,
      rejection,
      routeCandidateDiagnostic: makeRouteCandidateDiagnostic(candidate, rejection, blockerRows),
    };
  });
  const legalCandidates = legalityEvaluated.filter((candidate) => !candidate.rejection);
  const preferredLegalCandidate = preferredSide
    ? legalCandidates.find((candidate) => candidate.side === preferredSide) ?? null
    : null;
  const preferredSidePendingCorridorBlocked = Boolean(
    preferredSide &&
    !preferredLegalCandidate &&
    legalCandidates.length > 0 &&
    legalityEvaluated.some((candidate) => (
      candidate.side === preferredSide &&
      (
        candidate.rejection?.blockingGeometryRole === "pending branch corridor" ||
        candidate.routeCandidateDiagnostic?.blockingRows?.some((row) => (
          row.blockingGeometryRole === "pending branch corridor"
        ))
      )
    )),
  );
  const accepted = preferredLegalCandidate ??
    legalCandidates[0] ??
    legalityEvaluated.find((candidate) => !candidate.belowClearanceThreshold) ??
    legalityEvaluated[0];
  const legalCandidateCount = legalCandidates.length;
  const candidatePendingBranchCorridorConflictRows = clearanceEvaluated
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
      routePoints: candidate.route.points,
    }));
  const candidateRouteDiagnostics = legalityEvaluated.map((candidate) => candidate.routeCandidateDiagnostic);
	  return {
	    ...accepted.route,
	    sketchV3LoopReturnDiagnostic: {
      edgeId: edge.id,
      source: edge.from ?? null,
      target: edge.to ?? null,
      side: accepted.side,
      reason: accepted.reason,
      sourceExit: accepted.sourceExit ?? null,
      sourceExitY: accepted.sourceExitY ?? null,
      sourceExitRank: accepted.sourceExitRank ?? null,
      targetEntry: accepted.targetEntry ?? null,
      preferredSide,
      preferredSidePendingCorridorBlocked,
      laneRank: accepted.laneRank,
      laneX: accepted.laneX,
      approachY: accepted.approachY ?? null,
      approachRank: accepted.approachRank ?? null,
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
      legalCandidateCount,
      selectedCandidateRejected: Boolean(accepted.rejection),
      candidateRouteDirectionsConsidered: Array.from(new Set(legalityEvaluated.map((candidate) => candidate.direction))),
      candidateRouteDiagnostics,
	      belowClearanceThreshold: accepted.belowClearanceThreshold,
	      threshold: SKETCH_V3_LANE_CLEARANCE,
      segments: routeSegments(accepted.route.points),
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
  drawingState = null,
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
      preferredSide: getPreferredLoopReturnSide({ edge, drawingState }),
    });
  }

  if (targetPlacement.node.kind === "halt") {
    return makeRoute(edge, [getRightPort(fromBounds), getLeftPort(toBounds)], "sketchV3HaltExit");
  }

  return makeRoute(edge, [getBottomPort(fromBounds), getTopPort(toBounds)], "sketchV3Continuation");
}

function assignRoute(edge, route, edgeRouteById, drawingState = null, instructionCount = 0) {
  if (!edge || !route) return;
  edgeRouteById.set(edge.id, route);
  edge.sketchV3ReservedRoute = route;
  recordEdgeCommit({
    drawingState,
    edge,
    route,
    committedOrder: edgeRouteById.size - 1,
    instructionCount,
  });
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
  return [
    1,
    0.82,
    1.18,
    0.68,
    1.36,
    1.58,
    0.56,
    1.82,
    2.08,
    2.36,
    2.72,
    3.16,
    3.68,
    4.3,
    5.0,
    5.85,
    6.8,
    7.9,
    9.2,
    10.8,
    12.6,
    14.7,
    17.2,
    20.0,
  ].map((distanceScale) => (
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
  outgoingBySource,
  instructionCount,
  pendingCorridorByEdgeId,
  includeConditionalLookahead = true,
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
  if (routeRejection) return { ...candidate, route, rejection: routeRejection };

  const lookaheadRejection = includeConditionalLookahead
    ? findConditionalFirstNoBranchReservationRejection({
        node,
        candidate,
        route,
        incomingEdge,
        targetPlacement,
        layout,
        params,
        depth,
        placedByNodeId,
        edgeRouteById,
        edgesById,
        instructionNodeByIndex,
        outgoingBySource,
        instructionCount,
        pendingCorridorByEdgeId,
      })
    : null;
  if (lookaheadRejection) return { ...candidate, route, rejection: lookaheadRejection };

  const siblingBranchRejection = findDeferredSiblingBranchRouteReservationRejection({
    node,
    candidate,
    route,
    incomingEdge,
    sourcePlacement,
    targetPlacement,
    layout,
    params,
    depth,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionNodeByIndex,
    outgoingBySource,
    instructionCount,
    pendingCorridorByEdgeId,
  });
  return { ...candidate, route, rejection: siblingBranchRejection };
}

function findConditionalFirstNoBranchReservationRejection({
  node,
  candidate,
  route,
  incomingEdge,
  targetPlacement,
  layout,
  params,
  depth,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  outgoingBySource,
  instructionCount,
  pendingCorridorByEdgeId,
}) {
  if (node.kind !== "conditionalJump" || !Number.isInteger(node.instructionIndex)) return null;
  const outgoing = outgoingBySource?.get(node.instructionIndex) ?? [];
  const noEdge = outgoing.find((edge) => edge.branch === "no") ?? null;
  if (!noEdge || isHaltEdge(noEdge, instructionCount)) return null;

  const noTargetNode = instructionNodeByIndex.get(noEdge.targetIndex);
  if (!noTargetNode || placedByNodeId.has(noTargetNode.id)) return null;

  const lookaheadPlacedByNodeId = new Map(placedByNodeId);
  lookaheadPlacedByNodeId.set(node.id, targetPlacement);
  const lookaheadEdgeRouteById = new Map(edgeRouteById);
  if (incomingEdge && route) {
    lookaheadEdgeRouteById.set(incomingEdge.id, route);
  }
  const lookaheadPendingCorridorByEdgeId = new Map(pendingCorridorByEdgeId);
  const yesEdge = outgoing.find((edge) => edge.branch === "yes") ?? null;
  const yesTargetNode = yesEdge && !isHaltEdge(yesEdge, instructionCount)
    ? instructionNodeByIndex.get(yesEdge.targetIndex)
    : null;
  if (yesEdge && yesTargetNode) {
    const pendingPosition = getBranchPosition({
      edge: yesEdge,
      sourcePlacement: targetPlacement,
      targetNode: yesTargetNode,
      layout,
      params,
      depth,
    });
    lookaheadPendingCorridorByEdgeId.set(yesEdge.id, makePendingBranchCorridor({
      edge: yesEdge,
      sourcePlacement: targetPlacement,
      targetNode: yesTargetNode,
      position: pendingPosition,
      layout,
      params,
      depth: depth + 1,
      branchPath: [yesEdge.id],
      createdOrder: null,
    }));
  }

  const candidates = getBranchPlacementCandidates({
    edge: noEdge,
    sourcePlacement: targetPlacement,
    targetNode: noTargetNode,
    layout,
    params,
    depth,
  });
  const evaluated = candidates.map((lookaheadCandidate) => evaluatePlacementCandidate({
    candidate: lookaheadCandidate,
    node: noTargetNode,
    incomingEdge: noEdge,
    sourcePlacement: targetPlacement,
    layout,
    params,
    depth: depth + 1,
    placedByNodeId: lookaheadPlacedByNodeId,
    edgeRouteById: lookaheadEdgeRouteById,
    edgesById,
    instructionNodeByIndex,
    outgoingBySource,
    instructionCount,
    pendingCorridorByEdgeId: lookaheadPendingCorridorByEdgeId,
    includeConditionalLookahead: false,
  }));

  if (evaluated.some((lookaheadCandidate) => !lookaheadCandidate.rejection)) return null;
  const firstRejection = evaluated.find((lookaheadCandidate) => lookaheadCandidate.rejection)?.rejection ?? null;
  return {
    candidateNodeId: node.id,
    candidateEdgeId: incomingEdge?.id ?? null,
    rejectionKind: "conditional-first-no-branch-reservation",
    blockingGeometryId: firstRejection?.blockingGeometryId ?? noEdge.id,
    blockingGeometryRole: firstRejection?.blockingGeometryRole ?? "first no-branch reservation",
    clearance: firstRejection?.clearance ?? null,
    candidatePoints: route?.points ?? candidate.route?.points ?? null,
    pendingCorridorPart: firstRejection?.pendingCorridorPart ?? null,
    lookaheadEdgeId: noEdge.id,
    lookaheadTargetNodeId: noTargetNode.id,
    lookaheadRejectedCandidateCount: evaluated.filter((lookaheadCandidate) => lookaheadCandidate.rejection).length,
    lookaheadFirstRejection: firstRejection,
  };
}

function findDeferredSiblingBranchRouteReservationRejection({
  node,
  candidate,
  route,
  incomingEdge,
  sourcePlacement,
  targetPlacement,
  layout,
  params,
  depth,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  outgoingBySource,
  instructionCount,
  pendingCorridorByEdgeId,
}) {
  if (!incomingEdge?.branch || sourcePlacement?.node?.kind !== "conditionalJump") return null;
  if (!Number.isInteger(sourcePlacement.node.instructionIndex)) return null;

  const outgoing = outgoingBySource?.get(sourcePlacement.node.instructionIndex) ?? [];
  const siblingEdge = outgoing.find((edge) => (
    edge.branch &&
    edge.branch !== incomingEdge.branch &&
    pendingCorridorByEdgeId.has(edge.id)
  )) ?? null;
  if (!siblingEdge || isHaltEdge(siblingEdge, instructionCount)) return null;

  const siblingTargetNode = instructionNodeByIndex.get(siblingEdge.targetIndex);
  const siblingTargetPlacement = siblingTargetNode
    ? placedByNodeId.get(siblingTargetNode.id)
    : null;
  if (!siblingTargetNode || !siblingTargetPlacement) return null;

  const lookaheadPlacedByNodeId = new Map(placedByNodeId);
  lookaheadPlacedByNodeId.set(node.id, targetPlacement);
  const lookaheadEdgeRouteById = new Map(edgeRouteById);
  if (incomingEdge && route) {
    lookaheadEdgeRouteById.set(incomingEdge.id, route);
  }

  const siblingRoute = routeBetweenPlacements({
    edge: siblingEdge,
    sourcePlacement,
    targetPlacement: siblingTargetPlacement,
    layout,
    params,
    depth,
    alreadyDrawnTarget: true,
    placedByNodeId: lookaheadPlacedByNodeId,
    edgeRouteById: lookaheadEdgeRouteById,
    edgesById,
    instructionNodeByIndex,
    instructionCount,
    pendingCorridorByEdgeId,
  });
  const siblingRouteRejection = findRouteRejection({
    edge: siblingEdge,
    route: siblingRoute,
    layout,
    placedByNodeId: lookaheadPlacedByNodeId,
    edgeRouteById: lookaheadEdgeRouteById,
    edgesById,
    instructionCount,
    pendingCorridorByEdgeId,
    excludeNodeIds: new Set([siblingEdge.from, siblingEdge.to]),
    excludeEdgeIds: new Set([siblingEdge.id]),
    excludePendingEdgeIds: new Set([siblingEdge.id]),
  });
  if (!siblingRouteRejection) return null;

  return {
    candidateNodeId: node.id,
    candidateEdgeId: incomingEdge?.id ?? null,
    rejectionKind: "deferred-sibling-branch-route-reservation",
    blockingGeometryId: siblingRouteRejection.blockingGeometryId ?? siblingEdge.id,
    blockingGeometryRole: siblingRouteRejection.blockingGeometryRole ?? "deferred sibling branch route",
    clearance: siblingRouteRejection.clearance ?? null,
    candidatePoints: route?.points ?? candidate.route?.points ?? null,
    pendingCorridorPart: siblingRouteRejection.pendingCorridorPart ?? null,
    lookaheadEdgeId: siblingEdge.id,
    lookaheadTargetNodeId: siblingTargetNode.id,
    lookaheadRoutePoints: siblingRoute?.points ?? null,
    lookaheadFirstRejection: siblingRouteRejection,
  };
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
  outgoingBySource,
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
    outgoingBySource,
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
  const laneStep = Math.max(SKETCH_V3_LANE_CLEARANCE * 3, params.loopLaneDistance * 0.5);
  const end = getLeftPort(haltBounds);
  const sourcePorts = [
    {
      sourceExit: "right-port",
      start: getRightPort(sourceBounds),
      directionPrefix: "right-halt",
      reasonPrefix: "deferredSharedHalt",
    },
    {
      sourceExit: "top-port",
      start: getTopPort(sourceBounds),
      directionPrefix: "right-halt-source-top",
      reasonPrefix: "deferredSharedHaltSourceTop",
    },
    {
      sourceExit: "bottom-port",
      start: getBottomPort(sourceBounds),
      directionPrefix: "right-halt-source-bottom",
      reasonPrefix: "deferredSharedHaltSourceBottom",
    },
  ];
  const approachStep = Math.max(params.ordinaryStepY * 0.6, SKETCH_V3_LANE_CLEARANCE * 3);
  const approachOffsets = [
    -(haltIndex + 1) * approachStep,
    (haltIndex + 1) * approachStep,
    -(haltIndex + 2) * approachStep,
    (haltIndex + 2) * approachStep,
    -(haltIndex + 3) * approachStep,
    (haltIndex + 3) * approachStep,
  ];
  const candidates = sourcePorts.flatMap(({ sourceExit, start, directionPrefix, reasonPrefix }, sourceExitRank) => (
    Array.from({ length: 8 }, (_, rank) => {
      const laneX = baseLaneX + rank * laneStep;
      return approachOffsets.flatMap((approachOffset, approachRank) => {
        const approachY = end[1] + approachOffset;
        const minDogleg = Math.max(SKETCH_V3_LANE_CLEARANCE * 3, params.haltDistance * 0.35);
        const doglegXs = [
          start[0] + minDogleg,
          start[0] + minDogleg * 2.4,
          laneX,
        ].filter((value, index, values) => values.findIndex((candidate) => Math.abs(candidate - value) < 0.001) === index);
        return doglegXs.flatMap((doglegX, doglegRank) => {
          const directPoints = Math.abs(approachY - start[1]) <= 0.001
            ? [start, [laneX, start[1]], end]
            : [start, [doglegX, start[1]], [doglegX, approachY], [laneX, approachY], end];
          const orthogonalFinalPoints = Math.abs(approachY - start[1]) <= 0.001
            ? [start, [laneX, start[1]], [end[0], start[1]], end]
            : [start, [doglegX, start[1]], [doglegX, approachY], [laneX, approachY], [end[0], approachY], end];
          return [
            {
              laneRank: rank,
              approachRank,
              doglegRank,
              laneX,
              doglegX,
              approachY,
              sourceExit,
              sourceExitRank,
              side: "right",
              direction: `${directionPrefix}-direct-final`,
              finalStyle: "direct-final",
              reason: `${reasonPrefix}DirectFinalCandidate`,
              route: makeRoute(edge, directPoints, "sketchV3HaltExit"),
            },
            {
              laneRank: rank,
              approachRank,
              doglegRank,
              laneX,
              doglegX,
              approachY,
              sourceExit,
              sourceExitRank,
              side: "right",
              direction: `${directionPrefix}-orthogonal-final`,
              finalStyle: "orthogonal-final",
              reason: `${reasonPrefix}OrthogonalFinalCandidate`,
              route: makeRoute(edge, orthogonalFinalPoints, "sketchV3HaltExit"),
            },
          ];
        });
      });
    }).flat()
  ));
  const topStart = getTopPort(sourceBounds);
  for (let sourceExitRank = 0; sourceExitRank < 8; sourceExitRank += 1) {
    const sourceExitY = topStart[1] - approachStep * (sourceExitRank + 1);
    for (let rank = 0; rank < 10; rank += 1) {
      const laneX = baseLaneX + rank * laneStep;
      approachOffsets.forEach((approachOffset, approachRank) => {
        const approachY = end[1] + approachOffset;
        const directPoints = [
          topStart,
          [topStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          end,
        ];
        const orthogonalFinalPoints = [
          topStart,
          [topStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          [end[0], approachY],
          end,
        ];
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-top-right-outside",
          sourceExitY,
          sourceExitRank,
          side: "right",
          direction: "right-halt-source-top-outside-direct-final",
          finalStyle: "direct-final",
          reason: "deferredSharedHaltSourceTopRightOutsideDirectFinalCandidate",
          route: makeRoute(edge, directPoints, "sketchV3HaltExit"),
        });
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-top-right-outside",
          sourceExitY,
          sourceExitRank,
          side: "right",
          direction: "right-halt-source-top-outside-orthogonal-final",
          finalStyle: "orthogonal-final",
          reason: "deferredSharedHaltSourceTopRightOutsideOrthogonalFinalCandidate",
          route: makeRoute(edge, orthogonalFinalPoints, "sketchV3HaltExit"),
        });
      });
    }
  }
  const bottomStart = getBottomPort(sourceBounds);
  const leftBaseLaneX = Math.min(
    placedBounds.left - params.haltDistance * 0.65,
    sourceBounds.left - params.haltDistance * 0.75,
  );
  for (let sourceExitRank = 0; sourceExitRank < 5; sourceExitRank += 1) {
    const sourceExitY = bottomStart[1] + approachStep * (sourceExitRank + 1);
    for (let rank = 0; rank < 8; rank += 1) {
      const laneX = leftBaseLaneX - rank * laneStep;
      approachOffsets.forEach((approachOffset, approachRank) => {
        const approachY = end[1] + approachOffset;
        const directPoints = [
          bottomStart,
          [bottomStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          end,
        ];
        const orthogonalFinalPoints = [
          bottomStart,
          [bottomStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          [end[0], approachY],
          end,
        ];
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-bottom-left-outside",
          sourceExitY,
          sourceExitRank,
          side: "left",
          direction: "left-halt-source-bottom-outside-direct-final",
          finalStyle: "direct-final",
          reason: "deferredSharedHaltSourceBottomLeftOutsideDirectFinalCandidate",
          route: makeRoute(edge, directPoints, "sketchV3HaltExit"),
        });
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-bottom-left-outside",
          sourceExitY,
          sourceExitRank,
          side: "left",
          direction: "left-halt-source-bottom-outside-orthogonal-final",
          finalStyle: "orthogonal-final",
          reason: "deferredSharedHaltSourceBottomLeftOutsideOrthogonalFinalCandidate",
          route: makeRoute(edge, orthogonalFinalPoints, "sketchV3HaltExit"),
        });
      });
    }
  }
  const globalSourceExitStep = Math.max(laneStep, params.ordinaryStepY * 0.65);
  for (let localExitRank = 0; localExitRank < 6; localExitRank += 1) {
    const localExitY = bottomStart[1] + approachStep * (localExitRank + 1);
    for (let sourceExitRank = 0; sourceExitRank < 3; sourceExitRank += 1) {
      const sourceExitY = Math.max(
        placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * (sourceExitRank + 1),
        localExitY + approachStep * (sourceExitRank + 2),
      );
      for (let leftRank = 0; leftRank < 5; leftRank += 1) {
        const leftLaneX = leftBaseLaneX - (leftRank + 4) * laneStep;
        for (let rank = 0; rank < 4; rank += 1) {
          const laneX = baseLaneX + rank * laneStep;
          approachOffsets.forEach((approachOffset, approachRank) => {
            const approachY = end[1] + approachOffset;
            const directPoints = [
              bottomStart,
              [bottomStart[0], localExitY],
              [leftLaneX, localExitY],
              [leftLaneX, sourceExitY],
              [laneX, sourceExitY],
              [laneX, approachY],
              end,
            ];
            const orthogonalFinalPoints = [
              bottomStart,
              [bottomStart[0], localExitY],
              [leftLaneX, localExitY],
              [leftLaneX, sourceExitY],
              [laneX, sourceExitY],
              [laneX, approachY],
              [end[0], approachY],
              end,
            ];
            candidates.push({
              laneRank: rank,
              approachRank,
              laneX,
              doglegX: leftLaneX,
              doglegRank: leftRank,
              approachY,
              sourceExit: "source-left-global-bottom",
              sourceExitY,
              sourceExitRank,
              side: "left",
              direction: "left-to-right-halt-source-global-bottom-direct-final",
              finalStyle: "direct-final",
              reason: "deferredSharedHaltLeftExteriorGlobalBottomDirectFinalCandidate",
              route: makeRoute(edge, directPoints, "sketchV3HaltExit"),
            });
            candidates.push({
              laneRank: rank,
              approachRank,
              laneX,
              doglegX: leftLaneX,
              doglegRank: leftRank,
              approachY,
              sourceExit: "source-left-global-bottom",
              sourceExitY,
              sourceExitRank,
              side: "left",
              direction: "left-to-right-halt-source-global-bottom-orthogonal-final",
              finalStyle: "orthogonal-final",
              reason: "deferredSharedHaltLeftExteriorGlobalBottomOrthogonalFinalCandidate",
              route: makeRoute(edge, orthogonalFinalPoints, "sketchV3HaltExit"),
            });
          });
        }
      }
    }
  }
  for (let sourceExitRank = 0; sourceExitRank < 6; sourceExitRank += 1) {
    const sourceExitY = Math.max(
      bottomStart[1] + approachStep * (sourceExitRank + 1),
      placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
    );
    for (let rank = 0; rank < 10; rank += 1) {
      const laneX = baseLaneX + rank * laneStep;
      approachOffsets.forEach((approachOffset, approachRank) => {
        const approachY = end[1] + approachOffset;
        const directPoints = [
          bottomStart,
          [bottomStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          end,
        ];
        const orthogonalFinalPoints = [
          bottomStart,
          [bottomStart[0], sourceExitY],
          [laneX, sourceExitY],
          [laneX, approachY],
          [end[0], approachY],
          end,
        ];
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-global-bottom",
          sourceExitY,
          sourceExitRank,
          side: "right",
          direction: "right-halt-source-global-bottom-direct-final",
          finalStyle: "direct-final",
          reason: "deferredSharedHaltGlobalBottomSourceExitDirectFinalCandidate",
          route: makeRoute(edge, directPoints, "sketchV3HaltExit"),
        });
        candidates.push({
          laneRank: rank,
          approachRank,
          laneX,
          doglegX: laneX,
          doglegRank: null,
          approachY,
          sourceExit: "source-global-bottom",
          sourceExitY,
          sourceExitRank,
          side: "right",
          direction: "right-halt-source-global-bottom-orthogonal-final",
          finalStyle: "orthogonal-final",
          reason: "deferredSharedHaltGlobalBottomSourceExitOrthogonalFinalCandidate",
          route: makeRoute(edge, orthogonalFinalPoints, "sketchV3HaltExit"),
        });
      });
    }
  }
  return candidates;
}

const SKETCH_V3_FOCUSED_DIAMOND_EXIT_EDGE_IDS = new Set(["i-48-no", "i-53-no"]);
const SKETCH_V3_FOCUSED_ORDINARY_ROUTE_EDGE_IDS = new Set([
  "i-27-unconditional",
  "i-52-unconditional",
  "i-50-unconditional",
  "i-57-fallthrough",
]);

function getExpectedSideOwner(edge) {
  if (edge?.branch === "no") return "left";
  if (edge?.branch === "yes") return "right";
  return null;
}

function getDiamondExitNonStraightReason(row) {
  if (!row) return null;
  if (row.usedException) return null;
  if (row.fixedAngleFirstSegment) return null;
  if (row.pointCount === 0) return "missingCommittedRoute";
  if (row.usesTurn) return "routeUsesTurn";
  if (!Number.isFinite(row.routeTangent)) return "firstSegmentTangentUnavailable";
  return "firstSegmentNotStraightFixedAngle";
}

function getDiamondExitSideOwnershipFailureReason(row, expectedSideOwner) {
  if (!row || row.usedException || row.sideOwnershipPreserved) return null;
  if (row.pointCount === 0) return "missingFirstSegment";
  const points = row.points ?? [];
  const start = points[0] ?? null;
  const firstEnd = points[1] ?? null;
  const dx = start && firstEnd ? firstEnd[0] - start[0] : null;
  if (!Number.isFinite(dx)) return "firstSegmentDirectionUnavailable";
  if (Math.abs(dx) <= 0.001) return "firstSegmentHasNoHorizontalSide";
  const actualSideOwner = dx < 0 ? "left" : "right";
  return actualSideOwner === expectedSideOwner
    ? null
    : `expected-${expectedSideOwner}-actual-${actualSideOwner}`;
}

function makeFocusedDiamondExitStructuralDiagnostic({
  edge,
  row,
  drawingState = null,
  pendingCorridorRows = [],
}) {
  if (!SKETCH_V3_FOCUSED_DIAMOND_EXIT_EDGE_IDS.has(edge.id)) return null;
  const sourceRecord = drawingState?.nodesById.get(edge.from) ?? null;
  const targetRecord = drawingState?.nodesById.get(edge.to) ?? null;
  const diamondRecord = drawingState?.diamondsById.get(edge.from) ?? null;
  const expectedSideOwner = getExpectedSideOwner(edge);
  const owningCorridor = pendingCorridorRows.find((corridor) => corridor.pendingEdgeId === edge.id) ?? null;
  const sourceProtectedCorridors = pendingCorridorRows.filter((corridor) => (
    diamondRecord?.protectedCorridorIds?.includes(corridor.id)
  ));
  const points = row.points ?? [];
  const actualFirstSegment = points.length >= 2
    ? { start: clonePoint(points[0]), end: clonePoint(points[1]) }
    : null;

  return {
    edgeId: edge.id,
    diamondId: edge.from ?? null,
    branchSide: edge.branch ?? null,
    branchPath: cloneBranchPath(diamondRecord?.branchPath ?? sourceRecord?.branchPath),
    owningCorridor: owningCorridor ? {
      id: owningCorridor.id,
      pendingEdgeId: owningCorridor.pendingEdgeId,
      side: owningCorridor.side,
      branchPath: cloneBranchPath(owningCorridor.branchPath),
      createdOrder: owningCorridor.createdOrder,
      removedOrder: owningCorridor.removedOrder,
      removedReason: owningCorridor.removedReason,
    } : null,
    sourceProtectedCorridors: sourceProtectedCorridors.map((corridor) => ({
      id: corridor.id,
      pendingEdgeId: corridor.pendingEdgeId,
      side: corridor.side,
      branchPath: cloneBranchPath(corridor.branchPath),
      createdOrder: corridor.createdOrder,
      removedOrder: corridor.removedOrder,
      removedReason: corridor.removedReason,
    })),
    expectedSideOwner,
    sourcePosition: sourceRecord ? {
      nodeId: sourceRecord.id,
      x: sourceRecord.x,
      y: sourceRecord.y,
      bounds: sourceRecord.bounds,
      placedOrder: sourceRecord.placedOrder,
    } : null,
    actualTargetPosition: targetRecord ? {
      nodeId: targetRecord.id,
      x: targetRecord.x,
      y: targetRecord.y,
      bounds: targetRecord.bounds,
      placedOrder: targetRecord.placedOrder,
      branchPath: cloneBranchPath(targetRecord.branchPath),
    } : null,
    expectedExitRay: edge.branch === "no"
      ? diamondRecord?.noExitRay ?? null
      : diamondRecord?.yesExitRay ?? null,
    actualFirstSegment,
    nonStraightReason: getDiamondExitNonStraightReason(row),
    sideOwnershipFailureReason:
      getDiamondExitSideOwnershipFailureReason(row, expectedSideOwner),
  };
}

function hasPendingCorridorCandidateBlocker(route) {
  return route?.sketchV3LoopReturnDiagnostic?.candidateRouteDiagnostics?.some((candidate) => (
    candidate.firstRejection?.blockingGeometryRole === "pending branch corridor" ||
    candidate.blockingRows?.some((row) => row.blockingGeometryRole === "pending branch corridor")
  )) ?? false;
}

function shouldDeferPreferredLoopReturnRoute({
  edge,
  route,
  pendingCorridorByEdgeId,
  instructionCount,
}) {
  if (!edge || edge.branch || pendingCorridorByEdgeId.size === 0) return false;
  if (
    !Number.isInteger(edge.sourceIndex) ||
    !Number.isInteger(edge.targetIndex) ||
    edge.targetIndex > edge.sourceIndex ||
    isHaltEdge(edge, instructionCount)
  ) {
    return false;
  }
  return Boolean(route?.sketchV3LoopReturnDiagnostic?.preferredSidePendingCorridorBlocked);
}

function shouldDeferAlreadyDrawnTargetRoute({
  edge,
  route,
  pendingCorridorByEdgeId,
  instructionCount,
}) {
  if (!edge || edge.branch || pendingCorridorByEdgeId.size === 0) return false;
  if (
    !Number.isInteger(edge.sourceIndex) ||
    !Number.isInteger(edge.targetIndex) ||
    edge.targetIndex > edge.sourceIndex ||
    isHaltEdge(edge, instructionCount)
  ) {
    return false;
  }
  return hasPendingCorridorCandidateBlocker(route);
}

function commitDeferredOrdinaryRoutes({
  deferredRoutes,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionNodeByIndex,
  pendingCorridorByEdgeId,
  layout,
  params,
  instructionCount,
  failures,
  drawingState = null,
}) {
  const rows = [];
  const conflictRows = [];
  deferredRoutes.forEach(({ edge, sourcePlacement, targetPlacement, depth, deferredOrder, deferredReason }) => {
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
      drawingState,
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
    const row = {
      edgeId: edge.id,
      source: edge.from ?? null,
      target: edge.to ?? null,
      deferredOrder,
      deferredReason,
      routedOrder: rejection ? null : edgeRouteById.size,
      routePoints: rejection ? [] : clonePoints(route.points),
      rejection,
      routeDiagnostic: route?.sketchV3LoopReturnDiagnostic ?? null,
    };
    rows.push(row);
    if (rejection) {
      const failure = {
        edgeId: edge.id,
        reason: "sketchV3NoLegalDeferredOrdinaryRoute",
        rejection,
        routeDiagnostic: route?.sketchV3LoopReturnDiagnostic ?? null,
      };
      failures.push(failure);
      conflictRows.push({ ...row, failure });
      return;
    }
    assignRoute(edge, route, edgeRouteById, drawingState, instructionCount);
  });
  return { rows, conflictRows };
}

function trySingleHaltLocalPlacement({
  haltExits,
  nodes,
  nodeById,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  pendingCorridorByEdgeId,
  pendingCorridorRows,
  placementRows,
  layout,
  params,
  instructionCount,
  drawingState,
}) {
  const { edge, sourcePlacement, recordedOrder, haltExitRecordId } = haltExits[0];

  // Only handle straight non-branch exits (branch exits use diagonal geometry)
  if (edge.branch) return null;

  const sharedHaltNode = getSharedHaltNode({ nodes, nodeById });
  const localPosition = {
    x: sourcePlacement.x,
    y: sourcePlacement.y + params.ordinaryStepY,
  };

  // Exclude the halt exit's own pending corridor so it doesn't block the halt node itself
  const excludeOwnCorridor = new Set([edge.id]);

  const nodeRejection = findNodePlacementRejection({
    node: sharedHaltNode,
    position: localPosition,
    layout,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionCount,
    pendingCorridorByEdgeId,
    excludePendingEdgeIds: excludeOwnCorridor,
    candidateEdgeId: edge.id,
  });
  if (nodeRejection) return null;

  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const haltBounds = getNodeBoundsAt(sharedHaltNode, localPosition, layout);
  const localRoute = makeRoute(
    edge,
    [getBottomPort(sourceBounds), getTopPort(haltBounds)],
    "sketchV3HaltExit",
  );

  const routeRejection = findRouteRejection({
    edge,
    route: localRoute,
    layout,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionCount,
    pendingCorridorByEdgeId,
    excludeNodeIds: new Set([edge.from, sharedHaltNode.id]),
    excludeEdgeNodeIds: new Set([edge.from]),
    excludeEdgeIds: new Set([edge.id]),
    excludePendingEdgeIds: excludeOwnCorridor,
  });
  if (routeRejection) return null;

  const ordinaryPlacementCompleteOrder = placementRows.length - 1;
  edge.to = sharedHaltNode.id;
  placeNode(sharedHaltNode, localPosition, placedByNodeId, placementRows, "localSingleHalt", null, drawingState, layout, []);

  const acceptedRoute = {
    ...localRoute,
    sketchV3DeferredHaltDiagnostic: {
      edgeId: edge.id,
      source: edge.from ?? null,
      target: sharedHaltNode.id,
      laneX: null,
      laneRank: 0,
      doglegX: null,
      doglegRank: null,
      approachY: localPosition.y,
      approachRank: 0,
      sourceExit: "bottom-port",
      sourceExitRank: 0,
      direction: "local-direct-down",
      finalStyle: "local-direct",
      recordedOrder,
      committedOrder: placementRows.length,
      ordinaryPlacementCompleteOrder,
      candidateRouteDirectionsConsidered: ["local-direct-down"],
      candidateRouteDiagnostics: [],
    },
  };

  assignRoute(edge, acceptedRoute, edgeRouteById, drawingState, instructionCount);
  recordHaltExitRouted({
    drawingState,
    haltExitRecordId,
    sharedHaltNodeId: sharedHaltNode.id,
    route: acceptedRoute,
    routedOrder: placementRows.length,
  });
  retirePendingBranchCorridor({
    edge,
    pendingCorridorByEdgeId,
    pendingCorridorRows,
    removedOrder: placementRows.length,
    removedReason: "haltRouteCommitted",
    convertedEdgeId: edge.id,
    drawingState,
  });

  return {
    sharedHaltNodeId: sharedHaltNode.id,
    haltRows: [{
      edgeId: edge.id,
      source: edge.from ?? null,
      target: sharedHaltNode.id,
      laneX: null,
      laneRank: 0,
      doglegX: null,
      doglegRank: null,
      approachY: localPosition.y,
      approachRank: 0,
      sourceExit: "bottom-port",
      sourceExitRank: 0,
      direction: "local-direct-down",
      finalStyle: "local-direct",
      recordedOrder,
      committedAfterOrdinaryPlacementComplete: true,
      routePoints: acceptedRoute.points,
    }],
    haltConflictRows: [],
    haltCommittedBeforeOrdinaryPlacementComplete: false,
  };
}

function commitDeferredHaltRoutes({
  haltExits,
  nodes,
  nodeById,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  pendingCorridorByEdgeId,
  pendingCorridorRows,
  placementRows,
  layout,
  params,
  instructionCount,
  failures,
  drawingState = null,
}) {
  if (haltExits.length === 0) {
    return {
      sharedHaltNodeId: null,
      haltRows: [],
      haltConflictRows: [],
      haltCommittedBeforeOrdinaryPlacementComplete: false,
    };
  }

  if (haltExits.length === 1) {
    const localResult = trySingleHaltLocalPlacement({
      haltExits,
      nodes,
      nodeById,
      placedByNodeId,
      edgeRouteById,
      edgesById,
      pendingCorridorByEdgeId,
      pendingCorridorRows,
      placementRows,
      layout,
      params,
      instructionCount,
      drawingState,
    });
    if (localResult) return localResult;
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
    drawingState,
    layout,
    [],
  );
  const haltRows = [];
  const haltConflictRows = [];

  haltExits.forEach(({ edge, sourcePlacement, depth, recordedOrder, haltExitRecordId }, haltIndex) => {
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
        excludePendingEdgeIds: new Set([edge.id]),
      });
      const blockerRows = collectRouteBlockingRows({
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
        excludePendingEdgeIds: new Set([edge.id]),
      });
      return {
        ...candidate,
        rejection,
        routeCandidateDiagnostic: makeRouteCandidateDiagnostic({
          ...candidate,
          side: "right",
          direction: candidate.direction ?? "right-halt-lane",
          reason: candidate.reason ?? "deferredSharedHaltCandidate",
        }, rejection, blockerRows),
      };
    });
    const accepted = evaluated.find((candidate) => !candidate.rejection) ?? null;
    if (!accepted) {
      const firstRejection = evaluated[0]?.rejection ?? null;
      const failure = {
        edgeId: edge.id,
        reason: "sketchV3NoLegalHaltRoute",
        source: edge.from ?? null,
        target: sharedHaltNode.id,
        depth,
        firstRejection,
        candidateRouteDirectionsConsidered: Array.from(new Set(evaluated.map((candidate) => (
          candidate.routeCandidateDiagnostic.direction
        )))),
        candidateRouteDiagnostics: evaluated.map((candidate) => candidate.routeCandidateDiagnostic),
      };
      failures.push(failure);
      haltConflictRows.push(failure);
      retirePendingBranchCorridor({
        edge,
        pendingCorridorByEdgeId,
        pendingCorridorRows,
        removedOrder: placementRows.length,
        removedReason: "haltRouteFailed",
        convertedEdgeId: edge.id,
        drawingState,
      });
      return;
    }

    const acceptedRoute = {
      ...accepted.route,
      sketchV3DeferredHaltDiagnostic: {
        edgeId: edge.id,
        source: edge.from ?? null,
        target: sharedHaltNode.id,
        laneX: accepted.laneX,
        laneRank: accepted.laneRank,
        doglegX: accepted.doglegX,
        doglegRank: accepted.doglegRank,
        approachY: accepted.approachY,
        approachRank: accepted.approachRank,
        sourceExit: accepted.sourceExit ?? null,
        sourceExitRank: accepted.sourceExitRank ?? null,
        direction: accepted.direction ?? null,
        finalStyle: accepted.finalStyle ?? null,
        recordedOrder,
        committedOrder: placementRows.length,
        ordinaryPlacementCompleteOrder,
        candidateRouteDirectionsConsidered: Array.from(new Set(evaluated.map((candidate) => (
          candidate.routeCandidateDiagnostic.direction
        )))),
        candidateRouteDiagnostics: SKETCH_V3_FOCUSED_ORDINARY_ROUTE_EDGE_IDS.has(edge.id)
          ? evaluated.map((candidate) => candidate.routeCandidateDiagnostic)
          : [],
      },
    };
    assignRoute(edge, acceptedRoute, edgeRouteById, drawingState, instructionCount);
    recordHaltExitRouted({
      drawingState,
      haltExitRecordId,
      sharedHaltNodeId: sharedHaltNode.id,
      route: acceptedRoute,
      routedOrder: placementRows.length,
    });
    retirePendingBranchCorridor({
      edge,
      pendingCorridorByEdgeId,
      pendingCorridorRows,
      removedOrder: placementRows.length,
      removedReason: "haltRouteCommitted",
      convertedEdgeId: edge.id,
      drawingState,
    });
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
      sourceExit: accepted.sourceExit ?? null,
      sourceExitRank: accepted.sourceExitRank ?? null,
      direction: accepted.direction ?? null,
      finalStyle: accepted.finalStyle ?? null,
      recordedOrder,
      committedAfterOrdinaryPlacementComplete: true,
      routePoints: acceptedRoute.points,
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

function buildDiamondDiagnostics(
  edges,
  edgeRouteById,
  layout,
  instructionCount,
  instructionNodeByIndex,
  drawingState = null,
  pendingCorridorRows = [],
) {
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
        Math.abs(routeTangent - expectedTangent) <= SKETCH_V3_ANGLE_TOLERANCE;
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
        Math.abs(finalRouteTangent - expectedTangent) <= SKETCH_V3_ANGLE_TOLERANCE
      );
      const role = !isInstructionTarget(edge.targetIndex, instructionCount) || edge.to?.startsWith("halt")
        ? "HALT"
        : edge.targetIndex <= edge.sourceIndex
          ? "backward"
          : route?.routeKind === "sketchV3AlreadyDrawnTarget"
            ? "already-drawn target"
            : "ordinary new target";
      const usedException = role === "HALT" || role === "backward";
      const row = {
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
          ? route?.sketchV3AlreadyDrawnTargetDiagnostic ?? "alreadyDrawnTargetNotOnFixedAngleRay"
          : null,
        usedException,
        sideOwnershipPreserved: Number.isFinite(dx) ? dx * expectedDirection > 0 : false,
        points,
      };
      const focusedStructuralDiagnostic = makeFocusedDiamondExitStructuralDiagnostic({
        edge,
        row,
        drawingState,
        pendingCorridorRows,
      });
      return focusedStructuralDiagnostic
        ? { ...row, focusedStructuralDiagnostic }
        : row;
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
    .map(([edgeId, route]) => route?.sketchV3LoopReturnDiagnostic
      ? { ...route.sketchV3LoopReturnDiagnostic, edgeId }
      : null)
    .filter(Boolean);
}

function getRouteFailurePhase(failure) {
  if (!failure) return "none";
  if (failure.reason === "sketchV3NoLegalHaltRoute") return "final-route-drawing";
  if (failure.reason === "sketchV3NoLegalDeferredOrdinaryRoute") return "deferred-route-drawing";
  if (failure.reason === "sketchV3NoLegalAlreadyDrawnTargetRoute") return "placement-acceptance";
  if (failure.reason === "sketchV3NoLegalOrdinaryPlacement") return "placement-acceptance";
  return "unknown";
}

function getRouteDiagnosticsFromFailureOrRoute(failure, route) {
  if (failure?.candidateRouteDiagnostics) return failure.candidateRouteDiagnostics;
  if (failure?.routeDiagnostic?.candidateRouteDiagnostics) {
    return failure.routeDiagnostic.candidateRouteDiagnostics;
  }
  if (route?.sketchV3LoopReturnDiagnostic?.candidateRouteDiagnostics) {
    return route.sketchV3LoopReturnDiagnostic.candidateRouteDiagnostics;
  }
  if (route?.sketchV3DeferredHaltDiagnostic?.candidateRouteDiagnostics) {
    return route.sketchV3DeferredHaltDiagnostic.candidateRouteDiagnostics;
  }
  return [];
}

function getRouteDirectionsFromFailureOrRoute(failure, route, candidateDiagnostics) {
  if (failure?.candidateRouteDirectionsConsidered) return failure.candidateRouteDirectionsConsidered;
  if (failure?.routeDiagnostic?.candidateRouteDirectionsConsidered) {
    return failure.routeDiagnostic.candidateRouteDirectionsConsidered;
  }
  if (route?.sketchV3LoopReturnDiagnostic?.candidateRouteDirectionsConsidered) {
    return route.sketchV3LoopReturnDiagnostic.candidateRouteDirectionsConsidered;
  }
  if (route?.sketchV3DeferredHaltDiagnostic?.candidateRouteDirectionsConsidered) {
    return route.sketchV3DeferredHaltDiagnostic.candidateRouteDirectionsConsidered;
  }
  return Array.from(new Set(candidateDiagnostics.map((candidate) => candidate.direction).filter(Boolean)));
}

function hasPendingCorridorBlocker(candidateDiagnostics) {
  return candidateDiagnostics.some((candidate) => (
    candidate.firstRejection?.blockingGeometryRole === "pending branch corridor" ||
    candidate.blockingRows?.some((row) => row.blockingGeometryRole === "pending branch corridor")
  ));
}

function buildFocusedOrdinaryRouteDiagnostics({
  edgesById,
  edgeRouteById,
  drawingState,
  failures,
  instructionCount,
}) {
  const failureByEdgeId = new Map(
    failures
      .filter((failure) => failure.edgeId)
      .map((failure) => [failure.edgeId, failure]),
  );
  return Array.from(SKETCH_V3_FOCUSED_ORDINARY_ROUTE_EDGE_IDS)
    .map((edgeId) => {
      const edge = edgesById.get(edgeId) ?? null;
      if (!edge) return null;
      const route = edgeRouteById.get(edgeId) ?? null;
      const failure = failureByEdgeId.get(edgeId) ?? null;
      const sourceRecord = drawingState.nodesById.get(edge.from) ?? null;
      const targetNodeId = failure?.target ?? edge.to ?? null;
      const targetRecord = targetNodeId
        ? drawingState.nodesById.get(targetNodeId) ?? null
        : null;
      const classification = classifyOrdinaryRouteEdge(edge, sourceRecord, targetRecord, instructionCount);
      const candidateRouteDiagnostics = getRouteDiagnosticsFromFailureOrRoute(failure, route);
      const candidateRouteDirectionsConsidered = getRouteDirectionsFromFailureOrRoute(
        failure,
        route,
        candidateRouteDiagnostics,
      );
      const blockedByPendingCorridor = hasPendingCorridorBlocker(candidateRouteDiagnostics);
      return {
        edgeId,
        sourceId: edge.from ?? null,
        targetId: classification === "halt-exit"
          ? failure?.target ?? targetNodeId ?? "HALT"
          : edge.to ?? null,
        sourceBranchPath: cloneBranchPath(sourceRecord?.branchPath),
        targetBranchPath: classification === "halt-exit"
          ? []
          : cloneBranchPath(targetRecord?.branchPath),
        routeClassification: classification,
        sourceInstructionIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
        targetInstructionIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
        routeCommitted: Boolean(route),
        routePoints: clonePoints(route?.points),
        candidateRouteDirectionsConsidered,
        candidateRouteDiagnostics,
        reservationAssessment: {
          siblingBranchCorridorShouldHaveBeenReservedEarlier: blockedByPendingCorridor,
          siblingBranchCorridorReason: blockedByPendingCorridor
            ? "candidate blocked by active pending branch corridor"
            : null,
          haltCorridorShouldHaveBeenReservedEarlier: classification === "halt-exit" && Boolean(failure),
          haltCorridorReason: classification === "halt-exit" && failure
            ? "deferred HALT route failed during final route drawing"
            : null,
        },
        failurePhase: getRouteFailurePhase(failure),
        failureReason: failure?.reason ?? null,
        firstRejection: failure?.rejection ?? failure?.firstRejection ?? null,
      };
    })
    .filter(Boolean);
}

export function applySketchV3Layout(layoutPlan) {
  if (layoutPlan.layoutMode !== SKETCH_V3_LAYOUT_MODE) {
    return { layoutPlan, diagnostics: { sketchV3Enabled: false } };
  }

  const _pt = typeof performance !== "undefined" ? performance : null;
  const _t0 = _pt?.now() ?? 0;

  const layout = layoutPlan.layout;
  const instructionCount = layoutPlan.analysis.program.length;
  const params = buildSketchV3Parameters(layout);
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
  const deferredOrdinaryRoutes = [];
  const placementRejectionRows = [];
  const pendingCorridorByEdgeId = new Map();
  const pendingCorridorRows = [];
  const failures = [];
  const drawingState = createSketchV3DrawingState({ nodes, edges });

  if (startNode) {
    placeNode(startNode, { x: 0, y: 0 }, placedByNodeId, placementRows, "start", null, drawingState, layout, []);
  }

  const connectToExistingOrHalt = ({ edge, sourcePlacement, depth }) => {
    if (!edge || !sourcePlacement) return false;
    if (isHaltEdge(edge, instructionCount)) {
      const recordedOrder = placementRows.length;
      const haltExitRecord = recordHaltExitDeferred({
        drawingState,
        edge,
        sourcePlacement,
        depth,
        recordedOrder,
      });
      haltExits.push({
        edge,
        sourcePlacement,
        depth,
        recordedOrder,
        haltExitRecordId: haltExitRecord?.id ?? null,
      });
      const sourceRecord = drawingState.nodesById.get(edge.from) ?? null;
      const pendingHaltCorridor = makePendingHaltExitCorridor({
        edge,
        sourcePlacement,
        layout,
        params,
        createdOrder: recordedOrder,
        branchPath: cloneBranchPath(sourceRecord?.branchPath),
      });
      pendingCorridorByEdgeId.set(edge.id, pendingHaltCorridor);
      recordPendingCorridorCreated({ drawingState, corridor: pendingHaltCorridor });
      pendingCorridorRows.push({
        ...pendingHaltCorridor,
        footprint: { ...pendingHaltCorridor.footprint },
        segments: pendingHaltCorridor.segments.map((segment) => ({ ...segment })),
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
      drawingState,
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
      if (shouldDeferAlreadyDrawnTargetRoute({
        edge,
        route,
        pendingCorridorByEdgeId,
        instructionCount,
      })) {
        deferredOrdinaryRoutes.push({
          edge,
          sourcePlacement,
          targetPlacement,
          depth,
          deferredOrder: placementRows.length,
          deferredReason: "pendingBranchCorridorBlocksLoopBack",
        });
        placementRejectionRows.push({
          ...rejection,
          deferredRoute: true,
          deferredReason: "pendingBranchCorridorBlocksLoopBack",
        });
        return true;
      }
      placementRejectionRows.push(rejection);
      failures.push({
        edgeId: edge.id,
        reason: "sketchV3NoLegalAlreadyDrawnTargetRoute",
        rejection,
        routeDiagnostic: route?.sketchV3LoopReturnDiagnostic ?? null,
      });
      return true;
    }
    if (shouldDeferPreferredLoopReturnRoute({
      edge,
      route,
      pendingCorridorByEdgeId,
      instructionCount,
    })) {
      deferredOrdinaryRoutes.push({
        edge,
        sourcePlacement,
        targetPlacement,
        depth,
        deferredOrder: placementRows.length,
        deferredReason: "preferredLoopReturnSidePendingCorridor",
      });
      placementRejectionRows.push({
        candidateEdgeId: edge.id,
        rejectionKind: "preferred-loop-return-side-pending-corridor",
        blockingGeometryId: route.sketchV3LoopReturnDiagnostic?.preferredSide ?? edge.id,
        blockingGeometryRole: "pending branch corridor",
        clearance: null,
        candidatePoints: route.points,
        deferredRoute: true,
        deferredReason: "preferredLoopReturnSidePendingCorridor",
      });
      return true;
    }
    assignRoute(edge, route, edgeRouteById, drawingState, instructionCount);
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
    drawingState.activeBranchPath = cloneBranchPath(currentBranchPath);

    if (incomingEdge?.branch) {
      retirePendingBranchCorridor({
        edge: incomingEdge,
        pendingCorridorByEdgeId,
        pendingCorridorRows,
        removedOrder: placementRows.length,
        removedReason: "poppedForDrawing",
        convertedEdgeId: incomingEdge.id,
        drawingState,
      });
    }

    while (isInstructionTarget(index, instructionCount)) {
      drawingState.activeBranchPath = cloneBranchPath(currentBranchPath);
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
            drawingState,
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
            if (shouldDeferAlreadyDrawnTargetRoute({
              edge: incoming,
              route,
              pendingCorridorByEdgeId,
              instructionCount,
            })) {
              deferredOrdinaryRoutes.push({
                edge: incoming,
                sourcePlacement,
                targetPlacement: existingPlacement,
                depth,
                deferredOrder: placementRows.length,
                deferredReason: "pendingBranchCorridorBlocksLoopBack",
              });
              placementRejectionRows.push({
                ...rejection,
                deferredRoute: true,
                deferredReason: "pendingBranchCorridorBlocksLoopBack",
              });
              return;
            }
            placementRejectionRows.push(rejection);
            failures.push({
              edgeId: incoming.id,
              reason: "sketchV3NoLegalAlreadyDrawnTargetRoute",
              rejection,
              routeDiagnostic: route?.sketchV3LoopReturnDiagnostic ?? null,
            });
            return;
          }
          if (shouldDeferPreferredLoopReturnRoute({
            edge: incoming,
            route,
            pendingCorridorByEdgeId,
            instructionCount,
          })) {
            deferredOrdinaryRoutes.push({
              edge: incoming,
              sourcePlacement,
              targetPlacement: existingPlacement,
              depth,
              deferredOrder: placementRows.length,
              deferredReason: "preferredLoopReturnSidePendingCorridor",
            });
            placementRejectionRows.push({
              candidateEdgeId: incoming.id,
              rejectionKind: "preferred-loop-return-side-pending-corridor",
              blockingGeometryId: route.sketchV3LoopReturnDiagnostic?.preferredSide ?? incoming.id,
              blockingGeometryRole: "pending branch corridor",
              clearance: null,
              candidatePoints: route.points,
              deferredRoute: true,
              deferredReason: "preferredLoopReturnSidePendingCorridor",
            });
            return;
          }
          assignRoute(incoming, route, edgeRouteById, drawingState, instructionCount);
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
            outgoingBySource,
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
            ? "sketchV3NoLegalOrdinaryDiamondSplitPlacement"
            : "sketchV3NoLegalOrdinaryPlacement",
        });
        return;
      }

      const placement = placeNode(
        node,
        selectedCandidate.position,
        placedByNodeId,
        placementRows,
        placementKind,
        incoming,
        drawingState,
        layout,
        currentBranchPath,
      );
      traversalRows.push({
        order: traversalRows.length,
        instructionIndex: index,
        nodeId: node.id,
        placementKind,
        depth,
      });

      if (incoming && selectedCandidate.route) {
        assignRoute(incoming, selectedCandidate.route, edgeRouteById, drawingState, instructionCount);
      }

      const outgoing = outgoingBySource.get(index) ?? [];
      const noEdge = outgoing.find((edge) => edge.branch === "no") ?? null;
      const yesEdge = outgoing.find((edge) => edge.branch === "yes") ?? null;

      if (noEdge || yesEdge) {
        if (yesEdge) {
          if (isHaltEdge(yesEdge, instructionCount)) {
            connectToExistingOrHalt({ edge: yesEdge, sourcePlacement: placement, depth: depth + 1 });
          } else {
            const targetNode = instructionNodeByIndex.get(yesEdge.targetIndex);
            if (!targetNode) {
              failures.push({ edgeId: yesEdge.id, reason: "targetNodeMissing" });
            } else {
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
              recordPendingCorridorCreated({ drawingState, corridor: pendingCorridor });
              pendingCorridorRows.push({
                ...pendingCorridor,
                footprint: { ...pendingCorridor.footprint },
                segments: pendingCorridor.segments.map((segment) => ({ ...segment })),
              });
              const pendingBranch = {
                instructionIndex: yesEdge.targetIndex,
                position: pendingPosition,
                incomingEdge: yesEdge,
                depth: depth + 1,
                placementKind: "yesBranchTarget",
                branchPath: pendingBranchPath,
                pushedOrder: placementRows.length,
              };
              const pendingBranchRecord = recordPendingBranchQueued({ drawingState, pendingBranch });
              pendingYesStack.push({
                ...pendingBranch,
                pendingBranchRecordId: pendingBranchRecord?.id ?? null,
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
        drawingState.activeBranchPath = cloneBranchPath(currentBranchPath);
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
    walkFrom(popPendingBranch(drawingState, pendingYesStack, placementRows.length));
  }
  const _t1 = _pt?.now() ?? 0;

  const deferredHaltResult = commitDeferredHaltRoutes({
    haltExits,
    nodes,
    nodeById,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    pendingCorridorByEdgeId,
    pendingCorridorRows,
    placementRows,
    layout,
    params,
    instructionCount,
    failures,
    drawingState,
  });

  const _t2 = _pt?.now() ?? 0;
  const deferredOrdinaryRouteResult = commitDeferredOrdinaryRoutes({
    deferredRoutes: deferredOrdinaryRoutes,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionNodeByIndex,
    pendingCorridorByEdgeId,
    layout,
    params,
    instructionCount,
    failures,
    drawingState,
  });

  const _t3 = _pt?.now() ?? 0;
  const unplacedInstructionNodes = instructionNodes.filter((node) => !placedByNodeId.has(node.id));
  if (unplacedInstructionNodes.length > 0) {
    failures.push({
      reason: "unplacedInstructionNodes",
      nodeIds: unplacedInstructionNodes.map((node) => node.id),
    });
  }

  const diamondDiagnostics = buildDiamondDiagnostics(
    edges,
    edgeRouteById,
    layout,
    instructionCount,
    instructionNodeByIndex,
    drawingState,
    pendingCorridorRows,
  );
  const loopReturnDiagnostics = buildLoopReturnDiagnostics(edgeRouteById);
  const focusedOrdinaryRouteDiagnostics = buildFocusedOrdinaryRouteDiagnostics({
    edgesById,
    edgeRouteById,
    drawingState,
    failures,
    instructionCount,
  });
  const _t4 = _pt?.now() ?? 0;
  const fallbackRequired = failures.length > 0;
  const drawingStateRecords = serializeDrawingState(drawingState);
  const sketchV3PhaseTiming = _pt ? {
    n: instructionCount,
    dfsTraversal: _t1 - _t0,
    deferredHaltRouting: _t2 - _t1,
    deferredOrdinaryRouting: _t3 - _t2,
    diagnosticAssembly: _t4 - _t3,
    total: _t4 - _t0,
  } : null;
  const diagnostics = {
    sketchV3Enabled: true,
    sketchV3FallbackUsed: fallbackRequired,
    sketchV3FallbackReason: fallbackRequired ? "sketchV3FirstPassPlacementFailed" : null,
    sketchV3DrawingState: drawingStateRecords,
    sketchV3NodeRecords: Object.values(drawingStateRecords.nodesById),
    sketchV3EdgeRecords: Object.values(drawingStateRecords.edgesById),
    sketchV3DiamondRecords: Object.values(drawingStateRecords.diamondsById),
    sketchV3BranchPathRows: drawingState.diagnostics.branchPathRows,
    sketchV3PendingBranchRows: drawingState.pendingBranches,
    sketchV3PendingCorridorLifecycleRows: pendingCorridorRows,
    sketchV3HaltExitRecords: drawingState.haltExits,
    sketchV3FailureRows: failures,
    sketchV3PlacementRejectionRows: placementRejectionRows,
    sketchV3PlacementRows: placementRows,
    sketchV3TraversalRows: traversalRows,
    sketchV3PendingBranchCorridorRows: pendingCorridorRows,
    sketchV3PendingBranchCorridorConflictRows: placementRejectionRows.filter((row) => (
      row.blockingGeometryRole === "pending branch corridor"
    )),
    sketchV3DeferredOrdinaryRouteRows: deferredOrdinaryRouteResult.rows,
    sketchV3DeferredOrdinaryRouteConflictRows: deferredOrdinaryRouteResult.conflictRows,
    sketchV3DeferredHaltRows: deferredHaltResult.haltRows,
    sketchV3DeferredHaltConflictRows: deferredHaltResult.haltConflictRows,
    sketchV3FocusedOrdinaryRouteRows: focusedOrdinaryRouteDiagnostics,
    sketchV3HaltCommittedBeforeOrdinaryPlacementComplete:
      deferredHaltResult.haltCommittedBeforeOrdinaryPlacementComplete,
    sketchV3SharedHaltNodeId: deferredHaltResult.sharedHaltNodeId,
    sketchV3PendingYesLifoUsed: true,
    sketchV3DiamondExitRows: diamondDiagnostics.rows,
    sketchV3NonStraightDiamondExitRows: diamondDiagnostics.nonStraightRows,
    sketchV3LShapedDiamondExitRows: diamondDiagnostics.lShapedRows,
    sketchV3NoYesSideOwnershipRows: diamondDiagnostics.sideOwnershipRows,
    sketchV3LoopReturnRows: loopReturnDiagnostics,
    sketchV3LoopReturnBelowClearanceRows:
      loopReturnDiagnostics.filter((row) => row.belowClearanceThreshold),
    sketchV3LoopReturnDiamondObstacleRows:
      loopReturnDiagnostics.filter((row) => row.passesThroughExpandedDiamondObstacle),
    sketchV3LoopReturnSplitExitLaneConflictRows:
      loopReturnDiagnostics.filter((row) => row.overlapsProtectedSplitExitLane),
    sketchV3LoopReturnUnrelatedEdgeLaneConflictRows:
      loopReturnDiagnostics.filter((row) => row.overlapsUnrelatedEdgeLane),
    sketchV3OrdinaryDiamondSplitExitNotStraightFixedAngle:
      diamondDiagnostics.nonStraightRows.length > 0,
    sketchV3OrdinaryDiamondSplitExitLShaped:
      diamondDiagnostics.lShapedRows.length > 0,
    sketchV3NoYesSideOwnershipPreserved:
      diamondDiagnostics.sideOwnershipRows.length === 0,
    sketchV3Parameters: params,
    sketchV3PhaseTiming,
  };

  if (fallbackRequired) {
    const error = new Error("sketchV3FirstPassPlacementFailed");
    error.sketchV3FallbackDiagnostics = diagnostics;
    throw error;
  }

  edges.forEach((edge) => {
    const route = edgeRouteById.get(edge.id);
    if (route) edge.sketchV3ReservedRoute = route;
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
        layoutMode: SKETCH_V3_LAYOUT_MODE,
      },
      sketchV3PlacementDebug: diagnostics,
    },
    diagnostics,
  };
}
