// SketchV4 — Phase 6 diagnostics / report layer.
//
// STRICTLY READ-ONLY. Reshapes a completed V4 layout into SketchV3-parity-friendly debug
// records. It reads the layout and returns fresh record objects; it never mutates placement,
// routes, lanes, terminal, orientation, or defects, and has no feedback path into layout. The
// only sanctioned defect->layout path in V4 remains orientation deliberately calling
// defects.js as its objective (in orientation.js / pipeline.js), never this reporter.
//
// Because this runs last and only reads, the layout geometry is identical whether or not
// diagnostics are built — the Phase-6 harness asserts that byte-for-byte.

import { validateEdgeAttachments } from "./attachmentStubs.js";

const r = (n) => (Number.isFinite(n) ? Math.round(n) : n);
const rr = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

function horizontalOverlap(a0, a1, b0, b1) {
  return Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
}

function horizontalSegments(route) {
  const out = [];
  const points = route.points ?? [];
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (Math.abs(y1 - y0) > 0.01 || Math.abs(x1 - x0) <= 0.01) continue;
    out.push({
      edgeId: route.edgeId,
      routeFamily: route.routeFamily,
      segmentIndex: i - 1,
      y: y0,
      x0: Math.min(x0, x1),
      x1: Math.max(x0, x1),
    });
  }
  return out;
}

function findParallelRailConflicts(routes, clearance, minOverlap) {
  const loopSegments = routes
    .filter((route) => route.routeFamily === "loop-return")
    .flatMap(horizontalSegments);
  const conflicts = [];
  for (let i = 0; i < loopSegments.length; i += 1) {
    for (let j = i + 1; j < loopSegments.length; j += 1) {
      const a = loopSegments[i];
      const b = loopSegments[j];
      if (a.edgeId === b.edgeId) continue;
      const overlap = horizontalOverlap(a.x0, a.x1, b.x0, b.x1);
      const dy = Math.abs(a.y - b.y);
      if (overlap <= minOverlap || dy >= clearance) continue;
      conflicts.push({
        edgeA: a.edgeId,
        edgeB: b.edgeId,
        segmentA: a.segmentIndex,
        segmentB: b.segmentIndex,
        yA: rr(a.y),
        yB: rr(b.y),
        dy: rr(dy),
        overlap: rr(overlap),
        x0: rr(Math.max(a.x0, b.x0)),
        x1: rr(Math.min(a.x1, b.x1)),
      });
    }
  }
  return conflicts;
}

export function buildDiagnostics(layout) {
  const { program, orientationSource, cfg, roles, ownership, tree, orientationMap, orientationResult, skeleton, lanes, terminal, terminalId, terminalConstruction, routed, ports, defects, placementBounds, renderBounds } = layout;
  const bitOf = (f) => (orientationMap.get(f)?.no === "right" ? "flipped" : "default");
  const wh = (b) => (b ? { width: r(b.width), height: r(b.height), minX: r(b.minX), maxX: r(b.maxX), minY: r(b.minY), maxY: r(b.maxY) } : null);
  const rp = (p) => (Array.isArray(p) ? [r(p[0]), r(p[1])] : null);
  const nodeFor = (id) => {
    const base = cfg.nodeById.get(id) ?? { id, kind: "unknown", instructionIndex: null };
    const placement = skeleton.placements.get(id);
    return { ...base, role: roles.nodeRoleById.get(id), box: placement?.box ?? null };
  };

  const sketchV4PlacementDebug = {
    nodes: [...skeleton.placements].map(([id, p]) => ({ id, cx: r(p.cx), cy: r(p.cy), left: r(p.box.left), right: r(p.box.right), top: r(p.box.top), bottom: r(p.box.bottom), role: p.role })),
    terminal: terminal ? {
      id: terminal.id,
      instructionIndex: terminal.instructionIndex,
      kind: terminal.kind,
      cx: r(terminal.box.cx), cy: r(terminal.box.cy),
      left: r(terminal.box.left), right: r(terminal.box.right),
      top: r(terminal.box.top), bottom: r(terminal.box.bottom),
    } : null,
    halt: null,
    placementBounds: wh(placementBounds), renderBounds: wh(renderBounds),
  };

  const sketchV4RoleRecords = cfg.nodes.map((n) => ({ id: n.id, kind: n.kind, instructionIndex: n.instructionIndex, role: roles.nodeRoleById.get(n.id), tags: [...(roles.reentryTagsByNode.get(n.id) ?? [])] }));

  const sketchV4OwnershipRecords = cfg.nodes
    .filter((n) => Number.isInteger(n.instructionIndex))
    .map((n) => { const o = ownership.ownerOf(n.id); return { id: n.id, branchPath: ownership.branchPath(n.id).join("/"), ownerFork: o?.fork ?? null, ownerSide: o?.side ?? null, depth: cfg.depthByNode.get(n.id) }; });

  const sketchV4LaneRecords = lanes.laneRecords.map((l) => ({ ...l }));

  // Kept as a null compatibility field for existing debug consumers. There is no layout-level
  // HALT object in Layer A; the synthetic terminal record below is the authoritative identity.
  const sketchV4HaltRecords = null;
  const sketchV4TerminalRecords = terminal ? {
    terminalId,
    instructionIndex: terminal.instructionIndex,
    kind: terminal.kind,
    box: { ...terminal.box },
    construction: { ...terminalConstruction },
  } : null;

  const sketchV4RouteRecords = routed.routes.map((e) => ({
    edgeId: e.edgeId, source: e.source, target: e.target, edgeRole: e.edgeRole, routeFamily: e.routeFamily,
    connectorKind: e.connectorKind, portPolicyCase: e.portPolicyCase, laneBundleId: e.laneBundleId, railCoord: e.railCoord, haltLandingSlot: e.haltLandingSlot, pointCount: e.points.length, legal: e.legal,
  }));

  // Local attachment-stub diagnostics. This is a pure O(routes) read over completed
  // routes: legal port alone is not enough; the incident direction must match the
  // shape's local stub grammar.
  const sketchV4AttachmentRecords = routed.routes.map((e) => {
    const sourceNode = nodeFor(e.source);
    const targetNode = nodeFor(e.target);
    const validation = validateEdgeAttachments(e, sourceNode, targetNode, e.points, {
      sourceBox: sourceNode.box,
      targetBox: targetNode.box,
    });
    return {
      edgeId: e.edgeId,
      edgeRole: e.edgeRole,
      routeFamily: e.routeFamily,
      sourceNodeId: validation.source.nodeId,
      sourceNodeType: validation.source.nodeType,
      sourceNodeRole: sourceNode.role ?? null,
      sourceNodeShape: validation.source.nodeShape,
      sourcePort: validation.source.portName,
      sourcePortPoint: rp(validation.source.portPoint),
      sourceIncidentDirection: validation.source.incidentDirection,
      sourceAttachmentLegal: validation.source.legal,
      sourceIllegalReason: validation.source.reason,
      targetNodeId: validation.target.nodeId,
      targetNodeType: validation.target.nodeType,
      targetNodeRole: targetNode.role ?? null,
      targetNodeShape: validation.target.nodeShape,
      targetPort: validation.target.portName,
      targetPortPoint: rp(validation.target.portPoint),
      targetIncidentDirection: validation.target.incidentDirection,
      targetAttachmentLegal: validation.target.legal,
      targetIllegalReason: validation.target.reason,
      legal: validation.legal,
    };
  });
  const sketchV4IllegalAttachmentRecords = sketchV4AttachmentRecords.filter((r) => !r.legal);
  const illegalAttachmentEndpointCount = sketchV4AttachmentRecords.reduce((count, record) => (
    count +
    (record.sourceAttachmentLegal ? 0 : 1) +
    (record.targetAttachmentLegal ? 0 : 1)
  ), 0);

  // Per-edge port selection (Phase-4a): default vs selected ports, policy case, changed flag.
  const sketchV4PortRecords = [...(ports?.values?.() ?? [])].map((p) => ({
    edgeId: p.edgeId, source: p.source, target: p.target, role: p.role, portPolicyCase: p.portPolicyCase,
    defaultSourcePort: rp(p.defaultSourcePort), defaultTargetPort: rp(p.defaultTargetPort),
    sourcePort: rp(p.sourcePort), targetPort: rp(p.targetPort),
    corridorX: Number.isFinite(p.corridorX) ? r(p.corridorX) : undefined,
    defaultCorridorX: Number.isFinite(p.defaultCorridorX) ? r(p.defaultCorridorX) : undefined,
    changed: p.changed,
  }));
  const sketchV4ChangedPortRecords = sketchV4PortRecords.filter((p) => p.changed);

  const sketchV4DefectRecords = defects.defects.map((d) => ({ ...d }));
  const sketchV4ParallelRailAdjustmentRecords = (routed.parallelRailAdjustmentRecords ?? []).map((record) => ({
    ...record,
    fromY: rr(record.fromY),
    toY: rr(record.toY),
    x0: rr(record.x0),
    x1: rr(record.x1),
    blockers: (record.blockers ?? []).map((blocker) => ({
      ...blocker,
      y: rr(blocker.y),
      overlap: rr(blocker.overlap),
      dy: rr(blocker.dy),
    })),
  }));
  const sketchV4ParallelRailConflictRecords = findParallelRailConflicts(
    routed.routes,
    routed.parallelRailClearance ?? 48,
    routed.parallelRailMinOverlap ?? 8,
  );

  const sketchV4OrientationRecords = roles.realForkIds.map((f) => ({
    realForkId: f, bit: bitOf(f), defaultBit: "default",
    parentRealFork: tree.rfParent.get(f) ?? null, childRealForks: tree.rfChildren.get(f) ?? [],
  }));

  const sketchV4Summary = {
    program, orientationSource,
    nodeCount: cfg.nodes.length, edgeCount: cfg.edges.length, routeCount: routed.routes.length, realForkCount: roles.realForkIds.length,
    flippedRealForks: roles.realForkIds.filter((f) => bitOf(f) === "flipped"),
    totalDefectCount: defects.total, nodeOverlapCount: defects.nodeOverlapCount, edgeOverlapCount: defects.edgeOverlapCount, crossingCount: defects.crossingCount,
    routeFamilyConflictCount: defects.routeFamilyConflictCount, laneBundleConflictCount: defects.laneBundleConflictCount,
    branchVsBranchCrossingCount: defects.branchVsBranchCrossingCount, excludedDiamondInBranchCrossingCount: defects.excludedDiamondInBranchCrossingCount,
    interleavingConflictCount: lanes.interleavingConflictCount, loopBundleCount: lanes.bundleCount,
    changedPortCount: sketchV4ChangedPortRecords.length,
    illegalLocalAttachmentEdgeCount: sketchV4IllegalAttachmentRecords.length,
    illegalLocalAttachmentEndpointCount: illegalAttachmentEndpointCount,
    parallelRailAdjustmentCount: sketchV4ParallelRailAdjustmentRecords.length,
    parallelRailConflictCount: sketchV4ParallelRailConflictRecords.length,
    parallelRailClearance: routed.parallelRailClearance ?? null,
    parallelRailMinOverlap: routed.parallelRailMinOverlap ?? null,
    terminalId,
    ordinarySyntheticTerminal: true,
    haltBandReserved: null,
    loopRailInsideHaltBand: null,
    placementBounds: wh(placementBounds), renderBounds: wh(renderBounds),
    rareRepairCandidates: orientationResult?.rareRepairCandidates ?? null,
  };

  return { sketchV4PlacementDebug, sketchV4RoleRecords, sketchV4OwnershipRecords, sketchV4LaneRecords, sketchV4HaltRecords, sketchV4TerminalRecords, sketchV4RouteRecords, sketchV4AttachmentRecords, sketchV4IllegalAttachmentRecords, sketchV4PortRecords, sketchV4ChangedPortRecords, sketchV4DefectRecords, sketchV4ParallelRailAdjustmentRecords, sketchV4ParallelRailConflictRecords, sketchV4OrientationRecords, sketchV4Summary };
}
