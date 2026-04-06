from __future__ import annotations

from typing import List, Optional, Tuple

from urm import execute, instruction_to_string


Instruction = Tuple


# ============================================================
# Small helpers
# ============================================================

def run_with_inputs(program: List[Instruction], inputs: List[int], max_steps: int = 500):
    """
    Convention:
    - R0 starts at 0
    - user inputs go into R1, R2, ...
    """
    initial_registers = [0] + list(inputs)
    return execute(
        program=program,
        initial_registers=initial_registers,
        max_steps=max_steps,
        record_trace=True,
    )


def _pad_registers(regs: List[int], width: int) -> List[int]:
    if len(regs) >= width:
        return regs[:]
    return regs + [0] * (width - len(regs))


def _changed_registers(prev: Optional[List[int]], curr: List[int]) -> List[int]:
    if prev is None:
        return []
    out = []
    m = max(len(prev), len(curr))
    prev2 = _pad_registers(prev, m)
    curr2 = _pad_registers(curr, m)
    for i in range(m):
        if prev2[i] != curr2[i]:
            out.append(i)
    return out


def _format_registers(regs: List[int], changed: List[int], max_regs: int) -> str:
    padded = _pad_registers(regs, max_regs)
    parts = []
    for i, val in enumerate(padded):
        cell = f"R{i}={val}"
        if i in changed:
            cell = f"*{cell}*"
        parts.append(cell)
    return "  ".join(parts)


def _short_instr(instr) -> str:
    if instr is None:
        return "START"
    return instruction_to_string(instr)


def _step_rows(trace, max_regs: int):
    """
    Convert execute(...) trace into printable rows.
    Each row is a dict with:
      step, pc, instr, regs, changed, note
    """
    rows = []
    prev_regs = None
    for t in trace:
        changed = _changed_registers(prev_regs, t.registers)
        rows.append(
            {
                "step": t.step,
                "pc": t.pc,
                "instr": _short_instr(t.instruction),
                "regs": _format_registers(t.registers, changed, max_regs),
                "note": t.note,
            }
        )
        prev_regs = t.registers
    return rows


def _truncate(s: str, width: int) -> str:
    if len(s) <= width:
        return s.ljust(width)
    if width <= 3:
        return s[:width]
    return s[: width - 3] + "..."


# ============================================================
# Side-by-side comparison printer
# ============================================================

def compare_traces(
    program_left: List[Instruction],
    program_right: List[Instruction],
    inputs: List[int],
    *,
    left_name: str = "Program A",
    right_name: str = "Program B",
    max_steps: int = 500,
    max_regs: Optional[int] = None,
    col_width: int = 58,
) -> None:
    """
    Execute two URM programs on the same inputs and print their traces side-by-side.
    Changed registers are marked with *...*.
    """

    left_result = run_with_inputs(program_left, inputs, max_steps=max_steps)
    right_result = run_with_inputs(program_right, inputs, max_steps=max_steps)

    left_trace = left_result["trace"]
    right_trace = right_result["trace"]

    inferred_max_regs = 0
    for t in left_trace:
        inferred_max_regs = max(inferred_max_regs, len(t.registers))
    for t in right_trace:
        inferred_max_regs = max(inferred_max_regs, len(t.registers))
    if max_regs is None:
        max_regs = inferred_max_regs

    left_rows = _step_rows(left_trace, max_regs)
    right_rows = _step_rows(right_trace, max_regs)

    total_rows = max(len(left_rows), len(right_rows))

    title_left = f"{left_name} | halted={left_result['halted']} | output={left_result['output']}"
    title_right = f"{right_name} | halted={right_result['halted']} | output={right_result['output']}"

    divider = "-" * col_width + "-+-" + "-" * col_width

    print(_truncate(title_left, col_width) + " | " + _truncate(title_right, col_width))
    print(divider)

    for i in range(total_rows):
        left = left_rows[i] if i < len(left_rows) else None
        right = right_rows[i] if i < len(right_rows) else None

        left_block = _render_row_block(left)
        right_block = _render_row_block(right)

        block_height = max(len(left_block), len(right_block))
        while len(left_block) < block_height:
            left_block.append("")
        while len(right_block) < block_height:
            right_block.append("")

        for a, b in zip(left_block, right_block):
            print(_truncate(a, col_width) + " | " + _truncate(b, col_width))

        print(divider)

    print("FINAL REGISTERS")
    print(_truncate(str(left_result["final_registers"]), col_width) + " | " +
          _truncate(str(right_result["final_registers"]), col_width))


def _render_row_block(row) -> List[str]:
    if row is None:
        return [""]

    return [
        f"step={row['step']}  pc={row['pc']}  instr={row['instr']}",
        row["regs"],
        f"note: {row['note']}",
    ]


# ============================================================
# Convenience: compare one program against itself
# ============================================================

def compare_same(program: List[Instruction], inputs: List[int], *, name: str = "Program", max_steps: int = 500):
    compare_traces(
        program,
        program,
        inputs,
        left_name=name,
        right_name=name,
        max_steps=max_steps,
    )


# ============================================================
# Example usage
# ============================================================

if __name__ == "__main__":
    from urm_macros import successor, constant, add

    print("\n=== Example 1: successor vs constant(3) on input [5] ===\n")
    compare_traces(
        successor(),
        constant(3),
        [5],
        left_name="successor",
        right_name="constant(3)",
        max_steps=50,
    )

    print("\n=== Example 2: add vs add on inputs [4, 3] ===\n")
    compare_traces(
        add(),
        add(),
        [4, 3],
        left_name="add-left",
        right_name="add-right",
        max_steps=100,
    )
    