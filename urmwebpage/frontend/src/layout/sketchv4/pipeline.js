// SketchV4 — production pipeline composition (single entry point).
//
// Composes the validated V4 architecture in runtime order:
//   1 cfg -> 2 roles -> 3 ownership -> 4 realforktree
//   -> 5 orientation assignment (tree-DP; calls the realize+evaluate oracle below)
//   -> 6 skeleton -> 7 lanes -> 8 routing -> 9 defects -> 10 diagnostics
//
// Orientation's cost oracle (`evaluate`) is EXPLICIT and CONTAINED: it realizes a candidate
// through skeleton->lanes->routing and scores it via defects.js. There is no other
// defect->layout feedback; diagnostics (step 10) is strictly read-only.
//
// Guards (trunk/interior/loop) are non-orientable and held at DEFAULT, which makes the
// v4Assigned / allDefault pipeline FULLY SELF-CONTAINED (no SketchV3 dependency). Only the
// `sketchV3Selected` comparison source needs injected real-fork bits, for parity validation.

import { buildOrdinaryTerminalCfg } from "./cfg.js";
import { classifyRoles } from "./roles.js";
import { computeOwnership } from "./ownership.js";
import { buildRealForkTree } from "./realforktree.js";
import { buildSkeleton } from "./skeleton.js";
import { computeLanes } from "./lanes.js";
import { routeEdges } from "./routing.js";
import { applyAdaptiveConditionalMergeSources } from "./conditionalMergeSources.js";
import { applySameSideContinuationReentries } from "./sameSideReentry.js";
import { evaluateDefects } from "./defects.js";
import { assignOrientation } from "./orientation.js";
import { buildDiagnostics } from "./diagnostics.js";

const DEFAULT = { no: "left", yes: "right" };
const NO_HALT_CONTEXT = Object.freeze({
  haltBox: null,
  haltExitRecords: Object.freeze([]),
  haltExitCount: 0,
  haltX: 0,
  haltBandOffset: 0,
});

function failLayerA(message) {
  throw new Error(`SketchV4 ordinary-terminal invariant failed: ${message}`);
}

function assertOrdinaryTerminalRealization(parts, roles, realization) {
  const { cfg, terminalId, terminalIndex, terminalIncomingEdgeIds, expectedTerminalIncomingEdgeIds } = parts;
  const { skeleton, routed, boxes } = realization;
  const terminalNodes = cfg.nodes.filter((node) => node.id === terminalId);
  if (terminalNodes.length !== 1 || terminalNodes[0].kind !== "action") {
    failLayerA(`expected one ordinary action terminal ${terminalId}`);
  }
  if (cfg.nodeById.has("halt") || cfg.nodes.some((node) => node.id === "halt")) {
    failLayerA("legacy halt CFG node survived augmentation");
  }
  if (cfg.edges.some((edge) => edge.from === "halt" || edge.to === "halt")) {
    failLayerA("legacy halt CFG edge survived augmentation");
  }
  if ([...roles.edgeRoleById.values()].some((role) => role === "halt-exit")) {
    failLayerA("halt-exit edge role survived classification");
  }
  if (cfg.outgoingByIndex.get(terminalIndex)?.yes || cfg.outgoingByIndex.get(terminalIndex)?.no || cfg.outgoingByIndex.get(terminalIndex)?.cont) {
    failLayerA("synthetic terminal has an outgoing CFG edge");
  }
  if (terminalIncomingEdgeIds.join("\0") !== expectedTerminalIncomingEdgeIds.join("\0")) {
    failLayerA(`terminal incoming edges differ: expected ${expectedTerminalIncomingEdgeIds}, got ${terminalIncomingEdgeIds}`);
  }
  if (cfg.edges.some((edge) => terminalIncomingEdgeIds.includes(edge.id) && edge.to !== terminalId)) {
    failLayerA("an expected terminal input does not target the synthetic terminal");
  }
  if (skeleton.placements.has("halt") || boxes.has("halt")) {
    failLayerA("legacy halt received layout geometry");
  }
  if ((skeleton.haltExitEdges ?? []).length !== 0) {
    failLayerA("HALT exit placeholder survived skeleton construction");
  }
  const terminalPlacement = skeleton.placements.get(terminalId);
  if (!terminalPlacement || terminalPlacement.kind !== "action" || boxes.get(terminalId) !== terminalPlacement.box) {
    failLayerA("synthetic terminal did not receive one ordinary skeleton placement");
  }
  if (routed.routes.some((route) => route.source === terminalId)) {
    failLayerA("synthetic terminal received a routed outgoing edge");
  }
  if (routed.routes.some((route) => route.edgeRole === "halt-exit" || route.routeFamily === "halt")) {
    failLayerA("HALT route family participated");
  }
  if ([...routed.ports.values()].some((port) => String(port.portPolicyCase).startsWith("halt-"))) {
    failLayerA("HALT-specific port policy participated");
  }
  const cfgEdgeIds = cfg.edges.map((edge) => edge.id).sort();
  const routeIds = routed.routes.map((route) => route.edgeId).sort();
  if (cfgEdgeIds.join("\0") !== routeIds.join("\0") || new Set(routeIds).size !== routeIds.length) {
    failLayerA("CFG edges were not routed exactly once");
  }
  const routeById = new Map(routed.routes.map((route) => [route.edgeId, route]));
  if (cfg.edges.some((edge) => {
    const route = routeById.get(edge.id);
    return route?.source !== edge.from || route?.target !== edge.to;
  })) {
    failLayerA("a routed edge does not preserve its CFG endpoints");
  }
}

// Self-contained guard-side rule (Phase 7, replaces "held default"). A guard is
// non-orientable, so its arms map to FIXED sides by role: the HALT arm goes to the
// HALT-bearing side, the surviving arm to the opposite side. (A trunk-guard's survivor is a
// spine-continuation, so its side is geometry-irrelevant.) This reproduces the canonical
// held-default exactly — every canonical guard has HALT on its yes-arm => {no:left,yes:right}
// — and correctly yields {no:right,yes:left} for a no-arm-HALT guard, with NO dependency on
// SketchV3's selection. Loop-guards (unexercised by the canonical set) fall through to default.
export function roleGuardOrientation(cfg, roles, haltSide = "right") {
  const opp = haltSide === "right" ? "left" : "right";
  return (id) => {
    const node = cfg.nodeById.get(id);
    const out = node ? cfg.outgoingByIndex.get(node.instructionIndex) : null;
    if (out?.yes?.isHalt) return { no: opp, yes: haltSide };  // survivor (no) opposite HALT (yes)
    if (out?.no?.isHalt) return { no: haltSide, yes: opp };   // survivor (yes) opposite HALT (no)
    return { ...DEFAULT };
  };
}

function boundsOver(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function buildLayout(program, options = {}) {
  const v = options.visual ?? {};
  const clearance = v.clearance ?? 16;
  const orientationSource = options.orientationSource ?? "v4Assigned";
  const injectedGuardOrientationOf = options.guardOrientationOf ?? null;
  const sketchV3RealForkBits = options.sketchV3RealForkBits ?? new Map();
  const pins = options.pins ?? new Map();
  const withDiagnostics = options.diagnostics ?? false;

  // Layer A is structural, not a post-orientation rewrite: augment the program and build the
  // ordinary terminal before roles, ownership, tree construction, and every realization.
  const terminalParts = buildOrdinaryTerminalCfg(program);
  const { cfg, terminalId, terminalIndex } = terminalParts;
  const roles = classifyRoles(cfg);
  if ([...roles.edgeRoleById.values()].includes("halt-exit")) {
    failLayerA("halt-exit role survived transformed-CFG classification");
  }
  const ownership = computeOwnership(cfg, roles);
  const tree = buildRealForkTree(cfg, roles);

  // self-contained guard-side rule (no SketchV3 dependency); injectable only for testing
  const guardOrientationOf = injectedGuardOrientationOf ?? roleGuardOrientation(cfg, roles, options.haltSide ?? "right");

  // contained realize-under-orientation oracle (real-forks vary; guards held)
  const orientationOfFor = (rfMap) => (id) => (roles.realForkSet.has(id) ? (rfMap.get(id) ?? DEFAULT) : (guardOrientationOf(id) ?? DEFAULT));
  const realizeUnder = (rfMap) => {
    const orientationOf = orientationOfFor(rfMap);
    const skeleton = buildSkeleton(cfg, roles, { orientationOf, sizeForKind: v.sizeForKind, branchAngleTan: v.branchAngleTan, pitch: v.pitch });
    const lanes = computeLanes(cfg, roles, ownership, skeleton, { orientationOf });
    // routing.js/ports.js retain an inert compatibility argument, but no HALT node, edge role,
    // box, landing slot, route family, or port policy reaches them in Layer A.
    const baseRouted = routeEdges(cfg, roles, ownership, skeleton, lanes, NO_HALT_CONTEXT, { clearance });
    const boxes = new Map([...skeleton.placements].map(([id, p]) => [id, p.box]));
    const conditionalMergeSources = applyAdaptiveConditionalMergeSources(
      cfg,
      roles,
      skeleton,
      baseRouted,
      boxes,
      { orientationOf, branchAngleTan: v.branchAngleTan, clearance },
    );
    const sameSideReentries = applySameSideContinuationReentries(
      cfg,
      roles,
      conditionalMergeSources.routed,
      boxes,
      { clearance },
    );
    const routed = sameSideReentries.routed;
    const terminalPlacement = skeleton.placements.get(terminalId);
    const realization = {
      orientationOf,
      skeleton,
      lanes,
      routed,
      boxes,
      conditionalMergeSources,
      sameSideReentries,
      terminal: terminalPlacement ? {
        id: terminalId,
        instructionIndex: terminalIndex,
        kind: "action",
        box: terminalPlacement.box,
      } : null,
    };
    assertOrdinaryTerminalRealization(terminalParts, roles, realization);
    return realization;
  };
  const evaluate = (rfMap) => {
    const R = realizeUnder(rfMap);
    return evaluateDefects({ routes: R.routed.routes, boxes: R.boxes }, { realForkSet: roles.realForkSet, lcaRF: tree.lcaRF }, { clearance });
  };

  // 5 orientation
  let orientationMap, orientationResult = null;
  if (orientationSource === "allDefault") {
    orientationMap = new Map(roles.realForkIds.map((f) => [f, { ...DEFAULT }]));
  } else if (orientationSource === "sketchV3Selected") {
    orientationMap = new Map(roles.realForkIds.map((f) => [f, sketchV3RealForkBits.get(f) ?? { ...DEFAULT }]));
  } else { // v4Assigned
    orientationResult = assignOrientation({ realForks: roles.realForkIds, bottomUp: tree.bottomUp, rfParent: tree.rfParent, rfChildren: tree.rfChildren, evaluate, pins });
    orientationMap = orientationResult.orientationMap;
  }

  // 6-8 final realization with the chosen orientation. This is the same complete production
  // realizer used by evaluate() above; only the orientation map differs.
  const R = realizeUnder(orientationMap);

  // 9 defects on the final layout
  const defects = evaluateDefects(
    { routes: R.routed.routes, boxes: R.boxes },
    { realForkSet: roles.realForkSet, lcaRF: tree.lcaRF },
    { clearance, program: options.programName, orientationSource },
  );

  // Bounds are reporting-only: placement/routes are not changed to fit. Both the synthetic
  // terminal and all ordinary nodes already live in R.boxes.
  const boxPoints = [...R.boxes.values()].flatMap((b) => [[b.left, b.top], [b.right, b.bottom]]);
  const routePoints = R.routed.routes.flatMap((e) => e.points);
  const placementBounds = boundsOver(boxPoints);
  const renderBounds = boundsOver(boxPoints.concat(routePoints));

  const layout = {
    program: options.programName ?? null, orientationSource,
    cfg, roles, ownership, tree, orientationMap, orientationResult,
    skeleton: R.skeleton, lanes: R.lanes, routed: R.routed, ports: R.routed.ports, boxes: R.boxes, orientationOf: R.orientationOf,
    terminalId, terminalIndex, terminal: R.terminal,
    conditionalMergeSources: R.conditionalMergeSources,
    sameSideReentries: R.sameSideReentries,
    // This record makes the internal topology/display boundary and shared-realizer invariant
    // inspectable without reviving a layout-level `halt` object.
    terminalConstruction: {
      kind: "ordinary-synthetic-instruction",
      syntheticInstruction: [...terminalParts.augmentedProgram[terminalIndex]],
      redirectedExplicitJumpIndexes: [...terminalParts.redirectedExplicitJumpIndexes],
      incomingEdgeIds: [...terminalParts.terminalIncomingEdgeIds],
      syntheticOutgoingEdgeIdRemoved: terminalParts.syntheticOutgoingEdgeId,
      legacyHaltNodePresent: false,
      haltExitRoleCount: 0,
      haltRouteCount: 0,
      haltPortPolicyCount: 0,
      placeHaltCalled: false,
      candidateAndFinalRealizer: "shared-realizeUnder",
    },
    defects, placementBounds, renderBounds,
  };

  // 10 diagnostics (read-only; never feeds back into layout)
  layout.diagnostics = withDiagnostics ? buildDiagnostics(layout) : null;

  return layout;
}
