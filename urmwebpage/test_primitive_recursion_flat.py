import unittest

from compiler import FunctionSpec, compile_function_to_program
from main import RunFunctionRequest, run_function_request
from urm import execute


class PrimitiveRecursionFlatCompilationTests(unittest.TestCase):
    def test_base_case_runs_as_single_flat_program(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="constant", value=3),
            step=FunctionSpec(kind="successor"),
        )

        program = compile_function_to_program(spec)
        result = execute(program, [0], max_steps=100_000)

        self.assertGreater(len(program), 0)
        self.assertEqual(result.output_value, 3)
        self.assertEqual(result.final_registers[0], 3)

    def test_one_iteration_uses_step_once(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="constant", value=3),
            step=FunctionSpec(kind="successor"),
        )

        result = execute(compile_function_to_program(spec), [1], max_steps=100_000)
        self.assertEqual(result.output_value, 4)

    def test_multiple_iterations_preserve_order(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="constant", value=3),
            step=FunctionSpec(kind="successor"),
        )

        result = execute(compile_function_to_program(spec), [3], max_steps=100_000)
        self.assertEqual(result.output_value, 6)

    def test_addition_via_primitive_recursion_with_nonzero_recursion_index(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="projection", index=1, arity=1),
            step=FunctionSpec(kind="successor"),
            recursion_index=1,
        )

        result = execute(compile_function_to_program(spec), [3, 2], max_steps=100_000)
        self.assertEqual(result.output_value, 5)

    def test_run_function_returns_single_program_and_trace_metadata(self):
        spec = FunctionSpec(
            kind="primrec",
            base=FunctionSpec(kind="projection", index=1, arity=1),
            step=FunctionSpec(kind="successor"),
            recursion_index=1,
        )

        program, result, evaluation = run_function_request(
            RunFunctionRequest(
                function=spec,
                initial_registers=[3, 2],
                max_steps=100_000,
            )
        )

        self.assertGreater(len(program), 0)
        self.assertEqual(result.output_value, 5)
        self.assertEqual(evaluation["mode"], "compiled_flat")
        self.assertEqual(len(evaluation["iterations"]), 2)
        self.assertIn("compiled_program", evaluation)
        self.assertIn("sections", evaluation["compiled_program"])

        trace_ranges = [evaluation["base"]["trace_range"], *[it["trace_range"] for it in evaluation["iterations"]]]
        previous_end = 0
        for trace_range in trace_ranges:
            self.assertIsNotNone(trace_range)
            self.assertGreaterEqual(trace_range["start_row_index"], previous_end + 1)
            self.assertGreaterEqual(trace_range["end_row_index"], trace_range["start_row_index"])
            previous_end = trace_range["end_row_index"]

    def test_non_primitive_addition_is_unchanged(self):
        spec = FunctionSpec(kind="add")
        result = execute(compile_function_to_program(spec), [2, 3], max_steps=100_000)
        self.assertEqual(result.output_value, 5)

    def test_projection_uses_one_based_indexing(self):
        spec = FunctionSpec(kind="projection", index=2, arity=3)
        result = execute(compile_function_to_program(spec), [7, 11, 13], max_steps=100_000)
        self.assertEqual(result.output_value, 11)


if __name__ == "__main__":
    unittest.main()
