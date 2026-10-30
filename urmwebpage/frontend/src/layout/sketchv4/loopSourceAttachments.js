// SketchV4 Layer D — generalized backward-loop source attachment.
//
// Loop-return routing already owns the rail, bend row, and target attachment. This layer
// classifies only the route's existing source departure:
//   - vertical-first from a rectangle side -> bottom-center, then down to the same bend row;
//   - lateral-first outward from a rectangle side -> preserve the route byte-for-byte.
//
// The selector is deliberately semantic and local. It uses the loop-return edge role, the
// source rectangle, and the already-routed departure shape; it contains no fixture, edge-ID,
// instruction-index, terminal-identity, or frozen-coordinate cases.

import { validateEdgeAttachments } from "./attachmentStubs.js";

const EPSILON = 1e-9;
const same = (a, b) => Math.abs(a - b) <= EPSILON;
const copyPoint = (point) => [...point];
const copyPoints = (points) => points.map(copyPoint);

function fail(message) {
  throw new Error(`SketchV4 loop-source attachment invariant failed: ${message}`);
}

function attachmentLegality(record) {
  return {
    source: record.source.legal,
    target: record.target.legal,
    overall: record.legal,
  };
}

function rectangleSourceSide(sourcePort, sourceBox) {
  if (same(sourcePort[0], sourceBox.left)) return "left";
  if (same(sourcePort[0], sourceBox.right)) return "right";
  return null;
}

export function applyGeneralizedLoopSourceAttachments(cfg, roles, routed, boxes) {
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
      fail(`cannot classify loop source for ${baselineRoute.edgeId}`);
    }
    if (roles.edgeRoleById.get(edge.id) !== "loop-return"
      || edge.from !== baselineRoute.source
      || edge.to !== baselineRoute.target) {
      fail(`${baselineRoute.edgeId} does not preserve its loop-return semantics`);
    }
    if (sourceNode.kind !== "action" && sourceNode.kind !== "unconditionalJump") {
      fail(`${baselineRoute.edgeId} does not leave a rectangular instruction node`);
    }
    if (baselineRoute.points.length < 3) {
      fail(`${baselineRoute.edgeId} has no classifiable loop departure`);
    }

    const oldSourcePort = copyPoint(baselineRoute.sourcePort);
    const targetPort = copyPoint(baselineRoute.targetPort);
    const oldPoints = copyPoints(baselineRoute.points);
    if (JSON.stringify(oldPoints[0]) !== JSON.stringify(oldSourcePort)) {
      fail(`${baselineRoute.edgeId} route does not begin at its recorded source port`);
    }

    const sourceSide = rectangleSourceSide(oldSourcePort, sourceBox);
    if (!sourceSide) {
      fail(`${baselineRoute.edgeId} does not begin at a rectangle side port`);
    }

    const [first, second, third] = oldPoints;
    const verticalFirst = same(first[0], second[0])
      && second[1] > first[1] + EPSILON
      && same(second[1], third[1])
      && !same(second[0], third[0]);
    const outwardDirection = sourceSide === "left" ? -1 : 1;
    const lateralFirst = same(first[1], second[1])
      && (second[0] - first[0]) * outwardDirection > EPSILON;
    if (!verticalFirst && !lateralFirst) {
      fail(`${baselineRoute.edgeId} is neither vertical-first nor legal outward lateral-first`);
    }

    const bodyClassification = verticalFirst ? "vertical-first" : "lateral-first";
    const bendRow = verticalFirst ? second[1] : first[1];
    const sourcePort = verticalFirst ? [sourceBox.cx, sourceBox.bottom] : oldSourcePort;
    const points = verticalFirst ? [
      sourcePort,
      [sourcePort[0], bendRow],
      ...oldPoints.slice(2).map(copyPoint),
    ] : oldPoints;
    const route = verticalFirst ? {
      ...baselineRoute,
      sourcePort,
      targetPort,
      points,
    } : baselineRoute;

    routeById.set(baselineRoute.edgeId, route);
    if (verticalFirst) {
      ports.set(baselineRoute.edgeId, {
        ...baselinePort,
        sourcePort,
        changed: true,
        experimentalGeneralizedBottomSourcePort: true,
      });
    }

    const oldAttachment = validateEdgeAttachments(
      baselineRoute,
      sourceNode,
      targetNode,
      oldPoints,
      { sourceBox, targetBox },
    );
    const newAttachment = validateEdgeAttachments(
      route,
      sourceNode,
      targetNode,
      points,
      { sourceBox, targetBox },
    );
    records.push({
      edgeId: baselineRoute.edgeId,
      source: edge.from,
      target: edge.to,
      existingSourceSide: sourceSide,
      existingSourcePort: oldSourcePort,
      bodyClassification,
      resultingSourceSide: verticalFirst ? "bottom" : sourceSide,
      resultingSourcePort: sourcePort,
      bendRow,
      railCoord: baselineRoute.railCoord,
      targetPort,
      oldTargetPortRecord: copyPoint(baselinePort.targetPort),
      newTargetPortRecord: copyPoint(ports.get(baselineRoute.edgeId).targetPort),
      oldRoutePoints: oldPoints,
      newRoutePoints: points,
      sourceAttachmentRule: verticalFirst
        ? "bottom-center port, then vertical downward to unchanged loop bend row"
        : `unchanged ${sourceSide} port and existing outward horizontal departure`,
      outwardDeparture: lateralFirst ? [first, second] : null,
      routeChanged: verticalFirst,
      preservedRouteSuffix: verticalFirst
        ? oldPoints.slice(2).map(copyPoint)
        : oldPoints.slice(1).map(copyPoint),
      oldAttachmentLegality: attachmentLegality(oldAttachment),
      newAttachmentLegality: attachmentLegality(newAttachment),
    });
  }

  return {
    routed: {
      ...routed,
      routes: routed.routes.map((route) => routeById.get(route.edgeId)),
      ports,
    },
    records,
    consideredEdgeIds: records.map((record) => record.edgeId),
    changedEdgeIds: records.filter((record) => record.routeChanged).map((record) => record.edgeId),
    contract: {
      selector: "loop-return role plus existing rectangle-side departure shape",
      verticalFirstRule: "bottom-center, then vertical down to the unchanged loop bend row",
      lateralFirstRule: "preserve an existing outward horizontal departure byte-for-byte",
      fixtureIdentityUsed: false,
      edgeIdentityUsed: false,
      instructionIndexUsed: false,
      terminalIdentityUsed: false,
      frozenCoordinatesUsed: false,
      loopReturnRailsChanged: false,
      loopBendRowsChanged: false,
      targetPortSelectionChanged: false,
      targetEntryGeometryChanged: false,
      nodePositionsChanged: false,
      orientationPolicyChanged: false,
      nonLoopRoutesChanged: false,
      automaticRepairAfterConstruction: false,
      obstacleSearchUsed: false,
    },
  };
}
