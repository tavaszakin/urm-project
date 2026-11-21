// SketchV5.1 experiment: isolated V5 scheduler with a small extra port vocabulary.
// Official V5 is not edited. NO-first scheduling and existing diagonal choices
// are retained; a private straight loop-exit tail can first try the bottom port.
import { buildOrdinaryTerminalCfg } from "../sketchv4/cfg.js";
import { classifyRoles } from "./roles.js";
import { computeOwnership } from "./ownership.js";
import { getLegalIncidentStubsForNode } from "./attachmentStubs.js";
import { applyConstructionEvent, createConstructionReplayState, snapshotConstructionRecord } from "../sketchv4/constructionHistory.js";
import { isValidPlacement, validateExtension } from "./validation.js";
import { proposeConnections, prioritizeConnectionCandidates, commitConnection } from "./connections.js";
import { isSupportedInstruction, headerOwnedReturnSide, preferredBranchOrientation, preferredBranchReach } from "./orientation/structure.js";
import { proposeBottomExtension } from "./primitives.js";
import { prefersBottomContinuation } from "./bottomContinuation.js";
import { analyzeReceiverSides, receiverSideOrientation } from "./receiverSides.js";

const DEFAULT_ORIENTATION = Object.freeze({ no: "left", yes: "right" });
const defaultSize = (kind) => kind === "start" ? [48, 18]
  : kind === "conditionalJump" ? [82, 46] : [88, 30];
const resolveVisual = (visual = {}) => ({
  sizeForKind: visual.sizeForKind ?? defaultSize,
  pitch: { setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126, ...visual.pitch },
  branchAngleTan: visual.branchAngleTan ?? Math.tan(33 * Math.PI / 180),
  clearance: visual.clearance ?? 16,
});

function placementAt(node, role, cx, cy, sizeForKind, orientation) {
  const [w, h] = sizeForKind(node.kind);
  return { cx, cy, kind: node.kind, index: node.instructionIndex, role,
    ...(node.kind === "conditionalJump" ? { branchOrientation: orientation ?? DEFAULT_ORIENTATION } : {}),
    box: { cx, cy, w, h, left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 } };
}

// A proposal is private, provisional geometry. Nothing is installed in state here.
export function proposeStraightExtension(state, { edge, node, role, edgeRole, visual, orientation }) {
  const v = resolveVisual(visual);
  const source = state.placements.get(edge.from);
  const pitch = edgeRole === "setup-link" ? v.pitch.setupPitch : v.pitch.ordinaryPitch;
  const placement = placementAt(node, role, source.cx, source.cy + pitch, v.sizeForKind, orientation);
  const port = (kind, box, name) => getLegalIncidentStubsForNode({ kind }, { box })
    .find((stub) => stub.portName === name).portPoint;
  const sourcePort = port(source.kind, source.box, "bottom");
  const targetPort = port(node.kind, placement.box, "top");
  const route = {
    edgeId: edge.id, source: edge.from, target: edge.to, edgeRole,
    routeFamily: edgeRole === "entry-link" ? "entry" : edgeRole === "setup-link" ? "setup" : "spine",
    portPolicyCase: "v5-straight", connectorKind: null,
    sourcePort, targetPort, points: [sourcePort, targetPort],
  };
  return { nodeId: node.id, placement, placingEdgeId: edge.id, route,
    portSelection: { sourcePort, targetPort, changed: false, portPolicyCase: "v5-straight" } };
}

// Same lower-face / target-top construction and depth profile as V4 skeleton.js.
// Only a candidate is produced: the exit never exists independently of its child.
export function branchReachForDepth(depth, visual = {}) {
  const { pitch } = resolveVisual(visual);
  return Math.max(pitch.branchRayMin ?? 80,
    pitch.branchRayDistance * (pitch.branchRayOuterBoost ?? 1.45)
      * ((pitch.branchRayDepthDecay ?? 0.78) ** Math.max(0, depth)));
}

export function proposeBranchExtension(state, { edge, node, role, visual, orientation,
  side, depth = 0, reach = branchReachForDepth(depth, visual), resumed = false }) {
  const v = resolveVisual(visual);
  const source = state.placements.get(edge.from);
  const branchSide = side ?? source.branchOrientation[edge.branch];
  const stubName = branchSide === "left" ? "lower-left" : "lower-right";
  const sourcePort = getLegalIncidentStubsForNode(source, { box: source.box })
    .find((stub) => stub.portName === stubName).portPoint;
  const targetPort = [sourcePort[0] + (branchSide === "left" ? -reach : reach), sourcePort[1] + reach * v.branchAngleTan];
  const [, height] = v.sizeForKind(node.kind);
  const placement = placementAt(node, role, targetPort[0], targetPort[1] + height / 2, v.sizeForKind, orientation);
  return { nodeId: node.id, placement, placingEdgeId: edge.id,
    route: { edgeId: edge.id, source: edge.from, target: edge.to, edgeRole: "branch-exit", routeFamily: "branch-exit",
      branch: edge.branch, branchSide, branchDepth: depth, branchReach: reach, branchResumed: resumed,
      portPolicyCase: "v5-fixed-angle", connectorKind: null, sourcePort, targetPort, points: [sourcePort, targetPort] },
    portSelection: { sourcePort, targetPort, changed: false, portPolicyCase: "v5-fixed-angle" } };
}

// The only extension commitment point. Failed proposals return the exact input
// state. The same pure reducer drives the live constructor and recorded playback.
export function commitExtension(state, proposal, options = {}) {
  const validation = validateExtension(state, proposal, options);
  if (!validation.legal) return { accepted: false, state, validation };
  const event = snapshotConstructionRecord({
    sequence: options.sequence ?? 0, type: "extension-committed", phase: "extension",
    ...proposal, edgeId: proposal.route.edgeId, route: { ...proposal.route, legal: true },
    validation,
  });
  return { accepted: true, state: applyConstructionEvent(state, event), event, validation };
}

function boundsOver(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = points.length ? Math.min(...xs) : 0;
  const maxX = points.length ? Math.max(...xs) : 0;
  const minY = points.length ? Math.min(...ys) : 0;
  const maxY = points.length ? Math.max(...ys) : 0;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}


export function buildLayout(program, options = {}) {
  const topology = buildOrdinaryTerminalCfg(program);
  const { cfg, terminalId, terminalIndex } = topology;
  const roles = classifyRoles(cfg);
  const ownership = computeOwnership(cfg, roles);
  const structure = { cfg, ownership, terminalId, program: topology.augmentedProgram };
  const receiverSides = options.receiverSideAssignment !== false && options.structuralOrientation !== false
    && !options.orientationMap?.size ? analyzeReceiverSides(structure) : null;
  const receiverSideSelections = options.recordReceiverSides === true ? [] : null;
  const visual = resolveVisual(options.visual);
  let state = createConstructionReplayState();
  const history = [];
  let sequence = 0;
  const issues = [];
  const pendingYes = [];
  let fatal = null;
  const record = (event) => { if (options.recordConstruction === true) history.push(event); };
  const report = (status, code, message, details = {}) => {
    const issue = snapshotConstructionRecord({ status, code, message, atSequence: sequence, ...details });
    issues.push(issue);
    if (status === "failed") fatal = issue;
  };
  const start = placementAt(cfg.nodeById.get("start"), "start", 0, 0, visual.sizeForKind);
  if (!Array.isArray(program)) report("unsupported", "invalid-program", "SketchV5.1 (experimental) requires an instruction list.");
  else if (!isValidPlacement(start)) report("failed", "invalid-start", "SketchV5.1 (experimental) could not construct START.");
  else {
    const event = snapshotConstructionRecord({ sequence: sequence++, type: "node-placed", phase: "seed",
      nodeId: "start", placement: start, placingEdgeId: null });
    state = applyConstructionEvent(state, event);
    record(event);
  }

  // Schedule connections, not preplacements. Each doorway carries its source,
  // branch and held side. Closing one path does not discard deferred YES work.
  let work = state.placements.has("start") ? { edge: cfg.edgeById.get("entry"), depth: 0 } : null;
  while (!fatal && (work || pendingYes.length)) {
    if (!work) work = { ...pendingYes.pop(), resumed: true };
    const { edge, depth } = work;
    const node = cfg.nodeById.get(edge.to);
    const details = { edgeId: edge.id, source: edge.from, target: edge.to, nodeId: edge.to,
      instructionIndex: node?.instructionIndex, branch: edge.branch, side: work.side ?? null,
      resumed: work.resumed ?? false, orientation: work.orientation ?? null, doorway: work.doorway ?? null };
    if (state.placements.has(edge.to)) {
      const connectionKind = edge.isLoop ? "loop-return" : edge.to === terminalId ? "terminal-merge" : "merge";
      const attempts = [];
      let connected = false;
      const candidates = proposeConnections(state, edge, { visual, reach: branchReachForDepth(depth, visual),
        resumed: work.resumed, doorway: work.doorway, cfg, roles,
        flexiblePorts: options.flexiblePorts !== false, horizontalConnections: options.horizontalConnections !== false,
        returnSide: options.headerOwnedReturns === false ? null : headerOwnedReturnSide(structure, state, edge) });
      for (const proposal of prioritizeConnectionCandidates(state, candidates, { branchAngleTan: visual.branchAngleTan, flexiblePorts: options.flexiblePorts !== false })) {
        const transaction = commitConnection(state, proposal, { branchAngleTan: visual.branchAngleTan, flexiblePorts: options.flexiblePorts !== false, sequence });
        if (transaction.accepted) {
          state = transaction.state;
          sequence += 1;
          record(transaction.event);
          connected = true;
          break;
        }
        attempts.push({ proposal, validation: transaction.validation });
      }
      if (!connected) {
        report("failed", "illegal-connection", `SketchV5.1 (experimental): no supported route succeeded for ${edge.id} → ${edge.to}; showing the committed prefix.`,
          { ...details, operation: "connect", connectionKind, attempts });
        break;
      }
      work = null;
      continue;
    }
    if (!node || !isSupportedInstruction(topology.augmentedProgram[node.instructionIndex])) {
      report("unsupported", "unsupported-instruction", "SketchV5.1 (experimental) supports Z, S, T and J instructions; showing the committed prefix.", details);
      work = null;
      continue;
    }
    const orientation = options.orientationMap?.get(node.id) ?? DEFAULT_ORIENTATION;
    const proposalOptions = { edge, node, role: roles.nodeRoleById.get(node.id),
      edgeRole: roles.edgeRoleById.get(edge.id), visual, orientation,
      side: work.side, depth, resumed: work.resumed };
    let receiverSideSelected = false;
    const orient = (proposal) => {
      receiverSideSelected = false;
      if (node.kind === "conditionalJump" && !options.orientationMap?.has(node.id) && options.structuralOrientation !== false) {
        proposal.placement.branchOrientation = preferredBranchOrientation(structure, state, node, proposal.placement,
          { selfReturnOrientation: options.selfReturnOrientation !== false, clearance: visual.clearance }) ?? DEFAULT_ORIENTATION;
        const selected = receiverSideOrientation(receiverSides, state, work, proposal);
        if (selected) {
          proposal.placement.branchOrientation = selected;
          receiverSideSelected = true;
        }
      }
      return proposal;
    };
    const propose = (reach) => orient(edge.branch ? proposeBranchExtension(state, { ...proposalOptions, reach })
      : proposeStraightExtension(state, proposalOptions));
    const baseReach = branchReachForDepth(depth, visual);
    let reaches = edge.branch ? [
      baseReach, baseReach + visual.pitch.ordinaryPitch, baseReach + 2 * visual.pitch.ordinaryPitch,
      0.75 * baseReach, 0.5 * baseReach,
    ] : [null];
    const preferredReach = options.structuralWidth === false ? null : preferredBranchReach(structure, state, edge, {
      visual, side: work.side, resumed: work.resumed, baseReach, forkReach: branchReachForDepth(depth + 1, visual), orientation, propose, reachForDepth: branchReachForDepth,
    });
    if (preferredReach != null) reaches = [preferredReach, ...reaches.filter((reach) => reach !== preferredReach)];
    let transaction;
    const attempts = [];
    if (options.flexiblePorts !== false && options.bottomContinuations !== false
      && prefersBottomContinuation(structure, state, edge)) {
      const proposal = orient(proposeBottomExtension(state, proposalOptions));
      transaction = commitExtension(state, proposal, { clearance: visual.clearance, branchAngleTan: visual.branchAngleTan,
        flexiblePorts: options.flexiblePorts !== false, sequence });
      if (!transaction.accepted) attempts.push({ proposal, validation: transaction.validation });
    }
    for (const reach of reaches) {
      if (transaction?.accepted) break;
      const proposal = propose(reach);
      transaction = commitExtension(state, proposal, { clearance: visual.clearance, branchAngleTan: visual.branchAngleTan,
        flexiblePorts: options.flexiblePorts !== false, sequence });
      if (transaction.accepted) break;
      attempts.push({ proposal, validation: transaction.validation });
    }
    if (!transaction?.accepted) {
      report("failed", "illegal-extension", `SketchV5.1 (experimental) could not extend ${edge.id}; showing the committed prefix.`,
        { ...details, operation: "extend", attempts });
      break;
    }
    if (receiverSideSelections && receiverSideSelected) receiverSideSelections.push({ sequence, source: node.id });
    state = transaction.state;
    sequence += 1;
    record(transaction.event);
    const nodeDepth = depth + (edge.branch ? 1 : 0);
    if (node.id === terminalId) { work = null; continue; }
    const outgoing = cfg.outgoingByIndex.get(node.instructionIndex);
    if (node.kind === "conditionalJump") {
      // The held orientation was committed with the diamond. No target or exit
      // geometry is created when its YES doorway is put on this LIFO stack.
      const held = state.placements.get(node.id).branchOrientation;
      pendingYes.push({ edge: outgoing.yes, depth: nodeDepth, orientation: held, side: held.yes,
        doorway: { source: node.id, edgeId: outgoing.yes.id, branch: "yes", side: held.yes } });
      work = { edge: outgoing.no, depth: nodeDepth, orientation: held, side: held.no,
        doorway: { source: node.id, edgeId: outgoing.no.id, branch: "no", side: held.no } };
    } else if (outgoing?.cont) {
      work = { edge: outgoing.cont, depth: nodeDepth, doorway: work.doorway };
    } else {
      report("unsupported", "missing-continuation", "SketchV5.1 (experimental) could not continue this path.", details);
      work = null;
    }
  }

  const boxes = new Map([...state.placements].map(([id, p]) => [id, p.box]));
  const routes = [...state.routes.values()];
  const bodyPoints = [...boxes.values()].flatMap((b) => [[b.left, b.top], [b.right, b.bottom]]);
  const placementBounds = boundsOver(bodyPoints);
  const renderBounds = boundsOver(bodyPoints.concat(routes.flatMap((route) => route.points)));
  const terminal = state.placements.get(terminalId) ?? null;
  const coverage = { missingNodeIds: cfg.nodes.filter((node) => !state.placements.has(node.id)).map((node) => node.id),
    missingEdgeIds: cfg.edges.filter((edge) => !state.routes.has(edge.id)).map((edge) => edge.id) };
  if (!issues.length && (coverage.missingNodeIds.length || coverage.missingEdgeIds.length)) {
    report("unsupported", "unconstructed-cfg", "SketchV5.1 (experimental) has unconstructed CFG components; showing the committed prefix.", coverage);
  }
  const status = fatal ? "failed" : issues.length ? "unsupported" : "complete";
  const failure = fatal ?? issues[0] ?? null;
  if (!failure) record(snapshotConstructionRecord({ sequence, type: "construction-complete", phase: "complete",
    algorithm: "sketchV51", terminalId, terminalIndex, terminal, placementBounds, renderBounds }));
  return { algorithm: "sketchV51", status, failure, issues: Object.freeze(issues), coverage, cfg, roles, ownership,
    placements: state.placements, routes, ports: state.ports, boxes,
    terminalId, terminalIndex, terminal, placementBounds, renderBounds,
    ...(receiverSideSelections?.length ? { receiverSideDecision: snapshotConstructionRecord({
      departures: receiverSides.departures, receivers: receiverSides.receivers, conflicts: receiverSides.conflicts,
      selections: receiverSideSelections,
    }) } : {}),
    ...(options.recordConstruction === true ? { constructionHistory: Object.freeze(history) } : {}) };
}
