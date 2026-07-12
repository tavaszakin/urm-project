// SketchV4 — Phase 6 pipeline composition (single entry point, harness/dev-only).
//
// Composes the validated V4 architecture in runtime order:
//   1 cfg -> 2 roles -> 3 ownership -> 4 realforktree
//   -> 5 orientation assignment (tree-DP; calls the realize+evaluate oracle below)
//   -> 6 skeleton -> 7 lanes -> 8 HALT -> 9 routing -> 10 defects -> 11 diagnostics
//
// Orientation's cost oracle (`evaluate`) is EXPLICIT and CONTAINED: it realizes a candidate
// through skeleton->lanes->HALT->routing and scores it via defects.js. There is no other
// defect->layout feedback; diagnostics (step 11) is strictly read-only.
//
// Guards (trunk/interior/loop) are non-orientable and held at DEFAULT, which makes the
// v4Assigned / allDefault pipeline FULLY SELF-CONTAINED (no SketchV3 dependency). Only the
// `sketchV3Selected` comparison source needs injected real-fork bits, for parity validation.

import { buildCfg } from "./cfg.js";
import { classifyRoles } from "./roles.js";
import { computeOwnership } from "./ownership.js";
import { buildRealForkTree } from "./realforktree.js";
import { buildSkeleton } from "./skeleton.js";
import { computeLanes } from "./lanes.js";
import { placeHalt } from "./halt.js";
import { routeEdges } from "./routing.js";
import { evaluateDefects } from "./defects.js";
import { assignOrientation } from "./orientation.js";
import { buildDiagnostics } from "./diagnostics.js";

const DEFAULT = { no: "left", yes: "right" };

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

  // 1-4 structural front half
  const cfg = buildCfg(program);
  const roles = classifyRoles(cfg);
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
    const halt = placeHalt(cfg, roles, skeleton, lanes, { terminalSize: v.terminalSize, haltBandOffset: v.haltBandOffset, clearance });
    const routed = routeEdges(cfg, roles, ownership, skeleton, lanes, halt, { clearance });
    const boxes = new Map([...skeleton.placements].map(([id, p]) => [id, p.box]));
    boxes.set("halt", halt.haltBox);
    return { orientationOf, skeleton, lanes, halt, routed, boxes };
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

  // 6-9 final realization with the chosen orientation
  const R = realizeUnder(orientationMap);

  // 10 defects on the final layout
  const defects = evaluateDefects(
    { routes: R.routed.routes, boxes: R.boxes },
    { realForkSet: roles.realForkSet, lcaRF: tree.lcaRF },
    { clearance, program: options.programName, orientationSource },
  );

  // bounds (reporting only — placement/routes are NOT changed to fit). placementBounds =
  // nodes + HALT sink; renderBounds also includes every committed route point (rails extend
  // left, the HALT band extends right), and is the bound intended for SVG viewport sizing.
  const boxPoints = [...R.boxes.values()].flatMap((b) => [[b.left, b.top], [b.right, b.bottom]]);
  const routePoints = R.routed.routes.flatMap((e) => e.points);
  const placementBounds = boundsOver(boxPoints);
  const renderBounds = boundsOver(boxPoints.concat(routePoints));

  const layout = {
    program: options.programName ?? null, orientationSource,
    cfg, roles, ownership, tree, orientationMap, orientationResult,
    skeleton: R.skeleton, lanes: R.lanes, halt: R.halt, routed: R.routed, ports: R.routed.ports, boxes: R.boxes, orientationOf: R.orientationOf,
    defects, placementBounds, renderBounds,
  };

  // 11 diagnostics (read-only; never feeds back into layout)
  layout.diagnostics = withDiagnostics ? buildDiagnostics(layout) : null;

  return layout;
}
