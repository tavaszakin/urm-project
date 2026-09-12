// SketchV4 Layer E — generalized backward-loop target attachment.
//
// Legal loop targets are immutable controls. For an illegal target, candidate endpoints
// come only from intersections between the existing directed orthogonal approach segment
// and the target shape's declared diagonal incident-port rays. The route changes only when
// exactly one candidate validates against the local attachment grammar.
//
// This is deliberately a local semantic rule: no fixture, edge ID, instruction index,
// target ID, frozen coordinate, scoring result, obstacle search, or pathfinding participates.

import {
  getLegalIncidentStubsForNode,
  validateEdgeAttachments,
} from "./attachmentStubs.js";

const EPSILON = 1e-9;
const copyPoint = (point) => [...point];
const copyPoints = (points) => points.map(copyPoint);

function fail(message) {
  throw new Error(`SketchV4 loop-target attachment invariant failed: ${message}`);
}

function classifyApproach(start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (Math.abs(dy) <= EPSILON && Math.abs(dx) > EPSILON) return { orientation: "horizontal", dx, dy };
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) > EPSILON) return { orientation: "vertical", dx, dy };
  return { orientation: null, dx, dy };
}

function inspectPortRay({
  stub,
  targetBox,
  approachStart,
  approach,
  oldPoints,
  baselineRoute,
  sourceNode,
  targetNode,
  sourceBox,
}) {
  const port = copyPoint(stub.portPoint);
  const rayVector = [port[0] - targetBox.cx, port[1] - targetBox.cy];
  let rayParameter = null;
  let intersection = null;
  if (approach.orientation === "horizontal" && Math.abs(rayVector[1]) > EPSILON) {
    rayParameter = (approachStart[1] - port[1]) / rayVector[1];
    intersection = [port[0] + rayParameter * rayVector[0], approachStart[1]];
  } else if (approach.orientation === "vertical" && Math.abs(rayVector[0]) > EPSILON) {
    rayParameter = (approachStart[0] - port[0]) / rayVector[0];
    intersection = [approachStart[0], port[1] + rayParameter * rayVector[1]];
  }

  let approachParameter = null;
  if (intersection) {
    approachParameter = approach.orientation === "horizontal"
      ? (intersection[0] - approachStart[0]) / approach.dx
      : (intersection[1] - approachStart[1]) / approach.dy;
  }
  const rayPointsOutward = rayParameter != null && rayParameter > EPSILON;
  const intersectionOnDirectedSegment = approachParameter != null
    && approachParameter > EPSILON
    && approachParameter <= 1 + EPSILON;
  const proposedPoints = rayPointsOutward && intersectionOnDirectedSegment
    ? [...oldPoints.slice(0, -2).map(copyPoint), intersection, port]
    : null;
  const validation = proposedPoints
    ? validateEdgeAttachments(
      { ...baselineRoute, targetPort: port, points: proposedPoints },
      sourceNode,
      targetNode,
      proposedPoints,
      { sourceBox, targetBox },
    )
    : null;
  const compatible = proposedPoints != null
    && validation?.target?.legal === true
    && validation.target.portName === stub.portName
    && validation.target.incidentDirection === stub.incidentDirection;
  return {
    portName: stub.portName,
    port,
    incidentDirection: stub.incidentDirection,
    rayVector,
    rayParameter,
    intersection,
    approachParameter,
    rayPointsOutward,
    intersectionOnDirectedSegment,
    resultingTargetLegal: validation?.target?.legal ?? null,
    resultingTargetIncidentDirection: validation?.target?.incidentDirection ?? null,
    compatible,
    proposedPoints,
  };
}

export function applyGeneralizedLoopTargetAttachments(cfg, roles, routed, boxes) {
  const routeById = new Map(routed.routes.map((route) => [route.edgeId, route]));
  const ports = new Map(routed.ports);
  const records = [];
  const loopRoutes = routed.routes.filter((route) => route.edgeRole === "loop-return");

  for (const baselineRoute of loopRoutes) {
    const edge = cfg.edgeById.get(baselineRoute.edgeId);
    const sourceNode = cfg.nodeById.get(edge?.from);
    const targetNode = cfg.nodeById.get(edge?.to);
    const sourceBox = boxes.get(edge?.from);
    const targetBox = boxes.get(edge?.to);
    const baselinePort = ports.get(baselineRoute.edgeId);
    if (!edge || !sourceNode || !targetNode || !sourceBox || !targetBox || !baselinePort) {
      fail(`cannot classify loop target for ${baselineRoute.edgeId}`);
    }
    if (roles.edgeRoleById.get(edge.id) !== "loop-return"
      || edge.from !== baselineRoute.source
      || edge.to !== baselineRoute.target) {
      fail(`${baselineRoute.edgeId} does not preserve its loop-return semantics`);
    }

    const oldPoints = copyPoints(baselineRoute.points);
    const oldTargetPort = copyPoint(baselineRoute.targetPort);
    const oldSourcePort = copyPoint(baselineRoute.sourcePort);
    const oldPortRecord = {
      sourcePort: copyPoint(baselinePort.sourcePort),
      targetPort: copyPoint(baselinePort.targetPort),
    };
    const oldAttachment = validateEdgeAttachments(
      baselineRoute,
      sourceNode,
      targetNode,
      oldPoints,
      { sourceBox, targetBox },
    );
    let route = baselineRoute;
    let outcome = "unchanged-already-legal";
    let approachOrientation = null;
    let approachStart = null;
    let approachEnd = null;
    let inspectedPortRays = [];
    let compatibleCandidates = [];

    if (!oldAttachment.target.legal) {
      outcome = "unchanged-no-compatible-port";
      if (oldPoints.length >= 3) {
        approachStart = copyPoint(oldPoints[oldPoints.length - 3]);
        approachEnd = copyPoint(oldPoints[oldPoints.length - 2]);
        const approach = classifyApproach(approachStart, approachEnd);
        approachOrientation = approach.orientation;
        if (approachOrientation) {
          inspectedPortRays = getLegalIncidentStubsForNode(targetNode, { box: targetBox })
            .filter((stub) => stub.portPoint && stub.incidentDirection.includes("-"))
            .map((stub) => inspectPortRay({
              stub,
              targetBox,
              approachStart,
              approach,
              oldPoints,
              baselineRoute,
              sourceNode,
              targetNode,
              sourceBox,
            }));
          compatibleCandidates = inspectedPortRays.filter((candidate) => candidate.compatible);
        }
      }

      if (compatibleCandidates.length === 1) {
        const selected = compatibleCandidates[0];
        route = {
          ...baselineRoute,
          targetPort: copyPoint(selected.port),
          points: copyPoints(selected.proposedPoints),
        };
        routeById.set(baselineRoute.edgeId, route);
        ports.set(baselineRoute.edgeId, {
          ...baselinePort,
          targetPort: copyPoint(selected.port),
          changed: true,
          experimentalGeneralizedTargetPort: true,
          experimentalTargetRayIntersection: copyPoint(selected.intersection),
        });
        outcome = "generalized-unique-compatible-port";
      } else if (compatibleCandidates.length > 1) {
        outcome = "unchanged-ambiguous-compatible-ports";
      }
    }

    const newAttachment = validateEdgeAttachments(
      route,
      sourceNode,
      targetNode,
      route.points,
      { sourceBox, targetBox },
    );
    const newPortRecord = ports.get(baselineRoute.edgeId);
    records.push({
      edgeId: baselineRoute.edgeId,
      source: edge.from,
      target: edge.to,
      currentTargetPort: oldTargetPort,
      currentTargetPortName: oldAttachment.target.portName,
      currentTargetLegal: oldAttachment.target.legal,
      outcome,
      routeChanged: route !== baselineRoute,
      candidateCount: compatibleCandidates.length,
      candidateNamedPort: compatibleCandidates.length === 1 ? compatibleCandidates[0].portName : null,
      candidateIncidentDirection: compatibleCandidates.length === 1 ? compatibleCandidates[0].incidentDirection : null,
      intersection: compatibleCandidates.length === 1 ? copyPoint(compatibleCandidates[0].intersection) : null,
      approachOrientation,
      approachStart,
      approachEnd,
      inspectedPortRays,
      oldRouteSuffix: oldPoints.slice(-3).map(copyPoint),
      newRouteSuffix: route.points.slice(-3).map(copyPoint),
      oldRoutePoints: oldPoints,
      newRoutePoints: copyPoints(route.points),
      railCoord: baselineRoute.railCoord,
      routeFamily: baselineRoute.routeFamily,
      laneBundleId: baselineRoute.laneBundleId,
      sourcePort: oldSourcePort,
      oldSourcePortRecord: oldPortRecord.sourcePort,
      newSourcePortRecord: copyPoint(newPortRecord.sourcePort),
      oldTargetPortRecord: oldPortRecord.targetPort,
      newTargetPortRecord: copyPoint(newPortRecord.targetPort),
      resultingTargetPort: copyPoint(newAttachment.target.portPoint),
      resultingTargetPortName: newAttachment.target.portName,
      resultingTargetIncidentDirection: newAttachment.target.incidentDirection,
      resultingTargetLegal: newAttachment.target.legal,
      resultingOverallAttachmentLegal: newAttachment.legal,
    });
  }

  const changedEdgeIds = records.filter((record) => record.routeChanged).map((record) => record.edgeId);
  const ambiguousEdgeIds = records
    .filter((record) => record.outcome === "unchanged-ambiguous-compatible-ports")
    .map((record) => record.edgeId);
  const noCandidateEdgeIds = records
    .filter((record) => record.outcome === "unchanged-no-compatible-port")
    .map((record) => record.edgeId);
  const unexpectedlyChangedLegalEdgeIds = records
    .filter((record) => record.currentTargetLegal && record.routeChanged)
    .map((record) => record.edgeId);

  return {
    routed: {
      ...routed,
      routes: routed.routes.map((route) => routeById.get(route.edgeId)),
      ports,
    },
    records,
    consideredEdgeIds: records.map((record) => record.edgeId),
    changedEdgeIds,
    ambiguousEdgeIds,
    noCandidateEdgeIds,
    unexpectedlyChangedLegalEdgeIds,
    contract: {
      selector: "illegal loop-return target with exactly one compatible declared diagonal incident-port ray",
      candidateRule: "intersect declared target ray with the existing directed orthogonal approach segment",
      legalTargetRule: "preserve byte-for-byte",
      fixtureIdentityUsed: false,
      edgeIdentityUsed: false,
      instructionIndexUsed: false,
      targetIdentityUsed: false,
      frozenCoordinatesUsed: false,
      fixedLengthTargetStubUsed: false,
      crossingOrDefectScoreUsedForSelection: false,
      obstacleOrClearanceSearchUsedForSelection: false,
      sourcePortsChanged: false,
      sourceGeometryChanged: false,
      loopReturnRailsChanged: false,
      loopBendRowsChanged: false,
      nodePositionsChanged: false,
      orientationPolicyChanged: false,
      nonLoopRoutesChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}
