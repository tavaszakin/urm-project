// Optional observation of the selected V4 realization. Only ordered stage outputs
// are copied here; no placement, routing, orientation, or clearance decisions live here.

function immutableCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
    ));
  }
  return value;
}

// Share immutable event payloads with other constructors; V4 observation stays unchanged.
export function snapshotConstructionRecord(value) {
  return immutableCopy(value);
}

export function createConstructionRecorder(cfg) {
  const events = [];
  const armIds = new Set();
  const append = (event) => events.push(immutableCopy({ sequence: events.length, ...event }));

  return {
    recordSkeleton(skeleton) {
      // buildSkeleton inserts START, then its actual DFS placements, then builds arms.
      for (const [nodeId, placement] of skeleton.placements) {
        append({
          type: "node-placed", phase: "placement", nodeId, placement,
          placingEdgeId: cfg.incomingEdgeByNode.get(nodeId) ?? null,
        });
      }
      for (const arm of skeleton.armSegments) {
        armIds.add(arm.edgeId);
        append({ type: "branch-arm-created", phase: "branch-rays", edgeId: arm.edgeId, arm });
      }
    },

    recordBaseRoutes(routed) {
      for (const route of routed.routes) {
        append({
          type: "edge-routed", phase: "routing", edgeId: route.edgeId, route,
          portSelection: routed.ports.get(route.edgeId),
          // The base route enriches this existing ray; it is not a second drawable edge.
          reusesBranchArm: armIds.has(route.edgeId),
        });
      }
    },

    recordRevisions(phase, previous, replacement, records) {
      const beforeById = new Map(previous.routes.map((route) => [route.edgeId, route]));
      const afterById = new Map(replacement.routes.map((route) => [route.edgeId, route]));
      // B-E keep unchanged route objects. Their decision/record arrays preserve the
      // order in which replacement geometries were produced, including repeated edges.
      for (const { edgeId } of records) {
        const before = beforeById.get(edgeId);
        const after = afterById.get(edgeId);
        if (before === after) continue;
        append({
          type: "edge-replaced", phase, edgeId, before, after,
          portsBefore: previous.ports.get(edgeId),
          portsAfter: replacement.ports.get(edgeId),
        });
      }
    },

    finish({ terminalId, terminalIndex, terminal, placementBounds, renderBounds }) {
      append({
        type: "construction-complete", phase: "complete", realization: "selected",
        terminalId, terminalIndex, terminal, placementBounds, renderBounds,
      });
      return Object.freeze(events);
    },
  };
}

// Map containers belong to each reconstruction and should be treated as read-only.
// Their geometry values are immutable event snapshots, never live layout objects.
export function createConstructionReplayState() {
  return {
    placements: new Map(),
    armSegments: new Map(),
    routes: new Map(),
    ports: new Map(),
    completion: null,
  };
}

// Pure forward application: copy only the changed containers, never the input state.
export function applyConstructionEvent(state, event) {
  switch (event.type) {
    case "node-placed":
      return { ...state, placements: new Map(state.placements).set(event.nodeId, event.placement) };
    case "extension-committed": {
      const { route, nodeId, placingEdgeId, edgeId } = event;
      if (!nodeId || !event.placement || !event.portSelection || !route
        || route.target !== nodeId || route.edgeId !== edgeId || placingEdgeId !== edgeId
        || !state.placements.has(route.source) || state.placements.has(nodeId) || state.routes.has(edgeId)) {
        throw new Error("Invalid atomic construction extension");
      }
      return {
        ...state,
        placements: new Map(state.placements).set(nodeId, event.placement),
        routes: new Map(state.routes).set(edgeId, route),
        ports: new Map(state.ports).set(edgeId, event.portSelection),
      };
    }
    case "branch-arm-created":
      return { ...state, armSegments: new Map(state.armSegments).set(event.edgeId, event.arm) };
    case "edge-routed":
      return {
        ...state,
        routes: new Map(state.routes).set(event.edgeId, event.route),
        ports: new Map(state.ports).set(event.edgeId, event.portSelection),
      };
    case "edge-replaced":
      if (!state.routes.has(event.edgeId)) {
        throw new Error(`Cannot replace unrouted construction edge ${event.edgeId}`);
      }
      return {
        ...state,
        routes: new Map(state.routes).set(event.edgeId, event.after),
        ports: new Map(state.ports).set(event.edgeId, event.portsAfter),
      };
    case "construction-complete":
      return { ...state, completion: event };
    default:
      throw new Error(`Unknown construction event type: ${event.type}`);
  }
}

// eventCount is a prefix length: 0 is empty, history.length is complete.
export function replayConstructionHistory(history, eventCount = history.length) {
  if (!Number.isInteger(eventCount) || eventCount < 0 || eventCount > history.length) {
    throw new RangeError("Construction prefix must be an integer within the history");
  }
  let state = createConstructionReplayState();
  for (let i = 0; i < eventCount; i += 1) state = applyConstructionEvent(state, history[i]);
  return state;
}

// One drawable geometry per edge ID. A base route replaces its earlier branch-ray
// representation. Once all base routes exist, their original routing order is retained.
export function getReplayEdges(state) {
  const edges = [...state.routes.values()];
  for (const arm of state.armSegments.values()) {
    if (state.routes.has(arm.edgeId)) continue;
    edges.push({
      edgeId: arm.edgeId, source: arm.srcDiamond, target: arm.targetId,
      edgeRole: "branch-exit", routeFamily: "branch-exit",
      points: arm.points, sourcePort: arm.face, targetPort: arm.targetTop,
    });
  }
  return edges;
}
