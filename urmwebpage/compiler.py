from __future__ import annotations

from typing import List, Optional, Tuple

from pydantic import BaseModel

Instruction = Tuple
Program = List[Instruction]


class FunctionSpec(BaseModel):
    kind: str
    value: Optional[int] = None
    index: Optional[int] = None
    arity: Optional[int] = None
    outer: Optional["FunctionSpec"] = None
    inner: Optional["FunctionSpec"] = None
    base: Optional["FunctionSpec"] = None
    step: Optional["FunctionSpec"] = None
    recursion_index: Optional[int] = None


def _normalized_kind(kind: str) -> str:
    return kind.strip().lower().replace("-", "_")


def _require_nonnegative_param(value: Optional[int], name: str, kind: str) -> int:
    if value is None:
        raise ValueError(f"{kind} requires `{name}`")
    if type(value) is not int or value < 0:
        raise ValueError(f"{kind} requires `{name}` to be a nonnegative integer")
    return value


def _require_positive_param(value: Optional[int], name: str, kind: str) -> int:
    if value is None:
        raise ValueError(f"{kind} requires `{name}`")
    if type(value) is not int or value <= 0:
        raise ValueError(f"{kind} requires `{name}` to be a positive integer")
    return value


def _max_register_index(program: Program) -> int:
    max_index = -1
    for instr in program:
        op = instr[0]
        if op in {"Z", "S"}:
            max_index = max(max_index, instr[1])
        elif op == "T":
            max_index = max(max_index, instr[1], instr[2])
        elif op == "J":
            max_index = max(max_index, instr[1], instr[2])
    return max_index


def _workspace_size(program: Program) -> int:
    return _max_register_index(program) + 1


def relocate_jumps(program: Program, instruction_offset: int) -> Program:
    relocated: Program = []
    for instr in program:
        if instr[0] == "J":
            op, m, n, q = instr
            relocated.append((op, m, n, q + instruction_offset))
        else:
            relocated.append(instr)
    return relocated


def remap_registers(program: Program, register_offset: int) -> Program:
    remapped: Program = []
    for instr in program:
        op = instr[0]
        if op in {"Z", "S"}:
            remapped.append((op, instr[1] + register_offset))
        elif op == "T":
            remapped.append((op, instr[1] + register_offset, instr[2] + register_offset))
        elif op == "J":
            remapped.append((op, instr[1] + register_offset, instr[2] + register_offset, instr[3]))
        else:
            raise ValueError(f"Unsupported instruction opcode: {op}")
    return remapped


def append_program(target: Program, program: Program, *, register_offset: int = 0) -> tuple[int, int]:
    start = len(target)
    adjusted = remap_registers(program, register_offset)
    adjusted = relocate_jumps(adjusted, start)
    target.extend(adjusted)
    return start, len(target) - 1


def build_copy_block(pairs: List[tuple[int, int]]) -> Program:
    return [("T", src, dst) for src, dst in pairs]


def build_clear_block(start_register: int, count: int) -> Program:
    return [("Z", start_register + offset) for offset in range(max(count, 0))]


def _require_child(spec: Optional[FunctionSpec], field_name: str, kind: str) -> FunctionSpec:
    if spec is None:
        raise ValueError(f"{kind} requires `{field_name}`")
    return spec


def infer_function_arity(spec: FunctionSpec) -> int:
    kind = _normalized_kind(spec.kind)

    if kind in {"zero", "succ", "successor", "const", "constant"}:
        return 1

    if kind in {"add", "addition", "bounded_sub", "truncated_sub", "truncated_subtraction", "sub"}:
        return 2

    if kind in {"proj", "projection"}:
        return _require_nonnegative_param(spec.arity, name="arity", kind=kind)

    if kind == "compose":
        inner = _require_child(spec.inner, "inner", kind)
        _require_child(spec.outer, "outer", kind)
        return infer_function_arity(inner)

    if kind in {"primrec", "primitive_recursion", "primitive_rec"}:
        base = _require_child(spec.base, "base", kind)
        step = _require_child(spec.step, "step", kind)
        base_arity = infer_function_arity(base)
        step_arity = infer_function_arity(step)
        required_step_arity = base_arity + 2
        if step_arity > required_step_arity:
            raise ValueError(
                f"{kind} step arity {step_arity} exceeds the available primitive recursion inputs {required_step_arity}"
            )
        recursion_index = 0 if spec.recursion_index is None else spec.recursion_index
        if type(recursion_index) is not int or recursion_index < 0 or recursion_index > base_arity:
            raise ValueError(
                f"{kind} requires `recursion_index` to be within 0..{base_arity}"
            )
        return base_arity + 1

    raise ValueError(f"Unsupported function kind: {spec.kind}")


def compile_composed_function_flat(spec: FunctionSpec) -> Program:
    kind = _normalized_kind(spec.kind)
    inner = _require_child(spec.inner, "inner", kind)
    outer = _require_child(spec.outer, "outer", kind)

    inner_arity = infer_function_arity(inner)
    outer_arity = infer_function_arity(outer)
    if outer_arity != 1:
        raise ValueError("compose requires `outer` to be unary")

    inner_program = compile_function_to_program(inner)
    outer_program = compile_function_to_program(outer)

    inner_workspace_start = inner_arity
    inner_workspace_size = _workspace_size(inner_program)
    outer_workspace_start = inner_workspace_start + inner_workspace_size
    outer_workspace_size = _workspace_size(outer_program)

    program: Program = []

    program.extend(build_clear_block(inner_workspace_start, inner_workspace_size))
    program.extend(build_copy_block([
        (input_register, inner_workspace_start + input_register)
        for input_register in range(inner_arity)
    ]))
    append_program(program, inner_program, register_offset=inner_workspace_start)

    program.extend(build_clear_block(outer_workspace_start, outer_workspace_size))
    program.extend(build_copy_block([
        (inner_workspace_start, outer_workspace_start),
    ]))
    append_program(program, outer_program, register_offset=outer_workspace_start)
    program.extend(build_copy_block([
        (outer_workspace_start, 0),
    ]))

    return program


def _compile_primitive_recursion_flat_parts(spec: FunctionSpec) -> tuple[Program, dict]:
    kind = _normalized_kind(spec.kind)
    base = _require_child(spec.base, "base", kind)
    step = _require_child(spec.step, "step", kind)

    base_arity = infer_function_arity(base)
    step_arity = infer_function_arity(step)
    required_step_arity = base_arity + 2
    if step_arity > required_step_arity:
        raise ValueError(
            f"{kind} step arity {step_arity} exceeds the available primitive recursion inputs {required_step_arity}"
        )

    recursion_index = 0 if spec.recursion_index is None else spec.recursion_index
    if type(recursion_index) is not int or recursion_index < 0 or recursion_index > base_arity:
        raise ValueError(f"{kind} requires `recursion_index` to be within 0..{base_arity}")

    base_program = compile_function_to_program(base)
    step_program = compile_function_to_program(step)
    total_arity = base_arity + 1
    carried_input_registers = [
        register for register in range(total_arity) if register != recursion_index
    ]

    # Primitive recursion register layout:
    # - R0..R(total_arity-1): original function inputs, including the recursion input.
    # - R(total_arity): current result r = f(x_bar, i)
    # - R(total_arity + 1): loop counter i
    # - base workspace: isolated registers for compiling g(x_bar)
    # - step workspace: isolated registers for compiling h(previous, i, x_bar)
    #
    # The base/step subprograms are compiled relative to R0, so when we embed
    # them we must relocate both their jump targets and their working registers.
    result_register = total_arity
    counter_register = total_arity + 1
    base_workspace_start = counter_register + 1
    base_workspace_size = _workspace_size(base_program)
    step_workspace_start = base_workspace_start + base_workspace_size
    step_workspace_size = _workspace_size(step_program)

    program: Program = []
    base_setup_start = len(program)

    program.extend(build_clear_block(base_workspace_start, base_workspace_size))
    program.extend(build_copy_block([
        (src, base_workspace_start + dst)
        for dst, src in enumerate(carried_input_registers)
    ]))
    base_body_start = len(program)
    _, base_body_end = append_program(program, base_program, register_offset=base_workspace_start)
    program.extend(build_copy_block([
        (base_workspace_start, result_register),
    ]))
    program.extend([("Z", counter_register)])
    base_end = len(program) - 1

    loop_test_index = len(program)
    program.extend([("J", counter_register, recursion_index, -1)])

    step_setup_start = len(program)
    program.extend(build_clear_block(step_workspace_start, step_workspace_size))

    step_input_pairs = [(result_register, step_workspace_start)]
    if required_step_arity >= 2:
        step_input_pairs.append((counter_register, step_workspace_start + 1))
    step_input_pairs.extend(
        (src, step_workspace_start + 2 + dst)
        for dst, src in enumerate(carried_input_registers)
    )
    program.extend(build_copy_block(step_input_pairs))

    step_body_start = len(program)
    _, step_body_end = append_program(program, step_program, register_offset=step_workspace_start)
    program.extend(build_copy_block([
        (step_workspace_start, result_register),
    ]))
    program.extend([("S", counter_register)])
    program.extend([("J", counter_register, counter_register, loop_test_index)])
    step_end = len(program) - 1

    done_index = len(program)
    program[loop_test_index] = ("J", counter_register, recursion_index, done_index)

    finalize_start = len(program)
    program.extend(build_copy_block([
        (result_register, 0),
    ]))
    finalize_end = len(program) - 1

    metadata = {
        "register_layout": {
            "input_registers": list(range(total_arity)),
            "recursion_register": recursion_index,
            "carried_input_registers": carried_input_registers,
            "result_register": result_register,
            "counter_register": counter_register,
            "base_workspace_start": base_workspace_start,
            "base_workspace_size": base_workspace_size,
            "step_workspace_start": step_workspace_start,
            "step_workspace_size": step_workspace_size,
        },
        "sections": {
            "base_setup": {
                "start_instruction": base_setup_start,
                "end_instruction": base_body_start - 1,
            },
            "base_body": {
                "start_instruction": base_body_start,
                "end_instruction": base_body_end,
            },
            "base_complete": {
                "start_instruction": base_setup_start,
                "end_instruction": base_end,
            },
            "loop_test": {
                "start_instruction": loop_test_index,
                "end_instruction": loop_test_index,
            },
            "step_setup": {
                "start_instruction": step_setup_start,
                "end_instruction": step_body_start - 1,
            },
            "step_body": {
                "start_instruction": step_body_start,
                "end_instruction": step_body_end,
            },
            "step_complete": {
                "start_instruction": step_setup_start,
                "end_instruction": step_end,
            },
            "finalize": {
                "start_instruction": finalize_start,
                "end_instruction": finalize_end,
            },
        },
    }

    return program, metadata


def compile_primitive_recursion_flat(spec: FunctionSpec) -> Program:
    program, _ = _compile_primitive_recursion_flat_parts(spec)
    return program


def compile_primitive_recursion_program(spec: FunctionSpec) -> tuple[Program, dict]:
    return _compile_primitive_recursion_flat_parts(spec)


def compile_function_to_program(spec: FunctionSpec):
    """Compile a high-level function spec into a URM instruction list."""
    from urm_macros import add, bounded_sub, constant, projection, successor, zero

    kind = _normalized_kind(spec.kind)

    if kind == "compose":
        return compile_composed_function_flat(spec)

    if kind in {"primrec", "primitive_recursion", "primitive_rec"}:
        return compile_primitive_recursion_flat(spec)

    if kind == "zero":
        return zero()

    if kind in {"succ", "successor"}:
        return successor()

    if kind in {"const", "constant"}:
        return constant(_require_nonnegative_param(spec.value, name="value", kind=kind))

    if kind in {"proj", "projection"}:
        index = _require_positive_param(spec.index, name="index", kind=kind)
        arity = spec.arity
        if arity is not None:
            arity = _require_positive_param(spec.arity, name="arity", kind=kind)
            if index > arity:
                raise ValueError(f"{kind} requires `index` to be within 1..{arity}")
        return projection(index)

    if kind in {"add", "addition"}:
        return add()

    if kind in {"bounded_sub", "truncated_sub", "truncated_subtraction", "sub"}:
        return bounded_sub()

    raise ValueError(f"Unsupported function kind: {spec.kind}")


def compile_function(spec: FunctionSpec):
    """Backward-compatible compiler entry point for older callers."""
    return compile_function_to_program(spec)


FunctionSpec.model_rebuild()
