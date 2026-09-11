// Live production candidate adapter for the immutable Layer-A characterization data.
// This file never applies checkpoint transformations: it only supplies the canonical visual
// constants and exposes src/layout/sketchv4/pipeline.js in the parity verifier/viewer shape.

import { buildLayout } from "../../../../urmwebpage/frontend/src/layout/sketchv4/pipeline.js";
import { validateEdgeAttachments } from "../../../../urmwebpage/frontend/src/layout/sketchv4/attachmentStubs.js";

export const LAYER_A_VISUAL = Object.freeze({
  sizeForKind: (kind) => kind === "start" ? [48, 18]
    : kind === "conditionalJump" ? [82, 46]
      : [88, 30],
  branchAngleTan: Math.tan(33 * Math.PI / 180),
  pitch: Object.freeze({ setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126 }),
  // Retained as adapter inputs for API compatibility. Layer A never invokes halt placement.
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
  if (String(stage).toUpperCase() !== "A") {
    throw new Error(`live production Layer-A candidate does not construct stage ${stage}`);
  }
  const view = buildLayout(program, {
    programName: fixture,
    orientationSource: "v4Assigned",
    visual: LAYER_A_VISUAL,
    diagnostics: true,
  });
  return {
    ...view,
    mode: "production-layer-a",
    attachments: attachmentRecords(view),
    stageTransformStack: ["native production ordinary synthetic terminal"],
    purity: { ...view.terminalConstruction },
  };
}
