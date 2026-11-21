// Read the boundary of a thickened, already drawn first-placement tree.
// On each convex instruction body the angle from its center orders the ports
// clockwise. At a tree port the walk goes down one side of the ribbon and
// resumes clockwise at the opposite body. This is a combinatorial walk only.
const endpoints = ["source", "target"];
const occurrenceId = (edgeId, end) => `${edgeId}:${end}`;
const samePoint = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 1e-9);
const fullTurn = 2 * Math.PI;

export function attachmentContour(placements, treeRoutes, connections) {
  const rings = new Map([...placements.keys()].map((id) => [id, []]));
  const slot = (route, end) => {
    const nodeId = route[end];
    const point = route[`${end}Port`];
    const ring = rings.get(nodeId);
    const existing = ring.find((group) => samePoint(group.point, point));
    if (existing) return existing;
    const { cx, cy } = placements.get(nodeId);
    const angle = (Math.atan2(point[0] - cx, cy - point[1]) + fullTurn) % fullTurn;
    const group = { nodeId, point, angle, marks: [], tree: null };
    ring.push(group);
    return group;
  };

  for (const route of treeRoutes) {
    const source = slot(route, "source");
    const target = slot(route, "target");
    if (source.tree || target.tree || source === target) {
      return { boundary: null, rings, reason: "coincident-tree-ports" };
    }
    source.tree = { id: occurrenceId(route.edgeId, "source"), twin: target };
    target.tree = { id: occurrenceId(route.edgeId, "target"), twin: source };
  }
  for (const route of connections) {
    for (const end of endpoints) {
      slot(route, end).marks.push({ id: occurrenceId(route.edgeId, end), edgeId: route.edgeId, end });
    }
  }

  let slotCount = 0;
  const next = new Map();
  for (const ring of rings.values()) {
    ring.sort((a, b) => a.angle - b.angle);
    ring.forEach((group, index) => next.set(group, ring[(index + 1) % ring.length]));
    slotCount += ring.length;
  }
  const first = rings.get("start")?.[0];
  const visited = new Set();
  const boundary = [];
  let current = first;
  while (current && !visited.has(current)) {
    visited.add(current);
    const { nodeId, point, marks, tree } = current;
    if (marks.length) boundary.push({ nodeId, point, marks, treePort: tree?.id ?? null });
    current = next.get(tree?.twin ?? current);
  }
  return visited.size === slotCount
    ? { boundary, rings }
    : { boundary: null, rings, reason: "incomplete-tree-boundary" };
}

// A word is projected to the endpoints of the requested incoming connections.
// The first-placing edge belongs to the tree and is not one of these pairs.
export function receiverIntervals(boundary, edgeIds) {
  if (!boundary) return { status: "unavailable" };
  const relevant = boundary.flatMap((group) => {
    const marks = group.marks.filter((mark) => edgeIds.has(mark.edgeId));
    return marks.length ? [{ ...group, marks, tied: Boolean(group.treePort || group.marks.length > 1) }] : [];
  });
  if (relevant.some((group) => group.tied)) return { status: "coincident-ports" };
  if (edgeIds.size < 2) return { status: "single-arrival" };
  const word = relevant.flatMap((group) => group.marks);
  const start = word.findIndex((mark, i) => mark.end === "source" && word.at(i - 1).end === "target");
  const cyclic = [...word.slice(start), ...word.slice(0, start)];
  const sources = cyclic.slice(0, edgeIds.size);
  const receivers = cyclic.slice(edgeIds.size);
  if (sources.some((mark) => mark.end !== "source") || receivers.some((mark) => mark.end !== "target")) {
    return { status: "interleaved" };
  }
  const sourceOrder = sources.map((mark) => mark.edgeId);
  const receivingOrder = receivers.map((mark) => mark.edgeId);
  return {
    status: receivingOrder.every((id, i) => id === sourceOrder.at(-i - 1)) ? "reverse" : "alternating",
    sourceOrder,
    receivingOrder,
  };
}

// Each committed independent connection is a crosscut of the tree's exterior
// disk (on the sphere). Its endpoints divide the contour into two open arcs.
// A separation witness survives other unresolved cuts. A full face signature
// is available only when every earlier connection has distinct occurrences.
export function connectionFace(boundary, edgeId, committedIds) {
  if (!boundary) return { status: "unavailable" };
  const position = new Map(boundary.flatMap(({ marks, treePort }, i) =>
    !treePort && marks.length === 1 ? [[marks[0].id, i]] : []));
  const pair = (id) => endpoints.map((end) => position.get(occurrenceId(id, end)));
  const [source, target] = pair(edgeId);
  if (source == null || target == null) return { status: "coincident-ports" };
  const separatingEdges = [];
  const signature = [];
  let unresolved = false;
  for (const id of committedIds) {
    const [a, b] = pair(id);
    if (a == null || b == null) {
      unresolved = true;
      continue;
    }
    const inArc = (i) => a < b ? a < i && i < b : a < i || i < b;
    if (inArc(source) !== inArc(target)) separatingEdges.push(id);
    signature.push(inArc(source));
  }
  if (separatingEdges.length) return { status: "separated", separatingEdges };
  return unresolved ? { status: "coincident-ports" } : { status: "same-face", signature };
}

// Use an edge occurrence as the seam solely to compare rotation up to a
// cyclic shift. Port coordinates define the rotation, including tied slots.
export function incidentOrder(ring) {
  const word = ring.map(({ tree, marks }) => [
    ...(tree ? [tree.id] : []), ...marks.map((mark) => mark.id),
  ].sort());
  const seam = word.findIndex(([id]) => word.every(([other]) => id <= other));
  return [...word.slice(seam), ...word.slice(0, seam)];
}
