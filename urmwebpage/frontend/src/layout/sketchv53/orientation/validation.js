// Official V5 legality: straight continuations and fixed-angle diamond exits.
// Diamond bodies are actual polygons; START retains a conservative rectangle.
import { getLegalIncidentStubsForNode, validateEdgeAttachments } from "../attachmentStubs.js";

const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) <= EPS;
const pointEqual = (a, b) => Array.isArray(a) && Array.isArray(b)
  && near(a[0], b[0]) && near(a[1], b[1]);
const finitePoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const validOrientation = (orientation) => orientation
  && ["left", "right"].includes(orientation.no) && ["left", "right"].includes(orientation.yes)
  && orientation.no !== orientation.yes;

export function isValidPlacement(p) {
  const b = p?.box;
  return b && [p.cx, p.cy, b.cx, b.cy, b.left, b.right, b.top, b.bottom, b.w, b.h].every(Number.isFinite)
    && b.w > 0 && b.h > 0 && near(b.right - b.left, b.w) && near(b.bottom - b.top, b.h)
    && near(b.cx, p.cx) && near(b.cy, p.cy)
    && near((b.left + b.right) / 2, p.cx) && near((b.top + b.bottom) / 2, p.cy);
}

function bodyPolygon(placement) {
  const b = placement.box;
  return placement.kind === "conditionalJump"
    ? [[b.cx, b.top], [b.right, b.cy], [b.cx, b.bottom], [b.left, b.cy]]
    : [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
}

// Clip against the convex body's half-planes. The result distinguishes a lone
// legal attachment point from penetration or contact anywhere else on the body.
function bodyContact(a, b, polygon) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const vertex = polygon[i];
    const edge = subtract(polygon[(i + 1) % polygon.length], vertex);
    const start = cross(edge, subtract(a, vertex));
    const delta = cross(edge, subtract(b, a));
    if (near(delta, 0)) {
      if (start < -EPS) return null;
    } else {
      const t = -start / delta;
      if (delta > 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi + EPS) return null;
    }
  }
  return [lo, hi];
}

function bodiesContact(first, second) {
  for (const polygon of [first, second]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const edge = subtract(polygon[(i + 1) % polygon.length], polygon[i]);
      const normal = [-edge[1], edge[0]];
      const p = first.map((point) => dot(point, normal));
      const q = second.map((point) => dot(point, normal));
      if (Math.max(...p) < Math.min(...q) - EPS || Math.max(...q) < Math.min(...p) - EPS) return false;
    }
  }
  return true;
}

function segmentContact(a, b, c, d) {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const offset = subtract(c, a);
  const determinant = cross(r, s);
  if (near(determinant, 0)) {
    if (!near(cross(offset, r), 0)) return null;
    const t1 = dot(offset, r) / dot(r, r);
    const t2 = dot(subtract(d, a), r) / dot(r, r);
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(1, Math.max(t1, t2));
    return lo > hi + EPS ? null : { point: [a[0] + lo * r[0], a[1] + lo * r[1]], overlap: hi - lo > EPS };
  }
  const t = cross(offset, s) / determinant;
  const u = cross(offset, r) / determinant;
  return t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS ? null
    : { point: [a[0] + t * r[0], a[1] + t * r[1]], overlap: false };
}

function sharedAttachment(route, oldRoute, point) {
  const endpoints = (r) => [[r.source, r.points[0]], [r.target, r.points.at(-1)]];
  return endpoints(route).some(([id, p]) => pointEqual(point, p)
    && endpoints(oldRoute).some(([oldId, oldP]) => oldId === id && pointEqual(point, oldP)));
}

// Read the maximal straight approach without changing recorded subdivisions.
function terminalApproach(route) {
  const port = route.points.at(-1);
  const vector = subtract(route.points.at(-2), port);
  const length = Math.hypot(...vector);
  if (length <= EPS) return null;
  const unit = vector.map((n) => n / length);
  let start = route.points.length - 2;
  let distance = length;
  while (start > 0) {
    const relative = subtract(route.points[start - 1], port);
    const farther = dot(relative, unit);
    if (!near(cross(relative, unit), 0) || farther <= distance + EPS) break;
    start -= 1;
    distance = farther;
  }
  return { start, point: route.points[start], length: distance, unit };
}

function sharedTerminalSuffix(route, old) {
  const port = route.points.at(-1);
  if (route.target !== old.target || !pointEqual(port, old.points.at(-1))) return null;
  const a = terminalApproach(route), b = terminalApproach(old);
  if (!a || !b || dot(a.unit, b.unit) <= 0
    || !near(cross(subtract(a.point, port), b.unit), 0)
    || !near(cross(subtract(b.point, port), a.unit), 0)) return null;
  const junction = a.length <= b.length ? a.point : b.point;
  // Each incoming edge must have its own prefix before the actual merge.
  if (pointEqual(junction, route.points[0]) || pointEqual(junction, old.points[0])) return null;
  return { startA: a.start, startB: b.start, junction };
}

function terminalSuffixContact(route, old, suffix, i, j, contact) {
  const tailA = i >= suffix.startA, tailB = j >= suffix.startB;
  if (contact.overlap) return tailA && tailB;
  if (tailA && tailB) return true; // A collinear subdivision of the shared path.
  if (!pointEqual(contact.point, suffix.junction)) return false;
  const joinA = i === suffix.startA - 1 && pointEqual(route.points[i + 1], suffix.junction);
  const joinB = j === suffix.startB - 1 && pointEqual(old.points[j + 1], suffix.junction);
  return (tailA || joinA) && (tailB || joinB) && (joinA || joinB);
}

// Check every segment. Only endpoint contacts and a proved common terminal
// suffix may be shared; all prefix contacts and node intrusions stay strict.
function inspectRoute(state, route, reject, newTarget = null, allowTerminalSharing = false) {
  const suffixes = allowTerminalSharing ? new Map([...state.routes.values()]
    .map((old) => [old.edgeId, sharedTerminalSuffix(route, old)])) : null;
  let sharedTerminalApproach = false;
  const nodes = newTarget ? [...state.placements, [route.target, newTarget]] : state.placements;
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1];
    const b = route.points[i];
    for (const [id, placement] of nodes) {
      const contact = bodyContact(a, b, bodyPolygon(placement));
      const sourceOnly = id === route.source && i === 1 && contact && near(contact[0], 0) && near(contact[1], 0);
      const targetOnly = id === route.target && i === route.points.length - 1 && contact && near(contact[0], 1) && near(contact[1], 1);
      if (contact && !sourceOnly && !targetOnly) reject("edge-node-contact", { nodeId: id, segment: i - 1 });
    }
    for (const old of state.routes.values()) {
      for (let j = 1; j < old.points.length; j += 1) {
        const contact = segmentContact(a, b, old.points[j - 1], old.points[j]);
        if (contact && (contact.overlap || !sharedAttachment(route, old, contact.point))) {
          const suffix = suffixes?.get(old.edgeId);
          if (suffix && terminalSuffixContact(route, old, suffix, i - 1, j - 1, contact)) {
            sharedTerminalApproach ||= contact.overlap;
          } else {
            reject(contact.overlap ? "edge-edge-overlap" : "edge-edge-intersection", { edgeId: old.edgeId, segment: i - 1, oldSegment: j - 1 });
          }
        }
      }
    }
    for (let j = 1; j < i; j += 1) {
      const contact = segmentContact(a, b, route.points[j - 1], route.points[j]);
      if (contact && (contact.overlap || j !== i - 1)) reject("route-self-intersection", { segment: i - 1, oldSegment: j - 1 });
    }
  }
  return sharedTerminalApproach;
}

export function validateConnection(state, { route, portSelection }, { branchAngleTan = Math.tan(33 * Math.PI / 180) } = {}) {
  const violations = [];
  const reject = (code, details = {}) => violations.push({ code, ...details });
  const source = state.placements.get(route?.source);
  const target = state.placements.get(route?.target);
  if (!source || !target) reject("unplaced-endpoint");
  if (!route?.edgeId || state.routes.has(route.edgeId)) reject("duplicate-or-missing-edge");
  const points = route?.points;
  if (!Array.isArray(points) || points.length < 2 || !points.every(finitePoint)
    || points.some((p, i) => i > 0 && pointEqual(p, points[i - 1]))) reject("invalid-route-geometry");
  if (violations.length) return { legal: false, violations, warnings: [], attachments: null };
  const attachments = validateEdgeAttachments(route, { id: route.source, kind: source.kind },
    { id: route.target, kind: target.kind }, points, { sourceBox: source.box, targetBox: target.box });
  let branchLegal = true;
  if (source.kind === "conditionalJump") {
    const side = source.branchOrientation?.[route.branch];
    const sign = side === "left" ? -1 : 1;
    const [a, b] = points;
    branchLegal = ["yes", "no"].includes(route.branch) && side === route.branchSide
      && ["left", "right"].includes(side)
      && pointEqual(a, [source.cx + sign * source.box.w / 4, source.cy + source.box.h / 4])
      && (b[0] - a[0]) * sign > 0 && near(b[1] - a[1], Math.abs(b[0] - a[0]) * branchAngleTan);
    if (branchLegal && points.length === 2 && pointEqual(b, [target.cx, target.box.top])) {
      attachments.target = { ...attachments.target, legal: true, reason: null, rule: "v5-fixed-angle-top-arrival" };
      attachments.legal = attachments.source.legal;
    }
  }
  const exactPort = (placement, point) => getLegalIncidentStubsForNode(placement, { box: placement.box })
    .some((stub) => stub.portPoint && pointEqual(stub.portPoint, point));
  if (!attachments.legal || !branchLegal || !exactPort(source, points[0]) || !exactPort(target, points.at(-1))
    || !pointEqual(points[0], route.sourcePort) || !pointEqual(points.at(-1), route.targetPort)
    || !pointEqual(points[0], portSelection?.sourcePort) || !pointEqual(points.at(-1), portSelection?.targetPort)) reject("illegal-attachment");
  const sharedTerminalApproach = inspectRoute(state, route, reject, null, true);
  return { legal: violations.length === 0, violations, warnings: [], attachments,
    ...(sharedTerminalApproach ? { sharedTerminalApproach: true } : {}) };
}

export function validateExtension(state, proposal, { clearance = 16, branchAngleTan = Math.tan(33 * Math.PI / 180) } = {}) {
  const violations = [];
  const warnings = [];
  const reject = (code, details = {}) => violations.push({ code, ...details });
  const { nodeId, placement, placingEdgeId, route, portSelection } = proposal;
  const source = state.placements.get(route?.source);
  if (!isValidPlacement(placement) || !["action", "unconditionalJump", "conditionalJump"].includes(placement.kind)
    || (placement.kind === "conditionalJump" && !validOrientation(placement.branchOrientation))) reject("invalid-node-geometry");
  if (!source) reject("unplaced-source");
  if (!nodeId || state.placements.has(nodeId)) reject("target-already-placed");
  if (!route?.edgeId || state.routes.has(route.edgeId)) reject("duplicate-or-missing-edge");
  if (route?.target !== nodeId || placingEdgeId !== route?.edgeId) reject("inconsistent-extension");
  const points = route?.points;
  const branch = route?.routeFamily === "branch-exit";
  if (!Array.isArray(points) || points.length !== 2 || !points.every(finitePoint)
    || points[1][1] <= points[0][1] + EPS
    || (!branch && (!near(points[0][0], points[1][0]) || route.branch))
    || (branch && near(points[0][0], points[1][0]))) {
    reject("unsupported-incoming-shape");
  }
  if (violations.length) return { legal: false, violations, warnings, attachments: null };

  const [a, b] = points;
  const attachments = validateEdgeAttachments(route,
    { id: route.source, kind: source.kind }, { id: nodeId, kind: placement.kind }, points,
    { sourceBox: source.box, targetBox: placement.box });
  if (branch) {
    // V5's single narrow addition: an assigned lower-face fixed-angle exit may
    // arrive diagonally at an action/diamond top. No other V4 attachment rule is relaxed.
    const side = source.branchOrientation?.[route.branch];
    const sign = side === "left" ? -1 : 1;
    const correctBranch = source.kind === "conditionalJump" && ["no", "yes"].includes(route.branch)
      && ["left", "right"].includes(side) && side === route.branchSide;
    const correctAngle = (b[0] - a[0]) * sign > 0 && near(b[1] - a[1], Math.abs(b[0] - a[0]) * branchAngleTan);
    const correctFace = pointEqual(a, [source.cx + sign * source.box.w / 4, source.cy + source.box.h / 4]);
    const targetLegal = correctBranch && correctAngle && correctFace && pointEqual(b, [placement.cx, placement.box.top]);
    attachments.target = { ...attachments.target, legal: targetLegal,
      rule: "v5-fixed-angle-top-arrival", reason: targetLegal ? null : "not an assigned fixed-angle branch arrival" };
    attachments.legal = correctBranch && correctAngle && correctFace && attachments.source.legal && targetLegal;
  }
  if (!attachments.legal || (!branch && (source.kind === "conditionalJump"
    || attachments.source.portName !== "bottom" || !pointEqual(a, [source.cx, source.box.bottom])))
    || attachments.target.portName !== "top"
    || !pointEqual(b, [placement.cx, placement.box.top])
    || !pointEqual(a, route.sourcePort) || !pointEqual(b, route.targetPort)
    || !pointEqual(a, portSelection?.sourcePort) || !pointEqual(b, portSelection?.targetPort)) {
    reject("illegal-attachment");
  }

  const box = placement.box;
  const targetBody = bodyPolygon(placement);
  for (const [id, committed] of state.placements) {
    const oldBox = committed.box;
    const dx = Math.max(oldBox.left - box.right, box.left - oldBox.right, 0);
    const dy = Math.max(oldBox.top - box.bottom, box.top - oldBox.bottom, 0);
    const committedBody = bodyPolygon(committed);
    if (bodiesContact(targetBody, committedBody)) reject("node-node-contact", { nodeId: id });
    else if (Math.hypot(dx, dy) < clearance) warnings.push({ code: "preferred-node-spacing", nodeId: id });
  }
  const targetContact = bodyContact(a, b, targetBody);
  if (!targetContact || !near(targetContact[0], 1) || !near(targetContact[1], 1)) {
    reject("edge-target-penetration");
  }
  for (const oldRoute of state.routes.values()) {
    for (let i = 1; i < oldRoute.points.length; i += 1) {
      const c = oldRoute.points[i - 1];
      const d = oldRoute.points[i];
      if (bodyContact(c, d, targetBody)) reject("node-edge-contact", { edgeId: oldRoute.edgeId });
    }
  }
  inspectRoute(state, route, reject, placement);
  return { legal: violations.length === 0, violations, warnings, attachments };
}
