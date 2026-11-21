// Single-connection candidates adapted from V4 routing.js, ports.js and the
// conditionalMergeSources/sameSideReentry constructions. No batch router or
// correction pass is invoked. Corridors see committed geometry only.
import { getLegalIncidentStubsForNode } from "../attachmentStubs.js";
import { snapshotConstructionRecord, applyConstructionEvent } from "../../sketchv4/constructionHistory.js";
import { validateConnection } from "./validation.js";
import { applyGeneralizedLoopTargetAttachments } from "../loopTargetAttachments.js";

function corridor(state, side, y0, y1, initialX, clearance) {
  const low = Math.min(y0, y1);
  const high = Math.max(y0, y1);
  const extend = side === "left" ? Math.min : Math.max;
  let x = initialX;
  for (const { box } of state.placements.values()) {
    if (box.top <= high && box.bottom >= low) x = extend(x, side === "left" ? box.left : box.right);
  }
  for (const route of state.routes.values()) {
    for (let i = 1; i < route.points.length; i += 1) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      if (Math.min(a[1], b[1]) <= high && Math.max(a[1], b[1]) >= low) x = extend(x, a[0], b[0]);
    }
  }
  return x + (side === "left" ? -clearance : clearance);
}

// Find the first downward row outside the clearance intervals of geometry
// crossing this horizontal run. Distant geometry after a free gap is irrelevant.
function clearTurnaroundRow(state, x0, x1, initialRow, clearance) {
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const intervals = [];
  for (const placement of state.placements.values()) {
    const b = placement.box;
    if (b.right < left || b.left > right) continue;
    // Clip the diamond's vertical extent to the run's X span; rectangles use
    // their body bounds, matching the existing legality and clearance vocabulary.
    const x = Math.max(left, Math.min(right, b.cx));
    const halfHeight = placement.kind === "conditionalJump"
      ? b.h / 2 * (1 - Math.abs(x - b.cx) / (b.w / 2)) : b.h / 2;
    intervals.push([b.cy - halfHeight - clearance, b.cy + halfHeight + clearance]);
  }
  for (const route of state.routes.values()) {
    for (let i = 1; i < route.points.length; i += 1) {
      const [a, b] = [route.points[i - 1], route.points[i]];
      const dx = b[0] - a[0];
      if (dx === 0 && (a[0] < left || a[0] > right)) continue;
      const lo = dx === 0 ? 0 : Math.max(0, Math.min((left - a[0]) / dx, (right - a[0]) / dx));
      const hi = dx === 0 ? 1 : Math.min(1, Math.max((left - a[0]) / dx, (right - a[0]) / dx));
      if (lo > hi) continue;
      const y0 = a[1] + lo * (b[1] - a[1]), y1 = a[1] + hi * (b[1] - a[1]);
      intervals.push([Math.min(y0, y1) - clearance, Math.max(y0, y1) + clearance]);
    }
  }
  let row = initialRow;
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (low >= row) break;
    if (high > row) row = high;
  }
  return row;
}

export function* proposeConnections(state, edge, { visual = {}, reach = 126, resumed = false, doorway, returnSide, cfg, roles } = {}) {
  const source = state.placements.get(edge.from);
  const target = state.placements.get(edge.to);
  const clearance = visual.clearance ?? 16;
  const tan = visual.branchAngleTan ?? Math.tan(33 * Math.PI / 180);
  const port = (p, name) => getLegalIncidentStubsForNode(p, { box: p.box }).find((s) => s.portName === name).portPoint;
  const conditional = source.kind === "conditionalJump";
  const branchSide = conditional ? source.branchOrientation[edge.branch] : null;
  const role = edge.isLoop ? "loop-return" : "merge-connector";
  const make = (rawPoints, connectorKind, extra = {}) => {
    // Remove duplicate consecutive bends only; never invent or move endpoints.
    const points = rawPoints.filter((p, i) => i === 0 || p[0] !== rawPoints[i - 1][0] || p[1] !== rawPoints[i - 1][1]);
    const sourcePort = points[0];
    const targetPort = points.at(-1);
    return { route: { edgeId: edge.id, source: edge.from, target: edge.to, edgeRole: role, routeFamily: role,
      connectorKind, portPolicyCase: `v5-connect-${connectorKind}`, sourcePort, targetPort, points,
      ...(conditional ? { branch: edge.branch, branchSide, branchResumed: resumed } : {}), ...extra },
    portSelection: { sourcePort, targetPort, changed: false, portPolicyCase: `v5-connect-${connectorKind}` } };
  };
  const top = port(target, "top");
  const bottom = port(source, "bottom");
  let prefix;
  if (conditional) {
    const face = port(source, branchSide === "left" ? "lower-left" : "lower-right");
    const ray = [face[0] + (branchSide === "left" ? -reach : reach), face[1] + reach * tan];
    prefix = [face, ray];
    // A direct fixed-angle arrival can share a top port with another direction.
    if (Math.abs(top[1] - face[1] - Math.abs(top[0] - face[0]) * tan) < 1e-9) yield make([face, top], "branch-straight");
    if (!edge.isLoop) {
      // Use V4's one-unit column tolerance. Clear the committed diamond body,
      // then return to the target's column for a vertical top-port arrival.
      const bendRow = source.box.bottom + clearance;
      if (Math.abs(source.cx - target.cx) < 1 && top[1] > bendRow) {
        const compactReach = (bendRow - face[1]) / tan;
        const compactRay = [face[0] + (branchSide === "left" ? -compactReach : compactReach), bendRow];
        yield make([face, compactRay, [top[0], bendRow], top], "branch-compact-top");
      }
      const targetSide = ray[0] < target.cx ? "left" : "right";
      const sidePort = port(target, targetSide);
      yield make([...prefix, [ray[0], sidePort[1]], sidePort], "branch-ray-vh");
      yield make([...prefix, [top[0], ray[1]], top], "branch-ray-top");
      // A shared side approach may overlap an earlier incoming route. Approach
      // the declared bottom port from below instead, without changing that edge.
      const targetBottom = port(target, "bottom");
      const row = targetBottom[1] + clearance;
      yield make([...prefix, [ray[0], row], [targetBottom[0], row], targetBottom], "branch-ray-bottom");
    }
  } else if (!edge.isLoop && top[1] > bottom[1]) {
    if (bottom[0] === top[0]) yield make([bottom, top], "straight");
    const side = source.cx < target.cx ? "left" : "right";
    const sidePort = port(target, side);
    // V4 merge-side / R17 footprint jog, computed before the route is committed.
    if (bottom[0] < target.box.left || bottom[0] > target.box.right) {
      yield make([bottom, [bottom[0], sidePort[1]], sidePort], "merge-side");
    } else {
      const jogX = side === "left" ? target.box.left - clearance : target.box.right + clearance;
      const midY = target.box.top - Math.min(clearance, Math.max(2, (target.box.top - bottom[1]) / 2));
      yield make([bottom, [bottom[0], midY], [jogX, midY], [jogX, sidePort[1]], sidePort], "merge-side-jog");
    }
    const midY = top[1] - Math.min(clearance, Math.max(2, (top[1] - bottom[1]) / 2));
    yield make([bottom, [bottom[0], midY], [top[0], midY], top], "merge-top");
  }
  const usualSide = branchSide ?? (source.cx < target.cx ? "left" : source.cx > target.cx ? "right" : doorway?.side ?? "left");
  const preferred = returnSide ?? usualSide;
  const sides = conditional ? [...new Set([preferred, usualSide])] : [preferred, preferred === "left" ? "right" : "left"];
  // Offer an upper-face arrival only after a blocked center approach on the
  // owned side. Reuse V4's pure port-ray construction on this single proposal;
  // its source, corridor and bottom turnaround remain exactly as proposed.
  function* arrivals(proposal, side) {
    yield proposal;
    if (!edge.isLoop || side !== returnSide || target.kind !== "conditionalJump" || !cfg || !roles) return;
    const validation = validateConnection(state, proposal, { branchAngleTan: tan });
    const arrivalSegment = proposal.route.points.length - 2;
    // Keep offering the independent arrival when center sharing is now legal.
    if (!validation.sharedTerminalApproach && !validation.violations.some((v) => v.segment === arrivalSegment
      && ["edge-edge-intersection", "edge-edge-overlap"].includes(v.code))) return;
    const row = target.box.top - clearance;
    const rail = proposal.route.railCoord;
    const sidePort = port(target, side);
    const baseline = make([...proposal.route.points.slice(0, -2), [rail, row], [sidePort[0], row], sidePort],
      `${proposal.route.connectorKind}-upper-face`, { railCoord: rail, targetApproachRow: row,
        ...(proposal.route.turnaroundRow == null ? {} : { turnaroundRow: proposal.route.turnaroundRow }) });
    const adapted = applyGeneralizedLoopTargetAttachments(cfg, roles,
      { routes: [baseline.route], ports: new Map([[edge.id, baseline.portSelection]]) },
      new Map([...state.placements].map(([id, p]) => [id, p.box])));
    if (adapted.changedEdgeIds.includes(edge.id)) {
      const route = adapted.routed.routes[0];
      yield { route, portSelection: { ...baseline.portSelection, targetPort: route.targetPort } };
    }
  }
  for (const side of sides) {
    const targetPort = port(target, side);
    const start = conditional ? prefix : [port(source, side)];
    const last = start.at(-1);
    const rail = corridor(state, side, last[1], targetPort[1], last[0], clearance);
    yield* arrivals(make([...start, [rail, last[1]], [rail, targetPort[1]], targetPort], "side-rail", { railCoord: rail }), side);
    if (!conditional) {
      // V4's bottom-source vocabulary also handles a self-loop without a U-turn
      // overlapping its departure. The complete route is checked.
      const row = bottom[1] + clearance;
      const bottomRail = corridor(state, side, row, targetPort[1], bottom[0], clearance);
      const bottomCandidate = make([bottom, [bottom[0], row], [bottomRail, row], [bottomRail, targetPort[1]], targetPort], "bottom-rail", { railCoord: bottomRail });
      yield* arrivals(bottomCandidate, side);
      if (edge.isLoop) {
        const validation = validateConnection(state, bottomCandidate, { branchAngleTan: tan });
        const blockedRun = validation.violations.some((v) => v.segment === 1
          && ["edge-node-contact", "edge-edge-intersection", "edge-edge-overlap"].includes(v.code));
        if (blockedRun) {
          const clearRow = clearTurnaroundRow(state, bottom[0], bottomRail, row, clearance);
          if (clearRow > row) {
            // Keep the selected corridor and endpoints. The caller validates
            // every leg before committing, including the longer vertical drop.
            yield* arrivals(make([bottom, [bottom[0], clearRow], [bottomRail, clearRow], [bottomRail, targetPort[1]], targetPort],
              "bottom-rail-clearance", { railCoord: bottomRail, turnaroundRow: clearRow }), side);
          }
        }
      }
    }
  }
  // Last forward alternative: approach the target's bottom from below. Keep
  // every earlier candidate ahead of it and avoid dropping through its body.
  if (!conditional && !edge.isLoop && top[1] > bottom[1]
    && (bottom[0] < target.box.left || bottom[0] > target.box.right)) {
    const targetBottom = port(target, "bottom");
    const row = targetBottom[1] + clearance;
    yield make([bottom, [bottom[0], row], [targetBottom[0], row], targetBottom], "bottom-entry", { turnaroundRow: row });
  }
}

// A port is an occupied location, not a reservation. Existing direct/compact
// geometry wins; occupancy orders comparable independent approaches. A normal
// shared approach is preferable to expanding a long fallback corridor.
export function prioritizeConnectionCandidates(state, proposals, validationOptions = {}) {
  return [...proposals].map((proposal, index) => {
    const validation = validateConnection(state, proposal, validationOptions);
    const route = proposal.route, port = route.points.at(-1);
    const same = (p) => Math.abs(p[0] - port[0]) <= 1e-9 && Math.abs(p[1] - port[1]) <= 1e-9;
    const used = [...state.routes.values()].some((old) =>
      old.target === route.target && same(old.points.at(-1)) || old.source === route.target && same(old.points[0]));
    const kind = route.connectorKind ?? "";
    const direct = ["straight", "branch-straight", "branch-compact-top"].includes(kind);
    const corridor = kind.startsWith("side-rail") || kind.startsWith("bottom-rail");
    const shared = validation.sharedTerminalApproach === true;
    const priority = !validation.legal ? 7 : !shared && direct ? 0
      : !corridor ? shared ? 3 : used ? 2 : 1
        : shared ? 6 : used ? 5 : 4;
    return { proposal, index, priority };
  }).sort((a, b) => a.priority - b.priority || a.index - b.index).map((entry) => entry.proposal);
}

export function commitConnection(state, proposal, options = {}) {
  const validation = validateConnection(state, proposal, options);
  if (!validation.legal) return { accepted: false, state, validation };
  const event = snapshotConstructionRecord({ sequence: options.sequence ?? 0, type: "edge-routed", phase: "connection",
    edgeId: proposal.route.edgeId, route: { ...proposal.route, legal: true }, portSelection: proposal.portSelection, validation });
  return { accepted: true, state: applyConstructionEvent(state, event), event, validation };
}
