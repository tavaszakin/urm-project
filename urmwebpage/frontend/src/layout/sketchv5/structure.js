// Official V5 local preferences. Read CFG chains and committed geometry only;
// a branch's held exit direction is independent of its return corridor.
import { proposeConnections } from "./connections.js";
import { validateConnection, validateExtension } from "./validation.js";
export function isSupportedInstruction(instruction) {
  if (!Array.isArray(instruction)) return false;
  const opcode = String(instruction[0]).trim().toUpperCase();
  const operands = opcode === "J" ? 3 : opcode === "T" ? 2 : ["Z", "S"].includes(opcode) ? 1 : null;
  return operands !== null && instruction.length === operands + 1
    && instruction.slice(1).every((operand) => Number.isInteger(operand) && operand >= 0);
}

function returnEntry(cfg, ownership, edge) {
  if (!edge?.isLoop || !cfg.nodeById.has(edge.from) || !cfg.nodeById.has(edge.to)) return null;
  const sourcePath = ownership.branchPath(edge.from), headerPath = ownership.branchPath(edge.to);
  if (sourcePath.length <= headerPath.length || !headerPath.every((token, i) => sourcePath[i] === token)) return null;
  return cfg.edgeById.get(sourcePath[headerPath.length]) ?? null;
}

// Same header-relative token as V4 lanes.js, without its complete-layout extents.
export function headerOwnedReturnSide({ cfg, ownership }, state, edge) {
  const entry = returnEntry(cfg, ownership, edge);
  return state.placements.get(entry?.from)?.branchOrientation?.[entry?.branch] ?? null;
}

export function classifyStraightArm({ cfg, ownership, terminalId, program }, state, firstEdge) {
  const freshNodeIds = [];
  const visited = new Set();
  let edge = firstEdge;
  const summary = (kind) => ({ kind, target: edge?.to ?? null, edgeId: edge?.id ?? null,
    committed: state.placements.has(edge?.to), freshNodeIds });
  while (edge) {
    if (edge.isLoop) return summary(returnEntry(cfg, ownership, edge) ? "ancestor-return" : "unresolved");
    const node = cfg.nodeById.get(edge.to);
    if (!node || visited.has(node.id) || !isSupportedInstruction(program[node.instructionIndex])) return summary("unresolved");
    visited.add(node.id);
    if (node.id === terminalId) {
      if (!state.placements.has(node.id)) freshNodeIds.push(node.id);
      return summary("terminal");
    }
    if (state.placements.has(node.id)) return summary("existing-target");
    freshNodeIds.push(node.id);
    // No recursive branch exploration or future placement calculations.
    if (node.kind === "conditionalJump") return summary("fresh");
    edge = cfg.outgoingByIndex.get(node.instructionIndex)?.cont;
  }
  return summary("unresolved");
}

// Extents of one already committed sibling arm, clipped to the relevant rows.
// No unplaced node or hypothetical route contributes to this boundary.
function committedBranchExtent(context, state, branchId, low, high = Infinity, endpointBody = null) {
  let left = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (x) => { left = Math.min(left, x); right = Math.max(right, x); };
  const onBranch = (id) => context.ownership.branchPath(id).includes(branchId);
  for (const [id, { box }] of state.placements) {
    if (id === endpointBody) continue;
    if (onBranch(id) && box.bottom >= low && box.top <= high) {
      include(box.left); include(box.right); bottom = Math.max(bottom, Math.min(box.bottom, high));
    }
  }
  for (const route of state.routes.values()) {
    if (route.edgeId !== branchId && !onBranch(route.source)) continue;
    for (let i = 1; i < route.points.length; i += 1) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      const dy = b[1] - a[1];
      if (dy === 0) {
        if (a[1] >= low && a[1] <= high) { include(a[0]); include(b[0]); bottom = Math.max(bottom, a[1]); }
      } else {
        const t0 = Math.max(0, Math.min((low - a[1]) / dy, (high - a[1]) / dy));
        const t1 = Math.min(1, Math.max((low - a[1]) / dy, (high - a[1]) / dy));
        if (t0 <= t1) {
          include(a[0] + t0 * (b[0] - a[0])); include(a[0] + t1 * (b[0] - a[0]));
          bottom = Math.max(bottom, a[1] + t0 * dy, a[1] + t1 * dy);
        }
      }
    }
  }
  return left <= right ? { left, right, bottom } : null;
}

// An immediate fresh loop header can grow back toward a completed sibling loop.
// Its owned return's attachment row must clear that already occupied band. The
// only fresh geometry inspected is the header and its next conditional child.
function siblingLoopReach(context, state, edge, fork, { visual, side, orientation, baseReach }) {
  if (!orientation) return null;
  const arms = context.cfg.outgoingByIndex.get(fork.instructionIndex);
  const children = [arms?.no, arms?.yes].map((arm) => context.cfg.nodeById.get(arm?.to));
  if (children.some((node) => !node || state.placements.has(node.id)
    || !isSupportedInstruction(context.program[node.instructionIndex]))) return null;
  const entries = context.cfg.edges.filter((e) => e.isLoop && e.to === fork.id)
    .map((e) => returnEntry(context.cfg, context.ownership, e));
  if (!entries.length || entries.some((entry) => !entry || entry.from !== fork.id || entry.branch !== entries[0].branch)) return null;
  const inward = orientation[entries[0].branch];
  if (!["left", "right"].includes(inward) || inward === side
    || context.cfg.nodeById.get(entries[0].to)?.kind !== "conditionalJump") return null;
  const source = state.placements.get(edge.from);
  const sibling = context.cfg.outgoingByIndex.get(source.index)?.[edge.branch === "no" ? "yes" : "no"];
  if (!sibling || ![...state.routes.values()].some((route) => {
    const old = context.cfg.edgeById.get(route.edgeId);
    return old?.isLoop && context.ownership.branchPath(route.source).includes(sibling.id)
      && headerOwnedReturnSide(context, state, old) === inward;
  })) return null;
  const extent = committedBranchExtent(context, state, sibling.id, source.box.bottom);
  const sign = side === "left" ? -1 : 1, faceX = source.cx + sign * source.box.w / 4;
  if (!extent || (extent[side] - faceX) * sign + visual.clearance > 0) return null;
  const row = extent.bottom + visual.clearance;
  const tan = visual.branchAngleTan ?? Math.tan(33 * Math.PI / 180);
  const reach = (row - source.cy - source.box.h / 4 - visual.sizeForKind(fork.kind)[1] / 2) / tan;
  return reach > baseReach ? reach : null;
}

// Both clearance cases below must admit a real top-entry route. The current
// extension is provisional; validators still see every body and existing edge.
// Neither this extension nor its known connection is committed by a preview.
function legalTopConnection(state, extension, edge, visual, reach) {
  if (!validateExtension(state, extension, visual).legal) return null;
  const provisional = { ...state,
    placements: new Map(state.placements).set(extension.nodeId, extension.placement),
    routes: new Map(state.routes).set(extension.route.edgeId, extension.route) };
  for (const candidate of proposeConnections(provisional, edge, { visual, reach })) {
    if (candidate.route.connectorKind === "branch-ray-top") {
      return validateConnection(provisional, candidate, visual).legal ? candidate.route : null;
    }
  }
  return null;
}

// A nearest owner's direct exit and this resumed arm share a fresh destination.
// Further unplaced forward inputs need an approach beyond that known departure.
function sharedDestinationReach(context, state, edge, { visual, side, baseReach, propose, reachForDepth }) {
  if (!propose || !reachForDepth) return null;
  const owner = context.ownership.ownerOf(edge.from);
  const ancestor = state.placements.get(owner?.fork);
  const other = context.cfg.outgoingByIndex.get(ancestor?.index)?.[owner?.side === "no" ? "yes" : "no"];
  if (!other?.branch || other.isLoop || other.to !== edge.to
    || ancestor.branchOrientation?.[other.branch] !== side
    || !context.cfg.edges.some((input) => input.to === edge.to && !input.isLoop && !state.placements.has(input.from))) return null;
  const depth = context.cfg.depthByNode.get(other.from);
  if (!Number.isInteger(depth)) return null;
  const connectionReach = reachForDepth(depth, visual), base = propose(baseReach);
  const route = legalTopConnection(state, base, other, visual, connectionReach);
  if (!route) return null;
  const sign = side === "left" ? -1 : 1;
  const reach = (route.points[1][0] - base.route.sourcePort[0]) * sign + visual.clearance;
  return reach > baseReach && legalTopConnection(state, propose(reach), other, visual, connectionReach) ? reach : null;
}

// Bound width awareness to the next conditional: its immediate fresh children,
// or an immediate fork's direct connection to an already committed target.
// No future node positions, outgoing commitments or corridor reservations.
export function preferredBranchReach(context, state, edge, { visual, side, resumed, baseReach, forkReach, orientation, propose, reachForDepth }) {
  if (!resumed || !edge.branch || !["left", "right"].includes(side)) return null;
  if (context.cfg.nodeById.get(edge.to)?.kind !== "conditionalJump") {
    const shared = sharedDestinationReach(context, state, edge, { visual, side, baseReach, propose, reachForDepth });
    if (shared != null) return shared;
  }
  const chain = classifyStraightArm(context, state, edge);
  if (chain.kind !== "fresh") return null;
  const fork = context.cfg.nodeById.get(chain.target);
  const outgoing = context.cfg.outgoingByIndex.get(fork.instructionIndex);
  const arms = [outgoing?.no, outgoing?.yes];
  const children = arms.map((e) => context.cfg.nodeById.get(e?.to));
  let knownTarget = null, knownEdge = null, childWidth = 0;
  if (chain.freshNodeIds.length === 1) {
    const known = arms.filter((arm) => arm && !arm.isLoop && state.placements.has(arm.to));
    if (known.length !== 1) return siblingLoopReach(context, state, edge, fork,
      { visual, side, orientation, baseReach });
    const other = children[arms[0] === known[0] ? 1 : 0];
    if (!other || state.placements.has(other.id)
      || !isSupportedInstruction(context.program[other.instructionIndex])) return null;
    knownEdge = known[0];
    knownTarget = state.placements.get(knownEdge.to);
  } else {
    if (children.some((node) => !node || node.kind === "conditionalJump" || node.id === context.terminalId
      || state.placements.has(node.id) || !isSupportedInstruction(context.program[node.instructionIndex]))
      || children[0].id === children[1].id) return null;
    childWidth = Math.max(...children.map((node) => visual.sizeForKind(node.kind)[0] / 2));
  }
  const source = state.placements.get(edge.from);
  if (knownTarget && knownTarget.box.top <= source.box.bottom) return null;
  const sibling = context.cfg.outgoingByIndex.get(source.index)?.[edge.branch === "no" ? "yes" : "no"];
  if (!sibling) return null;
  const extent = committedBranchExtent(context, state, sibling.id, source.box.bottom, knownTarget?.box.top);
  if (!extent) return null;
  const sign = side === "left" ? -1 : 1;
  const faceX = source.cx + sign * source.box.w / 4;
  const boundary = extent[side];
  // Only a sibling that has folded onto this departure's own side needs width.
  // An existing target beyond that boundary does not require an inward approach.
  if ((boundary - faceX) * sign <= 0 || knownTarget && (knownTarget.cx - boundary) * sign >= 0) return null;
  const padding = visual.clearance + visual.sizeForKind(fork.kind)[0] / 4 + forkReach + childWidth;
  const reachFrom = (x) => (x - faceX) * sign + padding;
  const reach = reachFrom(boundary);
  if (knownTarget && propose && reach > baseReach) {
    const reduced = committedBranchExtent(context, state, sibling.id, source.box.bottom, knownTarget.box.top, knownEdge.to);
    const smaller = reduced ? Math.max(baseReach, reachFrom(reduced[side])) : reach;
    // Only the endpoint body leaves the estimate. All routes remain obstacles,
    // and a complete validated top entry must justify the reduced boundary.
    if (smaller < reach && legalTopConnection(state, propose(smaller), knownEdge, visual, forkReach)) {
      return smaller > baseReach ? smaller : null;
    }
  }
  return reach > baseReach ? reach : null;
}

export function preferredBranchOrientation(context, state, node, placement, { selfReturnOrientation = true, clearance = 16 } = {}) {
  const outgoing = context.cfg.outgoingByIndex.get(node.instructionIndex);
  const arms = ["no", "yes"].map((branch) => ({ branch,
    ...classifyStraightArm(context, state, outgoing?.[branch]) }));
  const orientation = (branch, side) => ({ [branch]: side,
    [branch === "yes" ? "no" : "yes"]: side === "left" ? "right" : "left" });
  const sideOf = (target) => Math.abs(target.cx - placement.cx) < 1 ? null
    : target.cx < placement.cx ? "left" : "right";

  // A direct Connect has known endpoint geometry. A fresh chain ending at a
  // placed target still needs Extend, so it does not count as a direct Connect.
  const existing = arms.filter((arm) => arm.committed && arm.freshNodeIds.length === 0
    && !["ancestor-return", "unresolved"].includes(arm.kind));
  if (existing.length === 1) {
    const other = arms.find((arm) => arm.branch !== existing[0].branch);
    const side = sideOf(state.placements.get(existing[0].target));
    if (side && other.freshNodeIds.length > 0 && !["ancestor-return", "unresolved"].includes(other.kind)) {
      return orientation(existing[0].branch, side);
    }
    // A fresh return chain supplies a second cue, not a universal departure
    // constraint. Its committed header must agree with the placed-target cue.
    if (side && other.kind === "ancestor-return" && other.committed && other.target !== node.id
      && other.freshNodeIds.length > 0) {
      const returnSide = headerOwnedReturnSide(context, state, context.cfg.edgeById.get(other.edgeId));
      if (returnSide === (side === "left" ? "right" : "left")) {
        return { ...placement.branchOrientation, ...orientation(existing[0].branch, side) };
      }
    }
  }

  const self = arms.find((arm) => arm.kind === "ancestor-return" && arm.target === node.id && arm.freshNodeIds.length > 0);
  const ancestor = arms.find((arm) => arm.kind === "ancestor-return" && arm.target !== node.id
    && arm.committed && arm.freshNodeIds.length > 0);
  const owner = context.ownership.ownerOf(node.id);
  const parent = state.placements.get(owner?.fork);
  if (selfReturnOrientation && self && ancestor && parent) {
    const sibling = context.cfg.outgoingByIndex.get(parent.index)?.[owner.side === "no" ? "yes" : "no"];
    const extent = sibling && committedBranchExtent(context, state, sibling.id, placement.box.top, placement.box.bottom);
    const outward = !extent ? null : extent.right + clearance <= placement.box.left ? "right"
      : extent.left - clearance >= placement.box.right ? "left" : null;
    const returnSide = headerOwnedReturnSide(context, state, context.cfg.edgeById.get(ancestor.edgeId));
    if (outward && outward === parent.branchOrientation?.[owner.side] && returnSide && outward !== returnSide) {
      return orientation(self.branch, outward);
    }
  }

  const returning = arms.find((arm) => arm.kind === "ancestor-return");
  const terminal = arms.find((arm) => arm.kind === "terminal");
  if (!returning || !terminal) return null;
  const side = headerOwnedReturnSide(context, state, context.cfg.edgeById.get(returning.edgeId));
  if (!side) return null;
  // A known terminal on the same side, or in the same column, is ambiguous.
  // With an unplaced terminal, keep its arm on the exterior side of the loop.
  const placedTerminal = state.placements.get(terminal.target);
  if (placedTerminal && sideOf(placedTerminal) !== (side === "left" ? "right" : "left")) return null;
  return orientation(returning.branch, side);
}
