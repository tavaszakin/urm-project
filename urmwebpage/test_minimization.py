import unittest
from unittest.mock import patch

from fastapi import HTTPException

from compiler import FunctionSpec, compile_function_to_program, compile_minimization_program, infer_function_arity
from execution_models import ExecutionResult
from main import (
    RunFunctionRequest,
    build_frontend_compatible_function_response,
    build_frontend_compatible_run_response,
    execute_minimization_compiled_function,
    execute_minimization_function,
    run_function_request,
)


class MinimizationFunctionTests(unittest.TestCase):
    def test_minimization_finds_least_zero_candidate(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="bounded_sub"),
        )

        program, result, evaluation = execute_minimization_function(
            spec=spec,
            initial_registers=[3],
            max_steps=100_000,
            max_candidates=10,
        )

        self.assertEqual(program, [])
        self.assertTrue(result.halted)
        self.assertIsNone(result.halt_reason)
        self.assertEqual(result.output_value, 3)
        self.assertEqual(result.final_registers[0], 3)
        self.assertEqual(evaluation["kind"], "minimization")
        self.assertEqual(evaluation["search_status"], "success")
        self.assertEqual(evaluation["success_candidate"], 3)
        self.assertEqual(evaluation["final_output"], 3)
        self.assertEqual(len(evaluation["candidates"]), 4)
        self.assertEqual(
            [candidate["output_value"] for candidate in evaluation["candidates"]],
            [3, 2, 1, 0],
        )

    def test_minimization_candidate_limit_reached(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="successor"),
        )

        program, result, evaluation = execute_minimization_function(
            spec=spec,
            initial_registers=[],
            max_steps=100_000,
            max_candidates=4,
        )

        self.assertEqual(program, [])
        self.assertFalse(result.halted)
        self.assertEqual(result.halt_reason, "candidate_limit_reached")
        self.assertIsNone(result.output_value)
        self.assertEqual(evaluation["search_status"], "candidate_limit_reached")
        self.assertEqual(len(evaluation["candidates"]), 4)
        self.assertEqual(
            [candidate["candidate"] for candidate in evaluation["candidates"]],
            [0, 1, 2, 3],
        )
        self.assertEqual(
            [candidate["output_value"] for candidate in evaluation["candidates"]],
            [1, 2, 3, 4],
        )

    def test_minimization_stops_when_inner_exceeds_step_budget(self):
        spec = FunctionSpec(
            kind="mu",
            inner=FunctionSpec(kind="constant", value=1),
        )

        program, result, evaluation = execute_minimization_function(
            spec=spec,
            initial_registers=[],
            max_steps=1,
            max_candidates=5,
        )

        self.assertEqual(program, [])
        self.assertFalse(result.halted)
        self.assertEqual(result.halt_reason, "inner_computation_did_not_halt")
        self.assertIsNone(result.output_value)
        self.assertEqual(evaluation["search_status"], "inner_computation_did_not_halt")
        self.assertEqual(len(evaluation["candidates"]), 1)
        self.assertEqual(evaluation["candidates"][0]["candidate"], 0)
        self.assertFalse(evaluation["candidates"][0]["halted"])
        self.assertEqual(evaluation["candidates"][0]["halt_reason"], "step_limit_exceeded")
        self.assertIsNone(evaluation["candidates"][0]["output_value"])

    def test_outer_candidate_limit_is_not_forwarded_to_inner_evaluation(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="successor"),
        )

        inner_result = ExecutionResult(
            program=[],
            initial_registers=[0],
            final_registers=[0],
            steps=[],
            halted=True,
            halt_reason=None,
            output_register=0,
            output_value=0,
            step_count=0,
        )

        with patch("main.execute_function_spec", return_value=(inner_result, None)) as execute_mock:
            execute_minimization_function(
                spec=spec,
                initial_registers=[],
                max_steps=100_000,
                max_candidates=3,
            )

        self.assertEqual(execute_mock.call_count, 1)
        self.assertEqual(execute_mock.call_args.kwargs["initial_registers"], [0])
        self.assertNotIn("max_candidates", execute_mock.call_args.kwargs)

    def test_minimization_arity_validation(self):
        spec = FunctionSpec(
            kind="min",
            inner=FunctionSpec(kind="bounded_sub"),
        )

        self.assertEqual(infer_function_arity(spec), 1)

        with self.assertRaisesRegex(ValueError, "minimization requires `inner`"):
            infer_function_arity(FunctionSpec(kind="minimization"))

        with self.assertRaises(HTTPException) as exc_info:
            execute_minimization_function(
                spec=spec,
                initial_registers=[3, 4],
                max_steps=100_000,
                max_candidates=5,
            )

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertIn("minimization expected 1 input register, got 2", exc_info.exception.detail)

    def test_compile_minimization_program_requires_inner(self):
        with self.assertRaisesRegex(ValueError, "minimization requires `inner`"):
            compile_minimization_program(FunctionSpec(kind="minimization"))

    def test_compile_minimization_program_smoke(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="bounded_sub"),
        )

        flat_program = compile_function_to_program(spec)
        program, metadata = compile_minimization_program(spec)

        self.assertGreater(len(flat_program), 0)
        self.assertEqual(flat_program, program)
        self.assertEqual(
            set(metadata["sections"].keys()),
            {
                "init_candidate",
                "loop_prepare_inner_inputs",
                "loop_inner_body",
                "loop_read_inner_output",
                "loop_test_zero",
                "loop_increment_candidate",
                "finalize",
            },
        )
        self.assertIn("candidate_register", metadata["register_layout"])
        self.assertIn("inner_output_register", metadata["register_layout"])
        self.assertIn("zero_register", metadata["register_layout"])
        self.assertIn("inner_workspace_start", metadata["register_layout"])
        self.assertIn("inner_workspace_size", metadata["register_layout"])

    def test_compiled_minimization_executes_simple_search(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="bounded_sub"),
        )

        program, result, evaluation = run_function_request(
            RunFunctionRequest(
                function=spec,
                initial_registers=[3],
                max_steps=100_000,
                max_candidates=2,
            )
        )

        self.assertGreater(len(program), 0)
        self.assertTrue(result.halted)
        self.assertEqual(result.output_value, 3)
        self.assertGreater(len(result.steps), 0)
        self.assertEqual(evaluation["kind"], "minimization")
        self.assertEqual(evaluation["mode"], "compiled_flat")
        self.assertEqual(evaluation["success_candidate"], 3)
        self.assertIn("compiled_program", evaluation)
        self.assertIn("sections", evaluation["compiled_program"])
        self.assertIn("register_layout", evaluation["compiled_program"])

    def test_compiled_minimization_nonhalting_smoke(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="successor"),
        )

        program, result, evaluation = execute_minimization_compiled_function(
            spec=spec,
            initial_registers=[],
            max_steps=25,
        )

        self.assertGreater(len(program), 0)
        self.assertFalse(result.halted)
        self.assertEqual(result.halt_reason, "step_limit_exceeded")
        self.assertEqual(evaluation["mode"], "compiled_flat")
        self.assertIsNone(evaluation["final_output"])

    def test_step_limited_compiled_minimization_has_clear_response_summary(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="successor"),
        )

        _, result, evaluation = execute_minimization_compiled_function(
            spec=spec,
            initial_registers=[],
            max_steps=25,
        )
        response = build_frontend_compatible_function_response(
            result=result,
            function_spec=spec,
            evaluation=evaluation,
        )

        self.assertFalse(response.halted)
        self.assertEqual(response.halt_reason, "step_limit_exceeded")
        self.assertIsNotNone(response.status_summary)
        self.assertEqual(response.status_summary.status, "step_limit_exceeded")
        self.assertTrue(response.status_summary.capped_for_responsiveness)
        self.assertFalse(response.status_summary.output_is_final)
        self.assertIn("Execution stopped after 25 steps", response.status_summary.message)
        self.assertIn("keep the interface responsive", response.status_summary.message)
        self.assertIsNotNone(response.computation_structure)
        self.assertEqual(response.computation_structure.kind, "minimization")
        self.assertFalse(response.computation_structure.is_complete)
        self.assertEqual(response.computation_structure.termination_reason, "step_limit_exceeded")
        self.assertGreater(len(response.computation_structure.iterations), 0)
        self.assertEqual(
            response.computation_structure.iteration_count,
            len(response.computation_structure.iterations),
        )
        self.assertIsNone(response.computation_structure.final_candidate)
        self.assertEqual(response.computation_structure.iterations[-1].decision, "incomplete")
        self.assertEqual(
            response.computation_structure.iterations[-1].stop_reason,
            "step_limit_exceeded",
        )

    def test_halted_response_summary_marks_output_as_final(self):
        spec = FunctionSpec(
            kind="minimization",
            inner=FunctionSpec(kind="bounded_sub"),
        )

        _, result, evaluation = execute_minimization_compiled_function(
            spec=spec,
            initial_registers=[3],
            max_steps=100_000,
        )
        response = build_frontend_compatible_function_response(
            result=result,
            function_spec=spec,
            evaluation=evaluation,
        )

        self.assertTrue(response.halted)
        self.assertIsNone(response.halt_reason)
        self.assertIsNotNone(response.status_summary)
        self.assertEqual(response.status_summary.status, "halted")
        self.assertFalse(response.status_summary.capped_for_responsiveness)
        self.assertTrue(response.status_summary.output_is_final)
        self.assertIn("Execution halted normally", response.status_summary.message)
        self.assertIsNotNone(response.computation_structure)
        self.assertEqual(response.computation_structure.kind, "minimization")
        self.assertTrue(response.computation_structure.is_complete)
        self.assertIsNone(response.computation_structure.termination_reason)
        self.assertEqual(
            response.computation_structure.iteration_count,
            len(response.computation_structure.iterations),
        )
        self.assertEqual(response.computation_structure.final_candidate, 3)
        self.assertEqual(
            [block.candidate for block in response.computation_structure.iterations],
            [0, 1, 2, 3],
        )
        self.assertEqual(
            [block.inner_result_value for block in response.computation_structure.iterations],
            [3, 2, 1, 0],
        )
        self.assertEqual(
            [block.decision for block in response.computation_structure.iterations],
            ["continue", "continue", "continue", "stop"],
        )
        self.assertEqual(
            response.computation_structure.iterations[-1].stop_reason,
            "first_zero_found",
        )
        self.assertEqual(
            response.computation_structure.final_candidate,
            response.computation_structure.iterations[-1].candidate,
        )
        self.assertEqual(
            response.computation_structure.iterations[-1].label,
            "candidate y = 3",
        )
        self.assertTrue(
            response.computation_structure.iterations[0].trace_start
            <= response.computation_structure.iterations[0].trace_end
        )

    def test_non_minimization_response_omits_computation_structure(self):
        spec = FunctionSpec(kind="add")

        result = build_frontend_compatible_function_response(
            result=ExecutionResult(
                program=[["S", 0]],
                initial_registers=[1, 2],
                final_registers=[3, 2],
                steps=[],
                halted=True,
                halt_reason=None,
                output_register=0,
                output_value=3,
                step_count=1,
            ),
            function_spec=spec,
            evaluation=None,
        )

        self.assertIsNone(result.computation_structure)

    def test_primitive_recursion_regression(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="constant", value=3),
            step=FunctionSpec(kind="successor"),
        )

        program, result, evaluation = run_function_request(
            RunFunctionRequest(
                function=spec,
                initial_registers=[2],
                max_steps=100_000,
            )
        )

        self.assertGreater(len(program), 0)
        self.assertEqual(result.output_value, 5)
        self.assertEqual(evaluation["kind"], "primrec")


if __name__ == "__main__":
    unittest.main()
