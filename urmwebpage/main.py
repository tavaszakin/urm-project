from typing import Any, List, Optional, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from compiler import (
    FunctionSpec,
    compile_minimization_program,
    compile_function_to_program,
    compile_primitive_recursion_program,
    expand_builtin_function_spec,
    function_kind_contract,
    infer_function_arity,
)
from execution_models import (
    ExecutionResponse,
    ExecutionResult,
    ExecutionStatusSummary,
    MinimizationComputationStructure,
    MinimizationIterationBlock,
    TraceRow,
)
from urm_encoding import (
    decode_program_with_details,
    encode_instruction_with_details,
    encode_program_with_details,
)
from urm import DEFAULT_MAX_STEPS, execute, validate_registers

MAX_ALLOWED_STEPS = 100_000
DEFAULT_MINIMIZATION_MAX_CANDIDATES = 100
MAX_ALLOWED_MINIMIZATION_CANDIDATES = 10_000
ProgramInput = List[List[Any]] | List[tuple]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "https://urm-project-neon.vercel.app",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "URM backend running"}


@app.get("/function-kinds")
def function_kinds_endpoint():
    """Backend's canonical public function-kind contract (kinds + aliases)."""
    return function_kind_contract()


class RunRequest(BaseModel):
    program: List[List[Any]]
    initial_registers: List[int]
    max_steps: Optional[int] = Field(default=DEFAULT_MAX_STEPS, ge=1, le=MAX_ALLOWED_STEPS)


class EncodeInstructionRequest(BaseModel):
    instruction: List[Any]


class EncodeProgramRequest(BaseModel):
    program: List[List[Any]]


class DecodeProgramRequest(BaseModel):
    code: str


class CompareRequest(BaseModel):
    left: RunRequest
    right: RunRequest


class RunFunctionRequest(BaseModel):
    function: FunctionSpec
    initial_registers: List[int]
    max_steps: Optional[int] = Field(default=DEFAULT_MAX_STEPS, ge=1, le=MAX_ALLOWED_STEPS)
    max_candidates: Optional[int] = Field(
        default=DEFAULT_MINIMIZATION_MAX_CANDIDATES,
        ge=1,
        le=MAX_ALLOWED_MINIMIZATION_CANDIDATES,
    )
    execution_mode: Optional[Literal["flat"]] = None


class CompareAlignmentRow(BaseModel):
    left: Optional[int]
    right: Optional[int]


class CompareResponse(BaseModel):
    left: ExecutionResponse
    right: ExecutionResponse
    alignment: List[CompareAlignmentRow]


class FunctionExecutionResponse(ExecutionResponse):
    function: dict[str, Any]
    evaluation: Optional[dict[str, Any]] = None
    computation_structure: Optional[MinimizationComputationStructure] = None


class EncodedInstructionResponse(BaseModel):
    instruction: List[Any]
    tuple: List[int]
    code: str
    prime_factor_form: Optional[str] = None


class EncodedProgramInstructionDetail(BaseModel):
    instruction: List[Any]
    tuple: List[int]
    code: str
    prime_factor_form: Optional[str] = None


class EncodedProgramResponse(BaseModel):
    program: List[List[Any]]
    instruction_codes: List[str]
    program_tuple: List[str]
    program_code: Optional[str] = None
    program_code_decimal_digits: Optional[int] = None
    program_code_decimal_omitted: bool = False
    instruction_details: List[EncodedProgramInstructionDetail]
    program_prime_factor_form: Optional[str] = None


class DecodedProgramInstructionDetail(BaseModel):
    instruction: List[Any]
    tuple: List[int]
    code: str
    prime_factor_form: Optional[str] = None


class DecodedProgramResponse(BaseModel):
    code: str
    program: List[List[Any]]
    instruction_tuples: List[List[int]]
    program_tuple: List[str]
    instruction_details: List[DecodedProgramInstructionDetail]
    program_prime_factor_form: Optional[str] = None
    instruction_count: int
    opcode_sequence: List[str]
    opcode_counts: dict[str, int]
    is_empty_program: bool


def normalize_instruction_input(instruction: List[Any] | tuple) -> tuple:
    """Convert a request instruction into the tuple-based backend format."""
    if not isinstance(instruction, (list, tuple)):
        raise ValueError(f"Instruction must be a list or tuple, got {instruction!r}")
    return tuple(instruction)


def normalize_program_input(program: ProgramInput) -> List[tuple]:
    """Convert a request program into the tuple-based executor format."""
    if not isinstance(program, list):
        raise ValueError("Program must be a list of instructions.")

    normalized: List[tuple] = []
    for i, inst in enumerate(program):
        if not isinstance(inst, (list, tuple)):
            raise ValueError(
                f"Invalid instruction at I{i}: expected a list or tuple instruction, got {inst!r}"
            )
        normalized.append(tuple(inst))

    return normalized


def build_bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _stringify_natural(value: int) -> str:
    return str(value)


def _parse_positive_integer_string(value: str, field_name: str) -> int:
    if type(value) is not str:
        raise ValueError(f"{field_name} must be provided as a string")
    if value == "":
        raise ValueError(f"{field_name} must be a positive integer string")
    if not value.isdigit():
        raise ValueError(f"{field_name} must be a positive integer string")

    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{field_name} must be a positive integer string")

    return parsed


def compile_function_spec(spec: FunctionSpec) -> list[tuple]:
    try:
        return compile_function_to_program(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc


def _normalized_function_kind(spec: FunctionSpec) -> str:
    return spec.kind.strip().lower().replace("-", "_")


def _effective_function_spec(spec: FunctionSpec) -> FunctionSpec:
    return expand_builtin_function_spec(spec)


def _is_composed_function(spec: FunctionSpec) -> bool:
    return _normalized_function_kind(spec) == "compose"


def _is_primitive_recursive_function(spec: FunctionSpec) -> bool:
    return _normalized_function_kind(spec) in {"primrec", "primitive_recursion", "primitive_rec"}


def _is_minimization_function(spec: FunctionSpec) -> bool:
    return _normalized_function_kind(spec) in {"minimization", "min", "mu"}


def _require_primitive_recursion_index(spec: FunctionSpec, input_count: int) -> int:
    recursion_index = 0 if spec.recursion_index is None else spec.recursion_index

    if type(recursion_index) is not int or recursion_index < 0:
        raise build_bad_request("primrec requires `recursion_index` to be a nonnegative integer")

    if recursion_index >= input_count:
        raise build_bad_request("primrec recursion_index is out of range for initial_registers")

    return recursion_index


def _resolve_max_candidates(max_candidates: Optional[int]) -> int:
    return DEFAULT_MINIMIZATION_MAX_CANDIDATES if max_candidates is None else max_candidates


def build_execution_snapshot(result: ExecutionResult) -> dict[str, Any]:
    return build_frontend_compatible_run_response(result).model_dump()


def build_function_evaluation_node(
    *,
    function_spec: FunctionSpec,
    input_registers: List[int],
    result: ExecutionResult,
    evaluation: Optional[dict[str, Any]],
) -> dict[str, Any]:
    node = {
        "function": function_spec.model_dump(),
        "input_registers": list(input_registers),
        "output_value": result.output_value,
        "execution": build_execution_snapshot(result),
    }

    if evaluation is not None:
        node["evaluation"] = evaluation

    return node


def _find_next_step_in_pc_range(
    steps,
    start_index: int,
    start_pc: int,
    end_pc: int,
) -> Optional[int]:
    for index in range(max(start_index, 0), len(steps)):
        if start_pc <= steps[index].pc <= end_pc:
            return index
    return None


def _find_contiguous_step_range_end(
    steps,
    start_index: int,
    start_pc: int,
    end_pc: int,
) -> int:
    index = start_index
    end_index = start_index

    while index < len(steps) and start_pc <= steps[index].pc <= end_pc:
        end_index = index
        index += 1

    return end_index


def _build_trace_range(start_index: Optional[int], end_index: Optional[int]) -> Optional[dict[str, int]]:
    if start_index is None or end_index is None:
        return None
    return {
        # Legacy frontend trace includes an initial START row at index 0.
        "start_row_index": start_index + 1,
        "end_row_index": end_index + 1,
    }


def _read_register_after_step(result: ExecutionResult, step_index: int, register_index: int) -> int:
    if 0 <= step_index < len(result.steps):
        registers = result.steps[step_index].registers_after
    else:
        registers = result.final_registers
    return registers[register_index] if register_index < len(registers) else 0


def build_primitive_recursion_evaluation(
    *,
    spec: FunctionSpec,
    initial_registers: List[int],
    result: ExecutionResult,
    compile_metadata: dict[str, Any],
) -> dict[str, Any]:
    recursion_index = _require_primitive_recursion_index(spec, len(initial_registers))
    recursion_value = initial_registers[recursion_index]
    remaining_inputs = initial_registers[:recursion_index] + initial_registers[recursion_index + 1:]
    sections = compile_metadata["sections"]
    register_layout = compile_metadata["register_layout"]
    result_register = register_layout["result_register"]
    step_argument_indices = register_layout.get("step_argument_indices")
    steps = result.steps

    base_section = sections["base_complete"]
    loop_test_section = sections["loop_test"]
    step_section = sections["step_complete"]
    finalize_section = sections["finalize"]

    base_start_index = _find_next_step_in_pc_range(
        steps, 0, base_section["start_instruction"], base_section["end_instruction"]
    )
    base_end_index = None
    if base_start_index is not None:
        base_end_index = _find_contiguous_step_range_end(
            steps, base_start_index, base_section["start_instruction"], base_section["end_instruction"]
        )

    base_output = _read_register_after_step(
        result,
        base_end_index if base_end_index is not None else -1,
        result_register,
    )

    iterations: List[dict[str, Any]] = []
    cursor = (base_end_index + 1) if base_end_index is not None else 0
    previous_value = base_output

    for iteration in range(recursion_value):
        loop_test_index = _find_next_step_in_pc_range(
            steps, cursor, loop_test_section["start_instruction"], loop_test_section["end_instruction"]
        )
        if loop_test_index is None:
            break

        step_start_index = _find_next_step_in_pc_range(
            steps, loop_test_index + 1, step_section["start_instruction"], step_section["end_instruction"]
        )
        if step_start_index is None:
            break

        step_end_index = _find_contiguous_step_range_end(
            steps, step_start_index, step_section["start_instruction"], step_section["end_instruction"]
        )
        output_value = _read_register_after_step(result, step_end_index, result_register)
        canonical_step_inputs = [previous_value, iteration, *remaining_inputs]
        if isinstance(step_argument_indices, list):
            step_inputs = [
                canonical_step_inputs[index]
                for index in step_argument_indices
                if isinstance(index, int) and 0 <= index < len(canonical_step_inputs)
            ]
        else:
            step_inputs = canonical_step_inputs
        iterations.append({
            "iteration": iteration,
            "function": spec.step.model_dump() if spec.step is not None else None,
            "input_registers": step_inputs,
            "canonical_input_registers": canonical_step_inputs,
            "step_argument_indices": list(step_argument_indices) if isinstance(step_argument_indices, list) else None,
            "output_value": output_value,
            "trace_range": _build_trace_range(loop_test_index, step_end_index),
            "program_range": step_section,
        })
        previous_value = output_value
        cursor = step_end_index + 1

    finalize_start_index = _find_next_step_in_pc_range(
        steps, cursor, loop_test_section["start_instruction"], finalize_section["end_instruction"]
    )
    finalize_end_index = len(steps) - 1 if steps else None

    return {
        "kind": "primrec",
        "mode": "compiled_flat",
        "input_registers": list(initial_registers),
        "recursion_index": recursion_index,
        "recursion_value": recursion_value,
        "remaining_inputs": list(remaining_inputs),
        "base": {
            "function": spec.base.model_dump() if spec.base is not None else None,
            "input_registers": list(remaining_inputs),
            "output_value": base_output,
            "trace_range": _build_trace_range(base_start_index, base_end_index),
            "program_range": base_section,
        },
        "iterations": iterations,
        "finalization": {
            "trace_range": _build_trace_range(finalize_start_index, finalize_end_index),
            "program_range": {
                "start_instruction": loop_test_section["start_instruction"],
                "end_instruction": finalize_section["end_instruction"],
            },
        },
        "compiled_program": {
            "sections": sections,
            "register_layout": register_layout,
        },
        "final_output": result.output_value,
    }


def build_minimization_evaluation(
    *,
    spec: FunctionSpec,
    initial_registers: List[int],
    candidate_records: List[dict[str, Any]],
    max_candidates: int,
    search_status: str,
    final_output: Optional[int],
    success_candidate: Optional[int] = None,
) -> dict[str, Any]:
    evaluation = {
        "kind": "minimization",
        "mode": "search",
        "input_registers": list(initial_registers),
        "inner_function": spec.inner.model_dump() if spec.inner is not None else None,
        "max_candidates": max_candidates,
        "search_status": search_status,
        "candidates": candidate_records,
        "final_output": final_output,
    }

    if success_candidate is not None:
        evaluation["success_candidate"] = success_candidate

    return evaluation


def build_minimization_result(
    *,
    initial_registers: List[int],
    output_value: Optional[int],
    halted: bool,
    halt_reason: Optional[str],
) -> ExecutionResult:
    final_registers = list(initial_registers)

    if output_value is not None:
        if final_registers:
            final_registers[0] = output_value
        else:
            final_registers = [output_value]

    return ExecutionResult(
        program=[],
        initial_registers=list(initial_registers),
        final_registers=final_registers,
        steps=[],
        halted=halted,
        halt_reason=halt_reason,
        output_register=0,
        output_value=output_value,
        step_count=0,
    )


def build_compiled_minimization_evaluation(
    *,
    spec: FunctionSpec,
    initial_registers: List[int],
    result: ExecutionResult,
    compile_metadata: dict[str, Any],
) -> dict[str, Any]:
    evaluation = {
        "kind": "minimization",
        "mode": "compiled_flat",
        "input_registers": list(initial_registers),
        "inner_function": spec.inner.model_dump() if spec.inner is not None else None,
        "compiled_program": {
            "sections": compile_metadata["sections"],
            "register_layout": compile_metadata["register_layout"],
        },
        "halted": result.halted,
        "halt_reason": result.halt_reason,
        "final_output": result.output_value if result.halted else None,
    }

    if result.halted:
        evaluation["success_candidate"] = result.output_value

    return evaluation


def _read_register_value(registers: List[int], register_index: int) -> int:
    return registers[register_index] if 0 <= register_index < len(registers) else 0


def _minimization_iteration_sections(compile_metadata: dict[str, Any]) -> dict[str, dict[str, int]]:
    sections = compile_metadata["sections"]
    return {
        "iteration_start": sections["loop_prepare_inner_inputs"],
        "inner_result": sections["loop_read_inner_output"],
        "continue_tail": sections["loop_increment_candidate"],
        "stop_tail": sections["finalize"],
    }


def _find_section_start_indexes(
    steps,
    *,
    section: dict[str, int],
) -> List[int]:
    start_indexes: List[int] = []
    cursor = 0

    while True:
        start_index = _find_next_step_in_pc_range(
            steps,
            cursor,
            section["start_instruction"],
            section["end_instruction"],
        )
        if start_index is None:
            break

        start_indexes.append(start_index)
        cursor = _find_contiguous_step_range_end(
            steps,
            start_index,
            section["start_instruction"],
            section["end_instruction"],
        ) + 1

    return start_indexes


def _find_iteration_section_span(
    steps,
    *,
    start_index: int,
    iteration_end_limit: int,
    section: dict[str, int],
) -> tuple[Optional[int], Optional[int]]:
    section_start_index = _find_next_step_in_pc_range(
        steps,
        start_index,
        section["start_instruction"],
        section["end_instruction"],
    )
    if section_start_index is None or section_start_index > iteration_end_limit:
        return None, None

    section_end_index = min(
        _find_contiguous_step_range_end(
            steps,
            section_start_index,
            section["start_instruction"],
            section["end_instruction"],
        ),
        iteration_end_limit,
    )
    return section_start_index, section_end_index


def _section_span_reaches_program_end(
    steps,
    *,
    span_end_index: Optional[int],
    section: dict[str, int],
) -> bool:
    return (
        span_end_index is not None
        and 0 <= span_end_index < len(steps)
        and steps[span_end_index].pc == section["end_instruction"]
    )


def build_compiled_minimization_computation_structure(
    *,
    result: ExecutionResult,
    compile_metadata: dict[str, Any],
) -> MinimizationComputationStructure:
    register_layout = compile_metadata["register_layout"]
    steps = result.steps
    iteration_sections = _minimization_iteration_sections(compile_metadata)
    iteration_start_section = iteration_sections["iteration_start"]
    inner_result_section = iteration_sections["inner_result"]
    continue_tail_section = iteration_sections["continue_tail"]
    stop_tail_section = iteration_sections["stop_tail"]
    candidate_register = register_layout["candidate_register"]
    inner_output_register = register_layout["inner_output_register"]
    iteration_start_indexes = _find_section_start_indexes(
        steps,
        section=iteration_start_section,
    )

    iterations: List[MinimizationIterationBlock] = []

    for iteration_index, start_index in enumerate(iteration_start_indexes):
        next_start_index = (
            iteration_start_indexes[iteration_index + 1]
            if iteration_index + 1 < len(iteration_start_indexes)
            else None
        )
        iteration_end_limit = (next_start_index - 1) if next_start_index is not None else (len(steps) - 1)
        start_step = steps[start_index]
        candidate_value = _read_register_value(start_step.registers_before, candidate_register)

        _, read_output_end_index = _find_iteration_section_span(
            steps,
            start_index=start_index,
            iteration_end_limit=iteration_end_limit,
            section=inner_result_section,
        )

        inner_result_value = None
        if read_output_end_index is not None:
            inner_result_value = _read_register_after_step(result, read_output_end_index, inner_output_register)

        finalize_start_index, finalize_end_index = (None, None)
        increment_start_index, increment_end_index = (None, None)
        if read_output_end_index is not None:
            finalize_start_index, finalize_end_index = _find_iteration_section_span(
                steps,
                start_index=read_output_end_index + 1,
                iteration_end_limit=iteration_end_limit,
                section=stop_tail_section,
            )
            increment_start_index, increment_end_index = _find_iteration_section_span(
                steps,
                start_index=read_output_end_index + 1,
                iteration_end_limit=iteration_end_limit,
                section=continue_tail_section,
            )

        if (
            finalize_start_index is not None
            and finalize_end_index == iteration_end_limit
            and _section_span_reaches_program_end(
                steps,
                span_end_index=finalize_end_index,
                section=stop_tail_section,
            )
            and result.halted
        ):
            decision = "stop"
            stop_reason = "first_zero_found"
            trace_end = finalize_end_index
        elif (
            increment_start_index is not None
            and increment_end_index is not None
            and increment_end_index <= iteration_end_limit
            and _section_span_reaches_program_end(
                steps,
                span_end_index=increment_end_index,
                section=continue_tail_section,
            )
        ):
            decision = "continue"
            stop_reason = None
            trace_end = increment_end_index
        else:
            decision = "incomplete"
            stop_reason = result.halt_reason
            trace_end = iteration_end_limit
            if read_output_end_index is not None and trace_end < read_output_end_index:
                inner_result_value = None

        iterations.append(
            MinimizationIterationBlock(
                index=iteration_index,
                candidate=candidate_value,
                trace_start=start_index + 1,
                trace_end=max(start_index, trace_end) + 1,
                inner_result_value=inner_result_value,
                decision=decision,
                stop_reason=stop_reason,
                label=f"candidate y = {candidate_value}",
            )
        )

    final_candidate = None
    for block in iterations:
        if block.decision == "stop":
            final_candidate = block.candidate
            break

    return MinimizationComputationStructure(
        is_complete=result.halted,
        iteration_count=len(iterations),
        final_candidate=final_candidate,
        termination_reason=None if result.halted else result.halt_reason,
        iterations=iterations,
    )


def build_function_computation_structure(
    *,
    result: ExecutionResult,
    function_spec: FunctionSpec,
    evaluation: Optional[dict[str, Any]],
) -> Optional[MinimizationComputationStructure]:
    if not _is_minimization_function(function_spec):
        return None

    if not isinstance(evaluation, dict):
        return None

    if evaluation.get("kind") != "minimization" or evaluation.get("mode") != "compiled_flat":
        return None

    compiled_program = evaluation.get("compiled_program")
    if not isinstance(compiled_program, dict):
        return None

    sections = compiled_program.get("sections")
    register_layout = compiled_program.get("register_layout")
    if not isinstance(sections, dict) or not isinstance(register_layout, dict):
        return None

    return build_compiled_minimization_computation_structure(
        result=result,
        compile_metadata={
            "sections": sections,
            "register_layout": register_layout,
        },
    )


def execute_primitive_recursive_function(
    spec: FunctionSpec,
    initial_registers: List[int],
    max_steps: Optional[int],
) -> tuple[list[tuple], ExecutionResult, dict[str, Any]]:
    if spec.base is None:
        raise build_bad_request("primrec requires `base`")

    if spec.step is None:
        raise build_bad_request("primrec requires `step`")

    if not initial_registers:
        raise build_bad_request("primrec requires at least one input register")

    recursion_index = _require_primitive_recursion_index(spec, len(initial_registers))
    recursion_value = initial_registers[recursion_index]
    if type(recursion_value) is not int or recursion_value < 0:
        raise build_bad_request("primrec recursion input must be a nonnegative integer")

    try:
        program, metadata = compile_primitive_recursion_program(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    result = execute_program_request(
        program=program,
        initial_registers=initial_registers,
        max_steps=max_steps,
    )
    evaluation = build_primitive_recursion_evaluation(
        spec=spec,
        initial_registers=initial_registers,
        result=result,
        compile_metadata=metadata,
    )
    return program, result, evaluation


def execute_minimization_compiled_function(
    spec: FunctionSpec,
    initial_registers: List[int],
    max_steps: Optional[int],
) -> tuple[list[tuple], ExecutionResult, dict[str, Any]]:
    if spec.inner is None:
        raise build_bad_request("minimization requires `inner`")

    try:
        validate_registers(initial_registers, "initial_registers")
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    try:
        expected_input_count = infer_function_arity(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    if len(initial_registers) != expected_input_count:
        register_label = "register" if expected_input_count == 1 else "registers"
        raise build_bad_request(
            f"minimization expected {expected_input_count} input {register_label}, got {len(initial_registers)}"
        )

    try:
        program, metadata = compile_minimization_program(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    result = execute_program_request(
        program=program,
        initial_registers=initial_registers,
        max_steps=max_steps,
    )
    evaluation = build_compiled_minimization_evaluation(
        spec=spec,
        initial_registers=initial_registers,
        result=result,
        compile_metadata=metadata,
    )
    return program, result, evaluation


def execute_minimization_function(
    spec: FunctionSpec,
    initial_registers: List[int],
    max_steps: Optional[int],
    max_candidates: Optional[int],
) -> tuple[list[tuple], ExecutionResult, dict[str, Any]]:
    if spec.inner is None:
        raise build_bad_request("minimization requires `inner`")

    try:
        validate_registers(initial_registers, "initial_registers")
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    try:
        expected_input_count = infer_function_arity(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    if len(initial_registers) != expected_input_count:
        register_label = "register" if expected_input_count == 1 else "registers"
        raise build_bad_request(
            f"minimization expected {expected_input_count} input {register_label}, got {len(initial_registers)}"
        )

    resolved_max_candidates = _resolve_max_candidates(max_candidates)
    candidate_records: List[dict[str, Any]] = []

    for candidate in range(resolved_max_candidates):
        inner_inputs = [*initial_registers, candidate]
        inner_result, inner_evaluation = execute_function_spec(
            spec=spec.inner,
            initial_registers=inner_inputs,
            max_steps=max_steps,
        )

        candidate_record = {
            "candidate": candidate,
            "input_registers": inner_inputs,
            "output_value": inner_result.output_value if inner_result.halted else None,
            "halted": inner_result.halted,
            "halt_reason": inner_result.halt_reason,
            "step_count": inner_result.step_count,
        }
        if inner_evaluation is not None:
            candidate_record["inner_evaluation"] = inner_evaluation
        candidate_records.append(candidate_record)

        if not inner_result.halted:
            return [], build_minimization_result(
                initial_registers=initial_registers,
                output_value=None,
                halted=False,
                halt_reason="inner_computation_did_not_halt",
            ), build_minimization_evaluation(
                spec=spec,
                initial_registers=initial_registers,
                candidate_records=candidate_records,
                max_candidates=resolved_max_candidates,
                search_status="inner_computation_did_not_halt",
                final_output=None,
            )

        if inner_result.output_value == 0:
            return [], build_minimization_result(
                initial_registers=initial_registers,
                output_value=candidate,
                halted=True,
                halt_reason=None,
            ), build_minimization_evaluation(
                spec=spec,
                initial_registers=initial_registers,
                candidate_records=candidate_records,
                max_candidates=resolved_max_candidates,
                search_status="success",
                final_output=candidate,
                success_candidate=candidate,
            )

    return [], build_minimization_result(
        initial_registers=initial_registers,
        output_value=None,
        halted=False,
        halt_reason="candidate_limit_reached",
    ), build_minimization_evaluation(
        spec=spec,
        initial_registers=initial_registers,
        candidate_records=candidate_records,
        max_candidates=resolved_max_candidates,
        search_status="candidate_limit_reached",
        final_output=None,
    )


def execute_function_spec(
    spec: FunctionSpec,
    initial_registers: List[int],
    max_steps: Optional[int],
    max_candidates: Optional[int] = None,
) -> tuple[ExecutionResult, Optional[dict[str, Any]]]:
    effective_spec = _effective_function_spec(spec)

    if (
        not _is_composed_function(effective_spec)
        and not _is_primitive_recursive_function(effective_spec)
        and not _is_minimization_function(effective_spec)
    ):
        return execute_program_request(
            program=compile_function_spec(effective_spec),
            initial_registers=initial_registers,
            max_steps=max_steps,
        ), None

    if _is_composed_function(effective_spec):
        if effective_spec.outer is None:
            raise build_bad_request("compose requires `outer`")

        if effective_spec.inner is None:
            raise build_bad_request("compose requires `inner`")

        inner_result, inner_evaluation = execute_function_spec(
            spec=effective_spec.inner,
            initial_registers=initial_registers,
            max_steps=max_steps,
            max_candidates=max_candidates,
        )

        outer_input_registers = [inner_result.output_value]
        outer_result, outer_evaluation = execute_function_spec(
            spec=effective_spec.outer,
            initial_registers=outer_input_registers,
            max_steps=max_steps,
            max_candidates=max_candidates,
        )

        return outer_result, {
            "kind": "compose",
            "mode": "sequential",
            "input_registers": list(initial_registers),
            "inner": build_function_evaluation_node(
                function_spec=effective_spec.inner,
                input_registers=initial_registers,
                result=inner_result,
                evaluation=inner_evaluation,
            ),
            "outer": build_function_evaluation_node(
                function_spec=effective_spec.outer,
                input_registers=outer_input_registers,
                result=outer_result,
                evaluation=outer_evaluation,
            ),
            "final_output": outer_result.output_value,
        }

    if _is_minimization_function(effective_spec):
        _, result, evaluation = execute_minimization_function(
            spec=effective_spec,
            initial_registers=initial_registers,
            max_steps=max_steps,
            max_candidates=max_candidates,
        )
        return result, evaluation

    _, result, evaluation = execute_primitive_recursive_function(
        spec=effective_spec,
        initial_registers=initial_registers,
        max_steps=max_steps,
    )
    return result, evaluation


def _build_legacy_trace_row(
    *,
    step: int,
    pc: int,
    instruction: Optional[List[Any]],
    instruction_index: Optional[int],
    instruction_text: str,
    registers: List[int],
    registers_before: List[int],
    changed_registers: List[int],
    jump_taken: bool,
    jump_target: Optional[int],
    halted: bool,
    note: str,
) -> TraceRow:
    return TraceRow(
        step=step,
        pc=pc,
        instruction=instruction,
        instructionIndex=instruction_index,
        instructionText=instruction_text,
        registers=registers,
        registersBefore=registers_before,
        registersAfter=registers,
        changedRegisters=changed_registers,
        jumpTaken=jump_taken,
        jumpTarget=jump_target,
        halted=halted,
        note=note,
    )


def execution_result_to_legacy_trace(result: ExecutionResult) -> List[TraceRow]:
    # Transitional frontend adapter. Remove after the UI reads canonical `steps`.
    initial_registers = list(result.initial_registers)
    adapted = [_build_legacy_trace_row(
        step=0,
        pc=0,
        instruction=None,
        instruction_index=None,
        instruction_text="START",
        registers=initial_registers,
        registers_before=initial_registers,
        changed_registers=[],
        jump_taken=False,
        jump_target=None,
        halted=False,
        note="initial state",
    )]

    for step in result.steps:
        next_pc = step.jump_target if step.jump_taken and step.jump_target is not None else step.pc + 1
        note = f"executed {step.instruction_text}"
        if step.halted:
            note += "; next instruction does not exist, so computation halts"

        adapted.append(_build_legacy_trace_row(
            step=step.step,
            pc=next_pc,
            instruction=list(step.instruction),
            instruction_index=step.pc,
            instruction_text=step.instruction_text,
            registers=list(step.registers_after),
            registers_before=list(step.registers_before),
            changed_registers=list(step.changed_registers),
            jump_taken=step.jump_taken,
            jump_target=step.jump_target,
            halted=step.halted,
            note=note,
        ))

    return adapted


def build_frontend_compatible_run_response(result: ExecutionResult) -> ExecutionResponse:
    # Transitional compatibility wrapper around the canonical execution result.
    legacy_trace = execution_result_to_legacy_trace(result)
    return ExecutionResponse(
        **result.model_dump(),
        trace=legacy_trace,
        adapted_trace=legacy_trace,
        reason=result.halt_reason,
        output=result.output_value,
        status_summary=_build_execution_status_summary(result),
    )


def _build_execution_status_summary(result: ExecutionResult) -> ExecutionStatusSummary:
    if result.halted:
        return ExecutionStatusSummary(
            status="halted",
            capped_for_responsiveness=False,
            output_is_final=True,
            message=f"Execution halted normally after {result.step_count} steps.",
        )

    if result.halt_reason == "step_limit_exceeded":
        return ExecutionStatusSummary(
            status="step_limit_exceeded",
            capped_for_responsiveness=True,
            output_is_final=False,
            message=(
                f"Execution stopped after {result.step_count} steps to keep the interface responsive. "
                "The computation may still continue."
            ),
        )

    return ExecutionStatusSummary(
        status=result.halt_reason or "stopped",
        capped_for_responsiveness=False,
        output_is_final=False,
        message=f"Execution stopped with reason: {result.halt_reason or 'unknown'}.",
    )


def build_frontend_compatible_function_response(
    result: ExecutionResult,
    function_spec: FunctionSpec,
    evaluation: Optional[dict[str, Any]] = None,
) -> FunctionExecutionResponse:
    return FunctionExecutionResponse(
        **build_frontend_compatible_run_response(result).model_dump(),
        function=function_spec.model_dump(),
        evaluation=evaluation,
        computation_structure=build_function_computation_structure(
            result=result,
            function_spec=function_spec,
            evaluation=evaluation,
        ),
    )


def execute_program_request(
    program: ProgramInput,
    initial_registers: List[int],
    max_steps: Optional[int],
) -> ExecutionResult:
    try:
        return execute(
            program=normalize_program_input(program),
            initial_registers=initial_registers,
            max_steps=max_steps,
        )
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc


def execute_run_request(run_req: RunRequest) -> ExecutionResult:
    return execute_program_request(
        program=run_req.program,
        initial_registers=run_req.initial_registers,
        max_steps=run_req.max_steps,
    )


def run_function_request(
    req: RunFunctionRequest,
) -> tuple[list[tuple], ExecutionResult, Optional[dict[str, Any]]]:
    effective_function = _effective_function_spec(req.function)

    if req.execution_mode == "flat":
        program = compile_function_spec(effective_function)
        result = execute_program_request(
            program=program,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
        )
        return program, result, None

    if _is_composed_function(effective_function):
        program: list[tuple] = []
        result, evaluation = execute_function_spec(
            spec=effective_function,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
            max_candidates=req.max_candidates,
        )
        return program, result, evaluation

    if _is_primitive_recursive_function(effective_function):
        return execute_primitive_recursive_function(
            spec=effective_function,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
        )

    if _is_minimization_function(effective_function):
        return execute_minimization_compiled_function(
            spec=effective_function,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
        )

    program = compile_function_spec(effective_function)
    result = execute_program_request(
        program=program,
        initial_registers=req.initial_registers,
        max_steps=req.max_steps,
    )
    return program, result, None


def build_compare_alignment(left_trace: List[TraceRow], right_trace: List[TraceRow]) -> List[CompareAlignmentRow]:
    n = max(len(left_trace), len(right_trace))
    alignment: List[CompareAlignmentRow] = []

    for i in range(n):
        alignment.append(
            CompareAlignmentRow(
                left=i if i < len(left_trace) else None,
                right=i if i < len(right_trace) else None,
            )
        )

    return alignment


def build_frontend_compatible_compare_response(
    left_result: ExecutionResult,
    right_result: ExecutionResult,
) -> CompareResponse:
    left_response = build_frontend_compatible_run_response(left_result)
    right_response = build_frontend_compatible_run_response(right_result)
    alignment = build_compare_alignment(left_response.trace, right_response.trace)
    return CompareResponse(left=left_response, right=right_response, alignment=alignment)


@app.post("/run", response_model=ExecutionResponse)
def run_program(req: RunRequest):
    return build_frontend_compatible_run_response(execute_run_request(req))


@app.post("/compare", response_model=CompareResponse)
def compare_programs(req: CompareRequest):
    return build_frontend_compatible_compare_response(
        left_result=execute_run_request(req.left),
        right_result=execute_run_request(req.right),
    )


@app.post("/encode-instruction", response_model=EncodedInstructionResponse)
def encode_instruction_endpoint(req: EncodeInstructionRequest):
    try:
        details = encode_instruction_with_details(normalize_instruction_input(req.instruction))
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    return EncodedInstructionResponse(
        instruction=details["instruction"],
        tuple=details["tuple"],
        code=_stringify_natural(details["code"]),
        prime_factor_form=details["prime_factor_form"],
    )


@app.post("/encode-program", response_model=EncodedProgramResponse)
def encode_program_endpoint(req: EncodeProgramRequest):
    try:
        program = normalize_program_input(req.program)
        details = encode_program_with_details(program)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    return EncodedProgramResponse(
        program=details["program"],
        instruction_codes=[_stringify_natural(value) for value in details["instruction_codes"]],
        program_tuple=[_stringify_natural(value) for value in details["program_tuple"]],
        program_code=(
            _stringify_natural(details["program_code"])
            if details.get("program_code") is not None
            else None
        ),
        program_code_decimal_digits=details.get("program_code_decimal_digits"),
        program_code_decimal_omitted=bool(details.get("program_code_decimal_omitted")),
        instruction_details=[
            EncodedProgramInstructionDetail(
                instruction=item["instruction"],
                tuple=item["tuple"],
                code=_stringify_natural(item["code"]),
                prime_factor_form=item["prime_factor_form"],
            )
            for item in details["instruction_details"]
        ],
        program_prime_factor_form=details["program_prime_factor_form"],
    )


@app.post("/decode-program", response_model=DecodedProgramResponse)
def decode_program_endpoint(req: DecodeProgramRequest):
    try:
        code = _parse_positive_integer_string(req.code, "code")
        details = decode_program_with_details(code)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc

    return DecodedProgramResponse(
        code=req.code,
        program=details["program"],
        instruction_tuples=details["instruction_tuples"],
        program_tuple=[_stringify_natural(value) for value in details["program_tuple"]],
        instruction_details=[
            DecodedProgramInstructionDetail(
                instruction=item["instruction"],
                tuple=item["tuple"],
                code=_stringify_natural(item["code"]),
                prime_factor_form=item["prime_factor_form"],
            )
            for item in details["instruction_details"]
        ],
        program_prime_factor_form=details["program_prime_factor_form"],
        instruction_count=details["instruction_count"],
        opcode_sequence=details["opcode_sequence"],
        opcode_counts=details["opcode_counts"],
        is_empty_program=details["is_empty_program"],
    )


@app.post("/compile-function")
def compile_function_endpoint(spec: FunctionSpec):
    program = compile_function_spec(spec)

    return {
        "function": spec.model_dump(),
        "program": [list(inst) for inst in program],
    }


@app.post("/run-function", response_model=FunctionExecutionResponse)
def run_function_endpoint(req: RunFunctionRequest):
    _, result, evaluation = run_function_request(req)
    return build_frontend_compatible_function_response(
        result=result,
        function_spec=req.function,
        evaluation=evaluation,
    )
