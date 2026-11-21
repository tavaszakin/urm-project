import { buildPhysicalEmbedding, counterclockwiseAngle } from "./physicalEmbedding.js";
import { snapshotConstructionRecord } from "../sketchv4/constructionHistory.js";

// Reconstruct the scheduler from the seed, successful operations and recorded
// skips. Each reconstruction starts at zero and owns all its mutable state.
export function createMathematicalRecord({ cfg, terminalId, constructionHistory: history, issues, receiverSideDecision }) {
  const logicalNodes = snapshotConstructionRecord(cfg.nodes.map(({ id, kind, instructionIndex }) => ({
    instructionId: id, kind, instructionIndex, displayId: id === terminalId ? "halt" : id,
  })));
  const logicalEdges = snapshotConstructionRecord(cfg.edges.map(({ id, from, to, branch }) => ({
    logicalEdgeId: id, sourceInstruction: from, targetInstruction: to, branchType: branch?.toUpperCase() ?? "ordinary",
  })));
  const edgesById = new Map(logicalEdges.map((edge) => [edge.logicalEdgeId, edge]));
  const outgoing = new Map(cfg.nodes.map(({ id, instructionIndex }) => {
    const edges = cfg.outgoingByIndex.get(instructionIndex);
    return [id, { no: edges?.no?.id, yes: edges?.yes?.id, ordinary: edges?.cont?.id }];
  }));

  function inspect(eventCount = history.length) {
    if (!Number.isInteger(eventCount) || eventCount < 0 || eventCount > history.length) {
      throw new RangeError("Invalid mathematical record prefix length");
    }
    const placed = new Map();
    const deferredYes = [];
    const events = [];
    const committed = new Set();
    const observedRoutes = [];
    const skipped = [];
    let current = null;
    let stopped = false;
    const resume = () => {
      if (!current && deferredYes.length) current = { ...deferredYes.pop(), resumed: true };
    };
    const place = ({ nodeId, placingEdgeId, placement, sequence }) => placed.set(nodeId, {
      instructionId: nodeId, placingEdgeId, eventIndex: sequence,
      selectedOrientation: placement.branchOrientation ?? null,
      kind: placement.kind, box: placement.box,
    });
    let issueIndex = 0;
    for (let index = 0; index <= eventCount; index += 1) {
      // At an intermediate boundary show the next scheduled item immediately
      // after the selected commit. At the end also apply trailing skips/failure.
      if (index < eventCount || eventCount === history.length) {
        while (issues[issueIndex]?.atSequence === index) {
          const { code, edgeId, status } = issues[issueIndex++];
          if (code === "unsupported-instruction") {
            if (current?.logicalEdgeId !== edgeId) throw new Error("Inconsistent skipped work item");
            skipped.push({ eventIndex: index, workItem: current, code });
            current = null;
            resume();
          }
          if (status === "failed") stopped = true;
        }
      }
      if (index === eventCount) break;
      const event = history[index];
      if (event.type === "node-placed") {
        place(event);
        current = { logicalEdgeId: "entry", depth: 0 };
        continue;
      }
      if (event.type === "construction-complete") continue;
      if (event.edgeId !== current?.logicalEdgeId || !["extension-committed", "edge-routed"].includes(event.type)) {
        throw new Error("Inconsistent committed work item");
      }
      const edge = edgesById.get(event.edgeId);
      const extend = event.type === "extension-committed";
      events.push({ eventIndex: index, logicalEdgeId: event.edgeId, operation: extend ? "Extend" : "Connect",
        sourceInstruction: edge.sourceInstruction, targetInstruction: edge.targetInstruction,
        introducedInstruction: extend ? event.nodeId : null, workItem: current });
      committed.add(event.edgeId);
      observedRoutes.push({
        eventIndex: index, logicalEdgeId: event.edgeId,
        sourceInstruction: edge.sourceInstruction, targetInstruction: edge.targetInstruction,
        points: event.route.points,
        sourcePort: event.validation.attachments.source.portName,
        targetPort: event.validation.attachments.target.portName,
        sharedTerminalApproach: event.validation.sharedTerminalApproach === true,
      });

      const completed = current;
      current = null;
      if (extend) {
        place(event);
        const depth = completed.depth + Number(edge.branchType !== "ordinary");
        const next = outgoing.get(event.nodeId);
        if (event.placement.branchOrientation) {
          const orientation = event.placement.branchOrientation;
          const branchWork = (branch) => {
            const logicalEdgeId = next[branch];
            const side = orientation[branch];
            return { logicalEdgeId, depth, orientation, side,
              doorway: { source: event.nodeId, edgeId: logicalEdgeId, branch, side } };
          };
          deferredYes.push(branchWork("yes"));
          current = branchWork("no");
        } else if (next.ordinary) {
          current = { logicalEdgeId: next.ordinary, depth, doorway: completed.doorway };
        }
      }
      resume();
    }

    const pendingConnections = [];
    const targets = new Map();
    for (const edge of logicalEdges) {
      if (committed.has(edge.logicalEdgeId)) continue;
      const sourcePlaced = placed.has(edge.sourceInstruction);
      const targetPlaced = placed.has(edge.targetInstruction);
      pendingConnections.push({ ...edge, sourcePlaced, targetPlaced, connectionCommitted: false,
        sourceAttachment: { status: "undetermined" }, targetAttachment: { status: "undetermined" } });
      if (sourcePlaced && !targetPlaced) {
        if (!targets.has(edge.targetInstruction)) targets.set(edge.targetInstruction, []);
        targets.get(edge.targetInstruction).push(edge.logicalEdgeId);
      }
    }

    const attachments = observedRoutes.flatMap((route) => ["source", "target"].map((sourceOrTarget) => {
      const source = sourceOrTarget === "source";
      const instructionId = source ? route.sourceInstruction : route.targetInstruction;
      const position = source ? route.points[0] : route.points.at(-1);
      const { cx, cy } = placed.get(instructionId).box;
      return { attachmentId: route.logicalEdgeId + ":" + sourceOrTarget, logicalEdgeId: route.logicalEdgeId,
        instructionId, sourceOrTarget, status: "committed", actualPort: route[sourceOrTarget + "Port"], position,
        circularPosition: counterclockwiseAngle(position[0] - cx, position[1] - cy) };
    }));
    const atInstruction = new Map([...placed.keys()].map((id) => [id, new Map()]));
    for (const attachment of attachments) {
      const groups = atInstruction.get(attachment.instructionId);
      const key = attachment.position.join(",");
      if (!groups.has(key)) groups.set(key, { position: attachment.position,
        circularPosition: attachment.circularPosition, attachmentIds: [] });
      groups.get(key).attachmentIds.push(attachment.attachmentId);
    }
    const attachmentOrders = [...atInstruction].map(([instructionId, groups]) => ({
      instructionId, groups: [...groups.values()].sort((a, b) => a.circularPosition - b.circularPosition),
    }));
    return snapshotConstructionRecord({
      schemaVersion: 1, eventCount, historyLength: history.length, terminalId,
      logicalNodes, logicalEdges, events, placedInstructions: [...placed.values()],
      pendingConnections,
      unplacedTargets: [...targets].map(([targetInstruction, logicalEdgeIds]) => ({ targetInstruction, logicalEdgeIds })),
      scheduler: { current, deferredYes, skipped, stopped,
        currentConnection: current ? edgesById.get(current.logicalEdgeId) : null },
      ...(receiverSideDecision ? { prospectiveReceiverSides: {
        ...receiverSideDecision, selections: receiverSideDecision.selections.filter(({ sequence }) => sequence < eventCount),
      } } : {}),
      observedRoutes, attachments, attachmentOrders,
      ...buildPhysicalEmbedding(placed, observedRoutes),
    });
  }

  return Object.freeze({ inspect });
}
