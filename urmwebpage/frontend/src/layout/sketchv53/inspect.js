import { buildOrdinaryTerminalCfg } from "../sketchv4/cfg.js";
import { classifyRoles } from "./roles.js";
import { computeOwnership } from "./ownership.js";
import { replayConstructionHistory } from "../sketchv4/constructionHistory.js";
import { headerOwnedReturnSide } from "./orientation/structure.js";
import { branchReachForDepth } from "./pipeline.js";
import { prioritizeConnectionCandidates, proposeConnections } from "./connections.js";
import { validateConnection } from "./validation.js";
import { attachmentContour, connectionFace, incidentOrder, receiverIntervals } from "./contour.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function connectionContext(state, tree, edge, cfg) {
  const placingEdge = new Map(tree.map((route) => [route.target, cfg.edgeById.get(route.edgeId)]));
  const doorwayFor = (branch) => ({
    source: branch.from, edgeId: branch.id, branch: branch.branch,
    side: state.placements.get(branch.from).branchOrientation[branch.branch],
  });
  let depth = 0;
  let doorway = edge.branch ? doorwayFor(edge) : undefined;
  for (let incoming = placingEdge.get(edge.from); incoming; incoming = placingEdge.get(incoming.from)) {
    if (incoming.branch) {
      depth += 1;
      doorway ??= doorwayFor(incoming);
    }
  }
  return { depth, doorway };
}

function compareAttachments(candidate, observed) {
  if (!observed || candidate.face.status !== "same-face" || observed.face.status !== "same-face") {
    return "outside-comparison";
  }
  return same(candidate.incidentOrders, observed.incidentOrders)
    && same(candidate.face.signature, observed.face.signature)
    ? "preserves" : "changes";
}

// Reconstruct one real V5.1 prefix on demand and inspect its existing menu.
// The diagnostic runs after construction and has no path back to commitment.
export function createReceiverInspection(program, history, failure, options = {}) {
  const requests = history.flatMap((event, index) => event.type === "edge-routed"
    ? [{ index, edgeId: event.edgeId, target: event.route.target }] : []);
  if (failure?.operation === "connect") {
    requests.push({ index: history.length, edgeId: failure.edgeId, target: failure.target });
  }

  let structure;
  let roles;
  const inspect = (index) => {
    const request = requests.find((entry) => entry.index === index);
    if (!request) return null;
    if (!structure) {
      const { cfg, terminalId, augmentedProgram } = buildOrdinaryTerminalCfg(program);
      roles = classifyRoles(cfg);
      structure = { cfg, terminalId, ownership: computeOwnership(cfg, roles), program: augmentedProgram };
    }
    const { cfg } = structure;
    const state = replayConstructionHistory(history, index);
    const prefix = history.slice(0, index);
    const tree = prefix.filter((event) => event.type === "extension-committed").map((event) => event.route);
    const committed = prefix.filter((event) => event.type === "edge-routed").map((event) => event.route);
    const edge = cfg.edgeById.get(request.edgeId);
    const { depth, doorway } = connectionContext(state, tree, edge, cfg);
    const { visual = {}, flexiblePorts = true, horizontalConnections = true, headerOwnedReturns = true } = options;
    const validationOptions = { branchAngleTan: visual.branchAngleTan, flexiblePorts };
    const menu = prioritizeConnectionCandidates(state, proposeConnections(state, edge, {
      visual, flexiblePorts, horizontalConnections, cfg, roles, doorway,
      reach: branchReachForDepth(depth, visual), resumed: edge.branch === "yes",
      returnSide: headerOwnedReturns ? headerOwnedReturnSide(structure, state, edge) : null,
    }), validationOptions);
    const observedRoute = history[index]?.route;
    const selected = observedRoute ? menu.findIndex(({ route }) =>
      route.connectorKind === observedRoute.connectorKind && same(route.points, observedRoute.points)) : -1;
    const committedIds = committed.map((route) => route.edgeId);
    const earlierArrivals = committed.filter((route) => route.target === edge.to).map((route) => route.edgeId);
    const receiverEdges = new Set([...earlierArrivals, edge.id]);
    const candidates = menu.map((proposal) => {
      const validation = validateConnection(state, proposal, validationOptions);
      const { boundary, rings, reason } = attachmentContour(state.placements, tree, [...committed, proposal.route]);
      return {
        proposal, validation, boundary, boundaryReason: reason,
        receiver: receiverIntervals(boundary, receiverEdges),
        face: connectionFace(boundary, edge.id, committedIds),
        incidentOrders: [edge.from, edge.to].map((id) => incidentOrder(rings.get(id))),
      };
    });
    const observed = candidates[selected];
    return {
      ...request, source: edge.from, branch: edge.branch, selected,
      earlierArrivals,
      placingEdge: tree.find((route) => route.target === edge.to)?.edgeId ?? null,
      candidates: candidates.map((candidate, rank) => ({
        ...candidate, order: rank === selected ? "selected" : compareAttachments(candidate, observed),
      })),
    };
  };

  return { requests, inspect };
}
