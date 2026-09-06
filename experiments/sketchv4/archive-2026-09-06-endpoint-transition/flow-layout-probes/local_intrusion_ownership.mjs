// Pure harness diagnostic for classifying provisional node-edge intrusions against a
// focus real fork. This module imports no archived code and changes no geometry or score.

import { unrelatedNodeEdgeIntersections } from "./current_harness.mjs";

function membershipAtFork(path, focusFork) {
  const matches = path
    .map((token, pathIndex) => ({ token, pathIndex, match: /^(i-\d+)-(yes|no)$/.exec(String(token)) }))
    .filter((row) => row.match?.[1] === focusFork)
    .map((row) => ({ token: row.token, pathIndex: row.pathIndex, side: row.match[2] }));
  if (matches.length === 0) return { status: "outside", side: null, matches };
  if (matches.length === 1) return { status: "member", side: matches[0].side, matches };
  return { status: "ambiguous", side: null, matches };
}

function sourceTargetRelationship(sourceMembership, targetMembership) {
  if (sourceMembership.status === "ambiguous" || targetMembership.status === "ambiguous") return "ambiguous";
  if (sourceMembership.status === "outside" && targetMembership.status === "outside") return "both-outside";
  if (sourceMembership.status !== targetMembership.status) return "membership-disagreement";
  return sourceMembership.side === targetMembership.side ? "same-side" : "opposite-sides";
}

function classifyAtFork(sourcePath, nodePath, targetPath, focusFork) {
  const sourceMembership = membershipAtFork(sourcePath, focusFork);
  const nodeMembership = membershipAtFork(nodePath, focusFork);
  const targetMembership = membershipAtFork(targetPath, focusFork);
  const ambiguous = sourceMembership.status === "ambiguous" || nodeMembership.status === "ambiguous";
  const directlyAttributable = !ambiguous
    && sourceMembership.status === "member"
    && nodeMembership.status === "member"
    && sourceMembership.side !== nodeMembership.side;
  return {
    classification: ambiguous ? "ambiguous" : directlyAttributable ? "directly-attributable" : "unattributed",
    directlyAttributable,
    sourceMembership,
    targetMembership,
    nodeMembership,
    sourceTargetRelationship: sourceTargetRelationship(sourceMembership, targetMembership),
  };
}

function classifyViewIntrusions(view, focusFork, context = {}, { scanAllForks = false } = {}) {
  return unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes).map((intrusion) => {
    const route = view.routed.routes.find((row) => row.edgeId === intrusion.edgeId);
    if (!route) throw new Error(`${context.fixture ?? view.programName} ${focusFork}: missing route ${intrusion.edgeId}`);
    const edge = view.cfg.edgeById.get(intrusion.edgeId);
    const sourcePath = view.ownership.branchPath(route.source);
    const targetPath = view.ownership.branchPath(route.target);
    const nodePath = view.ownership.branchPath(intrusion.nodeId);
    const focusClassification = classifyAtFork(sourcePath, nodePath, targetPath, focusFork);
    const attributableForks = scanAllForks
      ? view.roles.realForkIds
        .filter((realForkId) => classifyAtFork(sourcePath, nodePath, targetPath, realForkId).directlyAttributable)
      : [];
    return {
      ...context,
      focusFork,
      edgeId: intrusion.edgeId,
      nodeId: intrusion.nodeId,
      segmentIndex: intrusion.segmentIndex,
      intersectingSegment: [intrusion.segmentStart, intrusion.segmentEnd],
      intersectionInterval: intrusion.intersectionInterval,
      edgeSource: route.source,
      edgeTarget: route.target,
      edgeBranch: edge?.branch ?? null,
      edgeRole: route.edgeRole,
      routeFamily: route.routeFamily,
      sourceBranchPath: sourcePath,
      targetBranchPath: targetPath,
      nodeBranchPath: nodePath,
      ...focusClassification,
      attributableForks,
      appearsAttributableToMultipleForks: attributableForks.length > 1,
      sourcePathBlindSemanticDeparture: route.source === focusFork
        && (edge?.branch === "yes" || edge?.branch === "no")
        && focusClassification.nodeMembership.status === "member"
        && edge.branch !== focusClassification.nodeMembership.side,
    };
  });
}

function departurePathForFork(view, edge, sourcePath, focusFork) {
  const semanticDepartureToken = edge?.from === focusFork
    && view.roles.realForkSet.has(focusFork)
    && (edge.branch === "yes" || edge.branch === "no")
    ? `${focusFork}-${edge.branch}`
    : null;
  return {
    semanticDepartureToken,
    edgeDeparturePath: semanticDepartureToken ? [...sourcePath, semanticDepartureToken] : [...sourcePath],
  };
}

function classifyViewIntrusionsWithDepartureAugmentation(view, focusFork, context = {}, { scanAllForks = false } = {}) {
  return classifyViewIntrusions(view, focusFork, context, { scanAllForks }).map((sourceRow) => {
    const edge = view.cfg.edgeById.get(sourceRow.edgeId);
    const departure = departurePathForFork(view, edge, sourceRow.sourceBranchPath, focusFork);
    const departureClassification = classifyAtFork(
      departure.edgeDeparturePath,
      sourceRow.nodeBranchPath,
      sourceRow.targetBranchPath,
      focusFork,
    );
    const departureAttributableForks = scanAllForks
      ? view.roles.realForkIds.filter((realForkId) => {
        const path = departurePathForFork(view, edge, sourceRow.sourceBranchPath, realForkId).edgeDeparturePath;
        return classifyAtFork(path, sourceRow.nodeBranchPath, sourceRow.targetBranchPath, realForkId).directlyAttributable;
      })
      : [];
    const route = view.routed.routes.find((row) => row.edgeId === sourceRow.edgeId);
    const routeSegmentCount = Math.max(0, (route?.points.length ?? 1) - 1);
    const isFinalSegment = sourceRow.segmentIndex === routeSegmentCount - 1;
    const departureTargetRegionMismatch = departure.semanticDepartureToken != null
      && (departureClassification.targetMembership.status !== "member"
        || departureClassification.targetMembership.side !== departureClassification.sourceMembership.side);
    const classificationChangedSolelyByDepartureToken = departure.semanticDepartureToken != null
      && sourceRow.classification !== departureClassification.classification;
    const wholeEdgeDepartureRisk = classificationChangedSolelyByDepartureToken
      && departureClassification.directlyAttributable
      && sourceRow.segmentIndex > 0
      && departureTargetRegionMismatch;
    return {
      ...sourceRow,
      sourcePathClassification: sourceRow.classification,
      sourcePathDirectlyAttributable: sourceRow.directlyAttributable,
      sourcePathMembership: sourceRow.sourceMembership,
      sourcePathTargetRelationship: sourceRow.sourceTargetRelationship,
      sourcePathAttributableForks: sourceRow.attributableForks,
      semanticDepartureToken: departure.semanticDepartureToken,
      edgeDeparturePath: departure.edgeDeparturePath,
      departurePathClassification: departureClassification.classification,
      departurePathDirectlyAttributable: departureClassification.directlyAttributable,
      departurePathMembership: departureClassification.sourceMembership,
      departureTargetRelationship: departureClassification.sourceTargetRelationship,
      departureAttributableForks,
      departureAppearsAttributableToMultipleForks: departureAttributableForks.length > 1,
      classificationChangedSolelyByDepartureToken,
      sourcePathBlindDepartureRecovered: sourceRow.sourcePathBlindSemanticDeparture
        && departureClassification.directlyAttributable,
      sourcePathBlindDepartureRemaining: sourceRow.sourcePathBlindSemanticDeparture
        && !departureClassification.directlyAttributable,
      routeSegmentCount,
      isFinalSegment,
      departureTargetRegionMismatch,
      wholeEdgeDepartureRisk,
      classification: departureClassification.classification,
      directlyAttributable: departureClassification.directlyAttributable,
      sourceMembership: departureClassification.sourceMembership,
      sourceTargetRelationship: departureClassification.sourceTargetRelationship,
      attributableForks: departureAttributableForks,
      appearsAttributableToMultipleForks: departureAttributableForks.length > 1,
    };
  });
}

export {
  classifyAtFork,
  classifyViewIntrusions,
  classifyViewIntrusionsWithDepartureAugmentation,
  departurePathForFork,
  membershipAtFork,
};
