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

export function buildParityCandidate(program, fixture, stage) {
  if (String(stage).toUpperCase() !== "B") {
    throw new Error(`current live production candidate is Stage B, not ${stage}`);
  }
  const view = buildLayout(program, {
    programName: fixture,
    orientationSource: "v4Assigned",
    visual: PRODUCTIONIZATION_VISUAL,
    diagnostics: true,
  });
  return {
    ...view,
    mode: "production-layer-b",
    attachments: attachmentRecords(view),
    experimentalRouteSplices: view.conditionalMergeSources.decisions,
    stageTransformStack: [
      "native production ordinary synthetic terminal",
      "native production adaptive conditional merge doorways and rays",
    ],
    purity: {
      ...view.terminalConstruction,
      generalizedEligibleEdgeIds: view.conditionalMergeSources.eligibleEdgeIds,
      adaptiveChangedEdgeIds: view.conditionalMergeSources.shortenedEdgeIds,
      ...view.conditionalMergeSources.contract,
    },
  };
}
