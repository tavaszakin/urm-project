from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

from diagonal_pipeline_demo import DiagonalPipelineData, build_diagonal_pipeline
from program_transformer_demo import example_add_program
from smn_demo import SMNDemoResult, run_smn_demo
from urm import Instruction, execute, instruction_to_string
from visualize import plot_trace_heatmap, print_trace_table


@dataclass(frozen=True)
class FixedPointTraceExample:
    """
    Concrete execution-level example for the construction stage.

    This is intentionally a pedagogical instance of the recipe
    g(e) = f(s(e,e)), using the repo's existing demo transformer:
    - base program computes x + y
    - s(e,e) specializes the first argument to the chosen demo value e
    - f appends one final increment instruction S(0)
    """

    e_value: int
    runtime_input: int
    pipeline: DiagonalPipelineData
    constructed_program: List[Instruction]
    initial_registers: List[int]
    execution: Dict[str, object]
    summary: Dict[str, object]


@dataclass(frozen=True)
class SpecializationHeatmapExample:
    """
    Concrete execution view for the diagonal specialization stage s(e,e).

    In this repo's teaching setup, the underlying base program P(x, y) computes x + y.
    Choosing a concrete demo value e and specializing the first input gives a 1-input
    program S(P, e), which is the concrete object represented symbolically by s(e,e).
    """

    e_value: int
    runtime_input: int
    smn_result: SMNDemoResult
    summary: Dict[str, object]


def build_fixed_point_trace_example(
    e_value: int = 3,
    runtime_input: int = 4,
    *,
    program: Optional[Sequence[Instruction]] = None,
) -> FixedPointTraceExample:
    """
    Build a specific construction-stage example of g(e) = f(s(e,e)).

    Concrete choices used here:
    - base 2-input program: computes x + y
    - transformer f: append S(0), so the transformed program adds 1 more
    - chosen demo self-input: e = e_value
    - runtime input to the resulting 1-input program: y = runtime_input

    The resulting constructed program therefore computes:
        y |-> e_value + y + 1
    """
    source_program = list(program) if program is not None else example_add_program()
    pipeline = build_diagonal_pipeline(
        index_x=e_value,
        program=source_program,
        index_label="e",
    )

    constructed_program = list(pipeline.transformed_stage.transformed_program)
    initial_registers = [0, runtime_input, 0]
    execution = execute(constructed_program, initial_registers)

    pretty_program = [
        f"I{index}: {instruction_to_string(instr)}"
        for index, instr in enumerate(constructed_program)
    ]

    return FixedPointTraceExample(
        e_value=e_value,
        runtime_input=runtime_input,
        pipeline=pipeline,
        constructed_program=constructed_program,
        initial_registers=initial_registers,
        execution=execution,
        summary={
            "constructed_label": f"g(e) = f(s(e,e)) with e = {e_value}",
            "runtime_meaning": f"constructed program run on input y = {runtime_input}",
            "computed_function": f"y |-> {e_value} + y + 1",
            "expected_output": e_value + runtime_input + 1,
            "program_length": len(constructed_program),
            "program_listing": pretty_program,
        },
    )


def build_specialization_heatmap_example(
    e_value: int = 3,
    runtime_input: int = 4,
    *,
    program: Optional[Sequence[Instruction]] = None,
) -> SpecializationHeatmapExample:
    """
    Build a concrete heat-map example for the s-stage alone.

    We interpret the diagonal construction step using a fixed demo value e:
    - original 2-input program P computes x + y
    - specialize x to e
    - obtain the 1-input program S(P, e), which stands in for s(e,e) in the demo
    """
    source_program = list(program) if program is not None else example_add_program()
    smn_result = run_smn_demo(
        program=source_program,
        fixed_value=e_value,
        live_input=runtime_input,
    )

    specialized_program_listing = [
        f"I{index}: {instruction_to_string(instr)}"
        for index, instr in enumerate(smn_result.specialization.specialized_program)
    ]

    return SpecializationHeatmapExample(
        e_value=e_value,
        runtime_input=runtime_input,
        smn_result=smn_result,
        summary={
            "symbolic_label": f"s(e,e) with e = {e_value}",
            "runtime_meaning": f"run the specialized program on y = {runtime_input}",
            "computed_function": f"y |-> {e_value} + y",
            "expected_output": e_value + runtime_input,
            "prelude_length": smn_result.specialization.summary["prelude_length"],
            "program_length": len(smn_result.specialization.specialized_program),
            "program_listing": specialized_program_listing,
        },
    )


def demo_fixed_point_trace_example(
    e_value: int = 3,
    runtime_input: int = 4,
    *,
    show_figure: bool = True,
    print_table: bool = False,
) -> FixedPointTraceExample:
    """
    Render a trace-table view of one concrete fixed-point construction example.

    Important scope note:
    this visualizes the constructed program arising from the recipe g(e)=f(s(e,e)).
    It does not yet implement the later theorem-level comparison
    phi_e = phi_{f(e)}.
    """
    example = build_fixed_point_trace_example(
        e_value=e_value,
        runtime_input=runtime_input,
    )

    print("fixed-point construction trace demo")
    print(f"  chosen demo index e:     {example.e_value}")
    print(f"  runtime input y:         {example.runtime_input}")
    print(f"  construction:            {example.summary['constructed_label']}")
    print(f"  resulting function:      {example.summary['computed_function']}")
    print(f"  final R0 output:         {example.execution['output']}")
    print(f"  expected output:         {example.summary['expected_output']}")
    print("  constructed URM program:")
    for line in example.summary["program_listing"]:
        print(f"    {line}")

    if print_table:
        print()
        print_trace_table(example.execution["trace"])

    if show_figure:
        plot_trace_heatmap(
            example.execution["trace"],
            title=(
                "Concrete construction-stage example: "
                f"g(e) = f(s(e,e)), with e = {example.e_value}, runtime input y = {example.runtime_input}"
            ),
            annotate=True,
            highlight_changes=False,
            figsize=(12, 7),
        )

    return example


def demo_specialization_heatmap(
    e_value: int = 3,
    runtime_input: int = 4,
    *,
    show_figure: bool = True,
    print_table: bool = False,
) -> SpecializationHeatmapExample:
    """
    Render a trace-table heat map for the specialization stage s(e,e).

    This isolates the diagonal constructor before the later transformer f is applied.
    """
    example = build_specialization_heatmap_example(
        e_value=e_value,
        runtime_input=runtime_input,
    )

    print("specialization heat-map demo")
    print(f"  chosen demo index e:     {example.e_value}")
    print(f"  runtime input y:         {example.runtime_input}")
    print(f"  symbolic stage:          {example.summary['symbolic_label']}")
    print(f"  resulting function:      {example.summary['computed_function']}")
    print(f"  final R0 output:         {example.smn_result.specialized_execution['output']}")
    print(f"  expected output:         {example.summary['expected_output']}")
    print(f"  setup rows before copy:  {example.summary['prelude_length']}")
    print("  specialized URM program:")
    for line in example.summary["program_listing"]:
        print(f"    {line}")

    if print_table:
        print()
        print_trace_table(example.smn_result.specialized_execution["trace"])

    if show_figure:
        plot_trace_heatmap(
            example.smn_result.specialized_execution["trace"],
            title=(
                "Specialization-stage heat map: "
                f"s(e,e) with e = {example.e_value}, runtime input y = {example.runtime_input}"
            ),
            annotate=True,
            highlight_changes=False,
            figsize=(12, 7),
        )

    return example


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="fixed-point construction trace-table demo")
    parser.add_argument("--e", type=int, default=3, help="chosen concrete demo value for e")
    parser.add_argument("--y", type=int, default=4, help="runtime input for the constructed 1-input program")
    parser.add_argument(
        "--view",
        choices=("fixed-point", "specialization"),
        default="fixed-point",
        help="which construction-stage heat map to render",
    )
    parser.add_argument(
        "--print-table",
        action="store_true",
        help="also print the text trace table to the terminal",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    if args.view == "specialization":
        demo_specialization_heatmap(
            e_value=args.e,
            runtime_input=args.y,
            print_table=args.print_table,
        )
    else:
        demo_fixed_point_trace_example(
            e_value=args.e,
            runtime_input=args.y,
            print_table=args.print_table,
        )
