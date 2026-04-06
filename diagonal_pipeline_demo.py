from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Rectangle

from program_transformer_demo import (
    ProgramTransformationResult,
    example_add_program,
    transform_append_increment,
)
from smn_demo import SpecializationResult, specialize_2arg_program
from urm import Instruction, instruction_to_string, validate_program


TransformerFn = Callable[[Sequence[Instruction]], ProgramTransformationResult]


@dataclass(frozen=True)
class IndexProgramAdapter:
    index_label: str
    index_value: int
    program: List[Instruction]
    source_note: str


@dataclass(frozen=True)
class DiagonalSpecializationData:
    input_index_label: str
    input_index_value: int
    source_program: List[Instruction]
    specialization: SpecializationResult
    symbolic_label: str


@dataclass(frozen=True)
class DiagonalPipelineData:
    adapter: IndexProgramAdapter
    diagonal_stage: DiagonalSpecializationData
    transformed_stage: ProgramTransformationResult
    transformed_symbolic_label: str
    transformer_name: str
    summary: Dict[str, object]


def format_index_label(label: str) -> str:
    return label.strip() if label.strip() else "x"


def _resolve_index_program(
    index_x: int,
    program: Optional[Sequence[Instruction]] = None,
    index_label: str = "x",
) -> IndexProgramAdapter:
    if index_x < 0:
        raise ValueError("index_x must be nonnegative.")

    resolved_program = list(program) if program is not None else example_add_program()
    validate_program(resolved_program)

    return IndexProgramAdapter(
        index_label=format_index_label(index_label),
        index_value=index_x,
        program=resolved_program,
        source_note=(
            "Concrete demo adapter: we represent the symbolic index by a chosen URM program, "
            "while keeping the index label visible in the diagram."
        ),
    )


def diagonal_specialize(
    index_x: int,
    program: Optional[Sequence[Instruction]] = None,
    *,
    index_label: str = "x",
) -> DiagonalSpecializationData:
    adapter = _resolve_index_program(index_x=index_x, program=program, index_label=index_label)
    specialization = specialize_2arg_program(
        program=adapter.program,
        fixed_value=adapter.index_value,
    )
    label = f"s({adapter.index_label}, {adapter.index_label})"

    return DiagonalSpecializationData(
        input_index_label=adapter.index_label,
        input_index_value=adapter.index_value,
        source_program=adapter.program,
        specialization=specialization,
        symbolic_label=label,
    )


def apply_transformer_to_specialized(
    index_x: int,
    program: Optional[Sequence[Instruction]] = None,
    *,
    transformer: TransformerFn = transform_append_increment,
    index_label: str = "x",
) -> ProgramTransformationResult:
    diagonal_data = diagonal_specialize(
        index_x=index_x,
        program=program,
        index_label=index_label,
    )
    return transformer(diagonal_data.specialization.specialized_program)


def build_diagonal_pipeline(
    index_x: int,
    program: Optional[Sequence[Instruction]] = None,
    *,
    transformer: TransformerFn = transform_append_increment,
    index_label: str = "x",
) -> DiagonalPipelineData:
    adapter = _resolve_index_program(index_x=index_x, program=program, index_label=index_label)
    diagonal_stage = diagonal_specialize(
        index_x=index_x,
        program=adapter.program,
        index_label=adapter.index_label,
    )
    transformed_stage = transformer(diagonal_stage.specialization.specialized_program)
    transformed_symbolic_label = f"f({diagonal_stage.symbolic_label})"

    return DiagonalPipelineData(
        adapter=adapter,
        diagonal_stage=diagonal_stage,
        transformed_stage=transformed_stage,
        transformed_symbolic_label=transformed_symbolic_label,
        transformer_name=transformed_stage.transformer_name,
        summary={
            "input_length": len(adapter.program),
            "specialized_length": len(diagonal_stage.specialization.specialized_program),
            "transformed_length": len(transformed_stage.transformed_program),
            "prelude_length": diagonal_stage.specialization.summary["prelude_length"],
            "transformer_added_length": len(transformed_stage.appended_block),
            "self_application_note": (
                f"The same symbol {adapter.index_label} is used both as the program index "
                f"and as the fixed parameter in the specialization stage."
            ),
        },
    )


def _preview_lines(program: Sequence[Instruction], max_lines: int = 3) -> List[str]:
    lines = [instruction_to_string(instr) for instr in program[:max_lines]]
    if len(program) > max_lines:
        lines.append("...")
    return lines


def _draw_index_box(
    ax,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    subtitle: str,
    body_lines: Sequence[str],
    facecolor: str,
    edgecolor: str,
) -> None:
    rect = Rectangle(
        (x, y),
        width,
        height,
        facecolor=facecolor,
        edgecolor=edgecolor,
        linewidth=1.6,
    )
    ax.add_patch(rect)
    ax.text(
        x + 0.18,
        y + height - 0.32,
        title,
        ha="left",
        va="top",
        fontsize=12.3,
        fontweight="bold",
        color="#102a43",
    )
    ax.text(
        x + 0.18,
        y + height - 0.74,
        subtitle,
        ha="left",
        va="top",
        fontsize=9.3,
        color="#486581",
    )
    for row, line in enumerate(body_lines):
        ax.text(
            x + 0.18,
            y + height - 1.30 - 0.33 * row,
            line,
            ha="left",
            va="top",
            fontsize=9.2,
            color="#243447",
            family="monospace",
        )


def _draw_arrow(ax, start, end, color: str, linewidth: float = 1.8, connectionstyle: str = "arc3") -> None:
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=14,
            linewidth=linewidth,
            color=color,
            connectionstyle=connectionstyle,
        )
    )


def draw_diagonal_pipeline(
    pipeline: DiagonalPipelineData,
    *,
    ax=None,
    title: str = "Diagonal / Self-Application Construction",
) -> None:
    created_fig = False
    if ax is None:
        fig, ax = plt.subplots(figsize=(15, 6.5))
        created_fig = True
    else:
        fig = ax.figure

    fig.suptitle(title, fontsize=17, fontweight="bold", y=0.97)
    fig.text(
        0.5,
        0.925,
        r"$x \mapsto f(s(x,x))$",
        ha="center",
        va="top",
        fontsize=15,
        color="#102a43",
    )

    ax.axis("off")
    ax.set_xlim(0, 15)
    ax.set_ylim(0, 6.5)

    input_lines = [
        rf"symbolic index: ${pipeline.adapter.index_label}$",
        f"demo value: {pipeline.adapter.index_value}",
        f"program length: {len(pipeline.adapter.program)}",
    ]
    input_lines.extend(_preview_lines(pipeline.adapter.program, max_lines=2))

    specialized_lines = [
        rf"${pipeline.diagonal_stage.symbolic_label}$",
        f"prelude length: {pipeline.summary['prelude_length']}",
        f"program length: {pipeline.summary['specialized_length']}",
    ]
    specialized_lines.extend(
        _preview_lines(pipeline.diagonal_stage.specialization.specialized_program, max_lines=2)
    )

    transformed_lines = [
        rf"${pipeline.transformed_symbolic_label}$",
        f"added by f: {pipeline.summary['transformer_added_length']}",
        f"program length: {pipeline.summary['transformed_length']}",
    ]
    transformed_lines.extend(_preview_lines(pipeline.transformed_stage.transformed_program, max_lines=2))

    _draw_index_box(
        ax,
        x=0.9,
        y=1.5,
        width=3.1,
        height=3.8,
        title="input index x",
        subtitle="treat x as code",
        body_lines=input_lines,
        facecolor="#f8fafc",
        edgecolor="#8aa1b1",
    )
    _draw_index_box(
        ax,
        x=5.8,
        y=1.2,
        width=3.6,
        height=4.3,
        title="specialized index s(x,x)",
        subtitle="use x in both argument positions",
        body_lines=specialized_lines,
        facecolor="#eef4fb",
        edgecolor="#4e79a7",
    )
    _draw_index_box(
        ax,
        x=10.7,
        y=1.5,
        width=3.5,
        height=3.8,
        title="transformed index f(s(x,x))",
        subtitle="apply the computable transformer f",
        body_lines=transformed_lines,
        facecolor="#fff4dc",
        edgecolor="#b07a00",
    )

    _draw_arrow(ax, (4.05, 4.7), (5.75, 4.55), color="#4e79a7", connectionstyle="arc3,rad=0.08")
    _draw_arrow(ax, (4.05, 2.2), (5.75, 2.15), color="#4e79a7", connectionstyle="arc3,rad=-0.08")
    _draw_arrow(ax, (9.45, 3.35), (10.65, 3.35), color="#b07a00")

    ax.text(
        4.9,
        5.25,
        "same x",
        ha="center",
        va="bottom",
        fontsize=8.9,
        color="#4e79a7",
        fontweight="bold",
    )
    ax.text(
        4.9,
        1.42,
        "same x",
        ha="center",
        va="top",
        fontsize=8.9,
        color="#4e79a7",
        fontweight="bold",
    )
    ax.text(
        10.05,
        3.62,
        "then apply f",
        ha="center",
        va="bottom",
        fontsize=9.1,
        color="#b07a00",
        fontweight="bold",
    )

    ax.text(
        7.5,
        0.48,
        (
            "The same input x is first fed into the s-m-n constructor twice, "
            "producing a self-applied specialized index; then f acts on that output."
        ),
        ha="center",
        va="center",
        fontsize=9.2,
        color="#52606d",
    )

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def demo_diagonal_pipeline(
    index_x: int = 3,
    *,
    program: Optional[Sequence[Instruction]] = None,
    index_label: str = "x",
    show_figure: bool = True,
) -> DiagonalPipelineData:
    pipeline = build_diagonal_pipeline(
        index_x=index_x,
        program=program,
        index_label=index_label,
    )

    print("diagonal / self-application helper demo")
    print(f"  input index label:       {pipeline.adapter.index_label}")
    print(f"  concrete demo value:     {pipeline.adapter.index_value}")
    print(f"  source length:           {pipeline.summary['input_length']}")
    print(f"  s(x, x) length:          {pipeline.summary['specialized_length']}")
    print(f"  f(s(x, x)) length:       {pipeline.summary['transformed_length']}")
    print(f"  transformer block size:  {pipeline.summary['transformer_added_length']}")

    if show_figure:
        draw_diagonal_pipeline(pipeline)

    return pipeline


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="diagonal self-application pipeline demo")
    parser.add_argument("--x", type=int, default=3, help="concrete demo value for x")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    demo_diagonal_pipeline(index_x=args.x)
