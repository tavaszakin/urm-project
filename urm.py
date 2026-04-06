from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple, Union, Optional, Dict, Any


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
# Trace record
# ============================================================

@dataclass
class TraceStep:
    step: int
    pc: int
    instruction: Optional[Instruction]
    registers: List[int]
    note: str = ""


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


def _validate_nonnegative_int(value: int, name: str) -> None:
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer, got {value!r}.")


def validate_instruction(instr: Instruction) -> None:
    """
    Ensure the instruction has a valid URM shape.
    """
    if not isinstance(instr, tuple) or len(instr) == 0:
        raise ValueError(f"Invalid instruction: {instr!r}")

    op = instr[0]

    if op in {"Z", "S"}:
        if len(instr) != 2:
            raise ValueError(f"{op} instruction must have exactly 1 argument: {instr!r}")
        _, n = instr
        _validate_nonnegative_int(n, "register index")
        return

    if op == "T":
        if len(instr) != 3:
            raise ValueError(f"T instruction must have exactly 2 arguments: {instr!r}")
        _, m, n = instr
        _validate_nonnegative_int(m, "source register index")
        _validate_nonnegative_int(n, "target register index")
        return

    if op == "J":
        if len(instr) != 4:
            raise ValueError(f"J instruction must have exactly 3 arguments: {instr!r}")
        _, m, n, q = instr
        _validate_nonnegative_int(m, "first register index")
        _validate_nonnegative_int(n, "second register index")
        _validate_nonnegative_int(q, "jump target")
        return

    raise ValueError(f"Unknown instruction opcode: {op!r}")


def validate_program(program: List[Instruction]) -> None:
    """
    Validate every instruction in the program.
    """
    if not isinstance(program, list):
        raise ValueError("Program must be a list of instructions.")

    for i, instr in enumerate(program):
        try:
            validate_instruction(instr)
        except ValueError as e:
            raise ValueError(f"Invalid instruction at I{i}: {e}") from e


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
    max_steps: Optional[int] = None,
    record_trace: bool = True,
) -> Dict[str, Any]:
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

    Returns
    -------
    A dictionary with:
        - "halted": bool
        - "steps": int
        - "final_pc": int
        - "final_registers": List[int]
        - "output": int   (content of R0 at the end)
        - "trace": List[TraceStep]
    """
    validate_program(program)

    if not isinstance(initial_registers, list):
        raise ValueError("initial_registers must be a list of nonnegative integers.")

    for i, value in enumerate(initial_registers):
        _validate_nonnegative_int(value, f"initial_registers[{i}]")

    registers = initial_registers.copy()
    pc = 0
    step_count = 0
    trace: List[TraceStep] = []

    if record_trace:
        trace.append(
            TraceStep(
                step=0,
                pc=pc,
                instruction=None,
                registers=registers.copy(),
                note="initial state",
            )
        )

    while 0 <= pc < len(program):
        if max_steps is not None and step_count >= max_steps:
            return {
                "halted": False,
                "steps": step_count,
                "final_pc": pc,
                "final_registers": registers,
                "output": registers[0] if len(registers) > 0 else 0,
                "trace": trace,
                "reason": "max_steps reached",
            }

        instr = program[pc]
        next_pc = step_instruction(program, registers, pc)
        step_count += 1

        if record_trace:
            note = f"executed {instruction_to_string(instr)}"
            if not (0 <= next_pc < len(program)):
                note += "; next instruction does not exist, so computation halts"

            trace.append(
                TraceStep(
                    step=step_count,
                    pc=next_pc,
                    instruction=instr,
                    registers=registers.copy(),
                    note=note,
                )
            )

        pc = next_pc

    return {
        "halted": True,
        "steps": step_count,
        "final_pc": pc,
        "final_registers": registers,
        "output": registers[0] if len(registers) > 0 else 0,
        "trace": trace,
    }


# ============================================================
# Pretty-printing
# ============================================================

def format_trace(trace: List[TraceStep]) -> str:
    """
    Convert the trace into a readable multiline string.
    """
    lines: List[str] = []

    for t in trace:
        instr_str = "None" if t.instruction is None else instruction_to_string(t.instruction)
        lines.append(
            f"Step {t.step:>2}: pc={t.pc:<3} instr={instr_str:<12} "
            f"registers={t.registers}  {t.note}"
        )

    return "\n".join(lines)


def print_trace(trace: List[TraceStep]) -> None:
    """
    Print the execution trace.
    """
    print(format_trace(trace))