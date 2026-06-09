from compiler import FunctionSpec, compile_minimization_program
from main import RunFunctionRequest, execute_function_spec, run_function_request

MAX_STEPS = 100_000
SAMPLE_INPUTS = [[0], [1], [3], [5]]


def main() -> None:
    spec = FunctionSpec(
        kind="minimization",
        inner=FunctionSpec(kind="bounded_sub"),
    )
    compiled_program, compiled_metadata = compile_minimization_program(spec)

    print("=== CANONICAL MINIMIZATION VALIDATION ===")
    print("Function: f(x) = mu y [ bounded_sub(x, y) = 0 ]")
    print("Sample inputs:", SAMPLE_INPUTS)
    print("Compiled register layout:", compiled_metadata["register_layout"])
    print("Compiled sections:", list(compiled_metadata["sections"].keys()))

    previous_step_count = None

    for input_registers in SAMPLE_INPUTS:
        print(f"\n=== INPUT: {input_registers} ===")

        interpreted_result, interpreted_evaluation = execute_function_spec(
            spec=spec,
            initial_registers=input_registers,
            max_steps=MAX_STEPS,
        )

        program, compiled_result, compiled_evaluation = run_function_request(
            RunFunctionRequest(
                function=spec,
                initial_registers=input_registers,
                max_steps=MAX_STEPS,
            )
        )

        print("Interpreted output:", interpreted_result.output_value)
        print("Compiled output:", compiled_result.output_value)
        print("Program length:", len(program))
        print("Step count:", compiled_result.step_count)
        print("Final registers:", compiled_result.final_registers)
        print("First few instructions:", program[:10])
        print("Interpreted mode:", interpreted_evaluation.get("mode") if interpreted_evaluation else None)
        print("Compiled mode:", compiled_evaluation.get("mode") if compiled_evaluation else None)
        compiled_program_info = compiled_evaluation.get("compiled_program", {}) if compiled_evaluation else {}
        print("Section names:", compiled_program_info.get("sections", {}).keys())
        print("Candidate register:", compiled_program_info.get("register_layout", {}).get("candidate_register"))

        assert interpreted_result.output_value == compiled_result.output_value
        assert len(program) > 0

        if previous_step_count is not None:
            trend = "UP" if compiled_result.step_count > previous_step_count else "SAME/LOWER"
            print("Step count trend vs previous input:", trend)
        else:
            print("Step count trend vs previous input: N/A")

        print("Match: YES")
        previous_step_count = compiled_result.step_count


if __name__ == "__main__":
    main()
