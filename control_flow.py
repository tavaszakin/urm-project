from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch

from urm import Instruction, TraceStep, execute, instruction_to_string, validate_program


@dataclass(frozen=True)
class CFGNode:
    index: int
    instruction: Instruction
    label: str


@dataclass(frozen=True)
class CFGEdge:
    source: int
    target: int
    kind: str
    label: str
    is_backward: bool = False


@dataclass(frozen=True)
class ControlFlowGraph:
    nodes: List[CFGNode]
    edges: List[CFGEdge]


def build_control_flow_graph(program: List[Instruction]) -> ControlFlowGraph:
    """
    Build a static control-flow graph for a URM program.

    Design choice:
    - Every instruction Ik becomes one node.
    - Most instructions contribute a fall-through edge to I(k+1).
    - Jump instructions contribute:
      - a "next" edge for the not-taken branch, when I(k+1) exists
      - a "jump" edge to the explicit target Iq
    """
    validate_program(program)

    nodes: List[CFGNode] = []
    edges: List[CFGEdge] = []

    for index, instr in enumerate(program):
        nodes.append(
            CFGNode(
                index=index,
                instruction=instr,
                label=f"I{index}\n{instruction_to_string(instr)}",
            )
        )

        next_index = index + 1
        op = instr[0]

        if op == "J":
            _, _, _, target = instr
            if next_index < len(program):
                edges.append(
                    CFGEdge(
                        source=index,
                        target=next_index,
                        kind="fallthrough",
                        label="next",
                        is_backward=False,
                    )
                )

            edges.append(
                CFGEdge(
                    source=index,
                    target=target,
                    kind="jump",
                    label="jump",
                    is_backward=target <= index,
                )
            )
            continue

        if next_index < len(program):
            edges.append(
                CFGEdge(
                    source=index,
                    target=next_index,
                    kind="fallthrough",
                    label="next",
                    is_backward=False,
                )
            )

    return ControlFlowGraph(nodes=nodes, edges=edges)


def extract_trace_edges(trace: List[TraceStep]) -> Dict[Tuple[int, int], int]:
    """
    Count how many times each control-flow edge was actually traversed.

    The trace stores:
    - trace[i - 1].pc = pc before executing trace[i].instruction
    - trace[i].pc     = next pc after executing trace[i].instruction
    """
    traversals: Dict[Tuple[int, int], int] = {}

    for i in range(1, len(trace)):
        curr = trace[i]
        if curr.instruction is None:
            continue

        source_pc = trace[i - 1].pc
        target_pc = curr.pc

        if target_pc < 0:
            continue

        traversals[(source_pc, target_pc)] = traversals.get((source_pc, target_pc), 0) + 1

    return traversals


def _visited_instruction_counts(trace: List[TraceStep]) -> Dict[int, int]:
    counts: Dict[int, int] = {}

    for i in range(1, len(trace)):
        if trace[i].instruction is None:
            continue

        pc = trace[i - 1].pc
        counts[pc] = counts.get(pc, 0) + 1

    return counts


def _layout_vertical_spine(
    program: List[Instruction],
    x_main: float = 0.0,
    y_step: float = 1.8,
) -> Dict[int, Tuple[float, float]]:
    """
    Layout strategy:
    - place instructions on a single vertical spine in program order
    - this keeps the code view and CFG visually aligned
    - jumps are then drawn as curved side arrows
    """
    positions: Dict[int, Tuple[float, float]] = {}

    for index in range(len(program)):
        positions[index] = (x_main, -index * y_step)

    return positions


def _edge_rad(source: int, target: int, kind: str) -> float:
    if kind == "fallthrough":
        return 0.0

    distance = abs(target - source)
    magnitude = min(0.18 + 0.05 * max(distance - 1, 0), 0.55)
    return -magnitude if target > source else magnitude


def _draw_edge(
    ax,
    start: Tuple[float, float],
    end: Tuple[float, float],
    edge: CFGEdge,
    visit_count: int,
    show_edge_labels: bool,
) -> None:
    is_active = visit_count > 0

    if edge.kind == "fallthrough":
        color = "#8a8f98"
        linestyle = "-"
        base_width = 1.4
        alpha = 0.8
    else:
        color = "#4f6d8a" if not edge.is_backward else "#7a4e2d"
        linestyle = "--"
        base_width = 1.6
        alpha = 0.85

    if is_active:
        color = "#d94841" if edge.kind == "jump" else "#1f77b4"
        base_width = 2.6 + 0.45 * min(visit_count - 1, 4)
        linestyle = "-"
        alpha = 1.0

    rad = _edge_rad(edge.source, edge.target, edge.kind)
    patch = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=13,
        linewidth=base_width,
        linestyle=linestyle,
        color=color,
        alpha=alpha,
        shrinkA=16,
        shrinkB=16,
        connectionstyle=f"arc3,rad={rad}",
        zorder=2 if is_active else 1,
    )
    ax.add_patch(patch)

    if show_edge_labels:
        mid_x = (start[0] + end[0]) / 2.0
        mid_y = (start[1] + end[1]) / 2.0

        if edge.kind == "jump":
            x_offset = 0.55 if edge.target < edge.source else -0.55
            y_offset = 0.18 * (1 if edge.target < edge.source else -1)
        else:
            x_offset = 0.25
            y_offset = 0.0

        label = edge.label
        if visit_count > 1:
            label = f"{label} x{visit_count}"

        ax.text(
            mid_x + x_offset,
            mid_y + y_offset,
            label,
            fontsize=9,
            color=color,
            ha="center",
            va="center",
            bbox={
                "boxstyle": "round,pad=0.15",
                "fc": "white",
                "ec": "none",
                "alpha": 0.85,
            },
            zorder=4,
        )


def draw_control_flow_graph(
    program: List[Instruction],
    trace: Optional[List[TraceStep]] = None,
    ax=None,
    title: str = "URM Control-Flow Graph",
    node_width: float = 0.92,
    node_height: float = 0.72,
    show_edge_labels: bool = True,
) -> None:
    """
    Draw a pedagogical control-flow graph for a URM program.

    Visual language:
    - nodes are stacked vertically in instruction order
    - solid gray arrows show static fall-through
    - dashed blue/brown arrows show static jump structure
    - if a trace is provided, visited nodes and traversed edges are emphasized
    - repeated traversals increase edge weight and show "xN" in the label
    """
    cfg = build_control_flow_graph(program)
    positions = _layout_vertical_spine(program)
    traversal_counts = extract_trace_edges(trace) if trace is not None else {}
    visit_counts = _visited_instruction_counts(trace) if trace is not None else {}

    created_fig = False
    if ax is None:
        fig_height = max(5.5, 1.4 * len(program) + 1.2)
        _, ax = plt.subplots(figsize=(9.5, fig_height))
        created_fig = True

    ax.set_title(title, fontsize=14)

    for edge in cfg.edges:
        start = positions[edge.source]
        end = positions[edge.target]
        visit_count = traversal_counts.get((edge.source, edge.target), 0)
        _draw_edge(
            ax=ax,
            start=start,
            end=end,
            edge=edge,
            visit_count=visit_count,
            show_edge_labels=show_edge_labels,
        )

    for node in cfg.nodes:
        x, y = positions[node.index]
        visits = visit_counts.get(node.index, 0)
        visited = visits > 0

        facecolor = "#fff7e6" if not visited else "#ffe08a"
        edgecolor = "#444444" if not visited else "#d94841"
        linewidth = 1.4 if not visited else 2.4

        rect = plt.Rectangle(
            (x - node_width / 2.0, y - node_height / 2.0),
            node_width,
            node_height,
            facecolor=facecolor,
            edgecolor=edgecolor,
            linewidth=linewidth,
            zorder=3,
        )
        ax.add_patch(rect)

        label = node.label
        if visits > 1:
            label = f"{label}\nvisited x{visits}"

        ax.text(
            x,
            y,
            label,
            ha="center",
            va="center",
            fontsize=10,
            zorder=4,
        )

    legend_lines = [
        "Solid gray: fall-through edge",
        "Dashed blue/brown: static jump edge (brown indicates backward jump)",
    ]
    if trace is not None:
        legend_lines.append("Highlighted nodes/edges: actual execution path")
        legend_lines.append("Repeated traversals are shown as xN and thicker arrows")

    ax.text(
        1.75,
        positions[0][1] + 0.8,
        "\n".join(legend_lines),
        ha="left",
        va="top",
        fontsize=9,
        bbox={"boxstyle": "round,pad=0.35", "fc": "white", "ec": "#dddddd"},
    )

    ax.set_aspect("equal")
    ax.axis("off")

    max_y = positions[0][1] + 1.2
    min_y = positions[len(program) - 1][1] - 1.2
    ax.set_xlim(-2.4, 4.2)
    ax.set_ylim(min_y, max_y)

    if created_fig:
        plt.tight_layout()
        plt.show()


def _demo_program() -> List[Instruction]:
    """
    Small teaching example:
    - I1 is a conditional jump that is not taken at first
    - I4 is an unconditional backward jump, creating the loop
    - eventually I1 is taken forward to the halting exit
    """
    return [
        ("Z", 2),        # I0: loop counter R2 = 0
        ("J", 2, 1, 5),  # I1: if R2 == R1, jump forward to exit
        ("S", 0),        # I2: increment output register
        ("S", 2),        # I3: increment counter
        ("J", 0, 0, 1),  # I4: unconditional backward jump to loop test
        ("S", 3),        # I5: exit marker; then halt
    ]


def demo_control_flow() -> None:
    """
    Demo the static CFG beside the execution-overlay view.
    """
    program = _demo_program()
    result = execute(program, initial_registers=[4, 3, 0, 0])

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(15, max(6.5, 1.35 * len(program) + 1.0)),
        constrained_layout=True,
    )

    draw_control_flow_graph(
        program,
        trace=None,
        ax=axes[0],
        title="Static URM Control Flow",
    )
    draw_control_flow_graph(
        program,
        trace=result["trace"],
        ax=axes[1],
        title="Execution Overlay on Control Flow",
    )

    plt.show()


if __name__ == "__main__":
    demo_control_flow()
