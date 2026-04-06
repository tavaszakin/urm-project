# ============================================================
# URM Macro Library + Compiler Helpers
# Designed to work with your existing urm.py
# ============================================================

from typing import List, Tuple
from urm import execute, validate_program

Instruction = Tuple


# ============================================================
# Basic utilities
# ============================================================

def shift_program(program: List[Instruction], offset: int) -> List[Instruction]:
    """
    Shift jump targets by offset (used when composing programs).
    """
    shifted = []
    for instr in program:
        if instr[0] == "J":
            op, m, n, q = instr
            shifted.append(("J", m, n, q + offset))
        else:
            shifted.append(instr)
    return shifted


def concat_programs(*programs: List[Instruction]) -> List[Instruction]:
    """
    Concatenate programs while fixing jump indices.
    """
    result = []
    offset = 0

    for p in programs:
        shifted = shift_program(p, offset)
        result.extend(shifted)
        offset += len(p)

    return result


# ============================================================
# Chapter 3: Initial Functions
# ============================================================

def zero() -> List[Instruction]:
    """z(x) = 0"""
    return [("Z", 0)]


def successor() -> List[Instruction]:
    """s(x) = x + 1"""
    return [("S", 0)]


def projection(i: int) -> List[Instruction]:
    """
    ε_i^n: return i-th input (assumes inputs in R1,...)
    """
    return [("T", i, 0)]


def constant(k: int) -> List[Instruction]:
    """c_k(x) = k"""
    prog = [("Z", 0)]
    for _ in range(k):
        prog.append(("S", 0))
    return prog


# ============================================================
# Derived macros
# ============================================================

def copy(src: int, dst: int) -> List[Instruction]:
    return [("T", src, dst)]


def clear(reg: int) -> List[Instruction]:
    return [("Z", reg)]


# ============================================================
# Addition: R1 + R2 -> R0
# ============================================================

def add() -> List[Instruction]:
    """
    Computes R0 = R1 + R2
    Uses R3 as counter
    """
    return [
        ("T", 1, 0),        # R0 = R1
        ("Z", 3),           # R3 = 0
        ("J", 3, 2, 6),     # if R3 == R2 goto end
        ("S", 0),           # R0++
        ("S", 3),           # counter++
        ("J", 0, 0, 2),     # loop
        # end
    ]


# ============================================================
# Bounded subtraction: max(R1 - R2, 0)
# ============================================================

def bounded_sub() -> List[Instruction]:
    """
    R0 = max(R1 - R2, 0)
    Uses R3 as counter
    """
    return [
        ("T", 1, 0),        # R0 = R1
        ("Z", 3),           # counter = 0
        ("J", 3, 2, 8),     # if counter == R2 → done
        ("J", 0, 0, 6),     # if R0 == 0 → jump to end
        ("Z", 4),           # temp
        ("J", 4, 0, 7),     # if R4 == R0 skip
        ("S", 4),
        ("T", 4, 0),        # decrement simulation
        ("S", 3),           # counter++
        ("J", 0, 0, 2),
        # end
    ]


# ============================================================
# Multiplication: R1 * R2 -> R0
# ============================================================

def multiply() -> List[Instruction]:
    """
    R0 = R1 * R2
    Uses repeated addition
    R3 = counter
    R4 = accumulator
    """
    return [
        ("Z", 4),           # R4 = 0 (accumulator)
        ("Z", 3),           # R3 = 0 (counter)
        ("J", 3, 2, 9),     # if counter == R2 → done

        # --- add R1 to R4 ---
        ("T", 4, 0),        # R0 = R4
        ("T", 1, 5),        # R5 = R1
        ("Z", 6),           # R6 = counter

        ("J", 6, 5, 8),     # if R6 == R5 → done adding
        ("S", 0),
        ("S", 6),
        ("J", 0, 0, 6),

        ("T", 0, 4),        # R4 = updated value

        # --- increment outer loop ---
        ("S", 3),
        ("J", 0, 0, 2),

        # end
        ("T", 4, 0),        # move result to R0
    ]


# ============================================================
# Composition (key to Theorem 3.12)
# ============================================================

def compose(f_prog: List[Instruction], g_progs: List[List[Instruction]]) -> List[Instruction]:
    """
    Build program for:
        h(x) = f(g1(x), g2(x), ...)
    following Chapter 3 composition idea.

    Strategy:
    - Compute each gi(x)
    - Store results in registers
    - Reset workspace
    - Run f
    """

    program = []
    storage_base = 10  # safe high registers

    for i, g in enumerate(g_progs):
        program = concat_programs(program, g)
        program.append(("T", 0, storage_base + i))

    # Load into R1, R2, ...
    for i in range(len(g_progs)):
        program.append(("T", storage_base + i, i + 1))

    program = concat_programs(program, f_prog)

    return program


# ============================================================
# Execution helper with trace
# ============================================================

def run(program: List[Instruction], inputs: List[int], max_steps=1000):
    """
    Inputs go into R1, R2, ...
    R0 is output register
    """
    registers = [0] + inputs[:]  # R0=0, inputs start at R1

    result = execute(
        program,
        registers,
        max_steps=max_steps,
        record_trace=True
    )

    return result


# ============================================================
# Quick demos
# ============================================================

if __name__ == "__main__":

    print("=== Successor ===")
    prog = successor()
    res = run(prog, [5])
    print(res["final_registers"])

    print("\n=== Addition 4 + 3 ===")
    prog = add()
    res = run(prog, [4, 3])
    print(res["final_registers"])

    print("\n=== Multiplication 3 * 2 ===")
    prog = multiply()
    res = run(prog, [3, 2])
    print(res["final_registers"])

from urm_macros import add, run
from visualize import pretty_trace

res = run(add(), [4, 3])
pretty_trace(res["trace"])

