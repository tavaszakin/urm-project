"""Exercise the shared order-statistic generator through the production executor/API."""

import itertools
import random
import unittest

from fastapi.testclient import TestClient

from compiler import FunctionSpec, compile_function_to_program, infer_function_arity
from main import app
from urm import execute, validate_program
from urm_macros import second_smallest


class SecondSmallestTests(unittest.TestCase):
    def assert_output(self, program, inputs):
        result = execute(program, inputs, max_steps=10_000)
        self.assertTrue(result.halted, msg=str(inputs))
        self.assertEqual(result.output_value, sorted(inputs)[1], msg=str(inputs))
        self.assertEqual(result.final_registers[1:len(inputs)], inputs[1:])

    def test_counts_arity_registers_and_targets(self):
        for k, count in [(3, 19), (4, 28), (5, 39), (6, 52)]:
            with self.subTest(k=k):
                spec = FunctionSpec(kind=f"second_smallest_{k}")
                program = compile_function_to_program(spec)
                validate_program(program)
                self.assertEqual(program, second_smallest(k))
                self.assertEqual(infer_function_arity(spec), k)
                self.assertEqual(len(program), count)
                self.assertEqual(len(program), k * k + 2 * k + 4)
                self.assertEqual(program[0], ("Z", k))
                self.assertEqual(program[-1], ("T", k, 0))
                for instruction in program:
                    registers = instruction[1:3] if instruction[0] in {"J", "T"} else instruction[1:]
                    self.assertTrue(all(0 <= register <= k for register in registers))
                    if instruction[0] == "J":
                        self.assertIs(type(instruction[3]), int)
                        self.assertTrue(0 <= instruction[3] < len(program))
                conditional = [inst for inst in program if inst[0] == "J" and inst[1] != inst[2]]
                self.assertEqual(len(conditional), k * k)

    def test_all_distinct_input_orders(self):
        for k in range(3, 7):
            program = second_smallest(k)
            for inputs in itertools.permutations(range(k)):
                self.assert_output(program, list(inputs))

    def test_repeats_equal_values_and_zero(self):
        for k in range(3, 7):
            program = second_smallest(k)
            for repeated in ([0, 0], [1, 1], [4, 4]):
                inputs = [*repeated, *range(2, k)]
                for rotation in range(k):
                    self.assert_output(program, inputs[rotation:] + inputs[:rotation])
            for value in (0, 1, 5):
                self.assert_output(program, [value] * k)
            self.assert_output(program, [0, *([3] * (k - 1))])
            self.assert_output(program, [3, *([0] * (k - 1))])

    def test_exhaustive_small_inputs(self):
        for k in range(3, 7):
            program = second_smallest(k)
            for inputs in itertools.product(range(3), repeat=k):
                self.assert_output(program, list(inputs))

    def test_seeded_random_inputs(self):
        rng = random.Random(20261029)
        for k in range(3, 7):
            program = second_smallest(k)
            for _ in range(250):
                self.assert_output(program, [rng.randrange(12) for _ in range(k)])

    def test_counter_initialization(self):
        for k in range(3, 7):
            inputs = list(reversed(range(k)))
            result = execute(second_smallest(k), [*inputs, 99])
            self.assertTrue(result.halted)
            self.assertEqual(result.output_value, sorted(inputs)[1])
            self.assertEqual(result.steps[0].registers_after[k], 0)

    def test_compile_run_and_step_limit_api(self):
        with TestClient(app) as client:
            for k in range(3, 7):
                with self.subTest(k=k):
                    spec = {"kind": f"second_smallest_{k}"}
                    inputs = list(reversed(range(k)))
                    compiled = client.post("/compile-function", json=spec)
                    run = client.post("/run-function", json={
                        "function": spec, "initial_registers": inputs,
                    })
                    self.assertEqual(compiled.status_code, 200)
                    self.assertEqual(run.status_code, 200)
                    payload = run.json()
                    self.assertEqual(payload["program"], compiled.json()["program"])
                    self.assertEqual(payload["output_value"], sorted(inputs)[1])
                    self.assertTrue(payload["halted"])
                    self.assertGreater(len(payload["trace"]), 0)
                    limited = client.post("/run-function", json={
                        "function": spec, "initial_registers": inputs, "max_steps": 1,
                    })
                    self.assertEqual(limited.status_code, 200)
                    self.assertFalse(limited.json()["halted"])
                    self.assertEqual(limited.json()["step_count"], 1)

    def test_invalid_generator_arities(self):
        for value in (None, True, 0, 1, -3, 3.0, "3"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                second_smallest(value)


if __name__ == "__main__":
    unittest.main()
