// SketchV4 — Phase 4 routeFamily routing.
//
// Pure/deterministic. Routes every CFG edge ONCE over the finished skeleton (Phase 2) +
// lane bundles + HALT sink (Phase 3), one router per routeFamily. No deferred route
// queue, no last-resort/suspicious HALT tier, no route-and-reject, no global anchors.
//
//   entry-link / setup-link / spine-continuation : straight source-bottom -> target-top.
//   branch-exit         : the Phase-2 fixed-angle ray (diamond face -> target top).
//   merge-connector     : connector to an ALREADY-PLACED forward target (NOT a fresh ray);
//                         leaves the source toward the target and approaches its top. This
//                         is the net-new V4 routing rule; V4 already classifies these as
//                         merge-connectors in Phase 1, so they never become stray rays.
//   loop-return         : the Phase-3 rail, drawn with the L1.1 source/target-offset shape
//                         and GLOBAL clearance (clearY) so outer-loop horizontals do not cut
//                         through inner rails.
//   halt-exit           : source -> reserved HALT band / shared sink (separate routeFamily
//                         from loop rails), in landing-slot order.
//
// Source/target PORTS are no longer chosen inline here: they come from the Phase-4a
// selectPorts pass (ports.js), which routing.js consumes. routing.js still owns the route
// BODY (the waypoints between the two chosen ports) per routeFamily. Passing a precomputed
// `options.ports` map is optional; absent, routeEdges computes it (keeps dev probes working).

import { selectPorts } from "./ports.js";

const getLeft = (b) => [b.left, b.cy];
const getRight = (b) => [b.right, b.cy];
const getTop = (b) => [b.cx, b.top];
const getBottom = (b) => [b.cx, b.bottom];

const PARALLEL_LOOP_RAIL_CLEARANCE_FACTOR = 3;
const MIN_PARALLEL_LOOP_RAIL_OVERLAP = 8;

function horizontalOverlap(a0, a1, b0, b1) {
  return Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
}

export function routeEdges(cfg, roles, ownership, skeleton, lanes, halt, options = {}) {
  const placements = skeleton.placements;
  const clearance = options.clearance ?? 16;
  const boxOf = (id) => (id === "halt" ? halt.haltBox : placements.get(id)?.box);
  const portSel = options.ports ?? selectPorts(cfg, roles, skeleton, halt, { clearance });

  const armByEdge = new Map(skeleton.armSegments.map((a) => [a.edgeId, a]));
  const laneByEdge = new Map(lanes.laneRecords.map((l) => [l.edgeId, l]));
  const haltSlotBySource = new Map(halt.haltExitRecords.map((h) => [h.source, h.landingSlotOrder]));

  // rail clearance metadata (all rails participate -> global clearance, the L1.1 lesson)
  const railMeta = lanes.laneRecords.map((l) => {
    const sb = placements.get(l.source)?.box, tb = placements.get(l.target)?.box;
    const sP = l.side === "left" ? getLeft(sb) : getRight(sb);
    const tP = l.side === "left" ? getLeft(tb) : getRight(tb);
    return { edgeId: l.edgeId, rail: l.railCoord, side: l.side, sP, tP, sCy: sP[1], tCy: tP[1] };
  });
  // Drop a horizontal run to a Y clear of every OTHER rail between the port column and this rail.
  const clearY = (y0, xPort, rail, dir) => {
    const lo = Math.min(xPort, rail), hi = Math.max(xPort, rail);
    const between = railMeta.filter((o) => o.rail > lo + 1 && o.rail < hi - 1);
    let y = y0;
    for (let g = 0; g < 20; g++) {
      const hit = between.filter((o) => Math.min(o.sCy, o.tCy) - 1 <= y && y <= Math.max(o.sCy, o.tCy) + 1);
      if (!hit.length) break;
      y = dir > 0 ? Math.max(...hit.map((o) => Math.max(o.sCy, o.tCy))) + 2 * clearance
                  : Math.min(...hit.map((o) => Math.min(o.sCy, o.tCy))) - 2 * clearance;
    }
    return y;
  };

  // Find a Y near y0 at which a horizontal run [xFrom..xTo] clears every node box (except the
  // edge's own source). Used by HALT approaches to leave the body without grazing a node that
  // sits in an intervening column at the source's row (the analog of clearY, over node boxes).
  const nodeEntryY = (y0, xFrom, xTo, excludeId) => {
    const lo = Math.min(xFrom, xTo), hi = Math.max(xFrom, xTo);
    const blockers = [...placements].filter(([id, p]) => id !== excludeId && p.box.right > lo + 1 && p.box.left < hi - 1).map(([, p]) => p.box);
    let y = y0;
    for (let g = 0; g < 40; g++) {
      const hit = blockers.filter((box) => box.top - clearance <= y && y <= box.bottom + clearance);
      if (!hit.length) break;
      y = Math.max(...hit.map((box) => box.bottom)) + clearance + 1; // step just below the lowest blocker
    }
    return y;
  };

  // Connector to an already-placed forward target, entering its TOP. Leave the source bottom,
  // run to the target's vertical centerline at a Y just outside the target, then enter its top.
  // Straight when already column-aligned. Never a fixed-angle ray. Consumes the selected ports.
  const mergeTopConnector = (sB, tT) => {
    if (Math.abs(sB[0] - tT[0]) < 1) return { points: [sB, tT], kind: "straight" };
    const gap = Math.min(clearance, Math.max(2, (tT[1] - sB[1]) / 2));
    const midY = tT[1] - gap; // step in just above the target top
    return { points: [sB, [sB[0], midY], [tT[0], midY], tT], kind: "orthogonal" };
  };

  // Connector entering an already-placed target from the SIDE (its top is occupied by the
  // node's column/branch predecessor). Leave the source bottom, drop to the target's row, then
  // run in to the chosen side face. Straight when already at the target's row.
  const mergeSideConnector = (sB, tS) => {
    if (Math.abs(sB[1] - tS[1]) < 1) return { points: [sB, tS], kind: "sideStraight" };
    return { points: [sB, [sB[0], tS[1]], tS], kind: "sideEntry" };
  };

  // Side entry whose descent column would pass through the target's footprint (R17 /
  // VISUAL_GRAMMAR.md C3; jog column chosen by ports.js): stop the source-column drop just
  // above the target, jog outward to sideEntryJogX (strictly outside the box edge), descend
  // beside the box, and enter the side face — the final horizontal always approaches the port
  // from beyond the box, so the approach cannot clip the target.
  const mergeSideJogConnector = (sB, tS, tBox, jogX) => {
    const gap = Math.min(clearance, Math.max(2, (tBox.top - sB[1]) / 2));
    const midY = tBox.top - gap;
    return { points: [sB, [sB[0], midY], [jogX, midY], [jogX, tS[1]], tS], kind: "sideEntryJog" };
  };

  const routes = [];
  const warnings = [];
  const parallelRailAdjustmentRecords = [];
  const horizontalLoopRailReservations = [];
  const parallelRailClearance = options.parallelRailClearance ?? PARALLEL_LOOP_RAIL_CLEARANCE_FACTOR * clearance;
  const parallelRailMinOverlap = options.parallelRailMinOverlap ?? Math.max(MIN_PARALLEL_LOOP_RAIL_OVERLAP, clearance / 2);

  const reserveLoopHorizontalRail = (edgeId, segmentKind, y, xA, xB) => {
    const overlap = Math.abs(xB - xA);
    if (overlap <= parallelRailMinOverlap) return;
    horizontalLoopRailReservations.push({
      edgeId,
      segmentKind,
      y,
      x0: Math.min(xA, xB),
      x1: Math.max(xA, xB),
    });
  };

  const parallelRailConflictsAt = (edgeId, y, xA, xB) => {
    const x0 = Math.min(xA, xB);
    const x1 = Math.max(xA, xB);
    return horizontalLoopRailReservations
      .map((reservation) => ({
        ...reservation,
        overlap: horizontalOverlap(x0, x1, reservation.x0, reservation.x1),
        dy: Math.abs(y - reservation.y),
      }))
      .filter((reservation) => (
        reservation.edgeId !== edgeId
        && reservation.overlap > parallelRailMinOverlap
        && reservation.dy < parallelRailClearance
      ));
  };

  const clearParallelLoopRailY = (edgeId, segmentKind, y0, xA, xB, dir) => {
    let y = y0;
    const blockers = new Map();
    for (let guard = 0; guard < 40; guard += 1) {
      const conflicts = parallelRailConflictsAt(edgeId, y, xA, xB);
      if (!conflicts.length) break;
      for (const conflict of conflicts) {
        blockers.set(`${conflict.edgeId}|${conflict.segmentKind}`, {
          edgeId: conflict.edgeId,
          segmentKind: conflict.segmentKind,
          y: conflict.y,
          overlap: conflict.overlap,
          dy: conflict.dy,
        });
      }
      if (dir >= 0) {
        const lowestConflictY = Math.max(...conflicts.map((conflict) => conflict.y));
        y = Math.max(y + 2 * clearance, lowestConflictY + parallelRailClearance);
      } else {
        const highestConflictY = Math.min(...conflicts.map((conflict) => conflict.y));
        y = Math.min(y - 2 * clearance, highestConflictY - parallelRailClearance);
      }
    }
    if (Math.abs(y - y0) > 0.01) {
      parallelRailAdjustmentRecords.push({
        edgeId,
        segmentKind,
        fromY: y0,
        toY: y,
        x0: Math.min(xA, xB),
        x1: Math.max(xA, xB),
        blockerCount: blockers.size,
        blockers: [...blockers.values()],
      });
    }
    return y;
  };

  for (const edge of cfg.edges) {
    const role = roles.edgeRoleById.get(edge.id);
    const src = edge.from, tgt = edge.to;
    const sBox = boxOf(src), tBox = boxOf(tgt);
    const sel = portSel.get(edge.id);
    let points, routeFamily, connectorKind = null, laneBundleId = null, railCoord = null, haltLandingSlot = null, sourcePort = null, targetPort = null, portPolicyCase = sel?.portPolicyCase ?? null;

    if (role === "entry-link" || role === "setup-link" || role === "spine-continuation") {
      routeFamily = role === "entry-link" ? "entry" : role === "setup-link" ? "setup" : "spine";
      sourcePort = getBottom(sBox); targetPort = getTop(tBox);
      points = [sourcePort, targetPort];
    } else if (role === "branch-exit") {
      routeFamily = "branch-exit";
      const arm = armByEdge.get(edge.id);
      if (arm) { sourcePort = arm.face; targetPort = arm.targetTop; points = [arm.face, arm.targetTop]; }
      else { warnings.push({ edgeId: edge.id, reason: "branchExitWithoutArm" }); sourcePort = getBottom(sBox); targetPort = getTop(tBox); points = [sourcePort, targetPort]; }
    } else if (role === "merge-connector") {
      routeFamily = "merge-connector";
      sourcePort = sel ? sel.sourcePort : getBottom(sBox);
      targetPort = sel ? sel.targetPort : getTop(tBox);
      // Same-row side entries keep their straight shape even when a jog column is recorded
      // (there is no room above the target to jog through).
      const jogX = sel?.sideEntryJogX;
      const mc = sel?.portPolicyCase === "merge-side-entry"
        ? (Number.isFinite(jogX) && Math.abs(sourcePort[1] - targetPort[1]) >= 1
          ? mergeSideJogConnector(sourcePort, targetPort, tBox, jogX)
          : mergeSideConnector(sourcePort, targetPort))
        : mergeTopConnector(sourcePort, targetPort);
      points = mc.points; connectorKind = mc.kind;
    } else if (role === "loop-return") {
      routeFamily = "loop-return";
      const lane = laneByEdge.get(edge.id);
      const meta = railMeta.find((m) => m.edgeId === edge.id);
      if (lane && meta) {
        laneBundleId = lane.laneBundleId; railCoord = lane.railCoord;
        const { sP, tP, sCy, tCy, rail } = meta;
        const sY = clearParallelLoopRailY(edge.id, "source-exit", clearY(sCy, sP[0], rail, +1), sP[0], rail, +1);
        const tY = clearParallelLoopRailY(edge.id, "target-entry", clearY(tCy, tP[0], rail, -1), rail, tP[0], -1);
        const pts = [sP];
        if (sY !== sCy) pts.push([sP[0], sY], [rail, sY]); else pts.push([rail, sCy]);
        if (tY !== tCy) pts.push([rail, tY], [tP[0], tY], tP); else pts.push([rail, tCy], tP);
        reserveLoopHorizontalRail(edge.id, "source-exit", sY, sP[0], rail);
        reserveLoopHorizontalRail(edge.id, "target-entry", tY, rail, tP[0]);
        points = pts; sourcePort = sP; targetPort = tP;
      } else { warnings.push({ edgeId: edge.id, reason: "loopReturnWithoutLane" }); sourcePort = getLeft(sBox); targetPort = getLeft(tBox); points = [sourcePort, targetPort]; }
    } else if (role === "halt-exit") {
      // Approach the single shared sink THROUGH the reserved band (right of every node/rail),
      // never a straight diagonal across the diagram. selectPorts gives all sink exits a SHARED
      // corridor column (sel.corridorX) and a stacked landing on the sink (slot order), so the
      // approaches form one terminal trunk instead of fanning into independent far-right lanes.
      // HALT stays a separate routeFamily from loop rails.
      routeFamily = "halt";
      const slot = sel?.landingSlot ?? haltSlotBySource.get(src) ?? 0;
      haltLandingSlot = slot;
      sourcePort = sel ? sel.sourcePort : getRight(sBox);
      targetPort = sel ? sel.targetPort : [halt.haltBox.left, sBox.cy];
      const bandX = sel?.corridorX ?? (halt.haltX - halt.haltBandOffset); // SHARED trunk column
      const landY = targetPort[1];
      const entryY = nodeEntryY(sBox.cy, sBox.right, bandX, src); // clear intervening node rows
      points = [sourcePort];
      if (entryY !== sBox.cy) points.push([sBox.right, entryY]); // short drop in the source column
      points.push([bandX, entryY], [bandX, landY], targetPort);
      connectorKind = "haltSharedCorridor";
    } else {
      warnings.push({ edgeId: edge.id, reason: "unroutableRole", role });
      routeFamily = "unknown"; sourcePort = getBottom(sBox); targetPort = getTop(tBox); points = [sourcePort, targetPort];
    }

    routes.push({ edgeId: edge.id, source: src, target: tgt, edgeRole: role, routeFamily, connectorKind, portPolicyCase, points, sourcePort, targetPort, laneBundleId, railCoord, haltLandingSlot, legal: true });
  }

  return { routes, warnings, ports: portSel, parallelRailAdjustmentRecords, parallelRailClearance, parallelRailMinOverlap };
}
