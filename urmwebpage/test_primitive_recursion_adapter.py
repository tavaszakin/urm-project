"""Semantic regressions for primitive-recursion step argument selection."""

import unittest

from compiler import (
    FunctionSpec,
    compile_function_to_program,
    compile_minimization_program,
    compile_primitive_recursion_program,
)
from urm import execute


IDENTITY = {"kind": "projection", "index": 1, "arity": 1}
PREDECESSOR = {"kind": "predecessor"}
TWO = {"kind": "constant", "value": 2}


def recursion(base, step, **options):
    return {"kind": "primrec", "recursion_index": 0, "base": base, "step": step, **options}


class PrimitiveRecursionAdapterTests(unittest.TestCase):
    def assert_outputs(self, spec, examples):
        program = compile_function_to_program(FunctionSpec(**spec))
        for inputs, expected in examples:
            with self.subTest(inputs=inputs):
                result = execute(program, inputs, max_steps=500, record_trace=False)
                self.assertTrue(result.halted)
                self.assertEqual(result.output_value, expected)

    def test_repeated_predecessor(self):
        # The original (1,1) enters predecessor at (1,0,1,0). Its scan starts
        # at 2 and grows past the fixed target 1 forever. See C01/C02 in
        # urm-project/experiments/urm-semantic-contracts-2026-11-21/REPORT.md.
        examples = [([n, x], max(x - n, 0)) for n in range(4) for x in range(4)]
        self.assert_outputs(recursion(IDENTITY, PREDECESSOR), examples)

    def test_constant_base_predecessor(self):
        # Both faulty computations halted with the wrong value.
        self.assert_outputs(recursion(TWO, PREDECESSOR), [([1, 1], 1), ([2, 0], 0)])

    def test_minimization_of_constant_base_predecessor(self):
        inner = recursion(TWO, PREDECESSOR)
        search = {"kind": "minimization", "inner": inner}
        self.assert_outputs(search, [([2], 0)])
        # At n=1 every candidate y gives pred(2)=1, so no witness exists.
        # Check that the search actually finishes successive candidate calls.
        program, metadata = compile_minimization_program(FunctionSpec(**search))
        result = execute(program, [1], max_steps=300)
        layout = metadata["register_layout"]
        test_pc = metadata["sections"]["loop_test_zero"]["start_instruction"]
        decisions = [
            (row.registers_before[layout["candidate_register"]],
             row.registers_before[layout["inner_output_register"]])
            for row in result.steps if row.pc == test_pc
        ]
        self.assertEqual(decisions[:3], [(0, 1), (1, 1), (2, 1)])
        self.assertFalse(result.halted)

    def test_nested_short_step(self):
        # The inner function is truncated subtraction with its recursor first.
        # Starting at zero, the three steps take max(i - previous, 0).
        self.assert_outputs(recursion(IDENTITY, recursion(IDENTITY, PREDECESSOR)),
                            [([3, 0], 1)])

    def test_explicit_unary_selections(self):
        # At n=2, successor uses either the prior result, counter, or fixed x.
        for index, expected in [(0, 7), (1, 2), (2, 6)]:
            with self.subTest(index=index):
                spec = recursion(IDENTITY, {"kind": "successor"}, step_argument_indices=[index])
                self.assert_outputs(spec, [([2, 5], expected)])
        self.assert_outputs(recursion(IDENTITY, PREDECESSOR, step_argument_indices=[0]),
                            [([1, 1], 0)])

    def test_default_exact_and_nullary_steps(self):
        for step, indices, expected in [
            ({"kind": "projection", "index": 2, "arity": 3}, [0, 1, 2], 1),
            ({"kind": "minimization", "inner": {"kind": "zero"}}, [], 0),
        ]:
            with self.subTest(step=step):
                spec = recursion(IDENTITY, step)
                _, metadata = compile_primitive_recursion_program(FunctionSpec(**spec))
                self.assertEqual(metadata["register_layout"]["step_argument_indices"], indices)
                self.assert_outputs(spec, [([2, 5], expected)])

    def test_invalid_selections_and_oversized_step(self):
        for indices, message in [([], "exactly 1"), ([0, 1], "exactly 1"),
                                 ([-1], "within 0..2"), ([3], "within 0..2")]:
            with self.subTest(indices=indices), self.assertRaisesRegex(ValueError, message):
                spec = recursion(IDENTITY, PREDECESSOR, step_argument_indices=indices)
                compile_function_to_program(FunctionSpec(**spec))
        with self.assertRaisesRegex(ValueError, "step arity 4 exceeds"):
            spec = recursion(IDENTITY, {"kind": "projection", "arity": 4, "index": 1})
            compile_function_to_program(FunctionSpec(**spec))


if __name__ == "__main__":
    unittest.main()
