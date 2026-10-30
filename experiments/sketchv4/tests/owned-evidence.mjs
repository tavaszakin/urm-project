import crypto from 'node:crypto';
import { unrelatedNodeEdgeIntersections } from '../../../urmwebpage/frontend/.flow-layout-probes/current_harness.mjs';
import { validateEdgeAttachments } from '../../../urmwebpage/frontend/src/layout/sketchv4/attachmentStubs.js';

export const visual = Object.freeze({
  sizeForKind: kind => kind === 'start' ? [48,18] : kind === 'conditionalJump' ? [82,46] : [88,30],
  branchAngleTan: Math.tan(33 * Math.PI / 180),
  pitch: {setupPitch:54,ordinaryPitch:82,branchRayDistance:126},
  clearance:16,
});
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function captureEvidence(layout, program, measureOwned) {
  const raw = unrelatedNodeEdgeIntersections(layout.routed.routes,layout.boxes);
  const owned = new Set();
  for (const fork of layout.roles.realForkIds) for (const event of measureOwned(layout,fork).events) owned.add(`${event.edgeId}/${event.segmentIndex}/${event.nodeId}`);
  const attachments = layout.routed.routes.map(route=>validateEdgeAttachments(route,layout.cfg.nodeById.get(route.source),layout.cfg.nodeById.get(route.target),route.points,{sourceBox:layout.boxes.get(route.source),targetBox:layout.boxes.get(route.target)}));
  const decisions = (layout.orientationResult?.rows ?? []).map(row=>({
    fork:row.realForkId,selected:row.v4AssignedBit,
    defaultPrimary:row.costDefault,flippedPrimary:row.costFlipped,
    defaultOwned:row.ownedDefault ?? null,flippedOwned:row.ownedFlipped ?? null,
  }));
  const geometry = {
    cfgNodes:layout.cfg.nodes,cfgEdges:layout.cfg.edges,
    boxes:[...layout.boxes],routes:layout.routed.routes,ports:[...layout.ports],
    orientations:[...layout.orientationMap],attachments,
  };
  const dx=-layout.renderBounds.minX+28,dy=-layout.renderBounds.minY+28;
  const svg = {
    viewBox:[0,0,layout.renderBounds.width+56,layout.renderBounds.height+56],
    nodes:[...layout.boxes].map(([id,b])=>({id,kind:layout.cfg.nodeById.get(id).kind,x:b.left+dx,y:b.top+dy,width:b.right-b.left,height:b.bottom-b.top})),
    routes:layout.routed.routes.map(route=>({id:route.edgeId,points:route.points.map(([x,y])=>[x+dx,y+dy])})),
  };
  const metrics = {
    primary:layout.defects.total,nodeOverlaps:layout.defects.nodeOverlapCount,crossings:layout.defects.crossingCount,
    edgeOverlaps:layout.defects.edgeOverlapCount,clearanceFailures:layout.defects.placementClearanceFailureCount,
    rawIntrusions:raw.length,ownedIntrusions:owned.size,
    illegalAttachments:attachments.filter(a=>!a.legal).map(a=>a.edgeId),
  };
  return {
    decisions,geometry,svg,metrics,
    approved:{programHash:digest(program),geometryHash:digest(geometry),svgHash:digest(svg),orientations:Object.fromEntries([...layout.orientationMap].map(([id,o])=>[id,o.no==='right'?'F':'D'])),decisions,metrics},
  };
}
