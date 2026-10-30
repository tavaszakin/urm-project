"""Backend tests for the internal `substitution` FunctionSpec kind.

substitution(outer, inners)(x) = outer(inner_0(x), ..., inner_{k-1}(x)).

This is a compiler-only kind: it is intentionally NOT exposed in the public
menu / function-kinds contract. These tests cover compile + execute correctness,
input preservation (the urm_macros.compose clobber bug), high-register inner
isolation (the hardcoded storage-base bug), clear failure modes, and that the
existing `compose` kind is unchanged.
"""

import unittest

from compiler import FunctionSpec, compile_function_to_program, infer_function_arity
from urm import execute


def proj(index, arity):
    return {"kind": "projection", "index": index, "arity": arity}


def _compile(spec_dict):
    return compile_function_to_program(FunctionSpec(**spec_dict))


def _run(spec_dict, inputs):
    program = _compile(spec_dict)
    result = execute(program, list(inputs), max_steps=3_000_000, record_trace=False)
    return result


class SubstitutionCorrectnessTests(unittest.TestCase):
    def test_double(self):
        spec = {"kind": "substitution", "outer": {"kind": "add"},
                "inners": [proj(1, 1), proj(1, 1)]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 1)
        self.assertEqual(_run(spec, [5]).output_value, 10)

    def test_square(self):
        spec = {"kind": "substitution", "outer": {"kind": "multiplication"},
                "inners": [proj(1, 1), proj(1, 1)]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 1)
        self.assertEqual(_run(spec, [5]).output_value, 25)

    def test_add_successor_to_first_argument(self):
        # add_succ(x, y) = add(successor(x), y)
        spec = {"kind": "substitution", "outer": {"kind": "add"},
                "inners": [
                    {"kind": "substitution", "outer": {"kind": "successor"},
                     "inners": [proj(1, 2)]},
                    proj(2, 2),
                ]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 2)
        self.assertEqual(_run(spec, [3, 4]).output_value, 8)

    def test_successor_of_addition(self):
        # succ_add(x, y) = successor(add(x, y)); unary outer over a binary inner.
        spec = {"kind": "substitution", "outer": {"kind": "successor"},
                "inners": [{"kind": "add"}]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 2)
        self.assertEqual(_run(spec, [3, 4]).output_value, 8)

    def test_add_constant(self):
        # add_const(x) = x + 5
        spec = {"kind": "substitution", "outer": {"kind": "add"},
                "inners": [proj(1, 1), {"kind": "constant", "value": 5}]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 1)
        self.assertEqual(_run(spec, [7]).output_value, 12)

    def test_diagonal_divides(self):
        # diagonal_divides(n) = characteristic:divides(n, n).
        # divides(x, y) means "x divides y"; n divides n is true for all n (and
        # divides(0, 0) = 1 by the existing convention).
        spec = {"kind": "substitution",
                "outer": {"kind": "characteristic", "relation": "divides"},
                "inners": [proj(1, 1), proj(1, 1)]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 1)
        for n, expected in [(0, 1), (1, 1), (5, 1)]:
            with self.subTest(n=n):
                self.assertEqual(_run(spec, [n]).output_value, expected)

    def test_input_preservation_anti_clobber(self):
        # substitution(add, [add, add]) = (x + y) + (x + y) = 2(x + y).
        # add() clobbers R0 and R2, so this fails if inputs are not preserved
        # across inner evaluations (the old urm_macros.compose bug).
        spec = {"kind": "substitution", "outer": {"kind": "add"},
                "inners": [{"kind": "add"}, {"kind": "add"}]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 2)
        self.assertEqual(_run(spec, [3, 4]).output_value, 14)

    def test_high_register_inner_no_collision(self):
        # characteristic:divides uses up to R16; embedding it as an inner must
        # not collide with the result/workspace registers (the hardcoded
        # storage-base bug). divides(2,4)=1 -> successor -> 2; divides(3,4)=0 -> 1.
        spec = {"kind": "substitution", "outer": {"kind": "successor"},
                "inners": [{"kind": "characteristic", "relation": "divides"}]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 2)
        self.assertEqual(_run(spec, [2, 4]).output_value, 2)
        self.assertEqual(_run(spec, [3, 4]).output_value, 1)

    def test_nested_substitution_three_levels(self):
        # square(succ(x)) = (x+1)^2 via nested substitution.
        succ_x = {"kind": "substitution", "outer": {"kind": "successor"},
                  "inners": [proj(1, 1)]}
        spec = {"kind": "substitution", "outer": {"kind": "multiplication"},
                "inners": [succ_x, succ_x]}
        self.assertEqual(infer_function_arity(FunctionSpec(**spec)), 1)
        self.assertEqual(_run(spec, [4]).output_value, 25)  # (4+1)^2


class SubstitutionFailureTests(unittest.TestCase):
    def _expect_value_error(self, spec_dict):
        with self.assertRaises(ValueError):
            _compile(spec_dict)

    def test_wrong_number_of_inners(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"},
                                  "inners": [proj(1, 1)]})

    def test_inner_arity_mismatch(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"},
                                  "inners": [proj(1, 1), proj(1, 2)]})

    def test_missing_inners(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"}})

    def test_empty_inners(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"},
                                  "inners": []})

    def test_missing_outer(self):
        self._expect_value_error({"kind": "substitution", "inners": [proj(1, 1)]})

    def test_unsupported_nested_kind(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"},
                                  "inners": [{"kind": "bogus"}, proj(1, 1)]})

    def test_bad_projection_index(self):
        self._expect_value_error({"kind": "substitution", "outer": {"kind": "add"},
                                  "inners": [proj(0, 1), proj(1, 1)]})


class ComposeRegressionTests(unittest.TestCase):
    def test_existing_compose_unchanged(self):
        # compose(successor, successor) = x + 2 must still compile and compute.
        spec = FunctionSpec(kind="compose",
                            inner={"kind": "successor"},
                            outer={"kind": "successor"})
        program = compile_function_to_program(spec)
        result = execute(program, [5], max_steps=100_000, record_trace=False)
        self.assertEqual(result.output_value, 7)

    def test_compose_program_is_byte_identical(self):
        # Pin the existing compose lowering so adding substitution can't perturb it.
        spec = FunctionSpec(kind="compose",
                            inner={"kind": "successor"},
                            outer={"kind": "successor"})
        program = compile_function_to_program(spec)
        self.assertEqual(
            program,
            [("Z", 1), ("T", 0, 1), ("S", 1), ("Z", 2), ("T", 1, 2), ("S", 2), ("T", 2, 0)],
        )


if __name__ == "__main__":
    unittest.main()
