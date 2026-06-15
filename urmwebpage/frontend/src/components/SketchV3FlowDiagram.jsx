const SKETCH_V3_LAYOUT_MODE = "sketchV3";
const SKETCH_V3_ANGLE_TOLERANCE = 0.08;
const SKETCH_V3_LANE_CLEARANCE = 16;
const SKETCH_V3_DIAMOND_OBSTACLE_MARGIN = 24;

const DEFAULT_BRANCH_ORIENTATION = { no: "left", yes: "right" };
const FLIPPED_BRANCH_ORIENTATION = { no: "right", yes: "left" };
const DIAMOND_PORT_EPSILON = 1.5;

function getBranchVisualSide(branchKind, orientation) {
  return orientation?.[branchKind] ?? (branchKind === "no" ? "left" : "right");
}

// --- Manual split-orientation overrides (dev/debug) ----------------------------
// Dev/manual override infrastructure — NOT automatic split-orientation repair.
// An override changes ONLY the visual left/right assignment of a diamond's two
// outgoing branches — semantic yes/no labels, the CFG, and traversal order
// (no-branch walked inline, yes-branch pushed pending) are unchanged. Diamonds
// without an entry keep the existing automatic behavior.
//
// Sources, merged in increasing precedence (all read at layout time):
//   1. localStorage "sketchV3BranchOrientationOverrides"
//      = JSON map, e.g. {"i-53":"YES_LEFT_NO_RIGHT","i-48":"YES_LEFT_NO_RIGHT"}
//      (set in DevTools, then reload the page — layout is memoized per program)
//   2. URL query ?sketchV3Flip=i-53,i-48
//      = comma-separated diamond ids/indices, each flipped to YES_LEFT_NO_RIGHT
//   3. globalThis.__sketchV3BranchOrientationOverrides (headless harness / tests,
//      which set it before the first layout runs)
// Keys may be diamond node ids ("i-53") or bare instruction indices (53).
// "YES_LEFT_NO_RIGHT" forces the flipped visual orientation; "NO_LEFT_YES_RIGHT"
// pins the default.
let _overridesCache = null;
let _overridesCacheKey = null;

// Automatic split-orientation repair feeds trial override maps through this slot
// so trials reuse the exact same override mechanism as manual debugging — there
// is no separate flipping system. Manual entries always win on key conflicts
// (and in practice automatic repair is disabled entirely while any manual
// override is active; see applySketchV3LayoutWithAutomaticRepair).
let _automaticTrialOverrides = null;
let _mergedOverridesCache = null;

function getSketchV3BranchOrientationOverrides() {
  const manual = getManualSketchV3BranchOrientationOverrides();
  if (!_automaticTrialOverrides) return manual;
  if (
    _mergedOverridesCache &&
    _mergedOverridesCache.auto === _automaticTrialOverrides &&
    _mergedOverridesCache.manual === manual
  ) {
    return _mergedOverridesCache.value;
  }
  const value = { ..._automaticTrialOverrides, ...(manual ?? {}) };
  _mergedOverridesCache = { auto: _automaticTrialOverrides, manual, value };
  return value;
}

function getManualSketchV3BranchOrientationOverrides() {
  const globalRaw = typeof globalThis !== "undefined"
    ? globalThis.__sketchV3BranchOrientationOverrides
    : null;
  let urlRaw = "";
  let storageRaw = "";
  if (typeof window !== "undefined") {
    try {
      urlRaw = String(new URLSearchParams(window.location.search).get("sketchV3Flip") ?? "");
    } catch {
      // Ignore URL parsing issues in non-browser/debug contexts.
    }
    try {
      storageRaw = String(window.localStorage?.getItem("sketchV3BranchOrientationOverrides") ?? "");
    } catch {
      // Ignore localStorage access issues for debug-only overrides.
    }
  }

  // This helper is called inside hot placement loops; re-parse only when one of
  // the raw sources changes (the global is compared by reference).
  const cacheKey = `${urlRaw}\u0000${storageRaw}`;
  if (_overridesCacheKey === cacheKey && _overridesCache?.globalRaw === globalRaw) {
    return _overridesCache.value;
  }

  const merged = {};
  if (storageRaw) {
    try {
      const parsed = JSON.parse(storageRaw);
      if (parsed && typeof parsed === "object") Object.assign(merged, parsed);
    } catch {
      // Malformed JSON in localStorage — ignore rather than break layout.
    }
  }
  urlRaw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      merged[token] = "YES_LEFT_NO_RIGHT";
    });
  if (globalRaw && typeof globalRaw === "object") Object.assign(merged, globalRaw);

  const value = Object.keys(merged).length > 0 ? merged : null;
  _overridesCache = { globalRaw, value };
  _overridesCacheKey = cacheKey;
  return value;
}

function getOverrideOrientationForDiamond(node) {
  if (!node || node.kind !== "conditionalJump") return null;
  const overrides = getSketchV3BranchOrientationOverrides();
  if (!overrides) return null;
  const value = overrides[node.id] ?? (Number.isInteger(node.instructionIndex)
    ? overrides[node.instructionIndex] ?? overrides[String(node.instructionIndex)]
    : undefined);
  if (value === "YES_LEFT_NO_RIGHT") return FLIPPED_BRANCH_ORIENTATION;
  if (value === "NO_LEFT_YES_RIGHT") return DEFAULT_BRANCH_ORIENTATION;
  return null;
}

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

// Per-points memoization of the (pure) points -> segments transform. Every caller
// treats the result as read-only (verified: no reassignment of .start/.end and no
// sort/reverse/push/splice on the returned array), so handing back a shared array is
// safe. During candidate validation the same committed-edge routes are re-segmented
// O(candidates) times; keying by the points-array identity collapses that to one
// computation per distinct route. A WeakMap lets transient candidate-route arrays be
// garbage-collected and avoids any cross-layout-run staleness (identical points always
// yield identical segments, and each layout run clones fresh node/edge/route arrays).
const _routeSegmentsCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
function routeSegments(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (_routeSegmentsCache) {
    const cached = _routeSegmentsCache.get(points);
    if (cached) return cached;
  }
  const segments = points.slice(1).map((point, index) => ({
    start: points[index],
    end: point,
  }));
  if (_routeSegmentsCache) _routeSegmentsCache.set(points, segments);
  return segments;
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

function collinearSegmentOverlapLength(segA, segB) {
  if (!segmentsAreCollinear(segA, segB)) return 0;
  const dx = segA.end[0] - segA.start[0];
  const dy = segA.end[1] - segA.start[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return 0;
  const ux = dx / len;
  const uy = dy / len;
  const t3 = (segB.start[0] - segA.start[0]) * ux + (segB.start[1] - segA.start[1]) * uy;
  const t4 = (segB.end[0] - segA.start[0]) * ux + (segB.end[1] - segA.start[1]) * uy;
  return Math.max(0, Math.min(len, Math.max(t3, t4)) - Math.max(0, Math.min(t3, t4)));
}

function segmentContainsInteriorPoint(point, segStart, segEnd, epsilon = 1) {
  // Returns true if 'point' lies strictly inside [segStart, segEnd] (collinear,
  // not within epsilon of either endpoint). Used to detect T-junctions.
  const dx = segEnd[0] - segStart[0];
  const dy = segEnd[1] - segStart[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return false;
  const cross = (point[0] - segStart[0]) * dy - (point[1] - segStart[1]) * dx;
  if (Math.abs(cross) > 0.001 * len) return false;
  const t = ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / (len * len);
  return t > epsilon / len && t < 1 - epsilon / len;
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

function isLoopReturnEdge(edge) {
  return Number.isInteger(edge?.sourceIndex) &&
    Number.isInteger(edge?.targetIndex) &&
    edge.targetIndex <= edge.sourceIndex;
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

// The eight named attachment ports of a diamond node.
// N/S/W/E are the four apexes; NW/NE/SW/SE are the side midpoints.
// SW = lowerLeftSideCenter, SE = lowerRightSideCenter (the normal branch exit anchors).
function getDiamondPorts(bounds) {
  return {
    N:  [bounds.centerX, bounds.top],
    S:  [bounds.centerX, bounds.bottom],
    W:  [bounds.left,    bounds.centerY],
    E:  [bounds.right,   bounds.centerY],
    NW: [(bounds.left  + bounds.centerX) / 2, (bounds.top    + bounds.centerY) / 2],
    NE: [(bounds.centerX + bounds.right)  / 2, (bounds.top    + bounds.centerY) / 2],
    SW: [(bounds.left  + bounds.centerX) / 2, (bounds.centerY + bounds.bottom)  / 2],
    SE: [(bounds.centerX + bounds.right)  / 2, (bounds.centerY + bounds.bottom)  / 2],
  };
}

// Legal inbound approach-vector signs for each diagonal diamond port, derived directly
// from getDiamondPorts geometry (y increases downward, so top < centerY < bottom and
// left < centerX < right).  Each diagonal port is a side midpoint; its legal inbound
// vector points from outside the diamond toward the port (opposite the outward normal):
//   NW (upper-left,  W→N face): approach down-right (dx>0, dy>0)
//   SW (lower-left,  W→S face): approach up-right   (dx>0, dy<0)
//   NE (upper-right, N→E face): approach down-left  (dx<0, dy>0)
//   SE (lower-right, S→E face): approach up-left    (dx<0, dy<0)
// Single source of truth shared by isDiamondPortApproachLegal (legality check) and the
// target-local dogleg pre-entry construction, so the two can no longer drift apart.
const DIAMOND_DIAGONAL_INBOUND_SIGN = {
  NW: [1, 1],
  SW: [1, -1],
  NE: [-1, 1],
  SE: [-1, -1],
};

// Pre-entry point for a diagonal-port dogleg: the short final stub preEntry -> port
// travels exactly along the port's legal inbound vector.  stubDx/stubDy are positive
// magnitudes (stubDy already scaled by the diamond side slope).  Returns null for
// cardinal ports, which use straight on-axis approaches rather than diagonal stubs.
function getDiamondDoglegPreEntry(portName, port, stubDx, stubDy) {
  const sign = DIAMOND_DIAGONAL_INBOUND_SIGN[portName];
  if (!sign) return null;
  return [port[0] - sign[0] * stubDx, port[1] - sign[1] * stubDy];
}

// Returns { name, point } for the nearest named port within DIAMOND_PORT_EPSILON,
// or null if the point does not land on any legal port.
function snapToDiamondPort(bounds, point) {
  const ports = getDiamondPorts(bounds);
  let nearestName = null;
  let nearestDist = Infinity;
  for (const [name, pos] of Object.entries(ports)) {
    const dist = Math.hypot(point[0] - pos[0], point[1] - pos[1]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestName = name;
    }
  }
  if (nearestName === null || nearestDist > DIAMOND_PORT_EPSILON) return null;
  return { name: nearestName, point: ports[nearestName] };
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

function makeDiamondExitRoute({ edge, start, end, layout, alreadyDrawnTarget = false, orientation = DEFAULT_BRANCH_ORIENTATION }) {
  const visualSide = getBranchVisualSide(edge.branch, orientation);
  const expectedDirection = visualSide === "left" ? -1 : 1;
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

// Like getBranchSideFromPathEntry but respects any stored flipped orientation on the
// owning diamond, so loop-return direction logic sees the correct visual side.
function getBranchVisualSideFromPathEntry(entry, drawingState) {
  const logicalSide = getBranchSideFromPathEntry(entry);
  if (logicalSide === null || !drawingState) return logicalSide;
  const branchKind = entry.endsWith("-yes") ? "yes" : "no";
  const edgeRecord = drawingState.edgesById.get(entry);
  const sourceId = edgeRecord?.sourceId ?? null;
  const diamondRecord = sourceId ? drawingState.diamondsById.get(sourceId) : null;
  if (!diamondRecord?.orientation) return logicalSide;
  return getBranchVisualSide(branchKind, diamondRecord.orientation);
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
  if (firstExtraEntry) return getBranchVisualSideFromPathEntry(firstExtraEntry, drawingState) ?? null;
  // Source and target share the exact same branchPath (same depth, same branch context).
  // Treat the target/header node as part of that interior branch — prefer the side of
  // the shared context rather than leaving the side undetermined and falling back to geometry.
  const sharedContextEntry = targetBranchPath.length > 0
    ? targetBranchPath[targetBranchPath.length - 1]
    : null;
  return sharedContextEntry ? (getBranchVisualSideFromPathEntry(sharedContextEntry, drawingState) ?? null) : null;
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
    orientation: existingRecord?.orientation ? { ...existingRecord.orientation } : { ...DEFAULT_BRANCH_ORIENTATION },
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
  orientation = DEFAULT_BRANCH_ORIENTATION,
}) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const targetBounds = getNodeBoundsAt(targetNode, position, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const branchVisualSide = getBranchVisualSide(edge.branch, orientation);
  const start = branchVisualSide === "left" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
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

// Returns the first geometric conflict between two sibling branch corridor previews,
// or null if they are clear of each other.  Only the corridors' own geometry is
// compared — outer/loop routes are not consulted, keeping this strictly local.
function findSiblingCorridorConflict(corridorA, corridorB) {
  if (!corridorA || !corridorB) return null;

  const footprintDist = boxDistance(corridorA.footprint, corridorB.footprint);
  if (footprintDist < SKETCH_V3_LANE_CLEARANCE) {
    return { kind: "footprint-overlap", clearance: footprintDist };
  }

  for (const segA of corridorA.segments) {
    const distToFootprintB = segmentBoxDistance(segA.start, segA.end, corridorB.footprint);
    if (distToFootprintB < SKETCH_V3_LANE_CLEARANCE) {
      return { kind: "segment-vs-footprint", clearance: distToFootprintB };
    }
    for (const segB of corridorB.segments) {
      const dist = distanceBetweenSegments(segA.start, segA.end, segB.start, segB.end);
      if (dist < SKETCH_V3_LANE_CLEARANCE) {
        return { kind: "segment-vs-segment", clearance: dist };
      }
    }
  }

  for (const segB of corridorB.segments) {
    const distToFootprintA = segmentBoxDistance(segB.start, segB.end, corridorA.footprint);
    if (distToFootprintA < SKETCH_V3_LANE_CLEARANCE) {
      return { kind: "segment-vs-footprint", clearance: distToFootprintA };
    }
  }

  return null;
}

// Builds shallow (one-step) corridor previews for a diamond's no and yes branches
// under the given orientation, stopping at structural boundaries: HALT edges,
// already-placed targets, and loop-return (backward) targets are skipped.
// Returns { noPreview, yesPreview } — either may be null if the branch is a stop.
function previewSiblingBranchCorridors({
  noEdge,
  yesEdge,
  sourcePlacement,
  orientation,
  instructionNodeByIndex,
  instructionCount,
  placedByNodeId,
  layout,
  params,
  depth,
  branchPath,
}) {
  let noPreview = null;
  let yesPreview = null;

  if (noEdge && !isHaltEdge(noEdge, instructionCount)) {
    const noTargetNode = instructionNodeByIndex.get(noEdge.targetIndex) ?? null;
    // Structural stops: already placed (loop-return or forward jump to placed node)
    if (noTargetNode && !placedByNodeId.has(noTargetNode.id)) {
      const noPos = getBranchPosition({
        edge: noEdge,
        sourcePlacement,
        targetNode: noTargetNode,
        layout,
        params,
        depth,
        orientation,
      });
      noPreview = makePendingBranchCorridor({
        edge: noEdge,
        sourcePlacement,
        targetNode: noTargetNode,
        position: noPos,
        layout,
        params,
        depth: depth + 1,
        branchPath: [...branchPath, noEdge.id],
        createdOrder: null,
        orientation,
      });
    }
  }

  if (yesEdge && !isHaltEdge(yesEdge, instructionCount)) {
    const yesTargetNode = instructionNodeByIndex.get(yesEdge.targetIndex) ?? null;
    if (yesTargetNode && !placedByNodeId.has(yesTargetNode.id)) {
      const yesPos = getBranchPosition({
        edge: yesEdge,
        sourcePlacement,
        targetNode: yesTargetNode,
        layout,
        params,
        depth,
        orientation,
      });
      yesPreview = makePendingBranchCorridor({
        edge: yesEdge,
        sourcePlacement,
        targetNode: yesTargetNode,
        position: yesPos,
        layout,
        params,
        depth: depth + 1,
        branchPath: [...branchPath, yesEdge.id],
        createdOrder: null,
        orientation,
      });
    }
  }

  return { noPreview, yesPreview };
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
  blockingSegmentIndex = null,
  blockingExpandedBounds = null,
  blockingNodeBounds = null,
  blockingNodeInstructionIndex = null,
  distanceToActualNodeBounds = null,
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
    blockingSegmentIndex,
    blockingExpandedBounds,
    blockingNodeBounds,
    blockingNodeInstructionIndex,
    distanceToActualNodeBounds,
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

// Returns true when the final approach direction (dx, dy) is legal for the named
// diamond port.  Cardinal apexes (N/S/W/E) must be approached on-axis; side-midpoint
// ports (NW/SW/NE/SE) must be approached from the correct diagonal quadrant.
// Only applied to loop-return routes — ordinary forward routes and branch exits are
// exempt because their geometry is constrained by the layout algorithm directly.
function isDiamondPortApproachLegal(portName, dx, dy) {
  switch (portName) {
    case "N":  return Math.abs(dx) < 0.001 && dy > 0;   // vertical from above
    case "S":  return Math.abs(dx) < 0.001 && dy < 0;   // vertical from below
    case "W":  return Math.abs(dy) < 0.001 && dx > 0;   // horizontal from left
    case "E":  return Math.abs(dy) < 0.001 && dx < 0;   // horizontal from right
    default: {
      // Diagonal side-midpoint ports (NW/SW/NE/SE) must be approached along the legal
      // inbound quadrant for their diamond face (see DIAMOND_DIAGONAL_INBOUND_SIGN).
      // A purely horizontal/vertical approach (sign 0) is illegal for these ports.
      const sign = DIAMOND_DIAGONAL_INBOUND_SIGN[portName];
      if (!sign) return true;
      return Math.sign(dx) === sign[0] && Math.sign(dy) === sign[1];
    }
  }
}

// Checks whether a non-HALT route that targets a diamond node:
//   (a) lands on a legal named port (sketchV3IllegalDiamondPortRejected if not), and
//   (b) when it shares that port with another already-committed non-HALT edge to the
//       same diamond, the two final approach segments visually merge before the port
//       (sketchV3DiamondPortApproachMergeRejected if so).
// Simple same-port reuse is NOT rejected on its own — a diamond may legitimately
// receive multiple incoming edges at the same named port when they arrive from
// geometrically distinct directions (e.g. ordinary continuation from above + loop-back
// from the left), which is normal for loop-header diamonds in CFGs.
// Only the TARGET side is checked; HALT edges and non-diamond targets are skipped.
function findDiamondPortConflict({
  edge,
  route,
  placedByNodeId,
  edgeRouteById,
  edgesById,
  instructionCount,
  layout,
  excludeEdgeIds = new Set(),
}) {
  if (!edge || !route) return null;
  const points = route.points ?? [];
  if (points.length < 2) return null;
  if (isHaltEdge(edge, instructionCount)) return null;

  const targetPlacement = placedByNodeId.get(edge.to) ?? null;
  if (!targetPlacement || targetPlacement.node.kind !== "conditionalJump") return null;

  const targetBounds = getNodeBoundsAt(targetPlacement.node, targetPlacement, layout);
  const lastPoint = points[points.length - 1];
  const snapped = snapToDiamondPort(targetBounds, lastPoint);

  if (!snapped) {
    return makePlacementRejection({
      candidateEdgeId: edge.id,
      rejectionKind: "sketchV3IllegalDiamondPortRejected",
      blockingGeometryId: edge.to,
      blockingGeometryRole: "diamond node",
      clearance: 0,
      candidatePoints: points,
    });
  }

  // For loop-return routes, verify the final approach direction is legal for the
  // snapped port. Cardinal apexes require on-axis approach; side-midpoint ports
  // (NW/SW/NE/SE) require the diagonal quadrant matching their diamond side.
  // Ordinary forward routes and branch exits are exempt — their geometry is
  // constrained by the layout algorithm itself, not by candidate ranking.
  if (isLoopReturnEdge(edge) && !isHaltEdge(edge, instructionCount)) {
    const prev = points[points.length - 2];
    const end  = points[points.length - 1];
    const approachDx = end[0] - prev[0];
    const approachDy = end[1] - prev[1];
    if (!isDiamondPortApproachLegal(snapped.name, approachDx, approachDy)) {
      return makePlacementRejection({
        candidateEdgeId: edge.id,
        rejectionKind: "sketchV3IllegalDiamondPortApproachAngleRejected",
        blockingGeometryId: edge.to,
        blockingGeometryRole: "diamond node approach angle",
        clearance: 0,
        candidatePoints: points,
      });
    }
  }

  // When two non-HALT edges share the same named port, only reject if their final
  // approach segments visually merge before the port.  Two routes that land on the
  // same port from geometrically distinct directions (different lanes, different axes)
  // are legitimate — a CFG join at a loop header is the canonical example.
  // Merge conditions checked on the last segment of each route:
  //   (a) collinear positive-length overlap — shared pre-port trunk/stub
  //   (b) T-junction — one approach's penultimate bend lies on the other's final stub
  const APPROACH_OVERLAP_EPSILON = 1;
  const candidateFinal = {
    start: points[points.length - 2],
    end:   points[points.length - 1],
  };

  for (const [committedEdgeId, committedRoute] of edgeRouteById) {
    if (committedEdgeId === edge.id || excludeEdgeIds.has(committedEdgeId)) continue;
    const committedEdge = edgesById.get(committedEdgeId);
    if (!committedEdge || committedEdge.to !== edge.to) continue;
    if (isHaltEdge(committedEdge, instructionCount)) continue;
    const committedPoints = committedRoute.points ?? [];
    if (committedPoints.length < 2) continue;
    const committedSnapped = snapToDiamondPort(targetBounds, committedPoints[committedPoints.length - 1]);
    if (!committedSnapped || committedSnapped.name !== snapped.name) continue;

    const committedFinal = {
      start: committedPoints[committedPoints.length - 2],
      end:   committedPoints[committedPoints.length - 1],
    };
    const approachMerge = (
      // (a) shared pre-port stub — collinear overlap of positive length
      collinearSegmentOverlapLength(candidateFinal, committedFinal) > APPROACH_OVERLAP_EPSILON ||
      // (b) T-junction — candidate's penultimate bend on committed's final segment
      segmentContainsInteriorPoint(candidateFinal.start, committedFinal.start, committedFinal.end) ||
      // (c) T-junction — committed's penultimate bend on candidate's final segment
      segmentContainsInteriorPoint(committedFinal.start, candidateFinal.start, candidateFinal.end)
    );
    if (approachMerge) {
      return makePlacementRejection({
        candidateEdgeId: edge.id,
        rejectionKind: "sketchV3DiamondPortApproachMergeRejected",
        blockingGeometryId: committedEdgeId,
        blockingGeometryRole: "diamond port approach",
        clearance: 0,
        candidatePoints: points,
      });
    }
  }

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
  // Optional precomputed committed geometry, shared across all candidates of one routing pass
  // (placement is fixed during candidate evaluation). When provided they MUST equal what this
  // function would compute for the same exclusions; callers that omit them get the original
  // per-call computation. They only replace the committed node-box / edge-segment arrays — the
  // collinear and diamond-port checks still use excludeEdgeIds/placedByNodeId directly — and
  // Map iteration order is preserved, so the first-rejection identity is unchanged.
  committedNodeBoxes = null,
  committedEdgeSegments = null,
}) {
  const segments = routeSegments(route.points);
  const nodeBoxes = committedNodeBoxes ?? getCommittedNodeBoxes(placedByNodeId, layout, excludeNodeIds);
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx];
    for (const entry of nodeBoxes) {
      const distance = segmentBoxDistance(segment.start, segment.end, entry.box);
      if (distance < SKETCH_V3_LANE_CLEARANCE) {
        const blockingPlacement = placedByNodeId.get(entry.nodeId) ?? null;
        const blockingNodeBounds = blockingPlacement
          ? getNodeBoundsAt(blockingPlacement.node, blockingPlacement, layout)
          : null;
        const distanceToActualNodeBounds = blockingNodeBounds !== null
          ? segmentBoxDistance(segment.start, segment.end, blockingNodeBounds)
          : null;
        return makePlacementRejection({
          candidateEdgeId: edge.id,
          rejectionKind: "edge-vs-node",
          blockingGeometryId: entry.nodeId,
          blockingGeometryRole: entry.geometryRole,
          clearance: distance,
          candidatePoints: route.points,
          blockingSegmentIndex: segIdx,
          blockingExpandedBounds: entry.box,
          blockingNodeBounds,
          blockingNodeInstructionIndex: blockingPlacement?.node?.instructionIndex ?? null,
          distanceToActualNodeBounds,
        });
      }
    }
  }

  const edgeSegments = committedEdgeSegments ?? getCommittedEdgeSegments({
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

  // Positive-length collinear overlap checks.
  // The distance-based check above excludes edges connected to the same source/target
  // node (via excludeNodeIds) to avoid false positives at shared ports. That exclusion
  // also hides cases where two non-HALT edges share a positive-length segment — which
  // must still be rejected because it makes two distinct paths look like one path.
  // HALT-to-HALT shared sink routing remains allowed.
  const COLLINEAR_OVERLAP_EPSILON = 1; // px; zero-length "touch at port" returns 0 from the helper
  if (!isHaltEdge(edge, instructionCount) && segments.length > 0) {
    // Check A: pre-port approach merge — candidate last segment vs committed last segment
    // for each non-HALT edge entering the same target. Emit the more specific diagnostic.
    const candidateLastSeg = segments[segments.length - 1];
    for (const [committedEdgeId, committedRoute] of edgeRouteById) {
      if (committedEdgeId === edge.id || excludeEdgeIds.has(committedEdgeId)) continue;
      const committedEdge = edgesById.get(committedEdgeId);
      if (!committedEdge || committedEdge.to !== edge.to) continue;
      if (isHaltEdge(committedEdge, instructionCount)) continue;
      const committedSegs = routeSegments(committedRoute.points);
      if (committedSegs.length === 0) continue;
      if (collinearSegmentOverlapLength(candidateLastSeg, committedSegs[committedSegs.length - 1]) > COLLINEAR_OVERLAP_EPSILON) {
        return makePlacementRejection({
          candidateEdgeId: edge.id,
          rejectionKind: "sketchV3NonHaltPrePortMergeRejected",
          blockingGeometryId: committedEdgeId,
          blockingGeometryRole: getRouteGeometryRole(committedEdge, committedRoute, instructionCount),
          clearance: 0,
          candidatePoints: route.points,
        });
      }
    }
    // Check B: general positive-length collinear overlap with any committed non-HALT edge.
    // Covers mid-route overlaps not caught by Check A.
    for (const candidateSeg of segments) {
      for (const [committedEdgeId, committedRoute] of edgeRouteById) {
        if (committedEdgeId === edge.id || excludeEdgeIds.has(committedEdgeId)) continue;
        const committedEdge = edgesById.get(committedEdgeId);
        if (!committedEdge || isHaltEdge(committedEdge, instructionCount)) continue;
        for (const committedSeg of routeSegments(committedRoute.points)) {
          if (collinearSegmentOverlapLength(candidateSeg, committedSeg) > COLLINEAR_OVERLAP_EPSILON) {
            return makePlacementRejection({
              candidateEdgeId: edge.id,
              rejectionKind: "sketchV3PositiveLengthEdgeOverlapRejected",
              blockingGeometryId: committedEdgeId,
              blockingGeometryRole: getRouteGeometryRole(committedEdge, committedRoute, instructionCount),
              clearance: 0,
              candidatePoints: route.points,
            });
          }
        }
      }
    }
  }

  // Loop-return lane merge check (hard rejection).
  // Hard-rejects two patterns that make separate loop-return paths visually indistinguishable:
  //   (a) Positive-length collinear overlap: two routes share a lane segment.
  //   (b) T-junction: a bend/endpoint of the candidate sits on the interior of a committed
  //       loop-return segment, or vice versa.
  // Non-collinear X-crossings (case c) are a soft ranking penalty computed by
  // countLoopReturnCrossings in makeLoopReturnRoute — they are never hard-rejected.
  // HALT edges are exempt throughout.
  //
  // Port-adjacency exemption: when both routes target the same loop-header diamond and a
  // committed route's endpoint is a named port on that diamond, it is exempt from the
  // (b)-endpoint check. The diamond ports are placed on collinear sides (e.g. W, SW, S all
  // lie on the lower-left side), so a dogleg diagonal approaching SW at the exact diamond
  // tangent necessarily passes through W. That is port-adjacency geometry, not a lane merge.
  if (isLoopReturnEdge(edge) && !isHaltEdge(edge, instructionCount) && segments.length > 0) {
    const targetDiamondPlacement = edge.to ? (placedByNodeId.get(edge.to) ?? null) : null;
    const targetDiamondBounds = targetDiamondPlacement?.node?.kind === "conditionalJump"
      ? getNodeBoundsAt(targetDiamondPlacement.node, targetDiamondPlacement, layout)
      : null;

    for (const [committedEdgeId, committedRoute] of edgeRouteById) {
      if (committedEdgeId === edge.id || excludeEdgeIds.has(committedEdgeId)) continue;
      const committedEdge = edgesById.get(committedEdgeId);
      if (
        !committedEdge ||
        !isLoopReturnEdge(committedEdge) ||
        isHaltEdge(committedEdge, instructionCount)
      ) continue;
      const committedSegs = routeSegments(committedRoute.points);
      for (const candidateSeg of segments) {
        for (const committedSeg of committedSegs) {
          // Port-adjacency exemption for the committedSeg.end T-junction sub-check:
          // when the committed route also targets the same diamond and its endpoint snaps
          // to a named port there, that endpoint lies on the candidate's diagonal by
          // pure diamond geometry — not a lane merge.
          const committedEndIsAdjacentDiamondPort =
            committedEdge.to === edge.to &&
            targetDiamondBounds !== null &&
            snapToDiamondPort(targetDiamondBounds, committedSeg.end) !== null;

          if (
            // (a) Collinear positive-length overlap — same exterior lane position
            collinearSegmentOverlapLength(candidateSeg, committedSeg) > COLLINEAR_OVERLAP_EPSILON ||
            // (b) T-junction — candidate bend on committed segment interior, or vice versa
            segmentContainsInteriorPoint(candidateSeg.start, committedSeg.start, committedSeg.end) ||
            segmentContainsInteriorPoint(candidateSeg.end, committedSeg.start, committedSeg.end) ||
            segmentContainsInteriorPoint(committedSeg.start, candidateSeg.start, candidateSeg.end) ||
            (!committedEndIsAdjacentDiamondPort &&
              segmentContainsInteriorPoint(committedSeg.end, candidateSeg.start, candidateSeg.end))
          ) {
            return makePlacementRejection({
              candidateEdgeId: edge.id,
              rejectionKind: "sketchV3LoopReturnLaneMergeRejected",
              blockingGeometryId: committedEdgeId,
              blockingGeometryRole: getRouteGeometryRole(committedEdge, committedRoute, instructionCount),
              clearance: 0,
              candidatePoints: route.points,
            });
          }
        }
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

  const diamondPortRejection = findDiamondPortConflict({
    edge,
    route,
    placedByNodeId,
    edgeRouteById,
    edgesById,
    instructionCount,
    layout,
    excludeEdgeIds,
  });
  if (diamondPortRejection) return diamondPortRejection;

  return null;
}

// Pending-branch-corridor blocker rows for a route's segments. Factored out of
// collectRouteBlockingRows (identical logic) so the loop-return fast path can cheaply test
// whether ANY pending-corridor conflict exists without the expensive node/edge scan.
// A "pending branch corridor" blockingGeometryRole is produced ONLY here, so an empty
// result proves the full (sorted, top-8) blockingRows can contain no such row.
function collectPendingCorridorBlockingRows({
  segments,
  edge,
  pendingCorridorByEdgeId = new Map(),
  excludePendingEdgeIds = new Set(),
}) {
  const rows = [];
  const corridors = getActivePendingCorridors(pendingCorridorByEdgeId, excludePendingEdgeIds);
  for (const segment of segments) {
    for (const corridor of corridors) {
      const footprintDistance = segmentBoxDistance(segment.start, segment.end, corridor.footprint);
      if (footprintDistance < SKETCH_V3_LANE_CLEARANCE) {
        rows.push({
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
          rows.push({
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
  return rows;
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
  // Optional precomputed committed geometry (see findRouteRejection); same contract.
  committedNodeBoxes = null,
  committedEdgeSegments = null,
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

  const nodeBoxes = committedNodeBoxes ?? getCommittedNodeBoxes(placedByNodeId, layout, excludeNodeIds);
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

  const edgeSegments = committedEdgeSegments ?? getCommittedEdgeSegments({
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

  for (const row of collectPendingCorridorBlockingRows({
    segments,
    edge,
    pendingCorridorByEdgeId,
    excludePendingEdgeIds,
  })) {
    addRow(row);
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

// Counts non-collinear X-crossings between a candidate loop-return route and all committed
// non-HALT routes (loop returns, branch exits, continuations, etc.).
// Returns { total, sameTarget, ledger } where:
//   total       — all counted soft X-crossings
//   sameTarget  — crossings with edges that connect to the candidate's target node (arriving or leaving)
//   ledger      — per-intersection detail array (populated when collectLedger is true)
// Hard lane-merge patterns (collinear overlap, T-junction) remain hard rejections elsewhere;
// this function only scores soft single-point X-crossings for candidate ranking.
// Shared named-port endpoint contact is allowed via segmentsOnlyMeetAtNonCollinearEndpoint.
function countLoopReturnCrossings({ candidatePoints, edge, edgeRouteById, edgesById, instructionCount, excludeEdgeIds = new Set(), collectLedger = false, toBounds = null }) {
  if (!isLoopReturnEdge(edge) || isHaltEdge(edge, instructionCount)) return { total: 0, sameTarget: 0, ledger: [] };
  const candidateSegs = routeSegments(candidatePoints);
  if (candidateSegs.length === 0) return { total: 0, sameTarget: 0, ledger: [] };
  let total = 0;
  let sameTarget = 0;
  const ledger = collectLedger ? [] : null;
  for (const [committedEdgeId, committedRoute] of edgeRouteById) {
    if (excludeEdgeIds.has(committedEdgeId)) continue;
    const committedEdge = edgesById.get(committedEdgeId) ?? null;
    if (!committedEdge || isHaltEdge(committedEdge, instructionCount)) continue;
    const isSameTarget = committedEdge.to === edge.to || committedEdge.from === edge.to;
    const committedSegs = routeSegments(committedRoute.points);
    for (let ci = 0; ci < candidateSegs.length; ci++) {
      const candidateSeg = candidateSegs[ci];
      for (let ki = 0; ki < committedSegs.length; ki++) {
        const committedSeg = committedSegs[ki];
        const intersects = segmentsIntersect(candidateSeg.start, candidateSeg.end, committedSeg.start, committedSeg.end);
        if (!intersects) continue;
        const onlyEndpoint = segmentsOnlyMeetAtNonCollinearEndpoint(candidateSeg, committedSeg);
        // Port-adjacency exemption (mirrors the T-junction exemption in findRouteRejection):
        // when a committed route targeting the same diamond ends at a named diamond port
        // that lies on the interior of the candidate segment, the intersection is caused by
        // diamond geometry (e.g. W lies on the SW-approach diagonal), not a real visual
        // crossing.  Count neither the total nor the same-target crossing.
        const committedEndSnappedPort = (!onlyEndpoint &&
          isSameTarget &&
          toBounds !== null &&
          committedEdge.to === edge.to &&
          segmentContainsInteriorPoint(committedSeg.end, candidateSeg.start, candidateSeg.end))
          ? snapToDiamondPort(toBounds, committedSeg.end)
          : null;
        const committedEndIsAdjacentDiamondPort = committedEndSnappedPort !== null;
        const counted = !onlyEndpoint && !committedEndIsAdjacentDiamondPort;
        if (counted) {
          total += 1;
          if (isSameTarget) sameTarget += 1;
        }
        if (ledger !== null) {
          ledger.push({
            committedEdgeId,
            committedEdgeFrom: committedEdge.from ?? null,
            committedEdgeTo: committedEdge.to ?? null,
            committedEdgeRole: getRouteGeometryRole(committedEdge, committedRoute, instructionCount),
            isSameTargetEdge: isSameTarget,
            candidateSegIndex: ci,
            committedSegIndex: ki,
            counted,
            exemptReason: onlyEndpoint ? "shared-endpoint"
              : committedEndIsAdjacentDiamondPort ? "port-adjacent-endpoint"
              : null,
            committedEndPortName: committedEndSnappedPort?.name ?? null,
          });
        }
      }
    }
  }
  return { total, sameTarget, ledger: ledger ?? [] };
}

function buildLoopReturnRouteCandidates({ edge, fromBounds, toBounds, layout, params, depth, placedByNodeId, targetIsDiamond = false }) {
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
  const diamondTargetPorts = targetIsDiamond ? getDiamondPorts(toBounds) : null;

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

  // Left side: NW and SW corner ports — side-compatible, placed before N/S so vertical
  // ports do not crowd out left-aligned approaches when crossing avoidance is applied.
  if (diamondTargetPorts) {
    for (const cornerEntry of [
      { targetEntry: "target-nw", end: diamondTargetPorts.NW, directionSuffix: "nw-port", reason: "outsideLaneNWPortEntryForSameSideClearance" },
      { targetEntry: "target-sw", end: diamondTargetPorts.SW, directionSuffix: "sw-port", reason: "outsideLaneSWPortEntryForSameSideClearance" },
    ]) {
      for (let rank = 0; rank < 12; rank += 1) {
        const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
        const points = [leftStart, [laneX, leftStart[1]], [laneX, cornerEntry.end[1]], cornerEntry.end];
        candidates.push({
          side: "left",
          direction: `left-outside-${cornerEntry.directionSuffix}`,
          laneRank: rank,
          laneX,
          points,
          targetEntry: cornerEntry.targetEntry,
          reason: cornerEntry.reason,
        });
      }
    }
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

  // source-global-bottom variants for left-side direct ports (W / NW / SW).
  // The existing source-global-bottom loop above only covers target-top-offset (N) and
  // target-bottom-offset (S). When the source node is hemmed in by loop-body nodes that
  // block small-offset exits, those N/S routes work but the same-side W/NW/SW ports
  // never get a far-enough source exit to reach the outside lane. These candidates use
  // the identical global-bottom escape but approach the target at the port's own y-level
  // (horizontal final segment) instead of an offset vertical stub.
  {
    const leftSideDirectEntries = [
      {
        targetEntry: "left-side-center",
        end: leftEnd,
        directionSuffix: "left-center",
        reason: "outsideLaneGlobalBottomSourceExitLeftCenter",
      },
      ...(diamondTargetPorts ? [
        {
          targetEntry: "target-nw",
          end: diamondTargetPorts.NW,
          directionSuffix: "nw-port",
          reason: "outsideLaneGlobalBottomSourceExitNWPort",
        },
        {
          targetEntry: "target-sw",
          end: diamondTargetPorts.SW,
          directionSuffix: "sw-port",
          reason: "outsideLaneGlobalBottomSourceExitSWPort",
        },
      ] : []),
    ];
    for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
      const sourceExitY = Math.max(
        leftStart[1] + sourceOffsetStep * (sourceExitRank + 1),
        placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
      );
      for (const entry of leftSideDirectEntries) {
        for (let rank = 0; rank < 12; rank += 1) {
          const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
          const points = [
            leftStart,
            [leftStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, entry.end[1]],
            entry.end,
          ];
          candidates.push({
            side: "left",
            direction: `left-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: entry.reason,
          });
        }
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

  // Right side: NE and SE corner ports — side-compatible, placed before N/S.
  if (diamondTargetPorts) {
    for (const cornerEntry of [
      { targetEntry: "target-ne", end: diamondTargetPorts.NE, directionSuffix: "ne-port", reason: "outsideLaneNEPortEntryForSameSideClearance" },
      { targetEntry: "target-se", end: diamondTargetPorts.SE, directionSuffix: "se-port", reason: "outsideLaneSEPortEntryForSameSideClearance" },
    ]) {
      for (let rank = 0; rank < 8; rank += 1) {
        const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
        const points = [rightStart, [laneX, rightStart[1]], [laneX, cornerEntry.end[1]], cornerEntry.end];
        candidates.push({
          side: "right",
          direction: `right-outside-${cornerEntry.directionSuffix}`,
          laneRank: rank,
          laneX,
          points,
          targetEntry: cornerEntry.targetEntry,
          reason: cornerEntry.reason,
        });
      }
    }
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

  // source-global-bottom variants for right-side direct ports (E / NE / SE).
  // Symmetric to the left-side W/NW/SW block above.
  {
    const rightSideDirectEntries = [
      {
        targetEntry: "right-side-center",
        end: rightEnd,
        directionSuffix: "right-center",
        reason: "outsideLaneGlobalBottomSourceExitRightCenter",
      },
      ...(diamondTargetPorts ? [
        {
          targetEntry: "target-ne",
          end: diamondTargetPorts.NE,
          directionSuffix: "ne-port",
          reason: "outsideLaneGlobalBottomSourceExitNEPort",
        },
        {
          targetEntry: "target-se",
          end: diamondTargetPorts.SE,
          directionSuffix: "se-port",
          reason: "outsideLaneGlobalBottomSourceExitSEPort",
        },
      ] : []),
    ];
    for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
      const sourceExitY = Math.max(
        rightStart[1] + sourceOffsetStep * (sourceExitRank + 1),
        placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
      );
      for (const entry of rightSideDirectEntries) {
        for (let rank = 0; rank < 8; rank += 1) {
          const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
          const points = [
            rightStart,
            [rightStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, entry.end[1]],
            entry.end,
          ];
          candidates.push({
            side: "right",
            direction: `right-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: entry.reason,
          });
        }
      }
    }
  }

  // Target-local diagonal dogleg candidates for left-side corner ports NW and SW.
  // NW/SW lie on diagonal sides of the diamond and require a diagonal final segment.
  // The dogleg shape provides a short, local port-entry stub rather than a full-length
  // diagonal from the outside lane:
  //   lane vertical → horizontal shelf near target → short diagonal stub into port
  //
  // The stub direction is the port's legal inbound vector (DIAMOND_DIAGONAL_INBOUND_SIGN):
  //   NW: down-right (dx>0, dy>0) → preEntry above-left, shelf above the W return
  //   SW: up-right   (dx>0, dy<0) → preEntry below-left, shelf below the W return
  // getDiamondDoglegPreEntry derives preEntry from the exact port coordinate and the same
  // sign table the legality check uses, so the generated stub is always legal by construction.
  //
  // stubDy uses the ACTUAL diamond side slope (diamondTangent = half-height / half-width),
  // not getAngleTangent(layout). getDiamondPorts places ports using the bounding-box
  // dimensions, so only the geometric tangent guarantees preEntry lies exactly on the
  // named-port approach ray and the shelf lands at the correct height.
  if (diamondTargetPorts) {
    const diagonalEntryStub = Math.max(24, params.loopLaneDistance * 0.4);
    const stubDx = diagonalEntryStub;
    const diamondTangent = (toBounds.bottom - toBounds.centerY) / (toBounds.centerX - toBounds.left);
    const stubDy = stubDx * diamondTangent;
    const leftDoglegEntries = [
      {
        targetEntry: "target-nw",
        end: diamondTargetPorts.NW,
        preEntry: getDiamondDoglegPreEntry("NW", diamondTargetPorts.NW, stubDx, stubDy),
        directionSuffix: "nw-dogleg",
        reason: "outsideLaneGlobalBottomSourceExitNWDogleg",
      },
      {
        targetEntry: "target-sw",
        end: diamondTargetPorts.SW,
        preEntry: getDiamondDoglegPreEntry("SW", diamondTargetPorts.SW, stubDx, stubDy),
        directionSuffix: "sw-dogleg",
        reason: "outsideLaneGlobalBottomSourceExitSWDogleg",
      },
    ];
    for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
      const sourceExitY = Math.max(
        leftStart[1] + sourceOffsetStep * (sourceExitRank + 1),
        placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
      );
      for (const entry of leftDoglegEntries) {
        for (let rank = 0; rank < 12; rank += 1) {
          const laneX = leftBoundary - params.loopLaneDistance - depth * 18 - rank * laneStep;
          const points = [
            leftStart,
            [leftStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, entry.preEntry[1]],
            entry.preEntry,
            entry.end,
          ];
          candidates.push({
            side: "left",
            direction: `left-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: entry.reason,
          });
        }
      }
    }
  }

  // Target-local diagonal dogleg candidates for right-side corner ports NE and SE.
  // Symmetric to the left-side NW/SW block above. Same diamondTangent rationale applies.
  if (diamondTargetPorts) {
    const diagonalEntryStub = Math.max(24, params.loopLaneDistance * 0.4);
    const stubDx = diagonalEntryStub;
    const diamondTangent = (toBounds.bottom - toBounds.centerY) / (toBounds.centerX - toBounds.left);
    const stubDy = stubDx * diamondTangent;
    const rightDoglegEntries = [
      {
        targetEntry: "target-ne",
        end: diamondTargetPorts.NE,
        preEntry: getDiamondDoglegPreEntry("NE", diamondTargetPorts.NE, stubDx, stubDy),
        directionSuffix: "ne-dogleg",
        reason: "outsideLaneGlobalBottomSourceExitNEDogleg",
      },
      {
        targetEntry: "target-se",
        end: diamondTargetPorts.SE,
        preEntry: getDiamondDoglegPreEntry("SE", diamondTargetPorts.SE, stubDx, stubDy),
        directionSuffix: "se-dogleg",
        reason: "outsideLaneGlobalBottomSourceExitSEDogleg",
      },
    ];
    for (let sourceExitRank = 0; sourceExitRank < 4; sourceExitRank += 1) {
      const sourceExitY = Math.max(
        rightStart[1] + sourceOffsetStep * (sourceExitRank + 1),
        placedBounds.bottom + params.loopLaneDistance + globalSourceExitStep * sourceExitRank,
      );
      for (const entry of rightDoglegEntries) {
        for (let rank = 0; rank < 8; rank += 1) {
          const laneX = rightBoundary + params.loopLaneDistance + depth * 18 + rank * laneStep;
          const points = [
            rightStart,
            [rightStart[0], sourceExitY],
            [laneX, sourceExitY],
            [laneX, entry.preEntry[1]],
            entry.preEntry,
            entry.end,
          ];
          candidates.push({
            side: "right",
            direction: `right-outside-source-global-bottom-${entry.directionSuffix}`,
            laneRank: rank,
            laneX,
            sourceExit: "source-global-bottom",
            sourceExitY,
            sourceExitRank,
            points,
            targetEntry: entry.targetEntry,
            reason: entry.reason,
          });
        }
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
  drawingState = null,
}) {
  const targetNodePlacement = placedByNodeId.get(edge.to) ?? null;
  const targetIsDiamond = targetNodePlacement?.node?.kind === "conditionalJump";
  const candidates = buildLoopReturnRouteCandidates({
    edge,
    fromBounds,
    toBounds,
    layout,
    params,
    depth,
    placedByNodeId,
    targetIsDiamond,
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
  // Pre-compute which named diamond ports on the target are already occupied by committed
  // non-HALT edges, so the sort can prefer unoccupied same-side ports.
  const occupiedDiamondPortNames = (() => {
    const names = new Set();
    if (targetIsDiamond) {
      for (const [committedEdgeId, committedRoute] of edgeRouteById) {
        if (committedEdgeId === edge.id) continue;
        const committedEdge = edgesById.get(committedEdgeId) ?? null;
        if (!committedEdge || committedEdge.to !== edge.to || isHaltEdge(committedEdge, instructionCount)) continue;
        const cpts = committedRoute.points ?? [];
        if (cpts.length === 0) continue;
        const snapped = snapToDiamondPort(toBounds, cpts[cpts.length - 1]);
        if (snapped) names.add(snapped.name);
      }
    }
    return names;
  })();
  const withSoftCrossings = clearanceEvaluated.map((c, originalIndex) => {
    const crossings = countLoopReturnCrossings({
      candidatePoints: c.route.points,
      edge,
      edgeRouteById,
      edgesById,
      instructionCount,
      excludeEdgeIds: new Set([edge.id]),
      collectLedger: true,
      toBounds: targetIsDiamond ? toBounds : null,
    });
    const lastPoint = c.route.points[c.route.points.length - 1];
    const snapped = (targetIsDiamond && lastPoint) ? snapToDiamondPort(toBounds, lastPoint) : null;
    const targetPortName = snapped?.name ?? null;
    // Soft adjacency penalty: count port-adjacent-endpoint exemptions where this candidate's
    // final approach runs through a named diamond port that a committed same-target edge already
    // terminates at (e.g. SW dogleg approach passing through occupied W from I27 -> I4.W).  These
    // remain hard-legal (the exemption stands), but lose the ranking tie to a clean approach.
    const portAdjacentEndpointTouchCount = crossings.ledger.reduce(
      (n, entry) => n + (
        entry.exemptReason === "port-adjacent-endpoint" &&
        entry.committedEndPortName !== null &&
        occupiedDiamondPortNames.has(entry.committedEndPortName)
          ? 1 : 0
      ),
      0,
    );
    return {
      ...c,
      softCrossingCount: crossings.total,
      sameTargetCrossingCount: crossings.sameTarget,
      softCrossingLedger: crossings.ledger,
      targetPortName,
      targetPortOccupied: targetPortName !== null && occupiedDiamondPortNames.has(targetPortName),
      portAdjacentEndpointTouchCount,
      turnCount: Math.max(0, c.route.points.length - 2),
      originalIndex,
    };
  });
  // Decision use of blockerRows is limited to "does a 'pending branch corridor' row exist?"
  // (preferredSidePendingCorridorBlocked / hasPendingCorridorCandidateBlocker). Such rows are
  // produced ONLY by the corridor section, so when the cheap corridor scan is empty the full
  // top-8 blockingRows can contain no pending row regardless of truncation, and an empty
  // blockerRows yields a byte-identical decision. We then skip the expensive node/edge scan on
  // the lean render path. Debug mode (drawingState.diagnosticsEnabled !== false) keeps full rows.
  const loopReturnDiagnosticsEnabled = drawingState?.diagnosticsEnabled !== false;
  // Committed geometry is fixed across this edge's candidate evaluation (no placement/routing
  // mutation occurs here), so compute the committed node boxes and edge segments once and share
  // them across every candidate's findRouteRejection / collectRouteBlockingRows call. Exclusions
  // match those calls exactly and Map iteration order is preserved, so per-candidate rejection
  // results and first-rejection identity are unchanged.
  const sharedExcludeNodeIds = new Set([edge.from, edge.to]);
  const sharedCommittedNodeBoxes = getCommittedNodeBoxes(placedByNodeId, layout, sharedExcludeNodeIds);
  const sharedCommittedEdgeSegments = getCommittedEdgeSegments({
    edgeRouteById,
    edgesById,
    instructionCount,
    excludeEdgeIds: new Set([edge.id]),
    excludeNodeIds: sharedExcludeNodeIds,
  });
  const legalityEvaluated = withSoftCrossings.map((candidate) => {
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
      committedNodeBoxes: sharedCommittedNodeBoxes,
      committedEdgeSegments: sharedCommittedEdgeSegments,
    });
    const collectFullBlockerRows = () => collectRouteBlockingRows({
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
      committedNodeBoxes: sharedCommittedNodeBoxes,
      committedEdgeSegments: sharedCommittedEdgeSegments,
    });
    let blockerRows;
    if (loopReturnDiagnosticsEnabled) {
      blockerRows = collectFullBlockerRows();
    } else {
      const corridorRows = collectPendingCorridorBlockingRows({
        segments: routeSegments(candidate.route?.points ?? []),
        edge,
        pendingCorridorByEdgeId,
        excludePendingEdgeIds: new Set(),
      });
      blockerRows = corridorRows.length === 0
        ? { rows: [], omittedCount: 0 }
        : collectFullBlockerRows();
    }
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
  // When preferred side has no legal candidates, use the best-ranked preferred-side candidate
  // (even if rejected) rather than silently routing to the geometrically-convenient opposite side.
  const preferredSideFailed = Boolean(preferredSide && !preferredLegalCandidate);
  const bestRejectedPreferredCandidate = preferredSideFailed
    ? (legalityEvaluated.find((c) => c.side === preferredSide) ?? null)
    : null;
  // Preferred side is the primary constraint.  Among legal preferred-side candidates,
  // sort by: (1) soft X-crossing count ascending, (2) belowClearanceThreshold ascending,
  // (3) original candidate order (port preference).  This ensures a same-side alternate
  // port that avoids a crossing is picked over the default port that crosses, while still
  // keeping any preferred-side candidate (even a crossing one) ahead of wrong-side routes.
  const preferredSideLegalCandidates = preferredSide
    ? legalCandidates.filter((c) => c.side === preferredSide)
    : [];
  // Sort preferred-side legal candidates:
  //  1. softCrossingCount ASC (fewer X-crossings)
  //  2. sameTargetCrossingCount ASC (fewer same-target crossings)
  //  3. targetPortOccupied ASC (unoccupied port preferred over occupied)
  //  4. turnCount ASC (fewer bends)
  //  5. portAdjacentEndpointTouchCount ASC (clean approach preferred over one whose final
  //     diagonal runs through an occupied adjacent port — see SW vs NW for I52 -> I4)
  //  6. originalIndex ASC (existing fixed port order as tiebreaker: W→NW→SW→N→S→…)
  // Rule 3 captures the "lower-same-side dominance" (e.g. SW beats NW when W is occupied
  // and both are unoccupied with equal crossings/turns) by preserving original order among
  // equally unoccupied candidates — SW is generated after NW in the candidate list, but when
  // W is occupied both NW and SW get occupied=0 and originalIndex breaks the tie.
  // Rule 5 is the new soft adjacency penalty: among equally-unoccupied, equal-crossing,
  // equal-turn candidates, one whose final approach touches an occupied adjacent port
  // (the hard-exempted port-adjacent-endpoint contact) loses to a clean approach.
  const preferredSideSorted = [...preferredSideLegalCandidates].sort((a, b) => {
    if (a.softCrossingCount !== b.softCrossingCount) return a.softCrossingCount - b.softCrossingCount;
    if (a.sameTargetCrossingCount !== b.sameTargetCrossingCount) return a.sameTargetCrossingCount - b.sameTargetCrossingCount;
    const aOcc = a.targetPortOccupied ? 1 : 0;
    const bOcc = b.targetPortOccupied ? 1 : 0;
    if (aOcc !== bOcc) return aOcc - bOcc;
    if (a.turnCount !== b.turnCount) return a.turnCount - b.turnCount;
    const aAdj = a.portAdjacentEndpointTouchCount ?? 0;
    const bAdj = b.portAdjacentEndpointTouchCount ?? 0;
    if (aAdj !== bAdj) return aAdj - bAdj;
    return (a.originalIndex ?? 0) - (b.originalIndex ?? 0);
  });
  const bestPreferredSideLegalCandidate = preferredSideSorted[0] ?? null;
  const accepted = bestPreferredSideLegalCandidate ??
    bestRejectedPreferredCandidate ??
    legalCandidates[0] ??
    legalityEvaluated.find((candidate) => !candidate.belowClearanceThreshold) ??
    legalityEvaluated[0];
  const primaryTargetEntry = preferredSide === "left" ? "left-side-center"
    : preferredSide === "right" ? "right-side-center"
    : null;
  const sketchV3LoopReturnSameSideAlternatePortTried = Boolean(
    preferredSide &&
    preferredSideLegalCandidates.some((c) => c.targetEntry !== primaryTargetEntry),
  );
  const sketchV3LoopReturnSameSideAlternatePortSelected = Boolean(
    accepted.side === preferredSide &&
    primaryTargetEntry !== null &&
    accepted.targetEntry !== primaryTargetEntry,
  );
  const sketchV3LoopReturnWrongSideRejectedOrDeferred = Boolean(
    preferredSide &&
    accepted.side !== preferredSide,
  );
  const sketchV3LoopReturnSoftCrossingCount = accepted.softCrossingCount ?? 0;
  const sketchV3LoopReturnSameTargetCrossingCount = accepted.sameTargetCrossingCount ?? 0;
  const sketchV3LoopReturnCrossingAvoidedByAlternatePort = Boolean(
    sketchV3LoopReturnSameSideAlternatePortSelected &&
    sketchV3LoopReturnSoftCrossingCount === 0 &&
    (preferredLegalCandidate?.softCrossingCount ?? 0) > 0,
  );
  const sketchV3LoopReturnCrossingAcceptedAsUnavoidable = Boolean(
    preferredSide &&
    accepted.side === preferredSide &&
    sketchV3LoopReturnSoftCrossingCount > 0 &&
    preferredSideLegalCandidates.every((c) => c.softCrossingCount > 0),
  );
  const sketchV3LoopReturnSelectedPortName = accepted.targetPortName ?? null;
  const sketchV3LoopReturnSelectedTurnCount = accepted.turnCount ?? 0;
  const firstPreferredSideLegalByOriginalOrder = preferredSideLegalCandidates.length > 0
    ? [...preferredSideLegalCandidates].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0))[0]
    : null;
  const sketchV3LoopReturnOccupiedPortAvoided = Boolean(
    firstPreferredSideLegalByOriginalOrder?.targetPortOccupied &&
    !accepted.targetPortOccupied,
  );
  const sketchV3LoopReturnUnoccupiedSameSidePortSelected = Boolean(
    accepted.side === preferredSide &&
    targetIsDiamond &&
    accepted.targetPortOccupied === false &&
    accepted.targetPortName !== null,
  );
  const sketchV3LoopReturnLowerSameSidePortSelected = Boolean(
    (accepted.targetPortName === "SW" && accepted.side === "left") ||
    (accepted.targetPortName === "SE" && accepted.side === "right"),
  );
  // Per-candidate diagnostic for all preferred-side candidates (legal and rejected).
  // Answers Q1–Q4: crossing ledgers, port occupancy, rank, and whether a candidate was selected.
  const preferredSideCandidateDiagnostics = preferredSide
    ? legalityEvaluated
        .filter((c) => c.side === preferredSide)
        .map((c) => ({
          targetPortName: c.targetPortName ?? null,
          targetEntry: c.targetEntry ?? null,
          routePoints: c.route?.points ?? [],
          turnCount: c.turnCount ?? 0,
          targetPortOccupied: c.targetPortOccupied ?? false,
          portAdjacentEndpointTouchCount: c.portAdjacentEndpointTouchCount ?? 0,
          softCrossingCount: c.softCrossingCount ?? 0,
          sameTargetCrossingCount: c.sameTargetCrossingCount ?? 0,
          originalIndex: c.originalIndex ?? null,
          rankInSorted: preferredSideSorted.indexOf(c),
          selected: c === accepted,
          rejected: Boolean(c.rejection),
          rejectionKind: c.rejection?.rejectionKind ?? null,
          softCrossingLedger: c.softCrossingLedger ?? [],
          edgeVsNodeRejectionDetail: c.rejection?.rejectionKind === "edge-vs-node" ? {
            blockingGeometryId: c.rejection.blockingGeometryId ?? null,
            blockingNodeInstructionIndex: c.rejection.blockingNodeInstructionIndex ?? null,
            blockingSegmentIndex: c.rejection.blockingSegmentIndex ?? null,
            clearanceToExpandedBounds: c.rejection.clearance ?? null,
            blockingExpandedBounds: c.rejection.blockingExpandedBounds ?? null,
            blockingNodeBounds: c.rejection.blockingNodeBounds ?? null,
            distanceToActualNodeBounds: c.rejection.distanceToActualNodeBounds ?? null,
          } : null,
        }))
    : [];
  const legalCandidateCount = legalCandidates.length;
  const candidatePendingBranchCorridorConflictRows = withSoftCrossings
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
      sketchV3LoopReturnPreferredSideFailed: preferredSideFailed,
      sketchV3LoopReturnWrongSideRejected: Boolean(preferredSide && accepted.side !== preferredSide),
      sketchV3LoopReturnSameSideAlternatePortTried,
      sketchV3LoopReturnSameSideAlternatePortSelected,
      sketchV3LoopReturnWrongSideRejectedOrDeferred,
      sketchV3LoopReturnSoftCrossingCount,
      sketchV3LoopReturnSameTargetCrossingCount,
      sketchV3LoopReturnCrossingAvoidedByAlternatePort,
      sketchV3LoopReturnCrossingAcceptedAsUnavoidable,
      sketchV3LoopReturnSelectedPortName,
      sketchV3LoopReturnSelectedTurnCount,
      sketchV3LoopReturnOccupiedPortAvoided,
      sketchV3LoopReturnUnoccupiedSameSidePortSelected,
      sketchV3LoopReturnLowerSameSidePortSelected,
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
      committedEdgeCountAtScoring: edgeRouteById.size,
      preferredSideCandidateDiagnostics,
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
  orientation = DEFAULT_BRANCH_ORIENTATION,
}) {
  const fromBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const toBounds = getNodeBoundsAt(targetPlacement.node, targetPlacement, layout);

  if (sourcePlacement.node.kind === "conditionalJump" && edge.branch) {
    const anchors = getDiamondAnchors(fromBounds);
    // Manual override only: callers that don't pass an orientation (sibling route
    // reservation, already-drawn-target routing) must still see the overridden
    // visual side, otherwise previews disagree with the committed geometry.
    const effectiveOrientation = getOverrideOrientationForDiamond(sourcePlacement.node) ?? orientation;
    const rbpVisualSide = getBranchVisualSide(edge.branch, effectiveOrientation);
    const start = rbpVisualSide === "left" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
    const end = getTopPort(toBounds);
    return makeDiamondExitRoute({ edge, start, end, layout, alreadyDrawnTarget, orientation: effectiveOrientation });
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
      drawingState,
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

function getBranchPosition({ edge, sourcePlacement, targetNode, layout, params, depth, orientation = DEFAULT_BRANCH_ORIENTATION }) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const posVisualSide = getBranchVisualSide(edge.branch, orientation);
  const start = posVisualSide === "left" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
  const direction = posVisualSide === "left" ? -1 : 1;
  const distance = getSplitDistance(params, depth);
  const routeDy = distance * getAngleTangent(layout);
  const targetSize = getNodeSize(targetNode, layout);
  return {
    x: start[0] + direction * distance,
    y: start[1] + routeDy + targetSize.height / 2,
  };
}

function getBranchPlacementCandidate({ edge, sourcePlacement, targetNode, layout, params, depth, distanceScale = 1, extraY = 0, orientation = DEFAULT_BRANCH_ORIENTATION }) {
  const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
  const anchors = getDiamondAnchors(sourceBounds);
  const candVisualSide = getBranchVisualSide(edge.branch, orientation);
  const start = candVisualSide === "left" ? anchors.lowerLeftSideCenter : anchors.lowerRightSideCenter;
  const direction = candVisualSide === "left" ? -1 : 1;
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
      orientation,
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
  // Manual override only: the lookahead must preview this diamond's branches on
  // the same visual sides the real placement will use.
  const overrideOrientationForNode = getOverrideOrientationForDiamond(node);
  const lookaheadOrientation = overrideOrientationForNode ?? DEFAULT_BRANCH_ORIENTATION;
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
      orientation: lookaheadOrientation,
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
      orientation: lookaheadOrientation,
    }));
  }

  const candidates = getBranchPlacementCandidates({
    edge: noEdge,
    sourcePlacement: targetPlacement,
    targetNode: noTargetNode,
    layout,
    params,
    depth,
    orientation: lookaheadOrientation,
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

  // Manual override only: a flipped diamond also needs its yes branch to fit on
  // the overridden side. Without this, the diamond settles at a position whose
  // no side fits but whose yes side is blocked, and the flip fails much later
  // when the pending yes branch is popped with nowhere to go.
  if (overrideOrientationForNode && yesEdge && yesTargetNode && !placedByNodeId.has(yesTargetNode.id)) {
    // The pending yes corridor is retired before the branch is drawn, so the
    // preview must not test the yes route against its own corridor.
    const yesLookaheadCorridors = new Map(lookaheadPendingCorridorByEdgeId);
    yesLookaheadCorridors.delete(yesEdge.id);
    const yesCandidates = getBranchPlacementCandidates({
      edge: yesEdge,
      sourcePlacement: targetPlacement,
      targetNode: yesTargetNode,
      layout,
      params,
      depth,
      orientation: lookaheadOrientation,
    });
    const yesEvaluated = yesCandidates.map((lookaheadCandidate) => evaluatePlacementCandidate({
      candidate: lookaheadCandidate,
      node: yesTargetNode,
      incomingEdge: yesEdge,
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
      pendingCorridorByEdgeId: yesLookaheadCorridors,
      includeConditionalLookahead: false,
    }));
    if (!yesEvaluated.some((lookaheadCandidate) => !lookaheadCandidate.rejection)) {
      const firstYesRejection = yesEvaluated.find((lookaheadCandidate) => lookaheadCandidate.rejection)?.rejection ?? null;
      return {
        candidateNodeId: node.id,
        candidateEdgeId: incomingEdge?.id ?? null,
        rejectionKind: "conditional-override-yes-branch-reservation",
        blockingGeometryId: firstYesRejection?.blockingGeometryId ?? yesEdge.id,
        blockingGeometryRole: firstYesRejection?.blockingGeometryRole ?? "override yes-branch reservation",
        clearance: firstYesRejection?.clearance ?? null,
        candidatePoints: route?.points ?? candidate.route?.points ?? null,
        pendingCorridorPart: firstYesRejection?.pendingCorridorPart ?? null,
        lookaheadEdgeId: yesEdge.id,
        lookaheadTargetNodeId: yesTargetNode.id,
        lookaheadRejectedCandidateCount: yesEvaluated.filter((lookaheadCandidate) => lookaheadCandidate.rejection).length,
        lookaheadFirstRejection: firstYesRejection,
      };
    }
  }

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

// --- Terminal-sink HALT routing quality model ---------------------------------
//
// HALT is a terminal sink. A HALT route should move monotonically toward the
// shared HALT node's entry port, with as few bends as possible. It should not
// travel past HALT and then return, it should not detour out to a far vertical
// collector lane and diagonally back in (the "triangular fan"), and it should
// not back away from HALT before approaching it.
//
// These helpers measure those properties on a candidate's route geometry and
// turn them into a single comparable cost, so candidate selection can prefer a
// clean low-bend route instead of simply taking the first collision-free one.

// HALT routes approach the shared HALT node through one horizontal port:
//  - right-side HALT: enter the LEFT port, so monotone motion has increasing x
//  - left-side HALT (degenerate/fallback): enter the RIGHT port (decreasing x)
// We treat the entry port x as the "goal line"; reaching beyond it means the
// route overshot HALT and must come back.
function analyzeHaltRouteGeometry(points, haltEntry, params) {
  const tol = 0.5;
  const fanDyThreshold = Math.max(params.ordinaryStepY * 0.5, SKETCH_V3_LANE_CLEARANCE * 4);
  const backtrackThreshold = Math.max(SKETCH_V3_LANE_CLEARANCE * 2, params.haltDistance * 0.2);
  const entryX = haltEntry[0];
  const entryY = haltEntry[1];
  const startX = points[0]?.[0] ?? entryX;

  // HALT sits to the right of every source in the normal case; detect the rare
  // left-side entry so the monotonicity test points the right way.
  const goalIsRight = entryX >= startX;

  let bends = 0;
  let diagonalSegments = 0;
  let maxDiagonalDy = 0;
  let length = 0;
  let extremeBeyondGoal = 0; // furthest the path travels past the entry port
  let extremeAwayFromGoal = 0; // furthest the path backs away from the source

  let prevDir = null;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    length += Math.hypot(dx, dy);

    if (Math.abs(dx) > tol && Math.abs(dy) > tol) {
      diagonalSegments += 1;
      maxDiagonalDy = Math.max(maxDiagonalDy, Math.abs(dy));
    }

    const dir = `${Math.sign(Math.abs(dx) > tol ? dx : 0)},${Math.sign(Math.abs(dy) > tol ? dy : 0)}`;
    if (prevDir !== null && dir !== prevDir && dir !== "0,0") bends += 1;
    if (dir !== "0,0") prevDir = dir;
  }

  for (const [x] of points) {
    if (goalIsRight) {
      extremeBeyondGoal = Math.max(extremeBeyondGoal, x - entryX);
      extremeAwayFromGoal = Math.max(extremeAwayFromGoal, startX - x);
    } else {
      extremeBeyondGoal = Math.max(extremeBeyondGoal, entryX - x);
      extremeAwayFromGoal = Math.max(extremeAwayFromGoal, x - startX);
    }
  }

  const travelsPastHaltAndReturns = extremeBeyondGoal > tol;
  const movesAwayFromHaltBeforeReturning = extremeAwayFromGoal > backtrackThreshold;
  const formsLargeTriangleFan = diagonalSegments > 0 && maxDiagonalDy > fanDyThreshold;

  return {
    bends,
    diagonalSegments,
    maxDiagonalDy,
    length,
    approachOffset: entryY - (points[points.length - 1]?.[1] ?? entryY),
    extremeBeyondGoal,
    extremeAwayFromGoal,
    travelsPastHaltAndReturns,
    movesAwayFromHaltBeforeReturning,
    formsLargeTriangleFan,
  };
}

// A candidate that uses one of the far outside collector lanes (left exterior,
// global-bottom, or top/bottom outside sweeps) is flagged so the cost model can
// keep it strictly as a last resort behind any clean interior route.
function haltCandidateUsesOutsideLane(candidate) {
  if (!candidate) return false;
  if (candidate.side === "left") return true;
  const direction = String(candidate.direction ?? "");
  return direction.includes("outside") || direction.includes("global-bottom");
}

// Lower is better. Hard geometry defects (past-HALT-and-return, large triangular
// fan) and outside-lane usage are pushed far above any ordinary interior route so
// they are only ever selected when nothing cleaner is collision-free. Among clean
// candidates the model prefers fewer bends, no diagonals, an approach near the
// HALT center, and a shorter path.
const HALT_COST_PAST_HALT = 1e9;
const HALT_COST_FAN = 1e9;
const HALT_COST_OUTSIDE_LANE = 5e6;
const HALT_COST_BACKTRACK = 5e6;
const HALT_COST_DIAGONAL = 4e4;
const HALT_COST_BEND = 1e3;

function scoreHaltRouteCandidate(candidate, metrics) {
  let cost = 0;
  cost += metrics.bends * HALT_COST_BEND;
  cost += metrics.diagonalSegments * HALT_COST_DIAGONAL;
  cost += Math.abs(metrics.approachOffset) * 2;
  cost += metrics.length * 0.05;
  if (haltCandidateUsesOutsideLane(candidate)) cost += HALT_COST_OUTSIDE_LANE;
  if (metrics.movesAwayFromHaltBeforeReturning) cost += HALT_COST_BACKTRACK;
  if (metrics.travelsPastHaltAndReturns) cost += HALT_COST_PAST_HALT;
  if (metrics.formsLargeTriangleFan) cost += HALT_COST_FAN;
  return cost;
}

// --- Hard terminal-sink geometry validator -----------------------------------
//
// The cost model alone is not enough: some HALT route shapes must be treated as
// geometrically *illegal*, not merely expensive. These helpers reject any
// candidate that touches HALT before its final segment, arrives-leaves-returns,
// overshoots to the far side of HALT, or forms a triangular fan/flag with HALT
// as a vertex.

function expandRectBounds(bounds, pad) {
  return {
    left: bounds.left - pad,
    right: bounds.right + pad,
    top: bounds.top - pad,
    bottom: bounds.bottom + pad,
  };
}

function pointInsideRectBounds(point, rect, tol = 0) {
  return (
    point[0] >= rect.left - tol &&
    point[0] <= rect.right + tol &&
    point[1] >= rect.top - tol &&
    point[1] <= rect.bottom + tol
  );
}

function segmentIntersectsRectBounds(start, end, rect) {
  if (pointInsideRectBounds(start, rect) || pointInsideRectBounds(end, rect)) return true;
  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ];
  for (let i = 0; i < 4; i += 1) {
    if (segmentsIntersect(start, end, corners[i], corners[(i + 1) % 4])) return true;
  }
  return false;
}

// Returns { valid, reason }. In strict mode a diagonal final-entry segment is
// rejected; the relaxed mode (allowDiagonalFinal) still rejects every other
// illegal topology, so a diagonal entry is only ever permitted when no
// orthogonal route is legal AND it does not form a fan.
function validateTerminalHaltRoute(candidate, haltBounds, haltLandingZone, params, { allowDiagonalFinal = false } = {}) {
  const points = candidate?.route?.points ?? [];
  if (points.length < 2) return { valid: false, reason: "emptyHaltRoute" };
  const tol = 0.5;
  const clearance = Math.max(SKETCH_V3_LANE_CLEARANCE, params.haltDistance * 0.08);
  const expanded = expandRectBounds(haltBounds, clearance);
  const entry = points[points.length - 1];
  const penult = points[points.length - 2];
  const segs = routeSegments(points);
  const finalSeg = segs[segs.length - 1];
  const goalIsRight = entry[0] >= points[0][0];

  // Rule 4: never travel to the far side of HALT and return.
  for (const p of points) {
    if (goalIsRight ? p[0] > haltBounds.right + tol : p[0] < haltBounds.left - tol) {
      return { valid: false, reason: "extendsBeyondHaltFarSide" };
    }
  }

  // Rules 1 & 3: no non-final segment may intersect/touch the expanded HALT
  // bounds, and the final approach must begin from outside those bounds.
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segmentIntersectsRectBounds(segs[i].start, segs[i].end, expanded)) {
      return { valid: false, reason: "haltBoundsTouchedBeforeFinalSegment" };
    }
  }
  // The final approach must begin strictly outside the expanded bounds on the
  // entry side, so the last segment is a clean perpendicular entry rather than a
  // vertical graze along the HALT edge into the port.
  const finalApproachFromEntrySide = goalIsRight
    ? penult[0] <= expanded.left + tol
    : penult[0] >= expanded.right - tol;
  if (!finalApproachFromEntrySide) {
    return { valid: false, reason: "finalApproachStartsInsideHaltBounds" };
  }

  // Rule 5: reject diagonal final-entry unless explicitly relaxed.
  if (finalSeg) {
    const fdx = Math.abs(finalSeg.end[0] - finalSeg.start[0]);
    const fdy = Math.abs(finalSeg.end[1] - finalSeg.start[1]);
    if (fdx > tol && fdy > tol && !allowDiagonalFinal) {
      return { valid: false, reason: "diagonalFinalEntry" };
    }
  }

  // Rules 2 & 4: arrive-leave-return. Once the polyline enters the HALT
  // neighborhood its distance to the entry anchor must not increase again.
  const haltSpan = Math.max(haltBounds.right - haltBounds.left, haltBounds.bottom - haltBounds.top);
  const neighborhoodR = Math.max(params.haltDistance * 0.9, haltSpan * 1.5 + clearance * 2);
  let entered = false;
  let minDistSoFar = Infinity;
  for (const p of points) {
    const dist = Math.hypot(p[0] - entry[0], p[1] - entry[1]);
    if (dist <= neighborhoodR) entered = true;
    if (entered) {
      if (dist > minDistSoFar + tol) {
        return { valid: false, reason: "arriveLeaveReturnNearHalt" };
      }
      minDistSoFar = Math.min(minDistSoFar, dist);
    }
  }

  // Rule 6: triangular fan/flag — a diagonal segment with a tall vertical drop
  // whose endpoint sits inside the HALT neighborhood.
  const fanDy = Math.max(SKETCH_V3_LANE_CLEARANCE * 2, params.ordinaryStepY * 0.35);
  for (const seg of segs) {
    const dx = Math.abs(seg.end[0] - seg.start[0]);
    const dy = Math.abs(seg.end[1] - seg.start[1]);
    if (dx > tol && dy > tol && dy > fanDy) {
      const nearHalt =
        Math.hypot(seg.end[0] - entry[0], seg.end[1] - entry[1]) <= neighborhoodR ||
        Math.hypot(seg.start[0] - entry[0], seg.start[1] - entry[1]) <= neighborhoodR;
      if (nearHalt) return { valid: false, reason: "triangularFanNearHalt" };
    }
  }

  // Rule: the entry anchor should lie within the assigned landing zone (keeps
  // arrowheads on the HALT node's edge rather than floating off it).
  if (haltLandingZone) {
    if (entry[1] < haltLandingZone.top - clearance || entry[1] > haltLandingZone.bottom + clearance) {
      return { valid: false, reason: "entryOutsideLandingZone" };
    }
  }

  return { valid: true, reason: null };
}

function dedupeRoutePoints(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || !pointsEqual(prev, p)) out.push(p);
  }
  return out;
}

// Generates clean terminal-sink candidates that route to an assigned landing
// slot (a distinct y on HALT's near edge) and enter HALT with a single
// horizontal final segment. These are the preferred shapes; legacy candidates
// remain available only as a collision fallback behind the validator.
function buildTerminalHaltLandingCandidates({ edge, sourceBounds, haltBounds, landingY, params }) {
  const tol = 0.5;
  const approachGap = Math.max(SKETCH_V3_LANE_CLEARANCE * 2, params.haltDistance * 0.18);
  const entry = [haltBounds.left, landingY];
  const maxLaneX = haltBounds.left - approachGap;
  const minLaneX = sourceBounds.right + Math.max(SKETCH_V3_LANE_CLEARANCE, params.haltDistance * 0.25);
  const laneStep = Math.max(SKETCH_V3_LANE_CLEARANCE * 3, params.loopLaneDistance * 0.5);
  const laneXs = [];
  for (let x = maxLaneX; x >= minLaneX - tol && laneXs.length < 8; x -= laneStep) laneXs.push(x);
  if (laneXs.length === 0) laneXs.push(maxLaneX);

  const sourceExits = [
    { key: "right", start: getRightPort(sourceBounds) },
    { key: "bottom", start: getBottomPort(sourceBounds) },
    { key: "top", start: getTopPort(sourceBounds) },
  ];
  const exitOffsets = [0, params.ordinaryStepY * 0.6, params.ordinaryStepY * 1.2];

  const candidates = [];
  sourceExits.forEach(({ key, start }, sourceExitRank) => {
    laneXs.forEach((laneX, laneRank) => {
      const variantPointSets = [];
      if (key === "right") {
        if (Math.abs(start[1] - landingY) <= tol) {
          variantPointSets.push([start, [laneX, landingY], entry]);
        } else {
          variantPointSets.push([start, [laneX, start[1]], [laneX, landingY], entry]);
        }
      } else {
        exitOffsets.forEach((off) => {
          const base = params.ordinaryStepY * 0.6;
          const exitY = key === "bottom" ? start[1] + base + off : start[1] - base - off;
          variantPointSets.push([start, [start[0], exitY], [laneX, exitY], [laneX, landingY], entry]);
        });
      }
      variantPointSets.forEach((pts, variantRank) => {
        candidates.push({
          laneX,
          laneRank,
          approachY: landingY,
          approachRank: 0,
          doglegX: laneX,
          doglegRank: variantRank,
          sourceExit: `${key}-port`,
          sourceExitRank,
          side: "right",
          direction: `terminal-halt-landing-${key}`,
          finalStyle: "horizontal-entry",
          reason: "terminalHaltLandingSlotCandidate",
          isLandingSlotCandidate: true,
          route: makeRoute(edge, dedupeRoutePoints(pts), "sketchV3HaltExit"),
        });
      });
    });
  });
  return candidates;
}

// Builds the per-exit diagnostic row recorded under haltRoutingDiagnostics.
function buildHaltRouteDiagnostic({
  edge,
  sourcePlacement,
  haltNodeId,
  sourcePort,
  route,
  metrics,
  usesOutsideLane,
  selectionCost = null,
  direction = null,
  finalStyle = null,
}) {
  const suspiciousReasons = [];
  if (metrics.travelsPastHaltAndReturns) suspiciousReasons.push("travelsPastHaltAndReturns");
  if (metrics.formsLargeTriangleFan) suspiciousReasons.push("largeTriangularFan");
  if (metrics.movesAwayFromHaltBeforeReturning) suspiciousReasons.push("movesAwayBeforeApproaching");
  if (usesOutsideLane) suspiciousReasons.push("usesOutsideCollectorLane");
  if (metrics.bends > 4) suspiciousReasons.push("excessiveBendsForTerminalEdge");
  if (metrics.diagonalSegments > 0) suspiciousReasons.push("diagonalApproach");
  return {
    edgeId: edge.id,
    sourceNodeId: edge.from ?? null,
    sourceInstructionIndex: Number.isInteger(sourcePlacement?.node?.instructionIndex)
      ? sourcePlacement.node.instructionIndex
      : (sourcePlacement?.node?.instructionIndices?.[0] ?? null),
    sourcePort: sourcePort ?? null,
    targetHaltNodeId: haltNodeId,
    direction,
    finalStyle,
    selectionCost,
    routePoints: clonePoints(route?.points),
    bendCount: metrics.bends,
    diagonalSegmentCount: metrics.diagonalSegments,
    routeLength: Math.round(metrics.length),
    usesOutsideCollectorLane: usesOutsideLane,
    movesAwayFromHaltBeforeReturning: metrics.movesAwayFromHaltBeforeReturning,
    travelsPastHaltAndReturns: metrics.travelsPastHaltAndReturns,
    formsLargeTriangleFan: metrics.formsLargeTriangleFan,
    suspicious: suspiciousReasons.length > 0,
    suspiciousReasons,
  };
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

  // The shared HALT node here is directly below the source, so the route enters
  // its TOP port; analyze against that entry to get accurate terminal-sink metrics.
  const localMetrics = analyzeHaltRouteGeometry(
    acceptedRoute.points,
    getTopPort(haltBounds),
    params,
  );
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
    haltRoutingDiagnostics: [{
      ...buildHaltRouteDiagnostic({
        edge,
        sourcePlacement,
        haltNodeId: sharedHaltNode.id,
        sourcePort: "bottom-port",
        route: acceptedRoute,
        metrics: localMetrics,
        usesOutsideLane: false,
        selectionCost: 0,
        direction: "local-direct-down",
        finalStyle: "local-direct",
      }),
      routed: true,
    }],
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
  diagnosticsEnabled = true,
}) {
  if (haltExits.length === 0) {
    return {
      sharedHaltNodeId: null,
      haltRows: [],
      haltConflictRows: [],
      haltRoutingDiagnostics: [],
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
  const haltRoutingDiagnostics = [];
  const haltBounds = getNodeBoundsAt(sharedHaltNode, haltPlacement, layout);
  const haltEntry = getLeftPort(haltBounds);

  // Assign each HALT exit a distinct landing slot (a y on HALT's near edge),
  // ordered by source y so the slots do not cross. Each exit then routes to its
  // slot and enters HALT with a single horizontal final segment.
  const exitCount = haltExits.length;
  const haltEdgeHeight = haltBounds.bottom - haltBounds.top;
  const slotSpacing = exitCount > 1
    ? Math.max(SKETCH_V3_LANE_CLEARANCE, haltEdgeHeight / (exitCount + 1))
    : 0;
  const landingYByExitIndex = new Map();
  haltExits
    .map((entry, idx) => ({ idx, y: entry.sourcePlacement?.y ?? medianY }))
    .sort((left, right) => left.y - right.y)
    .forEach((entry, slotRank) => {
      const offset = (slotRank - (exitCount - 1) / 2) * slotSpacing;
      landingYByExitIndex.set(entry.idx, haltBounds.centerY + offset);
    });
  const landingSpanHalf = exitCount > 1 ? ((exitCount - 1) / 2) * slotSpacing : 0;
  const haltLandingZone = {
    top: haltBounds.centerY - landingSpanHalf,
    bottom: haltBounds.centerY + landingSpanHalf,
  };

  haltExits.forEach(({ edge, sourcePlacement, depth, recordedOrder, haltExitRecordId }, haltIndex) => {
    edge.to = sharedHaltNode.id;
    const landingY = landingYByExitIndex.get(haltIndex) ?? haltBounds.centerY;
    const sourceBounds = getNodeBoundsAt(sourcePlacement.node, sourcePlacement, layout);
    // Preferred clean landing-slot candidates first, legacy candidates after as a
    // collision fallback. The validator culls illegal legacy shapes below.
    const candidates = [
      ...buildTerminalHaltLandingCandidates({ edge, sourceBounds, haltBounds, landingY, params }),
      ...buildDeferredHaltRouteCandidates({
        edge,
        sourcePlacement,
        haltPlacement,
        layout,
        params,
        placedByNodeId,
        haltIndex,
      }),
    ];
    // Committed geometry is fixed across this HALT exit's candidate evaluation (placement
    // and prior-exit routes do not change while these candidates are scored), so compute the
    // committed node boxes and edge segments once and share them across every candidate's
    // findRouteRejection / collectRouteBlockingRows call — mirroring the loop-return
    // shared-geometry path. Exclusions match those calls exactly (node boxes exclude
    // [edge.from, sharedHaltNode.id]; edge segments use excludeEdgeIds [edge.id] and
    // excludeNodeIds [edge.from]) and Map iteration order is preserved, so per-candidate
    // rejection results and first-rejection identity are byte-identical.
    const haltCommittedNodeBoxes = getCommittedNodeBoxes(
      placedByNodeId,
      layout,
      new Set([edge.from, sharedHaltNode.id]),
    );
    const haltCommittedEdgeSegments = getCommittedEdgeSegments({
      edgeRouteById,
      edgesById,
      instructionCount,
      excludeEdgeIds: new Set([edge.id]),
      excludeNodeIds: new Set([edge.from]),
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
        committedNodeBoxes: haltCommittedNodeBoxes,
        committedEdgeSegments: haltCommittedEdgeSegments,
      });
      // HALT selection uses only `rejection` (collision), validateTerminalHaltRoute, and
      // the cost model below — never the blocker rows. So the full blocker-row scan is
      // built only when diagnostics are enabled; makeRouteCandidateDiagnostic still keeps
      // `direction`/`firstRejection` (used by the directions Set and the failure record)
      // when blockerRows is null.
      const blockerRows = diagnosticsEnabled ? collectRouteBlockingRows({
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
        committedNodeBoxes: haltCommittedNodeBoxes,
        committedEdgeSegments: haltCommittedEdgeSegments,
      }) : null;
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
    // Terminal-sink selection, two stages:
    //   1. Hard geometry gate (validateTerminalHaltRoute): a candidate that
    //      touches HALT before its final segment, arrives-leaves-returns,
    //      overshoots to HALT's far side, or forms a triangular fan is treated as
    //      illegal, not merely expensive. Strict mode also forbids a diagonal
    //      final entry; it is only relaxed when no orthogonal route survives.
    //   2. Cost model: among the legal survivors pick the lowest-cost (fewest
    //      bends, near-center approach, shortest) route.
    const collisionFree = evaluated.filter((candidate) => !candidate.rejection);
    const validateInto = (allowDiagonalFinal) => collisionFree.filter((candidate) => {
      const verdict = validateTerminalHaltRoute(candidate, haltBounds, haltLandingZone, params, { allowDiagonalFinal });
      candidate.validatorVerdict = verdict;
      return verdict.valid;
    });
    let pool = validateInto(false);
    let selectionTier = "strict";
    if (pool.length === 0) {
      pool = validateInto(true);
      selectionTier = "relaxedDiagonalFinal";
    }
    // Absolute last resort: keep routability (no fallback regression) by allowing
    // a collision-free but geometrically-imperfect route, flagged suspicious.
    if (pool.length === 0) {
      pool = collisionFree;
      selectionTier = "lastResortValidatorBypassed";
    }
    let accepted = null;
    let acceptedCost = Infinity;
    for (const candidate of pool) {
      const metrics = analyzeHaltRouteGeometry(candidate.route.points, haltEntry, params);
      const cost = scoreHaltRouteCandidate(candidate, metrics);
      if (cost < acceptedCost) {
        accepted = candidate;
        acceptedCost = cost;
        accepted.haltMetrics = metrics;
        accepted.haltCost = cost;
        accepted.selectionTier = selectionTier;
      }
    }
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
      haltRoutingDiagnostics.push({
        edgeId: edge.id,
        sourceNodeId: edge.from ?? null,
        sourceInstructionIndex: Number.isInteger(sourcePlacement?.node?.instructionIndex)
          ? sourcePlacement.node.instructionIndex
          : (sourcePlacement?.node?.instructionIndices?.[0] ?? null),
        targetHaltNodeId: sharedHaltNode.id,
        routed: false,
        suspicious: true,
        suspiciousReasons: ["noLegalHaltRoute"],
      });
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
    const metrics = accepted.haltMetrics
      ?? analyzeHaltRouteGeometry(acceptedRoute.points, haltEntry, params);
    const diagnostic = buildHaltRouteDiagnostic({
      edge,
      sourcePlacement,
      haltNodeId: sharedHaltNode.id,
      sourcePort: accepted.sourceExit ?? null,
      route: acceptedRoute,
      metrics,
      usesOutsideLane: haltCandidateUsesOutsideLane(accepted),
      selectionCost: accepted.haltCost ?? null,
      direction: accepted.direction ?? null,
      finalStyle: accepted.finalStyle ?? null,
    });
    const validatorBypassed = accepted.selectionTier === "lastResortValidatorBypassed";
    if (validatorBypassed && !diagnostic.suspiciousReasons.includes("validatorBypassed")) {
      diagnostic.suspiciousReasons.push("validatorBypassed");
    }
    haltRoutingDiagnostics.push({
      ...diagnostic,
      suspicious: diagnostic.suspicious || validatorBypassed,
      routed: true,
      selectionTier: accepted.selectionTier ?? null,
      validatorBypassed,
    });
  });

  return {
    sharedHaltNodeId: sharedHaltNode.id,
    haltRows,
    haltConflictRows,
    haltRoutingDiagnostics,
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

// --- Split-orientation crossing-ownership diagnostics ---------------------------
// Explains each remaining route crossing in terms of branch ancestry: which two
// edges cross, the nearest diamond whose opposite sibling branches own them, and
// whether that diamond is a plausible visual-orientation flip candidate.
// Pure reporting over committed routes — never changes geometry.
const SPLIT_ORIENTATION_LOOKAHEAD_STEPS = 4;

function findStrictSegmentCrossingPoint(a, b, c, d) {
  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (!(o1 * o2 < -0.001 && o3 * o4 < -0.001)) return null;
  const denom = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denom;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

// The branch context an edge belongs to: its source node's branchPath, plus the
// edge itself when it is a diamond exit (so i-53-yes is owned by the yes branch
// of i-53, not by i-53's parent context).
function getEdgeOwnBranchPath(edge, drawingState) {
  const sourceRecord = drawingState?.nodesById?.get(edge.from) ?? null;
  const path = cloneBranchPath(sourceRecord?.branchPath);
  if (edge.branch) path.push(edge.id);
  return path;
}

function parseDiamondIdFromBranchPathEntry(entry) {
  if (typeof entry !== "string") return null;
  if (entry.endsWith("-no")) return entry.slice(0, -3);
  if (entry.endsWith("-yes")) return entry.slice(0, -4);
  return null;
}

function parseBranchKindFromBranchPathEntry(entry) {
  if (typeof entry !== "string") return null;
  if (entry.endsWith("-no")) return "no";
  if (entry.endsWith("-yes")) return "yes";
  return null;
}

function buildSplitOrientationDiagnostics({
  edges,
  edgeRouteById,
  drawingState,
  placedByNodeId,
}) {
  const routedEdges = edges
    .map((edge) => ({ edge, route: edgeRouteById.get(edge.id) ?? null }))
    .filter((entry) => Array.isArray(entry.route?.points) && entry.route.points.length >= 2);

  // BFS hop distance over the CFG, used to measure how many placed-node steps lie
  // between a candidate diamond and each crossing edge's source.
  const adjacency = new Map();
  edges.forEach((edge) => appendMapList(adjacency, edge.from, edge.to));
  const hopsBetween = (fromNodeId, toNodeId, maxHops = 12) => {
    if (fromNodeId === toNodeId) return 0;
    const seen = new Set([fromNodeId]);
    let frontier = [fromNodeId];
    for (let hop = 1; hop <= maxHops; hop += 1) {
      const next = [];
      for (const nodeId of frontier) {
        for (const neighbor of adjacency.get(nodeId) ?? []) {
          if (seen.has(neighbor)) continue;
          if (neighbor === toNodeId) return hop;
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return null;
  };

  const describeEdgeAtCrossing = (edge, segmentIndex, segment, branchPath, divergenceEntry) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    branch: edge.branch ?? null,
    segmentIndex,
    segment: [
      [segment.start[0], segment.start[1]],
      [segment.end[0], segment.end[1]],
    ],
    branchPath,
    divergenceEntry,
    semanticLabel: parseBranchKindFromBranchPathEntry(divergenceEntry),
    visualSideAtSplit: divergenceEntry
      ? getBranchVisualSideFromPathEntry(divergenceEntry, drawingState)
      : null,
  });

  const crossings = [];
  for (let i = 0; i < routedEdges.length; i += 1) {
    for (let j = i + 1; j < routedEdges.length; j += 1) {
      const { edge: edgeA, route: routeA } = routedEdges[i];
      const { edge: edgeB, route: routeB } = routedEdges[j];
      const segmentsA = routeSegments(routeA.points);
      const segmentsB = routeSegments(routeB.points);
      segmentsA.forEach((segA, segIndexA) => {
        segmentsB.forEach((segB, segIndexB) => {
          const point = findStrictSegmentCrossingPoint(segA.start, segA.end, segB.start, segB.end);
          if (!point) return;
          // Exempt intersections at a node both edges connect to — that is port
          // geometry (mirrors the port-adjacency exemptions in route checking),
          // not a visual crossing.
          const sharedNodeIds = [edgeA.from, edgeA.to]
            .filter((nodeId) => nodeId === edgeB.from || nodeId === edgeB.to);
          const nearSharedNode = sharedNodeIds.some((nodeId) => {
            const placementEntry = placedByNodeId.get(nodeId);
            return placementEntry &&
              Math.hypot(point[0] - placementEntry.x, point[1] - placementEntry.y) < 40;
          });
          if (nearSharedNode) return;

          const pathA = getEdgeOwnBranchPath(edgeA, drawingState);
          const pathB = getEdgeOwnBranchPath(edgeB, drawingState);
          let commonLength = 0;
          while (
            commonLength < pathA.length &&
            commonLength < pathB.length &&
            pathA[commonLength] === pathB[commonLength]
          ) {
            commonLength += 1;
          }
          const divergenceA = pathA[commonLength] ?? null;
          const divergenceB = pathB[commonLength] ?? null;
          const oppositeSiblingBranches = Boolean(
            divergenceA && divergenceB &&
            getSiblingBranchPathEntry(divergenceA) === divergenceB,
          );
          const splitDiamondId = oppositeSiblingBranches
            ? parseDiamondIdFromBranchPathEntry(divergenceA)
            : null;
          const stepsFromDiamondToEdgeASource = splitDiamondId
            ? hopsBetween(splitDiamondId, edgeA.from)
            : null;
          const stepsFromDiamondToEdgeBSource = splitDiamondId
            ? hopsBetween(splitDiamondId, edgeB.from)
            : null;
          // "Fresh" means the edge still lives directly in the diverging branch
          // context — no further diamond split between the candidate diamond and
          // the edge. Crossings owned by deeper splits should be attributed to
          // those splits, not to a distant common ancestor.
          const branchSplitsAfterDivergenceA = pathA.length - commonLength - (divergenceA ? 1 : 0);
          const branchSplitsAfterDivergenceB = pathB.length - commonLength - (divergenceB ? 1 : 0);

          let candidateDiamondId = null;
          let candidateReason = null;
          let rejectionReason = null;
          if (!oppositeSiblingBranches) {
            if (!divergenceA && !divergenceB) {
              rejectionReason = "edges share the same branch context; the crossing is not owned by opposite branches of a diamond";
            } else {
              rejectionReason = "one edge belongs to an ancestor context of the other; the crossing is not between opposite sibling branches";
            }
          } else if (branchSplitsAfterDivergenceA > 0 || branchSplitsAfterDivergenceB > 0) {
            rejectionReason = `crossing edges are opposite siblings of ${splitDiamondId} but pass through ${Math.max(branchSplitsAfterDivergenceA, branchSplitsAfterDivergenceB)} further diamond split(s) after the divergence — not fresh sibling branches`;
          } else {
            const maxSteps = Math.max(
              stepsFromDiamondToEdgeASource ?? Number.POSITIVE_INFINITY,
              stepsFromDiamondToEdgeBSource ?? Number.POSITIVE_INFINITY,
            );
            if (maxSteps <= SPLIT_ORIENTATION_LOOKAHEAD_STEPS) {
              candidateDiamondId = splitDiamondId;
              candidateReason = maxSteps === 0
                ? `crossing edges are the two exit branches of ${splitDiamondId}; the crossing occurs immediately after the split`
                : `crossing edges belong to opposite fresh sibling branches of ${splitDiamondId}, within ${maxSteps} placed-node step(s) of the split`;
            } else {
              rejectionReason = `crossing edges are opposite siblings of ${splitDiamondId} but the crossing is ${maxSteps} steps from the split (lookahead window ${SPLIT_ORIENTATION_LOOKAHEAD_STEPS})`;
            }
          }

          crossings.push({
            crossingId: `${edgeA.id}~${edgeB.id}~${segIndexA}.${segIndexB}`,
            edgeA: describeEdgeAtCrossing(edgeA, segIndexA, segA, pathA, divergenceA),
            edgeB: describeEdgeAtCrossing(edgeB, segIndexB, segB, pathB, divergenceB),
            intersection: [point[0], point[1]],
            commonBranchPrefix: pathA.slice(0, commonLength),
            nearestCommonSplitAncestorDiamondId: commonLength > 0
              ? parseDiamondIdFromBranchPathEntry(pathA[commonLength - 1])
              : null,
            oppositeSiblingBranches,
            splitDiamondId,
            stepsFromDiamondToEdgeASource,
            stepsFromDiamondToEdgeBSource,
            branchSplitsAfterDivergenceA,
            branchSplitsAfterDivergenceB,
            candidateDiamondId,
            candidateReason,
            rejectionReason,
          });
        });
      });
    }
  }

  const candidateCrossingIdsByDiamond = new Map();
  crossings.forEach((row) => {
    if (row.candidateDiamondId) {
      appendMapList(candidateCrossingIdsByDiamond, row.candidateDiamondId, row.crossingId);
    }
  });
  const overrides = getSketchV3BranchOrientationOverrides();
  const candidates = Array.from(candidateCrossingIdsByDiamond.entries()).map(([diamondId, crossingIds]) => {
    const diamondRecord = drawingState.diamondsById.get(diamondId) ?? null;
    return {
      diamondId,
      crossingIds,
      currentOrientation: diamondRecord?.orientation
        ? { ...diamondRecord.orientation }
        : { ...DEFAULT_BRANCH_ORIENTATION },
      overrideApplied: overrides?.[diamondId] ?? null,
    };
  });

  return {
    crossingCount: crossings.length,
    crossings,
    candidates,
    lookaheadWindowSteps: SPLIT_ORIENTATION_LOOKAHEAD_STEPS,
    overrides: overrides ? { ...overrides } : null,
  };
}

// Compact per-run geometry quality metrics used by automatic split-orientation
// repair to compare a trial layout against the baseline. Crossing count is taken
// from splitOrientationDiagnostics so both systems agree on what a crossing is.
function buildSketchV3GeometryQualitySummary({
  edges,
  edgeRouteById,
  placedByNodeId,
  layout,
  splitOrientationDiagnostics,
}) {
  const boxes = getPlacedNodeBoxes(placedByNodeId, layout);
  let nodeOverlapCount = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
        nodeOverlapCount += 1;
      }
    }
  }

  const routedEdges = edges
    .map((edge) => ({ edge, route: edgeRouteById.get(edge.id) ?? null }))
    .filter((entry) => Array.isArray(entry.route?.points) && entry.route.points.length >= 2);

  // Collinear positive-length overlap between edges that share no endpoint node.
  const segmentsOverlapCollinearly = (segA, segB) => {
    if (
      Math.abs(segmentOrientation(segA.start, segA.end, segB.start)) > 0.001 ||
      Math.abs(segmentOrientation(segA.start, segA.end, segB.end)) > 0.001
    ) {
      return false;
    }
    const horizontal = Math.abs(segA.end[0] - segA.start[0]) >= Math.abs(segA.end[1] - segA.start[1]);
    const axis = horizontal ? 0 : 1;
    const lo1 = Math.min(segA.start[axis], segA.end[axis]);
    const hi1 = Math.max(segA.start[axis], segA.end[axis]);
    const lo2 = Math.min(segB.start[axis], segB.end[axis]);
    const hi2 = Math.max(segB.start[axis], segB.end[axis]);
    return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 1;
  };
  let edgeOverlapCount = 0;
  for (let i = 0; i < routedEdges.length; i += 1) {
    for (let j = i + 1; j < routedEdges.length; j += 1) {
      const { edge: edgeA, route: routeA } = routedEdges[i];
      const { edge: edgeB, route: routeB } = routedEdges[j];
      const sharesNode = edgeA.from === edgeB.from || edgeA.from === edgeB.to ||
        edgeA.to === edgeB.from || edgeA.to === edgeB.to;
      if (sharesNode) continue;
      const segmentsA = routeSegments(routeA.points);
      const segmentsB = routeSegments(routeB.points);
      for (const segA of segmentsA) {
        for (const segB of segmentsB) {
          if (segmentsOverlapCollinearly(segA, segB)) edgeOverlapCount += 1;
        }
      }
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  boxes.forEach(({ box }) => {
    minX = Math.min(minX, box.left);
    maxX = Math.max(maxX, box.right);
    minY = Math.min(minY, box.top);
    maxY = Math.max(maxY, box.bottom);
  });
  routedEdges.forEach(({ route }) => {
    route.points.forEach((point) => {
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    });
  });
  const bounds = Number.isFinite(minX) && Number.isFinite(minY)
    ? { width: Math.round(maxX - minX), height: Math.round(maxY - minY) }
    : { width: 0, height: 0 };

  return {
    crossingCount: splitOrientationDiagnostics?.crossingCount ?? null,
    nodeOverlapCount,
    edgeOverlapCount,
    bounds,
  };
}

// Whether to produce the full SketchV3 diagnostic payload for this run. The payload
// (split-orientation crossings, geometry-quality summary, serialized drawing state,
// per-candidate blocker rows) is post-hoc measurement that never affects placement or
// route selection, so the normal in-browser render path skips it. It is still produced
// for:
//   - automatic split-orientation repair (consumes splitOrientationDiagnostics.candidates
//     and sketchV3GeometryQualitySummary for its acceptance gates),
//   - the geometry-debug / audit / collection consumers in the React layer, which signal
//     via layoutPlan.sketchV3DiagnosticsRequested, and
//   - any non-browser caller (headless harness / tests / SSR), which always receives the
//     full payload so existing tooling keeps working unchanged.
function sketchV3DiagnosticsEnabledFor(layoutPlan) {
  if (typeof window === "undefined") return true;
  if (layoutPlan?.sketchV3DiagnosticsRequested === true) return true;
  return isSketchV3AutomaticSplitOrientationRepairEnabled();
}

export function applySketchV3Layout(layoutPlan) {
  if (layoutPlan.layoutMode !== SKETCH_V3_LAYOUT_MODE) {
    return { layoutPlan, diagnostics: { sketchV3Enabled: false } };
  }

  const diagnosticsEnabled = sketchV3DiagnosticsEnabledFor(layoutPlan);
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
  const branchOrientationFallbackTriedDiamonds = [];
  const branchOrientationFallbackAcceptedDiamonds = [];
  const branchOrientationSiblingPreviewTriedDiamonds = [];
  const branchOrientationSiblingPreviewConflictDiamonds = [];
  const branchOrientationSiblingPreviewAcceptedDiamonds = [];
  const branchOrientationSiblingPreviewRejectedDiamonds = [];
  const drawingState = createSketchV3DrawingState({ nodes, edges });
  // Carry the diagnostics gate to the loop-return router so it can skip the output-only
  // node/edge blocker scan when no pending-corridor conflict exists (decision-identical).
  drawingState.diagnosticsEnabled = diagnosticsEnabled;

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
            // Manual override only: without an override entry the candidates use the
            // default orientation, matching pre-override behavior exactly.
            orientation: getOverrideOrientationForDiamond(sourcePlacement.node) ?? DEFAULT_BRANCH_ORIENTATION,
          })
        : getContinuationPlacementCandidates({ position: nextPosition, params });
      let selectedCandidate = incoming && sourcePlacement
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
        // Branch orientation fallback: when the no-branch fails with default orientation
        // (no-left / yes-right) and the sibling yes branch has not yet been placed,
        // try the flipped orientation (yes-left / no-right) for this diamond.
        // This is a local per-diamond candidate choice — CFG semantics are unchanged.
        if (incoming?.branch === "no" && sourcePlacement?.node?.kind === "conditionalJump" &&
            !getOverrideOrientationForDiamond(sourcePlacement.node)) {
          const parentDiamondId = sourcePlacement.node.id;
          const parentDiamondIdx = sourcePlacement.node.instructionIndex;
          const outgoingFromDiamond = Number.isInteger(parentDiamondIdx)
            ? outgoingBySource.get(parentDiamondIdx) ?? []
            : [];
          const siblingYesEdge = outgoingFromDiamond.find((e) => e.branch === "yes") ?? null;

          // Only flip when the yes branch is still pending (not yet placed)
          if (siblingYesEdge && !isHaltEdge(siblingYesEdge, instructionCount)) {
            const siblingYesTargetNode = instructionNodeByIndex.get(siblingYesEdge.targetIndex) ?? null;
            const siblingYesCorridor = pendingCorridorByEdgeId.get(siblingYesEdge.id) ?? null;

            // Build a temporary flipped yes corridor so the sibling-branch route
            // reservation check inside chooseLegalPlacement sees the correct geometry.
            let tempFlippedYesCorridor = null;
            if (siblingYesTargetNode && !placedByNodeId.has(siblingYesTargetNode.id)) {
              const flippedYesPos = getBranchPosition({
                edge: siblingYesEdge,
                sourcePlacement,
                targetNode: siblingYesTargetNode,
                layout,
                params,
                depth,
                orientation: FLIPPED_BRANCH_ORIENTATION,
              });
              tempFlippedYesCorridor = makePendingBranchCorridor({
                edge: siblingYesEdge,
                sourcePlacement,
                targetNode: siblingYesTargetNode,
                position: flippedYesPos,
                layout,
                params,
                depth: depth + 1,
                branchPath: [...currentBranchPath, siblingYesEdge.id],
                createdOrder: placementRows.length,
                orientation: FLIPPED_BRANCH_ORIENTATION,
              });
            }

            // Swap out default yes corridor for the flipped one while evaluating
            if (siblingYesCorridor) pendingCorridorByEdgeId.delete(siblingYesEdge.id);
            if (tempFlippedYesCorridor) pendingCorridorByEdgeId.set(siblingYesEdge.id, tempFlippedYesCorridor);

            const flippedCandidates = getBranchPlacementCandidates({
              edge: incoming,
              sourcePlacement,
              targetNode: node,
              layout,
              params,
              depth: placementDepth,
              orientation: FLIPPED_BRANCH_ORIENTATION,
            });
            const flippedCandidate = chooseLegalPlacement({
              candidates: flippedCandidates,
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
            });

            branchOrientationFallbackTriedDiamonds.push(parentDiamondId);

            if (flippedCandidate) {
              branchOrientationFallbackAcceptedDiamonds.push(parentDiamondId);
              selectedCandidate = flippedCandidate;

              // Record flipped orientation on the diamond record so loop-return
              // direction logic reads the correct visual side from the path entry.
              const diamondRecord = drawingState.diamondsById.get(parentDiamondId);
              if (diamondRecord) diamondRecord.orientation = FLIPPED_BRANCH_ORIENTATION;

              // Commit the flipped yes corridor and update the pending stack entry
              // so that when the yes branch is later popped it uses the right anchor.
              if (tempFlippedYesCorridor) {
                recordPendingCorridorCreated({ drawingState, corridor: tempFlippedYesCorridor });
                pendingCorridorRows.push({
                  ...tempFlippedYesCorridor,
                  footprint: { ...tempFlippedYesCorridor.footprint },
                  segments: tempFlippedYesCorridor.segments.map((seg) => ({ ...seg })),
                  sketchV3BranchOrientationFallbackTried: true,
                  sketchV3BranchOrientationFallbackAccepted: true,
                });
              }
              // Update the matching pending yes stack entry so that when the yes
              // branch is popped, walkFrom starts from the flipped anchor position.
              for (let _i = pendingYesStack.length - 1; _i >= 0; _i--) {
                if (pendingYesStack[_i].incomingEdge?.id === siblingYesEdge.id) {
                  if (siblingYesTargetNode) {
                    pendingYesStack[_i].position = getBranchPosition({
                      edge: siblingYesEdge,
                      sourcePlacement,
                      targetNode: siblingYesTargetNode,
                      layout,
                      params,
                      depth,
                      orientation: FLIPPED_BRANCH_ORIENTATION,
                    });
                  }
                  pendingYesStack[_i].orientation = FLIPPED_BRANCH_ORIENTATION;
                  break;
                }
              }
            } else {
              // Flip also failed — restore the original yes corridor.
              if (tempFlippedYesCorridor) pendingCorridorByEdgeId.delete(siblingYesEdge.id);
              if (siblingYesCorridor) pendingCorridorByEdgeId.set(siblingYesEdge.id, siblingYesCorridor);
            }
          }
        }

        if (!selectedCandidate) {
          failures.push({
            edgeId: incoming?.id ?? null,
            nodeId: node.id,
            reason: incoming?.branch
              ? "sketchV3NoLegalOrdinaryDiamondSplitPlacement"
              : "sketchV3NoLegalOrdinaryPlacement",
            sketchV3BranchOrientationFallbackTried:
              branchOrientationFallbackTriedDiamonds.includes(sourcePlacement?.node?.id),
          });
          return;
        }
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
        // Shallow sibling-corridor preview: compare the immediate no and yes branch
        // corridors under the default orientation.  If they conflict with each other
        // (crossing, overlap, T-junction, or footprint clash) AND the flipped
        // orientation resolves that conflict, use the flipped orientation for this
        // diamond.  Structural stops (HALT, already-placed target, loop-return) cause
        // the relevant preview to be null, in which case the preview reports no conflict.
        const overrideOrientation = getOverrideOrientationForDiamond(placement.node);
        let chosenOrientation = overrideOrientation ?? DEFAULT_BRANCH_ORIENTATION;
        if (overrideOrientation) {
          // Record on the diamond record so loop-return side selection and
          // branch-path visual-side lookups see the overridden orientation.
          const diamondRecord = drawingState.diamondsById.get(placement.node.id);
          if (diamondRecord) diamondRecord.orientation = { ...overrideOrientation };
        }
        const siblingPreviewEligible = !overrideOrientation && (
          noEdge && !isHaltEdge(noEdge, instructionCount) &&
          yesEdge && !isHaltEdge(yesEdge, instructionCount)
        );
        if (siblingPreviewEligible) {
          const previewArgs = {
            noEdge,
            yesEdge,
            sourcePlacement: placement,
            instructionNodeByIndex,
            instructionCount,
            placedByNodeId,
            layout,
            params,
            depth,
            branchPath: currentBranchPath,
          };
          const defaultPreviews = previewSiblingBranchCorridors({
            ...previewArgs,
            orientation: DEFAULT_BRANCH_ORIENTATION,
          });
          const defaultConflict = findSiblingCorridorConflict(
            defaultPreviews.noPreview,
            defaultPreviews.yesPreview,
          );
          branchOrientationSiblingPreviewTriedDiamonds.push(placement.node.id);
          if (defaultConflict) {
            branchOrientationSiblingPreviewConflictDiamonds.push(placement.node.id);
            const flippedPreviews = previewSiblingBranchCorridors({
              ...previewArgs,
              orientation: FLIPPED_BRANCH_ORIENTATION,
            });
            const flippedConflict = findSiblingCorridorConflict(
              flippedPreviews.noPreview,
              flippedPreviews.yesPreview,
            );
            if (!flippedConflict) {
              chosenOrientation = FLIPPED_BRANCH_ORIENTATION;
              branchOrientationSiblingPreviewAcceptedDiamonds.push(placement.node.id);
              const diamondRecord = drawingState.diamondsById.get(placement.node.id);
              if (diamondRecord) diamondRecord.orientation = FLIPPED_BRANCH_ORIENTATION;
            } else {
              branchOrientationSiblingPreviewRejectedDiamonds.push(placement.node.id);
            }
          }
        }

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
                orientation: chosenOrientation,
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
                orientation: chosenOrientation,
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
                orientation: chosenOrientation,
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
          orientation: chosenOrientation,
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
    diagnosticsEnabled,
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

  // These builders are pure measurements of the finished layout (crossing/overlap counts,
  // serialized drawing state, per-route diagnostic rows). They never feed placement or
  // route selection, so the normal render path skips them entirely. The ternary below only
  // evaluates the fields that reference these vars when diagnosticsEnabled is true.
  let diamondDiagnostics = null;
  let loopReturnDiagnostics = null;
  let focusedOrdinaryRouteDiagnostics = null;
  let splitOrientationDiagnostics = null;
  let sketchV3GeometryQualitySummary = null;
  let drawingStateRecords = null;
  if (diagnosticsEnabled) {
    diamondDiagnostics = buildDiamondDiagnostics(
      edges,
      edgeRouteById,
      layout,
      instructionCount,
      instructionNodeByIndex,
      drawingState,
      pendingCorridorRows,
    );
    loopReturnDiagnostics = buildLoopReturnDiagnostics(edgeRouteById);
    focusedOrdinaryRouteDiagnostics = buildFocusedOrdinaryRouteDiagnostics({
      edgesById,
      edgeRouteById,
      drawingState,
      failures,
      instructionCount,
    });
    splitOrientationDiagnostics = buildSplitOrientationDiagnostics({
      edges,
      edgeRouteById,
      drawingState,
      placedByNodeId,
    });
    sketchV3GeometryQualitySummary = buildSketchV3GeometryQualitySummary({
      edges,
      edgeRouteById,
      placedByNodeId,
      layout,
      splitOrientationDiagnostics,
    });
    drawingStateRecords = serializeDrawingState(drawingState);
  }
  const _t4 = _pt?.now() ?? 0;
  const fallbackRequired = failures.length > 0;
  const sketchV3PhaseTiming = _pt ? {
    n: instructionCount,
    dfsTraversal: _t1 - _t0,
    deferredHaltRouting: _t2 - _t1,
    deferredOrdinaryRouting: _t3 - _t2,
    diagnosticAssembly: _t4 - _t3,
    total: _t4 - _t0,
  } : null;
  const diagnostics = diagnosticsEnabled ? {
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
    haltRoutingDiagnostics: {
      sharedHaltNodeId: deferredHaltResult.sharedHaltNodeId,
      exitCount: (deferredHaltResult.haltRoutingDiagnostics ?? []).length,
      suspiciousCount: (deferredHaltResult.haltRoutingDiagnostics ?? [])
        .filter((row) => row.suspicious).length,
      exits: deferredHaltResult.haltRoutingDiagnostics ?? [],
    },
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
    sketchV3BranchOrientationFallbackTried: branchOrientationFallbackTriedDiamonds.length > 0,
    sketchV3BranchOrientationFallbackTriedDiamonds: branchOrientationFallbackTriedDiamonds,
    sketchV3BranchOrientationFallbackAccepted: branchOrientationFallbackAcceptedDiamonds.length > 0,
    sketchV3BranchOrientationFallbackAcceptedDiamonds: branchOrientationFallbackAcceptedDiamonds,
    sketchV3BranchOrientationSiblingPreviewTried: branchOrientationSiblingPreviewTriedDiamonds.length > 0,
    sketchV3BranchOrientationSiblingPreviewTriedDiamonds: branchOrientationSiblingPreviewTriedDiamonds,
    sketchV3BranchOrientationSiblingPreviewConflict: branchOrientationSiblingPreviewConflictDiamonds.length > 0,
    sketchV3BranchOrientationSiblingPreviewConflictDiamonds: branchOrientationSiblingPreviewConflictDiamonds,
    sketchV3BranchOrientationSiblingPreviewAccepted: branchOrientationSiblingPreviewAcceptedDiamonds.length > 0,
    sketchV3BranchOrientationSiblingPreviewAcceptedDiamonds: branchOrientationSiblingPreviewAcceptedDiamonds,
    sketchV3BranchOrientationSiblingPreviewRejected: branchOrientationSiblingPreviewRejectedDiamonds.length > 0,
    sketchV3BranchOrientationSiblingPreviewRejectedDiamonds: branchOrientationSiblingPreviewRejectedDiamonds,
    splitOrientationDiagnostics,
    sketchV3GeometryQualitySummary,
  } : {
    // Lean payload for the normal render path. Only the fields any non-debug consumer may
    // read are kept (all of which use `?? …` defaults, so absent fields are harmless).
    // sketchV3DiagnosticsGated marks why the verbose rows are absent; enable a debug/
    // collection/auto-flip mode (see sketchV3DiagnosticsEnabledFor) to restore them.
    sketchV3Enabled: true,
    sketchV3FallbackUsed: fallbackRequired,
    sketchV3FallbackReason: fallbackRequired ? "sketchV3FirstPassPlacementFailed" : null,
    sketchV3DiagnosticsGated: true,
    sketchV3SharedHaltNodeId: deferredHaltResult.sharedHaltNodeId,
    sketchV3FailureRows: failures,
    sketchV3Parameters: params,
    sketchV3PhaseTiming,
    haltRoutingDiagnostics: {
      sharedHaltNodeId: deferredHaltResult.sharedHaltNodeId,
      exitCount: (deferredHaltResult.haltRoutingDiagnostics ?? []).length,
      suspiciousCount: (deferredHaltResult.haltRoutingDiagnostics ?? [])
        .filter((row) => row.suspicious).length,
      exits: deferredHaltResult.haltRoutingDiagnostics ?? [],
    },
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

// --- Automatic split-orientation repair (conservative, crossing-driven) --------
//
// First automatic version, opt-in. Enable with ?sketchV3AutoFlip=1, localStorage
// sketchV3AutoFlip=1, or globalThis.__sketchV3AutoFlip = true (harness/tests);
// ?sketchV3AutoFlip=0 force-disables. It re-runs the layout with trial override
// maps drawn from splitOrientationDiagnostics.candidates (local, crossing-driven
// — never a global scan), feeding them through the SAME override mechanism the
// manual ?sketchV3Flip debugging uses. Precedence: manual overrides win — when
// any manual override is active, automatic repair is disabled for the run and
// reports disabledReason "manualOverridesActive", so manual experiments always
// see exactly what they asked for.
const AUTO_SPLIT_REPAIR_MAX_CANDIDATES = 2;
const AUTO_SPLIT_REPAIR_BOUNDS_GROWTH_LIMIT = 1.2;

function isSketchV3AutomaticSplitOrientationRepairEnabled() {
  if (typeof globalThis !== "undefined" && globalThis.__sketchV3AutoFlip !== undefined) {
    return globalThis.__sketchV3AutoFlip === true ||
      globalThis.__sketchV3AutoFlip === 1 ||
      globalThis.__sketchV3AutoFlip === "1";
  }
  if (typeof window !== "undefined") {
    try {
      const param = new URLSearchParams(window.location.search).get("sketchV3AutoFlip");
      if (param === "1") return true;
      if (param === "0") return false;
    } catch {
      // Ignore URL parsing issues in non-browser/debug contexts.
    }
    try {
      return window.localStorage?.getItem("sketchV3AutoFlip") === "1";
    } catch {
      return false;
    }
  }
  return false;
}

function summarizeSketchV3RunForAutoRepair(diagnostics) {
  const quality = diagnostics.sketchV3GeometryQualitySummary ?? {};
  return {
    crossingCount: diagnostics.splitOrientationDiagnostics?.crossingCount ?? null,
    nodeOverlapCount: quality.nodeOverlapCount ?? null,
    edgeOverlapCount: quality.edgeOverlapCount ?? null,
    fallbackUsed: false,
    haltSuspiciousCount: diagnostics.haltRoutingDiagnostics?.suspiciousCount ?? 0,
    loopReturnSignals: {
      belowClearance: (diagnostics.sketchV3LoopReturnBelowClearanceRows ?? []).length,
      diamondObstacle: (diagnostics.sketchV3LoopReturnDiamondObstacleRows ?? []).length,
      splitExitLaneConflict: (diagnostics.sketchV3LoopReturnSplitExitLaneConflictRows ?? []).length,
      unrelatedEdgeLaneConflict: (diagnostics.sketchV3LoopReturnUnrelatedEdgeLaneConflictRows ?? []).length,
    },
    bounds: quality.bounds ?? null,
  };
}

// Returns null when the trial passes every acceptance gate, otherwise the reason
// it must be rejected. Gates are framed as "must not get worse than baseline",
// which is equivalent to "remains 0" on layouts whose baseline is already clean.
function getAutoRepairRejectionReason(trial, baseline) {
  if (trial.fallbackUsed) return "trial layout failed placement (would fall back to legacy layout)";
  if (!(Number.isFinite(trial.crossingCount) && trial.crossingCount < baseline.crossingCount)) {
    return "crossing count did not strictly decrease";
  }
  if ((trial.nodeOverlapCount ?? 0) > (baseline.nodeOverlapCount ?? 0)) return "node overlaps increased";
  if ((trial.edgeOverlapCount ?? 0) > (baseline.edgeOverlapCount ?? 0)) return "edge overlaps increased";
  if ((trial.haltSuspiciousCount ?? 0) > (baseline.haltSuspiciousCount ?? 0)) {
    return "HALT suspicious count increased";
  }
  for (const key of Object.keys(baseline.loopReturnSignals ?? {})) {
    if ((trial.loopReturnSignals?.[key] ?? 0) > (baseline.loopReturnSignals?.[key] ?? 0)) {
      return `loop-return signal increased: ${key}`;
    }
  }
  if (trial.bounds && baseline.bounds) {
    if (
      trial.bounds.width > baseline.bounds.width * AUTO_SPLIT_REPAIR_BOUNDS_GROWTH_LIMIT ||
      trial.bounds.height > baseline.bounds.height * AUTO_SPLIT_REPAIR_BOUNDS_GROWTH_LIMIT
    ) {
      return `bounds expanded more than ${Math.round((AUTO_SPLIT_REPAIR_BOUNDS_GROWTH_LIMIT - 1) * 100)}%`;
    }
  }
  return null;
}

export function applySketchV3LayoutWithAutomaticRepair(layoutPlan) {
  if (layoutPlan.layoutMode !== SKETCH_V3_LAYOUT_MODE) {
    return applySketchV3Layout(layoutPlan);
  }
  const autoEnabled = isSketchV3AutomaticSplitOrientationRepairEnabled();
  // _automaticTrialOverrides is null here, so this is the manual-only view.
  const manualOverrides = getSketchV3BranchOrientationOverrides();
  // Baseline failure propagates exactly as before — automatic repair only
  // refines layouts that already succeed.
  const baselineResult = applySketchV3Layout(layoutPlan);
  // Building the baseline summary only matters for the repair trials below, so skip it
  // on the normal render path where automatic repair is disabled.
  const repairEnabled = autoEnabled && !manualOverrides;
  const baselineSummary = repairEnabled
    ? summarizeSketchV3RunForAutoRepair(baselineResult.diagnostics)
    : null;

  const repair = {
    enabled: repairEnabled,
    disabledReason: !autoEnabled
      ? "optInFlagNotSet (enable with ?sketchV3AutoFlip=1, localStorage sketchV3AutoFlip=1, or globalThis.__sketchV3AutoFlip=true)"
      : manualOverrides
        ? "manualOverridesActive (manual overrides take precedence; automatic repair is skipped for this run)"
        : null,
    baselineCrossingCount: baselineSummary?.crossingCount ?? null,
    baselineSummary,
    candidates: [],
    testedOverrideMaps: [],
    selectedOverrides: null,
    finalCrossingCount: baselineSummary?.crossingCount ?? null,
  };
  baselineResult.diagnostics.automaticSplitOrientationRepair = repair;
  if (!repair.enabled) return baselineResult;

  const splitDiagnostics = baselineResult.diagnostics.splitOrientationDiagnostics ?? null;
  const crossingRows = splitDiagnostics?.crossings ?? [];
  const nodeById = new Map(layoutPlan.nodes.map((node) => [node.id, node]));
  const allCandidates = (splitDiagnostics?.candidates ?? []).map((candidate) => {
    const owningRows = crossingRows.filter((row) => row.candidateDiamondId === candidate.diamondId);
    const localDistance = owningRows.length > 0
      ? Math.max(...owningRows.map((row) => Math.max(
          row.stepsFromDiamondToEdgeASource ?? 0,
          row.stepsFromDiamondToEdgeBSource ?? 0,
        )))
      : null;
    return {
      diamondId: candidate.diamondId,
      instructionIndex: nodeById.get(candidate.diamondId)?.instructionIndex ?? null,
      reason: owningRows[0]?.candidateReason ?? "nominated by split-orientation diagnostics",
      baselineCrossingsInvolved: [...candidate.crossingIds],
      candidateStrength: localDistance !== null && localDistance <= 2 ? "strong" : "moderate",
      localDistance,
      tested: false,
      accepted: false,
      rejectionReason: null,
    };
  });
  allCandidates.sort((a, b) => (a.localDistance ?? Infinity) - (b.localDistance ?? Infinity));
  const cappedCandidates = allCandidates.slice(0, AUTO_SPLIT_REPAIR_MAX_CANDIDATES);
  allCandidates.slice(AUTO_SPLIT_REPAIR_MAX_CANDIDATES).forEach((candidate) => {
    candidate.rejectionReason = `not tested: candidate cap of ${AUTO_SPLIT_REPAIR_MAX_CANDIDATES} reached`;
  });
  repair.candidates = allCandidates;
  if (cappedCandidates.length === 0) return baselineResult;

  // Trial maps: each top candidate individually, plus the pairwise combination.
  const trialMaps = cappedCandidates.map((candidate) => ({ [candidate.diamondId]: "YES_LEFT_NO_RIGHT" }));
  if (cappedCandidates.length === 2) {
    trialMaps.push({
      [cappedCandidates[0].diamondId]: "YES_LEFT_NO_RIGHT",
      [cappedCandidates[1].diamondId]: "YES_LEFT_NO_RIGHT",
    });
  }

  const trials = [];
  for (const overrides of trialMaps) {
    let result = null;
    let summary = null;
    let failureReason = null;
    _automaticTrialOverrides = overrides;
    try {
      result = applySketchV3Layout(layoutPlan);
      summary = summarizeSketchV3RunForAutoRepair(result.diagnostics);
    } catch (error) {
      failureReason = String(error?.message ?? error);
    } finally {
      _automaticTrialOverrides = null;
    }
    if (!summary) {
      summary = {
        crossingCount: null,
        nodeOverlapCount: null,
        edgeOverlapCount: null,
        fallbackUsed: true,
        failureReason,
        haltSuspiciousCount: null,
        loopReturnSignals: null,
        bounds: null,
      };
    }
    const rejectionReason = getAutoRepairRejectionReason(summary, baselineSummary);
    trials.push({
      overrides,
      result,
      summary,
      flipCount: Object.keys(overrides).length,
      accepted: rejectionReason === null,
      rejectionReason,
    });
    repair.testedOverrideMaps.push({
      overrides: { ...overrides },
      ...summary,
      accepted: rejectionReason === null,
      rejectionReason,
    });
  }
  cappedCandidates.forEach((candidate) => {
    candidate.tested = true;
  });

  const acceptedTrials = trials.filter((trial) => trial.accepted);
  if (acceptedTrials.length === 0) {
    cappedCandidates.forEach((candidate) => {
      const singleTrial = trials.find((trial) => trial.flipCount === 1 && trial.overrides[candidate.diamondId]);
      candidate.rejectionReason = singleTrial?.rejectionReason ?? "no trial passed the acceptance gates";
    });
    return baselineResult;
  }

  // Selection: best crossing reduction first; ties broken toward fewer flips,
  // then smaller resulting bounds.
  acceptedTrials.sort((a, b) =>
    (a.summary.crossingCount - b.summary.crossingCount) ||
    (a.flipCount - b.flipCount) ||
    ((a.summary.bounds?.width ?? 0) * (a.summary.bounds?.height ?? 0)) -
      ((b.summary.bounds?.width ?? 0) * (b.summary.bounds?.height ?? 0)));
  const best = acceptedTrials[0];
  repair.selectedOverrides = { ...best.overrides };
  repair.finalCrossingCount = best.summary.crossingCount;
  cappedCandidates.forEach((candidate) => {
    if (best.overrides[candidate.diamondId]) {
      candidate.accepted = true;
    } else {
      const singleTrial = trials.find((trial) => trial.flipCount === 1 && trial.overrides[candidate.diamondId]);
      candidate.rejectionReason = singleTrial?.rejectionReason ?? "flip not part of the selected override map";
    }
  });
  best.result.diagnostics.automaticSplitOrientationRepair = repair;
  return best.result;
}
