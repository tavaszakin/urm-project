const SKETCH_LAYOUT_MODE = "sketchV1";
const SKETCH_EDGE_LANE_MARGIN = 6;
const SKETCH_EDGE_NODE_LANE_MARGIN = 3;
const SKETCH_DIAMOND_EXIT_ANGLE_TOLERANCE = 0.08;

function isInstructionTarget(index, instructionCount) {
  return Number.isInteger(index) && index >= 0 && index < instructionCount;
}

function isBackwardEdge(edge) {
  return (
    Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex
  );
}

function isSketchStartEdge(edge) {
  return edge?.id === "start-edge" || edge?.type === "start";
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

function getNodeBoundsAt(node, position, getNodeSize, layout) {
  const { width, height } = getNodeSize(node, layout);

  return {
    left: position.x - width / 2,
    right: position.x + width / 2,
    top: position.y - height / 2,
    bottom: position.y + height / 2,
  };
}

function boundsOverlap(left, right, padding = 0) {
  if (!left || !right) return false;

  return !(
    left.right + padding <= right.left ||
    right.right + padding <= left.left ||
    left.bottom + padding <= right.top ||
    right.bottom + padding <= left.top
  );
}

function unionBounds(bounds) {
  if (bounds.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

  return {
    left: Math.min(...bounds.map((entry) => entry.left)),
    right: Math.max(...bounds.map((entry) => entry.right)),
    top: Math.min(...bounds.map((entry) => entry.top)),
    bottom: Math.max(...bounds.map((entry) => entry.bottom)),
  };
}

function inflateBox(box, padding) {
  return {
    left: box.left - padding,
    right: box.right + padding,
    top: box.top - padding,
    bottom: box.bottom + padding,
  };
}

function boxForPoints(points, padding = 0) {
  return inflateBox({
    left: Math.min(...points.map((point) => point[0])),
    right: Math.max(...points.map((point) => point[0])),
    top: Math.min(...points.map((point) => point[1])),
    bottom: Math.max(...points.map((point) => point[1])),
  }, padding);
}

function maxPointX(points) {
  const xs = (points ?? []).map((point) => point?.[0]).filter(Number.isFinite);
  return xs.length > 0 ? Math.max(...xs) : null;
}

function boxFromSegments(points, padding = 0) {
  if (!Array.isArray(points) || points.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  return boxForPoints(points, padding);
}

function interpolatePoint(start, end, ratio) {
  return [
    start[0] + (end[0] - start[0]) * ratio,
    start[1] + (end[1] - start[1]) * ratio,
  ];
}

function isFinitePoint(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function areFinitePoints(points) {
  return Array.isArray(points) && points.length >= 2 && points.every(isFinitePoint);
}

function isFiniteBox(box) {
  return Boolean(
    box &&
    Number.isFinite(box.left) &&
    Number.isFinite(box.right) &&
    Number.isFinite(box.top) &&
    Number.isFinite(box.bottom),
  );
}

function getSegmentOrientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function pointOnSegment(point, start, end) {
  return (
    point[0] <= Math.max(start[0], end[0]) + 0.001 &&
    point[0] >= Math.min(start[0], end[0]) - 0.001 &&
    point[1] <= Math.max(start[1], end[1]) + 0.001 &&
    point[1] >= Math.min(start[1], end[1]) - 0.001
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = getSegmentOrientation(a, b, c);
  const o2 = getSegmentOrientation(a, b, d);
  const o3 = getSegmentOrientation(c, d, a);
  const o4 = getSegmentOrientation(c, d, b);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < 0.001 && pointOnSegment(c, a, b)) return true;
  if (Math.abs(o2) < 0.001 && pointOnSegment(d, a, b)) return true;
  if (Math.abs(o3) < 0.001 && pointOnSegment(a, c, d)) return true;
  if (Math.abs(o4) < 0.001 && pointOnSegment(b, c, d)) return true;

  return false;
}

function segmentIntersectsBox(start, end, box) {
  if (!isFinitePoint(start) || !isFinitePoint(end) || !isFiniteBox(box)) return false;
  if (
    start[0] >= box.left &&
    start[0] <= box.right &&
    start[1] >= box.top &&
    start[1] <= box.bottom
  ) {
    return true;
  }
  if (
    end[0] >= box.left &&
    end[0] <= box.right &&
    end[1] >= box.top &&
    end[1] <= box.bottom
  ) {
    return true;
  }

  const topLeft = [box.left, box.top];
  const topRight = [box.right, box.top];
  const bottomRight = [box.right, box.bottom];
  const bottomLeft = [box.left, box.bottom];

  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function pointsEqual(left, right, epsilon = 0.001) {
  return (
    isFinitePoint(left) &&
    isFinitePoint(right) &&
    Math.abs(left[0] - right[0]) <= epsilon &&
    Math.abs(left[1] - right[1]) <= epsilon
  );
}

function routeSegments(points) {
  if (!areFinitePoints(points)) return [];
  return points.slice(1).map((point, index) => ({
    start: points[index],
    end: point,
  }));
}

function segmentLength(start, end) {
  if (!isFinitePoint(start) || !isFinitePoint(end)) return 0;
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function distancePointToSegment(point, start, end) {
  if (!isFinitePoint(point) || !isFinitePoint(start) || !isFinitePoint(end)) return Infinity;
  const lengthSq = ((end[0] - start[0]) ** 2) + ((end[1] - start[1]) ** 2);
  if (lengthSq <= 0.001) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, (
    ((point[0] - start[0]) * (end[0] - start[0])) +
    ((point[1] - start[1]) * (end[1] - start[1]))
  ) / lengthSq));
  const projected = [
    start[0] + t * (end[0] - start[0]),
    start[1] + t * (end[1] - start[1]),
  ];
  return Math.hypot(point[0] - projected[0], point[1] - projected[1]);
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

function segmentProjectionOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const dx = leftEnd[0] - leftStart[0];
  const dy = leftEnd[1] - leftStart[1];
  const length = Math.hypot(dx, dy);
  if (length <= 0.001) return 0;
  const ux = dx / length;
  const uy = dy / length;
  const project = (point) => ((point[0] - leftStart[0]) * ux) + ((point[1] - leftStart[1]) * uy);
  const leftMin = 0;
  const leftMax = length;
  const rightA = project(rightStart);
  const rightB = project(rightEnd);
  return Math.max(0, Math.min(leftMax, Math.max(rightA, rightB)) - Math.max(leftMin, Math.min(rightA, rightB)));
}

function segmentLaneConflict(candidateSegment, existingSegment, margin = 6) {
  const leftLength = segmentLength(candidateSegment.start, candidateSegment.end);
  const rightLength = segmentLength(existingSegment.start, existingSegment.end);
  if (leftLength <= 0.001 || rightLength <= 0.001) return null;

  const cross = (
    (candidateSegment.end[0] - candidateSegment.start[0]) *
    (existingSegment.end[1] - existingSegment.start[1])
  ) - (
    (candidateSegment.end[1] - candidateSegment.start[1]) *
    (existingSegment.end[0] - existingSegment.start[0])
  );
  const parallelTolerance = Math.max(0.02, margin / Math.max(leftLength, rightLength));
  const nearlyParallel = Math.abs(cross / (leftLength * rightLength)) <= parallelTolerance;
  if (!nearlyParallel) return null;

  const overlapLength = segmentProjectionOverlap(
    candidateSegment.start,
    candidateSegment.end,
    existingSegment.start,
    existingSegment.end,
  );
  if (overlapLength <= margin * 1.5) return null;

  const distance = distanceBetweenSegments(
    candidateSegment.start,
    candidateSegment.end,
    existingSegment.start,
    existingSegment.end,
  );
  if (distance > margin) return null;

  const collinear = distance <= 0.001;

  return {
    conflictKind: collinear ? "edge-lane-collinear-overlap" : "edge-lane-near-parallel-overlap",
    reason: collinear
      ? "candidateEdgeOverlapsCommittedEdgeLane"
      : "candidateEdgeRunsTooCloseToCommittedEdgeLane",
    overlapLength,
    distance,
  };
}

function isLocalEndpointLaneContact(laneConflict, leftSegment, rightSegment) {
  if (!laneConflict) return false;
  const endpointsTouch = (
    pointsEqual(leftSegment.start, rightSegment.start) ||
    pointsEqual(leftSegment.start, rightSegment.end) ||
    pointsEqual(leftSegment.end, rightSegment.start) ||
    pointsEqual(leftSegment.end, rightSegment.end)
  );
  return endpointsTouch && laneConflict.overlapLength <= SKETCH_EDGE_LANE_MARGIN * 1.5;
}

function getDiamondExitAngleTangent(layout) {
  const layoutAngle = Number.isFinite(layout.branchAngleDeg)
    ? Math.tan(Math.max(0.2, (layout.branchAngleDeg * Math.PI) / 180))
    : null;
  if (Number.isFinite(layoutAngle) && layoutAngle > 0.001) return layoutAngle;
  return Math.max(0.001, layout.diamondHeight / layout.diamondWidth);
}

function reservationSegments(reservation) {
  const points = reservation?.points;
  if (!areFinitePoints(points)) return [];
  return routeSegments(points);
}

function reservationsConflict(candidate, existing) {
  if (!isFiniteBox(candidate?.box) || !isFiniteBox(existing?.box)) return false;
  const candidateSegments = reservationSegments(candidate);
  const existingSegments = reservationSegments(existing);

  if (candidateSegments.length > 0 && existingSegments.length > 0) {
    return candidateSegments.some((candidateSegment) => (
      existingSegments.some((existingSegment) => (
        segmentsIntersect(
          candidateSegment.start,
          candidateSegment.end,
          existingSegment.start,
          existingSegment.end,
        )
      ))
    ));
  }

  if (candidateSegments.length > 0) {
    return candidateSegments.some((segment) => (
      segmentIntersectsBox(segment.start, segment.end, existing.box)
    ));
  }

  if (existingSegments.length > 0) {
    return existingSegments.some((segment) => (
      segmentIntersectsBox(segment.start, segment.end, candidate.box)
    ));
  }

  return boundsOverlap(candidate.box, existing.box, 0);
}

function getFrameById(frames, frameId) {
  return frames.find((frame) => frame.frameId === frameId) ?? null;
}

function isAncestorFrame(frames, ancestorId, descendantId) {
  if (!ancestorId || !descendantId || ancestorId === descendantId) return false;
  let cursor = getFrameById(frames, descendantId);

  while (cursor?.parentId) {
    if (cursor.parentId === ancestorId) return true;
    cursor = getFrameById(frames, cursor.parentId);
  }

  return false;
}

function framesAreAncestorRelated(frames, leftFrameId, rightFrameId) {
  return (
    leftFrameId === rightFrameId ||
    isAncestorFrame(frames, leftFrameId, rightFrameId) ||
    isAncestorFrame(frames, rightFrameId, leftFrameId)
  );
}

function reservationTouchesOwnEndpoint(left, right) {
  const leftNodes = new Set([
    left.ownerNodeId,
    left.sourceNodeId,
    left.targetNodeId,
  ].filter(Boolean));
  const rightNodes = new Set([
    right.ownerNodeId,
    right.sourceNodeId,
    right.targetNodeId,
  ].filter(Boolean));

  return Array.from(leftNodes).some((nodeId) => rightNodes.has(nodeId));
}

function isEdgeLikeReservation(reservation) {
  return ["edgeLane", "loopCorridor", "haltCorridor"].includes(reservation?.kind);
}

function classifyReservationOverlap(left, right, frames = []) {
  if (!reservationsConflict(left, right)) return null;

  const pairKinds = new Set([left.kind, right.kind]);
  const has = (kind) => pairKinds.has(kind);
  const sameEdge = Boolean(left.ownerEdgeId && left.ownerEdgeId === right.ownerEdgeId);
  const sameNode = Boolean(left.ownerNodeId && left.ownerNodeId === right.ownerNodeId);
  const sameFrame = Boolean(left.branchId && left.branchId === right.branchId);
  const ancestorRelated = framesAreAncestorRelated(frames, left.branchId, right.branchId);
  const touchesOwnEndpoint = reservationTouchesOwnEndpoint(left, right);
  const leftAlreadyDrawn = Boolean(left.alreadyDrawnTarget);
  const rightAlreadyDrawn = Boolean(right.alreadyDrawnTarget);

  if (sameEdge || sameNode || touchesOwnEndpoint) {
    return {
      classification: "allowed",
      reason: "ownEndpointOrOwner",
      illegalSource: null,
    };
  }

  if (has("branchEnvelope") && has("nodeBox")) {
    if (sameFrame || ancestorRelated) {
      return {
        classification: "expectedContainment",
        reason: "branchEnvelopeContainsOwnedNode",
        illegalSource: null,
      };
    }
    return {
      classification: "illegal",
      reason: "branchEnvelopeOverlapsUnrelatedNode",
      illegalSource: "branch envelope not expanded enough",
    };
  }

  if (left.kind === "branchEnvelope" && right.kind === "branchEnvelope") {
    if (ancestorRelated) {
      return {
        classification: "expectedContainment",
        reason: "parentBranchEnvelopeContainsChildBranchEnvelope",
        illegalSource: null,
      };
    }
    if (leftAlreadyDrawn || rightAlreadyDrawn) {
      return {
        classification: "allowed",
        reason: "alreadyDrawnTargetConnectionRegion",
        illegalSource: null,
      };
    }
    return {
      classification: "illegal",
      reason: "siblingBranchEnvelopesOverlap",
      illegalSource: "branch envelope not expanded enough",
    };
  }

  if (has("branchEnvelope") && has("edgeLane")) {
    if (sameFrame || ancestorRelated) {
      return {
        classification: "expectedContainment",
        reason: "branchEnvelopeContainsOwnedEdgeLane",
        illegalSource: null,
      };
    }
    return {
      classification: "illegal",
      reason: "edgeLaneCrossesUnrelatedBranchEnvelope",
      illegalSource: leftAlreadyDrawn || rightAlreadyDrawn
        ? "already-drawn target routing"
        : "branch envelope not expanded enough",
    };
  }

  if (has("edgeLane") && has("nodeBox")) {
    return {
      classification: "illegal",
      reason: "edgeLaneCrossesUnrelatedNodeBox",
      illegalSource: "placement default too small",
    };
  }

  if (left.kind === "edgeLane" && right.kind === "edgeLane") {
    if (
      left.edgeRole === "ordinaryForward" &&
      right.edgeRole === "ordinaryForward"
    ) {
      return {
        classification: "illegal",
        reason: "ordinaryEdgeLaneCrossesUnrelatedOrdinaryEdgeLane",
        illegalSource: "placement default too small",
      };
    }
    return {
      classification: "allowed",
      reason: "nonOrdinaryOrAlreadyDrawnEdgeLaneOverlap",
      illegalSource: null,
    };
  }

  if (has("loopCorridor")) {
    if (has("branchEnvelope") && (sameFrame || ancestorRelated)) {
      return {
        classification: "expectedContainment",
        reason: "loopCorridorOwnedByRelatedBranchFrame",
        illegalSource: null,
      };
    }
    if (has("nodeBox") || has("branchEnvelope")) {
      return {
        classification: "illegal",
        reason: has("nodeBox")
          ? "loopCorridorCrossesUnrelatedNodeBox"
          : "loopCorridorCrossesUnrelatedBranchInterior",
        illegalSource: "loop corridor lane selection",
      };
    }
    if (has("haltCorridor")) {
      return {
        classification: "illegal",
        reason: "loopCorridorCrossesHaltCorridor",
        illegalSource: "loop corridor lane selection",
      };
    }
    return {
      classification: "allowed",
      reason: "loopCorridorSharesOuterCorridor",
      illegalSource: null,
    };
  }

  if (has("haltCorridor")) {
    if (has("branchEnvelope") && (sameFrame || ancestorRelated)) {
      return {
        classification: "expectedContainment",
        reason: "haltCorridorOwnedByRelatedBranchFrame",
        illegalSource: null,
      };
    }
    if (has("nodeBox") || has("branchEnvelope")) {
      return {
        classification: "illegal",
        reason: has("nodeBox")
          ? "haltCorridorCrossesUnrelatedNodeBox"
          : "haltCorridorCrossesUnrelatedBranchEnvelope",
        illegalSource: "HALT corridor placement",
      };
    }
    return {
      classification: "allowed",
      reason: "haltCorridorSharesExitArea",
      illegalSource: null,
    };
  }

  if (isEdgeLikeReservation(left) || isEdgeLikeReservation(right)) {
    return {
      classification: "illegal",
      reason: "edgeReservationCrossesUnrelatedReservation",
      illegalSource: "already-drawn target routing",
    };
  }

  return {
    classification: sameFrame || ancestorRelated ? "expectedContainment" : "illegal",
    reason: sameFrame || ancestorRelated
      ? "sameFrameOrAncestorContainment"
      : "unrelatedReservationOverlap",
    illegalSource: sameFrame || ancestorRelated ? null : "placement default too small",
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

function getDiamondAnchors(bounds) {
  const topAnchor = [bounds.centerX, bounds.top];
  const bottomAnchor = [bounds.centerX, bounds.bottom];
  const leftAnchor = [bounds.left, bounds.centerY];
  const rightAnchor = [bounds.right, bounds.centerY];

  return {
    topAnchor,
    bottomAnchor,
    leftAnchor,
    rightAnchor,
    lowerLeftSideCenter: [
      leftAnchor[0] + (bottomAnchor[0] - leftAnchor[0]) * 0.5,
      leftAnchor[1] + (bottomAnchor[1] - leftAnchor[1]) * 0.5,
    ],
    lowerRightSideCenter: [
      rightAnchor[0] + (bottomAnchor[0] - rightAnchor[0]) * 0.5,
      rightAnchor[1] + (bottomAnchor[1] - rightAnchor[1]) * 0.5,
    ],
  };
}

function boundsFromNodeAt(node, position, getNodeSize, layout) {
  const bounds = getNodeBoundsAt(node, position, getNodeSize, layout);
  return {
    ...bounds,
    centerX: position.x,
    centerY: position.y,
  };
}

function makeFrameRecord({
  frameId,
  kind,
  parentId = null,
  ownerEdgeId = null,
  startInstructionIndex = null,
  side = "root",
  splitDepth = 0,
  branchPath = [],
}) {
  return {
    frameId,
    kind,
    parentId,
    ownerEdgeId,
    startInstructionIndex,
    side,
    splitDepth,
    branchPath,
    ownedNodeIds: [],
    childFrameIds: [],
  };
}

function buildSketchParameters(layout) {
  const ordinaryStepY = Math.max(
    layout.actionNodeHeight + layout.verticalGap * 2.2,
    layout.diamondHeight + layout.verticalGap,
    82,
  );
  const splitStepY = Math.max(
    layout.diamondHeight + layout.verticalGap * 2.6,
    ordinaryStepY,
    112,
  );
  const angleRadians = Math.max(0.2, (layout.branchAngleDeg * Math.PI) / 180);
  const angleBasedDx = splitStepY / Math.tan(angleRadians);
  const splitStepX = Math.max(
    layout.localBranchTargetOffset * 1.75,
    layout.branchForkDx * 3.2,
    angleBasedDx,
    220,
  );

  return {
    ordinaryStepY,
    splitStepY,
    splitStepX,
    collisionPadding: Math.max(layout.sideRouteGap, 18),
    branchEnvelopePadding: Math.max(layout.localBranchTargetOffset * 0.55, 90),
    edgeLanePadding: Math.max(layout.sideRouteGap, 18),
    loopCorridorPadding: Math.max(layout.sideRouteGap * 1.4, 26),
    haltCorridorPadding: Math.max(layout.sideRouteGap * 1.5, 30),
    outwardShiftStep: Math.max(layout.branchForkDx, 64),
    downwardShiftStep: Math.max(layout.verticalGap, 28),
    reservationExpansionLimit: 160,
  };
}

function buildOutgoingMaps(analysis) {
  const outgoingBySource = new Map();

  analysis.edges.forEach((edge) => {
    if (Number.isInteger(edge.sourceIndex)) {
      appendMapList(outgoingBySource, edge.sourceIndex, edge);
    }
  });

  return { outgoingBySource };
}

function choosePrimaryEdge(edges, sourceIndex) {
  return edges.find((edge) => edge.targetIndex === sourceIndex + 1) ?? edges[0] ?? null;
}

function makeSketchEdgeRoute({
  edge,
  routeKind,
  points,
  labelPoint = null,
}) {
  return {
    edgeId: edge.id,
    routeKind,
    points,
    labelX: labelPoint?.[0],
    labelY: labelPoint?.[1],
  };
}

function createSketchOccupancyLedger({ getFrames = () => [] } = {}) {
  const reservations = [];
  const reservationRows = [];
  const conflictRows = [];
  const rawOverlapRows = [];
  const allowedOverlapRows = [];
  const expansionRows = [];
  let reservationSerial = 0;

  const makeOverlapRow = ({
    left,
    right,
    classification,
    reason,
    illegalSource,
    context = null,
    unresolvedAfterExpansionLimit = false,
  }) => ({
    leftReservationId: left.id ?? null,
    leftKind: left.kind,
    leftOwnerEdgeId: left.ownerEdgeId ?? null,
    leftOwnerNodeId: left.ownerNodeId ?? null,
    leftBranchId: left.branchId ?? null,
    leftParentFrameId: left.parentFrameId ?? null,
    leftSide: left.side ?? null,
    leftEdgeRole: left.edgeRole ?? null,
    rightReservationId: right.id ?? null,
    rightKind: right.kind,
    rightOwnerEdgeId: right.ownerEdgeId ?? null,
    rightOwnerNodeId: right.ownerNodeId ?? null,
    rightBranchId: right.branchId ?? null,
    rightParentFrameId: right.parentFrameId ?? null,
    rightSide: right.side ?? null,
    rightEdgeRole: right.edgeRole ?? null,
    classification,
    reason,
    illegalSource,
    context,
    unresolvedAfterExpansionLimit,
    conflictBox: unionBounds([left.box, right.box]),
  });

  const addReservation = (reservation) => {
    const record = {
      id: reservation.id ?? `sketch-reservation-${reservationSerial}`,
      order: reservations.length,
      ...reservation,
    };
    reservationSerial += 1;
    reservations.push(record);
    reservationRows.push({
      order: record.order,
      reservationId: record.id,
      kind: record.kind,
      ownerEdgeId: record.ownerEdgeId ?? null,
      ownerNodeId: record.ownerNodeId ?? null,
      branchId: record.branchId ?? null,
      parentFrameId: record.parentFrameId ?? null,
      frameKind: record.frameKind ?? null,
      frameSide: record.frameSide ?? null,
      side: record.side ?? null,
      sourceNodeId: record.sourceNodeId ?? null,
      targetNodeId: record.targetNodeId ?? null,
      edgeRole: record.edgeRole ?? null,
      alreadyDrawnTarget: Boolean(record.alreadyDrawnTarget),
      provisional: Boolean(record.provisional),
      box: record.box,
      points: record.points ?? null,
    });
    return record;
  };

  const removeReservations = (predicate) => {
    for (let index = reservations.length - 1; index >= 0; index -= 1) {
      if (predicate(reservations[index])) reservations.splice(index, 1);
    }
  };

  const reassignNodeReservationsToFrame = (nodeId, frame) => {
    reservations.forEach((reservation) => {
      if (reservation.ownerNodeId !== nodeId && reservation.targetNodeId !== nodeId) return;
      reservation.branchId = frame.frameId;
      reservation.parentFrameId = frame.parentId ?? null;
      reservation.frameKind = frame.kind;
      reservation.frameSide = frame.side;
    });
    reservationRows.forEach((row) => {
      if (row.ownerNodeId !== nodeId && row.targetNodeId !== nodeId) return;
      row.branchId = frame.frameId;
      row.parentFrameId = frame.parentId ?? null;
      row.frameKind = frame.kind;
      row.frameSide = frame.side;
    });
  };

  const findConflicts = (candidates, context = {}) => {
    const rows = [];
    candidates.forEach((candidate) => {
      if (!isFiniteBox(candidate.box)) return;
      reservations.forEach((existing) => {
        if (!isFiniteBox(existing.box)) return;
        if (context.ignoreReservationIds?.has(existing.id)) return;
        if (!reservationsConflict(candidate, existing)) return;
        const classified = classifyReservationOverlap(candidate, existing, getFrames());
        if (!classified) return;
        const row = makeOverlapRow({
          left: candidate,
          right: existing,
          ...classified,
          context: context.context ?? null,
        });
        rawOverlapRows.push({
          order: rawOverlapRows.length,
          ...row,
        });
        if (classified.classification !== "illegal") {
          allowedOverlapRows.push({
            order: allowedOverlapRows.length,
            ...row,
          });
          return;
        }
        rows.push({
          order: conflictRows.length + rows.length,
          candidateKind: candidate.kind,
          candidateOwnerEdgeId: candidate.ownerEdgeId ?? null,
          candidateOwnerNodeId: candidate.ownerNodeId ?? null,
          candidateBranchId: candidate.branchId ?? null,
          candidateParentFrameId: candidate.parentFrameId ?? null,
          candidateSide: candidate.side ?? null,
          candidateEdgeRole: candidate.edgeRole ?? null,
          existingReservationId: existing.id,
          existingKind: existing.kind,
          existingOwnerEdgeId: existing.ownerEdgeId ?? null,
          existingOwnerNodeId: existing.ownerNodeId ?? null,
          existingBranchId: existing.branchId ?? null,
          existingParentFrameId: existing.parentFrameId ?? null,
          existingSide: existing.side ?? null,
          existingEdgeRole: existing.edgeRole ?? null,
          branchId: candidate.branchId ?? null,
          classification: classified.classification,
          reason: classified.reason,
          illegalSource: classified.illegalSource,
          conflictBox: row.conflictBox,
          context: context.context ?? null,
        });
      });
    });
    return rows;
  };

  const recordConflicts = (rows) => {
    rows.forEach((row) => {
      conflictRows.push({
        ...row,
        order: conflictRows.length,
      });
    });
  };

  const recordExpansion = (row) => {
    expansionRows.push({
      order: expansionRows.length,
      ...row,
    });
  };

  return {
    reservations,
    reservationRows,
    conflictRows,
    rawOverlapRows,
    allowedOverlapRows,
    expansionRows,
    addReservation,
    removeReservations,
    reassignNodeReservationsToFrame,
    findConflicts,
    recordConflicts,
    recordExpansion,
  };
}

function createDrawnGeometryLedger() {
  const nodeBoxes = [];
  const edgeSegments = [];
  const ledgerRows = [];
  const candidateRows = [];
  const rejectionRows = [];
  const committedEdgeRows = [];
  const backwardRoutingRows = [];
  const haltRoutingRows = [];
  let candidateSerial = 0;

  const addLedgerRow = (entry) => {
    ledgerRows.push({
      order: ledgerRows.length,
      ...entry,
    });
  };

  const addNodeBox = ({
    nodeId,
    instructionIndex = null,
    box,
    branchId = null,
    splitDepth = 0,
    branchPath = [],
  }) => {
    const record = {
      order: nodeBoxes.length,
      nodeId,
      instructionIndex,
      box,
      branchId,
      splitDepth,
      branchPath,
    };
    nodeBoxes.push(record);
    addLedgerRow({
      kind: "nodeBox",
      nodeId,
      instructionIndex,
      branchId,
      splitDepth,
      branchPath,
      box,
    });
    return record;
  };

  const addEdgeRoute = ({
    edge,
    points,
    role,
    branchId = null,
    splitDepth = 0,
    localBranchDepth = 0,
    branchPath = [],
  }) => {
    const segments = routeSegments(points);
    segments.forEach((segment, segmentIndex) => {
      const record = {
        order: edgeSegments.length,
        edgeId: edge.id,
        sourceNodeId: edge.from ?? null,
        targetNodeId: edge.to ?? null,
        sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
        targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
        branch: edge.branch ?? null,
        role,
        branchId,
        splitDepth,
        localBranchDepth,
        branchPath,
        segmentIndex,
        start: segment.start,
        end: segment.end,
      };
      edgeSegments.push(record);
      addLedgerRow({
        kind: "edgeSegment",
        edgeId: edge.id,
        segmentIndex,
        role,
        branchId,
        splitDepth,
        localBranchDepth,
        branchPath,
        start: segment.start,
        end: segment.end,
      });
    });
    committedEdgeRows.push({
      order: committedEdgeRows.length,
      edgeId: edge.id,
      role,
      branchId,
      splitDepth,
      localBranchDepth,
      branchPath,
      points,
      segments,
    });
  };

  const recordCandidate = (row) => {
    const candidateId = `sketch-candidate-${candidateSerial}`;
    candidateSerial += 1;
    candidateRows.push({
      order: candidateRows.length,
      candidateId,
      accepted: false,
      ...row,
    });
    return candidateId;
  };

  const markCandidateAccepted = (candidateId, extra = {}) => {
    const row = candidateRows.find((candidate) => candidate.candidateId === candidateId);
    if (!row) return;
    row.accepted = true;
    row.acceptedOrder = committedEdgeRows.length;
    Object.assign(row, extra);
  };

  const recordRejection = (row) => {
    rejectionRows.push({
      order: rejectionRows.length,
      ...row,
    });
  };

  const isLegalEndpointContact = (candidateSegment, existingSegment, edge) => {
    const candidateEndpoints = [candidateSegment.start, candidateSegment.end];
    const existingEndpoints = [existingSegment.start, existingSegment.end];
    const endpointsTouch = candidateEndpoints.some((candidatePoint) => (
      existingEndpoints.some((existingPoint) => pointsEqual(candidatePoint, existingPoint))
    ));
    if (!endpointsTouch) return false;

    const sourceNodeId = edge?.from ?? null;
    const targetNodeId = edge?.to ?? null;
    return Boolean(
      sourceNodeId &&
      (
        existingSegment.sourceNodeId === sourceNodeId ||
        existingSegment.targetNodeId === sourceNodeId ||
        existingSegment.sourceNodeId === targetNodeId ||
        existingSegment.targetNodeId === targetNodeId
      ),
    );
  };

  const findRouteConflict = ({
    edge,
    points,
    targetBox = null,
    targetNodeId = null,
    ignoreNodeIds = new Set(),
    allowEdgeCrossings = false,
  }) => {
    if (isFiniteBox(targetBox)) {
      const overlappingNode = nodeBoxes.find((nodeBox) => (
        nodeBox.nodeId !== targetNodeId &&
        !ignoreNodeIds.has(nodeBox.nodeId) &&
        boundsOverlap(targetBox, nodeBox.box, 0)
      ));
      if (overlappingNode) {
        return {
          conflictKind: "node-vs-node",
          reason: "candidateNodeBoxOverlapsCommittedNodeBox",
          crossingPair: {
            candidateNodeId: targetNodeId,
            existingNodeId: overlappingNode.nodeId,
            existingBox: overlappingNode.box,
          },
        };
      }
      const crossingEdge = edgeSegments.find((segment) => {
        if (segment.edgeId === edge?.id) return false;
        if (segment.sourceNodeId === edge?.from || segment.targetNodeId === edge?.from) return false;
        if (segment.sourceNodeId === targetNodeId || segment.targetNodeId === targetNodeId) return false;
        return segmentIntersectsBox(
          segment.start,
          segment.end,
          inflateBox(targetBox, SKETCH_EDGE_NODE_LANE_MARGIN),
        );
      });
      if (crossingEdge) {
          return {
            conflictKind: "node-vs-edge",
            reason: "candidateNodeBoxCrossesCommittedEdgeSegment",
            crossingPair: {
              candidateNodeId: targetNodeId,
              existingEdgeId: crossingEdge.edgeId,
              existingSegmentIndex: crossingEdge.segmentIndex,
              existingRole: crossingEdge.role,
              existingSegmentStart: crossingEdge.start,
              existingSegmentEnd: crossingEdge.end,
            },
          };
        }
    }

    const ignoredNodeIds = new Set([
      edge?.from,
      edge?.to,
      targetNodeId,
      ...ignoreNodeIds,
    ].filter(Boolean));
    const segments = routeSegments(points);

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const crossedNode = nodeBoxes.find((nodeBox) => (
        !ignoredNodeIds.has(nodeBox.nodeId) &&
        segmentIntersectsBox(
          segment.start,
          segment.end,
          inflateBox(nodeBox.box, SKETCH_EDGE_NODE_LANE_MARGIN),
        )
      ));
      if (crossedNode) {
        return {
          conflictKind: "edge-vs-node",
          reason: "candidateEdgeCrossesCommittedNodeBox",
          crossingPair: {
            candidateEdgeId: edge?.id ?? null,
            candidateSegmentIndex: segmentIndex,
            existingNodeId: crossedNode.nodeId,
            existingBox: crossedNode.box,
          },
        };
      }

      const edgeConflict = edgeSegments.reduce((found, existingSegment) => {
        if (found) return found;
        if (existingSegment.edgeId === edge?.id) return false;
        const laneConflict = segmentLaneConflict(segment, existingSegment, SKETCH_EDGE_LANE_MARGIN);
        if (laneConflict) {
          if (
            isLegalEndpointContact(segment, existingSegment, edge) &&
            isLocalEndpointLaneContact(laneConflict, segment, existingSegment)
          ) {
            return false;
          }
          return {
            existingSegment,
            laneConflict,
          };
        }
        if (allowEdgeCrossings) return false;
          if (!segmentsIntersect(
            segment.start,
            segment.end,
            existingSegment.start,
            existingSegment.end,
          )) {
            return false;
          }
          if (isLegalEndpointContact(segment, existingSegment, edge)) return false;
          return {
            existingSegment,
            laneConflict: null,
          };
      }, null);
      if (edgeConflict) {
        const crossedEdge = edgeConflict.existingSegment;
        return {
          conflictKind: edgeConflict.laneConflict?.conflictKind ?? "edge-vs-edge",
          reason: edgeConflict.laneConflict?.reason ?? "candidateEdgeCrossesCommittedEdgeSegment",
          crossingPair: {
            candidateEdgeId: edge?.id ?? null,
            candidateSegmentIndex: segmentIndex,
            existingEdgeId: crossedEdge.edgeId,
            existingSegmentIndex: crossedEdge.segmentIndex,
            existingRole: crossedEdge.role,
            existingSegmentStart: crossedEdge.start,
            existingSegmentEnd: crossedEdge.end,
            overlapLength: edgeConflict.laneConflict?.overlapLength ?? null,
            laneDistance: edgeConflict.laneConflict?.distance ?? null,
          },
        };
      }
    }

    return null;
  };

  return {
    nodeBoxes,
    edgeSegments,
    ledgerRows,
    candidateRows,
    rejectionRows,
    committedEdgeRows,
    backwardRoutingRows,
    haltRoutingRows,
    addNodeBox,
    addEdgeRoute,
    recordCandidate,
    markCandidateAccepted,
    recordRejection,
    findRouteConflict,
  };
}

function createSharedHaltLayout(layoutPlan) {
  const haltNode = {
    id: "halt",
    kind: "halt",
    label: "HALT",
    x: 0,
    y: 0,
  };
  const nonHaltNodes = layoutPlan.nodes.filter((node) => node.kind !== "halt");

  return {
    nodes: [...nonHaltNodes, haltNode],
    haltNode,
  };
}

function buildSketchOwnership(analysis, ownerByNodeId, instructionNodeLookup, edges) {
  const instructionCount = analysis.program.length;
  const incomingByTarget = new Map();

  analysis.edges.forEach((edge) => {
    if (isInstructionTarget(edge.targetIndex, instructionCount)) {
      appendMapList(incomingByTarget, edge.targetIndex, edge);
    }
  });

  return new Map(edges.map((edge) => {
    const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
    const targetNode = instructionNodeLookup.get(edge.targetIndex);
    const isExit = edge.to === "halt" || !isInstructionTarget(edge.targetIndex, instructionCount);
    const isReturn = isBackwardEdge(edge);

    return [
      edge.id,
      {
        branchOwnership: edge.branch ? ownerByNodeId.get(sourceNode?.id) ?? null : null,
        mergeOwnership:
          (incomingByTarget.get(edge.targetIndex)?.length ?? 0) > 1
            ? ownerByNodeId.get(targetNode?.id) ?? null
            : null,
        exitOwnership: isExit ? ownerByNodeId.get(sourceNode?.id) ?? null : null,
        loopReturnOwnership: isReturn ? ownerByNodeId.get(targetNode?.id) ?? null : null,
        splitPortAttachmentHint: edge.branch === "yes"
          ? "right"
          : edge.branch === "no"
            ? "left"
            : null,
      },
    ];
  }));
}

function runAdditiveNoFirstDfsPlacement({
  layoutPlan,
  getNodeSize,
}) {
  const analysis = layoutPlan.analysis;
  const layout = layoutPlan.layout;
  const instructionCount = analysis.program.length;
  const instructionNodes = getInstructionNodes(layoutPlan);
  const instructionNodeLookup = buildInstructionNodeLookup(instructionNodes);
  const { outgoingBySource } = buildOutgoingMaps(analysis);
  const params = buildSketchParameters(layout);
  const placedByNodeId = new Map();
  const ownerByNodeId = new Map();
  const expandedNodeIds = new Set();
  const pendingYesStack = [];
  const pendingBackwardEdges = [];
  const dfsVisitRows = [];
  const pendingYesStackRows = [];
  const branchStopRows = [];
  const placementRows = [];
  const haltExitRows = [];
  const backwardEdgeRows = [];
  const spacingAdjustmentRows = [];
  const edgeIntentRows = [];
  const loopCorridorRows = [];
  const haltCorridorRows = [];
  const traversalEvents = [];
  const frames = [];
  const ledger = createSketchOccupancyLedger({ getFrames: () => frames });
  const drawnLedger = createDrawnGeometryLedger();
  const edgeRouteByEdgeId = new Map();
  let frameSerial = 0;

  const createFrame = (options) => {
    const parent = options.parentId
      ? frames.find((candidate) => candidate.frameId === options.parentId)
      : null;
    const frame = makeFrameRecord({
      splitDepth: parent ? parent.splitDepth + 1 : 0,
      frameId: `sketch-frame-${frameSerial}`,
      ...options,
      branchPath: options.branchPath ?? (
        parent && options.side && options.side !== "disconnected"
          ? [...parent.branchPath, options.side]
          : parent?.branchPath ?? []
      ),
    });
    frameSerial += 1;
    frames.push(frame);
    if (frame.parentId) {
      parent?.childFrameIds.push(frame.frameId);
    }
    return frame;
  };

  const rootFrame = createFrame({
    kind: "root",
    startInstructionIndex: 0,
    splitDepth: 0,
    branchPath: [],
  });

  const emitTraversal = (eventType, edge = null, extra = {}) => {
    traversalEvents.push({
      order: traversalEvents.length,
      eventType,
      edgeId: edge?.id ?? null,
      sourceIndex: Number.isInteger(edge?.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge?.targetIndex) ? edge.targetIndex : null,
      branch: edge?.branch ?? null,
      ...extra,
    });
  };

  const recordStop = (branchId, edge, reason, extra = {}) => {
    branchStopRows.push({
      order: branchStopRows.length,
      branchId,
      edgeId: edge?.id ?? null,
      sourceIndex: Number.isInteger(edge?.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge?.targetIndex) ? edge.targetIndex : null,
      branch: edge?.branch ?? null,
      reason,
      ...extra,
    });
    emitTraversal(reason, edge, { branchId });
  };

  const getPlacementByInstructionIndex = (instructionIndex) => {
    const node = instructionNodeLookup.get(instructionIndex);
    return node ? placedByNodeId.get(node.id) ?? null : null;
  };

  const getEdgeRole = (edge, alreadyDrawnTarget = false) => {
    if (!edge) return "nodeOnly";
    if (edge.to === "halt" || !isInstructionTarget(edge.targetIndex, instructionCount)) {
      return "halt";
    }
    if (isBackwardEdge(edge)) return "backwardLoop";
    if (alreadyDrawnTarget) return "alreadyDrawnTarget";
    if (
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex
    ) {
      return "ordinaryForward";
    }
    return "edge";
  };

  const getSplitDistance = (splitDepth) => Math.max(
    Math.max(layout.branchForkDx * 1.15, 64),
    params.splitStepX * (0.78 ** Math.max(0, splitDepth)),
  );

  const getRouteRole = (edge, alreadyDrawnTarget = false) => {
    const edgeRole = getEdgeRole(edge, alreadyDrawnTarget);
    if (edgeRole === "halt") return "HALT exit";
    if (edgeRole === "backwardLoop") return "backward jump";
    if (edgeRole === "alreadyDrawnTarget") return "already-drawn target";
    if (edge?.branch) return "ordinary split";
    if (edgeRole === "ordinaryForward") return "continuation";
    return edgeRole;
  };

  const makeDirectRouteForPlacement = ({
    edge,
    sourcePlacement,
    targetNode,
    targetPosition,
  }) => {
    if (!edge || !sourcePlacement) return null;
    const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
    if (!sourceNode || !targetNode) return null;

    const fromBounds = boundsFromNodeAt(sourceNode, sourcePlacement, getNodeSize, layout);
    const toBounds = boundsFromNodeAt(targetNode, targetPosition, getNodeSize, layout);

    if (sourceNode.kind === "conditionalJump" && edge.branch) {
      const anchors = getDiamondAnchors(fromBounds);
      const start = edge.branch === "no"
        ? anchors.lowerLeftSideCenter
        : anchors.lowerRightSideCenter;
      const end = getTopPort(toBounds);
      return makeSketchEdgeRoute({
        edge,
        routeKind: edge.branch === "no"
          ? "sketchNoSplitDiagonal"
          : "sketchYesSplitDiagonal",
        points: [start, end],
        labelPoint: interpolatePoint(start, end, 0.42),
      });
    }

    const start = getBottomPort(fromBounds);
    const end = getTopPort(toBounds);
    return makeSketchEdgeRoute({
      edge,
      routeKind: "sketchContinuation",
      points: [start, end],
    });
  };

  const makeRouteToExistingTarget = ({ edge, sourcePlacement, targetPlacement }) => {
    const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
    const targetNode = targetPlacement?.node;
    if (!sourceNode || !targetNode || !sourcePlacement || !targetPlacement) return null;

    const fromBounds = boundsFromNodeAt(sourceNode, sourcePlacement, getNodeSize, layout);
    const toBounds = boundsFromNodeAt(targetNode, targetPlacement, getNodeSize, layout);
    const dx = targetPlacement.x - sourcePlacement.x;
    const dy = targetPlacement.y - sourcePlacement.y;
    let start = getBottomPort(fromBounds);
    let end = getTopPort(toBounds);
    if (Math.abs(dx) > Math.abs(dy) * 0.65) {
      start = dx < 0 ? getLeftPort(fromBounds) : getRightPort(fromBounds);
      end = dx < 0 ? getRightPort(toBounds) : getLeftPort(toBounds);
    } else if (dy < 0) {
      start = getTopPort(fromBounds);
      end = getBottomPort(toBounds);
    }

    const directPoints = [start, end];
    if (!drawnLedger.findRouteConflict({
      edge,
      points: directPoints,
      ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
    })) {
      return makeSketchEdgeRoute({
        edge,
        routeKind: "sketchAlreadyDrawnTarget",
        points: directPoints,
      });
    }

    const joint = Math.abs(dx) > Math.abs(dy)
      ? [end[0], start[1]]
      : [start[0], end[1]];
    return makeSketchEdgeRoute({
      edge,
      routeKind: "sketchAlreadyDrawnTargetOneTurn",
      points: [start, joint, end],
    });
  };

  const buildPlacementCandidate = ({
    node,
    position,
    frame,
    edge,
    placementKind,
  }) => {
    const nodeBounds = getNodeBoundsAt(node, position, getNodeSize, layout);
    const sourcePlacement = Number.isInteger(edge?.sourceIndex)
      ? getPlacementByInstructionIndex(edge.sourceIndex)
      : null;
    const route = edge && sourcePlacement
      ? makeDirectRouteForPlacement({
          edge,
          sourcePlacement,
          targetNode: node,
          targetPosition: position,
        })
      : null;
    return {
      nodeBounds,
      route,
      placementKind,
      splitDepth: frame.splitDepth,
      branchPath: frame.branchPath,
    };
  };

  const recordAlreadyDrawnEdgeLane = ({ edge, targetPlacement, frame }) => {
    const sourcePlacement = getPlacementByInstructionIndex(edge.sourceIndex);
    if (!sourcePlacement || !targetPlacement) return;
    const route = makeRouteToExistingTarget({
      edge,
      sourcePlacement,
      targetPlacement,
    });
    if (!route || !areFinitePoints(route.points)) return;
    edgeRouteByEdgeId.set(edge.id, route);
    drawnLedger.addEdgeRoute({
      edge,
      points: route.points,
      role: getRouteRole(edge, true),
      branchId: frame.frameId,
      splitDepth: frame.splitDepth,
      localBranchDepth: frame.splitDepth,
      branchPath: frame.branchPath,
    });
  };

  const placeNode = ({
    node,
    instructionIndex,
    candidate,
    frame,
    edge = null,
    placementKind,
    direction = 0,
  }) => {
    const alreadyPlaced = placedByNodeId.get(node.id) ?? null;
    if (alreadyPlaced) {
      placementRows.push({
        order: placementRows.length,
        nodeId: node.id,
        instructionIndex,
        edgeId: edge?.id ?? null,
        branchId: frame.frameId,
        placementKind,
        newlyPlaced: false,
        alreadyDrawn: true,
        x: alreadyPlaced.x,
        y: alreadyPlaced.y,
      });
      return { placed: false, placement: alreadyPlaced };
    }

    let position = { ...candidate };
    const initial = { ...position };
    let adjustmentCount = 0;
    let committedCandidate = null;
    let lastRejectedConflict = null;
    edgeIntentRows.push({
      order: edgeIntentRows.length,
      edgeId: edge?.id ?? null,
      sourceIndex: Number.isInteger(edge?.sourceIndex) ? edge.sourceIndex : null,
      targetIndex: Number.isInteger(edge?.targetIndex) ? edge.targetIndex : null,
      branch: edge?.branch ?? null,
      placementKind,
      intendedSide: direction < 0 ? "left" : direction > 0 ? "right" : "down",
      initialCandidate: initial,
      splitDepth: frame.splitDepth,
      chosenSplitDistance: edge?.branch ? getSplitDistance(frame.splitDepth) : null,
      branchPath: frame.branchPath,
    });

    const sourcePlacement = Number.isInteger(edge?.sourceIndex)
      ? getPlacementByInstructionIndex(edge.sourceIndex)
      : null;
    const ordinaryForwardSplit = Boolean(
      edge?.branch &&
      direction !== 0 &&
      sourcePlacement &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex &&
      edge.to !== "halt",
    );
    const defaultSplitDistance = edge?.branch ? getSplitDistance(frame.splitDepth) : null;
    const candidatePositions = [];
    const pushCandidatePosition = ({
      nextPosition,
      adjustmentKind,
      candidateFamily,
      lengthScale = null,
      oneTurn = false,
    }) => {
      candidatePositions.push({
        position: nextPosition,
        adjustmentKind,
        candidateFamily,
        lengthScale,
        oneTurn,
      });
    };

    if (ordinaryForwardSplit) {
      const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
      const sourceBounds = sourceNode
        ? boundsFromNodeAt(sourceNode, sourcePlacement, getNodeSize, layout)
        : null;
      const sourceAnchors = sourceBounds ? getDiamondAnchors(sourceBounds) : null;
      const exitStart = edge.branch === "no"
        ? sourceAnchors?.lowerLeftSideCenter
        : sourceAnchors?.lowerRightSideCenter;
      const targetSize = getNodeSize(node, layout);
      const exitDirection = edge.branch === "no" ? -1 : 1;
      const angleTangent = getDiamondExitAngleTangent(layout);
      const defaultRouteDx = Math.abs(defaultSplitDistance ?? (initial.x - sourcePlacement.x));
      const makeSameAnglePosition = (routeDx) => {
        const outwardDx = Math.max(Math.abs(routeDx), layout.branchForkDx * 1.15, 64);
        const routeDy = outwardDx * angleTangent;
        return {
          x: exitStart[0] + exitDirection * outwardDx,
          y: exitStart[1] + routeDy + targetSize.height / 2,
        };
      };
      const pushScaledSplit = (scale, candidateFamily) => {
        const outwardDx = defaultRouteDx * scale;
        pushCandidatePosition({
          nextPosition: makeSameAnglePosition(outwardDx),
          adjustmentKind: candidateFamily,
          candidateFamily,
          lengthScale: scale,
        });
      };
      const pushLowerSameAngleSplit = (scale, lowerIndex) => {
        const baseRouteDx = defaultRouteDx * scale;
        const baseRouteDy = baseRouteDx * angleTangent;
        const nextRouteDy = baseRouteDy + params.downwardShiftStep * lowerIndex;
        const sameAngleDx = nextRouteDy / angleTangent;
        pushCandidatePosition({
          nextPosition: makeSameAnglePosition(sameAngleDx),
          adjustmentKind: "lower",
          candidateFamily: "lower",
          lengthScale: defaultRouteDx === 0 ? scale : sameAngleDx / defaultRouteDx,
        });
      };

      if (isFinitePoint(exitStart)) {
        pushScaledSplit(1, "default");
        [0.85, 0.7, 0.55, 0.42].forEach((scale) => {
          pushScaledSplit(scale, "shorter");
        });
        [1.12, 1.28, 1.45, 1.65, 1.9, 2.2, 2.6, 3.1, 3.7, 4.4].forEach((scale) => {
          pushScaledSplit(scale, "longer");
        });
        [0.6, 0.85, 1, 1.2, 1.45, 1.75, 2.1, 2.6, 3.1, 3.7].forEach((scale) => {
          for (let lowerIndex = 1; lowerIndex <= 24; lowerIndex += 1) {
            pushLowerSameAngleSplit(scale, lowerIndex);
          }
        });
      }
    } else {
      pushCandidatePosition({
        nextPosition: initial,
        adjustmentKind: "default",
        candidateFamily: "default",
        lengthScale: 1,
      });
    }

    if (direction !== 0 && !ordinaryForwardSplit) {
      for (let index = 1; index <= 28; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: initial.x + direction * params.outwardShiftStep * index,
          y: initial.y,
          },
          adjustmentKind: "fartherOutward",
          candidateFamily: "longer",
          lengthScale: defaultSplitDistance
            ? (defaultSplitDistance + params.outwardShiftStep * index) / defaultSplitDistance
            : null,
        });
      }
      for (let index = 1; index <= 28; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: initial.x,
          y: initial.y + params.downwardShiftStep * index,
          },
          adjustmentKind: "fartherDownward",
          candidateFamily: "lower",
          lengthScale: null,
        });
      }
      for (let index = 1; index <= 56; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: initial.x + direction * params.outwardShiftStep * index,
          y: initial.y + params.downwardShiftStep * Math.ceil(index / 2),
          },
          adjustmentKind: "outwardAndDownward",
          candidateFamily: "longer",
          lengthScale: defaultSplitDistance
            ? (defaultSplitDistance + params.outwardShiftStep * index) / defaultSplitDistance
            : null,
        });
      }
      const visibleBounds = drawnLedger.nodeBoxes.length > 0
        ? unionBounds(drawnLedger.nodeBoxes.map((row) => row.box))
        : getNodeBoundsAt(node, initial, getNodeSize, layout);
      for (let index = 0; index <= 20; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: direction > 0
            ? visibleBounds.right + layout.loopLaneDistance + params.outwardShiftStep * index
            : visibleBounds.left - layout.loopLaneDistance - params.outwardShiftStep * index,
          y: initial.y + params.downwardShiftStep * Math.ceil(index / 2),
          },
          adjustmentKind: "outsideCommittedVisibleBounds",
          candidateFamily: "longer",
          lengthScale: null,
        });
      }
      for (let index = 0; index <= 20; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: direction > 0
            ? visibleBounds.right + layout.loopLaneDistance + params.outwardShiftStep * index
            : visibleBounds.left - layout.loopLaneDistance - params.outwardShiftStep * index,
          y: visibleBounds.bottom + params.ordinaryStepY + params.downwardShiftStep * index,
          },
          adjustmentKind: "outsideAndBelowCommittedVisibleBounds",
          candidateFamily: "lower",
          lengthScale: null,
        });
      }
    } else if (direction === 0) {
      for (let index = 1; index <= 80; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: initial.x,
          y: initial.y + params.downwardShiftStep * index,
          },
          adjustmentKind: "fartherDownward",
          candidateFamily: "lower",
          lengthScale: null,
        });
      }
      for (let index = 1; index <= 28; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: initial.x + params.outwardShiftStep * index,
          y: initial.y + params.downwardShiftStep * Math.ceil(index / 2),
          },
          adjustmentKind: "rightAndDownward",
          candidateFamily: "lower",
          lengthScale: null,
        });
        pushCandidatePosition({
          nextPosition: {
          x: initial.x - params.outwardShiftStep * index,
          y: initial.y + params.downwardShiftStep * Math.ceil(index / 2),
          },
          adjustmentKind: "leftAndDownward",
          candidateFamily: "lower",
          lengthScale: null,
        });
      }
      const visibleBounds = drawnLedger.nodeBoxes.length > 0
        ? unionBounds(drawnLedger.nodeBoxes.map((row) => row.box))
        : getNodeBoundsAt(node, initial, getNodeSize, layout);
      for (let index = 0; index <= 20; index += 1) {
        pushCandidatePosition({
          nextPosition: {
          x: visibleBounds.right + layout.loopLaneDistance + params.outwardShiftStep * index,
          y: visibleBounds.bottom + params.ordinaryStepY + params.downwardShiftStep * index,
          },
          adjustmentKind: "rightOutsideAndBelowCommittedVisibleBounds",
          candidateFamily: "lower",
          lengthScale: null,
        });
        pushCandidatePosition({
          nextPosition: {
          x: visibleBounds.left - layout.loopLaneDistance - params.outwardShiftStep * index,
          y: visibleBounds.bottom + params.ordinaryStepY + params.downwardShiftStep * index,
          },
          adjustmentKind: "leftOutsideAndBelowCommittedVisibleBounds",
          candidateFamily: "lower",
          lengthScale: null,
        });
      }
    }

    for (let index = 0; index < candidatePositions.length; index += 1) {
      const candidateEntry = candidatePositions[index];
      position = candidateEntry.position;
      let candidateGeometry = buildPlacementCandidate({
        node,
        position,
        frame,
        edge,
        placementKind,
      });
      if (candidateEntry.oneTurn && candidateGeometry.route) {
        const points = candidateGeometry.route.points;
        candidateGeometry = {
          ...candidateGeometry,
          route: {
            ...candidateGeometry.route,
            routeKind: `${candidateGeometry.route.routeKind}OneTurn`,
            points: [points[0], [points[points.length - 1][0], points[0][1]], points[points.length - 1]],
          },
        };
      }
      const candidateId = drawnLedger.recordCandidate({
        nodeId: node.id,
        instructionIndex,
        edgeId: edge?.id ?? null,
        branchId: frame.frameId,
        placementKind,
        adjustmentKind: candidateEntry.adjustmentKind,
        candidateFamily: candidateEntry.candidateFamily,
        lengthScale: candidateEntry.lengthScale,
        splitDepth: frame.splitDepth,
        chosenSplitDistance: edge?.branch ? getSplitDistance(frame.splitDepth) : null,
        branchPath: frame.branchPath,
        position,
        nodeBox: candidateGeometry.nodeBounds,
        points: candidateGeometry.route?.points ?? null,
      });
      const conflict = drawnLedger.findRouteConflict({
        edge,
        points: candidateGeometry.route?.points ?? [],
        targetBox: candidateGeometry.nodeBounds,
        targetNodeId: node.id,
        ignoreNodeIds: new Set([instructionNodeLookup.get(edge?.sourceIndex)?.id].filter(Boolean)),
      });
      if (!conflict) {
        drawnLedger.markCandidateAccepted(candidateId, {
          acceptedCandidateFamily: candidateEntry.candidateFamily,
          acceptedLengthScale: candidateEntry.lengthScale,
        });
        committedCandidate = {
          ...candidateGeometry,
          candidateId,
          adjustmentKind: candidateEntry.adjustmentKind,
          candidateFamily: candidateEntry.candidateFamily,
          lengthScale: candidateEntry.lengthScale,
          position,
        };
        break;
      }
      lastRejectedConflict = conflict;
      drawnLedger.recordRejection({
        candidateId,
        nodeId: node.id,
        edgeId: edge?.id ?? null,
        branchId: frame.frameId,
        placementKind,
        conflictKind: conflict.conflictKind,
        reason: conflict.reason,
        crossingPair: conflict.crossingPair,
        candidateFamily: candidateEntry.candidateFamily,
        lengthScale: candidateEntry.lengthScale,
        nextAdjustmentKind: candidatePositions[index + 1]?.adjustmentKind ?? (
          edge && !ordinaryForwardSplit ? "oneTurnRoute" : "noFurtherCandidate"
        ),
        nextCandidateFamily: candidatePositions[index + 1]?.candidateFamily ?? (
          edge && !ordinaryForwardSplit ? "one-turn" : "none"
        ),
      });
    }

    if (!committedCandidate && edge && !ordinaryForwardSplit) {
      const oneTurnKinds = ["horizontalThenVertical", "verticalThenHorizontal"];
      for (let index = 0; index < candidatePositions.length; index += 1) {
        const candidateEntry = candidatePositions[index];
        position = candidateEntry.position;
        const directGeometry = buildPlacementCandidate({
          node,
          position,
          frame,
          edge,
          placementKind,
        });
        const points = directGeometry.route?.points ?? null;
        if (!areFinitePoints(points)) continue;
        const start = points[0];
        const end = points[points.length - 1];

        for (let turnIndex = 0; turnIndex < oneTurnKinds.length; turnIndex += 1) {
          const oneTurnKind = oneTurnKinds[turnIndex];
          const joint = oneTurnKind === "horizontalThenVertical"
            ? [end[0], start[1]]
            : [start[0], end[1]];
          const oneTurnGeometry = {
            ...directGeometry,
            route: {
              ...directGeometry.route,
              routeKind: `${directGeometry.route.routeKind}OneTurn`,
              points: [start, joint, end],
            },
          };
          const candidateId = drawnLedger.recordCandidate({
            nodeId: node.id,
            instructionIndex,
            edgeId: edge.id,
            branchId: frame.frameId,
            placementKind,
            adjustmentKind: `oneTurnRoute:${oneTurnKind}`,
            candidateFamily: "one-turn",
            lengthScale: candidateEntry.lengthScale,
            splitDepth: frame.splitDepth,
            chosenSplitDistance: getSplitDistance(frame.splitDepth),
            branchPath: frame.branchPath,
            position,
            nodeBox: oneTurnGeometry.nodeBounds,
            points: oneTurnGeometry.route.points,
          });
          const conflict = drawnLedger.findRouteConflict({
            edge,
            points: oneTurnGeometry.route.points,
            targetBox: oneTurnGeometry.nodeBounds,
            targetNodeId: node.id,
            ignoreNodeIds: new Set([instructionNodeLookup.get(edge.sourceIndex)?.id].filter(Boolean)),
          });
          if (!conflict) {
            drawnLedger.markCandidateAccepted(candidateId, {
              acceptedCandidateFamily: "one-turn",
              acceptedLengthScale: candidateEntry.lengthScale,
            });
            committedCandidate = {
              ...oneTurnGeometry,
              candidateId,
              adjustmentKind: `oneTurnRoute:${oneTurnKind}`,
              candidateFamily: "one-turn",
              lengthScale: candidateEntry.lengthScale,
              position,
            };
            break;
          }
          lastRejectedConflict = conflict;
          drawnLedger.recordRejection({
            candidateId,
            nodeId: node.id,
            edgeId: edge.id,
            branchId: frame.frameId,
            placementKind,
            conflictKind: conflict.conflictKind,
            reason: conflict.reason,
            crossingPair: conflict.crossingPair,
            candidateFamily: "one-turn",
            lengthScale: candidateEntry.lengthScale,
            nextAdjustmentKind: turnIndex + 1 < oneTurnKinds.length
              ? `oneTurnRoute:${oneTurnKinds[turnIndex + 1]}`
              : (candidatePositions[index + 1] ? "oneTurnRoute" : "noFurtherCandidate"),
            nextCandidateFamily: turnIndex + 1 < oneTurnKinds.length
              ? "one-turn"
              : (candidatePositions[index + 1]?.candidateFamily ?? "none"),
          });
        }

        if (committedCandidate) break;
      }
    }

    if (!committedCandidate) {
      const error = new Error(`sketchV1NoLegalCandidate:${node.id}:${lastRejectedConflict?.conflictKind ?? "unknown"}:${lastRejectedConflict?.reason ?? "unknown"}:${lastRejectedConflict?.crossingPair?.existingEdgeId ?? lastRejectedConflict?.crossingPair?.existingNodeId ?? "unknown"}`);
      error.sketchV1FallbackDiagnostics = {
        kind: "sketchV1PlacementCandidateFailure",
        nodeId: node.id,
        instructionIndex,
        edgeId: edge?.id ?? null,
        branchId: frame.frameId,
        placementKind,
        splitDepth: frame.splitDepth,
        branchPath: frame.branchPath,
        ordinaryForwardSplit,
        lastRejectedConflict,
        candidateRows: drawnLedger.candidateRows.filter((row) => row.nodeId === node.id && row.edgeId === (edge?.id ?? null)),
        rejectionRows: drawnLedger.rejectionRows.filter((row) => row.nodeId === node.id && row.edgeId === (edge?.id ?? null)),
        committedEdgeRows: drawnLedger.committedEdgeRows,
        nodeBoxes: drawnLedger.nodeBoxes,
      };
      throw error;
    } else {
      position = committedCandidate.position;
    }

    adjustmentCount = (
      position.x === initial.x &&
      position.y === initial.y &&
      committedCandidate.adjustmentKind === "default"
    ) ? 0 : 1;

    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      position = {
        x: Number.isFinite(initial.x) ? initial.x : 0,
        y: Number.isFinite(initial.y) ? initial.y : 0,
      };
      spacingAdjustmentRows.push({
        order: spacingAdjustmentRows.length,
        nodeId: node.id,
        instructionIndex,
        branchId: frame.frameId,
        edgeId: edge?.id ?? null,
        placementKind,
        preservesTopology: true,
        adjustmentCount: 1,
        from: initial,
        to: position,
        direction: "finiteCoordinateGuard",
      });
      committedCandidate = buildPlacementCandidate({
        node,
        position,
        frame,
        edge,
        placementKind,
      });
    }

    if (adjustmentCount > 0) {
      spacingAdjustmentRows.push({
        order: spacingAdjustmentRows.length,
        nodeId: node.id,
        instructionIndex,
        branchId: frame.frameId,
        edgeId: edge?.id ?? null,
        placementKind,
        preservesTopology: true,
        adjustmentCount,
        from: initial,
        to: position,
        direction: committedCandidate.adjustmentKind ?? (
          direction < 0 ? "left" : direction > 0 ? "right" : "down"
        ),
      });
    }

    node.x = position.x;
    node.y = position.y;
    node.sketchV1FrameId = frame.frameId;
    frame.ownedNodeIds.push(node.id);
    ownerByNodeId.set(node.id, frame.frameId);
    const placement = {
      nodeId: node.id,
      node,
      instructionIndex,
      branchId: frame.frameId,
      x: position.x,
      y: position.y,
    };
    placedByNodeId.set(node.id, placement);
    drawnLedger.addNodeBox({
      nodeId: node.id,
      instructionIndex,
      box: committedCandidate.nodeBounds,
      branchId: frame.frameId,
      splitDepth: frame.splitDepth,
      branchPath: frame.branchPath,
    });
    if (edge && committedCandidate.route) {
      edgeRouteByEdgeId.set(edge.id, committedCandidate.route);
      drawnLedger.addEdgeRoute({
        edge,
        points: committedCandidate.route.points,
        role: getRouteRole(edge),
        branchId: frame.frameId,
        splitDepth: frame.splitDepth,
        localBranchDepth: frame.splitDepth,
        branchPath: frame.branchPath,
      });
    }
    placementRows.push({
      order: placementRows.length,
      nodeId: node.id,
      instructionIndex,
      edgeId: edge?.id ?? null,
      branchId: frame.frameId,
      placementKind,
      newlyPlaced: true,
      alreadyDrawn: false,
      x: position.x,
      y: position.y,
      splitDepth: frame.splitDepth,
      chosenSplitDistance: edge?.branch ? getSplitDistance(frame.splitDepth) : null,
      candidateAdjustmentKind: committedCandidate.adjustmentKind ?? null,
      acceptedCandidateFamily: committedCandidate.candidateFamily ?? null,
      acceptedLengthScale: committedCandidate.lengthScale ?? null,
    });
    return { placed: true, placement };
  };

  const reserveLoopCorridor = (edge, frame) => {
    const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
    const targetNode = instructionNodeLookup.get(edge.targetIndex);
    const sourcePlacement = getPlacementByInstructionIndex(edge.sourceIndex);
    const targetPlacement = getPlacementByInstructionIndex(edge.targetIndex);
    if (!sourceNode || !targetNode || !sourcePlacement || !targetPlacement) return null;

    const sourceBounds = boundsFromNodeAt(sourceNode, sourcePlacement, getNodeSize, layout);
    const targetBounds = boundsFromNodeAt(targetNode, targetPlacement, getNodeSize, layout);
    const loopPlacements = [];
    for (let index = edge.targetIndex; index <= edge.sourceIndex; index += 1) {
      const placement = getPlacementByInstructionIndex(index);
      if (placement) {
        loopPlacements.push(getNodeBoundsAt(
          placement.node,
          placement,
          getNodeSize,
          layout,
        ));
      }
    }
    const loopBounds = loopPlacements.length > 0
      ? unionBounds(loopPlacements)
      : unionBounds([sourceBounds, targetBounds]);
    const ancestrySideCounts = frame.branchPath.reduce((counts, side) => ({
      ...counts,
      [side]: (counts[side] ?? 0) + 1,
    }), { left: 0, right: 0 });
    let preferredSide = null;
    let preferredSideReason = "sourceTargetDxFallback";
    if (ancestrySideCounts.left !== ancestrySideCounts.right) {
      preferredSide = ancestrySideCounts.left > ancestrySideCounts.right ? "left" : "right";
      preferredSideReason = "branchAncestryMajority";
    } else if (frame.side === "left" || frame.side === "right") {
      preferredSide = frame.side;
      preferredSideReason = "frameSide";
    } else {
      preferredSide = targetPlacement.x < sourcePlacement.x ? "left" : "right";
    }
    const sideCandidates = preferredSide === "right" ? ["right", "left"] : ["left", "right"];
    const visibleBounds = unionBounds([
      ...drawnLedger.nodeBoxes.map((row) => row.box),
      loopBounds,
    ]);
    let route = null;
    let committedSide = preferredSide;
    let committedLaneRank = 0;
    let committedLaneX = 0;
    let adjustmentCount = 0;
    let conflict = null;
    const obstacleMargin = Math.max(layout.sideRouteGap, 18);
    const maxDetourIterations = 96;
    const detourRows = [];
    const obstacleBoxFromEdgeSegment = (segment) => inflateBox({
      left: Math.min(segment.start[0], segment.end[0]),
      right: Math.max(segment.start[0], segment.end[0]),
      top: Math.min(segment.start[1], segment.end[1]),
      bottom: Math.max(segment.start[1], segment.end[1]),
    }, Math.max(4, layout.arrowStrokeWidth * 4));
    const segmentProgress = (segmentStart, segmentEnd, point) => {
      const dx = segmentEnd[0] - segmentStart[0];
      const dy = segmentEnd[1] - segmentStart[1];
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq <= 0.001) return 0;
      return Math.max(0, Math.min(1, ((point[0] - segmentStart[0]) * dx + (point[1] - segmentStart[1]) * dy) / lengthSq));
    };
    const findFirstRouteBlocker = (points) => {
      const segments = routeSegments(points);
      const ignoredNodeIds = new Set([sourceNode.id, targetNode.id]);
      let best = null;
      const consider = (entry) => {
        if (
          !best ||
          entry.segmentIndex < best.segmentIndex ||
          (
            entry.segmentIndex === best.segmentIndex &&
            entry.progress < best.progress
          )
        ) {
          best = entry;
        }
      };

      segments.forEach((segment, segmentIndex) => {
        drawnLedger.nodeBoxes.forEach((nodeBox) => {
          if (ignoredNodeIds.has(nodeBox.nodeId)) return;
          if (!segmentIntersectsBox(segment.start, segment.end, nodeBox.box)) return;
          const center = [
            (nodeBox.box.left + nodeBox.box.right) / 2,
            (nodeBox.box.top + nodeBox.box.bottom) / 2,
          ];
          consider({
            conflictKind: "edge-vs-node",
            reason: "candidateEdgeCrossesCommittedNodeBox",
            obstacleKind: "nodeBox",
            segmentIndex,
            progress: segmentProgress(segment.start, segment.end, center),
            box: nodeBox.box,
            crossingPair: {
              candidateEdgeId: edge.id,
              candidateSegmentIndex: segmentIndex,
              existingNodeId: nodeBox.nodeId,
              existingBox: nodeBox.box,
            },
          });
        });
        drawnLedger.edgeSegments.forEach((existingSegment) => {
          if (existingSegment.edgeId === edge.id) return;
          if (!segmentsIntersect(
            segment.start,
            segment.end,
            existingSegment.start,
            existingSegment.end,
          )) {
            return;
          }
          if (drawnLedger.findRouteConflict({
            edge,
            points: [segment.start, segment.end],
            ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
          })?.conflictKind !== "edge-vs-edge") {
            return;
          }
          const obstacleBox = obstacleBoxFromEdgeSegment(existingSegment);
          const center = [
            (obstacleBox.left + obstacleBox.right) / 2,
            (obstacleBox.top + obstacleBox.bottom) / 2,
          ];
          consider({
            conflictKind: "edge-vs-edge",
            reason: "candidateEdgeCrossesCommittedEdgeSegment",
            obstacleKind: "edgeSegment",
            segmentIndex,
            progress: segmentProgress(segment.start, segment.end, center),
            box: obstacleBox,
            crossingPair: {
              candidateEdgeId: edge.id,
              candidateSegmentIndex: segmentIndex,
              existingEdgeId: existingSegment.edgeId,
              existingSegmentIndex: existingSegment.segmentIndex,
              existingRole: existingSegment.role,
              existingSegmentStart: existingSegment.start,
              existingSegmentEnd: existingSegment.end,
            },
          });
        });
      });
      return best;
    };
    const compactRoutePoints = (points) => points.filter((point, index) => {
      if (index === 0) return true;
      return !pointsEqual(point, points[index - 1]);
    });
    const routeLength = (points) => routeSegments(points).reduce((sum, segment) => (
      sum + Math.abs(segment.end[0] - segment.start[0]) + Math.abs(segment.end[1] - segment.start[1])
    ), 0);
    const obstacleKey = (blocker) => [
      blocker?.obstacleKind ?? "unknown",
      blocker?.crossingPair?.existingNodeId ?? blocker?.crossingPair?.existingEdgeId ?? "unknown",
      blocker?.crossingPair?.existingSegmentIndex ?? "none",
    ].join(":");
    const sameBlocker = (left, right) => (
      Boolean(left && right) &&
      obstacleKey(left) === obstacleKey(right) &&
      left.segmentIndex === right.segmentIndex
    );
    const detourVariantsAroundObstacle = (points, blocker, side) => {
      const segmentStart = points[blocker.segmentIndex];
      const segmentEnd = points[blocker.segmentIndex + 1];
      const obstacleBox = inflateBox(blocker.box, obstacleMargin);
      const horizontal = Math.abs(segmentStart[1] - segmentEnd[1]) < 0.001;
      const vertical = Math.abs(segmentStart[0] - segmentEnd[0]) < 0.001;
      if (!horizontal && !vertical) return [];

      const makeRoute = (replacement) => compactRoutePoints([
        ...points.slice(0, blocker.segmentIndex),
        ...replacement,
        ...points.slice(blocker.segmentIndex + 2),
      ]);

      const variants = [];
      if (vertical) {
        const sideOrder = side === "right"
          ? [
            { detourSide: "right", detourX: obstacleBox.right },
            { detourSide: "left", detourX: obstacleBox.left },
          ]
          : [
            { detourSide: "left", detourX: obstacleBox.left },
            { detourSide: "right", detourX: obstacleBox.right },
          ];
        const movingDown = segmentEnd[1] >= segmentStart[1];
        const enterY = movingDown ? obstacleBox.top : obstacleBox.bottom;
        const exitY = movingDown ? obstacleBox.bottom : obstacleBox.top;
        sideOrder.forEach(({ detourSide, detourX }) => {
          variants.push({
            detourKind: `verticalAround:${detourSide}`,
            detourSide,
            detourBox: obstacleBox,
            points: makeRoute([
              segmentStart,
              [segmentStart[0], enterY],
              [detourX, enterY],
              [detourX, exitY],
              [segmentStart[0], exitY],
              segmentEnd,
            ]),
          });
        });
      } else if (horizontal) {
        const targetAbove = targetPlacement.y < sourcePlacement.y;
        const bandOrder = targetAbove
          ? [
            { detourBand: "top", detourY: obstacleBox.top },
            { detourBand: "bottom", detourY: obstacleBox.bottom },
          ]
          : [
            { detourBand: "bottom", detourY: obstacleBox.bottom },
            { detourBand: "top", detourY: obstacleBox.top },
          ];
        const movingRight = segmentEnd[0] >= segmentStart[0];
        const enterX = movingRight ? obstacleBox.left : obstacleBox.right;
        const exitX = movingRight ? obstacleBox.right : obstacleBox.left;
        bandOrder.forEach(({ detourBand, detourY }) => {
          variants.push({
            detourKind: `horizontalAround:${detourBand}`,
            detourBand,
            detourBox: obstacleBox,
            points: makeRoute([
              segmentStart,
              [enterX, segmentStart[1]],
              [enterX, detourY],
              [exitX, detourY],
              [exitX, segmentStart[1]],
              segmentEnd,
            ]),
          });
        });
      }

      return variants.filter((variant) => !(
        variant.points.length === points.length &&
        variant.points.every((point, index) => pointsEqual(point, points[index]))
      ));
    };
    const simplifyOrthogonalRoute = (points) => {
      const compacted = compactRoutePoints(points);
      return compacted.filter((point, index) => {
        if (index === 0 || index === compacted.length - 1) return true;
        const previous = compacted[index - 1];
        const next = compacted[index + 1];
        const sameX = Math.abs(previous[0] - point[0]) < 0.001 && Math.abs(point[0] - next[0]) < 0.001;
        const sameY = Math.abs(previous[1] - point[1]) < 0.001 && Math.abs(point[1] - next[1]) < 0.001;
        return !(sameX || sameY);
      });
    };
    const findVisibleObstacleGridRoute = ({
      start,
      end,
      side,
      laneX,
      allowEdgeCrossings = false,
    }) => {
      const coordScale = 1000;
      const xCoordMap = new Map();
      const yCoordMap = new Map();
      const addCoord = (map, value) => {
        if (!Number.isFinite(value)) return;
        const key = Math.round(value * coordScale);
        if (!map.has(key)) map.set(key, value);
      };
      const addBoxCoords = (box, margin) => {
        addCoord(xCoordMap, box.left - margin);
        addCoord(xCoordMap, box.right + margin);
        addCoord(yCoordMap, box.top - margin);
        addCoord(yCoordMap, box.bottom + margin);
      };

      [start[0], end[0], laneX].forEach((value) => addCoord(xCoordMap, value));
      [start[1], end[1]].forEach((value) => addCoord(yCoordMap, value));
      addCoord(xCoordMap, side === "right"
        ? visibleBounds.right + obstacleMargin
        : visibleBounds.left - obstacleMargin);
      addCoord(yCoordMap, visibleBounds.top - obstacleMargin);
      addCoord(yCoordMap, visibleBounds.bottom + obstacleMargin);
      drawnLedger.nodeBoxes.forEach((nodeBox) => {
        if (nodeBox.nodeId === sourceNode.id || nodeBox.nodeId === targetNode.id) return;
        addBoxCoords(nodeBox.box, obstacleMargin);
      });
      drawnLedger.edgeSegments.forEach((segment) => {
        if (segment.edgeId === edge.id) return;
        addBoxCoords(obstacleBoxFromEdgeSegment(segment), obstacleMargin);
      });

      const xCoords = Array.from(xCoordMap.values()).sort((left, right) => left - right);
      const yCoords = Array.from(yCoordMap.values()).sort((left, right) => left - right);
      const startXi = xCoords.findIndex((value) => Math.abs(value - start[0]) < 0.001);
      const startYi = yCoords.findIndex((value) => Math.abs(value - start[1]) < 0.001);
      const endXi = xCoords.findIndex((value) => Math.abs(value - end[0]) < 0.001);
      const endYi = yCoords.findIndex((value) => Math.abs(value - end[1]) < 0.001);
      if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null;

      const keyFor = (xi, yi) => `${xi},${yi}`;
      const pointFor = (key) => {
        const [xi, yi] = key.split(",").map((value) => Number.parseInt(value, 10));
        return [xCoords[xi], yCoords[yi]];
      };
      const startKey = keyFor(startXi, startYi);
      const endKey = keyFor(endXi, endYi);
      const heuristic = (xi, yi) => (
        Math.abs(xCoords[xi] - end[0]) + Math.abs(yCoords[yi] - end[1])
      );
      const segmentIsLegal = (fromPoint, toPoint) => !drawnLedger.findRouteConflict({
        edge,
        points: [fromPoint, toPoint],
        ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
        allowEdgeCrossings,
      });

      const open = [{ key: startKey, xi: startXi, yi: startYi, g: 0, f: heuristic(startXi, startYi) }];
      const bestScoreByKey = new Map([[startKey, 0]]);
      const previousByKey = new Map();
      const closed = new Set();
      const maxVisited = Math.max(800, xCoords.length * yCoords.length);
      let visited = 0;

      while (open.length > 0 && visited < maxVisited) {
        open.sort((left, right) => left.f - right.f);
        const current = open.shift();
        if (!current || closed.has(current.key)) continue;
        visited += 1;
        if (current.key === endKey) {
          const reversed = [];
          let cursor = endKey;
          while (cursor) {
            reversed.push(pointFor(cursor));
            cursor = previousByKey.get(cursor);
          }
          return {
            points: simplifyOrthogonalRoute(reversed.reverse()),
            visited,
            xCoordCount: xCoords.length,
            yCoordCount: yCoords.length,
          };
        }
        closed.add(current.key);

        [
          [current.xi - 1, current.yi],
          [current.xi + 1, current.yi],
          [current.xi, current.yi - 1],
          [current.xi, current.yi + 1],
        ].forEach(([nextXi, nextYi]) => {
          if (
            nextXi < 0 ||
            nextXi >= xCoords.length ||
            nextYi < 0 ||
            nextYi >= yCoords.length
          ) {
            return;
          }
          const nextKey = keyFor(nextXi, nextYi);
          if (closed.has(nextKey)) return;
          const fromPoint = [xCoords[current.xi], yCoords[current.yi]];
          const toPoint = [xCoords[nextXi], yCoords[nextYi]];
          if (!segmentIsLegal(fromPoint, toPoint)) return;
          const nextG = current.g + Math.abs(toPoint[0] - fromPoint[0]) + Math.abs(toPoint[1] - fromPoint[1]);
          if (nextG >= (bestScoreByKey.get(nextKey) ?? Infinity)) return;
          bestScoreByKey.set(nextKey, nextG);
          previousByKey.set(nextKey, current.key);
          open.push({
            key: nextKey,
            xi: nextXi,
            yi: nextYi,
            g: nextG,
            f: nextG + heuristic(nextXi, nextYi),
          });
        });
      }

      return {
        failed: true,
        visited,
        xCoordCount: xCoords.length,
        yCoordCount: yCoords.length,
      };
    };

    sideCandidates.some((side) => {
      const laneRank = loopCorridorRows.filter((row) => row.side === side).length;
      const start = side === "right" ? getRightPort(sourceBounds) : getLeftPort(sourceBounds);
      const end = side === "right" ? getRightPort(targetBounds) : getLeftPort(targetBounds);
      const localBounds = unionBounds([sourceBounds, targetBounds]);
      const localLaneGap = obstacleMargin + laneRank * Math.max(layout.sideRouteGap, 18);
      const laneX = side === "right"
        ? localBounds.right + localLaneGap
        : localBounds.left - localLaneGap;
      let points = compactRoutePoints([start, [laneX, start[1]], [laneX, end[1]], end]);
      const initialRoute = points;
      const seenRouteKeys = new Set();

      for (let iteration = 0; iteration <= maxDetourIterations; iteration += 1) {
        const routeKey = points.map((point) => point.map((value) => Math.round(value * 10) / 10).join(",")).join("|");
        if (seenRouteKeys.has(routeKey)) break;
        seenRouteKeys.add(routeKey);
        const candidateId = drawnLedger.recordCandidate({
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          adjustmentKind: iteration === 0 ? "initialLocalRoute" : "incrementalObstacleDetour",
          routeShape: iteration === 0 ? "local" : "incrementalVisibleObstacleDetour",
          side,
          preferredSide,
          preferredSideReason,
          sideChoiceReason: side === preferredSide
            ? preferredSideReason
            : "oppositeSideAfterPreferredFailed",
          laneRank,
          laneX,
          splitDepth: frame.splitDepth,
          branchPath: frame.branchPath,
          initialRoute,
          points,
        });
        conflict = drawnLedger.findRouteConflict({
          edge,
          points,
          ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
          allowEdgeCrossings: false,
        });
        if (!conflict) {
          drawnLedger.markCandidateAccepted(candidateId, {
            acceptedCandidateFamily: "incremental-backward",
            acceptedLengthScale: null,
          });
          route = makeSketchEdgeRoute({
            edge,
            routeKind: "sketchLoopReturn",
            points,
          });
          committedSide = side;
          committedLaneRank = laneRank;
          committedLaneX = laneX;
          adjustmentCount = iteration;
          return true;
        }

        const blocker = findFirstRouteBlocker(points) ?? {
          ...conflict,
          obstacleKind: "unknown",
          segmentIndex: conflict.crossingPair?.candidateSegmentIndex ?? 0,
          box: conflict.crossingPair?.existingBox ?? boxForPoints(points, 0),
        };
        const variants = detourVariantsAroundObstacle(points, blocker, side);
        const scoredVariants = variants.map((variant) => {
          const nextBlocker = findFirstRouteBlocker(variant.points);
          const repeatedBlockerPenalty = sameBlocker(blocker, nextBlocker) ? 1000000 : 0;
          const conflictPenalty = nextBlocker ? 10000 : 0;
          return {
            ...variant,
            nextBlocker,
            score: repeatedBlockerPenalty + conflictPenalty + routeLength(variant.points) + variant.points.length,
          };
        }).sort((left, right) => left.score - right.score);
        const selectedVariant = scoredVariants[0] ?? null;
        detourRows.push({
          order: detourRows.length,
          edgeId: edge.id,
          side,
          iteration,
          blocker: {
            obstacleKind: blocker.obstacleKind,
            conflictKind: blocker.conflictKind ?? conflict.conflictKind,
            reason: blocker.reason ?? conflict.reason,
            segmentIndex: blocker.segmentIndex,
            crossingPair: blocker.crossingPair ?? conflict.crossingPair,
            box: blocker.box,
          },
          variantsAttempted: scoredVariants.map((variant) => ({
            detourKind: variant.detourKind,
            detourSide: variant.detourSide ?? null,
            detourBand: variant.detourBand ?? null,
            routeLength: routeLength(variant.points),
            nextBlocker: variant.nextBlocker ? {
              obstacleKind: variant.nextBlocker.obstacleKind,
              conflictKind: variant.nextBlocker.conflictKind,
              reason: variant.nextBlocker.reason,
              segmentIndex: variant.nextBlocker.segmentIndex,
              crossingPair: variant.nextBlocker.crossingPair,
            } : null,
          })),
          selectedDetour: selectedVariant ? {
            detourKind: selectedVariant.detourKind,
            detourSide: selectedVariant.detourSide ?? null,
            detourBand: selectedVariant.detourBand ?? null,
            detourBox: selectedVariant.detourBox,
            points: selectedVariant.points,
          } : null,
        });
        drawnLedger.recordRejection({
          candidateId,
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          conflictKind: blocker.conflictKind ?? conflict.conflictKind,
          reason: blocker.reason ?? conflict.reason,
          crossingPair: blocker.crossingPair ?? conflict.crossingPair,
          blockingObstacle: {
            obstacleKind: blocker.obstacleKind,
            box: blocker.box,
            segmentIndex: blocker.segmentIndex,
          },
          insertedDetour: {
            detourKind: selectedVariant?.detourKind ?? null,
            detourSide: selectedVariant?.detourSide ?? side,
            detourBand: selectedVariant?.detourBand ?? null,
            margin: obstacleMargin,
          },
          nextAdjustmentKind: iteration < maxDetourIterations && selectedVariant
            ? "incrementalObstacleDetour"
            : (side === preferredSide ? "tryOppositeSidePriority" : "noFurtherCandidate"),
        });
        if (!selectedVariant) break;
        points = selectedVariant.points;
      }
      const gridResult = findVisibleObstacleGridRoute({ start, end, side, laneX });
      const gridPoints = gridResult?.points ?? null;
      if (gridPoints) {
        const candidateId = drawnLedger.recordCandidate({
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          adjustmentKind: "visibleObstacleGridDetour",
          routeShape: "incrementalVisibleObstacleGrid",
          side,
          preferredSide,
          preferredSideReason,
          sideChoiceReason: side === preferredSide
            ? preferredSideReason
            : "oppositeSideAfterPreferredFailed",
          laneRank,
          laneX,
          splitDepth: frame.splitDepth,
          branchPath: frame.branchPath,
          initialRoute,
          gridSearch: {
            visited: gridResult.visited,
            xCoordCount: gridResult.xCoordCount,
            yCoordCount: gridResult.yCoordCount,
          },
          points: gridPoints,
        });
        conflict = drawnLedger.findRouteConflict({
          edge,
          points: gridPoints,
          ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
          allowEdgeCrossings: false,
        });
        if (!conflict) {
          drawnLedger.markCandidateAccepted(candidateId, {
            acceptedCandidateFamily: "visible-obstacle-grid",
            acceptedLengthScale: null,
          });
          route = makeSketchEdgeRoute({
            edge,
            routeKind: "sketchLoopReturn",
            points: gridPoints,
          });
          committedSide = side;
          committedLaneRank = laneRank;
          committedLaneX = laneX;
          adjustmentCount = maxDetourIterations + 1;
          detourRows.push({
            order: detourRows.length,
            edgeId: edge.id,
            side,
            iteration: "grid",
            selectedDetour: {
              detourKind: "visibleObstacleGridDetour",
              points: gridPoints,
            },
            gridSearch: {
              visited: gridResult.visited,
              xCoordCount: gridResult.xCoordCount,
              yCoordCount: gridResult.yCoordCount,
            },
          });
          return true;
        }
        drawnLedger.recordRejection({
          candidateId,
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          conflictKind: conflict.conflictKind,
          reason: conflict.reason,
          crossingPair: conflict.crossingPair,
          nextAdjustmentKind: side === preferredSide ? "tryOppositeSidePriority" : "noFurtherCandidate",
        });
      } else {
        detourRows.push({
          order: detourRows.length,
          edgeId: edge.id,
          side,
          iteration: "grid",
          selectedDetour: null,
          gridSearch: gridResult,
        });
      }
      const sourceVerticalPort = targetPlacement.y < sourcePlacement.y
        ? getTopPort(sourceBounds)
        : getBottomPort(sourceBounds);
      const targetVerticalPort = targetPlacement.y < sourcePlacement.y
        ? getBottomPort(targetBounds)
        : getTopPort(targetBounds);
      const alternatePortVariants = [
        { portVariant: "sidePorts", start, end },
        { portVariant: "verticalReturn", start: sourceVerticalPort, end: targetVerticalPort },
        { portVariant: "sideToTargetVertical", start, end: targetVerticalPort },
        { portVariant: "sourceVerticalToSide", start: sourceVerticalPort, end },
      ];
      for (let portIndex = 1; portIndex < alternatePortVariants.length; portIndex += 1) {
        const portVariant = alternatePortVariants[portIndex];
        const alternateInitialRoute = compactRoutePoints([
          portVariant.start,
          [laneX, portVariant.start[1]],
          [laneX, portVariant.end[1]],
          portVariant.end,
        ]);
        const alternateGridResult = findVisibleObstacleGridRoute({
          start: portVariant.start,
          end: portVariant.end,
          side,
          laneX,
        });
        const alternateGridPoints = alternateGridResult?.points ?? null;
        if (!alternateGridPoints) {
          detourRows.push({
            order: detourRows.length,
            edgeId: edge.id,
            side,
            iteration: `grid:${portVariant.portVariant}`,
            selectedDetour: null,
            gridSearch: alternateGridResult,
          });
          continue;
        }
        const candidateId = drawnLedger.recordCandidate({
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          adjustmentKind: `visibleObstacleGridDetour:${portVariant.portVariant}`,
          routeShape: "incrementalVisibleObstacleGrid",
          side,
          preferredSide,
          preferredSideReason,
          sideChoiceReason: side === preferredSide
            ? preferredSideReason
            : "oppositeSideAfterPreferredFailed",
          portVariant: portVariant.portVariant,
          laneRank,
          laneX,
          splitDepth: frame.splitDepth,
          branchPath: frame.branchPath,
          initialRoute: alternateInitialRoute,
          gridSearch: {
            visited: alternateGridResult.visited,
            xCoordCount: alternateGridResult.xCoordCount,
            yCoordCount: alternateGridResult.yCoordCount,
          },
          points: alternateGridPoints,
        });
        conflict = drawnLedger.findRouteConflict({
          edge,
          points: alternateGridPoints,
          ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
          allowEdgeCrossings: false,
        });
        if (!conflict) {
          drawnLedger.markCandidateAccepted(candidateId, {
            acceptedCandidateFamily: "visible-obstacle-grid",
            acceptedLengthScale: null,
          });
          route = makeSketchEdgeRoute({
            edge,
            routeKind: "sketchLoopReturn",
            points: alternateGridPoints,
          });
          committedSide = side;
          committedLaneRank = laneRank;
          committedLaneX = laneX;
          adjustmentCount = maxDetourIterations + 1 + portIndex;
          detourRows.push({
            order: detourRows.length,
            edgeId: edge.id,
            side,
            iteration: `grid:${portVariant.portVariant}`,
            selectedDetour: {
              detourKind: "visibleObstacleGridDetour",
              portVariant: portVariant.portVariant,
              points: alternateGridPoints,
            },
            gridSearch: {
              visited: alternateGridResult.visited,
              xCoordCount: alternateGridResult.xCoordCount,
              yCoordCount: alternateGridResult.yCoordCount,
            },
          });
          return true;
        }
        drawnLedger.recordRejection({
          candidateId,
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          conflictKind: conflict.conflictKind,
          reason: conflict.reason,
          crossingPair: conflict.crossingPair,
          nextAdjustmentKind: portIndex + 1 < alternatePortVariants.length
            ? `visibleObstacleGridDetour:${alternatePortVariants[portIndex + 1].portVariant}`
            : (side === preferredSide ? "tryOppositeSidePriority" : "noFurtherCandidate"),
        });
      }
      for (let portIndex = 0; portIndex < alternatePortVariants.length; portIndex += 1) {
        const portVariant = alternatePortVariants[portIndex];
        const nodeSafeGridResult = findVisibleObstacleGridRoute({
          start: portVariant.start,
          end: portVariant.end,
          side,
          laneX,
          allowEdgeCrossings: true,
        });
        const nodeSafePoints = nodeSafeGridResult?.points ?? null;
        if (!nodeSafePoints) {
          detourRows.push({
            order: detourRows.length,
            edgeId: edge.id,
            side,
            iteration: `nodeSafeGrid:${portVariant.portVariant}`,
            selectedDetour: null,
            edgeCrossingTolerance: "afterStrictVisibleObstacleSearchFailed",
            gridSearch: nodeSafeGridResult,
          });
          continue;
        }
        const candidateId = drawnLedger.recordCandidate({
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          adjustmentKind: `nodeSafeVisibleObstacleGrid:${portVariant.portVariant}`,
          routeShape: "nodeSafeVisibleObstacleGrid",
          side,
          preferredSide,
          preferredSideReason,
          sideChoiceReason: side === preferredSide
            ? preferredSideReason
            : "oppositeSideAfterPreferredFailed",
          portVariant: portVariant.portVariant,
          edgeCrossingTolerance: "afterStrictVisibleObstacleSearchFailed",
          laneRank,
          laneX,
          splitDepth: frame.splitDepth,
          branchPath: frame.branchPath,
          gridSearch: {
            visited: nodeSafeGridResult.visited,
            xCoordCount: nodeSafeGridResult.xCoordCount,
            yCoordCount: nodeSafeGridResult.yCoordCount,
          },
          points: nodeSafePoints,
        });
        conflict = drawnLedger.findRouteConflict({
          edge,
          points: nodeSafePoints,
          ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
          allowEdgeCrossings: true,
        });
        if (!conflict) {
          drawnLedger.markCandidateAccepted(candidateId, {
            acceptedCandidateFamily: "node-safe-visible-obstacle-grid",
            acceptedLengthScale: null,
          });
          route = makeSketchEdgeRoute({
            edge,
            routeKind: "sketchLoopReturn",
            points: nodeSafePoints,
          });
          committedSide = side;
          committedLaneRank = laneRank;
          committedLaneX = laneX;
          adjustmentCount = maxDetourIterations + 10 + portIndex;
          detourRows.push({
            order: detourRows.length,
            edgeId: edge.id,
            side,
            iteration: `nodeSafeGrid:${portVariant.portVariant}`,
            selectedDetour: {
              detourKind: "nodeSafeVisibleObstacleGrid",
              portVariant: portVariant.portVariant,
              edgeCrossingTolerance: "afterStrictVisibleObstacleSearchFailed",
              points: nodeSafePoints,
            },
            gridSearch: {
              visited: nodeSafeGridResult.visited,
              xCoordCount: nodeSafeGridResult.xCoordCount,
              yCoordCount: nodeSafeGridResult.yCoordCount,
            },
          });
          return true;
        }
        drawnLedger.recordRejection({
          candidateId,
          edgeId: edge.id,
          branchId: frame.frameId,
          placementKind: "backwardLoopReturn",
          conflictKind: conflict.conflictKind,
          reason: conflict.reason,
          crossingPair: conflict.crossingPair,
          nextAdjustmentKind: portIndex + 1 < alternatePortVariants.length
            ? `nodeSafeVisibleObstacleGrid:${alternatePortVariants[portIndex + 1].portVariant}`
            : (side === preferredSide ? "tryOppositeSidePriority" : "noFurtherCandidate"),
        });
      }
      return false;
    });

    if (!route) {
      const candidateRows = drawnLedger.candidateRows.filter((row) => (
        row.edgeId === edge.id && row.placementKind === "backwardLoopReturn"
      ));
      const rejectionRows = drawnLedger.rejectionRows.filter((row) => (
        row.edgeId === edge.id && row.placementKind === "backwardLoopReturn"
      ));
      const routeFamiliesAttempted = Array.from(new Set(
        candidateRows.map((row) => row.routeShape ?? row.adjustmentKind ?? "unknown"),
      ));
      const adjustmentKindsAttempted = Array.from(new Set(
        candidateRows.map((row) => row.adjustmentKind ?? "unknown"),
      ));
      const sidesAttempted = Array.from(new Set(candidateRows.map((row) => row.side ?? "unknown")));
      const error = new Error(`sketchV1NoLegalBackwardRoute:${edge.id}`);
      error.sketchV1FallbackDiagnostics = {
        kind: "sketchV1BackwardRoutePreFallback",
        edgeId: edge.id,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        sourceNodeId: sourceNode.id,
        targetNodeId: targetNode.id,
        sourcePosition: { x: sourcePlacement.x, y: sourcePlacement.y },
        targetPosition: { x: targetPlacement.x, y: targetPlacement.y },
        sourceBounds,
        targetBounds,
        relativePosition: {
          dx: targetPlacement.x - sourcePlacement.x,
          dy: targetPlacement.y - sourcePlacement.y,
          targetIsLeft: targetPlacement.x < sourcePlacement.x,
          targetIsRight: targetPlacement.x > sourcePlacement.x,
          targetIsAbove: targetPlacement.y < sourcePlacement.y,
          targetIsBelow: targetPlacement.y > sourcePlacement.y,
        },
        branchId: frame.frameId,
        branchPath: frame.branchPath,
        splitDepth: frame.splitDepth,
        preferredSide,
        sideCandidates,
        visibleBounds,
        loopBounds,
        routeFamiliesAttempted,
        adjustmentKindsAttempted,
        sidesAttempted,
        candidateCount: candidateRows.length,
        rejectionCount: rejectionRows.length,
        closerOrLocalVariantsAttempted: candidateRows.some((row) => (
          row.adjustmentKind === "closer" ||
          row.adjustmentKind === "shorter" ||
          row.routeShape === "local" ||
          row.routeShape === "sideLane"
        )),
        differentPortVariantsAttempted: candidateRows.some((row) => (
          String(row.routeShape ?? "").includes("BottomPorts") ||
          String(row.routeShape ?? "").includes("TopPorts")
        )),
        topBandVariantsAttempted: candidateRows.some((row) => (
          String(row.routeShape ?? "").includes("upper")
        )),
        bottomBandVariantsAttempted: candidateRows.some((row) => (
          String(row.routeShape ?? "").includes("lower")
        )),
        fartherOutsideVariantsAttempted: candidateRows.some((row) => (
          row.adjustmentKind === "fartherOutward" ||
          row.adjustmentKind === "edgeConflictTolerantNodeSafeLane"
        )),
        unavoidableClassification: false,
        unavoidableClassificationReason:
          "not classified unavoidable; diagnostics exposed before fallback",
        detourRows,
        candidateRows,
        rejectionRows,
      };
      throw error;
    }

    edgeRouteByEdgeId.set(edge.id, route);
    drawnLedger.addEdgeRoute({
      edge,
      points: route.points,
      role: "backward jump",
      branchId: frame.frameId,
      splitDepth: frame.splitDepth,
      localBranchDepth: frame.splitDepth,
      branchPath: frame.branchPath,
    });
    drawnLedger.backwardRoutingRows.push({
      order: drawnLedger.backwardRoutingRows.length,
      edgeId: edge.id,
      sourceIndex: edge.sourceIndex,
      targetIndex: edge.targetIndex,
      branchId: frame.frameId,
      side: committedSide,
      laneRank: committedLaneRank,
      laneX: committedLaneX,
      adjustmentCount,
      preferredSide,
      preferredSideReason,
      sideCandidates,
      detourRows: detourRows.filter((row) => row.side === committedSide),
      conflictAfterLimit: conflict?.reason === "backwardRouteCommittedWithEdgeSegmentConflictAfterNodeSafeSearch",
      unresolvedConflictKind: conflict?.conflictKind ?? null,
      unresolvedConflictReason: conflict?.reason ?? null,
      finalRouteCrossesVisibleGeometry: Boolean(drawnLedger.findRouteConflict({
        edge,
        points: route.points,
        ignoreNodeIds: new Set([sourceNode.id, targetNode.id]),
        allowEdgeCrossings: false,
      })),
      points: route.points,
    });
    loopCorridorRows.push({
      order: loopCorridorRows.length,
      edgeId: edge.id,
      sourceIndex: edge.sourceIndex,
      targetIndex: edge.targetIndex,
      branchId: frame.frameId,
      side: committedSide,
      laneRank: committedLaneRank,
      laneX: committedLaneX,
      adjustmentCount,
      points: route.points,
      box: boxFromSegments(route.points, 0),
    });
    return route;
  };

  const reserveProvisionalHaltCorridor = (edge) => {
    const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
    const sourcePlacement = getPlacementByInstructionIndex(edge.sourceIndex);
    if (!sourceNode || !sourcePlacement) return null;
    const sourceBounds = boundsFromNodeAt(sourceNode, sourcePlacement, getNodeSize, layout);
    const side = edge.branch === "no" ? "left" : "right";
    let laneX = side === "left"
      ? sourceBounds.left - layout.loopLaneDistance
      : sourceBounds.right + layout.loopLaneDistance;
    return {
      side,
      laneX,
      adjustmentCount: 0,
      provisionalPoints: null,
      provisionalBox: null,
    };
  };

  const recordHaltExit = (edge, frame) => {
    const corridor = reserveProvisionalHaltCorridor(edge);
    haltExitRows.push({
      order: haltExitRows.length,
      edgeId: edge.id,
      sourceIndex: edge.sourceIndex,
      targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
      branch: edge.branch ?? null,
      branchId: frame.frameId,
      side: corridor?.side ?? null,
      laneX: corridor?.laneX ?? null,
      provisionalPoints: corridor?.provisionalPoints ?? null,
      provisionalBox: corridor?.provisionalBox ?? null,
    });
    emitTraversal(edge.branch ? "exitTail" : "haltTail", edge, { branchId: frame.frameId });
  };

  const recordBackwardEdge = (edge, frame) => {
    pendingBackwardEdges.push({ edge, frameId: frame.frameId });
    backwardEdgeRows.push({
      order: backwardEdgeRows.length,
      edgeId: edge.id,
      sourceIndex: edge.sourceIndex,
      targetIndex: edge.targetIndex,
      branch: edge.branch ?? null,
      branchId: frame.frameId,
      routeIntent: "loopReturn",
    });
    emitTraversal(
      edge.sourceIndex - edge.targetIndex <= layout.nearbyJumpThreshold + 1
        ? "compactLocalClosure"
        : "enclosingFrameClosure",
      edge,
      { branchId: frame.frameId },
    );
  };

  const pushPendingYes = ({ edge, targetIndex, placement, parentFrame }) => {
    const frame = createFrame({
      kind: "yesBranch",
      parentId: parentFrame.frameId,
      ownerEdgeId: edge.id,
      startInstructionIndex: targetIndex,
      side: "right",
    });
    if (placement) {
      placement.branchId = frame.frameId;
      ownerByNodeId.set(placement.nodeId, frame.frameId);
      placement.node.sketchV1FrameId = frame.frameId;
      frame.ownedNodeIds.push(placement.nodeId);
      parentFrame.ownedNodeIds = parentFrame.ownedNodeIds.filter((nodeId) => nodeId !== placement.nodeId);
      ledger.reassignNodeReservationsToFrame(placement.nodeId, frame);
    }
    pendingYesStack.push({
      edgeId: edge.id,
      targetIndex,
      frameId: frame.frameId,
    });
    pendingYesStackRows.push({
      order: pendingYesStackRows.length,
      op: "push",
      edgeId: edge.id,
      targetIndex,
      frameId: frame.frameId,
      stackDepthAfter: pendingYesStack.length,
    });
  };

  const popPendingYes = () => {
    const entry = pendingYesStack.pop() ?? null;
    if (entry) {
      pendingYesStackRows.push({
        order: pendingYesStackRows.length,
        op: "pop",
        edgeId: entry.edgeId,
        targetIndex: entry.targetIndex,
        frameId: entry.frameId,
        stackDepthAfter: pendingYesStack.length,
      });
    }
    return entry;
  };

  const placeBranchTarget = ({
    edge,
    sourcePlacement,
    side,
    parentFrame,
  }) => {
    const targetNode = instructionNodeLookup.get(edge.targetIndex);
    const direction = side === "left" ? -1 : 1;
    if (!targetNode) {
      recordStop(parentFrame.frameId, edge, "missingTargetNode");
      return { status: "stopped", placement: null };
    }
    if (placedByNodeId.has(targetNode.id)) {
      const placement = placedByNodeId.get(targetNode.id);
      recordAlreadyDrawnEdgeLane({
        edge,
        targetPlacement: placement,
        frame: parentFrame,
        placementKind: `${side}BranchTarget`,
      });
      placementRows.push({
        order: placementRows.length,
        nodeId: targetNode.id,
        instructionIndex: edge.targetIndex,
        edgeId: edge.id,
        branchId: parentFrame.frameId,
        placementKind: `${side}BranchTarget`,
        newlyPlaced: false,
        alreadyDrawn: true,
        x: placement.x,
        y: placement.y,
      });
      recordStop(parentFrame.frameId, edge, "alreadyDrawnTarget", {
        targetNodeId: targetNode.id,
      });
      return { status: "alreadyDrawn", placement };
    }

    const splitDistance = getSplitDistance(parentFrame.splitDepth);
    const result = placeNode({
      node: targetNode,
      instructionIndex: edge.targetIndex,
      candidate: {
        x: sourcePlacement.x + direction * splitDistance,
        y: sourcePlacement.y + params.splitStepY,
      },
      frame: parentFrame,
      edge,
      placementKind: `${side}BranchTarget`,
      direction,
    });
    return { status: "placed", placement: result.placement };
  };

  const processHaltOrBackward = (edge, frame) => {
    if (!edge) return false;
    if (!isInstructionTarget(edge.targetIndex, instructionCount) || edge.to === "halt") {
      recordHaltExit(edge, frame);
      recordStop(frame.frameId, edge, "halt");
      return true;
    }
    if (isBackwardEdge(edge)) {
      recordBackwardEdge(edge, frame);
      recordStop(frame.frameId, edge, edge.type === "jump" ? "backwardJump" : "backwardEdge");
      return true;
    }
    return false;
  };

  const drawBranch = (startIndex, frame) => {
    let currentIndex = startIndex;

    while (isInstructionTarget(currentIndex, instructionCount)) {
      const currentNode = instructionNodeLookup.get(currentIndex);
      const currentPlacement = currentNode ? placedByNodeId.get(currentNode.id) : null;
      if (!currentNode || !currentPlacement) {
        recordStop(frame.frameId, null, "missingCurrentPlacement", { currentIndex });
        return;
      }
      if (expandedNodeIds.has(currentNode.id)) {
        recordStop(frame.frameId, null, "alreadyExpandedNode", {
          currentIndex,
          nodeId: currentNode.id,
        });
        return;
      }

      expandedNodeIds.add(currentNode.id);
      dfsVisitRows.push({
        order: dfsVisitRows.length,
        instructionIndex: currentIndex,
        nodeId: currentNode.id,
        branchId: frame.frameId,
        x: currentPlacement.x,
        y: currentPlacement.y,
      });

      const outgoing = outgoingBySource.get(currentIndex) ?? [];
      if (analysis.nodeRoles[currentIndex] === "conditionalJump") {
        emitTraversal("splitDiamond", null, {
          sourceIndex: currentIndex,
          branchId: frame.frameId,
        });
        const noEdge = outgoing.find((edge) => edge.branch === "no") ?? null;
        const yesEdge = outgoing.find((edge) => edge.branch === "yes") ?? null;
        let noResult = { status: "stopped", placement: null };

        if (yesEdge && !processHaltOrBackward(yesEdge, frame)) {
          const yesResult = placeBranchTarget({
            edge: yesEdge,
            sourcePlacement: currentPlacement,
            side: "right",
            parentFrame: frame,
          });
          emitTraversal("branchStart", yesEdge, {
            branchId: frame.frameId,
            side: "right",
            newlyPlaced: yesResult.status === "placed",
            alreadyDrawn: yesResult.status === "alreadyDrawn",
          });
          if (yesResult.status === "placed") {
            pushPendingYes({
              edge: yesEdge,
              targetIndex: yesEdge.targetIndex,
              placement: yesResult.placement,
              parentFrame: frame,
            });
          }
        }

        if (noEdge && !processHaltOrBackward(noEdge, frame)) {
          noResult = placeBranchTarget({
            edge: noEdge,
            sourcePlacement: currentPlacement,
            side: "left",
            parentFrame: frame,
          });
          emitTraversal("branchStart", noEdge, {
            branchId: frame.frameId,
            side: "left",
            newlyPlaced: noResult.status === "placed",
            alreadyDrawn: noResult.status === "alreadyDrawn",
          });
        }

        if (noResult.status === "placed") {
          const noFrame = createFrame({
            kind: "noBranch",
            parentId: frame.frameId,
            ownerEdgeId: noEdge.id,
            startInstructionIndex: noEdge.targetIndex,
            side: "left",
          });
          noResult.placement.branchId = noFrame.frameId;
          noResult.placement.node.sketchV1FrameId = noFrame.frameId;
          ownerByNodeId.set(noResult.placement.nodeId, noFrame.frameId);
          noFrame.ownedNodeIds.push(noResult.placement.nodeId);
          frame.ownedNodeIds = frame.ownedNodeIds.filter((nodeId) => nodeId !== noResult.placement.nodeId);
          ledger.reassignNodeReservationsToFrame(noResult.placement.nodeId, noFrame);
          frame = noFrame;
          currentIndex = noEdge.targetIndex;
          continue;
        }

        recordStop(frame.frameId, noEdge ?? yesEdge, noResult.status === "alreadyDrawn"
          ? "alreadyDrawnTarget"
          : "splitBranchesStopped");
        return;
      }

      const primaryEdge = choosePrimaryEdge(outgoing, currentIndex);
      if (!primaryEdge) {
        recordStop(frame.frameId, null, "noOutgoingEdge", { currentIndex });
        return;
      }
      if (processHaltOrBackward(primaryEdge, frame)) {
        return;
      }

      const targetNode = instructionNodeLookup.get(primaryEdge.targetIndex);
      if (!targetNode) {
        recordStop(frame.frameId, primaryEdge, "missingTargetNode");
        return;
      }
      if (placedByNodeId.has(targetNode.id)) {
        const placement = placedByNodeId.get(targetNode.id);
        recordAlreadyDrawnEdgeLane({
          edge: primaryEdge,
          targetPlacement: placement,
          frame,
          placementKind: "ordinaryContinuation",
        });
        placementRows.push({
          order: placementRows.length,
          nodeId: targetNode.id,
          instructionIndex: primaryEdge.targetIndex,
          edgeId: primaryEdge.id,
          branchId: frame.frameId,
          placementKind: "ordinaryContinuation",
          newlyPlaced: false,
          alreadyDrawn: true,
          x: placement.x,
          y: placement.y,
        });
        recordStop(frame.frameId, primaryEdge, "alreadyDrawnTarget", {
          targetNodeId: targetNode.id,
        });
        return;
      }

      const result = placeNode({
        node: targetNode,
        instructionIndex: primaryEdge.targetIndex,
        candidate: {
          x: currentPlacement.x,
          y: currentPlacement.y + params.ordinaryStepY,
        },
        frame,
        edge: primaryEdge,
        placementKind: "ordinaryContinuation",
        direction: 0,
      });
      emitTraversal("ordinaryContinuation", primaryEdge, {
        branchId: frame.frameId,
        newlyPlaced: result.placed,
      });
      currentIndex = primaryEdge.targetIndex;
    }
  };

  const rootStart = layoutPlan.nodes.find((node) => node.kind === "start") ?? null;
  if (rootStart) {
    rootStart.x = 0;
    rootStart.y = 0;
  }
  const firstNode = instructionNodeLookup.get(0);
  if (firstNode) {
    placeNode({
      node: firstNode,
      instructionIndex: 0,
      candidate: { x: 0, y: params.ordinaryStepY },
      frame: rootFrame,
      placementKind: "rootEntry",
      direction: 0,
    });
    drawBranch(0, rootFrame);
  }

  let pending = popPendingYes();
  while (pending) {
    const frame = frames.find((candidate) => candidate.frameId === pending.frameId) ?? rootFrame;
    drawBranch(pending.targetIndex, frame);
    pending = popPendingYes();
  }

  for (let index = 0; index < instructionCount; index += 1) {
    const node = instructionNodeLookup.get(index);
    if (!node || placedByNodeId.has(node.id)) continue;
    const placedBounds = Array.from(placedByNodeId.values()).map((placement) => (
      getNodeBoundsAt(placement.node, placement, getNodeSize, layout)
    ));
    const contentBounds = unionBounds(placedBounds);
    const frame = createFrame({
      kind: "disconnected",
      parentId: rootFrame.frameId,
      startInstructionIndex: index,
      side: "disconnected",
    });
    placeNode({
      node,
      instructionIndex: index,
      candidate: {
        x: contentBounds.left - params.splitStepX,
        y: contentBounds.bottom + params.ordinaryStepY,
      },
      frame,
      placementKind: "disconnectedSafetyPlacement",
      direction: -1,
    });
    drawBranch(index, frame);
  }

  pendingBackwardEdges.forEach(({ edge, frameId }) => {
    const frame = frames.find((candidate) => candidate.frameId === frameId) ?? rootFrame;
    reserveLoopCorridor(edge, frame);
  });

  return {
    dfsVisitRows,
    pendingYesStackRows,
    branchStopRows,
    placementRows,
    haltExitRows,
    backwardEdgeRows,
    spacingAdjustmentRows,
    edgeIntentRows,
    loopCorridorRows,
    haltCorridorRows,
    traversalEvents,
    frames,
    ownerByNodeId,
    placedByNodeId,
    ledger,
    drawnLedger,
    edgeRouteByEdgeId,
    params,
  };
}

function placeSharedHalt({
  haltNode,
  haltExitRows,
  layoutPlan,
  getNodeSize,
  placement,
}) {
  const instructionNodes = getInstructionNodes(layoutPlan);
  const nodeMap = new Map(layoutPlan.nodes.map((node) => [node.id, node]));
  const sourceNodes = haltExitRows
    .map((row) => nodeMap.get(`i-${row.sourceIndex}`))
    .filter(Boolean);
  const instructionBounds = instructionNodes.map((node) => (
    getNodeBoundsAt(node, { x: node.x, y: node.y }, getNodeSize, layoutPlan.layout)
  ));
  const contentBounds = unionBounds(instructionBounds);
  const averageSourceY = sourceNodes.length > 0
    ? sourceNodes.reduce((sum, node) => sum + node.y, 0) / sourceNodes.length
    : (contentBounds.top + contentBounds.bottom) / 2;

  haltNode.x = contentBounds.right +
    Math.max(layoutPlan.layout.sideHaltDistance, layoutPlan.layout.loopLaneDistance * 2);
  haltNode.y = Number.isFinite(averageSourceY)
    ? averageSourceY
    : contentBounds.bottom +
      Math.max(layoutPlan.layout.verticalGap * 2, layoutPlan.layout.terminalHeight + 24);

  if (!placement) return;

  const layout = layoutPlan.layout;
  const haltBounds = boundsFromNodeAt(haltNode, haltNode, getNodeSize, layout);
  const params = placement.params;
  const edgeRouteByEdgeId = placement.edgeRouteByEdgeId;
  const drawnLedger = placement.drawnLedger;
  const rightLaneBase = Math.max(contentBounds.right, haltBounds.right) + layout.loopLaneDistance;
  const nonHaltEdgeMaxX = Math.max(
    contentBounds.right,
    ...drawnLedger.edgeSegments
      .filter((segment) => segment.role !== "HALT exit")
      .flatMap((segment) => [segment.start[0], segment.end[0]])
      .filter(Number.isFinite),
  );
  const haltLaneCapX = Math.max(
    contentBounds.right,
    nonHaltEdgeMaxX,
    haltBounds.right,
  ) + layout.loopLaneDistance + layout.loopLaneStep * 4;
  const laneRankBySide = new Map();
  drawnLedger.addNodeBox({
    nodeId: haltNode.id,
    instructionIndex: null,
    box: haltBounds,
    branchId: "halt",
    splitDepth: 0,
    branchPath: ["HALT"],
  });

  haltExitRows.forEach((row) => {
    const edge = layoutPlan.edges.find((candidate) => candidate.id === row.edgeId);
    const sourceNode = nodeMap.get(`i-${row.sourceIndex}`);
    if (!edge || !sourceNode) return;
    const sourceBounds = getNodeBoundsAt(
      sourceNode,
      { x: sourceNode.x, y: sourceNode.y },
      getNodeSize,
      layout,
    );
    const sourceBoundsWithCenter = {
      ...sourceBounds,
      centerX: sourceNode.x,
      centerY: sourceNode.y,
    };
    const side = "right";
    const laneRank = laneRankBySide.get(side) ?? 0;
    laneRankBySide.set(side, laneRank + 1);
    const baseLaneX = Math.min(rightLaneBase + laneRank * layout.loopLaneStep, haltLaneCapX);
    const haltPort = getRightPort(haltBounds);
    const approachY = haltBounds.centerY;
    const firstLaneX = Math.min(baseLaneX, haltLaneCapX);
    const candidateStarts = [
      {
        portName: "right",
        start: getRightPort(sourceBoundsWithCenter),
      },
      {
        portName: "top",
        start: getTopPort(sourceBoundsWithCenter),
      },
      {
        portName: "bottom",
        start: getBottomPort(sourceBoundsWithCenter),
      },
    ];
    const candidateLaneXs = Array.from(new Set([
      firstLaneX,
      Math.min(firstLaneX + layout.loopLaneStep, haltLaneCapX),
      Math.min(firstLaneX + layout.loopLaneStep * 2, haltLaneCapX),
    ].filter(Number.isFinite)));
    const obstacleBoxFromConflict = (conflict) => {
      const pair = conflict?.crossingPair ?? {};
      if (isFiniteBox(pair.existingBox)) return pair.existingBox;
      if (isFinitePoint(pair.existingSegmentStart) && isFinitePoint(pair.existingSegmentEnd)) {
        return boxForPoints([pair.existingSegmentStart, pair.existingSegmentEnd], Math.max(4, layout.arrowStrokeWidth * 4));
      }
      return null;
    };
    const compactRoutePoints = (points) => points.filter((point, index) => (
      index === 0 || !pointsEqual(point, points[index - 1])
    ));
    const makeBaseRoute = ({ start, laneX }) => compactRoutePoints([
      start,
      [laneX, start[1]],
      [laneX, approachY],
      haltPort,
    ]);
    const buildDetourCandidates = ({ start, laneX, conflict }) => {
      const obstacleBox = obstacleBoxFromConflict(conflict);
      if (!obstacleBox) return [];
      const margin = Math.max(layout.sideRouteGap, 18);
      const detourYs = [
        { band: "aboveBlockingObstacle", y: obstacleBox.top - margin },
        { band: "belowBlockingObstacle", y: obstacleBox.bottom + margin },
      ].filter((entry) => Number.isFinite(entry.y));

      return detourYs.flatMap((entry) => ([
        {
          routeFamily: "haltLocalDogleg",
          adjustmentKind: entry.band,
          points: compactRoutePoints([
            start,
            [start[0], entry.y],
            [laneX, entry.y],
            [laneX, approachY],
            haltPort,
          ]),
        },
        {
          routeFamily: "haltShortObstacleBypass",
          adjustmentKind: `${entry.band}:shortBypass`,
          points: compactRoutePoints([
            start,
            [start[0], entry.y],
            [haltPort[0], entry.y],
            haltPort,
          ]),
        },
      ]));
    };
    const simplifyOrthogonalRoute = (points) => {
      const compacted = compactRoutePoints(points);
      return compacted.filter((point, index) => {
        if (index === 0 || index === compacted.length - 1) return true;
        const previous = compacted[index - 1];
        const next = compacted[index + 1];
        const sameX = Math.abs(previous[0] - point[0]) < 0.001 && Math.abs(point[0] - next[0]) < 0.001;
        const sameY = Math.abs(previous[1] - point[1]) < 0.001 && Math.abs(point[1] - next[1]) < 0.001;
        return !(sameX || sameY);
      });
    };
    const findBoundedHaltGridRoute = ({ start, allowEdgeCrossings = false }) => {
      const coordScale = 1000;
      const xCoordMap = new Map();
      const yCoordMap = new Map();
      const margin = Math.max(layout.sideRouteGap, 18);
      const addCoord = (map, value) => {
        if (!Number.isFinite(value)) return;
        const key = Math.round(value * coordScale);
        if (!map.has(key)) map.set(key, value);
      };
      const addBoxCoords = (box) => {
        addCoord(xCoordMap, box.left - margin);
        addCoord(xCoordMap, box.right + margin);
        addCoord(yCoordMap, box.top - margin);
        addCoord(yCoordMap, box.bottom + margin);
      };

      [start[0], haltPort[0], firstLaneX, haltLaneCapX].forEach((value) => addCoord(xCoordMap, value));
      [start[1], haltPort[1], approachY].forEach((value) => addCoord(yCoordMap, value));
      addCoord(xCoordMap, contentBounds.left - margin);
      addCoord(yCoordMap, contentBounds.top - layout.verticalGap);
      addCoord(yCoordMap, contentBounds.bottom + layout.verticalGap);
      drawnLedger.nodeBoxes.forEach((nodeBox) => {
        if (nodeBox.nodeId === sourceNode.id || nodeBox.nodeId === haltNode.id) return;
        addBoxCoords(nodeBox.box);
      });
      drawnLedger.edgeSegments.forEach((segment) => {
        if (segment.edgeId === edge.id) return;
        addBoxCoords(boxForPoints([segment.start, segment.end], Math.max(4, layout.arrowStrokeWidth * 4)));
      });

      const xCoords = Array.from(xCoordMap.values())
        .filter((value) => value <= haltLaneCapX + 0.001)
        .sort((left, right) => left - right);
      const yCoords = Array.from(yCoordMap.values()).sort((left, right) => left - right);
      const startXi = xCoords.findIndex((value) => Math.abs(value - start[0]) < 0.001);
      const startYi = yCoords.findIndex((value) => Math.abs(value - start[1]) < 0.001);
      const endXi = xCoords.findIndex((value) => Math.abs(value - haltPort[0]) < 0.001);
      const endYi = yCoords.findIndex((value) => Math.abs(value - haltPort[1]) < 0.001);
      if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null;

      const keyFor = (xi, yi) => `${xi},${yi}`;
      const pointFor = (key) => {
        const [xi, yi] = key.split(",").map((value) => Number.parseInt(value, 10));
        return [xCoords[xi], yCoords[yi]];
      };
      const startKey = keyFor(startXi, startYi);
      const endKey = keyFor(endXi, endYi);
      const heuristic = (xi, yi) => (
        Math.abs(xCoords[xi] - haltPort[0]) + Math.abs(yCoords[yi] - haltPort[1])
      );
      const segmentIsLegal = (fromPoint, toPoint) => !drawnLedger.findRouteConflict({
        edge,
        points: [fromPoint, toPoint],
        ignoreNodeIds: new Set([sourceNode.id, haltNode.id]),
        allowEdgeCrossings,
      });
      const open = [{ key: startKey, xi: startXi, yi: startYi, g: 0, f: heuristic(startXi, startYi) }];
      const bestScoreByKey = new Map([[startKey, 0]]);
      const previousByKey = new Map();
      const closed = new Set();
      const maxVisited = Math.max(800, xCoords.length * yCoords.length);
      let visited = 0;

      while (open.length > 0 && visited < maxVisited) {
        open.sort((left, right) => left.f - right.f);
        const current = open.shift();
        if (!current || closed.has(current.key)) continue;
        visited += 1;
        if (current.key === endKey) {
          const reversed = [];
          let cursor = endKey;
          while (cursor) {
            reversed.push(pointFor(cursor));
            cursor = previousByKey.get(cursor);
          }
          return {
            points: simplifyOrthogonalRoute(reversed.reverse()),
            visited,
            xCoordCount: xCoords.length,
            yCoordCount: yCoords.length,
          };
        }
        closed.add(current.key);
        [
          [current.xi - 1, current.yi],
          [current.xi + 1, current.yi],
          [current.xi, current.yi - 1],
          [current.xi, current.yi + 1],
        ].forEach(([nextXi, nextYi]) => {
          if (
            nextXi < 0 ||
            nextXi >= xCoords.length ||
            nextYi < 0 ||
            nextYi >= yCoords.length
          ) {
            return;
          }
          const nextKey = keyFor(nextXi, nextYi);
          if (closed.has(nextKey)) return;
          const fromPoint = [xCoords[current.xi], yCoords[current.yi]];
          const toPoint = [xCoords[nextXi], yCoords[nextYi]];
          if (!segmentIsLegal(fromPoint, toPoint)) return;
          const nextG = current.g + Math.abs(toPoint[0] - fromPoint[0]) + Math.abs(toPoint[1] - fromPoint[1]);
          if (nextG >= (bestScoreByKey.get(nextKey) ?? Infinity)) return;
          bestScoreByKey.set(nextKey, nextG);
          previousByKey.set(nextKey, current.key);
          open.push({
            key: nextKey,
            xi: nextXi,
            yi: nextYi,
            g: nextG,
            f: nextG + heuristic(nextXi, nextYi),
          });
        });
      }

      return null;
    };
    const candidateQueue = [];
    candidateStarts.forEach((startEntry) => {
      candidateLaneXs.forEach((laneX, laneIndex) => {
        candidateQueue.push({
          routeFamily: laneIndex === 0 ? "rightSideSharedHalt" : "boundedRightShift",
          adjustmentKind: laneIndex === 0
            ? `sourcePort:${startEntry.portName}`
            : `sourcePort:${startEntry.portName}:boundedRightShift`,
          sourcePort: startEntry.portName,
          laneX,
          points: makeBaseRoute({ start: startEntry.start, laneX }),
        });
      });
      const gridRoute = findBoundedHaltGridRoute({ start: startEntry.start });
      if (gridRoute?.points) {
        candidateQueue.push({
          routeFamily: "haltVisibleObstacleGrid",
          adjustmentKind: `sourcePort:${startEntry.portName}:visibleObstacleGrid`,
          sourcePort: startEntry.portName,
          laneX: Math.min(maxPointX(gridRoute.points) ?? firstLaneX, haltLaneCapX),
          gridSearch: {
            visited: gridRoute.visited,
            xCoordCount: gridRoute.xCoordCount,
            yCoordCount: gridRoute.yCoordCount,
          },
          points: gridRoute.points,
        });
      }
      const nodeSafeGridRoute = findBoundedHaltGridRoute({
        start: startEntry.start,
        allowEdgeCrossings: true,
      });
      if (nodeSafeGridRoute?.points) {
        candidateQueue.push({
          routeFamily: "haltNodeSafeVisibleObstacleGrid",
          adjustmentKind: `sourcePort:${startEntry.portName}:nodeSafeVisibleObstacleGrid`,
          sourcePort: startEntry.portName,
          edgeCrossingTolerance: "afterStrictHaltSearchFailed",
          laneX: Math.min(maxPointX(nodeSafeGridRoute.points) ?? firstLaneX, haltLaneCapX),
          gridSearch: {
            visited: nodeSafeGridRoute.visited,
            xCoordCount: nodeSafeGridRoute.xCoordCount,
            yCoordCount: nodeSafeGridRoute.yCoordCount,
          },
          points: nodeSafeGridRoute.points,
        });
      }
    });
    let route = null;
    let acceptedCandidate = null;
    let lastConflict = null;
    let candidateCursor = 0;
    const attemptedRouteKeys = new Set();

    while (candidateCursor < candidateQueue.length && !route) {
      const candidate = candidateQueue[candidateCursor];
      candidateCursor += 1;
      const routeKey = candidate.points.map((point) => point.join(",")).join("|");
      if (attemptedRouteKeys.has(routeKey)) continue;
      attemptedRouteKeys.add(routeKey);

      const candidateId = drawnLedger.recordCandidate({
        edgeId: edge.id,
        branchId: row.branchId,
        placementKind: "finalHaltRouting",
        adjustmentKind: candidate.adjustmentKind,
        routeFamily: candidate.routeFamily,
        sourcePort: candidate.sourcePort ?? null,
        edgeCrossingTolerance: candidate.edgeCrossingTolerance ?? null,
        gridSearch: candidate.gridSearch ?? null,
        side,
        laneRank,
        laneX: candidate.laneX,
        haltLaneCapX,
        points: candidate.points,
        splitDepth: getFrameById(placement.frames, row.branchId)?.splitDepth ?? 0,
        branchPath: getFrameById(placement.frames, row.branchId)?.branchPath ?? [],
      });
      const conflict = drawnLedger.findRouteConflict({
        edge,
        points: candidate.points,
        ignoreNodeIds: new Set([sourceNode.id, haltNode.id]),
        allowEdgeCrossings: candidate.routeFamily === "haltNodeSafeVisibleObstacleGrid",
      });
      if (!conflict) {
        drawnLedger.markCandidateAccepted(candidateId, {
          acceptedCandidateFamily: candidate.routeFamily,
          acceptedLengthScale: null,
        });
        route = makeSketchEdgeRoute({
          edge,
          routeKind: "sketchHaltExit",
          points: candidate.points,
        });
        acceptedCandidate = {
          ...candidate,
          candidateId,
        };
        break;
      }

      lastConflict = conflict;
      const detourCandidates = buildDetourCandidates({
        start: candidate.points[0],
        laneX: candidate.laneX,
        conflict,
      });
      detourCandidates.forEach((detour) => {
        const detourMaxX = maxPointX(detour.points ?? []);
        if (Number.isFinite(detourMaxX) && detourMaxX > haltLaneCapX) return;
        candidateQueue.push({
          ...detour,
          sourcePort: candidate.sourcePort,
          laneX: candidate.laneX,
        });
      });
      drawnLedger.recordRejection({
        candidateId,
        edgeId: edge.id,
        branchId: row.branchId,
        placementKind: "finalHaltRouting",
        conflictKind: conflict.conflictKind,
        reason: conflict.reason,
        crossingPair: conflict.crossingPair,
        blockingGeometry: conflict.crossingPair ?? null,
        nextAdjustmentKind: detourCandidates.length > 0
          ? "localDetourAroundBlockingGeometry"
          : (candidateCursor < candidateQueue.length ? "nextBoundedHaltCandidate" : "noFurtherCandidate"),
      });
    }

    if (!route) {
      const candidateRows = drawnLedger.candidateRows.filter((candidate) => (
        candidate.edgeId === edge.id && candidate.placementKind === "finalHaltRouting"
      ));
      const rejectionRows = drawnLedger.rejectionRows.filter((rejection) => (
        rejection.edgeId === edge.id && rejection.placementKind === "finalHaltRouting"
      ));
      const error = new Error(`sketchV1NoLegalHaltRoute:${edge.id}`);
      error.sketchV1FallbackDiagnostics = {
        kind: "sketchV1HaltRoutePreFallback",
        edgeId: edge.id,
        sourceIndex: row.sourceIndex,
        sourceNodeId: sourceNode.id,
        sourceBounds: sourceBoundsWithCenter,
        haltNodeId: haltNode.id,
        haltPosition: { x: haltNode.x, y: haltNode.y },
        haltBounds,
        contentBounds,
        maxCommittedNodeXBeforeHalt: contentBounds.right,
        maxCommittedNonHaltEdgeXBeforeHalt: nonHaltEdgeMaxX,
        haltLaneCapX,
        candidateCount: candidateRows.length,
        rejectionCount: rejectionRows.length,
        finalRejectionReason: lastConflict?.reason ?? "noCandidateGenerated",
        finalBlockingGeometry: lastConflict?.crossingPair ?? null,
        candidateRows,
        rejectionRows,
      };
      throw error;
    }

    edgeRouteByEdgeId.set(edge.id, route);
    drawnLedger.addEdgeRoute({
      edge,
      points: route.points,
      role: "HALT exit",
      branchId: row.branchId,
      splitDepth: getFrameById(placement.frames, row.branchId)?.splitDepth ?? 0,
      localBranchDepth: getFrameById(placement.frames, row.branchId)?.splitDepth ?? 0,
      branchPath: getFrameById(placement.frames, row.branchId)?.branchPath ?? [],
    });
    drawnLedger.haltRoutingRows.push({
      order: drawnLedger.haltRoutingRows.length,
      edgeId: edge.id,
      sourceIndex: row.sourceIndex,
      branchId: row.branchId,
      side,
      laneRank,
      laneX: acceptedCandidate.laneX,
      haltLaneCapX,
      routeFamily: acceptedCandidate.routeFamily,
      sourcePort: acceptedCandidate.sourcePort ?? null,
      adjustmentKind: acceptedCandidate.adjustmentKind,
      adjustmentCount: Math.max(0, candidateCursor - 1),
      conflictAfterLimit: false,
      committed: true,
      maxX: maxPointX(route.points),
      points: route.points,
    });
    placement.haltCorridorRows.push({
      order: placement.haltCorridorRows.length,
      edgeId: edge.id,
      sourceIndex: row.sourceIndex,
      branchId: row.branchId,
      side,
      laneRank,
      laneX: acceptedCandidate.laneX,
      haltLaneCapX,
      routeFamily: acceptedCandidate.routeFamily,
      adjustmentKind: acceptedCandidate.adjustmentKind,
      adjustmentCount: Math.max(0, candidateCursor - 1),
      conflictAfterLimit: false,
      committed: true,
      points: route.points,
      box: boxFromSegments(route.points, params.haltCorridorPadding),
    });
  });
}

function getFrameDepth(frameId, frames) {
  const children = frames.filter((frame) => frame.parentId === frameId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => getFrameDepth(child.frameId, frames)));
}

function buildSketchFrameRows(frames, placedByNodeId, getNodeSize, layout) {
  const placementByFrame = new Map();
  placedByNodeId.forEach((placement) => {
    appendMapList(placementByFrame, placement.branchId, placement);
  });

  return frames.map((frame) => {
    const placements = placementByFrame.get(frame.frameId) ?? [];
    const bounds = unionBounds(placements.map((placement) => (
      getNodeBoundsAt(placement.node, placement, getNodeSize, layout)
    )));

    return {
      ...frame,
      visualBBox: bounds,
    };
  });
}

function validateSketchCoordinates(layoutPlan, instructionNodes, placedByNodeId) {
  const nodesMissingSketchFrame = instructionNodes
    .filter((node) => !placedByNodeId.has(node.id))
    .map((node) => node.id);
  const invalidSketchCoordinates = layoutPlan.nodes
    .filter((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y))
    .map((node) => node.id);
  const coordinatesCommittedOnce = instructionNodes.every((node) => placedByNodeId.has(node.id));

  return {
    nodesMissingSketchFrame,
    invalidSketchCoordinates,
    coordinatesCommittedOnce,
  };
}

function buildSketchBranchClassificationRows({
  edges,
  placementRows,
  branchStopRows,
  spacingRows,
  instructionCount,
}) {
  const placementByEdgeId = new Map(
    placementRows
      .filter((row) => row.edgeId)
      .map((row) => [row.edgeId, row]),
  );
  const stopByEdgeId = new Map(
    branchStopRows
      .filter((row) => row.edgeId)
      .map((row) => [row.edgeId, row]),
  );
  const spacingByEdgeId = new Map(
    spacingRows
      .filter((row) => row.edgeId)
      .map((row) => [row.edgeId, row]),
  );

  return edges
    .filter((edge) => edge.branch)
    .map((edge) => {
      const placement = placementByEdgeId.get(edge.id) ?? null;
      const stop = stopByEdgeId.get(edge.id) ?? null;
      const haltExit = edge.to === "halt" || !isInstructionTarget(edge.targetIndex, instructionCount);
      const backward = isBackwardEdge(edge);
      const alreadyDrawnTarget = Boolean(
        placement?.alreadyDrawn ||
        stop?.reason === "alreadyDrawnTarget",
      );
      const ordinaryForwardConditionalSplit = Boolean(
        edge.branch &&
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex > edge.sourceIndex &&
        !haltExit &&
        !backward &&
        !alreadyDrawnTarget
      );

      return {
        edgeId: edge.id,
        sourceIndex: Number.isInteger(edge.sourceIndex) ? edge.sourceIndex : null,
        targetIndex: Number.isInteger(edge.targetIndex) ? edge.targetIndex : null,
        branch: edge.branch,
        ordinaryForwardConditionalSplit,
        sideRuleApplies: ordinaryForwardConditionalSplit,
        haltExit,
        backward,
        alreadyDrawnTarget,
        newlyPlacedTarget: Boolean(placement?.newlyPlaced),
        affectedBySpacingAdjustment: spacingByEdgeId.has(edge.id),
        placementKind: placement?.placementKind ?? null,
        stopReason: stop?.reason ?? null,
      };
    });
}

function buildSketchReservationOverlapRows({
  reservations,
  frames,
}) {
  const rows = [];

  for (let leftIndex = 0; leftIndex < reservations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < reservations.length; rightIndex += 1) {
      const left = reservations[leftIndex];
      const right = reservations[rightIndex];
      const classified = classifyReservationOverlap(left, right, frames);
      if (!classified) continue;

      rows.push({
        order: rows.length,
        leftReservationId: left.id,
        leftKind: left.kind,
        leftOwnerEdgeId: left.ownerEdgeId ?? null,
        leftOwnerNodeId: left.ownerNodeId ?? null,
        leftBranchId: left.branchId ?? null,
        leftParentFrameId: left.parentFrameId ?? null,
        leftSide: left.side ?? null,
        leftEdgeRole: left.edgeRole ?? null,
        rightReservationId: right.id,
        rightKind: right.kind,
        rightOwnerEdgeId: right.ownerEdgeId ?? null,
        rightOwnerNodeId: right.ownerNodeId ?? null,
        rightBranchId: right.branchId ?? null,
        rightParentFrameId: right.parentFrameId ?? null,
        rightSide: right.side ?? null,
        rightEdgeRole: right.edgeRole ?? null,
        classification: classified.classification,
        reason: classified.reason,
        illegalSource: classified.illegalSource,
        conflictBox: unionBounds([left.box, right.box]),
      });
    }
  }

  return rows;
}

function buildSketchEdgeReservationCrossingRows({
  edges,
  reservations,
}) {
  const rows = [];

  edges.forEach((edge) => {
    const points = edge.sketchV1ReservedRoute?.points ?? null;
    if (!areFinitePoints(points)) return;

    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
      const start = points[segmentIndex];
      const end = points[segmentIndex + 1];
      reservations.forEach((reservation) => {
        if (!isFiniteBox(reservation.box)) return;
        if (reservation.ownerEdgeId === edge.id) return;
        if (reservation.ownerNodeId === edge.from || reservation.ownerNodeId === edge.to) return;
        if (reservation.sourceNodeId === edge.from || reservation.targetNodeId === edge.to) return;
        if (!segmentIntersectsBox(start, end, reservation.box)) return;
        rows.push({
          order: rows.length,
          edgeId: edge.id,
          segmentIndex,
          reservationId: reservation.id,
          reservationKind: reservation.kind,
          reservationOwnerEdgeId: reservation.ownerEdgeId ?? null,
          reservationOwnerNodeId: reservation.ownerNodeId ?? null,
          branchId: reservation.branchId ?? null,
          box: reservation.box,
        });
      });
    }
  });

  return rows;
}

function buildDrawnGeometryValidationRows(drawnLedger) {
  const edgeNodeCrossings = [];
  const ordinaryEdgeCrossings = [];
  const exactEdgeOverlapRows = [];
  const partialEdgeOverlapRows = [];
  const nearParallelEdgeOverlapRows = [];
  const ordinaryRoles = new Set(["continuation", "ordinary split"]);

  drawnLedger.edgeSegments.forEach((segment) => {
    drawnLedger.nodeBoxes.forEach((nodeBox) => {
      if (
        nodeBox.nodeId === segment.sourceNodeId ||
        nodeBox.nodeId === segment.targetNodeId
      ) {
        return;
      }
      if (!segmentIntersectsBox(segment.start, segment.end, nodeBox.box)) return;
      edgeNodeCrossings.push({
        order: edgeNodeCrossings.length,
        edgeId: segment.edgeId,
        segmentIndex: segment.segmentIndex,
        role: segment.role,
        nodeId: nodeBox.nodeId,
        box: nodeBox.box,
      });
    });
  });

  for (let leftIndex = 0; leftIndex < drawnLedger.edgeSegments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < drawnLedger.edgeSegments.length; rightIndex += 1) {
      const left = drawnLedger.edgeSegments[leftIndex];
      const right = drawnLedger.edgeSegments[rightIndex];
      if (left.edgeId === right.edgeId) continue;
      const sharedEndpointContact = (
        pointsEqual(left.start, right.start) ||
        pointsEqual(left.start, right.end) ||
        pointsEqual(left.end, right.start) ||
        pointsEqual(left.end, right.end)
      ) && (
        left.sourceNodeId === right.sourceNodeId ||
        left.sourceNodeId === right.targetNodeId ||
        left.targetNodeId === right.sourceNodeId ||
        left.targetNodeId === right.targetNodeId
      );
      const laneConflict = segmentLaneConflict(left, right, SKETCH_EDGE_LANE_MARGIN);
      if (laneConflict) {
        const overlapRow = {
          leftEdgeId: left.edgeId,
          leftSegmentIndex: left.segmentIndex,
          leftRole: left.role,
          leftStart: left.start,
          leftEnd: left.end,
          rightEdgeId: right.edgeId,
          rightSegmentIndex: right.segmentIndex,
          rightRole: right.role,
          rightStart: right.start,
          rightEnd: right.end,
          overlapLength: laneConflict.overlapLength,
          laneDistance: laneConflict.distance,
          allowedSourceTargetContact: sharedEndpointContact && laneConflict.overlapLength <= SKETCH_EDGE_LANE_MARGIN * 1.5,
        };
        if (laneConflict.conflictKind === "edge-lane-near-parallel-overlap") {
          nearParallelEdgeOverlapRows.push({
            order: nearParallelEdgeOverlapRows.length,
            ...overlapRow,
          });
        } else {
          const endpointsMatch = (
            (pointsEqual(left.start, right.start) && pointsEqual(left.end, right.end)) ||
            (pointsEqual(left.start, right.end) && pointsEqual(left.end, right.start))
          );
          const targetRows = endpointsMatch ? exactEdgeOverlapRows : partialEdgeOverlapRows;
          targetRows.push({
            order: targetRows.length,
            ...overlapRow,
          });
        }
      }

      if (!ordinaryRoles.has(left.role) || !ordinaryRoles.has(right.role)) continue;
      if (!segmentsIntersect(left.start, left.end, right.start, right.end)) continue;
      if (sharedEndpointContact) continue;
      ordinaryEdgeCrossings.push({
        order: ordinaryEdgeCrossings.length,
        leftEdgeId: left.edgeId,
        leftSegmentIndex: left.segmentIndex,
        leftRole: left.role,
        rightEdgeId: right.edgeId,
        rightSegmentIndex: right.segmentIndex,
        rightRole: right.role,
      });
    }
  }

  return {
    edgeNodeCrossings,
    ordinaryEdgeCrossings,
    exactEdgeOverlapRows,
    partialEdgeOverlapRows,
    nearParallelEdgeOverlapRows,
  };
}

function buildDiamondExitGrammarRows({ edges, drawnLedger, layout }) {
  const committedByEdgeId = new Map(
    drawnLedger.committedEdgeRows.map((row) => [row.edgeId, row]),
  );

  return edges
    .filter((edge) => edge.branch)
    .map((edge) => {
      const committed = committedByEdgeId.get(edge.id) ?? null;
      const isNewOrdinaryForwardSplit = Boolean(
        committed?.role === "ordinary split" &&
        Number.isInteger(edge.sourceIndex) &&
        Number.isInteger(edge.targetIndex) &&
        edge.targetIndex > edge.sourceIndex &&
        edge.to !== "halt",
      );
      const points = committed?.points ?? [];
      const start = points[0] ?? null;
      const end = points[points.length - 1] ?? null;
      const dx = isFinitePoint(start) && isFinitePoint(end) ? end[0] - start[0] : null;
      const dy = isFinitePoint(start) && isFinitePoint(end) ? end[1] - start[1] : null;
      const expectedDirection = edge.branch === "no" ? -1 : 1;
      const usesTurn = points.length > 2;
      const routeTangent = (
        Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        Math.abs(dx) > 0.001
      )
        ? Math.abs(dy / dx)
        : null;
      const expectedTangent = getDiamondExitAngleTangent(layout);
      const fixedAngle = Number.isFinite(routeTangent) &&
        Math.abs(routeTangent - expectedTangent) <= SKETCH_DIAMOND_EXIT_ANGLE_TOLERANCE;
      const straightDownwardOutwardDiagonal = Boolean(
        points.length === 2 &&
        Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        dy > 0 &&
        dx * expectedDirection > 0 &&
        fixedAngle,
      );
      return {
        edgeId: edge.id,
        branch: edge.branch,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        role: committed?.role ?? null,
        auditedAsNewOrdinaryForwardSplit: isNewOrdinaryForwardSplit,
        pointCount: points.length,
        usesTurn,
        routeTangent,
        expectedTangent,
        fixedAngle,
        straightDownwardOutwardDiagonal: isNewOrdinaryForwardSplit
          ? straightDownwardOutwardDiagonal
          : true,
        points,
        routeKind: committed?.routeKind ?? null,
      };
    })
    .filter((row) => row.auditedAsNewOrdinaryForwardSplit);
}

function buildSketchSideOwnershipRows({ edges, placementRows, placedByNodeId, instructionNodeLookup }) {
  const placementByEdgeId = new Map(
    placementRows
      .filter((row) => row.edgeId && row.newlyPlaced)
      .map((row) => [row.edgeId, row]),
  );

  return edges
    .filter((edge) => (
      edge.branch &&
      Number.isInteger(edge.sourceIndex) &&
      Number.isInteger(edge.targetIndex) &&
      edge.targetIndex > edge.sourceIndex &&
      edge.to !== "halt"
    ))
    .map((edge) => {
      const row = placementByEdgeId.get(edge.id) ?? null;
      const sourceNode = instructionNodeLookup.get(edge.sourceIndex);
      const sourcePlacement = sourceNode ? placedByNodeId.get(sourceNode.id) ?? null : null;
      const targetIsNewlyPlaced = Boolean(row);
      const expectedSide = edge.branch === "no" ? "left" : "right";
      const preservesSide = !targetIsNewlyPlaced || !sourcePlacement
        ? true
        : expectedSide === "left"
          ? row.x < sourcePlacement.x
          : row.x > sourcePlacement.x;
      return {
        edgeId: edge.id,
        branch: edge.branch,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        targetIsNewlyPlaced,
        expectedSide,
        sourceX: sourcePlacement?.x ?? null,
        targetX: row?.x ?? null,
        preservesSide,
      };
    });
}

function buildSplitDistanceRows(edgeIntentRows) {
  const rows = edgeIntentRows
    .filter((row) => row.branch && Number.isFinite(row.chosenSplitDistance))
    .map((row) => ({
      edgeId: row.edgeId,
      branch: row.branch,
      splitDepth: row.splitDepth,
      chosenSplitDistance: row.chosenSplitDistance,
      branchPath: row.branchPath,
    }));
  const distanceByDepth = new Map();
  rows.forEach((row) => {
    if (!distanceByDepth.has(row.splitDepth)) {
      distanceByDepth.set(row.splitDepth, row.chosenSplitDistance);
    }
  });
  const orderedDepths = Array.from(distanceByDepth.keys()).sort((left, right) => left - right);
  const decreaseRows = orderedDepths.slice(1).map((depth) => ({
    splitDepth: depth,
    parentSplitDepth: depth - 1,
    chosenSplitDistance: distanceByDepth.get(depth),
    parentSplitDistance: distanceByDepth.get(depth - 1) ?? null,
    decreasesFromParentDefault: Number.isFinite(distanceByDepth.get(depth - 1))
      ? distanceByDepth.get(depth) < distanceByDepth.get(depth - 1)
      : true,
  }));

  return { rows, decreaseRows };
}

export function applySketchV1Layout(
  layoutPlan,
  {
    getNodeSize,
    includeVerboseDiagnostics = false,
  } = {},
) {
  if (layoutPlan.layoutMode !== SKETCH_LAYOUT_MODE) {
    return {
      layoutPlan,
      diagnostics: null,
    };
  }
  if (typeof getNodeSize !== "function") {
    throw new Error("sketchV1NodeSizingUnavailable");
  }

  const { nodes, haltNode } = createSharedHaltLayout(layoutPlan);
  const edges = layoutPlan.edges.map((edge) => {
    if (
      !isSketchStartEdge(edge) &&
      !isInstructionTarget(edge.targetIndex, layoutPlan.analysis.program.length)
    ) {
      return {
        ...edge,
        to: "halt",
        routeKind: edge.routeKind ?? "earlyExitToHalt",
      };
    }
    return edge;
  });
  const activePlan = {
    ...layoutPlan,
    nodes,
    edges,
    nodeMap: new Map(nodes.map((node) => [node.id, node])),
  };
  const instructionNodes = getInstructionNodes(activePlan);
  const instructionNodeLookup = buildInstructionNodeLookup(instructionNodes);
  const placement = runAdditiveNoFirstDfsPlacement({
    layoutPlan: activePlan,
    getNodeSize,
  });
  placeSharedHalt({
    haltNode,
    haltExitRows: placement.haltExitRows,
    layoutPlan: activePlan,
    getNodeSize,
    placement,
  });

  const ownershipByEdgeId = buildSketchOwnership(
    activePlan.analysis,
    placement.ownerByNodeId,
    instructionNodeLookup,
    edges,
  );
  const routedEdges = edges.map((edge) => {
    const reservedRoute = placement.edgeRouteByEdgeId.get(edge.id) ?? null;
    return {
      ...edge,
      sketchV1Ownership: ownershipByEdgeId.get(edge.id) ?? null,
      ...(reservedRoute ? { sketchV1ReservedRoute: reservedRoute } : {}),
    };
  });
  const {
    nodesMissingSketchFrame,
    invalidSketchCoordinates,
    coordinatesCommittedOnce,
  } = validateSketchCoordinates(activePlan, instructionNodes, placement.placedByNodeId);
  const ownershipRows = Array.from(ownershipByEdgeId.entries()).map(([edgeId, ownership]) => ({
    edgeId,
    ...ownership,
  }));
  const branchClassificationRows = buildSketchBranchClassificationRows({
    edges: routedEdges,
    placementRows: placement.placementRows,
    branchStopRows: placement.branchStopRows,
    spacingRows: placement.spacingAdjustmentRows,
    instructionCount: activePlan.analysis.program.length,
  });
  const edgeReservationCrossingRows = buildSketchEdgeReservationCrossingRows({
    edges: routedEdges,
    reservations: placement.ledger.reservations,
  });
  const drawnGeometryValidationRows = buildDrawnGeometryValidationRows(placement.drawnLedger);
  const diamondExitGrammarRows = buildDiamondExitGrammarRows({
    edges: routedEdges,
    drawnLedger: placement.drawnLedger,
    layout: activePlan.layout,
  });
  const sideOwnershipRows = buildSketchSideOwnershipRows({
    edges: routedEdges,
    placementRows: placement.placementRows,
    placedByNodeId: placement.placedByNodeId,
    instructionNodeLookup,
  });
  const splitDistanceDiagnostics = buildSplitDistanceRows(placement.edgeIntentRows);
  const alreadyPlacedNodeMoveRows = placement.placementRows.filter((row) => {
    if (!row.alreadyDrawn) return false;
    const placementRow = placement.placedByNodeId.get(row.nodeId);
    return Boolean(
      placementRow &&
      (placementRow.x !== row.x || placementRow.y !== row.y)
    );
  });
  const nodeBoxExistingEdgeRejectionRows = placement.drawnLedger.rejectionRows.filter((row) => (
    row.conflictKind === "node-vs-edge"
  ));
  const reservationOverlapRows = buildSketchReservationOverlapRows({
    reservations: placement.ledger.reservations,
    frames: placement.frames,
  });
  const illegalReservationOverlapRows = reservationOverlapRows.filter((row) => (
    row.classification === "illegal"
  ));
  const expectedReservationContainmentRows = reservationOverlapRows.filter((row) => (
    row.classification === "expectedContainment"
  ));
  const allowedReservationOverlapRows = reservationOverlapRows.filter((row) => (
    row.classification === "allowed"
  ));
  const rootFrame = placement.frames.find((frame) => frame.kind === "root") ?? null;
  const diagnostics = {
    sketchV1Enabled: true,
    sketchV1FallbackUsed: false,
    traversalEventCount: placement.traversalEvents.length,
    frameTreeDepth: rootFrame ? getFrameDepth(rootFrame.frameId, placement.frames) : 0,
    frameCount: placement.frames.length,
    recursiveFramePackingUsed: false,
    additiveRecursiveDfsUsed: true,
    globalRowCursorUsed: false,
    coordinatesCommittedOnce,
    nodesMissingSketchFrame,
    invalidSketchCoordinates,
    localBBoxSafetyChecksPassed: invalidSketchCoordinates.length === 0,
    broaderEnvelopeFallbackConsulted: false,
    pendingYesBranchStackUsed: placement.pendingYesStackRows.length > 0,
    haltExitCount: placement.haltExitRows.length,
    backwardEdgeCount: placement.backwardEdgeRows.length,
    sketchReservationCount: placement.ledger.reservationRows.length,
    sketchActiveReservationCount: placement.ledger.reservations.length,
    sketchReservationConflictCount: placement.ledger.conflictRows.length,
    sketchRawReservationOverlapCount: reservationOverlapRows.length,
    sketchAllowedReservationOverlapCount: allowedReservationOverlapRows.length,
    sketchExpectedReservationContainmentCount: expectedReservationContainmentRows.length,
    sketchTrueIllegalReservationConflictCount: illegalReservationOverlapRows.length,
    sketchReservationExpansionCount: placement.ledger.expansionRows.length,
    sketchEdgeReservationCrossingCount: edgeReservationCrossingRows.length,
    sketchDrawnGeometryLedgerCount: placement.drawnLedger.ledgerRows.length,
    sketchCandidatePlacementAttemptCount: placement.drawnLedger.candidateRows.length,
    sketchCandidateRejectionCount: placement.drawnLedger.rejectionRows.length,
    sketchCommittedEdgeSegmentCount: placement.drawnLedger.edgeSegments.length,
    sketchVisibleEdgeCrossesNodeBox: drawnGeometryValidationRows.edgeNodeCrossings.length > 0,
    sketchVisibleEdgeNodeBoxCrossingCount: drawnGeometryValidationRows.edgeNodeCrossings.length,
    sketchOrdinaryVisibleEdgeCrossesOrdinaryVisibleEdge:
      drawnGeometryValidationRows.ordinaryEdgeCrossings.length > 0,
    sketchOrdinaryVisibleEdgeCrossingCount:
      drawnGeometryValidationRows.ordinaryEdgeCrossings.length,
    sketchExactEdgeOverlapCount: drawnGeometryValidationRows.exactEdgeOverlapRows.length,
    sketchPartialEdgeOverlapCount: drawnGeometryValidationRows.partialEdgeOverlapRows.length,
    sketchNearParallelEdgeOverlapCount: drawnGeometryValidationRows.nearParallelEdgeOverlapRows.length,
    sketchOrdinaryForwardDiamondExitLShaped:
      diamondExitGrammarRows.some((row) => row.usesTurn),
    sketchAllOrdinaryForwardDiamondExitsStraightDownwardOutwardDiagonals:
      diamondExitGrammarRows.every((row) => row.straightDownwardOutwardDiagonal),
    sketchNoYesSideOwnershipPreservedForNewOrdinaryForwardSplits:
      sideOwnershipRows.every((row) => row.preservesSide),
    sketchNestedSplitDistancesDecreaseByDefault:
      splitDistanceDiagnostics.decreaseRows.every((row) => row.decreasesFromParentDefault),
    sketchAlreadyPlacedNodeMoved: alreadyPlacedNodeMoveRows.length > 0,
    sketchNodeBoxCrossesExistingEdgeDuringPlacement:
      nodeBoxExistingEdgeRejectionRows.length > 0,
    sketchNodeBoxExistingEdgePlacementRejectionCount:
      nodeBoxExistingEdgeRejectionRows.length,
    firstPassTopologyPreservingSpacingAdjustmentCount:
      placement.spacingAdjustmentRows.length,
    ...(includeVerboseDiagnostics ? {
      sketchFrameRows: buildSketchFrameRows(
        placement.frames,
        placement.placedByNodeId,
        getNodeSize,
        activePlan.layout,
      ),
      sketchTraversalRows: placement.traversalEvents,
      sketchOwnershipRows: ownershipRows,
      sketchDfsVisitRows: placement.dfsVisitRows,
      sketchPendingYesStackRows: placement.pendingYesStackRows,
      sketchBranchStopRows: placement.branchStopRows,
      sketchBranchClassificationRows: branchClassificationRows,
      sketchPlacementRows: placement.placementRows,
      sketchHaltExitRows: placement.haltExitRows,
      sketchBackwardEdgeRows: placement.backwardEdgeRows,
      sketchSpacingAdjustmentRows: placement.spacingAdjustmentRows,
      sketchEdgeIntentRows: placement.edgeIntentRows,
      sketchDrawnGeometryLedgerRows: placement.drawnLedger.ledgerRows,
      sketchDrawnNodeBoxRows: placement.drawnLedger.nodeBoxes,
      sketchDrawnEdgeSegmentRows: placement.drawnLedger.edgeSegments,
      sketchCandidatePlacementRows: placement.drawnLedger.candidateRows,
      sketchCandidateRejectionRows: placement.drawnLedger.rejectionRows,
      sketchCommittedEdgeSegmentRows: placement.drawnLedger.committedEdgeRows,
      sketchDrawnEdgeNodeBoxCrossingRows: drawnGeometryValidationRows.edgeNodeCrossings,
      sketchDrawnOrdinaryEdgeCrossingRows: drawnGeometryValidationRows.ordinaryEdgeCrossings,
      sketchExactEdgeOverlapRows: drawnGeometryValidationRows.exactEdgeOverlapRows,
      sketchPartialEdgeOverlapRows: drawnGeometryValidationRows.partialEdgeOverlapRows,
      sketchNearParallelEdgeOverlapRows: drawnGeometryValidationRows.nearParallelEdgeOverlapRows,
      sketchDiamondExitGrammarRows: diamondExitGrammarRows,
      sketchNoYesSideOwnershipRows: sideOwnershipRows,
      sketchSplitDistanceRows: splitDistanceDiagnostics.rows,
      sketchSplitDistanceDecreaseRows: splitDistanceDiagnostics.decreaseRows,
      sketchAlreadyPlacedNodeMoveRows: alreadyPlacedNodeMoveRows,
      sketchNodeBoxExistingEdgePlacementRejectionRows:
        nodeBoxExistingEdgeRejectionRows,
      sketchBackwardRoutingDecisionRows: placement.drawnLedger.backwardRoutingRows,
      sketchFinalHaltRoutingRows: placement.drawnLedger.haltRoutingRows,
      sketchReservationRows: placement.ledger.reservationRows,
      sketchActiveReservationRows: placement.ledger.reservations,
      sketchReservationConflictRows: placement.ledger.conflictRows,
      sketchRawReservationOverlapRows: reservationOverlapRows,
      sketchAllowedReservationOverlapRows: allowedReservationOverlapRows,
      sketchExpectedReservationContainmentRows: expectedReservationContainmentRows,
      sketchTrueIllegalReservationConflictRows: illegalReservationOverlapRows,
      sketchAttemptedRawReservationOverlapRows: placement.ledger.rawOverlapRows,
      sketchAttemptedAllowedReservationOverlapRows: placement.ledger.allowedOverlapRows,
      sketchReservationExpansionRows: placement.ledger.expansionRows,
      sketchLoopCorridorRows: placement.loopCorridorRows,
      sketchHaltCorridorRows: placement.haltCorridorRows,
      sketchEdgeReservationCrossingRows: edgeReservationCrossingRows,
      sketchAdditiveDfsParameters: placement.params,
    } : {}),
  };

  if (
    nodesMissingSketchFrame.length > 0 ||
    invalidSketchCoordinates.length > 0 ||
    !coordinatesCommittedOnce
  ) {
    throw new Error("sketchV1AdditiveDfsGeometryValidationFailed");
  }

  return {
    layoutPlan: {
      ...activePlan,
      nodes: activePlan.nodes,
      nodeMap: new Map(activePlan.nodes.map((node) => [node.id, node])),
      edges: routedEdges,
      sketchV1PlacementDebug: diagnostics,
    },
    diagnostics,
  };
}
