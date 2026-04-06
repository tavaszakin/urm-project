from __future__ import annotations

from typing import List, Tuple, Union, Optional

from execution_models import ExecutionResult, TraceStep

DEFAULT_MAX_STEPS = 10_000


# ============================================================
# Instruction types
# ============================================================

# Z(n)      -> ("Z", n)
# S(n)      -> ("S", n)
# T(m, n)   -> ("T", m, n)
# J(m, n, q)-> ("J", m, n, q)

Instruction = Union[
    Tuple[str, int],           # Z, S
    Tuple[str, int, int],      # T
    Tuple[str, int, int, int], # J
]


# ============================================================
# Helpers
# ============================================================

def instruction_to_string(instr: Instruction) -> str:
    """
    Convert an instruction tuple into the PDF-style string form.
    """
    op = instr[0]

    if op == "Z":
        _, n = instr
        return f"Z({n})"

    if op == "S":
        _, n = instr
        return f"S({n})"

    if op == "T":
        _, m, n = instr
        return f"T({m}, {n})"

    if op == "J":
        _, m, n, q = instr
        return f"J({m}, {n}, {q})"

    raise ValueError(f"Unknown instruction opcode: {op}")


def _validate_int(value: int, name: str) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer, got {value!r}.")


def _validate_nonnegative_int(value: int, name: str) -> None:
    _validate_int(value, name)
    if value < 0:
        raise ValueError(f"{name} must be a nonnegative integer, got {value!r}.")


def validate_register_index(index: int, context: str) -> None:
    _validate_nonnegative_int(index, context)


def validate_jump_target(target: int, program_length: int, line_no: int) -> None:
    _validate_int(target, f"jump target at I{line_no}")
    if target < 0 or target > program_length:
        raise ValueError(
            f"Invalid instruction at I{line_no}: jump target must be within 0..{program_length - 1}, "
            f"got {target}."
        )


def validate_instruction(instr: Instruction, line_no: Optional[int] = None, program_length: Optional[int] = None) -> None:
    """
    Ensure the instruction has a valid URM shape.
    """
    location = f" at I{line_no}" if line_no is not None else ""

    if not isinstance(instr, tuple) or len(instr) == 0:
        raise ValueError(f"Invalid instruction{location}: expected a non-empty tuple, got {instr!r}")

    op = instr[0]
    if not isinstance(op, str):
        raise ValueError(f"Invalid instruction{location}: opcode must be a string, got {op!r}")

    if op in {"Z", "S"}:
        if len(instr) != 2:
            raise ValueError(
                f"Invalid instruction{location}: {op} expects 1 integer argument, got {instr!r}"
            )
        _, n = instr
        validate_register_index(n, f"register index in {op}{location}")
        return

    if op == "T":
        if len(instr) != 3:
            raise ValueError(
                f"Invalid instruction{location}: T expects 2 integer arguments, got {instr!r}"
            )
        _, m, n = instr
        validate_register_index(m, f"source register index in T{location}")
        validate_register_index(n, f"target register index in T{location}")
        return

    if op == "J":
        if len(instr) != 4:
            raise ValueError(
                f"Invalid instruction{location}: J expects 3 integer arguments, got {instr!r}"
            )
        _, m, n, q = instr
        validate_register_index(m, f"first register index in J{location}")
        validate_register_index(n, f"second register index in J{location}")
        if program_length is None:
            _validate_nonnegative_int(q, f"jump target in J{location}")
        else:
            validate_jump_target(q, program_length=program_length, line_no=line_no or 0)
        return

    raise ValueError(f"Invalid instruction{location}: unknown opcode {op!r}")


def validate_program(program: List[Instruction]) -> None:
    """
    Validate every instruction in the program.
    """
    if not isinstance(program, list):
        raise ValueError("Program must be a list of instructions.")

    for i, instr in enumerate(program):
        try:
            validate_instruction(instr, line_no=i, program_length=len(program))
        except ValueError as e:
            raise ValueError(str(e)) from e


def _ensure_register_exists(registers: List[int], index: int) -> None:
    """
    URM has infinitely many registers. In code, we extend the list as needed.
    """
    while len(registers) <= index:
        registers.append(0)


def _max_register_index_in_instruction(instr: Instruction) -> int:
    op = instr[0]
    if op in {"Z", "S"}:
        return instr[1]
    if op == "T":
        return max(instr[1], instr[2])
    if op == "J":
        return max(instr[1], instr[2])
    raise ValueError(f"Unknown opcode: {op}")


def _ensure_registers_for_instruction(registers: List[int], instr: Instruction) -> None:
    max_index = _max_register_index_in_instruction(instr)
    _ensure_register_exists(registers, max_index)


def _validate_register_values(registers: List[int], field_name: str) -> None:
    if not isinstance(registers, list):
        raise ValueError(f"{field_name} must be a list of nonnegative integers.")

    for i, value in enumerate(registers):
        _validate_nonnegative_int(value, f"{field_name}[{i}]")


def validate_registers(registers: List[int], field_name: str = "initial_registers") -> None:
    _validate_register_values(registers, field_name)


def validate_max_steps(max_steps: Optional[int]) -> None:
    if max_steps is None:
        return
    if type(max_steps) is not int or max_steps <= 0:
        raise ValueError(f"max_steps must be a positive integer, got {max_steps!r}.")


def _changed_registers(before: List[int], after: List[int]) -> List[int]:
    changed: List[int] = []
    max_len = max(len(before), len(after))

    for index in range(max_len):
        old_value = before[index] if index < len(before) else 0
        new_value = after[index] if index < len(after) else 0
        if old_value != new_value:
            changed.append(index)

    return changed


def _serialize_program(program: List[Instruction]) -> List[List[object]]:
    return [list(instr) for instr in program]


def _output_value(registers: List[int], output_register: int = 0) -> int:
    return registers[output_register] if len(registers) > output_register else 0


def _build_trace_step(
    step: int,
    pc: int,
    instr: Instruction,
    registers_before: List[int],
    registers_after: List[int],
    next_pc: int,
    program_length: int,
) -> TraceStep:
    jump_target = instr[3] if instr[0] == "J" else None
    jump_taken = instr[0] == "J" and next_pc == jump_target

    return TraceStep(
        step=step,
        pc=pc,
        instruction=list(instr),
        instruction_text=instruction_to_string(instr),
        registers_before=registers_before,
        registers_after=registers_after,
        changed_registers=_changed_registers(registers_before, registers_after),
        jump_taken=jump_taken,
        jump_target=jump_target,
        halted=not (0 <= next_pc < program_length),
    )


def _build_execution_result(
    program: List[Instruction],
    initial_registers: List[int],
    final_registers: List[int],
    steps: List[TraceStep],
    halted: bool,
    step_count: int,
    halt_reason: Optional[str] = None,
    output_register: int = 0,
) -> ExecutionResult:
    return ExecutionResult(
        program=_serialize_program(program),
        initial_registers=initial_registers.copy(),
        final_registers=final_registers.copy(),
        steps=steps,
        halted=halted,
        halt_reason=halt_reason,
        output_register=output_register,
        output_value=_output_value(final_registers, output_register=output_register),
        step_count=step_count,
    )


# ============================================================
# Core execution
# ============================================================

def step_instruction(
    program: List[Instruction],
    registers: List[int],
    pc: int,
) -> int:
    """
    Execute the instruction at index pc and return the next pc.

    Conventions match the PDF exactly:
    - instructions are indexed I0, I1, I2, ...
    - J(m, n, q) jumps directly to Iq if Rm == Rn
    - otherwise continue to the next instruction
    """
    instr = program[pc]
    _ensure_registers_for_instruction(registers, instr)

    op = instr[0]

    if op == "Z":
        _, n = instr
        registers[n] = 0
        return pc + 1

    if op == "S":
        _, n = instr
        registers[n] += 1
        return pc + 1

    if op == "T":
        _, m, n = instr
        registers[n] = registers[m]
        return pc + 1

    if op == "J":
        _, m, n, q = instr
        if registers[m] == registers[n]:
            return q
        return pc + 1

    raise ValueError(f"Unknown instruction opcode: {op}")


def execute(
    program: List[Instruction],
    initial_registers: List[int],
    max_steps: Optional[int] = DEFAULT_MAX_STEPS,
    record_trace: bool = True,
) -> ExecutionResult:
    """
    Execute a URM program.

    Parameters
    ----------
    program:
        A list of URM instructions indexed as I0, I1, I2, ...
    initial_registers:
        Initial contents of R0, R1, R2, ...
    max_steps:
        Optional safety cutoff to prevent infinite loops during testing.
        If None, runs until halting.
    record_trace:
        If True, stores the full execution trace.
    """

    validate_program(program)
    validate_registers(initial_registers, "initial_registers")
    validate_max_steps(max_steps)

    registers = initial_registers.copy()
    pc = 0
    step_count = 0
    trace: List[TraceStep] = []

    while 0 <= pc < len(program):
        if max_steps is not None and step_count >= max_steps:
            return _build_execution_result(
                program=program,
                initial_registers=initial_registers,
                final_registers=registers,
                steps=trace,
                halted=False,
                halt_reason="step_limit_exceeded",
                step_count=step_count,
            )

        instr = program[pc]
        registers_before = registers.copy()
        next_pc = step_instruction(program, registers, pc)
        step_count += 1

        if record_trace:
            trace.append(
                _build_trace_step(
                    step=step_count,
                    pc=pc,
                    registers_before=registers_before,
                    instr=instr,
                    registers_after=registers.copy(),
                    next_pc=next_pc,
                    program_length=len(program),
                )
            )

        pc = next_pc

    return _build_execution_result(
        program=program,
        initial_registers=initial_registers,
        final_registers=registers,
        steps=trace,
        halted=True,
        step_count=step_count,
    )


# ============================================================
# Pretty-printing
# ============================================================

def format_trace(trace: List[TraceStep]) -> str:
    """
    Convert the trace into a readable multiline string.
    """
    lines: List[str] = []

    for t in trace:
        lines.append(
            f"Step {t.step:>2}: pc={t.pc:<3} instr={t.instruction_text:<12} "
            f"before={t.registers_before} after={t.registers_after}"
        )

    return "\n".join(lines)


def print_trace(trace: List[TraceStep]) -> None:
    """
    Print the execution trace.
    """
    print(format_trace(trace))
