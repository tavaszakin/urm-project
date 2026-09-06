// Harness-only experiment: replace SketchV4's special sink with one synthetic ordinary
// instruction before structural traversal, then use the production ordinary V4 stages.
// This file is intentionally inside .flow-layout-probes/ (gitignored). It changes no source.

import { buildCfg } from "../src/layout/sketchv4/cfg.js";
import { classifyRoles } from "../src/layout/sketchv4/roles.js";
import { computeOwnership } from "../src/layout/sketchv4/ownership.js";
import { buildRealForkTree } from "../src/layout/sketchv4/realforktree.js";
import { buildSkeleton } from "../src/layout/sketchv4/skeleton.js";
import { computeLanes } from "../src/layout/sketchv4/lanes.js";
import { routeEdges } from "../src/layout/sketchv4/routing.js";
import { evaluateDefects } from "../src/layout/sketchv4/defects.js";
import { assignOrientation } from "../src/layout/sketchv4/orientation.js";
import { getLegalIncidentStubsForNode, validateEdgeAttachments } from "../src/layout/sketchv4/attachmentStubs.js";
import { buildLayout, roleGuardOrientation } from "../src/layout/sketchv4/pipeline.js";

const DEFAULT = { no: "left", yes: "right" };
const FLIPPED = { no: "right", yes: "left" };
const CLEARANCE = 16;
const SYNTHETIC_OPCODE = ["Z", 0]; // only supplies ordinary action-node identity and dimensions

const sizeForCurrentKind = (kind) =>
  kind === "start" || kind === "halt" ? [48, 18]
    : kind === "conditionalJump" ? [82, 46]
      : [88, 30];

// The experimental terminal is kind=action, so it receives the same 88x30 geometry and
// rectangle ports as every other Z/S/T instruction. No display styling feeds back here.
const sizeForOrdinaryKind = (kind) =>
  kind === "start" ? [48, 18]
    : kind === "conditionalJump" ? [82, 46]
      : [88, 30];

export const currentVisual = {
  sizeForKind: sizeForCurrentKind,
  branchAngleTan: Math.tan(33 * Math.PI / 180),
  pitch: { setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126 },
  terminalSize: [48, 18],
  haltBandOffset: 154,
  clearance: CLEARANCE,
};

const ordinaryVisual = { ...currentVisual, sizeForKind: sizeForOrdinaryKind };

// routeEdges/selectPorts currently require a HALT-shaped argument even when the CFG contains
// no halt node or halt-exit edge. This inert API adapter supplies no box, exits, band, or slots.
// Assertions below prove that no special branch reads geometry from it.
const NO_HALT_CONTEXT = Object.freeze({
  haltBox: null,
  haltExitRecords: Object.freeze([]),
  haltExitCount: 0,
  haltX: 0,
  haltBandOffset: 0,
});

const cloneInstruction = (instruction) => Array.isArray(instruction) ? [...instruction] : instruction;
const mapToObject = (map) => Object.fromEntries([...map].map(([id, value]) => [id, { ...value }]));
const bitName = (value) => value?.no === "right" ? "flipped" : "default";

function fail(message) {
  throw new Error(`ordinary-HALT purity assertion failed: ${message}`);
}

// Earliest practical seam: augment the program before production buildCfg(), so buildCfg's
// actual DFS/placed-once traversal sees i-N as an ordinary instruction. Any explicit jump that
// meant "outside the original program" is normalized to i-N; an implicit final fall-through
// reaches it naturally. After buildCfg has computed traversal/branch paths, remove only the
// dummy instruction's generated outgoing edge and the now-unreachable legacy sink.
function buildOrdinaryTerminalCfg(program) {
  const originalCount = program.length;
  const terminalIndex = originalCount;
  const terminalId = `i-${terminalIndex}`;
  const originalCfg = buildCfg(program);
  const originalRoles = classifyRoles(originalCfg);
  const originalHaltEdgeIds = new Set(
    originalCfg.edges
      .filter((edge) => originalRoles.edgeRoleById.get(edge.id) === "halt-exit")
      .map((edge) => edge.id),
  );

  const augmentedProgram = program.map((raw) => {
    const instruction = cloneInstruction(raw);
    if (Array.isArray(instruction) && String(instruction[0]).toUpperCase() === "J") {
      const target = Number(instruction[3]);
      if (!Number.isInteger(target) || target < 0 || target >= originalCount) {
        instruction[3] = terminalIndex;
      }
    }
    return instruction;
  });
  augmentedProgram.push([...SYNTHETIC_OPCODE]);

  const cfg = buildCfg(augmentedProgram);
  const syntheticOutgoingId = cfg.outgoingByIndex.get(terminalIndex)?.cont?.id;

  cfg.nodes = cfg.nodes.filter((node) => node.id !== "halt");
  cfg.nodeById.delete("halt");
  cfg.edges = cfg.edges.filter((edge) => edge.id !== syntheticOutgoingId && edge.to !== "halt");
  cfg.edgeById = new Map(cfg.edges.map((edge) => [edge.id, edge]));
  cfg.outgoingByIndex.set(terminalIndex, { yes: null, no: null, cont: null });
  cfg.sinkNodeId = terminalId;

  const incomingIds = new Set(cfg.edges.filter((edge) => edge.to === terminalId).map((edge) => edge.id));
  if (incomingIds.size !== originalHaltEdgeIds.size || [...originalHaltEdgeIds].some((id) => !incomingIds.has(id))) {
    fail(`redirected terminal inputs {${[...incomingIds]}} do not match original HALT inputs {${[...originalHaltEdgeIds]}}`);
  }
  if (cfg.nodeById.has("halt") || cfg.edges.some((edge) => edge.to === "halt")) fail("legacy halt survived CFG transformation");
  if (!cfg.dfsOrder.includes(terminalId) || !cfg.incomingEdgeByNode.has(terminalId)) fail("synthetic terminal was not placed by buildCfg traversal");

  return { cfg, originalCfg, originalRoles, originalHaltEdgeIds, terminalId, terminalIndex, augmentedProgram };
}

// Preserve semantic classification/orientation eligibility for every real program diamond,
// as requested. Only former halt-exit edges keep their transformed ordinary classification;
// all other actual-program edge roles remain byte-for-byte semantic peers of current V4.
function buildExperimentalRoles(parts) {
  const { cfg, originalRoles, originalHaltEdgeIds } = parts;
  const natural = classifyRoles(cfg);
  const nodeRoleById = new Map(natural.nodeRoleById);
  for (const [id, role] of originalRoles.nodeRoleById) if (id !== "halt") nodeRoleById.set(id, role);

  const edgeRoleById = new Map(natural.edgeRoleById);
  for (const [id, role] of originalRoles.edgeRoleById) {
    if (!originalHaltEdgeIds.has(id) && edgeRoleById.has(id)) edgeRoleById.set(id, role);
  }

  const reentryTagsByNode = new Map(natural.reentryTagsByNode);
  for (const [id, tags] of originalRoles.reentryTagsByNode) {
    if (id !== "halt") reentryTagsByNode.set(id, new Set(tags));
  }

  const roles = {
    ...natural,
    nodeRoleById,
    edgeRoleById,
    reentryTagsByNode,
    realForkIds: [...originalRoles.realForkIds],
    realForkSet: new Set(originalRoles.realForkIds),
    warnings: [...originalRoles.warnings, ...natural.warnings],
  };

  const originalForks = [...originalRoles.realForkIds].join(",");
  if (roles.realForkIds.join(",") !== originalForks) fail("actual-program real-fork set changed");
  if ([...roles.edgeRoleById.values()].includes("halt-exit")) fail("halt-exit role survived experimental classification");
  return roles;
}

function boundsOver(boxes, routes) {
  const points = [];
  for (const box of boxes.values()) points.push([box.left, box.top], [box.right, box.bottom]);
  for (const route of routes) points.push(...route.points);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function attachmentRecords(cfg, roles, boxes, routes) {
  return routes.map((route) => {
    const sourceNode = cfg.nodeById.get(route.source);
    const targetNode = cfg.nodeById.get(route.target);
    const record = validateEdgeAttachments(route, sourceNode, targetNode, route.points, {
      sourceBox: boxes.get(route.source),
      targetBox: boxes.get(route.target),
    });
    return { ...record, source: record.source, target: record.target };
  });
}

function realizeExperimental(base, orientationMap) {
  const { cfg, roles, ownership, tree, guardOrientationOf } = base;
  const orientationOf = (id) => roles.realForkSet.has(id)
    ? (orientationMap.get(id) ?? DEFAULT)
    : (guardOrientationOf(id) ?? DEFAULT);
  const skeleton = buildSkeleton(cfg, roles, {
    orientationOf,
    sizeForKind: ordinaryVisual.sizeForKind,
    branchAngleTan: ordinaryVisual.branchAngleTan,
    pitch: ordinaryVisual.pitch,
  });
  const lanes = computeLanes(cfg, roles, ownership, skeleton, { orientationOf });
  const routed = routeEdges(cfg, roles, ownership, skeleton, lanes, NO_HALT_CONTEXT, { clearance: CLEARANCE });
  const boxes = new Map([...skeleton.placements].map(([id, placement]) => [id, placement.box]));
  const defects = evaluateDefects(
    { routes: routed.routes, boxes },
    { realForkSet: roles.realForkSet, lcaRF: tree.lcaRF },
    { clearance: CLEARANCE, program: base.programName, orientationSource: "ordinarySyntheticTerminal" },
  );

  if (skeleton.placements.has("halt") || boxes.has("halt")) fail("legacy halt received placement");
  if (routed.routes.some((route) => route.edgeRole === "halt-exit" || route.routeFamily === "halt")) fail("special HALT route path executed");
  if ([...routed.ports.values()].some((port) => String(port.portPolicyCase).startsWith("halt-"))) fail("special HALT port policy executed");
  if (!skeleton.placements.has(base.terminalId)) fail("synthetic terminal missing ordinary skeleton placement");
  const terminalPlacement = skeleton.placements.get(base.terminalId);
  if (terminalPlacement.kind !== "action" || terminalPlacement.box.w !== 88 || terminalPlacement.box.h !== 30) {
    fail("synthetic terminal did not receive ordinary action-node geometry");
  }

  return {
    mode: "ordinary",
    programName: base.programName,
    program: base.program,
    cfg, roles, ownership, tree, orientationMap, orientationOf,
    skeleton, lanes, routed, ports: routed.ports, boxes, defects,
    renderBounds: boundsOver(boxes, routed.routes),
    attachments: attachmentRecords(cfg, roles, boxes, routed.routes),
    terminalId: base.terminalId,
    purity: {
      placeHaltCalled: false,
      legacyHaltNodePresent: false,
      haltExitRoleCount: 0,
      haltRouteCount: 0,
      haltPortPolicyCount: 0,
      inertRouteApiContextOnly: true,
    },
  };
}

function experimentalBase(program, programName) {
  const parts = buildOrdinaryTerminalCfg(program);
  const roles = buildExperimentalRoles(parts);
  const ownership = computeOwnership(parts.cfg, roles);
  const tree = buildRealForkTree(parts.cfg, roles);
  const guardOrientationOf = roleGuardOrientation(parts.originalCfg, parts.originalRoles);
  return { ...parts, roles, ownership, tree, guardOrientationOf, program, programName };
}

export function buildOrdinaryTerminalViews(program, programName, forceForkId = null) {
  const base = experimentalBase(program, programName);
  const evaluate = (orientationMap) => realizeExperimental(base, orientationMap).defects;
  const orientationResult = assignOrientation({
    realForks: base.roles.realForkIds,
    bottomUp: base.tree.bottomUp,
    rfParent: base.tree.rfParent,
    rfChildren: base.tree.rfChildren,
    evaluate,
    pins: new Map(),
  });
  const normal = realizeExperimental(base, orientationResult.orientationMap);
  normal.orientationResult = orientationResult;
  normal.viewLabel = "Ordinary HALT";

  let forced = null;
  if (forceForkId && base.roles.realForkSet.has(forceForkId)) {
    const forcedMap = new Map([...orientationResult.orientationMap].map(([id, value]) => [id, { ...value }]));
    const current = forcedMap.get(forceForkId) ?? DEFAULT;
    forcedMap.set(forceForkId, current.no === "left" ? { ...FLIPPED } : { ...DEFAULT });
    forced = realizeExperimental(base, forcedMap);
    forced.orientationResult = orientationResult;
    forced.forcedForkId = forceForkId;
    forced.viewLabel = `Ordinary HALT + ${forceForkId} flipped`;
    const changed = base.roles.realForkIds.filter((id) => bitName(forcedMap.get(id)) !== bitName(orientationResult.orientationMap.get(id)));
    if (changed.length !== 1 || changed[0] !== forceForkId) fail(`forced view changed forks {${changed.join(",")}}`);
  }
  return { base, normal, forced };
}

// Narrow comparison variant: keep the identical augmented CFG, but allow the transformed
// graph's own production role classification to stand. No original node roles, edge roles,
// or real-fork membership are restored in this realization.
export function buildRawRoleOrdinaryTerminalView(program, programName) {
  const parts = buildOrdinaryTerminalCfg(program);
  const roles = classifyRoles(parts.cfg);
  if ([...roles.edgeRoleById.values()].includes("halt-exit")) fail("halt-exit role survived raw-role classification");
  const ownership = computeOwnership(parts.cfg, roles);
  const tree = buildRealForkTree(parts.cfg, roles);
  const guardOrientationOf = roleGuardOrientation(parts.cfg, roles);
  const base = { ...parts, roles, ownership, tree, guardOrientationOf, program, programName };
  const evaluate = (orientationMap) => realizeExperimental(base, orientationMap).defects;
  const orientationResult = assignOrientation({
    realForks: roles.realForkIds,
    bottomUp: tree.bottomUp,
    rfParent: tree.rfParent,
    rfChildren: tree.rfChildren,
    evaluate,
    pins: new Map(),
  });
  const view = realizeExperimental(base, orientationResult.orientationMap);
  view.orientationResult = orientationResult;
  view.viewLabel = "Ordinary HALT — raw roles";
  view.purity = { ...view.purity, roleClassification: "raw production classifyRoles(transformedCfg)" };
  return view;
}

// Diagnostic-only comparison: keep the completed raw-role assignment intact and replace
// exactly one selected fork bit with the canonical default. This realization is never passed
// back to assignOrientation and therefore cannot influence selection.
export function buildRawRoleForcedDefaultView(rawView, forkId) {
  if (!rawView.roles.realForkSet.has(forkId)) fail(`${forkId} is not a raw-role real fork`);
  const forcedMap = new Map([...rawView.orientationMap].map(([id, value]) => [id, { ...value }]));
  forcedMap.set(forkId, { ...DEFAULT });
  const changed = rawView.roles.realForkIds.filter((id) => bitName(forcedMap.get(id)) !== bitName(rawView.orientationMap.get(id)));
  if (changed.length !== 1 || changed[0] !== forkId) fail(`forced-default view changed forks {${changed.join(",")}}`);
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };
  const view = realizeExperimental(base, forcedMap);
  view.orientationResult = rawView.orientationResult;
  view.forcedForkId = forkId;
  view.viewLabel = `Ordinary HALT — raw roles + ${forkId} forced default`;
  view.purity = {
    ...view.purity,
    roleClassification: "raw production classifyRoles(transformedCfg)",
    diagnosticForcedDefaultOnly: forkId,
    orientationSelectionRerun: false,
  };
  return view;
}

// One-edge divides diagnostic. Keep the ordinary merge role, target port, and connector kind,
// but use the same rectangle-side source port vocabulary as an ordinary loop-return. The first
// merge drop follows that port's X; any later side-entry jog/body remains byte-for-byte the
// baseline body. This deliberately does not add an outward stub or a new route family.
function applySidePortMergeSource(view, sourceSide, edgeId = "i-57-cont") {
  const edge = view.cfg.edgeById.get(edgeId);
  const baselineRoute = view.routed.routes.find((route) => route.edgeId === edgeId);
  const sourceBox = view.boxes.get(edge?.from);
  if (sourceSide !== "left" && sourceSide !== "right") fail(`unknown source side ${sourceSide}`);
  if (!edge || !baselineRoute || !sourceBox || baselineRoute.edgeRole !== "merge-connector") {
    fail(`cannot apply left-port merge-source diagnostic to ${edgeId}`);
  }
  if (baselineRoute.connectorKind !== "sideEntry" && baselineRoute.connectorKind !== "sideEntryJog") {
    fail(`${edgeId} did not use an ordinary side-entry merge body`);
  }

  const oldSourcePort = [...baselineRoute.sourcePort];
  const sourcePort = [sourceSide === "left" ? sourceBox.left : sourceBox.right, sourceBox.cy];
  const targetPort = [...baselineRoute.targetPort];
  const oldPoints = baselineRoute.points.map((point) => [...point]);
  const points = baselineRoute.connectorKind === "sideEntry"
    ? [sourcePort, [sourcePort[0], targetPort[1]], targetPort]
    : [sourcePort, [sourcePort[0], baselineRoute.points[1][1]], ...baselineRoute.points.slice(2).map((point) => [...point])];
  const route = {
    ...baselineRoute,
    sourcePort,
    targetPort,
    points,
  };
  const routes = view.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
  const ports = new Map(view.routed.ports);
  ports.set(edgeId, {
    ...ports.get(edgeId),
    sourcePort,
    targetPort,
    experimentalLeftSourcePort: true,
  });
  const routed = { ...view.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: view.boxes },
    { realForkSet: view.roles.realForkSet, lcaRF: view.tree.lcaRF },
    { clearance: CLEARANCE, program: view.programName, orientationSource: "rawRolesI57LeftSource" },
  );
  return {
    ...view,
    routed,
    ports,
    defects,
    renderBounds: boundsOver(view.boxes, routes),
    attachments: attachmentRecords(view.cfg, view.roles, view.boxes, routes),
    experimentalRouteSplice: {
      edgeId,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      connectorKind: route.connectorKind,
      sourcePortRule: `rectangle ${sourceSide}-center (same port vocabulary as ordinary loop-return)`,
      oldSourcePort,
      newSourcePort: sourcePort,
      oldRoutePoints: oldPoints,
      newRoutePoints: points,
      targetPort,
    },
    purity: {
      ...view.purity,
      oneEdgeGeometrySpliceOnly: edgeId,
      sourcePortOnlyDiagnostic: `${sourceSide}-center`,
      routeFamilyChanged: false,
      targetPortChanged: false,
      automaticRepairAfterConstruction: false,
      haltSpecificMachineryAdded: false,
    },
  };
}

function buildI57SidePortDiagnosticViews(rawView, sourceSide, forkId = "i-25") {
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };

  const forcedMap = new Map([...rawView.orientationMap].map(([id, value]) => [id, { ...value }]));
  forcedMap.set(forkId, { ...DEFAULT });
  const forcedBase = realizeExperimental(base, forcedMap);
  const forcedDefault = applySidePortMergeSource(forcedBase, sourceSide);
  forcedDefault.orientationResult = rawView.orientationResult;
  forcedDefault.forcedForkId = forkId;
  forcedDefault.viewLabel = `Ordinary HALT — ${forkId} default + i-57 ${sourceSide} source`;

  const evaluate = (orientationMap) => applySidePortMergeSource(realizeExperimental(base, orientationMap), sourceSide).defects;
  const orientationResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate,
    pins: new Map(),
  });
  const automatic = applySidePortMergeSource(realizeExperimental(base, orientationResult.orientationMap), sourceSide);
  automatic.orientationResult = orientationResult;
  automatic.viewLabel = `Ordinary HALT — i-57 ${sourceSide} source + reassigned orientation`;
  automatic.purity = { ...automatic.purity, orientationSelectionUsesI57SideSource: sourceSide };

  // Preserve the two exact oracle inputs used at this fork for read-only reporting. Deeper
  // decisions have their chosen bits; not-yet-processed ancestors retain the DP default.
  const candidateBaseMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  for (const row of orientationResult.rows) {
    if (row.realForkId === forkId) break;
    candidateBaseMap.set(row.realForkId, row.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  }
  const defaultCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  defaultCandidateMap.set(forkId, { ...DEFAULT });
  const flippedCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  flippedCandidateMap.set(forkId, { ...FLIPPED });
  const orientationCandidates = {
    default: applySidePortMergeSource(realizeExperimental(base, defaultCandidateMap), sourceSide),
    flipped: applySidePortMergeSource(realizeExperimental(base, flippedCandidateMap), sourceSide),
  };

  return { forcedDefault, automatic, orientationCandidates };
}

export function buildI57LeftPortDiagnosticViews(rawView, forkId = "i-25") {
  return buildI57SidePortDiagnosticViews(rawView, "left", forkId);
}

export function buildI57RightPortDiagnosticViews(rawView, forkId = "i-25") {
  return buildI57SidePortDiagnosticViews(rawView, "right", forkId);
}

// Handwritten-shape diagnostic for divides: right-center source, an outward horizontal stub
// to a deterministic right-side corridor, vertical descent, then horizontal west into the
// target's right-center port. The corridor reuses the existing clearance and right-side
// merge-jog convention: one clearance unit beyond the farther right node boundary.
function applyRightToRightHvhMerge(view, edgeId = "i-57-cont") {
  const edge = view.cfg.edgeById.get(edgeId);
  const baselineRoute = view.routed.routes.find((route) => route.edgeId === edgeId);
  const sourceBox = view.boxes.get(edge?.from);
  const targetBox = view.boxes.get(edge?.to);
  if (!edge || !baselineRoute || !sourceBox || !targetBox || baselineRoute.edgeRole !== "merge-connector") {
    fail(`cannot apply right-to-right H/V/H diagnostic to ${edgeId}`);
  }

  const oldSourcePort = [...baselineRoute.sourcePort];
  const oldTargetPort = [...baselineRoute.targetPort];
  const oldPoints = baselineRoute.points.map((point) => [...point]);
  const sourcePort = [sourceBox.right, sourceBox.cy];
  const targetPort = [targetBox.right, targetBox.cy];
  const corridorX = Math.max(sourceBox.right, targetBox.right) + CLEARANCE;
  const points = [
    sourcePort,
    [corridorX, sourcePort[1]],
    [corridorX, targetPort[1]],
    targetPort,
  ];
  const route = {
    ...baselineRoute,
    sourcePort,
    targetPort,
    points,
    connectorKind: "sideEntryJog",
  };
  const routes = view.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
  const ports = new Map(view.routed.ports);
  ports.set(edgeId, {
    ...ports.get(edgeId),
    sourcePort,
    targetPort,
    sideEntryJogX: corridorX,
    experimentalRightToRightHvh: true,
  });
  const routed = { ...view.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: view.boxes },
    { realForkSet: view.roles.realForkSet, lcaRF: view.tree.lcaRF },
    { clearance: CLEARANCE, program: view.programName, orientationSource: "rawRolesI57RightToRightHvh" },
  );
  return {
    ...view,
    routed,
    ports,
    defects,
    renderBounds: boundsOver(view.boxes, routes),
    attachments: attachmentRecords(view.cfg, view.roles, view.boxes, routes),
    experimentalRouteSplice: {
      edgeId,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      connectorKind: route.connectorKind,
      routeShape: "right port -> H -> V -> H -> right port",
      corridorRule: "max(sourceBox.right, targetBox.right) + existing V4 clearance",
      clearance: CLEARANCE,
      corridorX,
      oldSourcePort,
      newSourcePort: sourcePort,
      oldTargetPort,
      newTargetPort: targetPort,
      oldRoutePoints: oldPoints,
      newRoutePoints: points,
    },
    purity: {
      ...view.purity,
      oneEdgeGeometrySpliceOnly: edgeId,
      routeFamilyChanged: false,
      automaticRepairAfterConstruction: false,
      obstacleSearchUsed: false,
      haltSpecificMachineryAdded: false,
    },
  };
}

export function buildI57RightToRightHvhDiagnosticViews(rawView, forkId = "i-25") {
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };
  const apply = (orientationMap) => applyRightToRightHvhMerge(realizeExperimental(base, orientationMap));

  const forcedMap = new Map([...rawView.orientationMap].map(([id, value]) => [id, { ...value }]));
  forcedMap.set(forkId, { ...DEFAULT });
  const forcedDefault = apply(forcedMap);
  forcedDefault.orientationResult = rawView.orientationResult;
  forcedDefault.forcedForkId = forkId;
  forcedDefault.viewLabel = `Ordinary HALT — ${forkId} default + i-57 right→right H/V/H`;

  const orientationResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate: (orientationMap) => apply(orientationMap).defects,
    pins: new Map(),
  });
  const automatic = apply(orientationResult.orientationMap);
  automatic.orientationResult = orientationResult;
  automatic.viewLabel = "Ordinary HALT — i-57 right→right H/V/H + reassigned orientation";
  automatic.purity = { ...automatic.purity, orientationSelectionUsesI57RightToRightHvh: true };

  const candidateBaseMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  for (const row of orientationResult.rows) {
    if (row.realForkId === forkId) break;
    candidateBaseMap.set(row.realForkId, row.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  }
  const defaultCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  defaultCandidateMap.set(forkId, { ...DEFAULT });
  const flippedCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  flippedCandidateMap.set(forkId, { ...FLIPPED });

  return {
    forcedDefault,
    automatic,
    orientationCandidates: {
      default: apply(defaultCandidateMap),
      flipped: apply(flippedCandidateMap),
    },
  };
}

// Combined diagnostic: each orientation candidate first receives the complete adaptive
// conditional-merge experiment, then the independent i-57 right-to-right H/V/H splice.
// Orientation therefore scores the actual combined geometry rather than inheriting raw-role
// bits or retrofitting either route transformation after selection.
export function buildAdaptiveRightReentryDiagnosticView(rawView, forkId = "i-25") {
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };
  const realizeAdaptive = (orientationMap) => buildAdaptiveBranchRayMergeSourcesView(realizeExperimental(base, orientationMap));
  const realizeCombined = (orientationMap) => applyRightToRightHvhMerge(realizeAdaptive(orientationMap));
  const orientationResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate: (orientationMap) => realizeCombined(orientationMap).defects,
    pins: new Map(),
  });

  const adaptiveOnlyControl = realizeAdaptive(orientationResult.orientationMap);
  const view = applyRightToRightHvhMerge(adaptiveOnlyControl);
  const changedAgainstSameOrientationAdaptive = adaptiveOnlyControl.routed.routes
    .filter((route) => JSON.stringify(route) !== JSON.stringify(view.routed.routes.find((candidate) => candidate.edgeId === route.edgeId)))
    .map((route) => route.edgeId);
  if (changedAgainstSameOrientationAdaptive.length !== 1 || changedAgainstSameOrientationAdaptive[0] !== "i-57-cont") {
    fail(`combined adaptive view changed unexpected routes {${changedAgainstSameOrientationAdaptive.join(",")}}`);
  }
  view.orientationResult = orientationResult;
  view.viewLabel = "Ordinary HALT — adaptive merges + right-side reentry";
  view.purity = {
    ...view.purity,
    combinedExperimentOrder: ["raw transformed realization", "adaptive branch-merge routes", "i-57 right-to-right H/V/H"],
    orientationSelectionUsesCombinedGeometry: true,
    changedAgainstSameOrientationAdaptive,
  };

  const candidateBaseMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  for (const row of orientationResult.rows) {
    if (row.realForkId === forkId) break;
    candidateBaseMap.set(row.realForkId, row.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  }
  const defaultCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  defaultCandidateMap.set(forkId, { ...DEFAULT });
  const flippedCandidateMap = new Map([...candidateBaseMap].map(([id, value]) => [id, { ...value }]));
  flippedCandidateMap.set(forkId, { ...FLIPPED });

  return {
    view,
    adaptiveOnlyControl,
    orientationCandidates: {
      default: realizeCombined(defaultCandidateMap),
      flipped: realizeCombined(flippedCandidateMap),
    },
  };
}

// Two-edge divides-only attachment experiment over the completed combined baseline. Preserve
// each existing side port, loop-return rail, target port, and route suffix from the first rail
// approach onward. Insert one clearance unit outward, then move the source-local vertical leg
// to that X. No orientation, placement, port, or rail decision is rerun.
export function buildI27I52OutwardSourceStubView(combinedView) {
  const edgeIds = ["i-27-jump", "i-52-jump"];
  if (combinedView.programName !== "characteristic:divides") {
    fail("i-27/i-52 outward-source-stub experiment is divides-only");
  }

  const changedById = new Map();
  const changes = [];
  for (const edgeId of edgeIds) {
    const edge = combinedView.cfg.edgeById.get(edgeId);
    const baselineRoute = combinedView.routed.routes.find((route) => route.edgeId === edgeId);
    const sourceBox = combinedView.boxes.get(edge?.from);
    if (!edge || !baselineRoute || !sourceBox || baselineRoute.edgeRole !== "loop-return" || baselineRoute.points.length < 3) {
      fail(`cannot apply outward source stub to ${edgeId}`);
    }

    const sourcePort = [...baselineRoute.sourcePort];
    const oldTargetPort = [...baselineRoute.targetPort];
    const oldPoints = baselineRoute.points.map((point) => [...point]);
    if (JSON.stringify(oldPoints[0]) !== JSON.stringify(sourcePort) || Math.abs(oldPoints[1][0] - sourcePort[0]) > 1e-9) {
      fail(`${edgeId} does not begin with the expected vertical side-port departure`);
    }

    const sourceSide = Math.abs(sourcePort[0] - sourceBox.left) <= 1e-9 ? "left"
      : Math.abs(sourcePort[0] - sourceBox.right) <= 1e-9 ? "right"
        : null;
    if (!sourceSide) fail(`${edgeId} source is not attached to a rectangle side port`);
    const direction = sourceSide === "left" ? -1 : 1;
    const stubEnd = [sourcePort[0] + direction * CLEARANCE, sourcePort[1]];
    const shiftedVerticalEnd = [stubEnd[0], oldPoints[1][1]];
    const points = [sourcePort, stubEnd, shiftedVerticalEnd, ...oldPoints.slice(2).map((point) => [...point])];
    const route = { ...baselineRoute, points };
    changedById.set(edgeId, route);
    changes.push({
      edgeId,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      sourceSide,
      sourcePort,
      targetPort: oldTargetPort,
      oldRoutePoints: oldPoints,
      newRoutePoints: points,
      outwardStub: [sourcePort, stubEnd],
      outwardStubLength: CLEARANCE,
      outwardStubRule: "one existing V4 clearance unit outward from the unchanged side port",
      shiftedSourceLocalVertical: [stubEnd, shiftedVerticalEnd],
      preservedRouteSuffix: oldPoints.slice(2).map((point) => [...point]),
    });
  }

  const routes = combinedView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
  const routed = { ...combinedView.routed, routes };
  const defects = evaluateDefects(
    { routes, boxes: combinedView.boxes },
    { realForkSet: combinedView.roles.realForkSet, lcaRF: combinedView.tree.lcaRF },
    { clearance: CLEARANCE, program: combinedView.programName, orientationSource: "combinedI27I52OutwardSourceStubs" },
  );
  const attachments = attachmentRecords(combinedView.cfg, combinedView.roles, combinedView.boxes, routes);
  const attachmentChanges = changes.map((change) => {
    const oldAttachment = combinedView.attachments.find((record) => record.edgeId === change.edgeId);
    const newAttachment = attachments.find((record) => record.edgeId === change.edgeId);
    return {
      ...change,
      oldAttachmentLegality: {
        source: oldAttachment?.source?.legal ?? null,
        target: oldAttachment?.target?.legal ?? null,
        overall: oldAttachment?.legal ?? null,
      },
      newAttachmentLegality: {
        source: newAttachment?.source?.legal ?? null,
        target: newAttachment?.target?.legal ?? null,
        overall: newAttachment?.legal ?? null,
      },
    };
  });

  return {
    ...combinedView,
    routed,
    defects,
    attachments,
    renderBounds: boundsOver(combinedView.boxes, routes),
    viewLabel: "Ordinary HALT — combined baseline + i-27/i-52 outward source stubs",
    experimentalRouteSplices: [...(combinedView.experimentalRouteSplices ?? []), ...attachmentChanges],
    experimentalOutwardSourceStubs: attachmentChanges,
    purity: {
      ...combinedView.purity,
      outwardSourceStubEdgeIds: edgeIds,
      outwardSourceStubLength: CLEARANCE,
      orientationSelectionRerun: false,
      sourcePortsChanged: false,
      targetPortsChanged: false,
      loopReturnRailsChanged: false,
      nodePositionsChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

// Divides-only A/B source-port comparison for one explicitly named backward loop at a time.
// Both shapes retain the established bend row and the route suffix beginning with the existing
// horizontal-to-rail endpoint. This deliberately does not select a winner or define a policy.
function buildSingleLoopSourcePortVariant(combinedView, edgeId, sourceMode) {
  const allowedEdgeIds = new Set(["i-27-jump", "i-52-jump"]);
  if (combinedView.programName !== "characteristic:divides" || !allowedEdgeIds.has(edgeId)) {
    fail(`source-port comparison is not defined for ${combinedView.programName}:${edgeId}`);
  }
  if (sourceMode !== "side" && sourceMode !== "bottom") fail(`unknown source-port comparison mode ${sourceMode}`);

  const edge = combinedView.cfg.edgeById.get(edgeId);
  const baselineRoute = combinedView.routed.routes.find((route) => route.edgeId === edgeId);
  const sourceBox = combinedView.boxes.get(edge?.from);
  if (!edge || !baselineRoute || !sourceBox || baselineRoute.edgeRole !== "loop-return" || baselineRoute.points.length < 3) {
    fail(`cannot build source-port comparison for ${edgeId}`);
  }

  const oldSourcePort = [...baselineRoute.sourcePort];
  const targetPort = [...baselineRoute.targetPort];
  const oldPoints = baselineRoute.points.map((point) => [...point]);
  const bendRow = oldPoints[1][1];
  if (JSON.stringify(oldPoints[0]) !== JSON.stringify(oldSourcePort) || Math.abs(oldPoints[1][0] - oldSourcePort[0]) > 1e-9) {
    fail(`${edgeId} does not have the expected baseline side-port/vertical departure`);
  }

  const sourceSide = Math.abs(oldSourcePort[0] - sourceBox.left) <= 1e-9 ? "left"
    : Math.abs(oldSourcePort[0] - sourceBox.right) <= 1e-9 ? "right"
      : null;
  if (!sourceSide) fail(`${edgeId} baseline source is not a rectangle side port`);

  let sourcePort;
  let sourceDeparture;
  let points;
  let departureRule;
  if (sourceMode === "side") {
    sourcePort = oldSourcePort;
    const direction = sourceSide === "left" ? -1 : 1;
    const stubEnd = [sourcePort[0] + direction * CLEARANCE, sourcePort[1]];
    const shiftedVerticalEnd = [stubEnd[0], bendRow];
    sourceDeparture = [sourcePort, stubEnd, shiftedVerticalEnd];
    points = [...sourceDeparture, ...oldPoints.slice(2).map((point) => [...point])];
    departureRule = `unchanged ${sourceSide} port, ${CLEARANCE}px outward, then vertical to unchanged bend row`;
  } else {
    sourcePort = [sourceBox.cx, sourceBox.bottom];
    const verticalEnd = [sourcePort[0], bendRow];
    sourceDeparture = [sourcePort, verticalEnd];
    points = [...sourceDeparture, ...oldPoints.slice(2).map((point) => [...point])];
    departureRule = "bottom-center port, then vertical downward to unchanged bend row";
  }

  const route = { ...baselineRoute, sourcePort, targetPort, points };
  const routes = combinedView.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
  const ports = sourceMode === "bottom" ? new Map(combinedView.routed.ports) : combinedView.routed.ports;
  if (sourceMode === "bottom") {
    ports.set(edgeId, {
      ...ports.get(edgeId),
      sourcePort,
      changed: true,
      experimentalBottomSourcePort: true,
    });
  }
  const routed = { ...combinedView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: combinedView.boxes },
    { realForkSet: combinedView.roles.realForkSet, lcaRF: combinedView.tree.lcaRF },
    { clearance: CLEARANCE, program: combinedView.programName, orientationSource: `combined${edge.from}${sourceMode}SourcePort` },
  );
  const attachments = attachmentRecords(combinedView.cfg, combinedView.roles, combinedView.boxes, routes);
  const oldAttachment = combinedView.attachments.find((record) => record.edgeId === edgeId);
  const newAttachment = attachments.find((record) => record.edgeId === edgeId);
  const change = {
    edgeId,
    sourceMode,
    sourceSide: sourceMode === "side" ? sourceSide : "bottom",
    oldSourcePort,
    sourcePort,
    targetPort,
    bendRow,
    railCoord: baselineRoute.railCoord,
    oldRoutePoints: oldPoints,
    newRoutePoints: points,
    sourceDeparture,
    departureRule,
    outwardStubLength: sourceMode === "side" ? CLEARANCE : null,
    preservedRouteSuffix: oldPoints.slice(2).map((point) => [...point]),
    oldAttachmentLegality: {
      source: oldAttachment?.source?.legal ?? null,
      target: oldAttachment?.target?.legal ?? null,
      overall: oldAttachment?.legal ?? null,
    },
    newAttachmentLegality: {
      source: newAttachment?.source?.legal ?? null,
      target: newAttachment?.target?.legal ?? null,
      overall: newAttachment?.legal ?? null,
    },
  };

  return {
    ...combinedView,
    routed,
    ports,
    defects,
    attachments,
    renderBounds: boundsOver(combinedView.boxes, routes),
    viewLabel: `Ordinary HALT — ${edge.from} ${sourceMode === "side" ? "legal side" : "bottom"} source attachment`,
    experimentalRouteSplices: [...(combinedView.experimentalRouteSplices ?? []), change],
    experimentalSourcePortComparison: change,
    purity: {
      ...combinedView.purity,
      sourcePortComparisonEdgeId: edgeId,
      sourcePortComparisonMode: sourceMode,
      changedRouteIds: [edgeId],
      loopReturnRailChanged: false,
      bendRowChanged: false,
      targetPortChanged: false,
      targetEntryGeometryChanged: false,
      nodePositionsChanged: false,
      orientationSelectionRerun: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

export function buildI27I52SourcePortComparisonViews(combinedView) {
  return {
    i27: {
      side: buildSingleLoopSourcePortVariant(combinedView, "i-27-jump", "side"),
      bottom: buildSingleLoopSourcePortVariant(combinedView, "i-27-jump", "bottom"),
    },
    i52: {
      side: buildSingleLoopSourcePortVariant(combinedView, "i-52-jump", "side"),
      bottom: buildSingleLoopSourcePortVariant(combinedView, "i-52-jump", "bottom"),
    },
  };
}

// Fixture-wide probe that decouples backward-loop source attachment from loop-side selection.
// It classifies the already-realized source-local body without changing its rail, bend row,
// target attachment, or suffix. Existing lateral-first routes are retained exactly; only a
// vertical-first route moves from its side port to the source rectangle's bottom-center port.
export function buildGeneralizedLoopSourcePortView(currentBaseline) {
  const EPSILON = 1e-9;
  const same = (a, b) => Math.abs(a - b) <= EPSILON;
  const routesById = new Map();
  const ports = new Map(currentBaseline.routed.ports);
  const census = [];

  const loopRoutes = currentBaseline.routed.routes.filter((route) => route.edgeRole === "loop-return");
  for (const baselineRoute of loopRoutes) {
    const edge = currentBaseline.cfg.edgeById.get(baselineRoute.edgeId);
    const sourceNode = currentBaseline.cfg.nodeById.get(edge?.from);
    const targetNode = currentBaseline.cfg.nodeById.get(edge?.to);
    const sourceBox = currentBaseline.boxes.get(edge?.from);
    if (!edge || !sourceNode || !targetNode || !sourceBox || baselineRoute.points.length < 3) {
      fail(`cannot classify generalized loop source for ${baselineRoute.edgeId}`);
    }
    if (!Number.isInteger(sourceNode.instructionIndex) || !Number.isInteger(targetNode.instructionIndex)
      || sourceNode.instructionIndex <= targetNode.instructionIndex) {
      fail(`${baselineRoute.edgeId} is not a backward instruction-index loop`);
    }

    const oldSourcePort = [...baselineRoute.sourcePort];
    const targetPort = [...baselineRoute.targetPort];
    const oldPoints = baselineRoute.points.map((point) => [...point]);
    if (JSON.stringify(oldPoints[0]) !== JSON.stringify(oldSourcePort)) {
      fail(`${baselineRoute.edgeId} route does not begin at its recorded source port`);
    }
    const sourceSide = same(oldSourcePort[0], sourceBox.left) ? "left"
      : same(oldSourcePort[0], sourceBox.right) ? "right"
        : null;
    if (!sourceSide) fail(`${baselineRoute.edgeId} does not begin at a rectangle side port`);

    const [first, second, third] = oldPoints;
    const verticalFirst = same(first[0], second[0])
      && second[1] > first[1] + EPSILON
      && same(second[1], third[1])
      && !same(second[0], third[0]);
    const outwardDirection = sourceSide === "left" ? -1 : 1;
    const lateralFirst = same(first[1], second[1])
      && (second[0] - first[0]) * outwardDirection > EPSILON;
    if (!verticalFirst && !lateralFirst) {
      fail(`${baselineRoute.edgeId} is neither vertical-first nor legal outward lateral-first`);
    }

    const bodyClassification = verticalFirst ? "vertical-first" : "lateral-first";
    const bendRow = verticalFirst ? second[1] : first[1];
    const sourcePort = verticalFirst ? [sourceBox.cx, sourceBox.bottom] : oldSourcePort;
    const points = verticalFirst
      ? [sourcePort, [sourcePort[0], bendRow], ...oldPoints.slice(2).map((point) => [...point])]
      : oldPoints.map((point) => [...point]);
    const route = verticalFirst
      ? { ...baselineRoute, sourcePort, targetPort, points }
      : baselineRoute;
    routesById.set(baselineRoute.edgeId, route);

    if (verticalFirst) {
      ports.set(baselineRoute.edgeId, {
        ...ports.get(baselineRoute.edgeId),
        sourcePort,
        changed: true,
        experimentalGeneralizedBottomSourcePort: true,
      });
    }
    census.push({
      edgeId: baselineRoute.edgeId,
      source: edge.from,
      target: edge.to,
      sourceInstructionIndex: sourceNode.instructionIndex,
      targetInstructionIndex: targetNode.instructionIndex,
      existingSourceSide: sourceSide,
      existingSourcePort: oldSourcePort,
      bodyClassification,
      resultingSourceSide: verticalFirst ? "bottom" : sourceSide,
      resultingSourcePort: sourcePort,
      bendRow,
      railCoord: baselineRoute.railCoord,
      targetPort,
      oldRoutePoints: oldPoints,
      newRoutePoints: points,
      sourceAttachmentRule: verticalFirst
        ? "bottom-center port, then vertical downward to unchanged loop bend row"
        : `unchanged ${sourceSide} port and existing outward horizontal departure`,
      outwardDeparture: lateralFirst ? [first, second] : null,
      routeChanged: verticalFirst,
      preservedRouteSuffix: verticalFirst
        ? oldPoints.slice(2).map((point) => [...point])
        : oldPoints.slice(1).map((point) => [...point]),
    });
  }

  const routes = currentBaseline.routed.routes.map((route) => routesById.get(route.edgeId) ?? route);
  const routed = { ...currentBaseline.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: currentBaseline.boxes },
    { realForkSet: currentBaseline.roles.realForkSet, lcaRF: currentBaseline.tree.lcaRF },
    { clearance: CLEARANCE, program: currentBaseline.programName, orientationSource: "generalizedLoopSourcePortProbe" },
  );
  const attachments = attachmentRecords(currentBaseline.cfg, currentBaseline.roles, currentBaseline.boxes, routes);
  const attachmentCensus = census.map((row) => {
    const oldAttachment = currentBaseline.attachments.find((record) => record.edgeId === row.edgeId);
    const newAttachment = attachments.find((record) => record.edgeId === row.edgeId);
    return {
      ...row,
      oldAttachmentLegality: {
        source: oldAttachment?.source?.legal ?? null,
        target: oldAttachment?.target?.legal ?? null,
        overall: oldAttachment?.legal ?? null,
      },
      newAttachmentLegality: {
        source: newAttachment?.source?.legal ?? null,
        target: newAttachment?.target?.legal ?? null,
        overall: newAttachment?.legal ?? null,
      },
    };
  });

  return {
    ...currentBaseline,
    routed,
    ports,
    defects,
    attachments,
    renderBounds: boundsOver(currentBaseline.boxes, routes),
    viewLabel: "Ordinary HALT — generalized backward-loop source-port probe",
    experimentalRouteSplices: [...(currentBaseline.experimentalRouteSplices ?? []), ...attachmentCensus],
    experimentalLoopSourcePortCensus: attachmentCensus,
    purity: {
      ...currentBaseline.purity,
      loopSourceGeneralizationConsideredEdgeIds: attachmentCensus.map((row) => row.edgeId),
      loopSourceGeneralizationChangedEdgeIds: attachmentCensus.filter((row) => row.routeChanged).map((row) => row.edgeId),
      loopSourceGeneralizationVerticalFirstCount: attachmentCensus.filter((row) => row.bodyClassification === "vertical-first").length,
      loopSourceGeneralizationLateralFirstCount: attachmentCensus.filter((row) => row.bodyClassification === "lateral-first").length,
      loopReturnRailsChanged: false,
      loopBendRowsChanged: false,
      targetPortsChanged: false,
      targetEntryGeometryChanged: false,
      nodePositionsChanged: false,
      orientationSelectionRerun: false,
      nonLoopRoutesChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

// Composition candidate: realize the existing adaptive-merge stack (plus the divides-only
// i-57 right-to-right reentry), apply the generalized loop-source rule, and expose that whole
// geometry to the ordinary unpinned orientation pass. Nothing is repaired after selection.
export function buildComposedLoopSourceCandidate(rawView) {
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };
  const includesRightReentry = rawView.programName === "characteristic:divides";
  const realizeExistingStack = (orientationMap) => {
    const adaptive = buildAdaptiveBranchRayMergeSourcesView(realizeExperimental(base, orientationMap));
    return includesRightReentry ? applyRightToRightHvhMerge(adaptive) : adaptive;
  };
  const realizeComposed = (orientationMap) => buildGeneralizedLoopSourcePortView(realizeExistingStack(orientationMap));
  const orientationResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate: (orientationMap) => realizeComposed(orientationMap).defects,
    pins: new Map(),
  });

  const sameOrientationControl = realizeExistingStack(orientationResult.orientationMap);
  const view = buildGeneralizedLoopSourcePortView(sameOrientationControl);
  view.orientationResult = orientationResult;
  view.viewLabel = "Ordinary HALT — composed adaptive merges + generalized loop sources";
  view.purity = {
    ...view.purity,
    compositionOrder: [
      "raw transformed realization",
      "adaptive branch-merge routes",
      ...(includesRightReentry ? ["i-57 right-to-right H/V/H"] : []),
      "generalized backward-loop source attachment",
    ],
    includesDividesOnlyRightReentry: includesRightReentry,
    orientationSelectionUsesComposedGeometry: true,
    orientationSelectionPins: [],
    orientationSelectionRerun: true,
    directLoopSourceChangesAgainstSameOrientation: view.experimentalLoopSourcePortCensus
      .filter((row) => row.routeChanged)
      .map((row) => row.edgeId),
    automaticRepairAfterConstruction: false,
  };
  return { view, sameOrientationControl };
}

// Divides-only target-attachment probe over the checkpointed composed baseline. V4 already
// declares the upper-left diamond port and its north-west incident direction, but has no route
// builder that uses it. Preserve i-52's complete route through the loop rail's target-approach
// row, then add the smallest local H/V/diagonal dogleg needed to exercise that declared port.
// No selection, placement, rail, source, orientation, or unrelated route is recomputed.
export function buildI52UpperLeftTargetAttachmentView(composedView) {
  const edgeId = "i-52-jump";
  if (composedView.programName !== "characteristic:divides") {
    fail("i-52 upper-left target-attachment experiment is divides-only");
  }

  const edge = composedView.cfg.edgeById.get(edgeId);
  const baselineRoute = composedView.routed.routes.find((route) => route.edgeId === edgeId);
  const sourceBox = composedView.boxes.get(edge?.from);
  const targetNode = composedView.cfg.nodeById.get(edge?.to);
  const targetBox = composedView.boxes.get(edge?.to);
  if (!edge || edge.from !== "i-52" || edge.to !== "i-4" || !baselineRoute || !sourceBox || !targetNode || !targetBox
    || baselineRoute.edgeRole !== "loop-return" || baselineRoute.points.length !== 6) {
    fail("i-52 upper-left target-attachment baseline shape is unavailable");
  }

  const oldSourcePort = [...baselineRoute.sourcePort];
  const expectedBottomSource = [sourceBox.cx, sourceBox.bottom];
  const oldTargetPort = [...baselineRoute.targetPort];
  const oldPoints = baselineRoute.points.map((point) => [...point]);
  if (JSON.stringify(oldSourcePort) !== JSON.stringify(expectedBottomSource)
    || JSON.stringify(oldPoints[0]) !== JSON.stringify(oldSourcePort)
    || baselineRoute.railCoord !== -922) {
    fail("i-52 source attachment or loop rail differs from the composed checkpoint");
  }

  const upperLeftStub = getLegalIncidentStubsForNode(targetNode, { box: targetBox })
    .find((stub) => stub.portName === "upper-left");
  if (!upperLeftStub?.portPoint || upperLeftStub.incidentDirection !== "north-west") {
    fail("V4 upper-left diamond attachment stub is unavailable");
  }

  const targetPort = [...upperLeftStub.portPoint];
  const diagonalStubDx = CLEARANCE;
  const diamondTangent = (targetBox.cy - targetBox.top) / (targetBox.cx - targetBox.left);
  const diagonalStubDy = diagonalStubDx * diamondTangent;
  const diagonalPreEntry = [targetPort[0] - diagonalStubDx, targetPort[1] - diagonalStubDy];
  const preservedPrefix = oldPoints.slice(0, -2).map((point) => [...point]);
  const targetApproachRow = preservedPrefix[preservedPrefix.length - 1][1];
  const localShelfEnd = [diagonalPreEntry[0], targetApproachRow];
  const points = [...preservedPrefix, localShelfEnd, diagonalPreEntry, targetPort];
  const route = { ...baselineRoute, targetPort, points };
  const routes = composedView.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
  const ports = new Map(composedView.routed.ports);
  ports.set(edgeId, {
    ...ports.get(edgeId),
    targetPort,
    changed: true,
    experimentalUpperLeftTargetPort: true,
  });
  const routed = { ...composedView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: composedView.boxes },
    { realForkSet: composedView.roles.realForkSet, lcaRF: composedView.tree.lcaRF },
    { clearance: CLEARANCE, program: composedView.programName, orientationSource: "composedI52UpperLeftTargetAttachment" },
  );
  const attachments = attachmentRecords(composedView.cfg, composedView.roles, composedView.boxes, routes);
  const oldAttachment = composedView.attachments.find((record) => record.edgeId === edgeId);
  const newAttachment = attachments.find((record) => record.edgeId === edgeId);
  const change = {
    edgeId,
    source: edge.from,
    target: edge.to,
    railCoord: baselineRoute.railCoord,
    sourcePort: oldSourcePort,
    oldTargetPort,
    newTargetPort: targetPort,
    targetPortName: upperLeftStub.portName,
    requiredIncidentDirection: upperLeftStub.incidentDirection,
    oldRoutePoints: oldPoints,
    newRoutePoints: points,
    preservedRoutePrefix: preservedPrefix,
    targetApproachRow,
    localShelf: [preservedPrefix[preservedPrefix.length - 1], localShelfEnd],
    diagonalPreEntry,
    diagonalStub: [diagonalPreEntry, targetPort],
    diagonalStubDx,
    diagonalStubDy,
    diagonalStubRule: "one V4 clearance unit horizontally, scaled vertically by the target diamond side slope",
    oldAttachmentLegality: {
      source: oldAttachment?.source?.legal ?? null,
      target: oldAttachment?.target?.legal ?? null,
      overall: oldAttachment?.legal ?? null,
      targetPortName: oldAttachment?.target?.portName ?? null,
      targetIncidentDirection: oldAttachment?.target?.incidentDirection ?? null,
      targetReason: oldAttachment?.target?.reason ?? null,
    },
    newAttachmentLegality: {
      source: newAttachment?.source?.legal ?? null,
      target: newAttachment?.target?.legal ?? null,
      overall: newAttachment?.legal ?? null,
      targetPortName: newAttachment?.target?.portName ?? null,
      targetIncidentDirection: newAttachment?.target?.incidentDirection ?? null,
      targetReason: newAttachment?.target?.reason ?? null,
    },
  };

  return {
    ...composedView,
    routed,
    ports,
    defects,
    attachments,
    renderBounds: boundsOver(composedView.boxes, routes),
    viewLabel: "Ordinary HALT — composed baseline + i-52 upper-left target attachment",
    experimentalRouteSplices: [...(composedView.experimentalRouteSplices ?? []), change],
    experimentalTargetAttachment: change,
    purity: {
      ...composedView.purity,
      targetAttachmentExperimentEdgeId: edgeId,
      targetAttachmentPort: upperLeftStub.portName,
      changedRouteIds: [edgeId],
      sourcePortChanged: false,
      sourceGeometryChanged: false,
      loopReturnRailChanged: false,
      loopBendRowChanged: false,
      targetApproachPrefixChanged: false,
      i27RouteChanged: false,
      nodePositionsChanged: false,
      orientationSelectionRerun: false,
      nonExperimentRoutesChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

// Refinement of the upper-left target probe: retain the same declared V4 port and incident
// ray, but extend that ray backward to the checkpoint route's existing horizontal approach
// row. The geometric intersection replaces the fixed-length local dogleg. The loop rail,
// approach-row Y, source geometry, and every unrelated route remain exact controls.
export function buildI52UpperLeftTargetRayIntersectionView(composedView) {
  const edgeId = "i-52-jump";
  const doglegView = buildI52UpperLeftTargetAttachmentView(composedView);
  const baselineRoute = composedView.routed.routes.find((route) => route.edgeId === edgeId);
  const doglegRoute = doglegView.routed.routes.find((route) => route.edgeId === edgeId);
  const targetBox = composedView.boxes.get("i-4");
  if (!baselineRoute || !doglegRoute || !targetBox || baselineRoute.points.length !== 6) {
    fail("i-52 horizontal-to-diagonal target refinement baseline is unavailable");
  }

  const oldPoints = baselineRoute.points.map((point) => [...point]);
  const previousPoints = doglegRoute.points.map((point) => [...point]);
  const sourcePort = [...baselineRoute.sourcePort];
  const oldTargetPort = [...baselineRoute.targetPort];
  const targetPort = [...doglegRoute.targetPort];
  const preservedPrefix = oldPoints.slice(0, -2).map((point) => [...point]);
  const railApproach = preservedPrefix[preservedPrefix.length - 1];
  const targetApproachRow = railApproach[1];
  const diamondTangent = (targetBox.cy - targetBox.top) / (targetBox.cx - targetBox.left);
  const riseToTarget = targetPort[1] - targetApproachRow;
  if (!(diamondTangent > 0) || !(riseToTarget > 0)) {
    fail("i-52 upper-left incident ray does not meet the existing approach row above the target");
  }
  const runToTarget = riseToTarget / diamondTangent;
  const diagonalIntersection = [targetPort[0] - runToTarget, targetApproachRow];
  const points = [...preservedPrefix, diagonalIntersection, targetPort];
  const route = { ...baselineRoute, targetPort, points };
  const routes = composedView.routed.routes.map((candidate) => candidate.edgeId === edgeId ? route : candidate);
  const ports = new Map(composedView.routed.ports);
  ports.set(edgeId, {
    ...ports.get(edgeId),
    targetPort,
    changed: true,
    experimentalUpperLeftTargetPort: true,
    experimentalRayIntersectionTargetApproach: true,
  });
  const routed = { ...composedView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: composedView.boxes },
    { realForkSet: composedView.roles.realForkSet, lcaRF: composedView.tree.lcaRF },
    { clearance: CLEARANCE, program: composedView.programName, orientationSource: "composedI52UpperLeftTargetRayIntersection" },
  );
  const attachments = attachmentRecords(composedView.cfg, composedView.roles, composedView.boxes, routes);
  const oldAttachment = composedView.attachments.find((record) => record.edgeId === edgeId);
  const previousAttachment = doglegView.attachments.find((record) => record.edgeId === edgeId);
  const newAttachment = attachments.find((record) => record.edgeId === edgeId);
  const legality = (attachment) => ({
    source: attachment?.source?.legal ?? null,
    target: attachment?.target?.legal ?? null,
    overall: attachment?.legal ?? null,
    targetPortName: attachment?.target?.portName ?? null,
    targetIncidentDirection: attachment?.target?.incidentDirection ?? null,
    targetReason: attachment?.target?.reason ?? null,
  });
  const change = {
    edgeId,
    source: baselineRoute.source,
    target: baselineRoute.target,
    railCoord: baselineRoute.railCoord,
    sourcePort,
    oldTargetPort,
    targetPort,
    targetPortName: previousAttachment?.target?.portName ?? null,
    requiredIncidentDirection: previousAttachment?.target?.incidentDirection ?? null,
    oldRoutePoints: oldPoints,
    previousDoglegRoutePoints: previousPoints,
    newRoutePoints: points,
    preservedRoutePrefix: preservedPrefix,
    targetApproachRow,
    diamondTangent,
    diagonalIntersection,
    horizontalApproach: [railApproach, diagonalIntersection],
    directDiagonal: [diagonalIntersection, targetPort],
    diagonalRun: runToTarget,
    diagonalRise: riseToTarget,
    diagonalRule: "extend the upper-left port incident ray backward to the unchanged horizontal approach row",
    oldAttachmentLegality: legality(oldAttachment),
    previousDoglegAttachmentLegality: legality(previousAttachment),
    newAttachmentLegality: legality(newAttachment),
  };

  return {
    ...composedView,
    routed,
    ports,
    defects,
    attachments,
    renderBounds: boundsOver(composedView.boxes, routes),
    viewLabel: "Ordinary HALT — composed baseline + i-52 horizontal-to-diagonal target attachment",
    experimentalRouteSplices: [...(composedView.experimentalRouteSplices ?? []), change],
    experimentalTargetAttachment: change,
    purity: {
      ...composedView.purity,
      targetAttachmentExperimentEdgeId: edgeId,
      targetAttachmentPort: change.targetPortName,
      targetAttachmentSuffix: "horizontal then direct diagonal",
      changedRouteIds: [edgeId],
      fixedLengthDiagonalStubUsed: false,
      sourcePortChanged: false,
      sourceGeometryChanged: false,
      loopReturnRailChanged: false,
      loopBendRowChanged: false,
      targetApproachRowChanged: false,
      targetApproachPrefixChanged: false,
      i27RouteChanged: false,
      nodePositionsChanged: false,
      orientationSelectionRerun: false,
      nonExperimentRoutesChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

// Fixture-wide target-attachment generalization probe over an already composed baseline.
// Legal loop targets are immutable controls. For an illegal target, derive candidates only
// from the target's declared diagonal named-port rays and the route's existing final
// orthogonal approach segment. A change is allowed only when exactly one ray meets that
// directed segment and validates against V4's attachment grammar. No edge identity, defect
// score, clearance, obstacle, placement, rail, source, or orientation participates.
export function buildGeneralizedLoopTargetAttachmentView(composedView) {
  const EPSILON = 1e-9;
  const changedById = new Map();
  const ports = new Map(composedView.routed.ports);
  const census = [];

  for (const baselineRoute of composedView.routed.routes.filter((route) => route.edgeRole === "loop-return")) {
    const edge = composedView.cfg.edgeById.get(baselineRoute.edgeId);
    const sourceNode = composedView.cfg.nodeById.get(edge?.from);
    const targetNode = composedView.cfg.nodeById.get(edge?.to);
    const sourceBox = composedView.boxes.get(edge?.from);
    const targetBox = composedView.boxes.get(edge?.to);
    const oldAttachment = composedView.attachments.find((record) => record.edgeId === baselineRoute.edgeId);
    if (!edge || !sourceNode || !targetNode || !sourceBox || !targetBox || !oldAttachment
      || !Number.isInteger(sourceNode.instructionIndex) || !Number.isInteger(targetNode.instructionIndex)
      || sourceNode.instructionIndex <= targetNode.instructionIndex) {
      fail(`cannot classify generalized loop target for ${baselineRoute.edgeId}`);
    }

    const oldPoints = baselineRoute.points.map((point) => [...point]);
    const oldTargetPort = [...baselineRoute.targetPort];
    const oldRouteSuffix = oldPoints.slice(-3).map((point) => [...point]);
    let route = baselineRoute;
    let outcome = "unchanged-already-legal";
    let approachOrientation = null;
    let approachStart = null;
    let approachEnd = null;
    let inspectedPortRays = [];
    let compatibleCandidates = [];

    if (!oldAttachment.target.legal) {
      outcome = "unchanged-no-compatible-port";
      if (oldPoints.length >= 3) {
        approachStart = [...oldPoints[oldPoints.length - 3]];
        approachEnd = [...oldPoints[oldPoints.length - 2]];
        const approachDx = approachEnd[0] - approachStart[0];
        const approachDy = approachEnd[1] - approachStart[1];
        approachOrientation = Math.abs(approachDy) <= EPSILON && Math.abs(approachDx) > EPSILON ? "horizontal"
          : Math.abs(approachDx) <= EPSILON && Math.abs(approachDy) > EPSILON ? "vertical"
            : null;

        if (approachOrientation) {
          inspectedPortRays = getLegalIncidentStubsForNode(targetNode, { box: targetBox })
            .filter((stub) => stub.portPoint && stub.incidentDirection.includes("-"))
            .map((stub) => {
              const port = [...stub.portPoint];
              const rayVector = [port[0] - targetBox.cx, port[1] - targetBox.cy];
              let rayParameter = null;
              let intersection = null;
              if (approachOrientation === "horizontal" && Math.abs(rayVector[1]) > EPSILON) {
                rayParameter = (approachStart[1] - port[1]) / rayVector[1];
                intersection = [port[0] + rayParameter * rayVector[0], approachStart[1]];
              } else if (approachOrientation === "vertical" && Math.abs(rayVector[0]) > EPSILON) {
                rayParameter = (approachStart[0] - port[0]) / rayVector[0];
                intersection = [approachStart[0], port[1] + rayParameter * rayVector[1]];
              }

              let approachParameter = null;
              if (intersection) {
                approachParameter = approachOrientation === "horizontal"
                  ? (intersection[0] - approachStart[0]) / approachDx
                  : (intersection[1] - approachStart[1]) / approachDy;
              }
              const rayPointsOutward = rayParameter != null && rayParameter > EPSILON;
              const intersectionOnDirectedSegment = approachParameter != null
                && approachParameter > EPSILON && approachParameter <= 1 + EPSILON;
              const proposedPoints = rayPointsOutward && intersectionOnDirectedSegment
                ? [...oldPoints.slice(0, -2).map((point) => [...point]), intersection, port]
                : null;
              const validation = proposedPoints
                ? validateEdgeAttachments(
                  { ...baselineRoute, targetPort: port, points: proposedPoints },
                  sourceNode,
                  targetNode,
                  proposedPoints,
                  { sourceBox, targetBox },
                )
                : null;
              const compatible = !!proposedPoints && validation?.target?.legal === true
                && validation.target.portName === stub.portName
                && validation.target.incidentDirection === stub.incidentDirection;
              return {
                portName: stub.portName,
                port,
                incidentDirection: stub.incidentDirection,
                rayVector,
                rayParameter,
                intersection,
                approachParameter,
                rayPointsOutward,
                intersectionOnDirectedSegment,
                resultingTargetLegal: validation?.target?.legal ?? null,
                resultingTargetIncidentDirection: validation?.target?.incidentDirection ?? null,
                compatible,
                proposedPoints,
              };
            });
          compatibleCandidates = inspectedPortRays.filter((candidate) => candidate.compatible);
        }
      }

      if (compatibleCandidates.length === 1) {
        const selected = compatibleCandidates[0];
        route = {
          ...baselineRoute,
          targetPort: [...selected.port],
          points: selected.proposedPoints.map((point) => [...point]),
        };
        changedById.set(baselineRoute.edgeId, route);
        ports.set(baselineRoute.edgeId, {
          ...ports.get(baselineRoute.edgeId),
          targetPort: [...selected.port],
          changed: true,
          experimentalGeneralizedTargetPort: true,
          experimentalTargetRayIntersection: [...selected.intersection],
        });
        outcome = "generalized-unique-compatible-port";
      } else if (compatibleCandidates.length > 1) {
        outcome = "unchanged-ambiguous-compatible-ports";
      }
    }

    census.push({
      edgeId: baselineRoute.edgeId,
      source: edge.from,
      target: edge.to,
      sourceInstructionIndex: sourceNode.instructionIndex,
      targetInstructionIndex: targetNode.instructionIndex,
      currentTargetPort: oldTargetPort,
      currentTargetPortName: oldAttachment.target.portName,
      currentTargetLegal: oldAttachment.target.legal,
      outcome,
      routeChanged: route !== baselineRoute,
      candidateCount: compatibleCandidates.length,
      candidateNamedPort: compatibleCandidates.length === 1 ? compatibleCandidates[0].portName : null,
      candidateIncidentDirection: compatibleCandidates.length === 1 ? compatibleCandidates[0].incidentDirection : null,
      intersection: compatibleCandidates.length === 1 ? compatibleCandidates[0].intersection : null,
      approachOrientation,
      approachStart,
      approachEnd,
      inspectedPortRays,
      oldRouteSuffix,
      newRouteSuffix: route.points.slice(-3).map((point) => [...point]),
      oldRoutePoints: oldPoints,
      newRoutePoints: route.points.map((point) => [...point]),
      railCoord: baselineRoute.railCoord,
      sourcePort: [...baselineRoute.sourcePort],
    });
  }

  const routes = composedView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
  const routed = { ...composedView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: composedView.boxes },
    { realForkSet: composedView.roles.realForkSet, lcaRF: composedView.tree.lcaRF },
    { clearance: CLEARANCE, program: composedView.programName, orientationSource: "generalizedLoopTargetAttachmentProbe" },
  );
  const attachments = attachmentRecords(composedView.cfg, composedView.roles, composedView.boxes, routes);
  const completedCensus = census.map((row) => {
    const newAttachment = attachments.find((record) => record.edgeId === row.edgeId);
    return {
      ...row,
      resultingTargetPort: newAttachment?.target?.portPoint ?? null,
      resultingTargetPortName: newAttachment?.target?.portName ?? null,
      resultingTargetIncidentDirection: newAttachment?.target?.incidentDirection ?? null,
      resultingTargetLegal: newAttachment?.target?.legal ?? null,
      resultingOverallAttachmentLegal: newAttachment?.legal ?? null,
    };
  });
  const changedEdgeIds = completedCensus.filter((row) => row.routeChanged).map((row) => row.edgeId);
  const ambiguousEdgeIds = completedCensus
    .filter((row) => row.outcome === "unchanged-ambiguous-compatible-ports")
    .map((row) => row.edgeId);
  const noCandidateEdgeIds = completedCensus
    .filter((row) => row.outcome === "unchanged-no-compatible-port")
    .map((row) => row.edgeId);
  const unexpectedlyChangedLegalEdgeIds = completedCensus
    .filter((row) => row.currentTargetLegal && row.routeChanged)
    .map((row) => row.edgeId);

  return {
    ...composedView,
    routed,
    ports,
    defects,
    attachments,
    renderBounds: boundsOver(composedView.boxes, routes),
    viewLabel: "Ordinary HALT — generalized backward-loop target attachments",
    experimentalRouteSplices: [...(composedView.experimentalRouteSplices ?? []), ...completedCensus],
    experimentalLoopTargetAttachmentCensus: completedCensus,
    purity: {
      ...composedView.purity,
      loopTargetGeneralizationConsideredEdgeIds: completedCensus.map((row) => row.edgeId),
      loopTargetGeneralizationChangedEdgeIds: changedEdgeIds,
      loopTargetGeneralizationAmbiguousEdgeIds: ambiguousEdgeIds,
      loopTargetGeneralizationNoCandidateEdgeIds: noCandidateEdgeIds,
      unexpectedlyChangedLegalEdgeIds,
      fixedLengthTargetStubUsed: false,
      crossingOrDefectScoreUsedForSelection: false,
      obstacleOrClearanceSearchUsedForSelection: false,
      sourcePortsChanged: false,
      sourceGeometryChanged: false,
      loopReturnRailsChanged: false,
      loopBendRowsChanged: false,
      nodePositionsChanged: false,
      orientationSelectionRerun: false,
      nonLoopRoutesChanged: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

// Full endpoint-composition candidate: realize the adaptive/reentry stack, generalized loop
// sources, and generalized loop targets inside every normal orientation candidate. Selection
// starts unpinned and no geometry is repaired afterward. The returned same-orientation
// controls expose the exact pre-source and source-only states used by the winning map.
export function buildComposedLoopEndpointCandidate(rawView) {
  const base = {
    cfg: rawView.cfg,
    roles: rawView.roles,
    ownership: rawView.ownership,
    tree: rawView.tree,
    guardOrientationOf: roleGuardOrientation(rawView.cfg, rawView.roles),
    program: rawView.program,
    programName: rawView.programName,
    terminalId: rawView.terminalId,
  };
  const includesRightReentry = rawView.programName === "characteristic:divides";
  const realizeExistingStack = (orientationMap) => {
    const adaptive = buildAdaptiveBranchRayMergeSourcesView(realizeExperimental(base, orientationMap));
    return includesRightReentry ? applyRightToRightHvhMerge(adaptive) : adaptive;
  };
  const realizeSources = (orientationMap) => buildGeneralizedLoopSourcePortView(realizeExistingStack(orientationMap));
  const realizeEndpoints = (orientationMap) => buildGeneralizedLoopTargetAttachmentView(realizeSources(orientationMap));
  const orientationResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate: (orientationMap) => realizeEndpoints(orientationMap).defects,
    pins: new Map(),
  });

  const sameOrientationPreSourceControl = realizeExistingStack(orientationResult.orientationMap);
  const sameOrientationSourceControl = buildGeneralizedLoopSourcePortView(sameOrientationPreSourceControl);
  const view = buildGeneralizedLoopTargetAttachmentView(sameOrientationSourceControl);
  view.orientationResult = orientationResult;
  view.viewLabel = "Ordinary HALT — composed generalized loop endpoints";
  view.purity = {
    ...view.purity,
    compositionOrder: [
      "raw transformed realization",
      "adaptive branch-merge routes",
      ...(includesRightReentry ? ["i-57 right-to-right H/V/H"] : []),
      "generalized backward-loop source attachment",
      "generalized backward-loop target attachment",
    ],
    includesDividesOnlyRightReentry: includesRightReentry,
    orientationSelectionUsesComposedGeometry: true,
    orientationSelectionUsesComposedEndpointGeometry: true,
    orientationSelectionPins: [],
    orientationSelectionRerun: true,
    directLoopSourceChangesAgainstSameOrientation: sameOrientationSourceControl.experimentalLoopSourcePortCensus
      .filter((row) => row.routeChanged)
      .map((row) => row.edgeId),
    directLoopTargetChangesAgainstSameOrientation: view.experimentalLoopTargetAttachmentCensus
      .filter((row) => row.routeChanged)
      .map((row) => row.edgeId),
    automaticRepairAfterConstruction: false,
  };
  return { view, sameOrientationPreSourceControl, sameOrientationSourceControl, realizeEndpoints };
}

// Bounded-sub-only single-variable orientation experiment over the promoted endpoint-
// composition baseline. The control is the untouched normal, unpinned orientation result.
// The comparison realization changes exactly one completed orientation bit, i-22, and then
// reruns the identical composed geometry stack. Production cost and all routing/placement
// rules remain unchanged.
export function buildBoundedSubI22FlipComparisonViews(rawView) {
  const forkId = "i-22";
  if (rawView.programName !== "minimization:bounded_sub" || !rawView.roles.realForkSet.has(forkId)) {
    fail("i-22 flip comparison is defined only for minimization:bounded_sub");
  }

  const composed = buildComposedLoopEndpointCandidate(rawView);
  const baseline = composed.view;
  const normalBit = baseline.orientationMap.get(forkId) ?? DEFAULT;
  if (bitName(normalBit) !== "default") fail("normal i-22 orientation is no longer default");

  const forcedMap = new Map([...baseline.orientationMap].map(([id, value]) => [id, { ...value }]));
  forcedMap.set(forkId, { ...FLIPPED });
  const forced = composed.realizeEndpoints(forcedMap);
  forced.orientationResult = baseline.orientationResult;
  forced.viewLabel = "B. Checkpoint baseline + i-22 forced flipped";
  forced.forcedForkId = forkId;
  forced.purity = {
    ...baseline.purity,
    diagnosticForcedOrientationOnly: forkId,
    forcedOrientation: "flipped",
    orientationScoringChanged: false,
    orientationSelectionPins: [],
    forcedCandidatePassedBackToOrientationSelection: false,
    automaticRepairAfterConstruction: false,
  };

  const changedForks = baseline.roles.realForkIds.filter(
    (id) => bitName(forcedMap.get(id)) !== bitName(baseline.orientationMap.get(id)),
  );
  if (changedForks.length !== 1 || changedForks[0] !== forkId) {
    fail(`forced i-22 view changed orientation bits {${changedForks.join(",")}}`);
  }

  const row = baseline.orientationResult.rows.find((candidate) => candidate.realForkId === forkId);
  if (!row) fail("normal orientation result has no i-22 evaluation row");
  const candidateMap = (candidateBit) => {
    const map = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
    for (const currentId of rawView.tree.bottomUp) {
      map.set(currentId, { ...DEFAULT });
      if (currentId === forkId) {
        map.set(currentId, candidateBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
        return map;
      }
      const currentRow = baseline.orientationResult.rows.find((candidate) => candidate.realForkId === currentId);
      if (!currentRow) fail(`normal orientation result has no ${currentId} evaluation row`);
      map.set(currentId, currentRow.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
    }
    fail("i-22 is absent from the normal bottom-up evaluation order");
  };

  const defaultCandidate = composed.realizeEndpoints(candidateMap("default"));
  const flippedCandidate = composed.realizeEndpoints(candidateMap("flipped"));
  if (defaultCandidate.defects.total !== row.costDefault || flippedCandidate.defects.total !== row.costFlipped) {
    fail(`replayed i-22 costs ${defaultCandidate.defects.total}/${flippedCandidate.defects.total} do not match orientation row ${row.costDefault}/${row.costFlipped}`);
  }

  baseline.viewLabel = "A. Current checkpoint baseline — i-22 normal default";
  baseline.viewerProvenance = "Control: exact 9f166f2 composed endpoint baseline with normal, unpinned orientation selection.";
  forced.viewerProvenance = "Single variable: the completed baseline orientation map is copied and only i-22 is forced to flipped; the identical composed geometry stack is rerun.";

  const orientationEvaluation = {
    forkId,
    bottomUpEvaluationOrder: [...rawView.tree.bottomUp],
    row: { ...row },
    costDefinition: "node-node overlaps + proper edge-edge crossings",
    unrelatedNodeEdgeIntrusionsScored: false,
    defaultCandidate: orientationCandidateSnapshot(defaultCandidate),
    flippedCandidate: orientationCandidateSnapshot(flippedCandidate),
  };
  const geometryDelta = compareViewGeometry(baseline, forced, forkId);
  const defectDelta = compareViewDefects(baseline, forced);
  const focusFor = (view) => ({
    forkId,
    forkOrientation: bitName(view.orientationMap.get(forkId)),
    i24JumpRoute: exactRouteSnapshot(view, "i-24-jump"),
    i26Box: exactBoxSnapshot(view, "i-26"),
  });

  baseline.i22FlipExperiment = {
    role: "control",
    focusGeometry: focusFor(baseline),
    orientationEvaluation,
    geometryDelta,
    defectDelta,
  };
  forced.i22FlipExperiment = {
    role: "forced-flipped",
    focusGeometry: focusFor(forced),
    orientationEvaluation,
    geometryDelta,
    defectDelta,
  };

  return { baseline, forced, orientationEvaluation, geometryDelta, defectDelta };
}

// Five-fixture orientation-cost generalization probe. Geometry is realized by the exact
// promoted composed stack. The sole experiment is the scalar returned to the unchanged
// production orientation algorithm: production defects.total plus the separately measured
// unrelated node-edge intrusion count, each with unit weight. Edge overlaps and attachment
// legality remain diagnostics only; pins remain empty; rare repair remains diagnostic only.
export function buildIntrusionAwareOrientationComparisonViews(rawView) {
  const composed = buildComposedLoopEndpointCandidate(rawView);
  const baseline = composed.view;
  const experimentalEvaluate = (orientationMap) => {
    const candidate = composed.realizeEndpoints(orientationMap);
    const intrusionCount = unrelatedNodeEdgeIntersections(candidate.routed.routes, candidate.boxes).length;
    return { ...candidate.defects, total: candidate.defects.total + intrusionCount };
  };
  const experimentalResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate: experimentalEvaluate,
    pins: new Map(),
  });
  const experimental = composed.realizeEndpoints(experimentalResult.orientationMap);
  experimental.orientationResult = experimentalResult;

  const baselineRows = orientationEvaluationTrace(rawView, composed.realizeEndpoints, baseline.orientationResult, "production");
  const experimentalRows = orientationEvaluationTrace(rawView, composed.realizeEndpoints, experimentalResult, "intrusion-aware");
  const baselineByFork = new Map(baselineRows.map((row) => [row.realForkId, row]));
  const experimentalByFork = new Map(experimentalRows.map((row) => [row.realForkId, row]));
  const forkComparisons = rawView.roles.realForkIds.map((realForkId) => {
    const current = baselineByFork.get(realForkId);
    const candidate = experimentalByFork.get(realForkId);
    if (!current || !candidate) fail(`missing orientation trace for ${realForkId}`);
    const baselineMargin = current.flipped.oldProductionCost - current.default.oldProductionCost;
    const experimentalMargin = candidate.flipped.experimentalCost - candidate.default.experimentalCost;
    const baselineTie = baselineMargin === 0;
    const experimentalTie = experimentalMargin === 0;
    return {
      realForkId,
      baselineDecision: current.finalDecision,
      experimentalDecision: candidate.finalDecision,
      decisionChanged: current.finalDecision !== candidate.finalDecision,
      baselineMarginFlippedMinusDefault: baselineMargin,
      experimentalMarginFlippedMinusDefault: experimentalMargin,
      marginChanged: baselineMargin !== experimentalMargin,
      tieChanged: baselineTie !== experimentalTie,
      baselineEvaluation: current,
      experimentalEvaluation: candidate,
    };
  });
  const changedForks = forkComparisons.filter((row) => row.decisionChanged);
  const materialUnchangedForks = forkComparisons.filter((row) => !row.decisionChanged && (row.marginChanged || row.tieChanged));
  const finalIntrusions = unrelatedNodeEdgeIntersections(experimental.routed.routes, experimental.boxes);
  const experimentalFinalCost = experimental.defects.total + finalIntrusions.length;
  if (experimentalFinalCost !== experimentalResult.finalTotal) {
    fail(`experimental final cost ${experimentalFinalCost} does not match orientation result ${experimentalResult.finalTotal}`);
  }

  baseline.viewLabel = "Current checkpointed orientation cost";
  baseline.viewerProvenance = "Control: exact promoted composed-endpoint geometry with production cost = node overlaps + proper crossings.";
  experimental.viewLabel = "+ unrelated node-edge intrusions";
  experimental.viewerProvenance = "Generalization probe: normal unpinned bottom-up selection from scratch; candidate cost adds unrelated node-edge intrusions at unit weight. No repair is applied.";
  experimental.purity = {
    ...baseline.purity,
    experimentalVariableOnly: "unrelated node-edge intrusion count participates in orientation candidate total",
    costFormula: "nodeOverlapCount + crossingCount + unrelatedNodeEdgeIntrusionCount",
    unitWeights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    edgeOverlapScored: false,
    attachmentLegalityScored: false,
    orientationSelectionPins: [],
    orientationSelectionRerun: true,
    rareRepairBehaviorChanged: false,
    rareRepairApplied: false,
    automaticRepairAfterConstruction: false,
  };

  const comparison = {
    costFormulas: {
      baseline: "nodeOverlapCount + crossingCount",
      experimental: "nodeOverlapCount + crossingCount + unrelatedNodeEdgeIntrusionCount",
    },
    weights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    edgeOverlapScored: false,
    attachmentLegalityScored: false,
    pins: [],
    bottomUpEvaluationOrder: [...rawView.tree.bottomUp],
    baselineOrientation: mapToObject(baseline.orientationMap),
    experimentalOrientation: mapToObject(experimental.orientationMap),
    changedForks,
    materialUnchangedForkDefinition: "unchanged final bit with any nonzero change in flipped-minus-default candidate margin or tie status",
    materialUnchangedForks,
    everyFork: forkComparisons,
    baselineFinalProductionCost: baseline.defects.total,
    baselineFinalIntrusionAwareCost: baseline.defects.total
      + unrelatedNodeEdgeIntersections(baseline.routed.routes, baseline.boxes).length,
    experimentalFinalProductionCost: experimental.defects.total,
    experimentalFinalIntrusionAwareCost: experimentalFinalCost,
    baselineRareRepairCandidates: baseline.orientationResult.rareRepairCandidates,
    experimentalRareRepairCandidates: experimentalResult.rareRepairCandidates,
    rareRepairApplied: false,
  };
  baseline.orientationCostExperiment = { role: "baseline", comparison };
  experimental.orientationCostExperiment = { role: "experimental", comparison };
  return { baseline, experimental, comparison };
}

// Focused diagnosis of the two decisions exposed by the intrusion-aware cost probe.
// Each candidate starts at its exact bottom-up evaluation state: earlier decisions are
// copied from the normal intrusion-aware pass, the focus fork is held to the candidate bit,
// and only the still-unresolved suffix is selected normally. This is observation only: no
// production scoring, filtering, lookahead, pin API, or rare-repair behavior is changed.
export function buildOrientationTransientDefectDiagnosisViews(rawView) {
  const targetByFixture = {
    "minimization:bounded_sub": "i-22",
    "characteristic:divides": "i-25",
  };
  const forkId = targetByFixture[rawView.programName];
  if (!forkId) fail(`transient orientation diagnosis is not defined for ${rawView.programName}`);

  const composed = buildComposedLoopEndpointCandidate(rawView);
  const evaluate = (orientationMap) => {
    const candidate = composed.realizeEndpoints(orientationMap);
    const components = orientationCandidateComponents(candidate);
    return { ...candidate.defects, total: components.experimentalCost };
  };
  const normalResult = assignOrientation({
    realForks: rawView.roles.realForkIds,
    bottomUp: rawView.tree.bottomUp,
    rfParent: rawView.tree.rfParent,
    rfChildren: rawView.tree.rfChildren,
    evaluate,
    pins: new Map(),
  });
  const defaultCompletion = completeOrientationCandidate(
    rawView,
    composed.realizeEndpoints,
    normalResult,
    forkId,
    "default",
  );
  const flippedCompletion = completeOrientationCandidate(
    rawView,
    composed.realizeEndpoints,
    normalResult,
    forkId,
    "flipped",
  );
  const defaultReport = completedCandidateReport(rawView, composed.realizeEndpoints, defaultCompletion);
  const flippedReport = completedCandidateReport(rawView, composed.realizeEndpoints, flippedCompletion);
  const laterChoiceDifferences = defaultCompletion.laterRows
    .map((row) => {
      const flippedRow = flippedCompletion.laterRows.find((candidate) => candidate.realForkId === row.realForkId);
      return flippedRow && flippedRow.finalDecision !== row.finalDecision
        ? { realForkId: row.realForkId, afterDefaultCandidate: row.finalDecision, afterFlippedCandidate: flippedRow.finalDecision }
        : null;
    })
    .filter(Boolean);
  const report = {
    fixture: rawView.programName,
    focusFork: forkId,
    costFormulaHeldConstant: "nodeOverlapCount + properCrossingCount + unrelatedNodeEdgeIntrusionCount",
    bottomUpEvaluationOrder: [...rawView.tree.bottomUp],
    alreadyProcessedBeforeFocus: defaultCompletion.processedBefore,
    unresolvedAfterFocus: defaultCompletion.unresolvedAfter,
    defaultCandidate: defaultReport,
    flippedCandidate: flippedReport,
    laterChoiceDifferences,
    laterForkChoicesDependOnCandidate: laterChoiceDifferences.length > 0,
    intervention: {
      productionFilesChanged: false,
      metricChanged: false,
      weightsChanged: false,
      lookaheadImplemented: false,
      repairApplied: false,
      defectsFiltered: false,
    },
  };

  const decorate = (view, label, provenance, role, caseReport) => {
    view.viewLabel = label;
    view.viewerProvenance = provenance;
    view.orientationTransientDiagnosis = {
      role,
      fixture: rawView.programName,
      focusFork: forkId,
      alreadyProcessedBeforeFocus: report.alreadyProcessedBeforeFocus,
      unresolvedAfterFocus: report.unresolvedAfterFocus,
      laterChoiceDifferences,
      candidate: caseReport,
    };
    view.purity = {
      ...view.purity,
      orientationMetricChanged: false,
      candidateCompletionDiagnosticOnly: true,
      laterForksPinned: [],
      rareRepairApplied: false,
      productionFilesChanged: false,
    };
    return view;
  };
  const views = {
    provisionalDefault: decorate(
      defaultCompletion.provisionalView,
      `Provisional ${forkId} default`,
      "Exact evaluation snapshot: earlier bottom-up choices fixed; focus candidate default; every later fork still default/unresolved.",
      "provisional-default",
      defaultReport,
    ),
    completedDefault: decorate(
      defaultCompletion.finalView,
      `Completed ${forkId} default`,
      "The focus candidate remains fixed while every later fork is processed normally with the unchanged intrusion-aware experimental score.",
      "completed-default",
      defaultReport,
    ),
    provisionalFlipped: decorate(
      flippedCompletion.provisionalView,
      `Provisional ${forkId} flipped`,
      "Exact evaluation snapshot: earlier bottom-up choices fixed; focus candidate flipped; every later fork still default/unresolved.",
      "provisional-flipped",
      flippedReport,
    ),
    completedFlipped: decorate(
      flippedCompletion.finalView,
      `Completed ${forkId} flipped`,
      "The focus candidate remains fixed while every later fork is processed normally with the unchanged intrusion-aware experimental score.",
      "completed-flipped",
      flippedReport,
    ),
  };
  return { ...views, report };
}

// Generalized one-step rollout probe. The outer selector remains bottom-up, but each D/F
// candidate is scored only after a temporary completion of the unresolved suffix using the
// unchanged production policy (node overlaps + proper crossings, strict improvement, default
// on ties). The completed-candidate rule is never called recursively inside that rollout.
export function buildCompletedCandidateOrientationComparisonViews(rawView) {
  const provisionalComparison = buildIntrusionAwareOrientationComparisonViews(rawView);
  const composed = buildComposedLoopEndpointCandidate(rawView);
  const completedResult = assignCompletedCandidateOrientation({
    rawView,
    realize: composed.realizeEndpoints,
  });
  const completed = composed.realizeEndpoints(completedResult.orientationMap);
  completed.orientationResult = completedResult;

  const baseline = provisionalComparison.baseline;
  const provisional = provisionalComparison.experimental;
  baseline.viewLabel = "Checkpoint production orientation";
  baseline.viewerProvenance = "Control: checkpointed composed geometry with provisional production scoring (node overlaps + proper crossings).";
  provisional.viewLabel = "Provisional intrusion-aware selector";
  provisional.viewerProvenance = "Previous failed generalization: intrusion-aware cost measured before later real-fork orientations are resolved; no repair applied.";
  completed.viewLabel = "Completed-candidate selector";
  completed.viewerProvenance = "One-step rollout: each focus D/F is temporarily completed with the production orientation policy, then its final geometry receives the unchanged three-component experimental score.";

  const provisionalByFork = new Map(provisionalComparison.comparison.everyFork.map((row) => [row.realForkId, row]));
  const everyFork = completedResult.rows.map((row) => {
    const provisionalRow = provisionalByFork.get(row.realForkId);
    if (!provisionalRow) fail(`provisional comparison has no row for ${row.realForkId}`);
    const checkpointDecision = bitName(baseline.orientationMap.get(row.realForkId));
    const provisionalDecision = bitName(provisional.orientationMap.get(row.realForkId));
    const completedDecision = row.finalDecision;
    const provisionalMargin = provisionalRow.experimentalEvaluation.flipped.experimentalCost
      - provisionalRow.experimentalEvaluation.default.experimentalCost;
    const completedMargin = row.completedFlipped.experimentalCost - row.completedDefault.experimentalCost;
    return {
      ...row,
      checkpointDecision,
      provisionalSelectorDecision: provisionalDecision,
      completedCandidateDecision: completedDecision,
      decisionChangedFromCheckpoint: checkpointDecision !== completedDecision,
      decisionChangedFromProvisionalSelector: provisionalDecision !== completedDecision,
      provisionalSelectorMarginFlippedMinusDefault: provisionalMargin,
      completedCandidateMarginFlippedMinusDefault: completedMargin,
      marginChangedFromProvisionalSelector: provisionalMargin !== completedMargin,
    };
  });
  const changedForks = everyFork.filter((row) => row.decisionChangedFromCheckpoint);
  const materiallyChangedUnchangedForks = everyFork.filter(
    (row) => !row.decisionChangedFromCheckpoint && row.marginChangedFromProvisionalSelector,
  );
  const finalIntrusions = unrelatedNodeEdgeIntersections(completed.routed.routes, completed.boxes);
  const comparison = {
    checkpoint: "9f166f24721e7125ec9c0105e8960c6273d8d932",
    outerPolicy: "completed candidate D/F; strict improvement; tie -> default",
    temporaryCompletionPolicy: "production node overlaps + proper crossings; strict improvement; tie -> default",
    temporaryCompletionRecursesCompletedCandidateRule: false,
    measuredCompletedCost: "node overlaps + proper crossings + unrelated node-edge intrusions",
    segmentLevelIntrusionsPreserved: true,
    edgeOverlapsScored: false,
    pins: [],
    bottomUpEvaluationOrder: [...rawView.tree.bottomUp],
    checkpointOrientation: namedOrientationMap(baseline.orientationMap),
    provisionalOrientation: namedOrientationMap(provisional.orientationMap),
    completedCandidateOrientation: namedOrientationMap(completed.orientationMap),
    changedForks,
    materiallyChangedUnchangedForkDefinition: "checkpoint decision unchanged, but completed F-D margin differs from the previous provisional intrusion-aware selector margin",
    materiallyChangedUnchangedForks,
    everyFork,
    rolloutSuffixDivergences: everyFork.filter((row) => row.rolloutSuffixDivergence.anyCandidateDiffers),
    misleadingCompletedScoreCounterexamples: everyFork.filter((row) => row.eventualSuffixAudit.misleadingDecision),
    finalDiagnostics: {
      checkpoint: completedDiagnostics(baseline),
      provisional: completedDiagnostics(provisional),
      completedCandidate: completedDiagnostics(completed),
    },
    finalCompletedCandidateCost: completed.defects.total + finalIntrusions.length,
    repairApplied: false,
  };
  for (const [view, role] of [[baseline, "checkpoint"], [provisional, "provisional"], [completed, "completed-candidate"]]) {
    view.completedCandidateOrientationExperiment = { role, comparison };
    view.purity = {
      ...view.purity,
      productionFilesChanged: false,
      geometryRulesChanged: false,
      completedCandidateScoringHarnessOnly: role === "completed-candidate",
      temporaryCompletionUsesProductionPolicy: role === "completed-candidate",
      recursiveCompletedCandidateRollout: false,
      edgeOverlapScored: false,
      segmentLevelIntrusionDiagnosticChanged: false,
      rareRepairApplied: false,
    };
  }
  return { baseline, provisional, completed, comparison };
}

// Self-consistent recursive completion probe. Each branch recursively resolves its suffix
// with this same completed-final-N/C/I rule. Both branches are explored exactly; no old
// production completion, pruning, heuristic, repair, or production mutation participates.
// A separate full-mask loop audits the result after selection without feeding the oracle back.
export function buildSelfConsistentCompletedCandidateComparisonViews(rawView) {
  const historical = buildCompletedCandidateOrientationComparisonViews(rawView);
  const composed = buildComposedLoopEndpointCandidate(rawView);
  const recursiveResult = assignSelfConsistentCompletedCandidateOrientation({
    rawView,
    realize: composed.realizeEndpoints,
  });
  const recursive = composed.realizeEndpoints(recursiveResult.orientationMap);
  recursive.orientationResult = recursiveResult;

  const baseline = historical.baseline;
  const provisional = historical.provisional;
  const oneStep = historical.completed;
  baseline.viewLabel = "A. Checkpoint production orientation";
  provisional.viewLabel = "B. Provisional intrusion-aware selector";
  oneStep.viewLabel = "C. One-step completed-candidate selector";
  recursive.viewLabel = "D. Self-consistent recursive completion";
  recursive.viewerProvenance = "Every focus D/F recursively completes its unresolved suffix with the same final N/C/I rule. Exact enumeration is diagnostic-only; no pruning or repair.";

  const oneStepByFork = new Map(historical.comparison.everyFork.map((row) => [row.realForkId, row]));
  const recursiveRows = recursiveResult.rows.map((row) => {
    const prior = oneStepByFork.get(row.realForkId);
    if (!prior) fail(`one-step result has no row for recursive audit ${row.realForkId}`);
    return {
      ...row,
      checkpointDecision: bitName(baseline.orientationMap.get(row.realForkId)),
      provisionalDecision: bitName(provisional.orientationMap.get(row.realForkId)),
      oneStepDecision: bitName(oneStep.orientationMap.get(row.realForkId)),
      recursiveDecision: row.finalDecision,
      changedFromCheckpoint: bitName(baseline.orientationMap.get(row.realForkId)) !== row.finalDecision,
      changedFromOneStep: bitName(oneStep.orientationMap.get(row.realForkId)) !== row.finalDecision,
      oneStepCompletedCosts: {
        default: prior.completedDefault.experimentalCost,
        flipped: prior.completedFlipped.experimentalCost,
      },
      recursiveCompletedCosts: {
        default: row.completedDefault.experimentalCost,
        flipped: row.completedFlipped.experimentalCost,
      },
    };
  });
  const selectedCompletionMismatches = recursiveRows.filter(
    (row) => row.selectedCompletionConsistency.differencesFromFinalMap.length > 0,
  );
  const comparison = {
    checkpoint: "9f166f24721e7125ec9c0105e8960c6273d8d932",
    cost: "final node overlaps + proper crossings + segment-level unrelated node-edge intrusions",
    weights: { nodeOverlap: 1, properCrossing: 1, unrelatedNodeEdgeIntrusion: 1 },
    strictImprovement: true,
    tieBreak: "default",
    recursiveCompletionPolicy: "same self-consistent completed-final-N/C/I rule",
    oldProductionCompletionUsed: false,
    pruningOrApproximationUsed: false,
    pins: [],
    bottomUpEvaluationOrder: [...rawView.tree.bottomUp],
    orientationMaps: {
      checkpoint: namedOrientationMap(baseline.orientationMap),
      provisional: namedOrientationMap(provisional.orientationMap),
      oneStep: namedOrientationMap(oneStep.orientationMap),
      recursive: namedOrientationMap(recursive.orientationMap),
    },
    recursiveRows,
    changedFromCheckpoint: recursiveRows.filter((row) => row.changedFromCheckpoint),
    changedFromOneStep: recursiveRows.filter((row) => row.changedFromOneStep),
    selectedCompletionMismatches,
    selectedCompletionMismatchCount: selectedCompletionMismatches.length,
    exhaustiveOracle: recursiveResult.exhaustiveOracle,
    evaluationCache: recursiveResult.evaluationCache,
    finalDiagnostics: {
      checkpoint: completedDiagnostics(baseline),
      provisional: completedDiagnostics(provisional),
      oneStep: completedDiagnostics(oneStep),
      recursive: completedDiagnostics(recursive),
    },
    repairApplied: false,
  };
  for (const [view, role] of [
    [baseline, "checkpoint"],
    [provisional, "provisional"],
    [oneStep, "one-step"],
    [recursive, "self-consistent-recursive"],
  ]) {
    view.selfConsistentOrientationExperiment = { role, comparison };
    view.purity = {
      ...view.purity,
      productionFilesChanged: false,
      geometryRulesChanged: false,
      recursiveCompletionHarnessOnly: role === "self-consistent-recursive",
      oldProductionCompletionUsed: false,
      exhaustiveOracleUsedForSelection: false,
      pruningOrApproximationUsed: false,
      segmentLevelIntrusionDiagnosticChanged: false,
      edgeOverlapScored: false,
      rareRepairApplied: false,
    };
  }
  return { baseline, provisional, oneStep, recursive, comparison };
}

// Lightweight browser presentation of the exact Node-generated recursive report. Running
// all 2^N composed realizations synchronously in the browser makes the divides card needlessly
// slow; the report generator above remains the executable source of truth. This helper only
// realizes its already-verified selected map for display alongside the three preserved cards.
export function buildSelfConsistentCompletedCandidateViewerViews(rawView, fixtureReport) {
  if (!fixtureReport || fixtureReport.fixture !== rawView.programName) {
    fail(`missing self-consistent report row for ${rawView.programName}`);
  }
  const historical = buildCompletedCandidateOrientationComparisonViews(rawView);
  const composed = buildComposedLoopEndpointCandidate(rawView);
  const recursiveMap = new Map(rawView.roles.realForkIds.map((realForkId) => [
    realForkId,
    fixtureReport.orientationMaps.recursive[realForkId] === "flipped" ? { ...FLIPPED } : { ...DEFAULT },
  ]));
  const recursive = composed.realizeEndpoints(recursiveMap);
  const baseline = historical.baseline;
  const provisional = historical.provisional;
  const oneStep = historical.completed;
  baseline.viewLabel = "A. Checkpoint production orientation";
  provisional.viewLabel = "B. Provisional intrusion-aware selector";
  oneStep.viewLabel = "C. One-step completed-candidate selector";
  recursive.viewLabel = "D. Self-consistent recursive completion";
  recursive.viewerProvenance = "Exact selected map from the deterministic recursive/exhaustive report, realized through the unchanged composed geometry for display.";
  for (const [view, role] of [
    [baseline, "checkpoint"],
    [provisional, "provisional"],
    [oneStep, "one-step"],
    [recursive, "self-consistent-recursive"],
  ]) {
    view.selfConsistentOrientationExperiment = {
      role,
      reportSource: "self_consistent_completed_candidate_probe.json",
      fixtureReport,
      browserRecomputedExhaustiveEnumeration: false,
    };
  }
  return { baseline, provisional, oneStep, recursive };
}

// One-edge geometry splice for the predecessor comparison: retain the raw-role merge
// classification and its existing target-side body, but replace its source departure with
// the semantic branch's ordinary diamond face + fixed-angle ray. The sibling branch-exit arm
// supplies the production skeleton's already-realized ray vector, mirrored onto this branch's
// assigned side; no placement, classification, orientation, or route search is rerun.
export function buildBranchPreservingMergeSourceView(rawView, edgeId = "i-0-yes") {
  const edge = rawView.cfg.edgeById.get(edgeId);
  const baselineRoute = rawView.routed.routes.find((route) => route.edgeId === edgeId);
  if (!edge || !baselineRoute) fail(`missing branch-preserving merge edge ${edgeId}`);
  if ((edge.branch !== "yes" && edge.branch !== "no") || baselineRoute.edgeRole !== "merge-connector") {
    fail(`${edgeId} is not the expected semantic-branch merge connector`);
  }
  const sourcePlacement = rawView.skeleton.placements.get(edge.from);
  const visualSide = rawView.orientationOf(edge.from)?.[edge.branch];
  const siblingArm = rawView.skeleton.armSegments.find((arm) => arm.srcDiamond === edge.from && arm.side !== visualSide);
  if (!sourcePlacement || !siblingArm || baselineRoute.points.length < 2) fail(`cannot derive ordinary branch doorway for ${edgeId}`);

  const sourceBox = sourcePlacement.box;
  const sourcePort = visualSide === "left"
    ? [(sourceBox.left + sourceBox.cx) / 2, (sourceBox.cy + sourceBox.bottom) / 2]
    : [(sourceBox.cx + sourceBox.right) / 2, (sourceBox.cy + sourceBox.bottom) / 2];
  const siblingVector = [
    siblingArm.targetTop[0] - siblingArm.face[0],
    siblingArm.targetTop[1] - siblingArm.face[1],
  ];
  const branchRayEnd = [
    sourcePort[0] + (visualSide === "left" ? -Math.abs(siblingVector[0]) : Math.abs(siblingVector[0])),
    sourcePort[1] + siblingVector[1],
  ];
  const mergeResumePoint = [...baselineRoute.points[1]];
  const points = [sourcePort, branchRayEnd, mergeResumePoint, ...baselineRoute.points.slice(2).map((point) => [...point])];
  const splicedRoute = {
    ...baselineRoute,
    sourcePort,
    points,
    connectorKind: `${baselineRoute.connectorKind}+branchSourceStub`,
  };

  const routes = rawView.routed.routes.map((route) => route.edgeId === edgeId ? splicedRoute : route);
  const ports = new Map(rawView.routed.ports);
  const baselinePort = ports.get(edgeId);
  ports.set(edgeId, { ...baselinePort, sourcePort, experimentalBranchPreservingSource: true });
  const routed = { ...rawView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: rawView.boxes },
    { realForkSet: rawView.roles.realForkSet, lcaRF: rawView.tree.lcaRF },
    { clearance: CLEARANCE, program: rawView.programName, orientationSource: "rawRolesBranchPreservingMergeSource" },
  );
  const view = {
    ...rawView,
    routed,
    ports,
    defects,
    renderBounds: boundsOver(rawView.boxes, routes),
    attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
    viewLabel: "Ordinary HALT — raw roles + branch-preserving merge source",
    experimentalRouteSplice: {
      edgeId,
      edgeRole: splicedRoute.edgeRole,
      routeFamily: splicedRoute.routeFamily,
      semanticBranch: edge.branch,
      visualSide,
      sourcePort,
      branchRay: [sourcePort, branchRayEnd],
      splice: [branchRayEnd, mergeResumePoint],
      mergeResumesAt: mergeResumePoint,
      targetPort: splicedRoute.targetPort,
      baselineMergeBodyAfterResume: baselineRoute.points.slice(1),
      finalRoutePoints: points,
    },
    purity: { ...rawView.purity, oneEdgeGeometrySpliceOnly: edgeId, haltSpecificMachineryAdded: false },
  };
  return view;
}

// Second one-edge predecessor comparison: retain the identical raw-role merge target and
// semantic classification, but route from the ordinary branch ray endpoint vertically to the
// selected target-port row and then horizontally into that unchanged target port. This is a
// fixed three-segment construction, not an obstacle search or a new route family.
export function buildYesRayVerticalHorizontalMergeView(rawView, edgeId = "i-0-yes") {
  const departureView = buildBranchPreservingMergeSourceView(rawView, edgeId);
  const departure = departureView.experimentalRouteSplice;
  const baselineRoute = rawView.routed.routes.find((route) => route.edgeId === edgeId);
  if (!departure || !baselineRoute) fail(`cannot construct YES ray + V/H route for ${edgeId}`);

  const sourcePort = [...departure.sourcePort];
  const branchRayEnd = [...departure.branchRay[1]];
  const targetPort = [...baselineRoute.targetPort];
  const verticalEnd = [branchRayEnd[0], targetPort[1]];
  const points = [sourcePort, branchRayEnd, verticalEnd, targetPort];
  const experimentalRoute = {
    ...baselineRoute,
    sourcePort,
    targetPort,
    points,
    connectorKind: "branchSourceRay+verticalHorizontal",
  };

  const routes = rawView.routed.routes.map((route) => route.edgeId === edgeId ? experimentalRoute : route);
  const ports = new Map(rawView.routed.ports);
  const baselinePort = ports.get(edgeId);
  ports.set(edgeId, { ...baselinePort, sourcePort, targetPort, experimentalBranchPreservingSource: true });
  const routed = { ...rawView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: rawView.boxes },
    { realForkSet: rawView.roles.realForkSet, lcaRF: rawView.tree.lcaRF },
    { clearance: CLEARANCE, program: rawView.programName, orientationSource: "rawRolesYesRayVerticalHorizontalMerge" },
  );
  return {
    ...rawView,
    routed,
    ports,
    defects,
    renderBounds: boundsOver(rawView.boxes, routes),
    attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
    viewLabel: "Ordinary HALT — YES ray + V/H merge",
    experimentalRouteSplice: {
      edgeId,
      edgeRole: experimentalRoute.edgeRole,
      routeFamily: experimentalRoute.routeFamily,
      semanticBranch: rawView.cfg.edgeById.get(edgeId)?.branch,
      visualSide: departure.visualSide,
      sourcePort,
      branchRay: [sourcePort, branchRayEnd],
      verticalSegment: [branchRayEnd, verticalEnd],
      horizontalSegment: [verticalEnd, targetPort],
      targetPort,
      finalRoutePoints: points,
    },
    purity: { ...rawView.purity, oneEdgeGeometrySpliceOnly: edgeId, haltSpecificMachineryAdded: false },
  };
}

export function buildBranchPreservingMergeSourcesView(rawView) {
  const eligibleEdges = rawView.cfg.edges.filter((edge) => (
    (edge.branch === "yes" || edge.branch === "no")
    && rawView.roles.edgeRoleById.get(edge.id) === "merge-connector"
    && rawView.cfg.nodeById.get(edge.from)?.kind === "conditionalJump"
  ));
  let view = rawView;
  const changedRoutes = [];
  for (const edge of eligibleEdges) {
    view = buildYesRayVerticalHorizontalMergeView(view, edge.id);
    changedRoutes.push(view.experimentalRouteSplice);
  }
  return {
    ...view,
    viewLabel: "Ordinary HALT — branch-preserving merge sources",
    experimentalRouteSplice: null,
    experimentalRouteSplices: changedRoutes,
    purity: {
      ...view.purity,
      generalizedEligibleEdgeIds: eligibleEdges.map((edge) => edge.id),
      routeConstruction: "ordinary branch ray, then fixed vertical, then fixed horizontal",
      automaticRepairAfterConstruction: false,
      haltSpecificMachineryAdded: false,
    },
  };
}

// Same eligible raw-role branch merges and the same fixed V->H body as the generalized
// full-ray view, but the source-local ray is exactly one existing V4 clearance unit long.
// Its direction comes only from the assigned visual side + production branch angle; neither
// sibling placement, target position, obstacles, nor diagnostics participate in the stub.
export function buildShortBranchStubMergeSourcesView(rawView) {
  const fullRayView = buildBranchPreservingMergeSourcesView(rawView);
  const eligibleEdges = rawView.cfg.edges.filter((edge) => (
    (edge.branch === "yes" || edge.branch === "no")
    && rawView.roles.edgeRoleById.get(edge.id) === "merge-connector"
    && rawView.cfg.nodeById.get(edge.from)?.kind === "conditionalJump"
  ));
  const changedById = new Map();
  const changedRoutes = [];
  const tan = ordinaryVisual.branchAngleTan;
  const unitX = 1 / Math.sqrt(1 + tan * tan);
  const unitY = tan * unitX;

  for (const edge of eligibleEdges) {
    const baselineRoute = rawView.routed.routes.find((route) => route.edgeId === edge.id);
    const fullRayRoute = fullRayView.routed.routes.find((route) => route.edgeId === edge.id);
    const sourceBox = rawView.skeleton.placements.get(edge.from)?.box;
    const visualSide = rawView.orientationOf(edge.from)?.[edge.branch];
    if (!baselineRoute || !fullRayRoute || !sourceBox || (visualSide !== "left" && visualSide !== "right")) {
      fail(`cannot construct short branch stub for ${edge.id}`);
    }
    const sourcePort = visualSide === "left"
      ? [(sourceBox.left + sourceBox.cx) / 2, (sourceBox.cy + sourceBox.bottom) / 2]
      : [(sourceBox.cx + sourceBox.right) / 2, (sourceBox.cy + sourceBox.bottom) / 2];
    const shortStubEnd = [
      sourcePort[0] + (visualSide === "left" ? -1 : 1) * CLEARANCE * unitX,
      sourcePort[1] + CLEARANCE * unitY,
    ];
    const targetPort = [...baselineRoute.targetPort];
    const verticalEnd = [shortStubEnd[0], targetPort[1]];
    const points = [sourcePort, shortStubEnd, verticalEnd, targetPort];
    const route = {
      ...baselineRoute,
      sourcePort,
      targetPort,
      points,
      connectorKind: "shortBranchStub+verticalHorizontal",
    };
    changedById.set(edge.id, route);

    const previousFullRayEndpoint = [...fullRayRoute.points[1]];
    const previousRayLength = Math.hypot(
      previousFullRayEndpoint[0] - sourcePort[0],
      previousFullRayEndpoint[1] - sourcePort[1],
    );
    changedRoutes.push({
      edgeId: edge.id,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      semanticBranch: edge.branch,
      visualSide,
      sourcePort,
      previousFullRayEndpoint,
      shortStubEndpoint: shortStubEnd,
      previousRayLength,
      shortStubLength: CLEARANCE,
      branchAngleDegrees: Math.atan(tan) * 180 / Math.PI,
      verticalSegment: [shortStubEnd, verticalEnd],
      horizontalSegment: [verticalEnd, targetPort],
      targetPort,
      finalRoutePoints: points,
    });
  }

  const routes = rawView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
  const ports = new Map(rawView.routed.ports);
  for (const change of changedRoutes) {
    const baselinePort = ports.get(change.edgeId);
    ports.set(change.edgeId, {
      ...baselinePort,
      sourcePort: change.sourcePort,
      targetPort: change.targetPort,
      experimentalBranchPreservingSource: true,
    });
  }
  const routed = { ...rawView.routed, routes, ports };
  const defects = evaluateDefects(
    { routes, boxes: rawView.boxes },
    { realForkSet: rawView.roles.realForkSet, lcaRF: rawView.tree.lcaRF },
    { clearance: CLEARANCE, program: rawView.programName, orientationSource: "rawRolesShortBranchStubVerticalHorizontalMerge" },
  );
  return {
    ...rawView,
    routed,
    ports,
    defects,
    renderBounds: boundsOver(rawView.boxes, routes),
    attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
    viewLabel: "Ordinary HALT — short branch stub + V/H merge",
    experimentalRouteSplice: null,
    experimentalRouteSplices: changedRoutes,
    purity: {
      ...rawView.purity,
      generalizedEligibleEdgeIds: eligibleEdges.map((edge) => edge.id),
      routeConstruction: "16px source-local branch-angle stub, then fixed vertical, then fixed horizontal",
      stubLengthSource: "existing V4 clearance",
      automaticRepairAfterConstruction: false,
      haltSpecificMachineryAdded: false,
    },
  };
}

// Adaptive-length comparison over the same raw-role eligible edges. The only obstruction
// vocabulary is an unrelated committed node box whose Y extent overlaps the candidate FULL
// V-leg. The nearest outward box boundary defines boundary-to-boundary free space from the
// diamond doorway. A full leg with >= one clearance unit remaining stays full; when crowded,
// its X is moved to the gap midpoint. Edge centerlines are measured afterward, never treated
// as bounded obstacles or searched around.
export function buildAdaptiveBranchRayMergeSourcesView(rawView) {
  const fullRayView = buildBranchPreservingMergeSourcesView(rawView);
  const eligibleIds = fullRayView.purity.generalizedEligibleEdgeIds;
  const changedById = new Map();
  const decisions = [];

  for (const full of fullRayView.experimentalRouteSplices) {
    const edge = rawView.cfg.edgeById.get(full.edgeId);
    const fullRoute = fullRayView.routed.routes.find((route) => route.edgeId === full.edgeId);
    if (!edge || !fullRoute) fail(`cannot construct adaptive branch ray for ${full.edgeId}`);
    const direction = full.visualSide === "left" ? -1 : 1;
    const sourcePort = [...full.sourcePort];
    const fullRayEndpoint = [...full.branchRay[1]];
    const targetPort = [...full.targetPort];
    const fullHorizontalRun = direction * (fullRayEndpoint[0] - sourcePort[0]);
    const verticalMinY = Math.min(fullRayEndpoint[1], targetPort[1]);
    const verticalMaxY = Math.max(fullRayEndpoint[1], targetPort[1]);

    const candidates = [...rawView.boxes]
      .filter(([nodeId, box]) => (
        nodeId !== edge.from
        && nodeId !== edge.to
        && box.bottom >= verticalMinY
        && box.top <= verticalMaxY
      ))
      .map(([nodeId, box]) => {
        const nearBoundaryX = direction > 0 ? box.left : box.right;
        return {
          nodeId,
          nodeBox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          nearBoundaryX,
          boundaryGap: direction * (nearBoundaryX - sourcePort[0]),
        };
      })
      .filter((candidate) => candidate.boundaryGap > 1e-9)
      .sort((a, b) => a.boundaryGap - b.boundaryGap || a.nodeId.localeCompare(b.nodeId));

    const nearestGap = candidates[0]?.boundaryGap ?? null;
    const tiedNearest = nearestGap == null
      ? []
      : candidates.filter((candidate) => Math.abs(candidate.boundaryGap - nearestGap) < 1e-9);
    const clearanceAtFullLeg = nearestGap == null ? null : nearestGap - fullHorizontalRun;
    const midpointRun = nearestGap == null ? null : nearestGap / 2;
    const shortened = nearestGap != null
      && clearanceAtFullLeg < CLEARANCE
      && midpointRun < fullHorizontalRun;
    const chosenHorizontalRun = shortened ? midpointRun : fullHorizontalRun;
    const chosenRayEndpoint = shortened ? [
      sourcePort[0] + direction * chosenHorizontalRun,
      sourcePort[1] + chosenHorizontalRun * ordinaryVisual.branchAngleTan,
    ] : [...fullRayEndpoint];
    const verticalEnd = [chosenRayEndpoint[0], targetPort[1]];
    const points = [sourcePort, chosenRayEndpoint, verticalEnd, targetPort];
    const route = shortened
      ? { ...fullRoute, points, connectorKind: "adaptiveBranchRay+verticalHorizontal" }
      : fullRoute;
    if (shortened) changedById.set(full.edgeId, route);

    decisions.push({
      edgeId: full.edgeId,
      edgeRole: fullRoute.edgeRole,
      routeFamily: fullRoute.routeFamily,
      semanticBranch: edge.branch,
      visualSide: full.visualSide,
      sourcePort,
      fullSiblingRayLength: Math.hypot(
        fullRayEndpoint[0] - sourcePort[0],
        fullRayEndpoint[1] - sourcePort[1],
      ),
      fullRayEndpoint,
      shortened,
      relevantVerticalYSpan: [verticalMinY, verticalMaxY],
      nearestRelevantObstruction: tiedNearest.length ? {
        kind: "node-box-boundary",
        nodeIds: tiedNearest.map((candidate) => candidate.nodeId),
        boundaryX: tiedNearest[0].nearBoundaryX,
        boxes: tiedNearest.map((candidate) => ({ nodeId: candidate.nodeId, ...candidate.nodeBox })),
      } : null,
      availableBoundaryGap: nearestGap,
      clearanceAtFullLeg,
      clearanceThreshold: CLEARANCE,
      chosenRayEndpoint,
      chosenRayLength: Math.hypot(
        chosenRayEndpoint[0] - sourcePort[0],
        chosenRayEndpoint[1] - sourcePort[1],
      ),
      targetPort,
      finalRoutePoints: route.points,
    });
  }

  const routes = fullRayView.routed.routes.map((route) => changedById.get(route.edgeId) ?? route);
  const routed = { ...fullRayView.routed, routes };
  const defects = evaluateDefects(
    { routes, boxes: rawView.boxes },
    { realForkSet: rawView.roles.realForkSet, lcaRF: rawView.tree.lcaRF },
    { clearance: CLEARANCE, program: rawView.programName, orientationSource: "rawRolesAdaptiveBranchRayVerticalHorizontalMerge" },
  );
  return {
    ...fullRayView,
    routed,
    defects,
    renderBounds: boundsOver(rawView.boxes, routes),
    attachments: attachmentRecords(rawView.cfg, rawView.roles, rawView.boxes, routes),
    viewLabel: "Ordinary HALT — adaptive branch ray + V/H merge",
    experimentalRouteSplices: decisions,
    purity: {
      ...fullRayView.purity,
      generalizedEligibleEdgeIds: eligibleIds,
      adaptiveChangedEdgeIds: [...changedById.keys()],
      obstructionVocabulary: "nearest unrelated node-box boundary overlapping the full V-leg Y-span",
      crowdingThreshold: "less than one existing V4 clearance unit (16px)",
      shortenedPlacement: "midpoint of doorway-to-obstruction boundary gap",
      edgeGeometryInfluencesDecision: false,
      automaticRepairAfterConstruction: false,
    },
  };
}

export function buildCurrentView(program, programName) {
  const layout = buildLayout(program, {
    programName,
    orientationSource: "v4Assigned",
    visual: currentVisual,
    pins: new Map(),
    diagnostics: true,
  });
  return {
    ...layout,
    mode: "current",
    programName,
    program,
    attachments: attachmentRecords(layout.cfg, layout.roles, layout.boxes, layout.routed.routes),
    terminalId: "halt",
    viewLabel: "Current V4",
    purity: { controlUsesCurrentPipelineUnchanged: true },
  };
}

function segmentOrientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function properIntersection(a, b, c, d) {
  const o1 = segmentOrientation(a, b, c), o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a), o4 = segmentOrientation(c, d, b);
  if (!(o1 * o2 < -1e-3 && o3 * o4 < -1e-3)) return null;
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denominator;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export function crossingDetails(routes) {
  const output = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
    let found = null;
    for (let ai = 0; ai < a.points.length - 1 && !found; ai++) {
      for (let bi = 0; bi < b.points.length - 1 && !found; bi++) {
        const point = properIntersection(a.points[ai], a.points[ai + 1], b.points[bi], b.points[bi + 1]);
        if (point) found = { edgeA: a.edgeId, edgeB: b.edgeId, segmentA: ai, segmentB: bi, point };
      }
    }
    if (found) output.push(found);
  }
  return output;
}

export function nodeOverlapDetails(boxes) {
  const entries = [...boxes];
  const output = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [idA, a] = entries[i], [idB, b] = entries[j];
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (overlapX > 1 && overlapY > 1) output.push({ nodeA: idA, nodeB: idB, overlapX, overlapY });
  }
  return output;
}

export function edgeOverlapDetails(routes) {
  const epsilon = 1e-7;
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const overlaps = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const routeA = routes[i], routeB = routes[j];
    for (let segmentA = 0; segmentA < routeA.points.length - 1; segmentA++) {
      const a = routeA.points[segmentA], b = routeA.points[segmentA + 1];
      const vectorA = [b[0] - a[0], b[1] - a[1]];
      const lengthA = Math.hypot(...vectorA);
      if (lengthA <= epsilon) continue;
      for (let segmentB = 0; segmentB < routeB.points.length - 1; segmentB++) {
        const c = routeB.points[segmentB], d = routeB.points[segmentB + 1];
        const vectorB = [d[0] - c[0], d[1] - c[1]];
        const lengthB = Math.hypot(...vectorB);
        if (lengthB <= epsilon) continue;
        if (Math.abs(cross(vectorA, vectorB)) > epsilon * lengthA * lengthB) continue;
        if (Math.abs(cross([c[0] - a[0], c[1] - a[1]], vectorA)) > epsilon * lengthA) continue;
        const axis = Math.abs(vectorA[0]) >= Math.abs(vectorA[1]) ? 0 : 1;
        const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
        const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
        if (high - low <= epsilon) continue;
        const pointAt = (coordinate) => {
          const t = (coordinate - a[axis]) / vectorA[axis];
          return [a[0] + vectorA[0] * t, a[1] + vectorA[1] * t];
        };
        overlaps.push({
          edgeA: routeA.edgeId,
          edgeB: routeB.edgeId,
          segmentA,
          segmentB,
          interval: [pointAt(low), pointAt(high)],
        });
      }
    }
  }
  return overlaps;
}

const INTRUSION_EPSILON = 1e-9;

function segmentInteriorInterval(start, end, box) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  if (Math.hypot(dx, dy) <= INTRUSION_EPSILON) return null;

  // Intersect the segment's parameter interval with the open intervals imposed by
  // left < x < right and top < y < bottom. A segment that merely lies on or touches
  // a box boundary therefore has no non-empty interior interval.
  let low = 0, high = 1;
  for (const [origin, delta, minimum, maximum] of [
    [start[0], dx, box.left, box.right],
    [start[1], dy, box.top, box.bottom],
  ]) {
    if (Math.abs(delta) <= INTRUSION_EPSILON) {
      if (!(origin > minimum + INTRUSION_EPSILON && origin < maximum - INTRUSION_EPSILON)) return null;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (high - low <= INTRUSION_EPSILON) return null;
  }

  if (high - low <= INTRUSION_EPSILON || high < -INTRUSION_EPSILON || low > 1 + INTRUSION_EPSILON) return null;
  const tStart = Math.max(0, low), tEnd = Math.min(1, high);
  if (tEnd - tStart <= INTRUSION_EPSILON) return null;
  const pointAt = (t) => [start[0] + dx * t, start[1] + dy * t];
  const startStrictlyInside = start[0] > box.left + INTRUSION_EPSILON
    && start[0] < box.right - INTRUSION_EPSILON
    && start[1] > box.top + INTRUSION_EPSILON
    && start[1] < box.bottom - INTRUSION_EPSILON;
  const endStrictlyInside = end[0] > box.left + INTRUSION_EPSILON
    && end[0] < box.right - INTRUSION_EPSILON
    && end[1] > box.top + INTRUSION_EPSILON
    && end[1] < box.bottom - INTRUSION_EPSILON;
  const crossesCompletelyThrough = !startStrictlyInside && !endStrictlyInside
    && tStart > INTRUSION_EPSILON && tEnd < 1 - INTRUSION_EPSILON;
  const penetrationKind = crossesCompletelyThrough ? "crosses-completely-through"
    : startStrictlyInside && endStrictlyInside ? "segment-contained-inside"
      : "enters-partway";

  return {
    tStart,
    tEnd,
    interval: [pointAt(tStart), pointAt(tEnd)],
    crossesCompletelyThrough,
    penetrationKind,
  };
}

export function unrelatedNodeEdgeIntersections(routes, boxes) {
  const intersections = [];
  for (const route of routes) {
    for (let segmentIndex = 0; segmentIndex < route.points.length - 1; segmentIndex++) {
      const segmentStart = route.points[segmentIndex];
      const segmentEnd = route.points[segmentIndex + 1];
      if (Math.hypot(segmentEnd[0] - segmentStart[0], segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON) continue;
      const orientation = Math.abs(segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON ? "horizontal"
        : Math.abs(segmentEnd[0] - segmentStart[0]) <= INTRUSION_EPSILON ? "vertical"
          : "diagonal";
      for (const [nodeId, box] of boxes) {
        if (nodeId === route.source || nodeId === route.target) continue;
        const interior = segmentInteriorInterval(segmentStart, segmentEnd, box);
        if (!interior) continue;
        intersections.push({
          nodeId,
          edgeId: route.edgeId,
          nodeBox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          segmentIndex,
          segmentStart: [...segmentStart],
          segmentEnd: [...segmentEnd],
          orientation,
          intersectionInterval: interior.interval,
          parameterInterval: [interior.tStart, interior.tEnd],
          crossesCompletelyThrough: interior.crossesCompletelyThrough,
          penetrationKind: interior.penetrationKind,
        });
      }
    }
  }
  return intersections;
}

function exactBoxSnapshot(view, nodeId) {
  const box = view.boxes.get(nodeId);
  return box ? { nodeId, ...box } : null;
}

function exactRouteSnapshot(view, edgeId) {
  const route = view.routed.routes.find((candidate) => candidate.edgeId === edgeId);
  if (!route) return null;
  return {
    edgeId: route.edgeId,
    source: route.source,
    target: route.target,
    edgeRole: route.edgeRole,
    routeFamily: route.routeFamily,
    connectorKind: route.connectorKind ?? null,
    portPolicyCase: route.portPolicyCase ?? null,
    sourcePort: [...route.sourcePort],
    targetPort: [...route.targetPort],
    points: route.points.map((point) => [...point]),
  };
}

function attachmentLegalitySnapshot(view) {
  const rowFor = (record) => ({
    edgeId: record.edgeId,
    edgeRole: record.edgeRole,
    routeFamily: record.routeFamily,
    legal: record.legal,
    source: {
      nodeId: record.source.nodeId,
      portName: record.source.portName,
      portPoint: record.source.portPoint,
      incidentDirection: record.source.incidentDirection,
      legal: record.source.legal,
      reason: record.source.reason,
    },
    target: {
      nodeId: record.target.nodeId,
      portName: record.target.portName,
      portPoint: record.target.portPoint,
      incidentDirection: record.target.incidentDirection,
      legal: record.target.legal,
      reason: record.target.reason,
    },
  });
  const illegal = view.attachments.filter((record) => !record.legal).map(rowFor);
  const loopReturn = view.attachments
    .filter((record) => record.edgeRole === "loop-return")
    .map(rowFor);
  return {
    edgeCount: view.attachments.length,
    legalEdgeCount: view.attachments.length - illegal.length,
    illegalEdgeCount: illegal.length,
    illegalEdges: illegal,
    loopReturnEdgeCount: loopReturn.length,
    legalLoopReturnEdgeCount: loopReturn.filter((record) => record.legal).length,
    loopReturnEdges: loopReturn,
  };
}

function diagnosticCatalog(view) {
  return {
    productionDefects: view.defects.defects.map((defect) => ({ ...defect })),
    crossings: crossingDetails(view.routed.routes),
    edgeOverlaps: edgeOverlapDetails(view.routed.routes),
    nodeOverlaps: nodeOverlapDetails(view.boxes),
    unrelatedNodeEdgeIntrusions: unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes),
    illegalAttachments: attachmentLegalitySnapshot(view).illegalEdges,
  };
}

function orientationCandidateSnapshot(view) {
  return {
    orientation: mapToObject(view.orientationMap),
    productionCost: view.defects.total,
    productionDefects: view.defects.defects.map((defect) => ({ ...defect })),
    diagnostics: diagnosticCatalog(view),
    attachmentLegality: attachmentLegalitySnapshot(view),
    focusGeometry: {
      i24JumpRoute: exactRouteSnapshot(view, "i-24-jump"),
      i26Box: exactBoxSnapshot(view, "i-26"),
    },
  };
}

function replayOrientationCandidateMap(rawView, orientationResult, forkId, candidateBit) {
  const map = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  for (const currentId of rawView.tree.bottomUp) {
    map.set(currentId, { ...DEFAULT });
    if (currentId === forkId) {
      map.set(currentId, candidateBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
      return map;
    }
    const row = orientationResult.rows.find((candidate) => candidate.realForkId === currentId);
    if (!row) fail(`orientation result has no ${currentId} evaluation row`);
    map.set(currentId, row.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  }
  fail(`${forkId} is absent from the bottom-up evaluation order`);
}

function orientationCandidateComponents(view) {
  const nodeOverlaps = nodeOverlapDetails(view.boxes);
  const properCrossings = crossingDetails(view.routed.routes);
  const nodeEdgeIntrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes);
  return {
    nodeOverlapCount: nodeOverlaps.length,
    nodeOverlaps,
    properCrossingCount: properCrossings.length,
    properCrossings,
    nodeEdgeIntrusionCount: nodeEdgeIntrusions.length,
    nodeEdgeIntrusions,
    oldProductionCost: nodeOverlaps.length + properCrossings.length,
    experimentalCost: nodeOverlaps.length + properCrossings.length + nodeEdgeIntrusions.length,
  };
}

function orientationEvaluationTrace(rawView, realize, orientationResult, scoreKind) {
  return rawView.tree.bottomUp.map((realForkId) => {
    const row = orientationResult.rows.find((candidate) => candidate.realForkId === realForkId);
    if (!row) fail(`orientation result has no ${realForkId} evaluation row`);
    const defaultView = realize(replayOrientationCandidateMap(rawView, orientationResult, realForkId, "default"));
    const flippedView = realize(replayOrientationCandidateMap(rawView, orientationResult, realForkId, "flipped"));
    const defaultCandidate = orientationCandidateComponents(defaultView);
    const flippedCandidate = orientationCandidateComponents(flippedView);
    const expectedDefault = scoreKind === "intrusion-aware" ? defaultCandidate.experimentalCost : defaultCandidate.oldProductionCost;
    const expectedFlipped = scoreKind === "intrusion-aware" ? flippedCandidate.experimentalCost : flippedCandidate.oldProductionCost;
    if (expectedDefault !== row.costDefault || expectedFlipped !== row.costFlipped) {
      fail(`${scoreKind} replay for ${realForkId} produced ${expectedDefault}/${expectedFlipped}, expected ${row.costDefault}/${row.costFlipped}`);
    }
    return {
      realForkId,
      scoreKind,
      default: defaultCandidate,
      flipped: flippedCandidate,
      finalDecision: row.v4AssignedBit,
      tieBreakReason: row.tieBreakReason,
      strictImprovement: row.strictImprovement,
      parentRealFork: row.parentRealFork,
      childRealForks: row.childRealForks,
    };
  });
}

function namedOrientationMap(orientationMap) {
  return Object.fromEntries([...orientationMap].map(([id, orientation]) => [id, bitName(orientation)]));
}

function cloneOrientationMap(orientationMap) {
  return new Map([...orientationMap].map(([id, orientation]) => [id, { ...orientation }]));
}

function completedDiagnostics(view) {
  const components = orientationCandidateComponents(view);
  const edgeOverlaps = edgeOverlapDetails(view.routed.routes);
  return {
    ...components,
    edgeOverlapCount: edgeOverlaps.length,
    edgeOverlaps,
  };
}

function completeOrientationCandidate(rawView, realize, normalResult, forkId, candidateBit) {
  const order = [...rawView.tree.bottomUp];
  const focusIndex = order.indexOf(forkId);
  if (focusIndex < 0) fail(`${forkId} is absent from the bottom-up evaluation order`);
  const normalRowByFork = new Map(normalResult.rows.map((row) => [row.realForkId, row]));
  const orientationMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const processedBefore = [];
  for (const earlierId of order.slice(0, focusIndex)) {
    const row = normalRowByFork.get(earlierId);
    if (!row) fail(`normal intrusion-aware pass has no row for ${earlierId}`);
    orientationMap.set(earlierId, row.v4AssignedBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
    processedBefore.push({ realForkId: earlierId, decision: row.v4AssignedBit });
  }
  orientationMap.set(forkId, candidateBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  const provisionalMap = cloneOrientationMap(orientationMap);
  const provisionalView = realize(provisionalMap);
  const provisionalDiagnostics = completedDiagnostics(provisionalView);
  const laterRows = [];
  const laterStates = [];

  for (const laterId of order.slice(focusIndex + 1)) {
    orientationMap.set(laterId, { ...DEFAULT });
    const defaultView = realize(orientationMap);
    const defaultCandidate = orientationCandidateComponents(defaultView);
    orientationMap.set(laterId, { ...FLIPPED });
    const flippedView = realize(orientationMap);
    const flippedCandidate = orientationCandidateComponents(flippedView);
    const finalDecision = flippedCandidate.experimentalCost < defaultCandidate.experimentalCost ? "flipped" : "default";
    orientationMap.set(laterId, finalDecision === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
    const selectedView = realize(orientationMap);
    const row = {
      realForkId: laterId,
      default: defaultCandidate,
      flipped: flippedCandidate,
      finalDecision,
      tieBreakReason: flippedCandidate.experimentalCost < defaultCandidate.experimentalCost
        ? "flip strictly reduces total defects"
        : flippedCandidate.experimentalCost === defaultCandidate.experimentalCost
          ? "tie -> default"
          : "default strictly better",
    };
    laterRows.push(row);
    laterStates.push({
      afterFork: laterId,
      decision: finalDecision,
      orientationMap: namedOrientationMap(orientationMap),
      view: selectedView,
    });
  }

  const finalMap = cloneOrientationMap(orientationMap);
  const finalView = realize(finalMap);
  return {
    forkId,
    candidateBit,
    focusIndex,
    processedBefore,
    unresolvedAfter: order.slice(focusIndex + 1),
    provisionalMap,
    provisionalView,
    provisionalDiagnostics,
    laterRows,
    laterStates,
    finalMap,
    finalView,
    finalDiagnostics: completedDiagnostics(finalView),
  };
}

function productionCompleteOrientationSuffix(rawView, realize, seedMap, firstUnresolvedIndex) {
  const orientationMap = cloneOrientationMap(seedMap);
  const rows = [];
  for (const realForkId of rawView.tree.bottomUp.slice(firstUnresolvedIndex)) {
    orientationMap.set(realForkId, { ...DEFAULT });
    const defaultCandidate = orientationCandidateComponents(realize(orientationMap));
    orientationMap.set(realForkId, { ...FLIPPED });
    const flippedCandidate = orientationCandidateComponents(realize(orientationMap));
    const finalDecision = flippedCandidate.oldProductionCost < defaultCandidate.oldProductionCost
      ? "flipped"
      : "default";
    orientationMap.set(realForkId, finalDecision === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
    rows.push({
      realForkId,
      defaultProductionCost: defaultCandidate.oldProductionCost,
      flippedProductionCost: flippedCandidate.oldProductionCost,
      finalDecision,
      tieBreakReason: flippedCandidate.oldProductionCost < defaultCandidate.oldProductionCost
        ? "flip strictly reduces production defects"
        : flippedCandidate.oldProductionCost === defaultCandidate.oldProductionCost
          ? "production tie -> default"
          : "default strictly better under production cost",
    });
  }
  const view = realize(orientationMap);
  return {
    orientationMap,
    rows,
    view,
    diagnostics: completedDiagnostics(view),
  };
}

function suffixOrientationDifferences(rawView, candidateMap, eventualMap, firstUnresolvedIndex) {
  return rawView.tree.bottomUp.slice(firstUnresolvedIndex)
    .filter((realForkId) => bitName(candidateMap.get(realForkId)) !== bitName(eventualMap.get(realForkId)))
    .map((realForkId) => ({
      realForkId,
      temporaryCompletion: bitName(candidateMap.get(realForkId)),
      eventualOuterSweep: bitName(eventualMap.get(realForkId)),
    }));
}

function eventualSuffixCandidate(rawView, realize, preFocusMap, focusIndex, focusBit, eventualMap) {
  const orientationMap = cloneOrientationMap(preFocusMap);
  const focusId = rawView.tree.bottomUp[focusIndex];
  orientationMap.set(focusId, focusBit === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  for (const laterId of rawView.tree.bottomUp.slice(focusIndex + 1)) {
    const eventual = eventualMap.get(laterId) ?? DEFAULT;
    orientationMap.set(laterId, bitName(eventual) === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
  }
  const view = realize(orientationMap);
  return {
    orientationMap: namedOrientationMap(orientationMap),
    components: orientationCandidateComponents(view),
  };
}

function assignCompletedCandidateOrientation({ rawView, realize }) {
  const outerMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const workingRows = [];
  for (let focusIndex = 0; focusIndex < rawView.tree.bottomUp.length; focusIndex++) {
    const realForkId = rawView.tree.bottomUp[focusIndex];
    const preFocusMap = cloneOrientationMap(outerMap);

    const defaultSeed = cloneOrientationMap(preFocusMap);
    defaultSeed.set(realForkId, { ...DEFAULT });
    const provisionalDefault = orientationCandidateComponents(realize(defaultSeed));
    const defaultCompletion = productionCompleteOrientationSuffix(rawView, realize, defaultSeed, focusIndex + 1);

    const flippedSeed = cloneOrientationMap(preFocusMap);
    flippedSeed.set(realForkId, { ...FLIPPED });
    const provisionalFlipped = orientationCandidateComponents(realize(flippedSeed));
    const flippedCompletion = productionCompleteOrientationSuffix(rawView, realize, flippedSeed, focusIndex + 1);

    const completedDefault = defaultCompletion.diagnostics;
    const completedFlipped = flippedCompletion.diagnostics;
    const finalDecision = completedFlipped.experimentalCost < completedDefault.experimentalCost
      ? "flipped"
      : "default";
    outerMap.set(realForkId, finalDecision === "flipped" ? { ...FLIPPED } : { ...DEFAULT });
    workingRows.push({
      realForkId,
      focusIndex,
      preFocusMap,
      provisionalDefault,
      provisionalFlipped,
      completedDefault,
      completedFlipped,
      defaultCompletion,
      flippedCompletion,
      finalDecision,
      strictImprovement: finalDecision === "flipped",
      tieBreakReason: completedFlipped.experimentalCost < completedDefault.experimentalCost
        ? "completed flipped candidate strictly reduces experimental defects"
        : completedFlipped.experimentalCost === completedDefault.experimentalCost
          ? "completed candidate tie -> default"
          : "completed default candidate strictly better",
    });
  }

  const finalMap = cloneOrientationMap(outerMap);
  const rows = workingRows.map((row) => {
    const firstUnresolvedIndex = row.focusIndex + 1;
    const defaultSuffixDifferences = suffixOrientationDifferences(
      rawView,
      row.defaultCompletion.orientationMap,
      finalMap,
      firstUnresolvedIndex,
    );
    const flippedSuffixDifferences = suffixOrientationDifferences(
      rawView,
      row.flippedCompletion.orientationMap,
      finalMap,
      firstUnresolvedIndex,
    );
    const eventualDefault = eventualSuffixCandidate(rawView, realize, row.preFocusMap, row.focusIndex, "default", finalMap);
    const eventualFlipped = eventualSuffixCandidate(rawView, realize, row.preFocusMap, row.focusIndex, "flipped", finalMap);
    const eventualDecision = eventualFlipped.components.experimentalCost < eventualDefault.components.experimentalCost
      ? "flipped"
      : "default";
    const chosenCompletion = row.finalDecision === "flipped" ? row.flippedCompletion : row.defaultCompletion;
    const chosenSuffixDifferences = row.finalDecision === "flipped" ? flippedSuffixDifferences : defaultSuffixDifferences;
    return {
      realForkId: row.realForkId,
      focusIndex: row.focusIndex,
      preFocusOrientationMap: namedOrientationMap(row.preFocusMap),
      provisionalDefault: row.provisionalDefault,
      provisionalFlipped: row.provisionalFlipped,
      completedDefault: row.completedDefault,
      completedFlipped: row.completedFlipped,
      temporaryCompletionDefault: {
        orientationMap: namedOrientationMap(row.defaultCompletion.orientationMap),
        productionPolicyRows: row.defaultCompletion.rows,
      },
      temporaryCompletionFlipped: {
        orientationMap: namedOrientationMap(row.flippedCompletion.orientationMap),
        productionPolicyRows: row.flippedCompletion.rows,
      },
      finalDecision: row.finalDecision,
      strictImprovement: row.strictImprovement,
      tieBreakReason: row.tieBreakReason,
      rolloutSuffixDivergence: {
        defaultCandidate: defaultSuffixDifferences,
        flippedCandidate: flippedSuffixDifferences,
        chosenCandidate: chosenSuffixDifferences,
        chosenTemporaryCompletionMap: namedOrientationMap(chosenCompletion.orientationMap),
        eventualOuterSweepMap: namedOrientationMap(finalMap),
        anyCandidateDiffers: defaultSuffixDifferences.length > 0 || flippedSuffixDifferences.length > 0,
        chosenCandidateDiffers: chosenSuffixDifferences.length > 0,
      },
      eventualSuffixAudit: {
        note: "Counterfactual diagnostic only: later bits are copied from the eventual outer-sweep map; no recursive rollout is performed.",
        defaultCandidate: eventualDefault,
        flippedCandidate: eventualFlipped,
        decisionUnderEventualSuffix: eventualDecision,
        rolloutDecision: row.finalDecision,
        misleadingDecision: eventualDecision !== row.finalDecision,
      },
    };
  });
  const finalView = realize(finalMap);
  return {
    orientationMap: finalMap,
    rows,
    finalTotal: orientationCandidateComponents(finalView).experimentalCost,
    rareRepairCandidates: [],
    rareRepairApplied: false,
  };
}

function recursiveCostComponents(view) {
  const components = orientationCandidateComponents(view);
  return {
    nodeOverlapCount: components.nodeOverlapCount,
    properCrossingCount: components.properCrossingCount,
    nodeEdgeIntrusionCount: components.nodeEdgeIntrusionCount,
    experimentalCost: components.experimentalCost,
  };
}

function orientationBitKey(order, orientationMap) {
  return order.map((realForkId) => bitName(orientationMap.get(realForkId)) === "flipped" ? "1" : "0").join("");
}

function orientationDifferences(order, a, b) {
  return order
    .filter((realForkId) => bitName(a.get(realForkId)) !== bitName(b.get(realForkId)))
    .map((realForkId) => ({
      realForkId,
      candidateCompletion: bitName(a.get(realForkId)),
      recursiveSelectedMap: bitName(b.get(realForkId)),
    }));
}

function assignSelfConsistentCompletedCandidateOrientation({ rawView, realize }) {
  const order = [...rawView.tree.bottomUp];
  const evaluationCache = new Map();
  let cacheHits = 0;
  let cacheMisses = 0;
  const evaluateFinalMap = (orientationMap) => {
    const key = orientationBitKey(order, orientationMap);
    const cached = evaluationCache.get(key);
    if (cached) {
      cacheHits += 1;
      return cached;
    }
    const components = recursiveCostComponents(realize(orientationMap));
    const result = { key, components };
    evaluationCache.set(key, result);
    cacheMisses += 1;
    return result;
  };

  const solve = (focusIndex, prefixMap) => {
    if (focusIndex >= order.length) {
      const orientationMap = cloneOrientationMap(prefixMap);
      const evaluation = evaluateFinalMap(orientationMap);
      return { orientationMap, evaluation, selectedRows: [] };
    }
    const realForkId = order[focusIndex];
    const defaultMap = cloneOrientationMap(prefixMap);
    defaultMap.set(realForkId, { ...DEFAULT });
    const defaultResult = solve(focusIndex + 1, defaultMap);
    const flippedMap = cloneOrientationMap(prefixMap);
    flippedMap.set(realForkId, { ...FLIPPED });
    const flippedResult = solve(focusIndex + 1, flippedMap);
    const finalDecision = flippedResult.evaluation.components.experimentalCost
      < defaultResult.evaluation.components.experimentalCost
      ? "flipped"
      : "default";
    const selected = finalDecision === "flipped" ? flippedResult : defaultResult;
    const row = {
      realForkId,
      focusIndex,
      prefixOrientationMap: namedOrientationMap(prefixMap),
      completedDefault: defaultResult.evaluation.components,
      completedFlipped: flippedResult.evaluation.components,
      recursiveCompletionDefaultOrientationMap: namedOrientationMap(defaultResult.orientationMap),
      recursiveCompletionFlippedOrientationMap: namedOrientationMap(flippedResult.orientationMap),
      finalDecision,
      strictImprovement: finalDecision === "flipped",
      tieBreakReason: flippedResult.evaluation.components.experimentalCost
        < defaultResult.evaluation.components.experimentalCost
        ? "recursively completed flipped candidate strictly better"
        : flippedResult.evaluation.components.experimentalCost === defaultResult.evaluation.components.experimentalCost
          ? "recursively completed tie -> default"
          : "recursively completed default candidate strictly better",
      bothCandidateCompletionsSelfConsistent: true,
    };
    return {
      orientationMap: cloneOrientationMap(selected.orientationMap),
      evaluation: selected.evaluation,
      selectedRows: [row, ...selected.selectedRows],
    };
  };

  const initialMap = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
  const selected = solve(0, initialMap);
  const finalMap = cloneOrientationMap(selected.orientationMap);
  const rows = selected.selectedRows.map((row) => {
    const selectedCompletionObject = row.finalDecision === "flipped"
      ? row.recursiveCompletionFlippedOrientationMap
      : row.recursiveCompletionDefaultOrientationMap;
    const selectedCompletionMap = new Map(Object.entries(selectedCompletionObject).map(([id, decision]) => [
      id,
      decision === "flipped" ? { ...FLIPPED } : { ...DEFAULT },
    ]));
    return {
      ...row,
      selectedCompletionConsistency: {
        selectedCandidate: row.finalDecision,
        differencesFromFinalMap: orientationDifferences(order, selectedCompletionMap, finalMap),
        matchesRecursivePolicyActuallySelectedSuffix: orientationDifferences(order, selectedCompletionMap, finalMap).length === 0,
      },
    };
  });

  // Independent diagnostic loop: enumerate every bit mask after the recursive selection.
  // The memoized evaluator reuses identical final realizations but oracle results never feed
  // back into solve(). D=0/F=1 in bottom-up order defines the tie-order audit.
  const orientationMapForMask = (mask) => {
    const map = new Map(rawView.roles.realForkIds.map((id) => [id, { ...DEFAULT }]));
    for (let index = 0; index < order.length; index++) {
      if ((mask & (1 << index)) !== 0) map.set(order[index], { ...FLIPPED });
    }
    return map;
  };
  const totalMapCount = 2 ** order.length;
  let minimumCost = Number.POSITIVE_INFINITY;
  let minimizingKeys = [];
  const minimumComponentTriples = new Set();
  for (let mask = 0; mask < totalMapCount; mask++) {
    const map = orientationMapForMask(mask);
    const evaluation = evaluateFinalMap(map);
    const cost = evaluation.components.experimentalCost;
    if (cost < minimumCost) {
      minimumCost = cost;
      minimizingKeys = [evaluation.key];
      minimumComponentTriples.clear();
      minimumComponentTriples.add(JSON.stringify([
        evaluation.components.nodeOverlapCount,
        evaluation.components.properCrossingCount,
        evaluation.components.nodeEdgeIntrusionCount,
      ]));
    } else if (cost === minimumCost) {
      minimizingKeys.push(evaluation.key);
      minimumComponentTriples.add(JSON.stringify([
        evaluation.components.nodeOverlapCount,
        evaluation.components.properCrossingCount,
        evaluation.components.nodeEdgeIntrusionCount,
      ]));
    }
  }
  minimizingKeys.sort();
  const selectedKey = orientationBitKey(order, finalMap);
  const keyToNamedMap = (key) => Object.fromEntries(order.map((realForkId, index) => [
    realForkId,
    key[index] === "1" ? "flipped" : "default",
  ]));
  const exhaustiveOracle = {
    diagnosticOnly: true,
    usedForSelection: false,
    orientationOrder: order,
    keyLegend: "0=default, 1=flipped, ordered by orientationOrder",
    enumeratedMapCount: totalMapCount,
    minimumAchievableCost: minimumCost,
    minimizingMapCount: minimizingKeys.length,
    minimumComponentTriples: [...minimumComponentTriples].map((triple) => JSON.parse(triple)),
    recursiveSelectedCost: selected.evaluation.components.experimentalCost,
    recursiveSelectedKey: selectedKey,
    recursiveSelectedMap: namedOrientationMap(finalMap),
    recursiveReachesGlobalMinimum: selected.evaluation.components.experimentalCost === minimumCost,
    recursiveSelectedMapIsUniqueMinimum: minimizingKeys.length === 1 && minimizingKeys[0] === selectedKey,
    selectedIsDefaultLexicographicMinimumAmongGlobalMinima: minimizingKeys[0] === selectedKey,
    tieBehavior: minimizingKeys.length === 1
      ? "global minimum is unique"
      : "recursive strict-improvement/default-tie policy chooses the lexicographically first minimum in bottom-up order (default before flipped)",
    minimizingKeys: minimizingKeys.length <= 64 ? minimizingKeys : undefined,
    minimizingMapSample: minimizingKeys.slice(0, 16).map((key) => ({ key, orientationMap: keyToNamedMap(key) })),
    minimizingMapsOmittedAfterSample: Math.max(0, minimizingKeys.length - 16),
  };

  return {
    orientationMap: finalMap,
    rows,
    finalTotal: selected.evaluation.components.experimentalCost,
    exhaustiveOracle,
    evaluationCache: {
      uniqueFinalMapsRealized: evaluationCache.size,
      cacheMisses,
      cacheHits,
      expectedCompleteMapCount: totalMapCount,
    },
    rareRepairCandidates: [],
    rareRepairApplied: false,
  };
}

function branchPathForkIds(view, nodeId) {
  return view.ownership.branchPath(nodeId)
    .map((token) => /^i-(\d+)-(?:yes|no)$/.exec(token)?.[1])
    .filter((id) => id != null)
    .map((id) => `i-${id}`)
    .filter((id) => view.roles.realForkSet.has(id));
}

function nodeOwnershipPath(view, nodeId) {
  return {
    nodeId,
    branchPath: [...view.ownership.branchPath(nodeId)],
    realForkPath: branchPathForkIds(view, nodeId),
    owner: view.ownership.ownerOf(nodeId),
  };
}

function edgeOwnershipPath(view, edgeId) {
  const edge = view.cfg.edgeById.get(edgeId);
  const route = view.routed.routes.find((candidate) => candidate.edgeId === edgeId);
  if (!edge || !route) fail(`missing edge or route ${edgeId} while tracing intrusion ownership`);
  return {
    edgeId,
    source: edge.from,
    target: edge.to,
    semanticBranch: edge.branch ?? null,
    edgeRole: view.roles.edgeRoleById.get(edgeId) ?? route.edgeRole ?? null,
    routeFamily: route.routeFamily,
    sourcePath: nodeOwnershipPath(view, edge.from),
    targetPath: nodeOwnershipPath(view, edge.to),
    nearestCommonBranchPrefix: view.ownership.nca(edge.from, edge.to),
  };
}

function routeGeometry(view, edgeId) {
  const route = view.routed.routes.find((candidate) => candidate.edgeId === edgeId);
  return route ? {
    sourcePort: route.sourcePort,
    targetPort: route.targetPort,
    points: route.points,
    connectorKind: route.connectorKind,
    portPolicyCase: route.portPolicyCase,
  } : null;
}

function boxGeometry(view, nodeId) {
  const box = view.boxes.get(nodeId);
  return box ? { ...box } : null;
}

function intrusionGeometrySignature(intrusion) {
  return JSON.stringify([
    intrusion.edgeId,
    intrusion.nodeId,
    intrusion.segmentIndex,
    intrusion.segmentStart,
    intrusion.segmentEnd,
    intrusion.intersectionInterval,
    intrusion.penetrationKind,
  ]);
}

function intrusionPairMatches(intrusion, target) {
  return intrusion.edgeId === target.edgeId && intrusion.nodeId === target.nodeId;
}

function orientationInfluencesForIntrusion(rawView, realize, orientationMap, focusIndex, intrusion) {
  const baseView = realize(orientationMap);
  const baseRoute = routeGeometry(baseView, intrusion.edgeId);
  const baseBox = boxGeometry(baseView, intrusion.nodeId);
  const orderIndex = new Map(rawView.tree.bottomUp.map((id, index) => [id, index]));
  return rawView.roles.realForkIds.map((realForkId) => {
    const toggledMap = cloneOrientationMap(orientationMap);
    const current = toggledMap.get(realForkId) ?? DEFAULT;
    toggledMap.set(realForkId, bitName(current) === "flipped" ? { ...DEFAULT } : { ...FLIPPED });
    const toggledView = realize(toggledMap);
    const edgeRouteChanged = JSON.stringify(baseRoute) !== JSON.stringify(routeGeometry(toggledView, intrusion.edgeId));
    const nodeBoxChanged = JSON.stringify(baseBox) !== JSON.stringify(boxGeometry(toggledView, intrusion.nodeId));
    if (!edgeRouteChanged && !nodeBoxChanged) return null;
    const index = orderIndex.get(realForkId);
    return {
      realForkId,
      decisionAtEvaluation: bitName(orientationMap.get(realForkId)),
      evaluationState: index < focusIndex ? "fixed-before-focus"
        : index === focusIndex ? "focus-candidate"
          : "still-unresolved",
      edgeRouteChanged,
      nodeBoxChanged,
    };
  }).filter(Boolean);
}

function intrusionEvaluationTrace(rawView, realize, completion, intrusion, ordinal) {
  const provisionalSignature = intrusionGeometrySignature(intrusion);
  const stateRows = [
    {
      stage: "provisional",
      afterFork: null,
      decision: completion.candidateBit,
      view: completion.provisionalView,
    },
    ...completion.laterStates.map((state) => ({ stage: "after-later-fork", ...state })),
  ].map((state) => {
    const pairIntrusions = unrelatedNodeEdgeIntersections(state.view.routed.routes, state.view.boxes)
      .filter((candidate) => intrusionPairMatches(candidate, intrusion));
    return {
      stage: state.stage,
      afterFork: state.afterFork,
      decision: state.decision,
      pairPresent: pairIntrusions.length > 0,
      exactProvisionalSegmentPresent: pairIntrusions.some((candidate) => intrusionGeometrySignature(candidate) === provisionalSignature),
      pairIntrusions,
    };
  });
  const finalState = stateRows.at(-1);
  const firstPairRemoval = stateRows.slice(1).find((state) => !state.pairPresent) ?? null;
  const firstGeometryChange = stateRows.slice(1).find((state) => !state.exactProvisionalSegmentPresent) ?? null;
  const outcome = finalState.pairPresent
    ? finalState.exactProvisionalSegmentPresent ? "survives-unchanged" : "moves-or-resegments"
    : "disappears";
  return {
    intrusionId: `${intrusion.edgeId} × ${intrusion.nodeId} [segment ${intrusion.segmentIndex}] #${ordinal + 1}`,
    provisional: { ...intrusion },
    edgePath: edgeOwnershipPath(completion.provisionalView, intrusion.edgeId),
    nodePath: nodeOwnershipPath(completion.provisionalView, intrusion.nodeId),
    empiricallyAffectingRealForks: orientationInfluencesForIntrusion(
      rawView,
      realize,
      completion.provisionalMap,
      completion.focusIndex,
      intrusion,
    ),
    outcome,
    firstGeometryChange: firstGeometryChange ? {
      afterFork: firstGeometryChange.afterFork,
      decision: firstGeometryChange.decision,
      pairStillPresent: firstGeometryChange.pairPresent,
      replacementPairIntrusions: firstGeometryChange.pairIntrusions,
    } : null,
    firstRemoval: firstPairRemoval ? {
      afterFork: firstPairRemoval.afterFork,
      decision: firstPairRemoval.decision,
    } : null,
    lifecycle: stateRows,
  };
}

function conciseOrientationCandidate(candidate) {
  return {
    nodeOverlapCount: candidate.nodeOverlapCount,
    properCrossingCount: candidate.properCrossingCount,
    nodeEdgeIntrusionCount: candidate.nodeEdgeIntrusionCount,
    oldProductionCost: candidate.oldProductionCost,
    experimentalCost: candidate.experimentalCost,
  };
}

function completedCandidateReport(rawView, realize, completion) {
  const provisionalIntrusions = completion.provisionalDiagnostics.nodeEdgeIntrusions;
  return {
    focusDecision: completion.candidateBit,
    provisional: {
      orientationMap: namedOrientationMap(completion.provisionalMap),
      nodeOverlapCount: completion.provisionalDiagnostics.nodeOverlapCount,
      nodeOverlaps: completion.provisionalDiagnostics.nodeOverlaps,
      properCrossingCount: completion.provisionalDiagnostics.properCrossingCount,
      properCrossings: completion.provisionalDiagnostics.properCrossings,
      nodeEdgeIntrusionCount: provisionalIntrusions.length,
      nodeEdgeIntrusions: provisionalIntrusions,
    },
    provisionalIntrusionTraces: provisionalIntrusions.map((intrusion, ordinal) =>
      intrusionEvaluationTrace(rawView, realize, completion, intrusion, ordinal)),
    laterOrientationRows: completion.laterRows.map((row) => ({
      realForkId: row.realForkId,
      default: conciseOrientationCandidate(row.default),
      flipped: conciseOrientationCandidate(row.flipped),
      finalDecision: row.finalDecision,
      tieBreakReason: row.tieBreakReason,
    })),
    final: {
      orientationMap: namedOrientationMap(completion.finalMap),
      nodeOverlapCount: completion.finalDiagnostics.nodeOverlapCount,
      nodeOverlaps: completion.finalDiagnostics.nodeOverlaps,
      properCrossingCount: completion.finalDiagnostics.properCrossingCount,
      properCrossings: completion.finalDiagnostics.properCrossings,
      edgeOverlapCount: completion.finalDiagnostics.edgeOverlapCount,
      edgeOverlaps: completion.finalDiagnostics.edgeOverlaps,
      nodeEdgeIntrusionCount: completion.finalDiagnostics.nodeEdgeIntrusionCount,
      nodeEdgeIntrusions: completion.finalDiagnostics.nodeEdgeIntrusions,
    },
  };
}

function compareViewGeometry(baseline, forced, forkId) {
  const boxIds = [...new Set([...baseline.boxes.keys(), ...forced.boxes.keys()])].sort();
  const routeIds = [...new Set([
    ...baseline.routed.routes.map((route) => route.edgeId),
    ...forced.routed.routes.map((route) => route.edgeId),
  ])].sort();
  const changedNodePositions = boxIds
    .map((nodeId) => ({ nodeId, before: exactBoxSnapshot(baseline, nodeId), after: exactBoxSnapshot(forced, nodeId) }))
    .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after));
  const changedRoutes = routeIds
    .map((edgeId) => ({ edgeId, before: exactRouteSnapshot(baseline, edgeId), after: exactRouteSnapshot(forced, edgeId) }))
    .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after));
  const ownedNodeIds = baseline.cfg.nodes
    .filter((node) => baseline.ownership.branchPath(node.id).some((edgeId) => edgeId === `${forkId}-no` || edgeId === `${forkId}-yes`))
    .map((node) => node.id)
    .sort();
  const ownedNodeSet = new Set(ownedNodeIds);
  const relatedRouteIds = new Set(baseline.cfg.edges
    .filter((edge) => edge.from === forkId || ownedNodeSet.has(edge.from) || ownedNodeSet.has(edge.to))
    .map((edge) => edge.id));
  const orientationChanges = baseline.roles.realForkIds
    .filter((id) => bitName(baseline.orientationMap.get(id)) !== bitName(forced.orientationMap.get(id)))
    .map((id) => ({ id, before: bitName(baseline.orientationMap.get(id)), after: bitName(forced.orientationMap.get(id)) }));
  return {
    orientationChanges,
    i22OwnedNodeIds: ownedNodeIds,
    changedNodePositionCount: changedNodePositions.length,
    changedNodePositions,
    changedRouteCount: changedRoutes.length,
    changedRoutes,
    unexpectedChangedNodeIds: changedNodePositions.filter((row) => !ownedNodeSet.has(row.nodeId)).map((row) => row.nodeId),
    unexpectedChangedRouteIds: changedRoutes.filter((row) => !relatedRouteIds.has(row.edgeId)).map((row) => row.edgeId),
  };
}

function compareViewDefects(baseline, forced) {
  const before = diagnosticCatalog(baseline);
  const after = diagnosticCatalog(forced);
  const keyFor = {
    productionDefects: (row) => `${row.defectKind}|${row.nodeA ?? ""}|${row.nodeB ?? ""}|${row.edgeA ?? ""}|${row.edgeB ?? ""}`,
    crossings: (row) => `${row.edgeA}|${row.edgeB}`,
    edgeOverlaps: (row) => `${row.edgeA}|${row.edgeB}`,
    nodeOverlaps: (row) => `${row.nodeA}|${row.nodeB}`,
    unrelatedNodeEdgeIntrusions: (row) => `${row.edgeId}|${row.nodeId}|${row.segmentIndex}`,
    illegalAttachments: (row) => row.edgeId,
  };
  const output = {};
  for (const category of Object.keys(keyFor)) {
    const beforeKeys = new Set(before[category].map(keyFor[category]));
    const afterKeys = new Set(after[category].map(keyFor[category]));
    output[category] = {
      beforeCount: before[category].length,
      afterCount: after[category].length,
      removed: before[category].filter((row) => !afterKeys.has(keyFor[category](row))),
      added: after[category].filter((row) => !beforeKeys.has(keyFor[category](row))),
    };
  }
  return output;
}

export function summarizeView(view) {
  const crossings = crossingDetails(view.routed.routes);
  const edgeOverlaps = edgeOverlapDetails(view.routed.routes);
  const overlaps = nodeOverlapDetails(view.boxes);
  const intrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes);
  const terminalBox = view.boxes.get(view.terminalId);
  const incomingRoutes = view.routed.routes.filter((route) => route.target === view.terminalId);
  const incoming = incomingRoutes.map((route) => {
    const attachment = view.attachments.find((record) => record.edgeId === route.edgeId);
    return {
      edgeId: route.edgeId,
      source: route.source,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      connectorKind: route.connectorKind,
      portPolicyCase: route.portPolicyCase,
      sourcePort: route.sourcePort,
      targetPort: route.targetPort,
      incomingPort: attachment?.target?.portName ?? null,
      attachmentLegal: attachment?.legal ?? null,
      points: route.points,
    };
  });
  const orientation = mapToObject(view.orientationMap);
  const flippedForks = [...view.orientationMap].filter(([, value]) => bitName(value) === "flipped").map(([id]) => id);
  const warnings = {
    cfg: view.cfg.warnings ?? [],
    roles: view.roles.warnings ?? [],
    skeleton: view.skeleton.warnings ?? [],
    lanes: view.lanes.warnings ?? [],
    routing: view.routed.warnings ?? [],
  };
  const rejectionOrFallback = Object.values(warnings).some((rows) => rows.length > 0)
    || view.routed.routes.some((route) => route.legal === false);

  let terminalPlacement;
  if (view.mode === "ordinary") {
    const placingEdgeId = view.cfg.incomingEdgeByNode.get(view.terminalId);
    terminalPlacement = {
      syntheticId: view.terminalId,
      displayLabel: `HALT (${view.terminalId})`,
      kindUsedByLayout: view.cfg.nodeById.get(view.terminalId)?.kind,
      nodeRole: view.roles.nodeRoleById.get(view.terminalId),
      box: terminalBox,
      branchPath: view.ownership.branchPath(view.terminalId),
      owner: view.ownership.ownerOf(view.terminalId),
      parentSource: view.cfg.edgeById.get(placingEdgeId)?.from ?? null,
      placingEdgeId,
      placedOrder: view.cfg.dfsOrder.indexOf(view.terminalId),
      incomingPorts: incoming.map((row) => ({ edgeId: row.edgeId, port: row.incomingPort, point: row.targetPort })),
    };
  } else {
    terminalPlacement = {
      syntheticId: null,
      displayLabel: "HALT",
      kindUsedByLayout: "halt",
      nodeRole: view.roles.nodeRoleById.get("halt"),
      box: terminalBox,
      branchPath: null,
      owner: null,
      parentSource: null,
      placingEdgeId: null,
      placedOrder: null,
      note: "Placed by current special HALT phase, not ordinary traversal.",
      incomingPorts: incoming.map((row) => ({ edgeId: row.edgeId, port: row.incomingPort, point: row.targetPort })),
    };
  }

  return {
    label: view.viewLabel,
    mode: view.mode,
    nodeCount: view.cfg.nodes.length,
    edgeCount: view.cfg.edges.length,
    orientation,
    flippedForks,
    orientationCost: view.defects.total,
    currentProductionStyleCost: view.defects.total,
    intrusionAwareOrientationCost: view.defects.total + intrusions.length,
    properCrossingCount: crossings.length,
    properCrossings: crossings,
    edgeOverlapCount: edgeOverlaps.length,
    edgeOverlaps,
    trueNodeOverlapCount: overlaps.length,
    trueNodeOverlaps: overlaps,
    experimentalNodeEdgeIntrusionCount: intrusions.length,
    unrelatedNodeEdgeIntersections: intrusions,
    attachmentLegality: attachmentLegalitySnapshot(view),
    terminal: terminalPlacement,
    incomingEdges: incoming,
    warnings,
    fallbackOrRejectionFired: rejectionOrFallback,
    experimentalRouteSplice: view.experimentalRouteSplice ?? null,
    experimentalRouteSplices: view.experimentalRouteSplices ?? [],
    i22FlipExperiment: view.i22FlipExperiment ?? null,
    orientationCostExperiment: view.orientationCostExperiment ?? null,
    orientationTransientDiagnosis: view.orientationTransientDiagnosis ?? null,
    completedCandidateOrientationExperiment: view.completedCandidateOrientationExperiment ?? null,
    selfConsistentOrientationExperiment: view.selfConsistentOrientationExperiment ?? null,
    purity: view.purity,
  };
}

export function geometrySignature(view) {
  const placements = [...view.boxes].map(([id, box]) => [id, box]);
  const routes = view.routed.routes.map((route) => [route.edgeId, route.edgeRole, route.routeFamily, route.points]);
  return JSON.stringify({ orientation: mapToObject(view.orientationMap), placements, routes, defects: view.defects });
}

const COLORS = {
  entry: "#94a3b8", setup: "#94a3b8", spine: "#64748b", "branch-exit": "#25324a",
  "merge-connector": "#168466", "loop-return": "#2563eb", halt: "#dc2626", unknown: "#a21caf",
};

const round = (value) => Math.round(value * 1000) / 1000;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function polylineLabelPoint(points) {
  if (!Array.isArray(points) || points.length < 2) return [0, 0];
  const a = points[0], b = points[1];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
  return [mx - (dy / length) * 10, my + (dx / length) * 10];
}

function instructionLabel(view, node) {
  if (node.id === "start") return "START";
  if (node.id === view.terminalId) return view.mode === "ordinary" ? `HALT (${node.id})` : "HALT";
  const instruction = view.program[node.instructionIndex];
  return Array.isArray(instruction) ? `${node.instructionIndex}: ${instruction[0]}(${instruction.slice(1).join(",")})` : node.id;
}

function svgFor(view, scale) {
  const padding = 28;
  const bounds = view.renderBounds;
  const minX = bounds.minX - padding, minY = bounds.minY - padding;
  const width = bounds.width + padding * 2, height = bounds.height + padding * 2;
  const markerId = `arrow-${Math.random().toString(36).slice(2)}`;
  const crossings = crossingDetails(view.routed.routes);
  const overlaps = nodeOverlapDetails(view.boxes);
  const intrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes);
  let body = `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#334155"/></marker></defs>`;

  for (const route of view.routed.routes) {
    const edge = view.cfg.edgeById.get(route.edgeId);
    const points = route.points.map((point) => `${round(point[0])},${round(point[1])}`).join(" ");
    const color = COLORS[route.routeFamily] ?? COLORS.unknown;
    body += `<polyline class="route" points="${points}" stroke="${color}" marker-end="url(#${markerId})"><title>${escapeHtml(`${route.edgeId} · ${route.edgeRole} · ${route.routeFamily}`)}</title></polyline>`;
    if (edge?.branch) {
      const [x, y] = polylineLabelPoint(route.points);
      body += `<text class="edge-label" x="${round(x)}" y="${round(y)}">${escapeHtml(edge.branch.toUpperCase())}</text>`;
    }
    body += `<circle class="overlay-port" cx="${round(route.sourcePort[0])}" cy="${round(route.sourcePort[1])}" r="3" fill="#f59e0b"><title>${escapeHtml(`${route.edgeId} source port`)}</title></circle>`;
    body += `<circle class="overlay-port" cx="${round(route.targetPort[0])}" cy="${round(route.targetPort[1])}" r="3" fill="#10b981"><title>${escapeHtml(`${route.edgeId} target port`)}</title></circle>`;
  }

  for (const node of view.cfg.nodes) {
    const box = view.boxes.get(node.id);
    if (!box) continue;
    const isDiamond = node.kind === "conditionalJump";
    const isCurrentTerminal = view.mode === "current" && node.id === "halt";
    const isSynthetic = view.mode === "ordinary" && node.id === view.terminalId;
    const fill = isSynthetic ? "#fff7d6" : isCurrentTerminal ? "#fee2e2" : node.id === "start" ? "#e8eef7" : "#fff";
    if (isDiamond) {
      body += `<polygon points="${box.cx},${box.top} ${box.right},${box.cy} ${box.cx},${box.bottom} ${box.left},${box.cy}" fill="${fill}" stroke="#172033" stroke-width="1.2"/>`;
    } else {
      const radius = isCurrentTerminal || node.id === "start" ? 9 : 1;
      body += `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="${radius}" fill="${fill}" stroke="#172033" stroke-width="1.1"/>`;
    }
    const label = instructionLabel(view, node);
    body += `<text class="node-label" x="${box.cx}" y="${box.cy - (isSynthetic ? 3 : 0)}">${escapeHtml(label)}</text>`;
    if (isSynthetic) body += `<text class="node-id" x="${box.cx}" y="${box.cy + 8}">ordinary action geometry</text>`;
  }

  for (const crossing of crossings) {
    body += `<g class="overlay-crossing"><circle cx="${crossing.point[0]}" cy="${crossing.point[1]}" r="7" fill="#ef4444" opacity="0.75"/><circle cx="${crossing.point[0]}" cy="${crossing.point[1]}" r="3" fill="#fff"/><title>${escapeHtml(`${crossing.edgeA} × ${crossing.edgeB}`)}</title></g>`;
  }
  for (const overlap of overlaps) {
    const a = view.boxes.get(overlap.nodeA), b = view.boxes.get(overlap.nodeB);
    const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top);
    body += `<rect class="overlay-overlap" x="${x}" y="${y}" width="${overlap.overlapX}" height="${overlap.overlapY}" fill="#d946ef" opacity="0.55"><title>${escapeHtml(`${overlap.nodeA} overlaps ${overlap.nodeB}`)}</title></rect>`;
  }
  for (const intrusion of intrusions) {
    const box = intrusion.nodeBox;
    const [intervalStart, intervalEnd] = intrusion.intersectionInterval;
    const midpoint = [(intervalStart[0] + intervalEnd[0]) / 2, (intervalStart[1] + intervalEnd[1]) / 2];
    const title = `${intrusion.edgeId} × ${intrusion.nodeId} · ${intrusion.penetrationKind}`;
    body += `<g class="overlay-intrusion">`
      + `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" fill="#f97316" fill-opacity="0.18" stroke="#ea580c" stroke-width="3" stroke-dasharray="6 3"><title>${escapeHtml(title)}</title></rect>`
      + `<line x1="${intrusion.segmentStart[0]}" y1="${intrusion.segmentStart[1]}" x2="${intrusion.segmentEnd[0]}" y2="${intrusion.segmentEnd[1]}" stroke="#fb923c" stroke-width="5" stroke-opacity="0.65"><title>${escapeHtml(title)}</title></line>`
      + `<line x1="${intervalStart[0]}" y1="${intervalStart[1]}" x2="${intervalEnd[0]}" y2="${intervalEnd[1]}" stroke="#dc2626" stroke-width="7"><title>${escapeHtml(title)}</title></line>`
      + `<circle cx="${midpoint[0]}" cy="${midpoint[1]}" r="5" fill="#fff" stroke="#991b1b" stroke-width="3"><title>${escapeHtml(title)}</title></circle>`
      + `</g>`;
  }

  return `<svg viewBox="${minX} ${minY} ${width} ${height}" width="${Math.ceil(width * scale)}" height="${Math.ceil(height * scale)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function reportText(summary) {
  return JSON.stringify(summary, null, 2);
}

function cardFor(view, scale) {
  const summary = summarizeView(view);
  const pairs = summary.properCrossings.length
    ? summary.properCrossings.map((row) => `${row.edgeA} × ${row.edgeB}`).join(", ")
    : "none";
  const provenance = view.viewerProvenance
    ? `<div class="provenance">${escapeHtml(view.viewerProvenance)}</div>`
    : "";
  const article = document.createElement("article");
  article.innerHTML = `<h2>${escapeHtml(summary.label)}</h2>`
    + provenance
    + `<div class="summary">nodes ${summary.nodeCount} · edges ${summary.edgeCount} · production-style cost ${summary.currentProductionStyleCost} · intrusion-aware cost ${summary.intrusionAwareOrientationCost} · crossings ${summary.properCrossingCount} (${escapeHtml(pairs)}) · edge overlaps ${summary.edgeOverlapCount} · node overlaps ${summary.trueNodeOverlapCount} · experimental node–edge intrusions ${summary.experimentalNodeEdgeIntrusionCount} · flips [${escapeHtml(summary.flippedForks.join(", ") || "none")}]</div>`
    + `<div class="canvas">${svgFor(view, scale)}</div>`
    + `<details><summary>Exact diagnostics</summary><pre>${escapeHtml(reportText(summary))}</pre></details>`;
  return article;
}

async function startViewer() {
  const status = document.querySelector("#status");
  const fixtureSelect = document.querySelector("#fixture");
  const viewsNode = document.querySelector("#views");
  const scaleInput = document.querySelector("#scale");
  const scaleValue = document.querySelector("#scale-value");
  const viewerTitle = document.querySelector("#viewer-title");
  const currentViewLink = document.querySelector("#current-view-link");
  const historyViewLink = document.querySelector("#history-view-link");
  const outwardStubViewLink = document.querySelector("#outward-stub-view-link");
  const sourcePortViewLink = document.querySelector("#source-port-view-link");
  const loopSourceRuleViewLink = document.querySelector("#loop-source-rule-view-link");
  const loopSourceCompositionViewLink = document.querySelector("#loop-source-composition-view-link");
  const i52UpperLeftTargetViewLink = document.querySelector("#i52-upper-left-target-view-link");
  const i52UpperLeftRayViewLink = document.querySelector("#i52-upper-left-ray-view-link");
  const loopTargetGeneralizationViewLink = document.querySelector("#loop-target-generalization-view-link");
  const loopEndpointCompositionViewLink = document.querySelector("#loop-endpoint-composition-view-link");
  const i22FlipViewLink = document.querySelector("#i22-flip-view-link");
  const intrusionCostViewLink = document.querySelector("#intrusion-cost-view-link");
  const transientDiagnosisViewLink = document.querySelector("#transient-diagnosis-view-link");
  const completedCandidateViewLink = document.querySelector("#completed-candidate-view-link");
  const selfConsistentViewLink = document.querySelector("#self-consistent-view-link");
  const fixtureControl = document.querySelector("#fixture-control");
  const programs = await fetch(new URL("../.sketchv3-harness/programs.json", import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`fixture load failed: ${response.status}`);
    return response.json();
  });
  const query = new URLSearchParams(location.search);
  const historyMode = query.get("view") === "history";
  const outwardStubMode = query.get("view") === "outward-source-stubs";
  const sourcePortMode = query.get("view") === "loop-source-ports";
  const loopSourceRuleMode = query.get("view") === "loop-source-generalization";
  const loopSourceCompositionMode = query.get("view") === "loop-source-composition";
  const i52UpperLeftTargetMode = query.get("view") === "i52-upper-left-target";
  const i52UpperLeftRayMode = query.get("view") === "i52-upper-left-ray";
  const loopTargetGeneralizationMode = query.get("view") === "loop-target-generalization";
  const loopEndpointCompositionMode = query.get("view") === "loop-endpoint-composition";
  const i22FlipMode = query.get("view") === "i22-flip";
  const intrusionCostMode = query.get("view") === "intrusion-aware-orientation";
  const transientDiagnosisMode = query.get("view") === "orientation-transient-diagnosis";
  const completedCandidateMode = query.get("view") === "completed-candidate-orientation";
  const selfConsistentMode = query.get("view") === "self-consistent-orientation";
  const selfConsistentProbeReport = selfConsistentMode
    ? await fetch(new URL("./self_consistent_completed_candidate_probe.json", import.meta.url)).then((response) => {
      if (!response.ok) throw new Error(`self-consistent report load failed: ${response.status}`);
      return response.json();
    })
    : null;
  if (i22FlipMode || intrusionCostMode || transientDiagnosisMode || completedCandidateMode || selfConsistentMode) scaleInput.value = "0.55";
  const historicalFixtureNames = ["minimization:bounded_sub", "characteristic:divides", "characteristic:eq", "primrec:basic", "predecessor"];
  const fixtureNames = i22FlipMode ? ["minimization:bounded_sub"]
    : transientDiagnosisMode ? ["minimization:bounded_sub", "characteristic:divides"]
    : outwardStubMode || sourcePortMode || i52UpperLeftTargetMode || i52UpperLeftRayMode ? ["characteristic:divides"]
      : historicalFixtureNames;
  for (const name of fixtureNames) {
    if (!programs[name]) continue;
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    fixtureSelect.append(option);
  }
  const requested = query.get("fixture");
  fixtureSelect.value = fixtureNames.includes(requested) ? requested
    : historyMode ? "minimization:bounded_sub"
      : i22FlipMode ? "minimization:bounded_sub"
        : "characteristic:divides";
  fixtureControl.hidden = i22FlipMode || outwardStubMode || sourcePortMode || i52UpperLeftTargetMode || i52UpperLeftRayMode;
  viewerTitle.textContent = historyMode ? "SketchV4: historical ordinary-HALT experiments"
    : outwardStubMode ? "SketchV4: i-27/i-52 outward source-stub experiment"
      : sourcePortMode ? "SketchV4: i-27/i-52 source-port comparison"
        : loopSourceRuleMode ? "SketchV4: generalized backward-loop source-port probe"
          : loopSourceCompositionMode ? "SketchV4: composed loop-source candidate"
            : i52UpperLeftTargetMode ? "SketchV4: i-52 upper-left target-attachment probe"
              : i52UpperLeftRayMode ? "SketchV4: i-52 upper-left target-ray refinement"
                : loopTargetGeneralizationMode ? "SketchV4: generalized backward-loop target-attachment probe"
                  : loopEndpointCompositionMode ? "SketchV4: composed backward-loop endpoint candidate"
                    : i22FlipMode ? "SketchV4: bounded_sub i-22 orientation flip"
                      : intrusionCostMode ? "SketchV4: intrusion-aware orientation-cost generalization"
                        : transientDiagnosisMode ? "SketchV4: provisional-vs-completed orientation diagnosis"
                          : completedCandidateMode ? "SketchV4: completed-candidate orientation generalization"
                            : selfConsistentMode ? "SketchV4: self-consistent recursive orientation"
                        : "SketchV4: current ordinary-HALT baseline";
  document.title = historyMode ? "SketchV4 ordinary-HALT experiment history"
    : outwardStubMode ? "SketchV4 i-27/i-52 outward source-stub experiment"
      : sourcePortMode ? "SketchV4 i-27/i-52 source-port comparison"
        : loopSourceRuleMode ? "SketchV4 generalized backward-loop source-port probe"
          : loopSourceCompositionMode ? "SketchV4 composed loop-source candidate"
            : i52UpperLeftTargetMode ? "SketchV4 i-52 upper-left target-attachment probe"
              : i52UpperLeftRayMode ? "SketchV4 i-52 upper-left target-ray refinement"
                : loopTargetGeneralizationMode ? "SketchV4 generalized backward-loop target-attachment probe"
                  : loopEndpointCompositionMode ? "SketchV4 composed backward-loop endpoint candidate"
                    : i22FlipMode ? "SketchV4 bounded_sub i-22 orientation flip"
                      : intrusionCostMode ? "SketchV4 intrusion-aware orientation-cost generalization"
                        : transientDiagnosisMode ? "SketchV4 provisional-vs-completed orientation diagnosis"
                          : completedCandidateMode ? "SketchV4 completed-candidate orientation generalization"
                            : selfConsistentMode ? "SketchV4 self-consistent recursive orientation"
                        : "SketchV4 current ordinary-HALT baseline";
  for (const [link, active] of [
    [currentViewLink, !historyMode && !outwardStubMode && !sourcePortMode && !loopSourceRuleMode && !loopSourceCompositionMode && !i52UpperLeftTargetMode && !i52UpperLeftRayMode && !loopTargetGeneralizationMode && !loopEndpointCompositionMode && !i22FlipMode && !intrusionCostMode && !transientDiagnosisMode && !completedCandidateMode && !selfConsistentMode],
    [historyViewLink, historyMode],
    [outwardStubViewLink, outwardStubMode],
    [sourcePortViewLink, sourcePortMode],
    [loopSourceRuleViewLink, loopSourceRuleMode],
    [loopSourceCompositionViewLink, loopSourceCompositionMode],
    [i52UpperLeftTargetViewLink, i52UpperLeftTargetMode],
    [i52UpperLeftRayViewLink, i52UpperLeftRayMode],
    [loopTargetGeneralizationViewLink, loopTargetGeneralizationMode],
    [loopEndpointCompositionViewLink, loopEndpointCompositionMode],
    [i22FlipViewLink, i22FlipMode],
    [intrusionCostViewLink, intrusionCostMode],
    [transientDiagnosisViewLink, transientDiagnosisMode],
    [completedCandidateViewLink, completedCandidateMode],
    [selfConsistentViewLink, selfConsistentMode],
  ]) {
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  let rendered = [];
  const build = () => {
    const name = fixtureSelect.value;
    const program = programs[name];
    if (historyMode) {
      const current = buildCurrentView(program, name);
      const experiment = buildOrdinaryTerminalViews(program, name, name === "minimization:bounded_sub" ? "i-22" : null);
      const rawRoles = buildRawRoleOrdinaryTerminalView(program, name);
      const forcedI25Default = name === "characteristic:divides" ? buildRawRoleForcedDefaultView(rawRoles, "i-25") : null;
      const i57RightToRight = name === "characteristic:divides" ? buildI57RightToRightHvhDiagnosticViews(rawRoles, "i-25") : null;
      const i57RightPort = name === "characteristic:divides" ? buildI57RightPortDiagnosticViews(rawRoles, "i-25") : null;
      const i57LeftPort = name === "characteristic:divides" ? buildI57LeftPortDiagnosticViews(rawRoles, "i-25") : null;
      const generalized = buildBranchPreservingMergeSourcesView(rawRoles);
      const shortStub = buildShortBranchStubMergeSourcesView(rawRoles);
      const adaptive = buildAdaptiveBranchRayMergeSourcesView(rawRoles);
      const adaptiveRightReentry = name === "characteristic:divides" ? buildAdaptiveRightReentryDiagnosticView(rawRoles, "i-25") : null;
      const branchPreserving = name === "predecessor" ? buildBranchPreservingMergeSourceView(rawRoles) : null;
      const yesRayVerticalHorizontal = name === "predecessor" ? buildYesRayVerticalHorizontalMergeView(rawRoles) : null;
      const preLoopSourceBaseline = adaptiveRightReentry?.view ?? adaptive;
      const outwardSourceStub = name === "characteristic:divides" ? buildI27I52OutwardSourceStubView(preLoopSourceBaseline) : null;
      const sourcePortComparison = name === "characteristic:divides" ? buildI27I52SourcePortComparisonViews(preLoopSourceBaseline) : null;
      const generalizedLoopSources = buildGeneralizedLoopSourcePortView(preLoopSourceBaseline);
      const composedLoopSources = buildComposedLoopSourceCandidate(rawRoles).view;
      const i52UpperLeftTarget = name === "characteristic:divides"
        ? buildI52UpperLeftTargetAttachmentView(composedLoopSources)
        : null;
      const i52UpperLeftRay = name === "characteristic:divides"
        ? buildI52UpperLeftTargetRayIntersectionView(composedLoopSources)
        : null;
      const generalizedLoopTargets = buildGeneralizedLoopTargetAttachmentView(composedLoopSources);
      const composedLoopEndpoints = buildComposedLoopEndpointCandidate(rawRoles).view;
      if (name === "predecessor") experiment.normal.viewLabel = "Ordinary HALT — hybrid";
      rendered = [
        current,
        experiment.normal,
        ...(experiment.forced ? [experiment.forced] : []),
        rawRoles,
        ...(forcedI25Default ? [forcedI25Default] : []),
        ...(i57RightToRight ? [i57RightToRight.forcedDefault, i57RightToRight.automatic] : []),
        ...(i57RightPort ? [i57RightPort.forcedDefault, i57RightPort.automatic] : []),
        ...(i57LeftPort ? [i57LeftPort.forcedDefault, i57LeftPort.automatic] : []),
        generalized,
        shortStub,
        adaptive,
        ...(branchPreserving ? [branchPreserving] : []),
        ...(yesRayVerticalHorizontal ? [yesRayVerticalHorizontal] : []),
        ...(adaptiveRightReentry ? [adaptiveRightReentry.view] : []),
        ...(outwardSourceStub ? [outwardSourceStub] : []),
        ...(sourcePortComparison ? [
          sourcePortComparison.i27.side,
          sourcePortComparison.i27.bottom,
          sourcePortComparison.i52.side,
          sourcePortComparison.i52.bottom,
        ] : []),
        generalizedLoopSources,
        composedLoopSources,
        ...(i52UpperLeftTarget ? [i52UpperLeftTarget] : []),
        ...(i52UpperLeftRay ? [i52UpperLeftRay] : []),
        generalizedLoopTargets,
        composedLoopEndpoints,
      ];
    } else {
      const rawRoles = buildRawRoleOrdinaryTerminalView(program, name);
      const preLoopSourceBaseline = name === "characteristic:divides"
        ? buildAdaptiveRightReentryDiagnosticView(rawRoles, "i-25").view
        : buildAdaptiveBranchRayMergeSourcesView(rawRoles);
      if (selfConsistentMode) {
        const fixtureReport = selfConsistentProbeReport.fixtureReports.find((row) => row.fixture === name);
        const comparison = buildSelfConsistentCompletedCandidateViewerViews(rawRoles, fixtureReport);
        rendered = [comparison.baseline, comparison.provisional, comparison.oneStep, comparison.recursive];
      } else if (completedCandidateMode) {
        const comparison = buildCompletedCandidateOrientationComparisonViews(rawRoles);
        rendered = [comparison.baseline, comparison.provisional, comparison.completed];
      } else if (transientDiagnosisMode) {
        const diagnosis = buildOrientationTransientDefectDiagnosisViews(rawRoles);
        rendered = [
          diagnosis.provisionalDefault,
          diagnosis.completedDefault,
          diagnosis.provisionalFlipped,
          diagnosis.completedFlipped,
        ];
      } else if (intrusionCostMode) {
        const comparison = buildIntrusionAwareOrientationComparisonViews(rawRoles);
        rendered = [comparison.baseline, comparison.experimental];
      } else if (i22FlipMode) {
        const comparison = buildBoundedSubI22FlipComparisonViews(rawRoles);
        rendered = [comparison.baseline, comparison.forced];
      } else if (outwardStubMode) {
        const outwardStubExperiment = buildI27I52OutwardSourceStubView(preLoopSourceBaseline);
        preLoopSourceBaseline.viewerProvenance = "Control: current combined baseline; no outward source stubs.";
        outwardStubExperiment.viewerProvenance = "Experiment: unchanged combined baseline + 16px outward source stubs on i-27-jump and i-52-jump only.";
        rendered = [preLoopSourceBaseline, outwardStubExperiment];
      } else if (sourcePortMode) {
        const comparison = buildI27I52SourcePortComparisonViews(preLoopSourceBaseline);
        comparison.i27.side.viewerProvenance = "i-27 Variant A: unchanged left port + 16px westward stub; only i-27-jump changed.";
        comparison.i27.bottom.viewerProvenance = "i-27 Variant B: bottom-center port + vertical departure; only i-27-jump changed.";
        comparison.i52.side.viewerProvenance = "i-52 Variant A: unchanged left port + 16px westward stub; only i-52-jump changed.";
        comparison.i52.bottom.viewerProvenance = "i-52 Variant B: bottom-center port + vertical departure; only i-52-jump changed.";
        rendered = [comparison.i27.side, comparison.i27.bottom, comparison.i52.side, comparison.i52.bottom];
      } else if (loopSourceRuleMode) {
        const generalized = buildGeneralizedLoopSourcePortView(preLoopSourceBaseline);
        preLoopSourceBaseline.viewerProvenance = name === "characteristic:divides"
          ? "Control: current adaptive-merges + divides-only right-side-reentry baseline."
          : "Control: current adaptive-merges baseline; no right-side-reentry rule is applied.";
        generalized.viewerProvenance = "Probe: every backward loop is classified structurally; vertical-first uses bottom-center, lateral-first retains its existing outward side departure. No repair or winner selection.";
        rendered = [preLoopSourceBaseline, generalized];
      } else if (loopSourceCompositionMode) {
        const composed = buildComposedLoopSourceCandidate(rawRoles).view;
        preLoopSourceBaseline.viewerProvenance = name === "characteristic:divides"
          ? "Control: current adaptive-merges + divides-only right-side-reentry baseline with its existing orientation map."
          : "Control: current adaptive-merges baseline with its existing orientation map.";
        composed.viewerProvenance = name === "characteristic:divides"
          ? "Candidate: adaptive merges + divides-only i-57 right-side reentry + generalized loop sources, with normal unpinned orientation selection rerun over the complete geometry."
          : "Candidate: adaptive merges + generalized loop sources, with normal unpinned orientation selection rerun over the complete geometry.";
        rendered = [preLoopSourceBaseline, composed];
      } else if (i52UpperLeftTargetMode) {
        const currentBaseline = buildComposedLoopSourceCandidate(rawRoles).view;
        const upperLeftTarget = buildI52UpperLeftTargetAttachmentView(currentBaseline);
        currentBaseline.viewerProvenance = "Control: checkpointed composed baseline; i-52-jump retains its deliberately illegal left-center target attachment.";
        upperLeftTarget.viewerProvenance = "Experiment: only i-52-jump's final target approach changes to the declared V4 upper-left diamond port through a local 16px diagonal dogleg.";
        rendered = [currentBaseline, upperLeftTarget];
      } else if (i52UpperLeftRayMode) {
        const currentBaseline = buildComposedLoopSourceCandidate(rawRoles).view;
        const upperLeftDogleg = buildI52UpperLeftTargetAttachmentView(currentBaseline);
        const upperLeftRay = buildI52UpperLeftTargetRayIntersectionView(currentBaseline);
        currentBaseline.viewerProvenance = "Control: checkpointed composed baseline; i-52-jump retains its deliberately illegal left-center target attachment.";
        upperLeftDogleg.viewerProvenance = "Previous probe: V4 upper-left target port through a local fixed-16px H/V/diagonal dogleg.";
        upperLeftRay.viewerProvenance = "Refinement: V4 upper-left target port; its incident ray extends directly back to the unchanged horizontal approach row, with no fixed-length stub.";
        rendered = [currentBaseline, upperLeftDogleg, upperLeftRay];
      } else if (loopTargetGeneralizationMode) {
        const currentBaseline = buildComposedLoopSourceCandidate(rawRoles).view;
        const generalizedTargets = buildGeneralizedLoopTargetAttachmentView(currentBaseline);
        currentBaseline.viewerProvenance = "Control: checkpointed composed baseline with fixed orientation and unchanged loop targets.";
        generalizedTargets.viewerProvenance = "Probe: legal loop targets remain byte-identical; each illegal target changes only when exactly one declared diagonal port ray meets its existing directed approach segment.";
        rendered = [currentBaseline, generalizedTargets];
      } else if (loopEndpointCompositionMode) {
        const currentBaseline = buildComposedLoopSourceCandidate(rawRoles).view;
        const endpointCandidate = buildComposedLoopEndpointCandidate(rawRoles).view;
        currentBaseline.viewerProvenance = "Control: checkpointed composed loop-source baseline with its normal unpinned orientation selection.";
        endpointCandidate.viewerProvenance = "Candidate: generalized loop sources and targets are both active inside a fresh normal unpinned orientation pass; no post-selection repair.";
        rendered = [currentBaseline, endpointCandidate];
      } else {
        const currentBaseline = buildComposedLoopEndpointCandidate(rawRoles).view;
        currentBaseline.viewerProvenance = name === "characteristic:divides"
          ? "Current baseline: adaptive merges + divides-only i-57 right-side reentry + generalized backward-loop source and target attachments; normal orientation selection rerun over the complete geometry."
          : "Current baseline: adaptive merges + generalized backward-loop source and target attachments; normal orientation selection rerun over the complete geometry.";
        rendered = [currentBaseline];
      }
    }
    draw();
    status.textContent = historyMode ? `${name}: historical production control plus ${rendered.length - 1} harness-only ordinary-terminal realization${rendered.length === 2 ? "" : "s"}. No production module is mutated.`
      : outwardStubMode ? `${name}: current combined control plus one two-edge outward-source-stub experiment. No production module is mutated.`
        : sourcePortMode ? `${name}: four independent one-edge side-vs-bottom source-port variants over the current combined baseline. No winner is selected.`
          : loopSourceRuleMode ? `${name}: current baseline plus one fixture-wide backward-loop source-port generalization probe. No production module is mutated.`
            : loopSourceCompositionMode ? `${name}: current baseline plus one fully composed, normally reoriented loop-source candidate. No production module is mutated.`
              : i52UpperLeftTargetMode ? `${name}: checkpointed composed control plus one i-52 target-attachment splice. No production module is mutated.`
                : i52UpperLeftRayMode ? `${name}: checkpointed control, previous i-52 dogleg, and direct target-ray refinement. No production module is mutated.`
                  : loopTargetGeneralizationMode ? `${name}: checkpointed control plus one generalized backward-loop target-attachment probe. No production module is mutated.`
                    : loopEndpointCompositionMode ? `${name}: checkpointed loop-source control plus one fully composed, normally reoriented loop-endpoint candidate. No production module is mutated.`
                      : i22FlipMode ? `${name}: exact checkpoint baseline plus one explicit i-22-only forced-flipped realization. Production cost and production modules are unchanged.`
                        : intrusionCostMode ? `${name}: normal unpinned orientation selection from scratch under current cost versus intrusion-aware unit cost. Geometry rules and production modules are unchanged.`
                          : transientDiagnosisMode ? `${name}: exact provisional default/flipped focus candidates followed by normal selection of only the unresolved suffix. Metric and production modules are unchanged; no repair is applied.`
                            : completedCandidateMode ? `${name}: checkpoint, provisional intrusion-aware, and one-step completed-candidate selectors over identical geometry. Temporary completion uses production orientation policy; no recursion, repair, or production mutation.`
                              : selfConsistentMode ? `${name}: checkpoint, failed provisional, successful one-step, and exact self-consistent recursive selectors. Exhaustive enumeration is diagnostic-only; no repair or production mutation.`
                          : `${name}: promoted harness-only ordinary-terminal baseline. No production module is mutated.`;
    const currentQuery = new URLSearchParams({ fixture: name });
    const historyQuery = new URLSearchParams({ view: "history", fixture: name });
    const outwardStubQuery = new URLSearchParams({ view: "outward-source-stubs", fixture: "characteristic:divides" });
    const sourcePortQuery = new URLSearchParams({ view: "loop-source-ports", fixture: "characteristic:divides" });
    const loopSourceRuleQuery = new URLSearchParams({ view: "loop-source-generalization", fixture: name });
    const loopSourceCompositionQuery = new URLSearchParams({ view: "loop-source-composition", fixture: name });
    const i52UpperLeftTargetQuery = new URLSearchParams({ view: "i52-upper-left-target", fixture: "characteristic:divides" });
    const i52UpperLeftRayQuery = new URLSearchParams({ view: "i52-upper-left-ray", fixture: "characteristic:divides" });
    const loopTargetGeneralizationQuery = new URLSearchParams({ view: "loop-target-generalization", fixture: name });
    const loopEndpointCompositionQuery = new URLSearchParams({ view: "loop-endpoint-composition", fixture: name });
    const i22FlipQuery = new URLSearchParams({ view: "i22-flip", fixture: "minimization:bounded_sub" });
    const intrusionCostQuery = new URLSearchParams({ view: "intrusion-aware-orientation", fixture: name });
    const transientDiagnosisQuery = new URLSearchParams({ view: "orientation-transient-diagnosis", fixture: name });
    const completedCandidateQuery = new URLSearchParams({ view: "completed-candidate-orientation", fixture: name });
    const selfConsistentQuery = new URLSearchParams({ view: "self-consistent-orientation", fixture: name });
    currentViewLink.href = `${location.pathname}?${currentQuery}`;
    historyViewLink.href = `${location.pathname}?${historyQuery}`;
    outwardStubViewLink.href = `${location.pathname}?${outwardStubQuery}`;
    sourcePortViewLink.href = `${location.pathname}?${sourcePortQuery}`;
    loopSourceRuleViewLink.href = `${location.pathname}?${loopSourceRuleQuery}`;
    loopSourceCompositionViewLink.href = `${location.pathname}?${loopSourceCompositionQuery}`;
    i52UpperLeftTargetViewLink.href = `${location.pathname}?${i52UpperLeftTargetQuery}`;
    i52UpperLeftRayViewLink.href = `${location.pathname}?${i52UpperLeftRayQuery}`;
    loopTargetGeneralizationViewLink.href = `${location.pathname}?${loopTargetGeneralizationQuery}`;
    loopEndpointCompositionViewLink.href = `${location.pathname}?${loopEndpointCompositionQuery}`;
    i22FlipViewLink.href = `${location.pathname}?${i22FlipQuery}`;
    intrusionCostViewLink.href = `${location.pathname}?${intrusionCostQuery}`;
    transientDiagnosisViewLink.href = `${location.pathname}?${transientDiagnosisQuery}`;
    completedCandidateViewLink.href = `${location.pathname}?${completedCandidateQuery}`;
    selfConsistentViewLink.href = `${location.pathname}?${selfConsistentQuery}`;
    const activeQuery = historyMode ? historyQuery
      : outwardStubMode ? outwardStubQuery
        : sourcePortMode ? sourcePortQuery
          : loopSourceRuleMode ? loopSourceRuleQuery
            : loopSourceCompositionMode ? loopSourceCompositionQuery
              : i52UpperLeftTargetMode ? i52UpperLeftTargetQuery
                : i52UpperLeftRayMode ? i52UpperLeftRayQuery
                  : loopTargetGeneralizationMode ? loopTargetGeneralizationQuery
                    : loopEndpointCompositionMode ? loopEndpointCompositionQuery
                      : i22FlipMode ? i22FlipQuery
                        : intrusionCostMode ? intrusionCostQuery
                          : transientDiagnosisMode ? transientDiagnosisQuery
                            : completedCandidateMode ? completedCandidateQuery
                              : selfConsistentMode ? selfConsistentQuery
                          : currentQuery;
    window.history.replaceState(null, "", `${location.pathname}?${activeQuery}`);
  };
  const draw = () => {
    const scale = Number(scaleInput.value);
    scaleValue.textContent = `${scale.toFixed(2)}×`;
    viewsNode.replaceChildren(...rendered.map((view) => cardFor(view, scale)));
  };
  fixtureSelect.addEventListener("change", build);
  scaleInput.addEventListener("input", draw);
  for (const id of ["crossings", "overlaps", "intrusions", "ports"]) {
    document.querySelector(`#${id}`).addEventListener("change", (event) => document.body.classList.toggle(`show-${id}`, event.target.checked));
  }
  build();
}

if (typeof document !== "undefined") {
  startViewer().catch((error) => {
    const status = document.querySelector("#status");
    status.className = "error";
    status.textContent = error?.stack ?? String(error);
  });
}
