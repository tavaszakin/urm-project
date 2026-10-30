// SketchV4 — Phase 1 structural front half: CFG + DFS draw order.
//
// Pure/deterministic. Parses a raw URM program (array of instruction tuples) into
// CFG nodes + edges and computes the V4 DFS draw order using the irreducible
// traversal grammar carried over unchanged from SketchV3 (grammar rules 1-3):
//
//   1. DFS drawing order, starting at instruction 0.
//   2. No-branch INLINE / yes-branch LIFO-DEFERRED.
//   3. Placed-once nodes (the first DFS path to reach a node owns it).
//
// The traversal is FIXED and independent of orientation (visual side is a later
// phase). branchPath is intrinsic to this walk — every diamond branch appends its
// own edge id (`i-N-no` / `i-N-yes`) to the path, while plain continuations append
// nothing — so it is computed here and re-exposed by ownership.js as the public
// ownership interface. This matches SketchV3 walkFrom exactly: the no-branch inline
// step both appends the token and increments depth (SketchV3FlowDiagram.jsx:7056,
// 7058), so depth === branchPath.length is an invariant.
//
// This module reads NOTHING from SketchV3; it re-derives structure from the raw
// program so V4 can be validated against SketchV3 for parity rather than depending
// on it.

const START_ID = "start";
const SINK_ID = "halt";
const ORDINARY_TERMINAL_INSTRUCTION = Object.freeze(["Z", 0]);

// URM opcode -> node kind. A jump J(a,b,t) with a === b is unconditional (the
// condition is always true); otherwise it is a two-way conditional diamond. Every
// other opcode (Z/S/T) is a straight-line action. Matches BetaFlowDiagram
// getInstructionRole so V4 node ids/kinds line up with the production model.
function classifyKind(instruction) {
  const opcode = String(Array.isArray(instruction) ? instruction[0] : "").trim().toUpperCase();
  if (opcode !== "J") return "action";
  const a = Number(instruction[1]);
  const b = Number(instruction[2]);
  return a === b ? "unconditionalJump" : "conditionalJump";
}

function jumpTarget(instruction) {
  const t = Number(instruction[3]);
  return Number.isInteger(t) ? t : null;
}

export function nodeIdForIndex(index) {
  return `i-${index}`;
}

// Layer A production terminal topology. The synthetic instruction is deliberately
// introduced before role classification, ownership, orientation, placement, and routing.
// It is therefore an ordinary action throughout the layout engine; "HALT" is only a
// display label applied by the rendering adapter.
export function buildOrdinaryTerminalCfg(program) {
  const sourceProgram = Array.isArray(program) ? program : [];
  const terminalIndex = sourceProgram.length;
  const terminalId = nodeIdForIndex(terminalIndex);
  const redirectedExplicitJumpIndexes = [];
  const expectedTerminalIncomingEdgeIds = [];

  if (terminalIndex === 0) expectedTerminalIncomingEdgeIds.push("entry");
  for (let index = 0; index < terminalIndex; index += 1) {
    const instruction = sourceProgram[index];
    const kind = classifyKind(instruction);
    if (kind === "conditionalJump") {
      const target = jumpTarget(instruction);
      if (!Number.isInteger(target) || target < 0 || target >= terminalIndex) {
        expectedTerminalIncomingEdgeIds.push(`i-${index}-yes`);
      }
      if (index + 1 === terminalIndex) expectedTerminalIncomingEdgeIds.push(`i-${index}-no`);
    } else if (kind === "unconditionalJump") {
      const target = jumpTarget(instruction);
      if (!Number.isInteger(target) || target < 0 || target >= terminalIndex) {
        expectedTerminalIncomingEdgeIds.push(`i-${index}-jump`);
      }
    } else if (index + 1 === terminalIndex) {
      expectedTerminalIncomingEdgeIds.push(`i-${index}-cont`);
    }
  }
  expectedTerminalIncomingEdgeIds.sort();

  const augmentedProgram = sourceProgram.map((raw, index) => {
    const instruction = Array.isArray(raw) ? [...raw] : raw;
    if (Array.isArray(instruction) && String(instruction[0]).trim().toUpperCase() === "J") {
      const target = Number(instruction[3]);
      if (!Number.isInteger(target) || target < 0 || target >= terminalIndex) {
        instruction[3] = terminalIndex;
        redirectedExplicitJumpIndexes.push(index);
      }
    }
    return instruction;
  });
  augmentedProgram.push([...ORDINARY_TERMINAL_INSTRUCTION]);

  const cfg = buildCfg(augmentedProgram);
  const syntheticOutgoingEdgeId = cfg.outgoingByIndex.get(terminalIndex)?.cont?.id ?? null;

  // The normal builder has now performed traversal against the transformed topology.
  // Remove only its legacy sink artifact and the synthetic action's generated fallthrough.
  cfg.nodes = cfg.nodes.filter((node) => node.id !== SINK_ID);
  cfg.nodeById.delete(SINK_ID);
  cfg.edges = cfg.edges.filter((edge) => edge.id !== syntheticOutgoingEdgeId && edge.to !== SINK_ID);
  cfg.edgeById = new Map(cfg.edges.map((edge) => [edge.id, edge]));
  cfg.outgoingByIndex.set(terminalIndex, { yes: null, no: null, cont: null });
  cfg.sinkNodeId = terminalId;

  const terminalIncomingEdgeIds = cfg.edges
    .filter((edge) => edge.to === terminalId)
    .map((edge) => edge.id)
    .sort();

  return {
    cfg,
    sourceProgram,
    augmentedProgram,
    terminalIndex,
    terminalId,
    terminalIncomingEdgeIds,
    expectedTerminalIncomingEdgeIds,
    redirectedExplicitJumpIndexes,
    syntheticOutgoingEdgeId,
  };
}

// Build the CFG and DFS order. Returns a plain, serializable structure.
export function buildCfg(program) {
  const instructionCount = Array.isArray(program) ? program.length : 0;
  const isInstr = (i) => Number.isInteger(i) && i >= 0 && i < instructionCount;
  const targetIdFor = (t) => (isInstr(t) ? nodeIdForIndex(t) : SINK_ID);

  // ---- nodes ----
  const nodes = [];
  const nodeById = new Map();
  const nodeByIndex = new Map();
  const addNode = (node) => { nodes.push(node); nodeById.set(node.id, node); return node; };

  addNode({ id: START_ID, kind: "start", instructionIndex: null });
  for (let i = 0; i < instructionCount; i++) {
    const node = { id: nodeIdForIndex(i), kind: classifyKind(program[i]), instructionIndex: i };
    addNode(node);
    nodeByIndex.set(i, node);
  }
  addNode({ id: SINK_ID, kind: "halt", instructionIndex: null });

  // setupBoundary = index of the first conditional decision (everything strictly
  // before it is the pre-decision setup chain).
  let setupBoundary = instructionCount;
  for (let i = 0; i < instructionCount; i++) {
    if (nodeByIndex.get(i).kind === "conditionalJump") { setupBoundary = i; break; }
  }

  // ---- edges ----
  const edges = [];
  const edgeById = new Map();
  const outgoingByIndex = new Map(); // index -> { yes, no, cont }
  const addEdge = (edge) => {
    edge.isHalt = !isInstr(edge.targetIndex);
    edge.isLoop = isInstr(edge.targetIndex) && Number.isInteger(edge.sourceIndex) && edge.targetIndex <= edge.sourceIndex;
    edges.push(edge);
    edgeById.set(edge.id, edge);
    return edge;
  };

  addEdge({ id: "entry", from: START_ID, to: nodeIdForIndex(0), branch: null, sourceIndex: null, targetIndex: 0 });

  for (let i = 0; i < instructionCount; i++) {
    const node = nodeByIndex.get(i);
    const out = { yes: null, no: null, cont: null };
    if (node.kind === "conditionalJump") {
      const t = jumpTarget(program[i]);
      out.yes = addEdge({ id: `i-${i}-yes`, from: node.id, to: targetIdFor(t), branch: "yes", sourceIndex: i, targetIndex: t });
      out.no = addEdge({ id: `i-${i}-no`, from: node.id, to: targetIdFor(i + 1), branch: "no", sourceIndex: i, targetIndex: i + 1 });
    } else if (node.kind === "unconditionalJump") {
      const t = jumpTarget(program[i]);
      out.cont = addEdge({ id: `i-${i}-jump`, from: node.id, to: targetIdFor(t), branch: null, sourceIndex: i, targetIndex: t });
    } else {
      out.cont = addEdge({ id: `i-${i}-cont`, from: node.id, to: targetIdFor(i + 1), branch: null, sourceIndex: i, targetIndex: i + 1 });
    }
    outgoingByIndex.set(i, out);
  }

  // ---- DFS draw order (no-inline / yes-deferred / placed-once) ----
  const visited = new Set();
  const dfsOrder = [];
  const branchPathByNode = new Map(); // nodeId -> [branchEdgeId, ...]
  const depthByNode = new Map();
  const incomingEdgeByNode = new Map(); // nodeId -> id of the edge that first placed it
  const pendingYesStack = [];

  const walk = (startIndex, startBranchPath, startIncomingEdgeId) => {
    let idx = startIndex;
    let bp = startBranchPath;
    let incomingEdgeId = startIncomingEdgeId;
    while (isInstr(idx)) {
      const nodeId = nodeIdForIndex(idx);
      if (visited.has(nodeId)) return; // placed-once: this incoming edge is a re-entry (loop/merge), handled in roles
      visited.add(nodeId);
      dfsOrder.push(nodeId);
      branchPathByNode.set(nodeId, bp.slice());
      depthByNode.set(nodeId, bp.length);
      incomingEdgeByNode.set(nodeId, incomingEdgeId);

      const node = nodeByIndex.get(idx);
      const out = outgoingByIndex.get(idx);

      if (node.kind === "conditionalJump") {
        const yesE = out.yes;
        const noE = out.no;
        // yes-branch: LIFO-deferred (unless it is a structural stop: HALT, loop-return,
        // or a forward jump to an already-placed node = a merge-connector).
        if (yesE && !yesE.isHalt && !yesE.isLoop && !visited.has(yesE.to)) {
          pendingYesStack.push({ index: yesE.targetIndex, branchPath: [...bp, yesE.id], incomingEdgeId: yesE.id });
        }
        // no-branch: inline continuation (unless a structural stop).
        if (!noE || noE.isHalt || noE.isLoop || visited.has(noE.to)) return;
        bp = [...bp, noE.id];
        idx = noE.targetIndex;
        incomingEdgeId = noE.id;
        continue;
      }

      // non-diamond (action or unconditional jump): single continuation, no token.
      const contE = out.cont;
      if (!contE || contE.isHalt || contE.isLoop || visited.has(contE.to)) return;
      idx = contE.targetIndex;
      incomingEdgeId = contE.id;
    }
  };

  walk(0, [], "entry");
  while (pendingYesStack.length > 0) {
    const p = pendingYesStack.pop(); // LIFO
    walk(p.index, p.branchPath, p.incomingEdgeId);
  }

  return {
    instructionCount,
    setupBoundary,
    entryNodeId: START_ID,
    sinkNodeId: SINK_ID,
    nodes,
    nodeById,
    nodeByIndex,
    edges,
    edgeById,
    outgoingByIndex,
    dfsOrder,
    branchPathByNode,
    depthByNode,
    incomingEdgeByNode,
    isInstructionIndex: isInstr,
  };
}
