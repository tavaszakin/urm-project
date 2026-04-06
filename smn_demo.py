from __future__ import annotations

import argparse
from dataclasses import dataclass
from textwrap import fill
from typing import Dict, List, Optional, Sequence, Tuple

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import ConnectionPatch, Rectangle

from urm import Instruction, TraceStep, execute, instruction_to_string, validate_program
from visualize import plot_smn_trace_comparison


DEFAULT_INPUT_REGISTER_MAP: Dict[str, int] = {
    "specialized_input": 1,
    "fixed_target": 1,
    "live_target": 2,
    "output": 0,
}


@dataclass(frozen=True)
class ProgramOriginAnnotation:
    specialized_index: int
    instruction: Instruction
    origin: str
    source_index: Optional[int] = None
    block_label: str = ""


@dataclass(frozen=True)
class StructuralComparison:
    original_to_specialized: Dict[int, int]
    specialized_to_original: Dict[int, int]
    copied_indices: List[int]
    inserted_indices: List[int]
    jump_shift: int


@dataclass(frozen=True)
class AlignmentInfo:
    specialized_alignment_step: Optional[int]
    original_alignment_step: int
    specialized_pc: Optional[int]
    pc_offset: int
    compared_registers: List[int]
    matched_suffix_steps: int
    exact_register_match: bool
    reason: str


@dataclass(frozen=True)
class SpecializationResult:
    original_program: List[Instruction]
    specialized_program: List[Instruction]
    fixed_value: int
    setup_block: List[Instruction]
    shift_block: List[Instruction]
    copied_block: List[Instruction]
    annotations: List[ProgramOriginAnnotation]
    structural_comparison: StructuralComparison
    summary: Dict[str, int]
    register_map: Dict[str, int]
    scratch_registers: List[int]


@dataclass(frozen=True)
class SMNDemoResult:
    specialization: SpecializationResult
    original_execution: Dict[str, object]
    specialized_execution: Dict[str, object]
    original_initial_registers: List[int]
    specialized_initial_registers: List[int]
    alignment: AlignmentInfo


def build_constant_loader(register_index: int, value: int) -> List[Instruction]:
    """
    Build an explicit pedagogical block that sets R(register_index) = value.

    The construction is intentionally simple:
    - zero the register
    - increment it `value` times
    """
    if register_index < 0:
        raise ValueError("register_index must be nonnegative.")
    if value < 0:
        raise ValueError("value must be nonnegative.")

    block: List[Instruction] = [("Z", register_index)]
    block.extend(("S", register_index) for _ in range(value))
    return block


def _max_register_index(program: Sequence[Instruction]) -> int:
    if not program:
        return 0

    max_index = 0
    for instr in program:
        op = instr[0]
        if op in {"Z", "S"}:
            max_index = max(max_index, instr[1])
        elif op == "T":
            max_index = max(max_index, instr[1], instr[2])
        elif op == "J":
            max_index = max(max_index, instr[1], instr[2])
        else:
            raise ValueError(f"Unknown opcode: {op}")
    return max_index


def _ensure_length(registers: List[int], size: int) -> List[int]:
    if len(registers) >= size:
        return registers
    return registers + [0] * (size - len(registers))


def _copy_with_shifted_jumps(program: Sequence[Instruction], pc_shift: int) -> List[Instruction]:
    """
    Copy `program`, shifting every jump target by `pc_shift`.

    This is the crucial s-m-n bookkeeping step:
    once setup instructions are prepended, instruction Iq from the original
    program now lives at I(q + pc_shift) in the specialized program.
    """
    copied: List[Instruction] = []

    for instr in program:
        if instr[0] != "J":
            copied.append(tuple(instr))
            continue

        _, m, n, q = instr
        copied.append(("J", m, n, q + pc_shift))

    return copied


def _build_shift_block(
    specialized_input_register: int,
    live_target_register: int,
) -> Tuple[List[Instruction], List[int]]:
    """
    Prepare the live input for the copied 2-argument program.

    Under the default convention:
    - specialized input arrives in R1
    - copied original program expects y in R2

    Because `T(m, n)` does not destroy Rm, a direct copy is enough here.
    """
    if specialized_input_register == live_target_register:
        return [], []

    return [("T", specialized_input_register, live_target_register)], []


def annotate_specialized_program(
    specialized_program: Sequence[Instruction],
    setup_length: int,
    shift_length: int,
    original_to_specialized: Dict[int, int],
) -> List[ProgramOriginAnnotation]:
    annotations: List[ProgramOriginAnnotation] = []
    copied_lookup = {specialized: original for original, specialized in original_to_specialized.items()}

    for index, instr in enumerate(specialized_program):
        if index < shift_length:
            annotations.append(
                ProgramOriginAnnotation(
                    specialized_index=index,
                    instruction=instr,
                    origin="shift",
                    source_index=None,
                    block_label="input adaptation",
                )
            )
            continue

        if index < shift_length + setup_length:
            annotations.append(
                ProgramOriginAnnotation(
                    specialized_index=index,
                    instruction=instr,
                    origin="setup",
                    source_index=None,
                    block_label="load fixed constant",
                )
            )
            continue

        annotations.append(
            ProgramOriginAnnotation(
                specialized_index=index,
                instruction=instr,
                origin="copied",
                source_index=copied_lookup.get(index),
                block_label="shifted copy of original program",
            )
        )

    return annotations


def compare_programs_structurally(
    original_program: Sequence[Instruction],
    specialized_program: Sequence[Instruction],
    original_to_specialized: Optional[Dict[int, int]] = None,
) -> StructuralComparison:
    """
    Build a lightweight structural correspondence between P and S(P, a).
    """
    if original_to_specialized is None:
        raise ValueError("original_to_specialized mapping is required for reliable comparison.")

    specialized_to_original = {specialized: original for original, specialized in original_to_specialized.items()}
    copied_indices = sorted(specialized_to_original)
    inserted_indices = [i for i in range(len(specialized_program)) if i not in specialized_to_original]

    if copied_indices:
        jump_shift = copied_indices[0]
    else:
        jump_shift = len(specialized_program)

    return StructuralComparison(
        original_to_specialized=dict(original_to_specialized),
        specialized_to_original=specialized_to_original,
        copied_indices=copied_indices,
        inserted_indices=inserted_indices,
        jump_shift=jump_shift,
    )


def specialize_2arg_program(
    program: Sequence[Instruction],
    fixed_value: int,
    input_register_map: Optional[Dict[str, int]] = None,
) -> SpecializationResult:
    """
    Construct S(P, a) for a 2-input pedagogical URM program P(x, y).

    Default convention:
    - original program expects x in R1 and y in R2
    - specialized program receives y in R1
    - specialization copies y into R2, loads x = a into R1, then runs P
    """
    validate_program(list(program))

    register_map = dict(DEFAULT_INPUT_REGISTER_MAP)
    if input_register_map is not None:
        register_map.update(input_register_map)

    specialized_input = register_map["specialized_input"]
    fixed_target = register_map["fixed_target"]
    live_target = register_map["live_target"]

    if fixed_value < 0:
        raise ValueError("fixed_value must be nonnegative.")
    if fixed_target == live_target:
        raise ValueError("fixed_target and live_target must be different registers.")

    shift_block, scratch_registers = _build_shift_block(
        specialized_input_register=specialized_input,
        live_target_register=live_target,
    )
    setup_block = build_constant_loader(fixed_target, fixed_value)

    prelude_length = len(shift_block) + len(setup_block)
    copied_block = _copy_with_shifted_jumps(program, pc_shift=prelude_length)
    specialized_program = shift_block + setup_block + copied_block

    original_to_specialized = {
        original_index: prelude_length + original_index
        for original_index in range(len(program))
    }
    annotations = annotate_specialized_program(
        specialized_program=specialized_program,
        setup_length=len(setup_block),
        shift_length=len(shift_block),
        original_to_specialized=original_to_specialized,
    )
    structural_comparison = compare_programs_structurally(
        original_program=program,
        specialized_program=specialized_program,
        original_to_specialized=original_to_specialized,
    )

    return SpecializationResult(
        original_program=list(program),
        specialized_program=specialized_program,
        fixed_value=fixed_value,
        setup_block=setup_block,
        shift_block=shift_block,
        copied_block=copied_block,
        annotations=annotations,
        structural_comparison=structural_comparison,
        summary={
            "original_length": len(program),
            "specialized_length": len(specialized_program),
            "added_shift_instructions": len(shift_block),
            "added_setup_instructions": len(setup_block),
            "prelude_length": prelude_length,
        },
        register_map=register_map,
        scratch_registers=scratch_registers,
    )


def _program_register_budget(program: Sequence[Instruction], *extra_registers: int) -> int:
    max_index = max(_max_register_index(program), *(extra_registers or (0,)))
    return max_index + 1


def _project_registers(registers: Sequence[int], compared_registers: Sequence[int]) -> List[int]:
    projected: List[int] = []
    for register in compared_registers:
        projected.append(registers[register] if register < len(registers) else 0)
    return projected


def _alignment_suffix_length(
    original_trace: Sequence[TraceStep],
    specialized_trace: Sequence[TraceStep],
    alignment_step: int,
    compared_registers: Sequence[int],
    pc_offset: int,
) -> int:
    matched = 0
    max_pairs = min(len(original_trace), len(specialized_trace) - alignment_step)

    for offset in range(max_pairs):
        original_step = original_trace[offset]
        specialized_step = specialized_trace[alignment_step + offset]

        original_projected = _project_registers(original_step.registers, compared_registers)
        specialized_projected = _project_registers(specialized_step.registers, compared_registers)

        pc_matches = specialized_step.pc - pc_offset == original_step.pc
        if original_projected != specialized_projected or not pc_matches:
            break

        matched += 1

    return matched


def find_alignment_step(
    original_trace: Sequence[TraceStep],
    specialized_trace: Sequence[TraceStep],
    compared_registers: Optional[Sequence[int]] = None,
    pc_offset: int = 0,
    min_specialized_step: int = 0,
) -> AlignmentInfo:
    """
    Find the point where the specialized trace reaches the original initial state.

    We compare:
    - projected register values on the original program's visible registers
    - the specialized program counter, normalized by subtracting the prelude length
    """
    if not original_trace:
        raise ValueError("original_trace must not be empty.")
    if not specialized_trace:
        raise ValueError("specialized_trace must not be empty.")

    if compared_registers is None:
        compared_registers = list(range(max(len(original_trace[0].registers), 3)))
    else:
        compared_registers = list(compared_registers)

    target_registers = _project_registers(original_trace[0].registers, compared_registers)

    for specialized_index in range(min_specialized_step, len(specialized_trace)):
        specialized_step = specialized_trace[specialized_index]
        projected = _project_registers(specialized_step.registers, compared_registers)
        pc_matches = specialized_step.pc - pc_offset == original_trace[0].pc

        if projected == target_registers and pc_matches:
            matched_suffix = _alignment_suffix_length(
                original_trace=original_trace,
                specialized_trace=specialized_trace,
                alignment_step=specialized_index,
                compared_registers=compared_registers,
                pc_offset=pc_offset,
            )
            return AlignmentInfo(
                specialized_alignment_step=specialized_index,
                original_alignment_step=0,
                specialized_pc=specialized_step.pc,
                pc_offset=pc_offset,
                compared_registers=compared_registers,
                matched_suffix_steps=matched_suffix,
                exact_register_match=True,
                reason=(
                    "Found the first specialized trace row whose visible registers match "
                    "the original initial state and whose pc, after subtracting the "
                    "prelude offset, equals the original pc."
                ),
            )

    return AlignmentInfo(
        specialized_alignment_step=None,
        original_alignment_step=0,
        specialized_pc=None,
        pc_offset=pc_offset,
        compared_registers=compared_registers,
        matched_suffix_steps=0,
        exact_register_match=False,
        reason=(
            "No exact alignment row was found. This usually means the compared register "
            "set is too small or the specialization convention differs from the demo defaults."
        ),
    )


def run_smn_demo(
    program: Sequence[Instruction],
    fixed_value: int,
    live_input: int,
    input_register_map: Optional[Dict[str, int]] = None,
    max_steps: Optional[int] = None,
) -> SMNDemoResult:
    """
    Run the paired executions P(a, y) and S(P, a)(y) and collect demo metadata.
    """
    specialization = specialize_2arg_program(
        program=program,
        fixed_value=fixed_value,
        input_register_map=input_register_map,
    )
    register_map = specialization.register_map

    original_size = _program_register_budget(
        specialization.original_program,
        register_map["fixed_target"],
        register_map["live_target"],
    )
    original_initial_registers = [0] * original_size
    original_initial_registers[register_map["fixed_target"]] = fixed_value
    original_initial_registers[register_map["live_target"]] = live_input

    specialized_size = _program_register_budget(
        specialization.specialized_program,
        register_map["specialized_input"],
        register_map["fixed_target"],
        register_map["live_target"],
    )
    specialized_initial_registers = [0] * specialized_size
    specialized_initial_registers[register_map["specialized_input"]] = live_input

    original_execution = execute(
        specialization.original_program,
        initial_registers=original_initial_registers,
        max_steps=max_steps,
    )
    specialized_execution = execute(
        specialization.specialized_program,
        initial_registers=specialized_initial_registers,
        max_steps=max_steps,
    )

    compared_registers = list(range(original_size))
    alignment = find_alignment_step(
        original_trace=original_execution["trace"],
        specialized_trace=specialized_execution["trace"],
        compared_registers=compared_registers,
        pc_offset=specialization.summary["prelude_length"],
        min_specialized_step=specialization.summary["prelude_length"],
    )

    return SMNDemoResult(
        specialization=specialization,
        original_execution=original_execution,
        specialized_execution=specialized_execution,
        original_initial_registers=original_initial_registers,
        specialized_initial_registers=specialized_initial_registers,
        alignment=alignment,
    )


def draw_smn_code_construction(
    specialization: SpecializationResult,
    alignment: Optional[AlignmentInfo] = None,
    ax_original=None,
    ax_specialized=None,
    title: str = "s-m-n Theorem Construction",
    minimal_explanation: bool = True,
    show_register_box: bool = False,
    show_color_key: bool = False,
    show_section_boxes: bool = False,
) -> None:
    """
    Draw a proof-oriented side-by-side code view for the s-m-n construction.
    """
    def _phase_style(origin: str) -> Tuple[str, str]:
        if origin == "shift":
            return "#e8f1fb", "#4e79a7"
        if origin == "setup":
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
        center_y = (top + bottom) / 2.0
        if show_section_boxes:
            rect = Rectangle(
                (-0.10, bottom),
                1.42,
                top - bottom,
                facecolor="none",
                edgecolor=accent,
                linewidth=1.6,
                linestyle=(0, (4, 2)),
            )
            ax.add_patch(rect)
        ax.text(
            1.28,
            center_y,
            label,
            ha="left",
            va="center",
            fontsize=10.5,
            fontweight="bold",
            color=accent,
        )

    def _draw_phase_note(ax, x: float, y: float, text: str, edgecolor: str, facecolor: str) -> None:
        ax.text(
            x,
            y,
            fill(text, width=34),
            ha="left",
            va="top",
            fontsize=8.5,
            color="#334e68",
            bbox={"boxstyle": "round,pad=0.25", "fc": facecolor, "ec": edgecolor},
        )

    def _draw_theorem_header(fig) -> None:
        fig.suptitle(title, fontsize=17, fontweight="bold", y=0.98)
        fig.text(
            0.5,
            0.945,
            r"$\varphi_{s(e,a)}(y)=\varphi_e(a,y)$",
            ha="center",
            va="top",
            fontsize=15,
            color="#102a43",
        )
        fig.text(
            0.5,
            0.918,
            (
                ""
                if minimal_explanation
                else fill(
                    "The computable function s(e, a) builds a program index that prepares the fixed "
                    "parameter a and then runs a shifted copy of the program with index e.",
                    width=92,
                )
            ),
            ha="center",
            va="top",
            fontsize=9.4,
            color="#486581",
        )

    def _draw_register_semantics(fig) -> None:
        register_map = specialization.register_map
        fig.text(
            0.5,
            0.875,
            (
                fill(
                    f"Original: R{register_map['fixed_target']}=x, "
                    f"R{register_map['live_target']}=y, R{register_map['output']}=output.  "
                    f"Specialized: y enters R{register_map['specialized_input']}; setup prepares "
                    f"R{register_map['fixed_target']}=a and R{register_map['live_target']}=y.",
                    width=104,
                )
                if minimal_explanation
                else fill(
                    f"Original convention: R{register_map['fixed_target']} = x, "
                    f"R{register_map['live_target']} = y, R{register_map['output']} = output.\n"
                    f"Specialized convention: input y arrives in R{register_map['specialized_input']}; "
                    f"setup prepares R{register_map['fixed_target']} = a and "
                    f"R{register_map['live_target']} = y before entering the shifted copy.",
                    width=110,
                )
            ),
            ha="center",
            va="top",
            fontsize=9.3,
            color="#243447",
            bbox={"boxstyle": "round,pad=0.4", "fc": "#f8fafc", "ec": "#cbd5e1"},
        )

    def _annotate_jump_shift(ax, y_positions: Dict[int, float]) -> None:
        if minimal_explanation:
            return
        jump_shift = specialization.summary["prelude_length"]
        for annotation in specialization.annotations:
            instr = annotation.instruction
            if annotation.origin != "copied" or instr[0] != "J" or annotation.source_index is None:
                continue

            source_q = specialization.original_program[annotation.source_index][3]
            copied_q = instr[3]
            ax.annotate(
                fill(
                    f"Local jump shift: q = {source_q} becomes q + k = {copied_q}, with k = {jump_shift}.",
                    width=26,
                ),
                xy=(1.22, y_positions[annotation.specialized_index]),
                xytext=(1.36, y_positions[annotation.specialized_index] + 0.65),
                ha="left",
                va="center",
                fontsize=8.2,
                color="#2f5233",
                arrowprops={"arrowstyle": "-", "color": "#5b7f5b", "lw": 1.0, "alpha": 0.85},
                bbox={"boxstyle": "round,pad=0.22", "fc": "#f7fbf7", "ec": "#b7d4b7"},
            )
            break

    def _draw_alignment_callout(ax) -> None:
        boundary_y = -specialization.summary["prelude_length"] + 0.5
        if minimal_explanation:
            ax.plot([-0.05, 1.42], [boundary_y, boundary_y], color="#c0392b", linewidth=2.0)
            ax.text(
                1.46,
                boundary_y,
                fill(
                    "Alignment: registers now match initial configuration of φ_e(a, y)",
                    width=28,
                ),
                ha="left",
                va="center",
                fontsize=9.2,
                fontweight="bold",
                color="#c0392b",
            )
            return
        prelude_length = specialization.summary["prelude_length"]
        text = (
            "Alignment point:\n"
            r"after setup, the machine is in the start configuration of $\varphi_e(a,y)$"
            f"\n(pc = {prelude_length}, ready to enter the shifted copy)"
        )
        if alignment is not None and alignment.specialized_alignment_step is not None:
            text += f"\ntrace witness: specialized step {alignment.specialized_alignment_step}"

        ax.plot([-0.05, 1.42], [boundary_y, boundary_y], color="#c0392b", linewidth=2.4)
        ax.annotate(
            fill(text, width=44),
            xy=(1.05, boundary_y),
            xytext=(0.30, boundary_y + 1.15),
            ha="left",
            va="center",
            fontsize=9.2,
            fontweight="bold",
            color="#7b241c",
            arrowprops={"arrowstyle": "-|>", "color": "#c0392b", "lw": 1.6},
            bbox={"boxstyle": "round,pad=0.35", "fc": "#fff5f3", "ec": "#e7a39d"},
        )

    created_fig = False
    if ax_original is None or ax_specialized is None:
        fig_height = max(6.0, 0.55 * max(
            len(specialization.original_program),
            len(specialization.specialized_program),
        ) + (2.4 if minimal_explanation else 3.2))
        fig, (ax_original, ax_specialized) = plt.subplots(
            1,
            2,
            figsize=(14, fig_height),
            constrained_layout=False,
        )
        fig.subplots_adjust(top=(0.84 if minimal_explanation else 0.78), wspace=0.24)
        _draw_theorem_header(fig)
        if show_register_box:
            _draw_register_semantics(fig)
        created_fig = True
    else:
        fig = ax_original.figure

    for ax in (ax_original, ax_specialized):
        ax.axis("off")

    ax_original.set_title(
        r"Program with index $e$ computing $\varphi_e(x,y)$",
        fontsize=13,
        fontweight="bold",
        pad=12,
    )
    ax_specialized.set_title(
        r"Program with index $s(e,a)$ computing $\varphi_{s(e,a)}(y)$",
        fontsize=13,
        fontweight="bold",
        pad=12,
    )
    ax_original.text(
        0.0,
        1.02,
        ("Original two-input URM program" if not minimal_explanation else ""),
        transform=ax_original.transAxes,
        ha="left",
        va="bottom",
        fontsize=9.5,
        color="#5f6c7b",
    )
    ax_specialized.text(
        0.0,
        1.02,
        ("Specialization fixes parameter a and leaves y as the live input" if not minimal_explanation else ""),
        transform=ax_specialized.transAxes,
        ha="left",
        va="bottom",
        fontsize=9.5,
        color="#5f6c7b",
    )

    original_y_positions: Dict[int, float] = {}
    specialized_y_positions: Dict[int, float] = {}

    for index, instr in enumerate(specialization.original_program):
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

    for annotation in specialization.annotations:
        y = -annotation.specialized_index
        specialized_y_positions[annotation.specialized_index] = y

        facecolor, edgecolor = _phase_style(annotation.origin)

        rect = Rectangle((-0.05, y - 0.35), 1.25, 0.7, facecolor=facecolor, edgecolor=edgecolor)
        ax_specialized.add_patch(rect)

        label = f"I{annotation.specialized_index}: {instruction_to_string(annotation.instruction)}"
        if annotation.origin == "copied" and annotation.source_index is not None:
            label += (f"   <- I{annotation.source_index}" if not minimal_explanation else "")

        ax_specialized.text(
            0.02,
            y,
            label,
            ha="left",
            va="center",
            fontsize=9.4,
        )

    for original_index, specialized_index in specialization.structural_comparison.original_to_specialized.items():
        connection = ConnectionPatch(
            xyA=(1.0, original_y_positions[original_index]),
            coordsA=ax_original.transData,
            xyB=(-0.05, specialized_y_positions[specialized_index]),
            coordsB=ax_specialized.transData,
            color="#5b7f5b",
            linewidth=0.9,
            alpha=0.38,
        )
        ax_specialized.add_artist(connection)

    _draw_section_group(
        ax_specialized,
        start=0,
        length=len(specialization.shift_block),
        label="Input adaptation",
        accent="#4e79a7",
    )
    _draw_section_group(
        ax_specialized,
        start=len(specialization.shift_block),
        length=len(specialization.setup_block),
        label="Load fixed parameter a",
        accent="#b07a00",
    )
    _draw_section_group(
        ax_specialized,
        start=specialization.summary["prelude_length"],
        length=len(specialization.copied_block),
        label="Shifted copy of original program",
        accent="#5b7f5b",
    )
    if len(specialization.shift_block) > 0 and not minimal_explanation:
        _draw_phase_note(
            ax_specialized,
            x=1.46,
            y=0.55,
            text=(
                f"Live input y arrives in R{specialization.register_map['specialized_input']} "
                f"and is copied into R{specialization.register_map['live_target']}."
            ),
            edgecolor="#9fbfe0",
            facecolor="#f4f8fd",
        )
    if len(specialization.setup_block) > 0 and not minimal_explanation:
        _draw_phase_note(
            ax_specialized,
            x=1.46,
            y=-(len(specialization.shift_block)) + 0.2,
            text=(
                f"Setup loads the fixed parameter a = {specialization.fixed_value} into "
                f"R{specialization.register_map['fixed_target']}."
            ),
            edgecolor="#e2c27a",
            facecolor="#fff9ec",
        )
    _draw_alignment_callout(ax_specialized)
    _annotate_jump_shift(ax_specialized, specialized_y_positions)

    max_original = max(len(specialization.original_program) - 1, 0)
    max_specialized = max(len(specialization.specialized_program) - 1, 0)
    ax_original.set_xlim(-0.15, 1.05)
    ax_specialized.set_xlim(-0.15, 2.18)
    ax_original.set_ylim(-max_original - 1.0, 1.0)
    ax_specialized.set_ylim(-max_specialized - 1.0, 1.45)

    if show_color_key:
        legend_text = "\n".join(
            (
                [
                    "Blue: input",
                    "Gold: fixed a",
                    "Green: copied code",
                ]
                if minimal_explanation
                else [
                    "Color key",
                    "Blue: live input / adaptation",
                    "Gold: fixed parameter / setup",
                    "Green: inherited copied computation",
                ]
            )
        )
        ax_specialized.text(
            0.98,
            0.02,
            legend_text,
            transform=ax_specialized.transAxes,
            ha="right",
            va="bottom",
            fontsize=8.5,
            color="#52606d",
            bbox={"boxstyle": "round,pad=0.28", "fc": "white", "ec": "#d9e2ec"},
        )

    if created_fig:
        plt.show()


def draw_smn_trace_comparison(
    demo_result: SMNDemoResult,
    annotate_cells: bool = True,
    cmap: str = "Blues",
    figsize: Tuple[int, int] = (16, 8),
    output_path: str = "smn_trace_comparison.png",
) -> None:
    """
    Draw side-by-side execution traces with the alignment step highlighted.
    """
    original_trace = demo_result.original_execution["trace"]
    specialized_trace = demo_result.specialized_execution["trace"]
    fig, _ = plot_smn_trace_comparison(
        original_trace=original_trace,
        specialized_trace=specialized_trace,
        alignment_step=demo_result.alignment.specialized_alignment_step,
        title1=r"$\varphi_e(a, y)$",
        title2=r"$\varphi_{s(e,a)}(y)$",
        annotate=annotate_cells,
        cmap=cmap,
        figsize=figsize,
    )
    fig.savefig(output_path, dpi=200, bbox_inches="tight")
    print(f"  trace figure saved:    {output_path}")
    plt.show()


def example_add_program() -> List[Instruction]:
    """
    Example P(x, y) with the theorem-demo convention:
    - R1 = x
    - R2 = y
    - R0 = output

    The program copies x into R0, then loops exactly y times.
    """
    return [
        ("T", 1, 0),        # I0: R0 = x
        ("Z", 3),           # I1: R3 = 0
        ("J", 3, 2, 6),     # I2: if counter == y, halt
        ("S", 0),           # I3: R0 += 1
        ("S", 3),           # I4: counter += 1
        ("J", 0, 0, 2),     # I5: unconditional jump back to the loop test
    ]


def demo_smn_theorem(
    fixed_value: int = 3,
    live_input: int = 4,
    max_steps: Optional[int] = None,
    show_code: bool = True,
    show_trace: bool = True,
) -> SMNDemoResult:
    """
    End-to-end teaching demo for the s-m-n proof idea.
    """
    program = example_add_program()
    result = run_smn_demo(
        program=program,
        fixed_value=fixed_value,
        live_input=live_input,
        max_steps=max_steps,
    )

    print("s-m-n theorem demo")
    print(f"  fixed x = {fixed_value}, live y = {live_input}")
    print(f"  P(a, y) output:       {result.original_execution['output']}")
    print(f"  S(P, a)(y) output:    {result.specialized_execution['output']}")
    print(
        f"  jump-target shift:    +{result.specialization.structural_comparison.jump_shift}"
    )
    print(
        f"  alignment step:       {result.alignment.specialized_alignment_step}"
    )

    if show_code:
        draw_smn_code_construction(result.specialization, alignment=result.alignment)
    if show_trace:
        draw_smn_trace_comparison(result)
    return result


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="s-m-n theorem visualization demo")
    parser.add_argument(
        "--view",
        choices=("all", "trace", "code"),
        default="all",
        help="choose which figure to display",
    )
    parser.add_argument("--fixed", type=int, default=3, help="fixed input a")
    parser.add_argument("--live", type=int, default=4, help="live input y")
    parser.add_argument(
        "--max-steps",
        type=int,
        default=None,
        help="optional execution step bound",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    demo_smn_theorem(
        fixed_value=args.fixed,
        live_input=args.live,
        max_steps=args.max_steps,
        show_code=args.view in {"all", "code"},
        show_trace=args.view in {"all", "trace"},
    )
