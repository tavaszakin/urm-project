import unittest

from compiler import FunctionSpec, compile_function_to_program, infer_function_arity
from main import RunFunctionRequest, run_function_request


class PredecessorFunctionTests(unittest.TestCase):
    def test_compile_predecessor_program(self):
        program = compile_function_to_program(FunctionSpec(kind="predecessor"))

        self.assertEqual(
            program,
            [
                ("J", 0, 3, 7),
                ("S", 2),
                ("J", 0, 2, 6),
                ("S", 1),
                ("S", 2),
                ("J", 0, 0, 2),
                ("T", 1, 0),
            ],
        )

    def test_predecessor_arity(self):
        self.assertEqual(infer_function_arity(FunctionSpec(kind="predecessor")), 1)

    def test_predecessor_expected_outputs(self):
        for value, expected in [(0, 0), (1, 0), (2, 1), (7, 6)]:
            with self.subTest(value=value):
                _, result, _ = run_function_request(
                    RunFunctionRequest(
                        function=FunctionSpec(kind="predecessor"),
                        initial_registers=[value],
                        max_steps=1_000,
                    )
                )

                self.assertTrue(result.halted)
                self.assertEqual(result.output_value, expected)


if __name__ == "__main__":
    unittest.main()
