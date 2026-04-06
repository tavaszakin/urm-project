from typing import Any, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from compiler import FunctionSpec, compile_function_to_program, compile_primitive_recursion_program
from execution_models import ExecutionResponse, ExecutionResult, TraceRow
from urm import DEFAULT_MAX_STEPS, execute

MAX_ALLOWED_STEPS = 100_000
ProgramInput = List[List[Any]] | List[tuple]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1", "https://urm-project-neon.vercel.app"
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "URM backend running"}


class RunRequest(BaseModel):
    program: List[List[Any]]
    initial_registers: List[int]
    max_steps: Optional[int] = Field(default=DEFAULT_MAX_STEPS, ge=1, le=MAX_ALLOWED_STEPS)


class CompareRequest(BaseModel):
    left: RunRequest
    right: RunRequest


class RunFunctionRequest(BaseModel):
    function: FunctionSpec
    initial_registers: List[int]
    max_steps: Optional[int] = Field(default=DEFAULT_MAX_STEPS, ge=1, le=MAX_ALLOWED_STEPS)


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


def compile_function_spec(spec: FunctionSpec) -> list[tuple]:
    try:
        return compile_function_to_program(spec)
    except ValueError as exc:
        raise build_bad_request(str(exc)) from exc


def _normalized_function_kind(spec: FunctionSpec) -> str:
    return spec.kind.strip().lower().replace("-", "_")


def _is_composed_function(spec: FunctionSpec) -> bool:
    return _normalized_function_kind(spec) == "compose"


def _is_primitive_recursive_function(spec: FunctionSpec) -> bool:
    return _normalized_function_kind(spec) in {"primrec", "primitive_recursion", "primitive_rec"}


def _require_primitive_recursion_index(spec: FunctionSpec, input_count: int) -> int:
    recursion_index = 0 if spec.recursion_index is None else spec.recursion_index

    if type(recursion_index) is not int or recursion_index < 0:
        raise build_bad_request("primrec requires `recursion_index` to be a nonnegative integer")

    if recursion_index >= input_count:
        raise build_bad_request("primrec recursion_index is out of range for initial_registers")

    return recursion_index


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
        iterations.append({
            "iteration": iteration,
            "function": spec.step.model_dump() if spec.step is not None else None,
            "input_registers": [previous_value, iteration, *remaining_inputs],
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


def execute_function_spec(
    spec: FunctionSpec,
    initial_registers: List[int],
    max_steps: Optional[int],
) -> tuple[ExecutionResult, Optional[dict[str, Any]]]:
    if not _is_composed_function(spec) and not _is_primitive_recursive_function(spec):
        return execute_program_request(
            program=compile_function_spec(spec),
            initial_registers=initial_registers,
            max_steps=max_steps,
        ), None

    if _is_composed_function(spec):
        if spec.outer is None:
            raise build_bad_request("compose requires `outer`")

        if spec.inner is None:
            raise build_bad_request("compose requires `inner`")

        inner_result, inner_evaluation = execute_function_spec(
            spec=spec.inner,
            initial_registers=initial_registers,
            max_steps=max_steps,
        )

        outer_input_registers = [inner_result.output_value]
        outer_result, outer_evaluation = execute_function_spec(
            spec=spec.outer,
            initial_registers=outer_input_registers,
            max_steps=max_steps,
        )

        return outer_result, {
            "kind": "compose",
            "mode": "sequential",
            "input_registers": list(initial_registers),
            "inner": build_function_evaluation_node(
                function_spec=spec.inner,
                input_registers=initial_registers,
                result=inner_result,
                evaluation=inner_evaluation,
            ),
            "outer": build_function_evaluation_node(
                function_spec=spec.outer,
                input_registers=outer_input_registers,
                result=outer_result,
                evaluation=outer_evaluation,
            ),
            "final_output": outer_result.output_value,
        }

    _, result, evaluation = execute_primitive_recursive_function(
        spec=spec,
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
    if _is_composed_function(req.function):
        program: list[tuple] = []
        result, evaluation = execute_function_spec(
            spec=req.function,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
        )
        return program, result, evaluation

    if _is_primitive_recursive_function(req.function):
        return execute_primitive_recursive_function(
            spec=req.function,
            initial_registers=req.initial_registers,
            max_steps=req.max_steps,
        )

    program = compile_function_spec(req.function)
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
