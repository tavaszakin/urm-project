from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import matplotlib.pyplot as plt
from matplotlib.patches import ConnectionPatch, Rectangle

from urm import Instruction, execute, instruction_to_string, validate_program


@dataclass(frozen=True)
class ProgramOriginAnnotation:
    transformed_index: int
    instruction: Instruction
    origin: str
    source_index: Optional[int] = None
    block_label: str = ""


@dataclass(frozen=True)
class StructuralComparison:
    original_to_transformed: Dict[int, int]
    transformed_to_original: Dict[int, int]
    copied_indices: List[int]
    inserted_indices: List[int]


@dataclass(frozen=True)
class ProgramTransformationResult:
    original_program: List[Instruction]
    transformed_program: List[Instruction]
    appended_block: List[Instruction]
    annotations: List[ProgramOriginAnnotation]
    structural_comparison: StructuralComparison
    transformer_name: str
    transformer_equation: str
    summary: Dict[str, object]


def _clone_instruction(instr: Instruction) -> Instruction:
    return tuple(instr)


def compare_programs_structurally(
    original_program: Sequence[Instruction],
    transformed_program: Sequence[Instruction],
    original_to_transformed: Dict[int, int],
) -> StructuralComparison:
    transformed_to_original = {
        transformed_index: original_index
        for original_index, transformed_index in original_to_transformed.items()
    }
    copied_indices = sorted(transformed_to_original)
    inserted_indices = [
        index for index in range(len(transformed_program))
        if index not in transformed_to_original
    ]

    return StructuralComparison(
        original_to_transformed=dict(original_to_transformed),
        transformed_to_original=transformed_to_original,
        copied_indices=copied_indices,
        inserted_indices=inserted_indices,
    )


def _annotate_transformed_program(
    transformed_program: Sequence[Instruction],
    original_length: int,
    original_to_transformed: Dict[int, int],
    added_block_label: str,
) -> List[ProgramOriginAnnotation]:
    transformed_to_original = {
        transformed_index: original_index
        for original_index, transformed_index in original_to_transformed.items()
    }
    annotations: List[ProgramOriginAnnotation] = []

    for index, instr in enumerate(transformed_program):
        source_index = transformed_to_original.get(index)
        if source_index is not None:
            annotations.append(
                ProgramOriginAnnotation(
                    transformed_index=index,
                    instruction=instr,
                    origin="copied",
                    source_index=source_index,
                    block_label="copied original program",
                )
            )
            continue

        annotations.append(
            ProgramOriginAnnotation(
                transformed_index=index,
                instruction=instr,
                origin="added",
                source_index=None,
                block_label=added_block_label,
            )
        )

    if len(transformed_program) < original_length:
        raise ValueError("transformed_program must not be shorter than original_program.")

    return annotations


def append_instruction_block(
    program: Sequence[Instruction],
    appended_block: Sequence[Instruction],
    *,
    transformer_name: str,
    transformer_equation: str,
    added_block_label: str,
) -> ProgramTransformationResult:
    validate_program(list(program))
    validate_program(list(appended_block))

    copied_program = [_clone_instruction(instr) for instr in program]
    copied_block = [_clone_instruction(instr) for instr in appended_block]
    transformed_program = copied_program + copied_block

    original_to_transformed = {
        original_index: original_index
        for original_index in range(len(copied_program))
    }
    annotations = _annotate_transformed_program(
        transformed_program=transformed_program,
        original_length=len(copied_program),
        original_to_transformed=original_to_transformed,
        added_block_label=added_block_label,
    )
    structural_comparison = compare_programs_structurally(
        original_program=copied_program,
        transformed_program=transformed_program,
        original_to_transformed=original_to_transformed,
    )

    return ProgramTransformationResult(
        original_program=copied_program,
        transformed_program=transformed_program,
        appended_block=copied_block,
        annotations=annotations,
        structural_comparison=structural_comparison,
        transformer_name=transformer_name,
        transformer_equation=transformer_equation,
        summary={
            "original_length": len(copied_program),
            "transformed_length": len(transformed_program),
            "copied_length": len(copied_program),
            "added_length": len(copied_block),
            "appended_start": len(copied_program),
            "jump_targets_shifted": False,
            "control_flow_note": (
                "The original instructions are copied verbatim. No internal jump target changes "
                "are needed because the transformer only appends code after the copied block."
            ),
        },
    )


def transform_append_increment(program: Sequence[Instruction]) -> ProgramTransformationResult:
    """
    Example computable transformer:
    copy the program and append S(0), so the transformed program increments
    the output register once after the copied computation reaches the end.
    """
    return append_instruction_block(
        program=program,
        appended_block=[("S", 0)],
        transformer_name="append_increment",
        transformer_equation=r"e \mapsto f(e)",
        added_block_label="added by transformer f",
    )


def draw_program_transformer_diagram(
    original_program: Sequence[Instruction],
    transformed_program: Sequence[Instruction],
    metadata: ProgramTransformationResult,
    *,
    ax_original=None,
    ax_transformed=None,
    title: str = "Computable Program Transformer",
) -> None:
    def _phase_style(origin: str) -> Tuple[str, str]:
        if origin == "added":
            return "#fff1d6", "#b07a00"
        return "#eaf4ea", "#5b7f5b"

    def _section_bounds(start: int, length: int) -> Optional[Tuple[float, float]]:
        if length <= 0:
            return None
        top = -start + 0.52
        bottom = -(start + length - 1) - 0.52
        return top, bottom

    def _draw_section_group(ax, start: int, length: int, label: str, accent: str) -> None:
        bounds = _section_bounds(start, length)
        if bounds is None:
            return
        top, bottom = bounds
        ax.text(
            1.32,
            (top + bottom) / 2.0,
            label,
            ha="left",
            va="center",
            fontsize=10.3,
            fontweight="bold",
            color=accent,
        )

    created_fig = False
    if ax_original is None or ax_transformed is None:
        fig_height = max(5.4, 0.58 * max(len(original_program), len(transformed_program)) + 2.1)
        fig, (ax_original, ax_transformed) = plt.subplots(
            1,
            2,
            figsize=(13.4, fig_height),
            constrained_layout=False,
        )
        fig.subplots_adjust(top=0.83, wspace=0.25)
        fig.suptitle(title, fontsize=17, fontweight="bold", y=0.97)
        fig.text(
            0.5,
            0.928,
            rf"${metadata.transformer_equation}$",
            ha="center",
            va="top",
            fontsize=15,
            color="#102a43",
        )
        fig.text(
            0.5,
            0.895,
            (
                "A computable transformer treats the program with index e as data, "
                "copies its code, and appends a short effective modification."
            ),
            ha="center",
            va="top",
            fontsize=9.6,
            color="#486581",
        )
        created_fig = True
    else:
        fig = ax_original.figure

    for ax in (ax_original, ax_transformed):
        ax.axis("off")

    ax_original.set_title(
        r"Program with index $e$",
        fontsize=13,
        fontweight="bold",
        pad=12,
    )
    ax_transformed.set_title(
        r"Program with index $f(e)$",
        fontsize=13,
        fontweight="bold",
        pad=12,
    )

    ax_original.text(
        0.0,
        1.02,
        "Original URM program",
        transform=ax_original.transAxes,
        ha="left",
        va="bottom",
        fontsize=9.4,
        color="#5f6c7b",
    )
    ax_transformed.text(
        0.0,
        1.02,
        "Copied code followed by the transformer block",
        transform=ax_transformed.transAxes,
        ha="left",
        va="bottom",
        fontsize=9.4,
        color="#5f6c7b",
    )

    original_y_positions: Dict[int, float] = {}
    transformed_y_positions: Dict[int, float] = {}

    for index, instr in enumerate(original_program):
        y = -index
        original_y_positions[index] = y
        rect = Rectangle((-0.05, y - 0.35), 1.05, 0.7, facecolor="#f8faf7", edgecolor="#5b7f5b")
        ax_original.add_patch(rect)
        ax_original.text(
            0.02,
            y,
            f"I{index}: {instruction_to_string(instr)}",
            ha="left",
            va="center",
            fontsize=10,
        )

    for annotation in metadata.annotations:
        y = -annotation.transformed_index
        transformed_y_positions[annotation.transformed_index] = y
        facecolor, edgecolor = _phase_style(annotation.origin)
        rect = Rectangle((-0.05, y - 0.35), 1.22, 0.7, facecolor=facecolor, edgecolor=edgecolor)
        ax_transformed.add_patch(rect)
        ax_transformed.text(
            0.02,
            y,
            f"I{annotation.transformed_index}: {instruction_to_string(annotation.instruction)}",
            ha="left",
            va="center",
            fontsize=9.6,
        )

    for original_index, transformed_index in metadata.structural_comparison.original_to_transformed.items():
        connection = ConnectionPatch(
            xyA=(1.0, original_y_positions[original_index]),
            coordsA=ax_original.transData,
            xyB=(-0.05, transformed_y_positions[transformed_index]),
            coordsB=ax_transformed.transData,
            color="#5b7f5b",
            linewidth=0.95,
            alpha=0.40,
        )
        ax_transformed.add_artist(connection)

    _draw_section_group(
        ax_transformed,
        start=0,
        length=len(metadata.original_program),
        label="Copied original block",
        accent="#5b7f5b",
    )
    _draw_section_group(
        ax_transformed,
        start=metadata.summary["appended_start"],
        length=len(metadata.appended_block),
        label="Added by f",
        accent="#b07a00",
    )

    boundary_y = -metadata.summary["appended_start"] + 0.5
    ax_transformed.plot([-0.05, 1.28], [boundary_y, boundary_y], color="#c0392b", linewidth=2.0)
    ax_transformed.text(
        1.33,
        boundary_y,
        "new code begins here",
        ha="left",
        va="center",
        fontsize=9.0,
        fontweight="bold",
        color="#c0392b",
    )
    ax_transformed.text(
        1.33,
        boundary_y - 0.78,
        "No jump-target shift is needed:\nonly an appended suffix is added.",
        ha="left",
        va="top",
        fontsize=8.8,
        color="#7b241c",
        bbox={"boxstyle": "round,pad=0.28", "fc": "#fff5f3", "ec": "#e7a39d"},
    )

    max_original = max(len(original_program) - 1, 0)
    max_transformed = max(len(transformed_program) - 1, 0)
    ax_original.set_xlim(-0.15, 1.05)
    ax_transformed.set_xlim(-0.15, 2.18)
    ax_original.set_ylim(-max_original - 1.0, 1.0)
    ax_transformed.set_ylim(-max_transformed - 1.0, 1.18)

    if created_fig and "agg" not in plt.get_backend().lower():
        plt.show()


def example_add_program() -> List[Instruction]:
    """
    Example program:
    - R1 = x
    - R2 = y
    - output in R0

    The program computes x + y by copying x into R0 and then looping y times.
    """
    return [
        ("T", 1, 0),
        ("Z", 3),
        ("J", 3, 2, 6),
        ("S", 0),
        ("S", 3),
        ("J", 0, 0, 2),
    ]


def demo_program_transformer(
    x: int = 3,
    y: int = 4,
    *,
    show_figure: bool = True,
    max_steps: Optional[int] = None,
) -> ProgramTransformationResult:
    program = example_add_program()
    transformation = transform_append_increment(program)

    original_result = execute(program, [0, x, y, 0], max_steps=max_steps)
    transformed_result = execute(
        transformation.transformed_program,
        [0, x, y, 0],
        max_steps=max_steps,
    )

    print("computable program transformer demo")
    print(f"  input registers:       R1 = {x}, R2 = {y}")
    print(f"  original output:       {original_result['output']}")
    print(f"  transformed output:    {transformed_result['output']}")
    print(f"  added instructions:    {len(transformation.appended_block)}")
    print(f"  jump targets shifted:  {transformation.summary['jump_targets_shifted']}")

    if show_figure:
        draw_program_transformer_diagram(
            transformation.original_program,
            transformation.transformed_program,
            transformation,
        )

    return transformation


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="computable URM program transformer demo")
    parser.add_argument("--x", type=int, default=3, help="initial value in R1")
    parser.add_argument("--y", type=int, default=4, help="initial value in R2")
    parser.add_argument(
        "--max-steps",
        type=int,
        default=None,
        help="optional execution step bound",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    demo_program_transformer(x=args.x, y=args.y, max_steps=args.max_steps)
