// Structural ownership and segment-phase attribution of unrelated node-edge intrusions.
// Pure geometry measurement; it never changes nodes, routes, ports, or semantic branches.
const INTRUSION_EPSILON = 1e-9;
function segmentInteriorInterval(start, end, box) {
	const dx = end[0] - start[0], dy = end[1] - start[1];
	if (Math.hypot(dx, dy) <= INTRUSION_EPSILON) return null;
	let low = 0, high = 1;
	for (const [origin, delta, minimum, maximum] of [[
		start[0],
		dx,
		box.left,
		box.right
	], [
		start[1],
		dy,
		box.top,
		box.bottom
	]]) {
		if (Math.abs(delta) <= INTRUSION_EPSILON) {
			if (!(origin > minimum + INTRUSION_EPSILON && origin < maximum - INTRUSION_EPSILON)) return null;
			continue;
		}
		const first = (minimum - origin) / delta;
		const second = (maximum - origin) / delta;
		low = Math.max(low, Math.min(first, second));
		high = Math.min(high, Math.max(first, second));
		if (high - low <= INTRUSION_EPSILON) return null;
	}
	if (high - low <= INTRUSION_EPSILON || high < -INTRUSION_EPSILON || low > 1 + INTRUSION_EPSILON) return null;
	const tStart = Math.max(0, low), tEnd = Math.min(1, high);
	if (tEnd - tStart <= INTRUSION_EPSILON) return null;
	const pointAt = (t) => [start[0] + dx * t, start[1] + dy * t];
	const startStrictlyInside = start[0] > box.left + INTRUSION_EPSILON && start[0] < box.right - INTRUSION_EPSILON && start[1] > box.top + INTRUSION_EPSILON && start[1] < box.bottom - INTRUSION_EPSILON;
	const endStrictlyInside = end[0] > box.left + INTRUSION_EPSILON && end[0] < box.right - INTRUSION_EPSILON && end[1] > box.top + INTRUSION_EPSILON && end[1] < box.bottom - INTRUSION_EPSILON;
	const crossesCompletelyThrough = !startStrictlyInside && !endStrictlyInside && tStart > INTRUSION_EPSILON && tEnd < 1 - INTRUSION_EPSILON;
	const penetrationKind = crossesCompletelyThrough ? "crosses-completely-through" : startStrictlyInside && endStrictlyInside ? "segment-contained-inside" : "enters-partway";
	return {
		tStart,
		tEnd,
		interval: [pointAt(tStart), pointAt(tEnd)],
		crossesCompletelyThrough,
		penetrationKind
	};
}
function unrelatedNodeEdgeIntersections(routes, boxes) {
	const intersections = [];
	for (const route of routes) for (let segmentIndex = 0; segmentIndex < route.points.length - 1; segmentIndex++) {
		const segmentStart = route.points[segmentIndex];
		const segmentEnd = route.points[segmentIndex + 1];
		if (Math.hypot(segmentEnd[0] - segmentStart[0], segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON) continue;
		const orientation = Math.abs(segmentEnd[1] - segmentStart[1]) <= INTRUSION_EPSILON ? "horizontal" : Math.abs(segmentEnd[0] - segmentStart[0]) <= INTRUSION_EPSILON ? "vertical" : "diagonal";
		for (const [nodeId, box] of boxes) {
			if (nodeId === route.source || nodeId === route.target) continue;
			const interior = segmentInteriorInterval(segmentStart, segmentEnd, box);
			if (!interior) continue;
			intersections.push({
				nodeId,
				edgeId: route.edgeId,
				nodeBox: {
					left: box.left,
					right: box.right,
					top: box.top,
					bottom: box.bottom
				},
				segmentIndex,
				segmentStart: [...segmentStart],
				segmentEnd: [...segmentEnd],
				orientation,
				intersectionInterval: interior.interval,
				parameterInterval: [interior.tStart, interior.tEnd],
				crossesCompletelyThrough: interior.crossesCompletelyThrough,
				penetrationKind: interior.penetrationKind
			});
		}
	}
	return intersections;
}
function membershipAtFork(path, focusFork) {
  const matches = path
    .map((token, pathIndex) => ({ token, pathIndex, match: /^(i-\d+)-(yes|no)$/.exec(String(token)) }))
    .filter((row) => row.match?.[1] === focusFork)
    .map((row) => ({ token: row.token, pathIndex: row.pathIndex, side: row.match[2] }));
  if (matches.length === 0) return { status: "outside", side: null, matches };
  if (matches.length === 1) return { status: "member", side: matches[0].side, matches };
  return { status: "ambiguous", side: null, matches };
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

function segmentPhase(segmentIndex, routeSegmentCount) {
  if (routeSegmentCount === 1) return "direct";
  if (segmentIndex === 0) return "departure";
  if (segmentIndex === routeSegmentCount - 1) return "arrival";
  return "body";
}

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

// Classify raw penetrations against one focus fork without changing geometry.
// Callers with existing raw measurements may supply them to avoid rescanning.
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


export function measureOwnedIntrusions(view, focusFork) {
  if (!focusFork) return { count: 0, events: [] };
  const events = classifyEndpointTransitionIntrusions(view, focusFork)
    .filter((row) => row.directlyAttributable);
  return { count: events.length, events };
}
