// Pure harness diagnostic for the fixed endpoint-state transition table. It assigns
// a local side to an existing segment without changing geometry or orientation.

import { unrelatedNodeEdgeIntersections } from "./current_harness.mjs";
import { departurePathForFork, membershipAtFork } from "./local_intrusion_ownership.mjs";
import { classifyViewIntrusionsBySegmentPhase, segmentPhase } from "./segment_phase_intrusion_ownership.mjs";

function stateFromMembership(membership) {
  if (membership.status === "member") return membership.side.toUpperCase();
  if (membership.status === "outside") return "OUTSIDE";
  return "AMBIGUOUS";
}

function transitionName(departureState, targetState) {
  return `${departureState} → ${targetState}`;
}

function classifyEndpointTransitionAtFork({
  view,
  edge,
  sourcePath,
  targetPath,
  nodePath,
  segmentIndex,
  routeSegmentCount,
  focusFork,
}) {
  const phase = segmentPhase(segmentIndex, routeSegmentCount);
  const departure = departurePathForFork(view, edge, sourcePath, focusFork);
  const departureMembership = membershipAtFork(departure.edgeDeparturePath, focusFork);
  const targetMembership = membershipAtFork(targetPath, focusFork);
  const nodeMembership = membershipAtFork(nodePath, focusFork);
  const departureState = stateFromMembership(departureMembership);
  const targetState = stateFromMembership(targetMembership);
  const transition = transitionName(departureState, targetState);
  const endpointAmbiguous = departureState === "AMBIGUOUS" || targetState === "AMBIGUOUS";
  const nodeAmbiguous = nodeMembership.status === "ambiguous";
  let segmentSide = null;
  let ownershipReason = "transition-unowned";
  let directSegmentUnresolved = false;

  if (phase === "direct") {
    if (!endpointAmbiguous && (departureState !== targetState)) {
      directSegmentUnresolved = true;
      ownershipReason = "direct-endpoint-disagreement";
    } else if (!endpointAmbiguous && (departureState === "YES" || departureState === "NO")) {
      segmentSide = departureState;
      ownershipReason = "direct-endpoint-consensus";
    } else if (!endpointAmbiguous) {
      ownershipReason = "direct-outside-consensus";
    }
  } else if (phase === "departure") {
    if (departureState === "YES" || departureState === "NO") {
      segmentSide = departureState;
      ownershipReason = "departure-side";
    } else if (!endpointAmbiguous) {
      ownershipReason = "departure-outside";
    }
  } else if (phase === "body") {
    if ((departureState === "YES" || departureState === "NO") && departureState === targetState) {
      segmentSide = departureState;
      ownershipReason = "same-side-endpoint-consensus";
    } else if (!endpointAmbiguous) {
      ownershipReason = "body-transition-unowned";
    }
  } else if (phase === "arrival") {
    if ((targetState === "YES" || targetState === "NO") && departureState === targetState) {
      segmentSide = targetState;
      ownershipReason = "target-side-same-transition";
    } else if ((targetState === "YES" || targetState === "NO") && departureState === "OUTSIDE") {
      segmentSide = targetState;
      ownershipReason = "target-side-from-outside";
    } else if (!endpointAmbiguous && targetState === "OUTSIDE") {
      ownershipReason = "arrival-target-outside";
    } else if (!endpointAmbiguous) {
      ownershipReason = "opposite-side-arrival-withheld";
    }
  }

  const ambiguous = endpointAmbiguous || (segmentSide != null && nodeAmbiguous);
  const directlyAttributable = !ambiguous
    && !directSegmentUnresolved
    && segmentSide != null
    && nodeMembership.status === "member"
    && segmentSide !== nodeMembership.side.toUpperCase();
  const classification = ambiguous
    ? "ambiguous"
    : directSegmentUnresolved
      ? "direct-segment-unresolved"
      : directlyAttributable
        ? "directly-attributable"
        : "unattributed";

  return {
    phase,
    semanticDepartureToken: departure.semanticDepartureToken,
    departurePath: departure.edgeDeparturePath,
    targetPath,
    nodePath,
    departureMembership,
    targetMembership,
    nodeMembership,
    departureState,
    targetState,
    transition,
    segmentSide,
    ownershipReason,
    endpointAmbiguous,
    ambiguous,
    directSegmentUnresolved,
    directlyAttributable,
    classification,
  };
}

// Lean focus-only path for the scoring experiment. It deliberately skips the
// historical classifier layers and optional all-fork audit used by the census.
// A caller that already computed raw intrusions can pass them to avoid rescanning
// route geometry.
function classifyEndpointTransitionIntrusions(
  view,
  focusFork,
  intrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes),
  context = {},
) {
  const routeById = new Map(view.routed.routes.map((route) => [route.edgeId, route]));
  return intrusions.map((intrusion) => {
    const route = routeById.get(intrusion.edgeId);
    if (!route) throw new Error(`${context.fixture ?? view.programName} ${focusFork}: missing route ${intrusion.edgeId}`);
    const edge = view.cfg.edgeById.get(intrusion.edgeId);
    const sourcePath = view.ownership.branchPath(route.source);
    const targetPath = view.ownership.branchPath(route.target);
    const nodePath = view.ownership.branchPath(intrusion.nodeId);
    const transitionClassification = classifyEndpointTransitionAtFork({
      view,
      edge,
      sourcePath,
      targetPath,
      nodePath,
      segmentIndex: intrusion.segmentIndex,
      routeSegmentCount: route.points.length - 1,
      focusFork,
    });
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
      routeSegmentCount: route.points.length - 1,
      sourceBranchPath: sourcePath,
      targetBranchPath: targetPath,
      nodeBranchPath: nodePath,
      ...transitionClassification,
    };
  });
}

function classifyViewIntrusionsByEndpointTransition(view, focusFork, context = {}, { scanAllForks = false } = {}) {
  return classifyViewIntrusionsBySegmentPhase(view, focusFork, context).map((row) => {
    const edge = view.cfg.edgeById.get(row.edgeId);
    const transitionClassification = classifyEndpointTransitionAtFork({
      view,
      edge,
      sourcePath: row.sourceBranchPath,
      targetPath: row.targetBranchPath,
      nodePath: row.nodeBranchPath,
      segmentIndex: row.segmentIndex,
      routeSegmentCount: row.routeSegmentCount,
      focusFork,
    });
    const transitionAttributableForks = scanAllForks
      ? view.roles.realForkIds.filter((realForkId) => classifyEndpointTransitionAtFork({
        view,
        edge,
        sourcePath: row.sourceBranchPath,
        targetPath: row.targetBranchPath,
        nodePath: row.nodeBranchPath,
        segmentIndex: row.segmentIndex,
        routeSegmentCount: row.routeSegmentCount,
        focusFork: realForkId,
      }).directlyAttributable)
      : [];
    return {
      ...row,
      ...transitionClassification,
      transitionAttributableForks,
      transitionAppearsAttributableToMultipleForks: transitionAttributableForks.length > 1,
      positionalPhaseDirectlyAttributable: row.phaseDirectlyAttributable,
      positionalPhaseClassification: row.phaseClassification,
      positionalPhaseAttributionChanged: row.phaseDirectlyAttributable
        !== transitionClassification.directlyAttributable,
    };
  });
}

export {
  classifyEndpointTransitionAtFork,
  classifyEndpointTransitionIntrusions,
  classifyViewIntrusionsByEndpointTransition,
  stateFromMembership,
  transitionName,
};
