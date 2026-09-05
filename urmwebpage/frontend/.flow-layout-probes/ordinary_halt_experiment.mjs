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
import { validateEdgeAttachments } from "../src/layout/sketchv4/attachmentStubs.js";
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
    properCrossingCount: crossings.length,
    properCrossings: crossings,
    edgeOverlapCount: edgeOverlaps.length,
    edgeOverlaps,
    trueNodeOverlapCount: overlaps.length,
    trueNodeOverlaps: overlaps,
    experimentalNodeEdgeIntrusionCount: intrusions.length,
    unrelatedNodeEdgeIntersections: intrusions,
    terminal: terminalPlacement,
    incomingEdges: incoming,
    warnings,
    fallbackOrRejectionFired: rejectionOrFallback,
    experimentalRouteSplice: view.experimentalRouteSplice ?? null,
    experimentalRouteSplices: view.experimentalRouteSplices ?? [],
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
  return JSON.stringify(summary, (key, value) => typeof value === "number" ? round(value) : value, 2);
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
    + `<div class="summary">nodes ${summary.nodeCount} · edges ${summary.edgeCount} · production-style cost ${summary.currentProductionStyleCost} · crossings ${summary.properCrossingCount} (${escapeHtml(pairs)}) · edge overlaps ${summary.edgeOverlapCount} · node overlaps ${summary.trueNodeOverlapCount} · experimental node–edge intrusions ${summary.experimentalNodeEdgeIntrusionCount} · flips [${escapeHtml(summary.flippedForks.join(", ") || "none")}]</div>`
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
  const historicalFixtureNames = ["minimization:bounded_sub", "characteristic:divides", "characteristic:eq", "primrec:basic", "predecessor"];
  const fixtureNames = outwardStubMode || sourcePortMode ? ["characteristic:divides"] : historicalFixtureNames;
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
      : "characteristic:divides";
  fixtureControl.hidden = outwardStubMode || sourcePortMode;
  viewerTitle.textContent = historyMode ? "SketchV4: historical ordinary-HALT experiments"
    : outwardStubMode ? "SketchV4: i-27/i-52 outward source-stub experiment"
      : sourcePortMode ? "SketchV4: i-27/i-52 source-port comparison"
        : loopSourceRuleMode ? "SketchV4: generalized backward-loop source-port probe"
          : loopSourceCompositionMode ? "SketchV4: composed loop-source candidate"
            : "SketchV4: current ordinary-HALT baseline";
  document.title = historyMode ? "SketchV4 ordinary-HALT experiment history"
    : outwardStubMode ? "SketchV4 i-27/i-52 outward source-stub experiment"
      : sourcePortMode ? "SketchV4 i-27/i-52 source-port comparison"
        : loopSourceRuleMode ? "SketchV4 generalized backward-loop source-port probe"
          : loopSourceCompositionMode ? "SketchV4 composed loop-source candidate"
            : "SketchV4 current ordinary-HALT baseline";
  for (const [link, active] of [
    [currentViewLink, !historyMode && !outwardStubMode && !sourcePortMode && !loopSourceRuleMode && !loopSourceCompositionMode],
    [historyViewLink, historyMode],
    [outwardStubViewLink, outwardStubMode],
    [sourcePortViewLink, sourcePortMode],
    [loopSourceRuleViewLink, loopSourceRuleMode],
    [loopSourceCompositionViewLink, loopSourceCompositionMode],
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
      ];
    } else {
      const rawRoles = buildRawRoleOrdinaryTerminalView(program, name);
      const preLoopSourceBaseline = name === "characteristic:divides"
        ? buildAdaptiveRightReentryDiagnosticView(rawRoles, "i-25").view
        : buildAdaptiveBranchRayMergeSourcesView(rawRoles);
      if (outwardStubMode) {
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
      } else {
        const currentBaseline = buildComposedLoopSourceCandidate(rawRoles).view;
        currentBaseline.viewerProvenance = name === "characteristic:divides"
          ? "Current baseline: adaptive merges + divides-only i-57 right-side reentry + generalized backward-loop source attachment; normal orientation selection rerun over the complete geometry."
          : "Current baseline: adaptive merges + generalized backward-loop source attachment; normal orientation selection rerun over the complete geometry.";
        rendered = [currentBaseline];
      }
    }
    draw();
    status.textContent = historyMode ? `${name}: historical production control plus ${rendered.length - 1} harness-only ordinary-terminal realization${rendered.length === 2 ? "" : "s"}. No production module is mutated.`
      : outwardStubMode ? `${name}: current combined control plus one two-edge outward-source-stub experiment. No production module is mutated.`
        : sourcePortMode ? `${name}: four independent one-edge side-vs-bottom source-port variants over the current combined baseline. No winner is selected.`
          : loopSourceRuleMode ? `${name}: current baseline plus one fixture-wide backward-loop source-port generalization probe. No production module is mutated.`
            : loopSourceCompositionMode ? `${name}: current baseline plus one fully composed, normally reoriented loop-source candidate. No production module is mutated.`
              : `${name}: promoted harness-only ordinary-terminal baseline. No production module is mutated.`;
    const currentQuery = new URLSearchParams({ fixture: name });
    const historyQuery = new URLSearchParams({ view: "history", fixture: name });
    const outwardStubQuery = new URLSearchParams({ view: "outward-source-stubs", fixture: "characteristic:divides" });
    const sourcePortQuery = new URLSearchParams({ view: "loop-source-ports", fixture: "characteristic:divides" });
    const loopSourceRuleQuery = new URLSearchParams({ view: "loop-source-generalization", fixture: name });
    const loopSourceCompositionQuery = new URLSearchParams({ view: "loop-source-composition", fixture: name });
    currentViewLink.href = `${location.pathname}?${currentQuery}`;
    historyViewLink.href = `${location.pathname}?${historyQuery}`;
    outwardStubViewLink.href = `${location.pathname}?${outwardStubQuery}`;
    sourcePortViewLink.href = `${location.pathname}?${sourcePortQuery}`;
    loopSourceRuleViewLink.href = `${location.pathname}?${loopSourceRuleQuery}`;
    loopSourceCompositionViewLink.href = `${location.pathname}?${loopSourceCompositionQuery}`;
    const activeQuery = historyMode ? historyQuery
      : outwardStubMode ? outwardStubQuery
        : sourcePortMode ? sourcePortQuery
          : loopSourceRuleMode ? loopSourceRuleQuery
            : loopSourceCompositionMode ? loopSourceCompositionQuery
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
