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
    step_argument_indices: Optional[List[int]] = None
    inners: Optional[List["FunctionSpec"]] = None


def _normalized_kind(kind: str) -> str:
    return kind.strip().lower().replace("-", "_")


def _normalized_relation(relation: str) -> str:
    return relation.strip().lower().replace("-", "_")


def _is_multiplication_kind(kind: str) -> bool:
    return _normalized_kind(kind) in {"multiplication", "multiply", "mult"}


def _is_exponentiation_kind(kind: str) -> bool:
    return _normalized_kind(kind) in {"exponentiation", "power", "pow"}


def _is_factorial_kind(kind: str) -> bool:
    return _normalized_kind(kind) in {"factorial", "fact"}


def _is_geometric_sum_kind(kind: str) -> bool:
    return _normalized_kind(kind) in {"geometric_sum", "geom"}


def _is_divisor_count_kind(kind: str) -> bool:
    return _normalized_kind(kind) in {"divisor_count", "num_divisors"}


def build_multiplication_primitive_recursion_spec() -> FunctionSpec:
    return FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="zero"),
        step=FunctionSpec(kind="add"),
        recursion_index=1,
        step_argument_indices=[0, 2],
    )


def build_exponentiation_primitive_recursion_spec() -> FunctionSpec:
    return FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="constant", value=1),
        step=FunctionSpec(kind="multiplication"),
        recursion_index=1,
        step_argument_indices=[0, 2],
    )


def build_factorial_primitive_recursion_spec() -> FunctionSpec:
    # fact(n) = n!, by primitive recursion on n:
    #   fact(0) = 1
    #   fact(n+1) = fact(n) * (n+1)
    #
    # When the helper computes fact(k+1) from fact(k) the loop counter holds k
    # (0-based), so the step must multiply the running result by (k+1). The
    # primitive-recursion helper exposes the counter as k, not k+1, so the
    # "* (k+1)" is expressed as a nested primitive recursion
    #   g(a, b) = a * (b + 1) = a*b + a:
    #       g(a, 0)   = a              (projection of the first argument)
    #       g(a, b+1) = g(a, b) + a    (add)
    #
    # The helper's base function must have arity >= 1 (there are no nullary
    # functions), so this expands to a *binary* spec fact(n, _): the recursion
    # variable is the first input (recursion_index=0) and the second input is an
    # unused carried dummy. Callers may pass a single register; the dummy
    # defaults to 0. This dummy is the only arity-floor workaround here.
    multiply_by_counter_plus_one = FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="projection", index=1, arity=1),
        step=FunctionSpec(kind="add"),
        recursion_index=1,
        step_argument_indices=[0, 2],
    )
    return FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="constant", value=1),
        step=multiply_by_counter_plus_one,
        recursion_index=0,
        step_argument_indices=[0, 1],
    )


def build_geometric_sum_primitive_recursion_spec() -> FunctionSpec:
    # geom(x, y) = 1 + x + x^2 + ... + x^y, by primitive recursion on y:
    #   geom(x, 0)   = 1
    #   geom(x, y+1) = geom(x, y) + x^(y+1)
    #
    # Recursion is on the second input (recursion_index=1), so x is the single
    # carried input. The step receives [previous, counter, x] via
    # step_argument_indices=[0, 1, 2]. The loop counter holds k (0-based) when
    # computing geom(x, k+1), so the term to add is x^(k+1) = exp(x, succ(k)).
    #
    # The transformed argument succ(counter) and the subcomputation exp(...) are
    # built with the internal `substitution` kind (generalized composition):
    #   step(previous, counter, x) = add(previous, exp(x, succ(counter)))
    # All inner functions of a substitution share the step arity (3 here), so the
    # projections below select previous (1), counter (2), and x (3).
    counter_plus_one = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="successor"),
        inners=[FunctionSpec(kind="projection", index=2, arity=3)],
    )
    x_pow_counter_plus_one = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="exponentiation"),
        inners=[
            FunctionSpec(kind="projection", index=3, arity=3),
            counter_plus_one,
        ],
    )
    step = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="add"),
        inners=[
            FunctionSpec(kind="projection", index=1, arity=3),
            x_pow_counter_plus_one,
        ],
    )
    return FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="constant", value=1),
        step=step,
        recursion_index=1,
        step_argument_indices=[0, 1, 2],
    )


def build_divisor_count_function_spec() -> FunctionSpec:
    # divisor_count(n) = |{d : 1 <= d <= n and d divides n}|.
    #
    # First build a binary helper by primitive recursion on k:
    #   g(n, 0)   = 0
    #   g(n, k+1) = g(n, k) + characteristic:divides(k+1, n)
    #
    # Recursion is on the second input (recursion_index=1), so n is the carried
    # input. The step receives [previous, counter, n]; the loop counter is k
    # while computing the k+1 case, so successor(counter) produces the positive
    # candidate divisor k+1.
    counter_plus_one = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="successor"),
        inners=[FunctionSpec(kind="projection", index=2, arity=3)],
    )
    divides_counter_plus_one_n = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="characteristic", relation="divides"),
        inners=[
            counter_plus_one,
            FunctionSpec(kind="projection", index=3, arity=3),
        ],
    )
    step = FunctionSpec(
        kind="substitution",
        outer=FunctionSpec(kind="add"),
        inners=[
            FunctionSpec(kind="projection", index=1, arity=3),
            divides_counter_plus_one_n,
        ],
    )
    count_up_to_k = FunctionSpec(
        kind="primrec",
        base=FunctionSpec(kind="zero"),
        step=step,
        recursion_index=1,
        step_argument_indices=[0, 1, 2],
    )

    # The public function is unary: divisor_count(n) = g(n, n).
    return FunctionSpec(
        kind="substitution",
        outer=count_up_to_k,
        inners=[
            FunctionSpec(kind="projection", index=1, arity=1),
            FunctionSpec(kind="projection", index=1, arity=1),
        ],
    )


def expand_builtin_function_spec(spec: FunctionSpec) -> FunctionSpec:
    if _is_multiplication_kind(spec.kind):
        return build_multiplication_primitive_recursion_spec()

    if _is_exponentiation_kind(spec.kind):
        return build_exponentiation_primitive_recursion_spec()

    if _is_factorial_kind(spec.kind):
        return build_factorial_primitive_recursion_spec()

    if _is_geometric_sum_kind(spec.kind):
        return build_geometric_sum_primitive_recursion_spec()

    if _is_divisor_count_kind(spec.kind):
        return build_divisor_count_function_spec()

    return spec


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


def _resolve_substitution(spec: FunctionSpec) -> tuple[FunctionSpec, List[FunctionSpec], int]:
    """Validate a substitution spec and return (outer, inners, shared_inner_arity).

    Substitution computes outer(inner_0(x), ..., inner_{k-1}(x)). All inners must
    share one arity (they receive the same inputs) and the number of inners must
    equal the outer arity. Shared between arity inference and lowering so the
    rules and error messages stay identical.
    """
    outer = _require_child(spec.outer, "outer", "substitution")
    inners = spec.inners
    if inners is None or not isinstance(inners, list) or len(inners) == 0:
        raise ValueError("substitution requires a non-empty `inners` list")

    outer_arity = infer_function_arity(outer)
    if len(inners) != outer_arity:
        raise ValueError(
            f"substitution requires exactly {outer_arity} inner function(s) to match "
            f"the outer arity, got {len(inners)}"
        )

    inner_arities = [infer_function_arity(inner) for inner in inners]
    if len(set(inner_arities)) != 1:
        raise ValueError(
            f"substitution requires all inner functions to share one arity, got {inner_arities}"
        )

    return outer, inners, inner_arities[0]


def infer_function_arity(spec: FunctionSpec) -> int:
    kind = _normalized_kind(spec.kind)

    if _is_multiplication_kind(kind):
        return infer_function_arity(build_multiplication_primitive_recursion_spec())

    if _is_exponentiation_kind(kind):
        return infer_function_arity(build_exponentiation_primitive_recursion_spec())

    if _is_factorial_kind(kind):
        return infer_function_arity(build_factorial_primitive_recursion_spec())

    if _is_geometric_sum_kind(kind):
        return infer_function_arity(build_geometric_sum_primitive_recursion_spec())

    if _is_divisor_count_kind(kind):
        return infer_function_arity(build_divisor_count_function_spec())

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

    if kind == "substitution":
        _, _, inner_arity = _resolve_substitution(spec)
        return inner_arity

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


def compile_substitution_flat(spec: FunctionSpec) -> Program:
    """Compile outer(inner_0(x), ..., inner_{k-1}(x)) into a flat URM program.

    Generalizes the workspace-offset isolation of compile_composed_function_flat
    to k inner functions. Deliberately does NOT use urm_macros.compose, which
    clobbers shared inputs across inners and hardcodes a colliding storage base.

    Register layout (n = shared inner arity, k = number of inners):
        R0 .. R(n-1)              original inputs x, preserved throughout
        R(n) .. R(n+k-1)          result region: inner_i output lands here
        inner_workspace_start = n + k    reused inner workspace (cleared per inner)
        outer_workspace_start = inner_workspace_start + max_inner_workspace_size

    Each inner program is embedded at inner_workspace_start, so it can only touch
    registers >= n + k: it never overwrites the inputs (read from fresh copies)
    or the result region (which sits below the workspace). This is what keeps
    inputs preserved and prevents inner programs from clobbering each other.
    """
    outer, inners, inner_arity = _resolve_substitution(spec)

    inner_programs = [compile_function_to_program(inner) for inner in inners]
    outer_program = compile_function_to_program(outer)

    n = inner_arity
    k = len(inners)
    results_start = n
    inner_workspace_start = n + k
    max_inner_workspace_size = max(
        (_workspace_size(inner_program) for inner_program in inner_programs),
        default=0,
    )
    outer_workspace_start = inner_workspace_start + max_inner_workspace_size
    outer_workspace_size = _workspace_size(outer_program)

    program: Program = []

    for index, inner_program in enumerate(inner_programs):
        program.extend(build_clear_block(inner_workspace_start, max_inner_workspace_size))
        program.extend(build_copy_block([
            (input_register, inner_workspace_start + input_register)
            for input_register in range(n)
        ]))
        append_program(program, inner_program, register_offset=inner_workspace_start)
        program.extend(build_copy_block([
            (inner_workspace_start, results_start + index),
        ]))

    program.extend(build_clear_block(outer_workspace_start, outer_workspace_size))
    program.extend(build_copy_block([
        (results_start + index, outer_workspace_start + index)
        for index in range(k)
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

    default_step_argument_indices = list(range(required_step_arity))
    step_argument_indices = spec.step_argument_indices
    if step_argument_indices is None:
        resolved_step_argument_indices = default_step_argument_indices
    else:
        if not isinstance(step_argument_indices, list):
            raise ValueError(f"{kind} step_argument_indices must be a list")
        if len(step_argument_indices) != step_arity:
            raise ValueError(
                f"{kind} step_argument_indices must contain exactly {step_arity} entries"
            )
        for index in step_argument_indices:
            if type(index) is not int or index < 0 or index >= required_step_arity:
                raise ValueError(
                    f"{kind} step_argument_indices entries must be within 0..{required_step_arity - 1}"
                )
        resolved_step_argument_indices = list(step_argument_indices)

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

    default_step_input_sources = [
        result_register,
        counter_register,
        *carried_input_registers,
    ]
    step_input_pairs = [
        (default_step_input_sources[src_index], step_workspace_start + dst_index)
        for dst_index, src_index in enumerate(resolved_step_argument_indices)
    ]
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
            "step_argument_indices": resolved_step_argument_indices,
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

    if _is_multiplication_kind(kind):
        return compile_primitive_recursion_flat(build_multiplication_primitive_recursion_spec())

    if _is_exponentiation_kind(kind):
        return compile_primitive_recursion_flat(build_exponentiation_primitive_recursion_spec())

    if _is_factorial_kind(kind):
        return compile_primitive_recursion_flat(build_factorial_primitive_recursion_spec())

    if _is_geometric_sum_kind(kind):
        return compile_primitive_recursion_flat(build_geometric_sum_primitive_recursion_spec())

    if _is_divisor_count_kind(kind):
        return compile_function_to_program(build_divisor_count_function_spec())

    if kind == "compose":
        return compile_composed_function_flat(spec)

    if kind == "substitution":
        return compile_substitution_flat(spec)

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


# ---------------------------------------------------------------------------
# Public function-kind contract
#
# The compiler's dispatch (compile_function_to_program / infer_function_arity)
# is the behavioral source of truth for which kinds and aliases are accepted.
# This registry is the *declared* public contract derived from that dispatch:
# the canonical kinds shown in the chooser and the aliases each one accepts.
# It is exposed via GET /function-kinds so the backend has its own machine-
# readable contract instead of tests parsing the frontend menu only.
#
# Drift between this declaration and the compiler's actual behavior is caught
# by tests that compile every canonical kind and alias here (see
# test_function_kind_smoke). Keep these alias sets aligned with the kind-set
# literals used in compile_function_to_program above.
# ---------------------------------------------------------------------------
PUBLIC_FUNCTION_KINDS: dict[str, list[str]] = {
    "zero": [],
    "successor": ["succ"],
    "predecessor": ["pred", "truncated_predecessor"],
    "constant": ["const"],
    "projection": ["proj"],
    "add": ["addition"],
    "multiplication": ["multiply", "mult"],
    "exponentiation": ["power", "pow"],
    "factorial": ["fact"],
    "geometric_sum": ["geom"],
    "divisor_count": ["num_divisors"],
    "bounded_sub": ["sub", "truncated_sub", "truncated_subtraction"],
    "characteristic": [],
    "compose": [],
    "primrec": ["primitive_rec", "primitive_recursion"],
    "minimization": ["min", "mu"],
}

CHARACTERISTIC_RELATIONS: list[str] = ["leq", "lt", "eq", "divides"]


def function_kind_contract() -> dict:
    """Return the backend's canonical public function-kind contract."""
    aliases: dict[str, str] = {}
    for canonical, alias_list in PUBLIC_FUNCTION_KINDS.items():
        for alias in alias_list:
            aliases[alias] = canonical
    return {
        "canonical_kinds": list(PUBLIC_FUNCTION_KINDS.keys()),
        "aliases": aliases,
        "characteristic_relations": list(CHARACTERISTIC_RELATIONS),
    }


FunctionSpec.model_rebuild()
