import { getLegalIncidentStubsForNode } from "./attachmentStubs.js";
import { isSupportedInstruction } from "./orientation/structure.js";

// Recognize the constructor's actual first NO path and independently routed
// straight receiver continuations to the same leaf HALT.
export function analyzeReceiverSides({ cfg, terminalId, program }) {
  if (cfg.edges.some((edge) => edge.isLoop) || !program.every(isSupportedInstruction)) return null;
  const incoming = new Map(cfg.nodes.map(({ id }) => [id, 0]));
  for (const { to } of cfg.edges) incoming.set(to, incoming.get(to) + 1);

  const path = [];
  const pathNodes = new Set(["start"]);
  const departures = [];
  let edge = cfg.edgeById.get("entry");
  while (edge) {
    path.push(edge.id);
    if (pathNodes.has(edge.to)) return null;
    pathNodes.add(edge.to);
    if (edge.to === terminalId) break;
    if (incoming.get(edge.to) !== 1) return null;
    const node = cfg.nodeById.get(edge.to);
    const next = cfg.outgoingByIndex.get(node.instructionIndex);
    if (node.kind === "conditionalJump") {
      departures.push({ source: node.id, pathPosition: path.length, edgeId: next.yes.id, receiver: next.yes.to });
      edge = next.no;
    } else edge = next.cont;
  }
  if (edge?.to !== terminalId || edge.branch || departures.length < 3) return null;

  const receivers = new Map();
  for (const { receiver, pathPosition, edgeId } of departures) {
    if (!receivers.has(receiver)) receivers.set(receiver, { receiver, first: pathPosition, last: pathPosition, edges: [] });
    const group = receivers.get(receiver);
    group.last = pathPosition;
    group.edges.push(edgeId);
  }
  if (receivers.size < 2 || receivers.size === departures.length) return null;
  const privateNodes = new Set();
  for (const { receiver, edges } of receivers.values()) {
    if (incoming.get(receiver) !== edges.length) return null;
    for (let id = receiver; id !== terminalId;) {
      if (pathNodes.has(id) || privateNodes.has(id)) return null;
      const node = cfg.nodeById.get(id);
      if (!node || node.kind === "conditionalJump" || (id !== receiver && incoming.get(id) !== 1)) return null;
      privateNodes.add(id);
      id = cfg.outgoingByIndex.get(node.instructionIndex)?.cont?.to;
    }
  }
  if (pathNodes.size + privateNodes.size !== cfg.nodes.length) return null;

  // Every diamond on this forward path has the stock YES-right orientation.
  // An interrupted receiver block is equivalent to overlapping intervals.
  const groups = [...receivers.values()];
  const neighbours = new Map(groups.map(({ receiver }) => [receiver, []]));
  const conflicts = [];
  for (const [i, group] of groups.entries()) {
    for (let j = i + 1; j < groups.length && groups[j].first < group.last; j += 1) {
      const other = groups[j];
      neighbours.get(group.receiver).push(other.receiver);
      neighbours.get(other.receiver).push(group.receiver);
      conflicts.push([group.receiver, other.receiver]);
    }
  }
  if (!conflicts.length) return { status: "stock-compatible" };
  const assignments = new Map();
  for (const { receiver } of groups) {
    if (assignments.has(receiver)) continue;
    // Groups are in first-occurrence order. Keep the earliest group in each
    // component on its usual side, even if that means swapping more diamonds.
    assignments.set(receiver, { side: "right", anchorReceiver: receiver });
    const queue = [receiver];
    for (const member of queue) {
      const { side } = assignments.get(member);
      for (const neighbour of neighbours.get(member)) {
        if (assignments.get(neighbour)?.side === side) return { status: "no-two-coloring" };
        if (assignments.has(neighbour)) continue;
        assignments.set(neighbour, { side: side === "right" ? "left" : "right", anchorReceiver: receiver });
        queue.push(neighbour);
      }
    }
  }
  return {
    status: "assigned", path, conflicts, departures,
    bySource: new Map(departures.map((departure) => [departure.source, departure])),
    receivers: groups.map((group) => ({ ...group, ...assignments.get(group.receiver) })),
    assignments,
  };
}

export function receiverSideOrientation(plan, state, work, { nodeId, placement, route }) {
  if (plan?.status !== "assigned" || work.resumed) return null;
  const departure = plan.bySource.get(nodeId);
  if (!departure || plan.assignments.get(departure.receiver).side !== "left") return null;
  if (placement.branchOrientation.yes !== "right") return null;
  const top = getLegalIncidentStubsForNode(placement, { box: placement.box })
    .find(({ portName }) => portName === "top").portPoint;
  if (!route.targetPort.every((value, i) => value === top[i])) return null;
  const index = departure.pathPosition - 1;
  if (plan.path[index] !== work.edge.id || state.routes.size !== index) return null;
  for (let i = 0; i < index; i += 1) {
    if (!state.routes.has(plan.path[i])) return null;
  }
  return { no: "right", yes: "left" };
}
