from __future__ import annotations

from typing import List, Optional, Tuple

from pydantic import BaseModel

Instruction = Tuple
Program = List[Instruction]


class FunctionSpec(BaseModel):
    kind: str
    relation: Optional[str] = None
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


def _normalized_relation(relation: str) -> str:
    return relation.strip().lower().replace("-", "_")


def _require_characteristic_relation(spec: FunctionSpec) -> str:
    if type(spec.relation) is not str:
        raise ValueError("characteristic requires `relation`")

    relation = _normalized_relation(spec.relation)
    if relation not in {"leq", "lt", "eq", "divides"}:
        raise ValueError(
            "characteristic requires `relation` to be one of: leq, lt, eq, divides"
        )

    return relation


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

    if kind in {"zero", "succ", "successor", "pred", "predecessor", "truncated_predecessor", "const", "constant"}:
        return 1

    if kind in {"add", "addition", "bounded_sub", "truncated_sub", "truncated_subtraction", "sub"}:
        return 2

    if kind == "characteristic":
        _require_characteristic_relation(spec)
        return 2

    if kind in {"proj", "projection"}:
        return _require_nonnegative_param(spec.arity, name="arity", kind=kind)

    if kind == "compose":
        inner = _require_child(spec.inner, "inner", kind)
        _require_child(spec.outer, "outer", kind)
        return infer_function_arity(inner)

    if kind in {"minimization", "min", "mu"}:
        inner = _require_child(spec.inner, "inner", kind)
        inner_arity = infer_function_arity(inner)
        if inner_arity < 1:
            raise ValueError("minimization inner function must have arity at least 1")
        return inner_arity - 1

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


def _compile_minimization_flat_parts(spec: FunctionSpec) -> tuple[Program, dict]:
    kind = _normalized_kind(spec.kind)
    inner = _require_child(spec.inner, "inner", kind)

    total_arity = infer_function_arity(spec)
    inner_arity = infer_function_arity(inner)
    if inner_arity != total_arity + 1:
        raise ValueError("minimization inner arity must be exactly outer arity + 1")

    inner_program = compile_function_to_program(inner)

    candidate_register = total_arity
    inner_output_register = total_arity + 1
    zero_register = total_arity + 2
    inner_workspace_start = total_arity + 3
    inner_workspace_size = _workspace_size(inner_program)

    program: Program = []

    init_candidate_start = len(program)
    program.extend([("Z", candidate_register)])
    program.extend([("Z", zero_register)])
    init_candidate_end = len(program) - 1

    loop_prepare_start = len(program)
    program.extend(build_clear_block(inner_workspace_start, inner_workspace_size))
    program.extend(build_copy_block([
        (src, inner_workspace_start + dst)
        for dst, src in enumerate(range(total_arity))
    ]))
    program.extend(build_copy_block([
        (candidate_register, inner_workspace_start + total_arity),
    ]))
    loop_prepare_end = len(program) - 1

    loop_inner_start = len(program)
    _, loop_inner_end = append_program(program, inner_program, register_offset=inner_workspace_start)

    loop_read_output_start = len(program)
    program.extend(build_copy_block([
        (inner_workspace_start, inner_output_register),
    ]))
    loop_read_output_end = len(program) - 1

    loop_test_start = len(program)
    program.extend([("J", inner_output_register, zero_register, -1)])
    loop_test_end = len(program) - 1

    loop_increment_start = len(program)
    program.extend([("S", candidate_register)])
    program.extend([("J", zero_register, zero_register, loop_prepare_start)])
    loop_increment_end = len(program) - 1

    finalize_start = len(program)
    program.extend(build_copy_block([
        (candidate_register, 0),
    ]))
    finalize_end = len(program) - 1

    program[loop_test_start] = ("J", inner_output_register, zero_register, finalize_start)

    metadata = {
        "register_layout": {
            "input_registers": list(range(total_arity)),
            "candidate_register": candidate_register,
            "inner_output_register": inner_output_register,
            "zero_register": zero_register,
            "inner_workspace_start": inner_workspace_start,
            "inner_workspace_size": inner_workspace_size,
        },
        "sections": {
            "init_candidate": {
                "start_instruction": init_candidate_start,
                "end_instruction": init_candidate_end,
            },
            "loop_prepare_inner_inputs": {
                "start_instruction": loop_prepare_start,
                "end_instruction": loop_prepare_end,
            },
            "loop_inner_body": {
                "start_instruction": loop_inner_start,
                "end_instruction": loop_inner_end,
            },
            "loop_read_inner_output": {
                "start_instruction": loop_read_output_start,
                "end_instruction": loop_read_output_end,
            },
            "loop_test_zero": {
                "start_instruction": loop_test_start,
                "end_instruction": loop_test_end,
            },
            "loop_increment_candidate": {
                "start_instruction": loop_increment_start,
                "end_instruction": loop_increment_end,
            },
            "finalize": {
                "start_instruction": finalize_start,
                "end_instruction": finalize_end,
            },
        },
    }

    return program, metadata


def compile_minimization_flat(spec: FunctionSpec) -> Program:
    program, _ = _compile_minimization_flat_parts(spec)
    return program


def compile_minimization_program(spec: FunctionSpec) -> tuple[Program, dict]:
    return _compile_minimization_flat_parts(spec)


def _append_bounded_sub(
    target: Program,
    *,
    bounded_sub_program: Program,
    left_register: int,
    right_register: int,
    workspace_start: int,
    result_register: int,
) -> None:
    workspace_size = _workspace_size(bounded_sub_program)
    target.extend(build_clear_block(workspace_start, workspace_size))
    target.extend(
        build_copy_block(
            [
                (left_register, workspace_start),
                (right_register, workspace_start + 1),
            ]
        )
    )
    append_program(target, bounded_sub_program, register_offset=workspace_start)
    target.extend(build_copy_block([(workspace_start, result_register)]))


def _compile_characteristic_leq(bounded_sub_program: Program) -> Program:
    # x <= y iff x ∸ y = 0
    d_register = 2
    zero_register = 3
    workspace_start = 4

    program: Program = []
    program.extend([("Z", zero_register)])
    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=0,
        right_register=1,
        workspace_start=workspace_start,
        result_register=d_register,
    )
    program.extend([("Z", 0), ("S", 0)])
    truth_jump_index = len(program)
    program.append(("J", d_register, zero_register, -1))
    program.extend([("Z", 0)])
    done_index = len(program)
    program[truth_jump_index] = ("J", d_register, zero_register, done_index)
    return program


def _compile_characteristic_lt(bounded_sub_program: Program) -> Program:
    # x < y iff (x + 1) ∸ y = 0
    left_register = 2
    d_register = 3
    zero_register = 4
    workspace_start = 5

    program: Program = []
    program.extend([("Z", zero_register)])
    program.extend([("T", 0, left_register), ("S", left_register)])
    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=left_register,
        right_register=1,
        workspace_start=workspace_start,
        result_register=d_register,
    )
    program.extend([("Z", 0), ("S", 0)])
    truth_jump_index = len(program)
    program.append(("J", d_register, zero_register, -1))
    program.extend([("Z", 0)])
    done_index = len(program)
    program[truth_jump_index] = ("J", d_register, zero_register, done_index)
    return program


def _compile_characteristic_eq(bounded_sub_program: Program) -> Program:
    # x = y iff both x ∸ y and y ∸ x are 0.
    d1_register = 2
    d2_register = 3
    zero_register = 4
    workspace_start_left = 5
    workspace_start_right = workspace_start_left + _workspace_size(bounded_sub_program)

    program: Program = []
    program.extend([("Z", zero_register)])
    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=0,
        right_register=1,
        workspace_start=workspace_start_left,
        result_register=d1_register,
    )
    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=1,
        right_register=0,
        workspace_start=workspace_start_right,
        result_register=d2_register,
    )
    program.extend([("Z", 0), ("S", 0)])
    check_second_index = len(program)
    program.append(("J", d1_register, zero_register, -1))
    program.extend([("Z", 0), ("J", zero_register, zero_register, -1)])
    second_check_target = len(program)
    program.append(("J", d2_register, zero_register, -1))
    program.extend([("Z", 0)])
    done_index = len(program)
    program[check_second_index] = ("J", d1_register, zero_register, second_check_target)
    program[check_second_index + 2] = ("J", zero_register, zero_register, done_index)
    program[second_check_target] = ("J", d2_register, zero_register, done_index)
    return program


def _compile_characteristic_divides(bounded_sub_program: Program) -> Program:
    # For x > 0:
    #   x | y iff repeated subtraction y := y - x reaches 0 exactly.
    # For x = 0 we use conventional semantics: 0 | y is true iff y = 0.
    x_register = 2
    remainder_register = 3
    d_register = 4
    e_register = 5
    zero_register = 6
    first_workspace_start = 7
    second_workspace_start = first_workspace_start + _workspace_size(bounded_sub_program)

    program: Program = []
    program.extend([("Z", zero_register), ("T", 0, x_register), ("T", 1, remainder_register)])

    x_is_zero_jump_index = len(program)
    program.append(("J", x_register, zero_register, -1))

    loop_start = len(program)
    remainder_is_zero_jump_index = len(program)
    program.append(("J", remainder_register, zero_register, -1))

    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=remainder_register,
        right_register=x_register,
        workspace_start=first_workspace_start,
        result_register=d_register,
    )
    d_is_zero_jump_index = len(program)
    program.append(("J", d_register, zero_register, -1))
    program.extend(
        [
            ("T", d_register, remainder_register),
            ("J", zero_register, zero_register, loop_start),
        ]
    )

    d_zero_handler_index = len(program)
    _append_bounded_sub(
        program,
        bounded_sub_program=bounded_sub_program,
        left_register=x_register,
        right_register=remainder_register,
        workspace_start=second_workspace_start,
        result_register=e_register,
    )
    e_is_zero_jump_index = len(program)
    program.append(("J", e_register, zero_register, -1))
    false_return_index = len(program)
    program.extend([("Z", 0), ("J", zero_register, zero_register, -1)])

    equal_case_index = len(program)
    program.extend([("Z", remainder_register), ("J", zero_register, zero_register, loop_start)])

    x_zero_handler_index = len(program)
    y_zero_when_x_zero_jump_index = len(program)
    program.append(("J", remainder_register, zero_register, -1))
    x_zero_false_index = len(program)
    program.extend([("Z", 0), ("J", zero_register, zero_register, -1)])

    true_return_index = len(program)
    program.extend([("Z", 0), ("S", 0)])
    done_index = len(program)

    program[x_is_zero_jump_index] = ("J", x_register, zero_register, x_zero_handler_index)
    program[remainder_is_zero_jump_index] = (
        "J",
        remainder_register,
        zero_register,
        true_return_index,
    )
    program[d_is_zero_jump_index] = ("J", d_register, zero_register, d_zero_handler_index)
    program[e_is_zero_jump_index] = ("J", e_register, zero_register, equal_case_index)
    program[false_return_index + 1] = ("J", zero_register, zero_register, done_index)
    program[y_zero_when_x_zero_jump_index] = (
        "J",
        remainder_register,
        zero_register,
        true_return_index,
    )
    program[x_zero_false_index + 1] = ("J", zero_register, zero_register, done_index)

    return program


def compile_characteristic_function(spec: FunctionSpec) -> Program:
    from urm_macros import bounded_sub

    relation = _require_characteristic_relation(spec)
    bounded_sub_program = bounded_sub()

    if relation == "leq":
        return _compile_characteristic_leq(bounded_sub_program)

    if relation == "lt":
        return _compile_characteristic_lt(bounded_sub_program)

    if relation == "eq":
        return _compile_characteristic_eq(bounded_sub_program)

    return _compile_characteristic_divides(bounded_sub_program)


def compile_function_to_program(spec: FunctionSpec):
    """Compile a high-level function spec into a URM instruction list."""
    from urm_macros import add, bounded_sub, constant, predecessor, projection, successor, zero

    kind = _normalized_kind(spec.kind)

    if kind == "compose":
        return compile_composed_function_flat(spec)

    if kind in {"minimization", "min", "mu"}:
        return compile_minimization_flat(spec)

    if kind in {"primrec", "primitive_recursion", "primitive_rec"}:
        return compile_primitive_recursion_flat(spec)

    if kind == "characteristic":
        return compile_characteristic_function(spec)

    if kind == "zero":
        return zero()

    if kind in {"succ", "successor"}:
        return successor()

    if kind in {"pred", "predecessor", "truncated_predecessor"}:
        return predecessor()

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
