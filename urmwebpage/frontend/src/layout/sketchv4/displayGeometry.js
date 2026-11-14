// Shared SVG display adaptation for static V4 and recorded construction states.
// This module selects recorded geometry and computes labels; it never runs layout.
import { getReplayEdges } from "./constructionHistory.js";

// Label anchor for an edge polyline: the point at half the *arclength* (not half the point
// count), optionally nudged perpendicular to the local segment so the label sits beside the
// edge rather than on it. The old `pts[floor(len/2)]` heuristic returned the *endpoint* of a
// 2-point branch-exit polyline ([sourcePort, targetTop]) — i.e. the target node's top port —
// which dropped "yes"/"no" labels onto the destination box. Arclength-midpoint puts a 2-point
// label at the true segment midpoint, clear of both the diamond and the target node.
// Degenerate inputs (empty / single / repeated points) fall back to a safe finite point.
export function labelPointForPolyline(points, { offset = 0 } = {}) {
  const pts = Array.isArray(points)
    ? points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return [pts[0][0], pts[0][1]];
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segLen.push(len);
    total += len;
  }
  if (total < 1e-6) return [pts[0][0], pts[0][1]]; // zero-length / coincident points
  const half = total / 2;
  let acc = 0;
  let si = 0;
  while (si < segLen.length - 1 && acc + segLen[si] < half) {
    acc += segLen[si];
    si += 1;
  }
  const a = pts[si];
  const b = pts[si + 1];
  const t = Math.max(0, Math.min(1, (half - acc) / (segLen[si] || 1)));
  const baseX = a[0] + (b[0] - a[0]) * t;
  const baseY = a[1] + (b[1] - a[1]) * t;
  if (!offset) return [baseX, baseY];
  // Unit perpendicular to the local segment, biased upward (negative y) so labels sit above
  // the edge regardless of branch side; for (near-)vertical segments this resolves to a
  // horizontal nudge, which still clears the line.
  let nx = -(b[1] - a[1]);
  let ny = b[0] - a[0];
  const nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen;
  ny /= nlen;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return [baseX + nx * offset, baseY + ny * offset];
}

// Perpendicular offset (layout px) applied to branch ("yes"/"no") labels so they sit beside
// the branch edge. Tuned to the current SVG scale (diamond/action node sizes, ~11px label
// font, render-time -3px nudge); large enough to clear the line, small enough not to drift.
const SKETCHV4_BRANCH_LABEL_OFFSET = 12;
export function adaptSketchV4Route(route, displayNodeId) {
  const points = route.points;
  const branch = route.edgeId.endsWith("-yes") ? "yes" : route.edgeId.endsWith("-no") ? "no" : null;
  const [labelX, labelY] = labelPointForPolyline(points, {
    offset: branch ? SKETCHV4_BRANCH_LABEL_OFFSET : 0,
  });
  return {
    id: route.edgeId, from: displayNodeId(route.source), to: displayNodeId(route.target),
    points, branch, type: route.routeFamily, labelX, labelY,
  };
}

// Only select/adapt recorded geometry. The final plan remains the authority for
// labels, dimensions, terminal identity, bounds, offsets, and graph/viewport scale.
export function buildConstructionDisplayGeometry(layoutPlan, state) {
  const terminalId = (layoutPlan.terminalCompatibility ?? layoutPlan.sketchV4TerminalCompatibility).internalNodeId;
  const displayNodeId = (id) => id === terminalId ? "halt" : id;
  const nodes = layoutPlan.nodes.flatMap((node) => {
    const placement = state.placements.get(node.id === "halt" ? terminalId : node.id);
    return placement ? [{ ...node, x: placement.cx, y: placement.cy }] : [];
  });
  const metadataByEdge = new Map(layoutPlan.edges.map((edge) => [edge.id, edge]));
  const edges = getReplayEdges(state).map((route) => {
    const edge = adaptSketchV4Route(route, displayNodeId);
    const debugPortCase = metadataByEdge.get(edge.id)?.debugPortCase;
    if (debugPortCase) edge.debugPortCase = debugPortCase;
    return edge;
  });
  return { nodes, edges };
}
