// Live adapter for the current native production stage of the immutable parity ladder.
// It applies no harness transforms: production buildLayout() must supply the entire candidate.

import { buildLayout } from "../../../../urmwebpage/frontend/src/layout/sketchv4/pipeline.js";
import { validateEdgeAttachments } from "../../../../urmwebpage/frontend/src/layout/sketchv4/attachmentStubs.js";

export const PRODUCTIONIZATION_VISUAL = Object.freeze({
  sizeForKind: (kind) => kind === "start" ? [48, 18]
    : kind === "conditionalJump" ? [82, 46]
      : [88, 30],
  branchAngleTan: Math.tan(33 * Math.PI / 180),
  pitch: Object.freeze({ setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126 }),
  // Retained as adapter inputs for API compatibility. Layer A made HALT placement dormant.
  terminalSize: Object.freeze([48, 18]),
  haltBandOffset: 154,
  clearance: 16,
});

function attachmentRecords(view) {
  return view.routed.routes.map((route) => validateEdgeAttachments(
    route,
    view.cfg.nodeById.get(route.source),
    view.cfg.nodeById.get(route.target),
    route.points,
    {
      sourceBox: view.boxes.get(route.source),
      targetBox: view.boxes.get(route.target),
    },
  ));
}

export function buildParityCandidate(program, fixture, stage, options = {}) {
  if (String(stage).toUpperCase() !== "C") {
    throw new Error(`current live production candidate is Stage C, not ${stage}`);
  }
  const pins = options.orientationMap
    ? new Map([...options.orientationMap].map(([id, orientation]) => [id, { ...orientation }]))
    : new Map();
  const view = buildLayout(program, {
    programName: fixture,
    orientationSource: "v4Assigned",
    visual: PRODUCTIONIZATION_VISUAL,
    pins,
    diagnostics: true,
  });
  const reentry = view.sameSideReentries.records[0] ?? null;
  const experimentalRouteSplice = reentry ? {
    edgeId: reentry.edgeId,
    edgeRole: reentry.edgeRole,
    routeFamily: reentry.routeFamily,
    connectorKind: reentry.connectorKind,
    routeShape: reentry.routeShape,
    corridorRule: reentry.corridorRule,
    clearance: reentry.clearance,
    corridorX: reentry.corridorX,
    oldSourcePort: reentry.oldSourcePort,
    newSourcePort: reentry.newSourcePort,
    oldTargetPort: reentry.oldTargetPort,
    newTargetPort: reentry.newTargetPort,
    oldRoutePoints: reentry.oldRoutePoints,
    newRoutePoints: reentry.newRoutePoints,
  } : null;
  return {
    ...view,
    mode: "production-layer-c",
    attachments: attachmentRecords(view),
    experimentalRouteSplices: view.conditionalMergeSources.decisions,
    experimentalRouteSplice,
    stageTransformStack: [
      "native production ordinary synthetic terminal",
      "native production adaptive conditional merge doorways and rays",
      "native production structural same-side continuation reentry",
    ],
    purity: {
      ...view.terminalConstruction,
      generalizedEligibleEdgeIds: view.conditionalMergeSources.eligibleEdgeIds,
      adaptiveChangedEdgeIds: view.conditionalMergeSources.shortenedEdgeIds,
      ...view.conditionalMergeSources.contract,
      sameSideReentryEligibleEdgeIds: view.sameSideReentries.eligibleEdgeIds,
      ...view.sameSideReentries.contract,
    },
  };
}
