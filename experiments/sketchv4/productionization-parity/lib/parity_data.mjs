export const PARITY_SCHEMA_VERSION = 1;

export const PARITY_STAGES = Object.freeze(["BASE", "A", "B", "C", "D", "E"]);

export const PARITY_FIXTURES = Object.freeze([
  "minimization:bounded_sub",
  "characteristic:divides",
  "characteristic:eq",
  "primrec:basic",
  "predecessor",
]);

export function fixtureSlug(fixture) {
  return String(fixture).replaceAll(":", "__").replaceAll("/", "_");
}

export function referenceRelativePath(stage, fixture) {
  return `references/${String(stage).toLowerCase()}/${fixtureSlug(fixture)}.json`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value, space = 0) {
  return `${JSON.stringify(stableValue(value), null, space)}\n`;
}

function copy(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function boxRecord(id, box, view) {
  const node = view.cfg?.nodeById?.get(id) ?? null;
  return {
    id,
    kind: node?.kind ?? (id === view.terminalId ? "halt" : null),
    instructionIndex: node?.instructionIndex ?? null,
    role: view.roles?.nodeRoleById?.get(id) ?? null,
    box: {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      cx: box.cx,
      cy: box.cy,
      // Keep absent production fields absent in the canonical record (JSON null)
      // instead of deriving values that were not present in the source box.
      w: box.w ?? null,
      h: box.h ?? null,
    },
  };
}

function routeRecord(route) {
  return {
    edgeId: route.edgeId,
    source: route.source,
    target: route.target,
    edgeRole: route.edgeRole ?? null,
    routeFamily: route.routeFamily ?? null,
    connectorKind: route.connectorKind ?? null,
    portPolicyCase: route.portPolicyCase ?? null,
    sourcePort: copy(route.sourcePort),
    targetPort: copy(route.targetPort),
    points: copy(route.points),
    laneBundleId: route.laneBundleId ?? null,
    railCoord: route.railCoord ?? null,
    haltLandingSlot: route.haltLandingSlot ?? null,
  };
}

function portRecord([edgeId, record]) {
  return { edgeId, ...copy(record) };
}

function orientationRecord([id, orientation]) {
  return {
    id,
    no: orientation.no,
    yes: orientation.yes,
    bit: orientation.no === "right" ? "flipped" : "default",
  };
}

function attachmentRecord(record) {
  return {
    edgeId: record.edgeId,
    edgeRole: record.edgeRole ?? null,
    routeFamily: record.routeFamily ?? null,
    legal: record.legal,
    source: copy(record.source),
    target: copy(record.target),
  };
}

function sourceChangeEvidence(row) {
  const oldBendRow = row.oldRoutePoints?.[1]?.[1] ?? null;
  const newBendRow = row.newRoutePoints?.[1]?.[1] ?? null;
  const oldSuffix = row.oldRoutePoints?.slice(2) ?? [];
  const newSuffix = row.newRoutePoints?.slice(2) ?? [];
  return {
    edgeId: row.edgeId,
    source: row.source,
    target: row.target,
    bodyClassification: row.bodyClassification,
    oldSourcePort: copy(row.existingSourcePort),
    newSourcePort: copy(row.resultingSourcePort),
    railCoord: row.railCoord,
    bendRow: row.bendRow,
    targetPort: copy(row.targetPort),
    preservedRouteSuffix: copy(row.preservedRouteSuffix),
    unchanged: {
      rail: { before: row.railCoord, after: row.railCoord, unchanged: true },
      bendRow: { before: oldBendRow, after: newBendRow, unchanged: oldBendRow === newBendRow },
      targetAttachment: {
        before: copy(row.targetPort),
        after: copy(row.targetPort),
        unchanged: true,
      },
      routeSuffix: {
        before: copy(oldSuffix),
        after: copy(newSuffix),
        unchanged: stableStringify(oldSuffix) === stableStringify(newSuffix),
      },
    },
    oldRoutePoints: copy(row.oldRoutePoints),
    newRoutePoints: copy(row.newRoutePoints),
    oldAttachmentLegality: copy(row.oldAttachmentLegality),
    newAttachmentLegality: copy(row.newAttachmentLegality),
  };
}

function targetChangeEvidence(row) {
  return {
    edgeId: row.edgeId,
    source: row.source,
    target: row.target,
    outcome: row.outcome,
    candidateCount: row.candidateCount,
    candidateNamedPort: row.candidateNamedPort,
    candidateIncidentDirection: row.candidateIncidentDirection,
    oldTargetPort: copy(row.currentTargetPort),
    newTargetPort: copy(row.resultingTargetPort),
    approachStart: copy(row.approachStart),
    approachEnd: copy(row.approachEnd),
    intersection: copy(row.intersection),
    railCoord: row.railCoord,
    oldRouteSuffix: copy(row.oldRouteSuffix),
    newRouteSuffix: copy(row.newRouteSuffix),
    oldRoutePoints: copy(row.oldRoutePoints),
    newRoutePoints: copy(row.newRoutePoints),
    resultingTargetLegal: row.resultingTargetLegal,
    resultingOverallAttachmentLegal: row.resultingOverallAttachmentLegal,
  };
}

function stageEvidence(view) {
  const adaptiveDecisions = (view.experimentalRouteSplices ?? [])
    .filter((row) => row && Object.hasOwn(row, "shortened"))
    .map((row) => ({
      edgeId: row.edgeId,
      semanticBranch: row.semanticBranch,
      visualSide: row.visualSide,
      sourcePort: copy(row.sourcePort),
      fullRayEndpoint: copy(row.fullRayEndpoint),
      shortened: row.shortened,
      nearestRelevantObstruction: copy(row.nearestRelevantObstruction),
      availableBoundaryGap: row.availableBoundaryGap,
      clearanceAtFullLeg: row.clearanceAtFullLeg,
      chosenRayEndpoint: copy(row.chosenRayEndpoint),
      targetPort: copy(row.targetPort),
      finalRoutePoints: copy(row.finalRoutePoints),
    }))
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const sourceChanges = (view.experimentalLoopSourcePortCensus ?? [])
    .filter((row) => row.routeChanged)
    .map(sourceChangeEvidence)
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const targetChanges = (view.experimentalLoopTargetAttachmentCensus ?? [])
    .filter((row) => row.routeChanged)
    .map(targetChangeEvidence)
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const loopAttachments = (view.attachments ?? []).filter((row) => row.edgeRole === "loop-return");
  return {
    eligibleConditionalMergeEdgeIds: [...(view.purity?.generalizedEligibleEdgeIds ?? [])].sort(),
    adaptiveChangedEdgeIds: [...(view.purity?.adaptiveChangedEdgeIds ?? [])].sort(),
    adaptiveDecisions,
    i57CompatibilityRoute: view.experimentalRouteSplice?.edgeId === "i-57-cont"
      ? copy(view.experimentalRouteSplice)
      : null,
    loopSourceChanges: sourceChanges,
    loopTargetChanges: targetChanges,
    loopTargetAmbiguousEdgeIds: [...(view.purity?.loopTargetGeneralizationAmbiguousEdgeIds ?? [])].sort(),
    loopTargetNoCandidateEdgeIds: [...(view.purity?.loopTargetGeneralizationNoCandidateEdgeIds ?? [])].sort(),
    loopReturnEdgeCount: loopAttachments.length,
    legalLoopSourceCount: loopAttachments.filter((row) => row.source?.legal).length,
    legalLoopTargetCount: loopAttachments.filter((row) => row.target?.legal).length,
  };
}

export function canonicalGeometryFromSnapshot(snapshot) {
  return JSON.stringify({
    nodeBoxes: snapshot.nodes.map(({ id, box }) => [
      id, box.left, box.right, box.top, box.bottom, box.cx, box.cy, box.w, box.h,
    ]),
    routes: snapshot.routes.map((route) => [
      route.edgeId,
      route.source,
      route.target,
      route.sourcePort,
      route.targetPort,
      route.points,
    ]),
    orientation: snapshot.orientation.map((row) => [row.id, row.no, row.yes]),
  });
}

export function snapshotFromView(view, fixture, stage, provenance = {}) {
  const normalizedStage = String(stage).toUpperCase();
  const nodes = [...view.boxes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, box]) => boxRecord(id, box, view));
  const routes = view.routed.routes
    .slice()
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
    .map(routeRecord);
  const ports = [...(view.routed.ports ?? view.ports ?? new Map())]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(portRecord);
  const orientation = [...view.orientationMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(orientationRecord);
  const terminalNode = nodes.find((node) => node.id === view.terminalId) ?? null;
  const attachments = (view.attachments ?? [])
    .slice()
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
    .map(attachmentRecord);
  return {
    schemaVersion: PARITY_SCHEMA_VERSION,
    fixture,
    stage: normalizedStage,
    provenance: copy(provenance),
    stageTransformStack: [...(view.stageTransformStack ?? [])],
    terminal: terminalNode ? {
      id: view.terminalId,
      kind: terminalNode.kind,
      box: copy(terminalNode.box),
    } : null,
    orientation,
    nodes,
    routes,
    ports,
    diagnostics: {
      defects: copy(view.defects),
      orientationResult: view.orientationResult ? {
        rows: copy(view.orientationResult.rows),
        finalTotal: view.orientationResult.finalTotal,
        rareRepairCandidates: copy(view.orientationResult.rareRepairCandidates),
      } : null,
      attachments,
      stageEvidence: stageEvidence(view),
    },
  };
}

function indexBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function rowsEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

export function collectionDelta(beforeRows, afterRows, key) {
  const before = indexBy(beforeRows, key);
  const after = indexBy(afterRows, key);
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changed = [...before.keys()]
    .filter((id) => after.has(id) && !rowsEqual(before.get(id), after.get(id)))
    .sort();
  return { added, removed, changed };
}

export function geometryDelta(before, after) {
  return {
    nodes: collectionDelta(before.nodes, after.nodes, "id"),
    routes: collectionDelta(before.routes, after.routes, "edgeId"),
    ports: collectionDelta(before.ports, after.ports, "edgeId"),
    orientation: collectionDelta(before.orientation, after.orientation, "id"),
    terminalChanged: !rowsEqual(before.terminal, after.terminal),
  };
}

export function compareSnapshots(reference, candidate) {
  const delta = geometryDelta(reference, candidate);
  return {
    ...delta,
    nodeDiffCount: delta.nodes.added.length + delta.nodes.removed.length + delta.nodes.changed.length,
    routeDiffCount: delta.routes.added.length + delta.routes.removed.length + delta.routes.changed.length,
    portDiffCount: delta.ports.added.length + delta.ports.removed.length + delta.ports.changed.length,
    orientationDiffCount: delta.orientation.added.length + delta.orientation.removed.length + delta.orientation.changed.length,
  };
}
