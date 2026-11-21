// SVG y increases downward. Measure CCW angles from screen-right.
const turn = 2 * Math.PI;
const normalize = (angle) => angle < 0 ? angle + turn : angle;
export const counterclockwiseAngle = (dx, dy) => normalize(Math.atan2(-dy, dx));
const pointKey = (p) => p.join(",");
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const between = (p, a, b) => p.every((v, axis) => Math.min(a[axis], b[axis]) <= v && v <= Math.max(a[axis], b[axis]));
const delta = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

const floatBits = new DataView(new ArrayBuffer(8));
function dyadic(number) {
  floatBits.setFloat64(0, number);
  const bits = floatBits.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponent ? fraction | (1n << 52n) : fraction;
  return [bits >> 63n ? -mantissa : mantissa, exponent ? exponent - 1075 : -1074];
}

// Use the stored binary coordinates literally. A rounded determinant can be
// inconclusive near a diagonal, where an epsilon could invent a junction.
function orientation(a, b, c) {
  if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])
    || samePoint(a, c) || samePoint(b, c)) return 0;
  const [x, y] = delta(b, a);
  const [u, v] = delta(c, a);
  const left = x * v, right = y * u;
  const det = left - right;
  if (Number.isFinite(det) && Math.abs(det) > 8 * Number.EPSILON * (Math.abs(left) + Math.abs(right))
    && Math.abs(det) >= 2 ** -1022) return Math.sign(det);
  const parts = [...a, ...b, ...c].map(dyadic);
  const exponent = Math.min(...parts.map(([, exp]) => exp));
  const [ax, ay, bx, by, cx, cy] = parts.map(([value, exp]) => value << BigInt(exp - exponent));
  const exact = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

function segmentContact({ a, b }, { a: c, b: d }) {
  if (a.some((_, axis) => Math.max(a[axis], b[axis]) < Math.min(c[axis], d[axis])
    || Math.max(c[axis], d[axis]) < Math.min(a[axis], b[axis]))) return null;
  const ac = orientation(a, b, c), ad = orientation(a, b, d);
  const ca = orientation(c, d, a), cb = orientation(c, d, b);
  if (ac * ad < 0 && ca * cb < 0) return { crossing: true };
  const points = new Map();
  for (const [sign, p, start, end] of [[ac, c, a, b], [ad, d, a, b], [ca, a, c, d], [cb, b, c, d]]) {
    if (!sign && between(p, start, end)) points.set(pointKey(p), p);
  }
  return points.size ? { points: [...points.values()] } : null;
}

function terminalRun({ points }) {
  const end = points.at(-1);
  let first = points.length - 2;
  while (first && !orientation(points[first - 1], points[first], end)
    && between(points[first], points[first - 1], end)) first -= 1;
  return first;
}

function permittedSuffix(first, second) {
  if (!second.route.sharedTerminalApproach || first.route.targetInstruction !== second.route.targetInstruction) return null;
  const end = first.route.points.at(-1);
  if (!samePoint(end, second.route.points.at(-1))) return null;
  const a = first.route.points[first.tail], b = second.route.points[second.tail];
  if (orientation(a, end, b)) return null;
  const join = between(a, b, end) ? a : between(b, a, end) ? b : null;
  if (!join || samePoint(join, first.route.points[0]) || samePoint(join, second.route.points[0])) return null;
  return { join, end };
}

function bodyEndpoint(segment, p) {
  const { route, index } = segment;
  if (index === 0 && samePoint(p, segment.a)) return route.sourceInstruction;
  if (index === route.points.length - 2 && samePoint(p, segment.b)) return route.targetInstruction;
  return null;
}

function shareContact(first, second, points, suffix) {
  if (!suffix || !points.every((p) => between(p, suffix.join, suffix.end))) return false;
  const firstTail = first.index >= first.tail, secondTail = second.index >= second.tail;
  if (firstTail && secondTail) return true;
  if (points.length !== 1 || !samePoint(points[0], suffix.join)) return false;
  return (firstTail || (first.index === first.tail - 1 && samePoint(first.b, suffix.join)))
    && (secondTail || (second.index === second.tail - 1 && samePoint(second.b, suffix.join)));
}

function bodyPolygon({ box: b, kind }) {
  return kind === "conditionalJump"
    ? [[b.cx, b.top], [b.right, b.cy], [b.cx, b.bottom], [b.left, b.cy]]
    : [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
}

// Check body contacts separately from stroke joining. The body tolerance
// accommodates the constructor's floating-point diamond coordinates. Only
// exact coordinates ever identify two attachments or join two strokes.
function bodyContact(segment, polygon) {
  let low = 0, high = 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const side = delta(b, a);
    const change = cross(side, delta(segment.b, segment.a));
    const start = cross(side, delta(segment.a, a));
    if (Math.abs(change) <= 1e-9) {
      if (start < -1e-9) return null;
    } else {
      const cut = -start / change;
      if (change > 0) low = Math.max(low, cut);
      else high = Math.min(high, cut);
      if (low > high + 1e-9) return null;
    }
  }
  return [low, high];
}

const bodyId = (id) => "body:" + id;
const routingId = (p) => "routing:" + pointKey(p);
const unsupported = (code, details) => ({
  embeddingStatus: "unavailable", obstruction: { code, ...details },
  embeddedVertices: [], embeddedEdges: [], logicalEdgePaths: [], darts: [], exteriorReference: null,
});

function exteriorCorner(vertices, incidence) {
  let top = null;
  for (const vertex of vertices.values()) {
    const point = vertex.top ?? vertex.position;
    if (!top || point[1] < top.point[1]) top = { vertex, point };
  }
  if (!top) return null;
  const { vertex, point } = top;
  const ring = incidence.get(vertex.embeddedVertexId);
  if (!ring.length) return { kind: "isolated-vertex", embeddedVertexId: vertex.embeddedVertexId, point };
  const next = ring.findIndex(({ positionAngle, fanAngle }) =>
    positionAngle > Math.PI / 2 || (positionAngle === Math.PI / 2 && fanAngle > 0));
  const outgoing = ring[next === -1 ? 0 : next];
  const preceding = ring.at(next <= 0 ? -1 : next - 1);
  return { kind: "corner", embeddedVertexId: vertex.embeddedVertexId, point,
    incomingDartId: preceding.twinDartId, outgoingDartId: outgoing.dartId };
}

export function buildPhysicalEmbedding(placed, routes) {
  const vertices = new Map();
  const bodies = new Map();
  for (const [instructionId, placement] of placed) {
    const embeddedVertexId = bodyId(instructionId);
    const { cx, cy, top } = placement.box;
    vertices.set(embeddedVertexId, { embeddedVertexId, kind: "instruction",
      instructionId, position: [cx, cy], top: [cx, top] });
    bodies.set(instructionId, bodyPolygon(placement));
  }
  const segmentsByRoute = new Map();
  const segments = [];
  for (const route of routes) {
    if (!placed.has(route.sourceInstruction) || !placed.has(route.targetInstruction)
      || route.points.length < 2 || route.points.some((p) => p.length !== 2 || !p.every(Number.isFinite))) {
      return unsupported("invalid-route", { logicalEdgeId: route.logicalEdgeId });
    }
    const tail = terminalRun(route);
    const ownSegments = [];
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index], b = route.points[index + 1];
      if (samePoint(a, b)) return unsupported("zero-length-segment", { logicalEdgeId: route.logicalEdgeId, index });
      const segment = { route, index, a, b, tail, cuts: new Map([[pointKey(a), a], [pointKey(b), b]]) };
      for (const [instructionId, polygon] of bodies) {
        const range = bodyContact(segment, polygon);
        const source = index === 0 && route.sourceInstruction === instructionId;
        const target = index === route.points.length - 2 && route.targetInstruction === instructionId;
        if (range ? !(source && range[1] <= 1e-9) && !(target && range[0] >= 1 - 1e-9) : source || target) {
          return unsupported("unresolved-body-contact", { logicalEdgeId: route.logicalEdgeId, index, instructionId });
        }
      }
      segments.push(segment);
      ownSegments.push(segment);
    }
    segmentsByRoute.set(route.logicalEdgeId, ownSegments);
  }

  const observedSharing = new Set();
  for (let i = 0; i < segments.length; i += 1) {
    const second = segments[i];
    for (let j = 0; j < i; j += 1) {
      const first = segments[j];
      const contact = segmentContact(first, second);
      if (!contact) continue;
      const details = { logicalEdgeIds: [first.route.logicalEdgeId, second.route.logicalEdgeId],
        segmentIndices: [first.index, second.index] };
      if (contact.crossing) return unsupported("stroke-crossing", details);
      const { points } = contact;
      if (first.route === second.route) {
        if (points.length === 1 && first.index + 1 === second.index && samePoint(first.b, points[0])) continue;
        return unsupported("route-self-contact", details);
      }
      const suffix = permittedSuffix(first, second);
      if (points.length === 1) {
        const end = bodyEndpoint(first, points[0]);
        if (end && end === bodyEndpoint(second, points[0])) continue;
      }
      if (!shareContact(first, second, points, suffix)) {
        return unsupported(points.length > 1 ? "unexplained-stroke-overlap" : "unexplained-stroke-contact", details);
      }
      if (points.length > 1) observedSharing.add(second.route.logicalEdgeId);
      for (const p of points) {
        first.cuts.set(pointKey(p), p);
        second.cuts.set(pointKey(p), p);
      }
    }
  }
  for (const route of routes) {
    if (route.sharedTerminalApproach && !observedSharing.has(route.logicalEdgeId)) {
      return unsupported("shared-approach-without-exact-overlap", { logicalEdgeId: route.logicalEdgeId });
    }
  }

  const edges = new Map();
  const paths = [];
  function endpoint(segment, p) {
    const instructionId = bodyEndpoint(segment, p);
    if (instructionId) return bodyId(instructionId);
    const embeddedVertexId = routingId(p);
    if (!vertices.has(embeddedVertexId)) vertices.set(embeddedVertexId, { embeddedVertexId, kind: "routing", position: p });
    return embeddedVertexId;
  }
  for (const route of routes) {
    const pieces = [];
    for (const segment of segmentsByRoute.get(route.logicalEdgeId)) {
      const axis = Math.abs(segment.a[0] - segment.b[0]) >= Math.abs(segment.a[1] - segment.b[1]) ? 0 : 1;
      const sign = Math.sign(segment.b[axis] - segment.a[axis]);
      const cuts = [...segment.cuts.values()].sort((a, b) => sign * (a[axis] - b[axis]));
      for (let i = 1; i < cuts.length; i += 1) {
        const a = cuts[i - 1], b = cuts[i];
        const forward = pointKey(a) < pointKey(b);
        const [start, end] = forward ? [a, b] : [b, a];
        const embeddedEdgeId = "stroke:" + pointKey(start) + ">" + pointKey(end);
        if (!edges.has(embeddedEdgeId)) edges.set(embeddedEdgeId, { embeddedEdgeId,
          from: endpoint(segment, start), to: endpoint(segment, end), points: [start, end] });
        pieces.push({ embeddedEdgeId, forward, segmentIndex: segment.index });
      }
    }
    paths.push({ logicalEdgeId: route.logicalEdgeId, pieces });
  }

  const incidence = new Map([...vertices.keys()].map((id) => [id, []]));
  for (const edge of edges.values()) {
    const { embeddedEdgeId, from, to, points: [a, b] } = edge;
    const add = (originEmbeddedVertex, p, q, direction, twin) => {
      const vertex = vertices.get(originEmbeddedVertex);
      const directionAngle = counterclockwiseAngle(...delta(q, p));
      const positionAngle = vertex.kind === "instruction" ? counterclockwiseAngle(...delta(p, vertex.position)) : directionAngle;
      const fanAngle = normalize(directionAngle - positionAngle + Math.PI) - Math.PI;
      incidence.get(originEmbeddedVertex).push({
        dartId: embeddedEdgeId + direction, originEmbeddedVertex, twinDartId: embeddedEdgeId + twin,
        port: p, tip: q, positionAngle, fanAngle,
      });
    };
    add(from, a, b, "+", "-");
    add(to, b, a, "-", "+");
  }
  const darts = [];
  for (const [embeddedVertexId, ring] of incidence) {
    ring.sort((a, b) => a.positionAngle - b.positionAngle || a.fanAngle - b.fanAngle);
    const vertex = vertices.get(embeddedVertexId);
    if (vertex.kind === "routing") vertex.kind = ring.length === 2 ? "routing-bend" : "routing-junction";
    for (let i = 0; i < ring.length; i += 1) {
      const { dartId, originEmbeddedVertex, twinDartId, port, tip, positionAngle, fanAngle } = ring[i];
      const next = ring[(i + 1) % ring.length];
      if (ring.length > 1 && positionAngle === next.positionAngle
        && (!samePoint(port, next.port)
          || (orientation(port, tip, next.tip) === 0 && between(tip, port, next.tip))
          || (orientation(port, tip, next.tip) === 0 && between(next.tip, port, tip))
          || fanAngle === next.fanAngle)) return unsupported("unresolved-circular-order", { embeddedVertexId });
      darts.push({ dartId, originEmbeddedVertex, twinDartId, nextCounterclockwiseDartId: next.dartId });
    }
  }

  const exteriorReference = exteriorCorner(vertices, incidence);
  return { embeddingStatus: vertices.size ? "available" : "empty", obstruction: null,
    embeddedVertices: [...vertices.values()].map(({ embeddedVertexId, kind, instructionId, position }) => ({
      embeddedVertexId, kind, ...(instructionId ? { instructionId } : {}), position,
    })),
    embeddedEdges: [...edges.values()], logicalEdgePaths: paths, darts, exteriorReference };
}
