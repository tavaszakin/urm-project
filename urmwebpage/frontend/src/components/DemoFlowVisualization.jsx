import KatexMath from "./KatexMath.jsx";
import "./DemoFlowVisualization.css";

const DEMO_FLOW_NODES = [
  {
    id: "input-state",
    type: "state",
    label: ["R_0=x,\\ R_1=y"],
    x: 260,
    y: 62,
  },
  {
    id: "setup",
    type: "action",
    label: ["\\text{Set counter}", "Z(2)"],
    instructionIndex: 0,
    x: 260,
    y: 125,
  },
  {
    id: "test",
    type: "decision",
    label: ["R_2=R_1?"],
    instructionIndex: 1,
    x: 260,
    y: 208,
  },
  {
    id: "add-one",
    type: "action",
    label: ["\\text{Add one}", "S(0)"],
    instructionIndex: 2,
    x: 260,
    y: 300,
  },
  {
    id: "count-one",
    type: "action",
    label: ["\\text{Count one}", "S(2)"],
    instructionIndex: 3,
    x: 260,
    y: 368,
  },
  {
    id: "loop",
    type: "action",
    label: ["\\text{Loop}", "J(0,0,1)"],
    instructionIndex: 4,
    x: 260,
    y: 436,
  },
  {
    id: "output-state",
    type: "state",
    label: ["R_0=x+y"],
    x: 260,
    y: 526,
  },
];

const DEMO_FLOW_ENDPOINT_LABELS = [
  {
    id: "start",
    label: ["\\text{Start}"],
    x: 260,
    y: 26,
  },
  {
    id: "halt",
    label: ["\\text{Halt}"],
    x: 260,
    y: 568,
  },
];

const DEMO_FLOW_EDGES = [
  { from: "start", to: "input-state", path: "M 260 38 L 260 47" },
  { from: "input-state", to: "setup", fromSide: "bottom", toSide: "top" },
  { from: "setup", to: "test", fromSide: "bottom", toSide: "top" },
  {
    from: "test",
    to: "output-state",
    label: "\\text{yes}",
    path: "M 300 208 L 390 208 L 390 496 L 260 496 L 260 511",
  },
  { from: "test", to: "add-one", label: "\\text{no}", fromSide: "bottom", toSide: "top" },
  { from: "add-one", to: "count-one", fromSide: "bottom", toSide: "top" },
  { from: "count-one", to: "loop", fromSide: "bottom", toSide: "top" },
  {
    from: "loop",
    to: "test",
    label: "\\text{repeat}",
    path: "M 213 436 L 125 436 L 125 208 L 220 208",
  },
  { from: "output-state", to: "halt", path: "M 260 541 L 260 554" },
];

const DEMO_FLOW_NODE_BY_ID = Object.fromEntries(DEMO_FLOW_NODES.map((node) => [node.id, node]));
const DEMO_FLOW_INSTRUCTION_TO_NODE = {
  0: "setup",
  1: "test",
  2: "add-one",
  3: "count-one",
  4: "loop",
};

const DEMO_FLOW_NODE_SIZE = {
  action: { width: 94, height: 48 },
  decision: { width: 80, height: 58 },
  state: { width: 116, height: 30 },
};

const DEMO_FLOW_LABEL_SIZE = {
  action: { width: 84, height: 38 },
  decision: { width: 70, height: 30 },
  state: { width: 104, height: 22 },
  endpoint: { width: 82, height: 24 },
};

function getNodeSize(node) {
  return DEMO_FLOW_NODE_SIZE[node.type] ?? DEMO_FLOW_NODE_SIZE.action;
}

function getNodeConnectionPoint(node, side) {
  const { width, height } = getNodeSize(node);

  if (side === "left") return { x: node.x - width / 2, y: node.y };
  if (side === "right") return { x: node.x + width / 2, y: node.y };
  if (side === "top") return { x: node.x, y: node.y - height / 2 };
  return { x: node.x, y: node.y + height / 2 };
}

function getEdgePath(edge) {
  if (edge.path) return edge.path;

  const from = DEMO_FLOW_NODE_BY_ID[edge.from];
  const to = DEMO_FLOW_NODE_BY_ID[edge.to];

  if (!from || !to) return "";

  const start = getNodeConnectionPoint(from, edge.fromSide ?? "right");
  const end = getNodeConnectionPoint(to, edge.toSide ?? "left");
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function getEdgeLabelPoint(edge) {
  if (edge.from === "loop") return { x: 151, y: 322 };
  if (edge.from === "test" && edge.to === "output-state") return { x: 338, y: 191 };
  if (edge.from === "test" && edge.to === "add-one") return { x: 291, y: 255 };

  const from = DEMO_FLOW_NODE_BY_ID[edge.from];
  const to = DEMO_FLOW_NODE_BY_ID[edge.to];
  return {
    x: ((from?.x ?? 0) + (to?.x ?? 0)) / 2,
    y: ((from?.y ?? 0) + (to?.y ?? 0)) / 2 - 10,
  };
}

function getActiveNodeId(currentTraceStep, currentInstruction) {
  if (currentInstruction?.halted) {
    return "output-state";
  }

  if (!Number.isInteger(currentTraceStep) || currentTraceStep <= 0) {
    return "input-state";
  }

  return DEMO_FLOW_INSTRUCTION_TO_NODE[currentInstruction?.index] ?? "input-state";
}

function formatInstruction(instruction) {
  if (!Array.isArray(instruction) || instruction.length === 0) {
    return "\\text{START}";
  }

  const [opcode, ...args] = instruction;
  return `${opcode}(${args.join(", ")})`;
}

function formatRegisterExpression(index, value) {
  return `R_${index}=${Number.isFinite(value) ? value : 0}`;
}

function RegisterStrip({ registers }) {
  const visibleRegisters = Array.isArray(registers) && registers.length > 0 ? registers.slice(0, 3) : [0, 0, 0];

  return (
    <div className="demo-flow-registers" aria-label="Current registers">
      {visibleRegisters.map((value, index) => (
        <div key={index} className="demo-flow-register">
          <span className="demo-flow-register-value">
            <KatexMath expression={formatRegisterExpression(index, value)} fallback={`R${index}=${value ?? 0}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

function DemoFlowNode({ node, isActive }) {
  const { width, height } = getNodeSize(node);
  const nodeClassName = `demo-flow-svg-node demo-flow-svg-node-${node.type}${isActive ? " is-active" : ""}`;

  if (node.type === "decision") {
    const points = [
      `${node.x},${node.y - height / 2}`,
      `${node.x + width / 2},${node.y}`,
      `${node.x},${node.y + height / 2}`,
      `${node.x - width / 2},${node.y}`,
    ].join(" ");

    return (
      <g className={nodeClassName}>
        <polygon className="demo-flow-svg-node-shape" points={points} />
        <FlowNodeLabel node={node} />
      </g>
    );
  }

  return (
    <g className={nodeClassName}>
      <rect
        className="demo-flow-svg-node-shape"
        x={node.x - width / 2}
        y={node.y - height / 2}
        width={width}
        height={height}
        rx={node.type === "state" ? 4 : 6}
        ry={node.type === "state" ? 4 : 6}
      />
      <FlowNodeLabel node={node} />
    </g>
  );
}

function FlowNodeLabel({ node }) {
  const labelSize = DEMO_FLOW_LABEL_SIZE[node.type] ?? DEMO_FLOW_LABEL_SIZE.action;
  const labelLines = Array.isArray(node.label) ? node.label : [node.label];

  return (
    <foreignObject
      className="demo-flow-svg-node-label-object"
      x={node.x - labelSize.width / 2}
      y={node.y - labelSize.height / 2}
      width={labelSize.width}
      height={labelSize.height}
    >
      <div className="demo-flow-svg-node-label">
        {labelLines.map((line) => (
          <KatexMath key={line} expression={line} fallback={line} />
        ))}
      </div>
    </foreignObject>
  );
}

function FlowEndpointLabel({ endpoint, isActive }) {
  const labelSize = DEMO_FLOW_LABEL_SIZE.endpoint;
  const labelLines = Array.isArray(endpoint.label) ? endpoint.label : [endpoint.label];

  return (
    <foreignObject
      className={`demo-flow-svg-endpoint-label-object${isActive ? " is-active" : ""}`}
      x={endpoint.x - labelSize.width / 2}
      y={endpoint.y - labelSize.height / 2}
      width={labelSize.width}
      height={labelSize.height}
    >
      <div className="demo-flow-svg-endpoint-label">
        {labelLines.map((line) => (
          <KatexMath key={line} expression={line} fallback={line} />
        ))}
      </div>
    </foreignObject>
  );
}

function FlowEdgeLabel({ edge }) {
  if (!edge.label) return null;

  const labelPoint = getEdgeLabelPoint(edge);

  return (
    <foreignObject
      className="demo-flow-svg-edge-label-object"
      x={labelPoint.x - 34}
      y={labelPoint.y - 15}
      width={68}
      height={30}
    >
      <div className="demo-flow-svg-edge-label">
        <KatexMath expression={edge.label} fallback={edge.label} />
      </div>
    </foreignObject>
  );
}

function DemoFlowDiagram({ activeNodeId }) {
  return (
    <svg
      className="demo-flow-svg"
      viewBox="0 0 520 590"
      role="img"
      aria-labelledby="demo-flow-svg-title demo-flow-svg-desc"
    >
      <title id="demo-flow-svg-title">Addition demo flow diagram</title>
      <desc id="demo-flow-svg-desc">
        A directed flow diagram for the addition register machine, including the comparison branch and loop back.
      </desc>
      <defs>
        <marker
          id="demo-flow-arrow"
          className="demo-flow-arrow-marker"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path className="demo-flow-arrow-marker-path" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      <g className="demo-flow-svg-edges">
        {DEMO_FLOW_EDGES.map((edge) => {
          return (
            <g key={`${edge.from}-${edge.to}`} className="demo-flow-svg-edge">
              <path className="demo-flow-svg-edge-path" d={getEdgePath(edge)} markerEnd="url(#demo-flow-arrow)" />
              <FlowEdgeLabel edge={edge} />
            </g>
          );
        })}
      </g>

      <g className="demo-flow-svg-nodes">
        {DEMO_FLOW_NODES.map((node) => (
          <DemoFlowNode key={node.id} node={node} isActive={node.id === activeNodeId} />
        ))}
      </g>

      <g className="demo-flow-svg-endpoint-labels">
        {DEMO_FLOW_ENDPOINT_LABELS.map((endpoint) => (
          <FlowEndpointLabel key={endpoint.id} endpoint={endpoint} isActive={endpoint.id === activeNodeId} />
        ))}
      </g>
    </svg>
  );
}

export default function DemoFlowVisualization({
  currentTraceStep,
  currentInstruction,
  registers,
}) {
  const activeNodeId = getActiveNodeId(currentTraceStep, currentInstruction);
  const instructionText = formatInstruction(currentInstruction?.instruction);

  return (
    <section className="runner-toolbar-shell function-card demo-flow-card" aria-labelledby="demo-flow-title">
      <div className="demo-flow-card-header">
        <div>
          <h3 id="demo-flow-title" className="demo-flow-title">Flow view beta</h3>
          <p className="demo-flow-caption">
            Curated view for the addition demo. The trace table above remains the source of truth.
          </p>
        </div>
        <div className="demo-flow-step-pill">
          {`Step ${Number.isInteger(currentTraceStep) ? currentTraceStep : 0}`}
        </div>
      </div>

      <div className="demo-flow-body">
        <div className="demo-flow-diagram" aria-label="Addition demo flow">
          <DemoFlowDiagram activeNodeId={activeNodeId} />
        </div>

        <aside className="demo-flow-status" aria-label="Current flow status">
          <div className="demo-flow-status-block">
            <div className="demo-flow-status-label">Current instruction</div>
            <div className="demo-flow-instruction">
              <KatexMath expression={instructionText} fallback={instructionText} />
            </div>
          </div>
          <div className="demo-flow-status-block">
            <div className="demo-flow-status-label">Registers</div>
            <RegisterStrip registers={registers} />
          </div>
          <div className="demo-flow-note">
            Curated for the addition demo.
          </div>
        </aside>
      </div>
    </section>
  );
}
