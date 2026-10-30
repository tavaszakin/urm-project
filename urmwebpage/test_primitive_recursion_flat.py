import unittest

from compiler import (
    FunctionSpec,
    build_divisor_count_function_spec,
    build_exponentiation_primitive_recursion_spec,
    build_multiplication_primitive_recursion_spec,
    compile_function_to_program,
    infer_function_arity,
)
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

    def test_multiplication_builtin_compiles_via_primitive_recursion_spec(self):
        spec = FunctionSpec(kind="multiplication")
        expanded_spec = build_multiplication_primitive_recursion_spec()

        self.assertEqual(infer_function_arity(spec), 2)
        self.assertEqual(
            compile_function_to_program(spec),
            compile_function_to_program(expanded_spec),
        )

    def test_multiplication_builtin_computes_small_inputs(self):
        cases = [
            ([0, 0], 0),
            ([0, 5], 0),
            ([3, 0], 0),
            ([2, 4], 8),
            ([3, 3], 9),
        ]

        for initial_registers, expected in cases:
            with self.subTest(initial_registers=initial_registers):
                program, result, evaluation = run_function_request(
                    RunFunctionRequest(
                        function=FunctionSpec(kind="multiplication"),
                        initial_registers=initial_registers,
                        max_steps=100_000,
                    )
                )

                self.assertGreater(len(program), 0)
                self.assertEqual(result.output_value, expected)
                self.assertEqual(evaluation["kind"], "primrec")
                self.assertEqual(evaluation["mode"], "compiled_flat")

    def test_multiplication_step_uses_previous_value_and_carried_input(self):
        _, result, evaluation = run_function_request(
            RunFunctionRequest(
                function=FunctionSpec(kind="multiplication"),
                initial_registers=[3, 2],
                max_steps=100_000,
            )
        )

        self.assertEqual(result.output_value, 6)
        self.assertEqual(
            [iteration["input_registers"] for iteration in evaluation["iterations"]],
            [[0, 3], [3, 3]],
        )
        self.assertEqual(evaluation["compiled_program"]["register_layout"]["step_argument_indices"], [0, 2])

    def test_exponentiation_builtin_compiles_via_primitive_recursion_spec(self):
        spec = FunctionSpec(kind="exponentiation")
        expanded_spec = build_exponentiation_primitive_recursion_spec()

        self.assertEqual(infer_function_arity(spec), 2)
        self.assertEqual(
            compile_function_to_program(spec),
            compile_function_to_program(expanded_spec),
        )

    def test_exponentiation_builtin_computes_small_inputs(self):
        cases = [
            ([0, 0], 1),
            ([0, 3], 0),
            ([1, 5], 1),
            ([2, 0], 1),
            ([2, 3], 8),
            ([3, 2], 9),
        ]

        for initial_registers, expected in cases:
            with self.subTest(initial_registers=initial_registers):
                program, result, evaluation = run_function_request(
                    RunFunctionRequest(
                        function=FunctionSpec(kind="exponentiation"),
                        initial_registers=initial_registers,
                        max_steps=100_000,
                    )
                )

                self.assertGreater(len(program), 0)
                self.assertEqual(result.output_value, expected)
                self.assertEqual(evaluation["kind"], "primrec")
                self.assertEqual(evaluation["mode"], "compiled_flat")

    def test_exponentiation_aliases_compile_to_same_program(self):
        canonical_program = compile_function_to_program(FunctionSpec(kind="exponentiation"))

        self.assertEqual(
            compile_function_to_program(FunctionSpec(kind="power")),
            canonical_program,
        )
        self.assertEqual(
            compile_function_to_program(FunctionSpec(kind="pow")),
            canonical_program,
        )

    def test_exponentiation_step_uses_previous_value_and_carried_input(self):
        _, result, evaluation = run_function_request(
            RunFunctionRequest(
                function=FunctionSpec(kind="exponentiation"),
                initial_registers=[3, 2],
                max_steps=100_000,
            )
        )

        self.assertEqual(result.output_value, 9)
        self.assertEqual(
            [iteration["input_registers"] for iteration in evaluation["iterations"]],
            [[1, 3], [3, 3]],
        )
        self.assertEqual(evaluation["compiled_program"]["register_layout"]["step_argument_indices"], [0, 2])

    def test_divisor_count_builtin_compiles_via_substitution_spec(self):
        spec = FunctionSpec(kind="divisor_count")
        expanded_spec = build_divisor_count_function_spec()

        self.assertEqual(infer_function_arity(spec), 1)
        self.assertEqual(
            compile_function_to_program(spec),
            compile_function_to_program(expanded_spec),
        )

    def test_divisor_count_builtin_computes_small_inputs(self):
        cases = [
            ([0], 0),
            ([1], 1),
            ([2], 2),
            ([3], 2),
            ([4], 3),
            ([5], 2),
            ([6], 4),
        ]

        for initial_registers, expected in cases:
            with self.subTest(initial_registers=initial_registers):
                program, result, evaluation = run_function_request(
                    RunFunctionRequest(
                        function=FunctionSpec(kind="divisor_count"),
                        initial_registers=initial_registers,
                        max_steps=100_000,
                    )
                )

                self.assertGreater(len(program), 0)
                self.assertEqual(result.output_value, expected)
                self.assertIsNone(evaluation)

    def test_divisor_count_alias_compiles_to_same_program(self):
        canonical_program = compile_function_to_program(FunctionSpec(kind="divisor_count"))

        self.assertEqual(
            compile_function_to_program(FunctionSpec(kind="num_divisors")),
            canonical_program,
        )

    def test_projection_uses_one_based_indexing(self):
        spec = FunctionSpec(kind="projection", index=2, arity=3)
        result = execute(compile_function_to_program(spec), [7, 11, 13], max_steps=100_000)
        self.assertEqual(result.output_value, 11)


if __name__ == "__main__":
    unittest.main()
