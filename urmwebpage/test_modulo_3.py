"""Execution and public API coverage for the existing Modulo 3 program."""

import unittest

from fastapi.testclient import TestClient

from compiler import FunctionSpec, compile_function_to_program, infer_function_arity
from main import app
from urm import execute, validate_program


class Modulo3Tests(unittest.TestCase):
    def test_remainder_cycles_and_termination(self):
        spec = FunctionSpec(kind="modulo_3")
        program = compile_function_to_program(spec)
        validate_program(program)
        self.assertEqual(infer_function_arity(spec), 1)
        for value in range(31):
            with self.subTest(value=value):
                result = execute(program, [value])
                self.assertTrue(result.halted)
                self.assertEqual(result.output_value, value % 3)
                self.assertTrue(result.steps[-1].halted)

    def test_compile_run_and_trace_api(self):
        with TestClient(app) as client:
            spec = {"kind": "modulo_3"}
            compiled = client.post("/compile-function", json=spec)
            self.assertEqual(compiled.status_code, 200)
            program = compiled.json()["program"]
            for value in (0, 1, 2, 3, 10, 29, 30):
                with self.subTest(value=value):
                    response = client.post("/run-function", json={
                        "function": spec, "initial_registers": [value],
                    })
                    self.assertEqual(response.status_code, 200)
                    result = response.json()
                    self.assertEqual(result["program"], program)
                    self.assertTrue(result["halted"])
                    self.assertEqual(result["output_value"], value % 3)
                    self.assertTrue(result["trace"])
                    self.assertEqual(len(result["steps"]), result["step_count"])


if __name__ == "__main__":
    unittest.main()
