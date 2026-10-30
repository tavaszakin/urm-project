// SketchV4 local attachment-stub grammar.
//
// This module is diagnostic-only. It classifies the first/last incident segment of a
// completed route against a finite local grammar:
//   node shape + named port + incident direction + edge role.
// It performs no routing, no candidate search, and has no feedback path into layout.

const PORT_EPSILON = 1.25;
const AXIS_EPSILON = 0.75;

const DIAMOND_PORTS = [
  { portName: "top", pointOf: (b) => [b.cx, b.top], incidentDirection: "north" },
  { portName: "bottom", pointOf: (b) => [b.cx, b.bottom], incidentDirection: "south" },
  { portName: "left", pointOf: (b) => [b.left, b.cy], incidentDirection: "west" },
  { portName: "right", pointOf: (b) => [b.right, b.cy], incidentDirection: "east" },
  { portName: "upper-left", pointOf: (b) => [(b.left + b.cx) / 2, (b.top + b.cy) / 2], incidentDirection: "north-west" },
  { portName: "upper-right", pointOf: (b) => [(b.cx + b.right) / 2, (b.top + b.cy) / 2], incidentDirection: "north-east" },
  { portName: "lower-left", pointOf: (b) => [(b.left + b.cx) / 2, (b.cy + b.bottom) / 2], incidentDirection: "south-west" },
  { portName: "lower-right", pointOf: (b) => [(b.cx + b.right) / 2, (b.cy + b.bottom) / 2], incidentDirection: "south-east" },
];

const RECTANGLE_PORTS = [
  { portName: "top", pointOf: (b) => [b.cx, b.top], incidentDirection: "north" },
  { portName: "bottom", pointOf: (b) => [b.cx, b.bottom], incidentDirection: "south" },
  { portName: "left", pointOf: (b) => [b.left, b.cy], incidentDirection: "west" },
  { portName: "right", pointOf: (b) => [b.right, b.cy], incidentDirection: "east" },
];

const TERMINAL_PORTS = [
  ...RECTANGLE_PORTS,
  {
    portName: "left-edge",
    incidentDirection: "west",
    roleConstraints: { endpoints: ["target"], edgeRoles: ["halt-exit"] },
    matchesPort: (point, b) => onVerticalEdge(point, b.left, b),
  },
  {
    portName: "right-edge",
    incidentDirection: "east",
    roleConstraints: { endpoints: ["source"], edgeRoles: ["halt-exit"] },
    matchesPort: (point, b) => onVerticalEdge(point, b.right, b),
  },
];

function distance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function within(a, b, epsilon = PORT_EPSILON) {
  return distance(a, b) <= epsilon;
}

function onVerticalEdge(point, x, box) {
  if (!Array.isArray(point) || !box) return false;
  return Math.abs(point[0] - x) <= PORT_EPSILON &&
    point[1] >= box.top - PORT_EPSILON &&
    point[1] <= box.bottom + PORT_EPSILON;
}

function onHorizontalEdge(point, y, box) {
  if (!Array.isArray(point) || !box) return false;
  return Math.abs(point[1] - y) <= PORT_EPSILON &&
    point[0] >= box.left - PORT_EPSILON &&
    point[0] <= box.right + PORT_EPSILON;
}

function rectangleEdgeName(point, box) {
  if (!Array.isArray(point) || !box) return "unknown";
  const nearLeft = onVerticalEdge(point, box.left, box);
  const nearRight = onVerticalEdge(point, box.right, box);
  const nearTop = onHorizontalEdge(point, box.top, box);
  const nearBottom = onHorizontalEdge(point, box.bottom, box);
  if (nearTop && nearLeft) return "top-left-corner";
  if (nearTop && nearRight) return "top-right-corner";
  if (nearBottom && nearLeft) return "bottom-left-corner";
  if (nearBottom && nearRight) return "bottom-right-corner";
  if (nearTop) return "top-edge";
  if (nearBottom) return "bottom-edge";
  if (nearLeft) return "left-edge";
  if (nearRight) return "right-edge";
  return "unknown";
}

function materializeStub(stub, box) {
  return {
    nodeShape: stub.nodeShape,
    portName: stub.portName,
    portPoint: typeof stub.pointOf === "function" ? stub.pointOf(box) : null,
    incidentDirection: stub.incidentDirection,
    roleConstraints: stub.roleConstraints ?? null,
    matchesPort: stub.matchesPort ?? null,
  };
}

export function getSketchV4NodeShape(node) {
  const kind = node?.kind;
  if (kind === "conditionalJump") return "diamond";
  if (kind === "start" || kind === "halt") return "terminal";
  return "rectangle";
}

export function getLegalIncidentStubsForNode(node, context = {}) {
  const box = context.box ?? node?.box ?? null;
  if (!box) return [];
  const nodeShape = getSketchV4NodeShape(node);
  const base =
    nodeShape === "diamond" ? DIAMOND_PORTS :
      nodeShape === "terminal" ? TERMINAL_PORTS :
        RECTANGLE_PORTS;
  return base.map((stub) => materializeStub({ ...stub, nodeShape }, box));
}

export function inferIncidentDirection(portPoint, adjacentPoint) {
  if (!Array.isArray(portPoint) || !Array.isArray(adjacentPoint)) return "unknown";
  const dx = adjacentPoint[0] - portPoint[0];
  const dy = adjacentPoint[1] - portPoint[1];
  if (Math.abs(dx) <= AXIS_EPSILON && Math.abs(dy) <= AXIS_EPSILON) return "zero";
  if (Math.abs(dx) <= AXIS_EPSILON) return dy < 0 ? "north" : "south";
  if (Math.abs(dy) <= AXIS_EPSILON) return dx < 0 ? "west" : "east";
  const vertical = dy < 0 ? "north" : "south";
  const horizontal = dx < 0 ? "west" : "east";
  return `${vertical}-${horizontal}`;
}

function roleConstraintsMatch(roleConstraints, endpoint, edgeRole) {
  if (!roleConstraints) return true;
  if (Array.isArray(roleConstraints.endpoints) && !roleConstraints.endpoints.includes(endpoint)) {
    return false;
  }
  if (Array.isArray(roleConstraints.edgeRoles) && !roleConstraints.edgeRoles.includes(edgeRole)) {
    return false;
  }
  return true;
}

function identifyPort(node, box, portPoint, stubs) {
  if (!Array.isArray(portPoint) || !box) {
    return { portName: "missing", portPoint: null, legalPort: false };
  }

  let best = null;
  for (const stub of stubs) {
    const matches = typeof stub.matchesPort === "function"
      ? stub.matchesPort(portPoint, box)
      : within(portPoint, stub.portPoint);
    if (!matches) continue;
    const d = stub.portPoint ? distance(portPoint, stub.portPoint) : 0;
    if (!best || d < best.distance) {
      best = { portName: stub.portName, portPoint, legalPort: true, distance: d };
    }
  }
  if (best) {
    return { portName: best.portName, portPoint: best.portPoint, legalPort: true };
  }

  const shape = getSketchV4NodeShape(node);
  const portName = shape === "diamond" ? "unknown" : rectangleEdgeName(portPoint, box);
  return { portName, portPoint, legalPort: false };
}

function validateAttachment({ edge, node, box, routePoints, endpoint }) {
  const edgeRole = edge?.edgeRole ?? edge?.role ?? null;
  const pointIndex = endpoint === "source" ? 0 : routePoints.length - 1;
  const adjacentIndex = endpoint === "source" ? 1 : routePoints.length - 2;
  const portPoint = routePoints[pointIndex] ?? null;
  const adjacentPoint = routePoints[adjacentIndex] ?? null;
  const shape = getSketchV4NodeShape(node);
  const stubs = getLegalIncidentStubsForNode(node, { box });
  const port = identifyPort(node, box, portPoint, stubs);
  const incidentDirection = inferIncidentDirection(portPoint, adjacentPoint);
  const legalStub = stubs.find((stub) => {
    const samePort = typeof stub.matchesPort === "function"
      ? stub.matchesPort(portPoint, box)
      : port.portName === stub.portName;
    return samePort &&
      stub.incidentDirection === incidentDirection &&
      roleConstraintsMatch(stub.roleConstraints, endpoint, edgeRole);
  });

  let reason = null;
  if (!port.legalPort) {
    reason = `no legal ${shape} port named ${port.portName}`;
  } else if (!legalStub) {
    const allowedDirections = stubs
      .filter((stub) => {
        const samePort = typeof stub.matchesPort === "function"
          ? stub.matchesPort(portPoint, box)
          : port.portName === stub.portName;
        return samePort && roleConstraintsMatch(stub.roleConstraints, endpoint, edgeRole);
      })
      .map((stub) => stub.incidentDirection);
    const allowedText = allowedDirections.length ? allowedDirections.join(", ") : "none for this edge role";
    reason = `legal port ${port.portName}, illegal incident direction ${incidentDirection}; expected ${allowedText}`;
  }

  return {
    nodeId: node?.id ?? null,
    nodeType: node?.kind ?? null,
    nodeShape: shape,
    portName: port.portName,
    portPoint: port.portPoint,
    adjacentPoint,
    incidentDirection,
    legal: !reason,
    reason,
  };
}

export function validateSourceAttachment(edge, sourceNode, routePoints, context = {}) {
  return validateAttachment({
    edge,
    node: sourceNode,
    box: context.sourceBox ?? context.box ?? sourceNode?.box ?? null,
    routePoints: Array.isArray(routePoints) ? routePoints : [],
    endpoint: "source",
  });
}

export function validateTargetAttachment(edge, targetNode, routePoints, context = {}) {
  return validateAttachment({
    edge,
    node: targetNode,
    box: context.targetBox ?? context.box ?? targetNode?.box ?? null,
    routePoints: Array.isArray(routePoints) ? routePoints : [],
    endpoint: "target",
  });
}

export function validateEdgeAttachments(edge, sourceNode, targetNode, routePoints, context = {}) {
  const points = Array.isArray(routePoints) ? routePoints : [];
  const source = validateSourceAttachment(edge, sourceNode, points, {
    sourceBox: context.sourceBox,
  });
  const target = validateTargetAttachment(edge, targetNode, points, {
    targetBox: context.targetBox,
  });
  return {
    edgeId: edge?.edgeId ?? edge?.id ?? null,
    edgeRole: edge?.edgeRole ?? edge?.role ?? null,
    routeFamily: edge?.routeFamily ?? null,
    source,
    target,
    legal: source.legal && target.legal,
  };
}
