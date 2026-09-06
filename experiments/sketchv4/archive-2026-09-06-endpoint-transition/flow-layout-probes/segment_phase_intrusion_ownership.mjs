// Pure harness diagnostic for assigning an existing routed segment to departure,
// body, arrival, or direct phase. This changes neither geometry nor orientation.

import {
  classifyViewIntrusionsWithDepartureAugmentation,
  departurePathForFork,
  membershipAtFork,
} from "./local_intrusion_ownership.mjs";

function segmentPhase(segmentIndex, routeSegmentCount) {
  if (routeSegmentCount === 1) return "direct";
  if (segmentIndex === 0) return "departure";
  if (segmentIndex === routeSegmentCount - 1) return "arrival";
  return "body";
}

function sameMembership(left, right) {
  return left.status === right.status && left.side === right.side;
}

function classifyPathAtFork(path, nodePath, focusFork) {
  const pathMembership = membershipAtFork(path, focusFork);
  const nodeMembership = membershipAtFork(nodePath, focusFork);
  const ambiguous = pathMembership.status === "ambiguous" || nodeMembership.status === "ambiguous";
  const directlyAttributable = !ambiguous
    && pathMembership.status === "member"
    && nodeMembership.status === "member"
    && pathMembership.side !== nodeMembership.side;
  return {
    classification: ambiguous ? "ambiguous" : directlyAttributable ? "directly-attributable" : "unattributed",
    directlyAttributable,
    pathMembership,
    nodeMembership,
  };
}

function classifyPhaseAtFork({
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
  const departureInterpretation = classifyPathAtFork(departure.edgeDeparturePath, nodePath, focusFork);
  const arrivalInterpretation = classifyPathAtFork(targetPath, nodePath, focusFork);
  const endpointMembershipsAgree = sameMembership(
    departureInterpretation.pathMembership,
    arrivalInterpretation.pathMembership,
  );
  const endpointExactPathsAgree = JSON.stringify(departure.edgeDeparturePath) === JSON.stringify(targetPath);

  if (phase === "body") {
    return {
      phase,
      phasePath: null,
      classification: "body-unowned",
      directlyAttributable: false,
      ambiguous: false,
      directSegmentUnresolved: false,
      semanticDepartureToken: departure.semanticDepartureToken,
      departurePath: departure.edgeDeparturePath,
      arrivalPath: targetPath,
      departureInterpretation,
      arrivalInterpretation,
      endpointMembershipsAgree,
      endpointExactPathsAgree,
      bodyEndpointConsensusDirect: endpointMembershipsAgree
        && departureInterpretation.directlyAttributable
        && arrivalInterpretation.directlyAttributable,
    };
  }

  if (phase === "direct") {
    const ambiguous = departureInterpretation.classification === "ambiguous"
      || arrivalInterpretation.classification === "ambiguous";
    const directSegmentUnresolved = !ambiguous && !endpointMembershipsAgree;
    const directlyAttributable = !ambiguous
      && !directSegmentUnresolved
      && departureInterpretation.directlyAttributable;
    return {
      phase,
      phasePath: endpointMembershipsAgree ? departure.edgeDeparturePath : null,
      classification: ambiguous
        ? "ambiguous"
        : directSegmentUnresolved
          ? "direct-segment-unresolved"
          : directlyAttributable
            ? "directly-attributable"
            : "unattributed",
      directlyAttributable,
      ambiguous,
      directSegmentUnresolved,
      semanticDepartureToken: departure.semanticDepartureToken,
      departurePath: departure.edgeDeparturePath,
      arrivalPath: targetPath,
      departureInterpretation,
      arrivalInterpretation,
      endpointMembershipsAgree,
      endpointExactPathsAgree,
      bodyEndpointConsensusDirect: false,
    };
  }

  const interpretation = phase === "departure" ? departureInterpretation : arrivalInterpretation;
  return {
    phase,
    phasePath: phase === "departure" ? departure.edgeDeparturePath : targetPath,
    classification: interpretation.classification,
    directlyAttributable: interpretation.directlyAttributable,
    ambiguous: interpretation.classification === "ambiguous",
    directSegmentUnresolved: false,
    semanticDepartureToken: departure.semanticDepartureToken,
    departurePath: departure.edgeDeparturePath,
    arrivalPath: targetPath,
    departureInterpretation,
    arrivalInterpretation,
    endpointMembershipsAgree,
    endpointExactPathsAgree,
    bodyEndpointConsensusDirect: false,
  };
}

function classifyViewIntrusionsBySegmentPhase(view, focusFork, context = {}, { scanAllForks = false } = {}) {
  return classifyViewIntrusionsWithDepartureAugmentation(view, focusFork, context).map((row) => {
    const edge = view.cfg.edgeById.get(row.edgeId);
    const phaseClassification = classifyPhaseAtFork({
      view,
      edge,
      sourcePath: row.sourceBranchPath,
      targetPath: row.targetBranchPath,
      nodePath: row.nodeBranchPath,
      segmentIndex: row.segmentIndex,
      routeSegmentCount: row.routeSegmentCount,
      focusFork,
    });
    const phaseAttributableForks = scanAllForks
      ? view.roles.realForkIds.filter((realForkId) => classifyPhaseAtFork({
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
      phase: phaseClassification.phase,
      phasePath: phaseClassification.phasePath,
      phaseClassification: phaseClassification.classification,
      phaseDirectlyAttributable: phaseClassification.directlyAttributable,
      phaseAmbiguous: phaseClassification.ambiguous,
      directSegmentUnresolved: phaseClassification.directSegmentUnresolved,
      semanticDepartureToken: phaseClassification.semanticDepartureToken,
      departurePath: phaseClassification.departurePath,
      arrivalPath: phaseClassification.arrivalPath,
      departureInterpretation: phaseClassification.departureInterpretation,
      arrivalInterpretation: phaseClassification.arrivalInterpretation,
      endpointMembershipsAgree: phaseClassification.endpointMembershipsAgree,
      endpointExactPathsAgree: phaseClassification.endpointExactPathsAgree,
      bodyEndpointConsensusDirect: phaseClassification.bodyEndpointConsensusDirect,
      phaseAttributableForks,
      phaseAppearsAttributableToMultipleForks: phaseAttributableForks.length > 1,
      previousSourceAttributionChanged: row.sourcePathDirectlyAttributable
        !== phaseClassification.directlyAttributable,
      previousWholeEdgeAttributionChanged: row.departurePathDirectlyAttributable
        !== phaseClassification.directlyAttributable,
    };
  });
}

export {
  classifyPathAtFork,
  classifyPhaseAtFork,
  classifyViewIntrusionsBySegmentPhase,
  segmentPhase,
};
