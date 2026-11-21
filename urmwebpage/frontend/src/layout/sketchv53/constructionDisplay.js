// Adapt experimental V5.1 geometry to the existing renderer. Metadata supplies labels
// and dimensions only; none of its provisional positions enter construction.
import { buildLayout } from "./pipeline.js";
import { createMathematicalRecord } from "./mathematicalRecord.js";
import { adaptSketchV4Route } from "../sketchv4/displayGeometry.js";

export function buildLayoutPlan(program, metadata, options = {}) {
  const ld = metadata.layout;
  const result = buildLayout(program, {
    recordConstruction: options.recordConstruction === true,
    recordReceiverSides: options.recordEmbedding === true,
    visual: {
      sizeForKind: (kind) => kind === "start" ? [ld.terminalWidth, ld.terminalHeight]
        : kind === "conditionalJump" ? [ld.diamondWidth, ld.diamondHeight]
          : kind === "unconditionalJump" ? [ld.unconditionalNodeWidth, ld.unconditionalNodeHeight]
            : [ld.actionNodeWidth, ld.actionNodeHeight],
      branchAngleTan: Math.tan((ld.branchAngleDeg ?? 33) * Math.PI / 180),
      pitch: { setupPitch: 54, ordinaryPitch: 82, branchRayDistance: 126, ...options.pitch }, clearance: 16,
    },
  });
  const nodes = metadata.nodes.flatMap((node) => {
    const internalId = node.id === "halt" ? result.terminalId : node.id;
    const p = result.placements.get(internalId);
    return p ? [{ ...node, x: p.cx, y: p.cy,
      ...(node.id === "halt" ? { kind: "action", label: "HALT", isSyntheticTerminal: true } : {}),
    }] : [];
  });
  const displayId = (id) => id === result.terminalId ? "halt" : id;
  const rb = result.renderBounds;
  return {
    ...metadata,
    layoutMode: "sketchV51", constructionStatus: result.status, constructionFailure: result.failure,
    constructionIssues: result.issues, constructionCoverage: result.coverage,
    ...(result.constructionHistory ? { constructionHistory: result.constructionHistory } : {}),
    ...(options.recordEmbedding ? { mathematicalRecord: createMathematicalRecord(result) } : {}),
    nodes, edges: result.routes.map((route) => adaptSketchV4Route(route, displayId)),
    displayNodes: nodes.map((node) => node.displayNode).filter(Boolean),
    nodeMap: new Map(nodes.map((node) => [node.id, node])),
    width: rb.width + 56, height: rb.height + 56, offsetX: -rb.minX + 28, offsetY: -rb.minY + 28,
    placementBounds: result.placementBounds, renderBounds: rb,
    terminalCompatibility: { internalNodeId: result.terminalId, displayNodeId: "halt", displayLabel: "HALT", layoutKind: "action" },
  };
}
