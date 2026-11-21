import { classifyStraightArm } from "./orientation/structure.js";

// A pending direct self-return is already identified by its known endpoint.
// A longer return supplies a cue only after its entire straight arm is drawn.
function knownSelfReturn({ cfg }, state, firstEdge, header) {
  let edge = firstEdge;
  const visited = new Set();
  while (edge && !visited.has(edge.id)) {
    visited.add(edge.id);
    if (edge.isLoop) return edge.to === header
      && (edge === firstEdge || state.routes.has(edge.id));
    if (!state.routes.has(edge.id)) return false;
    const node = cfg.nodeById.get(edge.to);
    if (!node || node.kind === "conditionalJump") return false;
    edge = cfg.outgoingByIndex.get(node.instructionIndex)?.cont;
  }
  return false;
}

// A small loop-exit convention, not a general choice between bottom/diagonal.
// The other arm returns to this diamond; this arm is a private straight terminal
// tail, with no fork or shared destination demanding another approach. Neither
// logical branch nor its held side determines the physical downward port.
export function prefersBottomContinuation(context, state, edge) {
  if (!edge.branch || edge.isLoop || state.placements.has(edge.to)) return false;
  const source = state.placements.get(edge.from);
  if (source?.kind !== "conditionalJump") return false;
  const outgoing = context.cfg.outgoingByIndex.get(source.index);
  const sibling = outgoing?.[edge.branch === "no" ? "yes" : "no"];
  if (!knownSelfReturn(context, state, sibling, edge.from)) return false;
  const tail = classifyStraightArm(context, state, edge);
  return tail.kind === "terminal" && !tail.committed && tail.freshNodeIds.length > 0
    && tail.freshNodeIds.every((id) => context.cfg.edges.filter((input) => input.to === id).length === 1);
}
