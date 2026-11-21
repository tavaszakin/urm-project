import { buildLayoutPlan as buildConstructionPlan } from "./constructionDisplay.js";
import { createReceiverInspection } from "./inspect.js";

export function buildLayoutPlan(program, metadata, { recordEmbedding = true, spacingScale = 1, ordinaryPitch, rectangleWidth = 88 } = {}) {
  const pitch = spacingScale === 1 && ordinaryPitch == null ? undefined : {
    ordinaryPitch: ordinaryPitch ?? 82 * spacingScale,
    branchRayDistance: 126 * spacingScale,
    branchRayMin: 80 * spacingScale,
  };
  const sizedMetadata = rectangleWidth === 88 ? metadata : {
    ...metadata,
    layout: { ...metadata.layout, actionNodeWidth: rectangleWidth, unconditionalNodeWidth: rectangleWidth,
      rectangleLabelWidth: metadata.layout.actionNodeWidth },
  };
  const baseline = buildConstructionPlan(program, sizedMetadata, { recordConstruction: true, recordEmbedding, pitch });
  const failure = baseline.constructionFailure;
  const visual = { pitch, branchAngleTan: Math.tan((metadata.layout.branchAngleDeg ?? 33) * Math.PI / 180) };
  return {
    ...baseline,
    layoutMode: "sketchV53",
    constructionFailure: failure && {
      ...failure, message: failure.message.replace("SketchV5.1 (experimental)", "SketchV5.3 (experimental)"),
    },
    receiverOrdering: createReceiverInspection(program, baseline.constructionHistory, failure, { visual }),
  };
}
