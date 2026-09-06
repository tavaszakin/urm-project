// Harness-only local orientation selector using the frozen endpoint-transition
// ownership grammar. This module changes no production code and performs no
// lookahead, candidate completion, recursion, repair, or global enumeration.

import {
  buildComposedLoopEndpointRealizer,
  buildRawRoleOrdinaryTerminalBase,
  namedOrientationMap,
  summarizeView,
  unrelatedNodeEdgeIntersections,
} from "./current_harness.mjs";
import { classifyEndpointTransitionIntrusions } from "./endpoint_transition_intrusion_ownership.mjs";

const DEFAULT = Object.freeze({ no: "left", yes: "right" });
const FLIPPED = Object.freeze({ no: "right", yes: "left" });

const bitName = (orientation) => orientation?.no === "right" ? "F" : "D";
const cloneOrientation = (orientation) => ({ no: orientation.no, yes: orientation.yes });

function orientationMapObject(orientationMap) {
  return Object.fromEntries([...orientationMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, orientation]) => [id, bitName(orientation)]));
}

function transitionAwareCandidateMetrics(view, focusFork, context = {}) {
  const rawIntrusions = unrelatedNodeEdgeIntersections(view.routed.routes, view.boxes);
  const classifiedIntrusions = classifyEndpointTransitionIntrusions(
    view,
    focusFork,
    rawIntrusions,
    context,
  );
  const ownedIntrusions = classifiedIntrusions.filter((row) => row.directlyAttributable);
  const nodeOverlaps = view.defects.nodeOverlapCount;
  const properCrossings = view.defects.crossingCount;
  return {
    nodeOverlaps,
    properCrossings,
    ownedIntrusionCount: ownedIntrusions.length,
    rawIntrusionCount: rawIntrusions.length,
    productionCost: nodeOverlaps + properCrossings,
    total: nodeOverlaps + properCrossings + ownedIntrusions.length,
    ownedIntrusions,
    classifiedIntrusionCount: classifiedIntrusions.length,
    membershipReads: classifiedIntrusions.length * 3,
  };
}

function productionCandidateMetrics(view) {
  const nodeOverlaps = view.defects.nodeOverlapCount;
  const properCrossings = view.defects.crossingCount;
  return {
    nodeOverlaps,
    properCrossings,
    productionCost: nodeOverlaps + properCrossings,
    total: nodeOverlaps + properCrossings,
  };
}

function runLocalOrientationSweep(program, fixture, { ownedIntrusionScoring, captureCandidates = [] }) {
  const totalStarted = performance.now();
  const raw = buildRawRoleOrdinaryTerminalBase(program, fixture);
  const { realizeEndpoints } = buildComposedLoopEndpointRealizer(raw);
  const orientationMap = new Map(raw.roles.realForkIds.map((id) => [id, cloneOrientation(DEFAULT)]));
  const candidates = [];
  const candidateViews = new Map();
  const captureSet = new Set(captureCandidates);
  let candidateDiagramRealizations = 0;
  let classifiedIntrusionCount = 0;
  let membershipReads = 0;

  const selectionStarted = performance.now();
  for (const focusFork of raw.tree.bottomUp) {
    const resolvedBefore = orientationMapObject(orientationMap);

    orientationMap.set(focusFork, cloneOrientation(DEFAULT));
    const defaultView = realizeEndpoints(orientationMap);
    candidateDiagramRealizations += 1;
    const defaultMetrics = ownedIntrusionScoring
      ? transitionAwareCandidateMetrics(defaultView, focusFork, { fixture, focusFork, candidate: "D" })
      : productionCandidateMetrics(defaultView);
    if (captureSet.has(`${focusFork}:D`)) candidateViews.set(`${focusFork}:D`, defaultView);

    orientationMap.set(focusFork, cloneOrientation(FLIPPED));
    const flippedView = realizeEndpoints(orientationMap);
    candidateDiagramRealizations += 1;
    const flippedMetrics = ownedIntrusionScoring
      ? transitionAwareCandidateMetrics(flippedView, focusFork, { fixture, focusFork, candidate: "F" })
      : productionCandidateMetrics(flippedView);
    if (captureSet.has(`${focusFork}:F`)) candidateViews.set(`${focusFork}:F`, flippedView);

    classifiedIntrusionCount += (defaultMetrics.classifiedIntrusionCount ?? 0)
      + (flippedMetrics.classifiedIntrusionCount ?? 0);
    membershipReads += (defaultMetrics.membershipReads ?? 0) + (flippedMetrics.membershipReads ?? 0);
    const chooseFlipped = flippedMetrics.total < defaultMetrics.total;
    const decision = chooseFlipped ? "F" : "D";
    orientationMap.set(focusFork, cloneOrientation(chooseFlipped ? FLIPPED : DEFAULT));
    candidates.push({
      fixture,
      focusFork,
      resolvedBefore,
      default: defaultMetrics,
      flipped: flippedMetrics,
      decision,
      productionRelation: Math.sign(flippedMetrics.productionCost - defaultMetrics.productionCost),
      transitionAwareRelation: Math.sign(flippedMetrics.total - defaultMetrics.total),
    });
  }
  const selectionMs = performance.now() - selectionStarted;

  const finalStarted = performance.now();
  const frozenOrientationMap = new Map([...orientationMap].map(([id, orientation]) => [id, cloneOrientation(orientation)]));
  const finalView = realizeEndpoints(frozenOrientationMap);
  const finalRealizationMs = performance.now() - finalStarted;
  const finalSummary = summarizeView(finalView);
  const totalProbeMs = performance.now() - totalStarted;

  return {
    fixture,
    ownedIntrusionScoring,
    realForkCount: raw.roles.realForkIds.length,
    bottomUpOrder: [...raw.tree.bottomUp],
    candidateDiagramRealizations,
    classifiedIntrusionCount,
    membershipReads,
    orientationMap: orientationMapObject(frozenOrientationMap),
    namedOrientationMap: namedOrientationMap(finalView),
    candidates,
    candidateViews,
    finalView,
    finalSummary,
    runtime: {
      selectionMs,
      finalRealizationMs,
      totalProbeMs,
    },
  };
}

export {
  DEFAULT,
  FLIPPED,
  orientationMapObject,
  runLocalOrientationSweep,
  transitionAwareCandidateMetrics,
};
