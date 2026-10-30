"""Phase 0 Task B/C: static fixture metrics + sample-compute checks.

Verifies that every registered public built-in compiles, that its small
sample-compute checks produce the expected values, and that a handful of
known built-ins still compile to their calibrated instruction/jump counts
(a regression guard). All numbers are measured from the actual generated URM
program, never hardcoded as truth without a compile.
"""

import unittest

from fixture_metrics import build_table, program_metrics

# Calibration constants VERIFIED from the current compiler in this pass.
# (instruction_count, jump_count). Note: characteristic:leq measures 25, not the
# 26 quoted in the roadmap brief -- the harness value is authoritative.
CALIBRATION = {
    "add": (5, 2),
    "bounded_sub": (12, 5),
    "multiplication": (20, 4),
    "exponentiation": (41, 6),
    "divisor_count": (293, 23),
    "characteristic:leq": (25, 6),
    "characteristic:lt": (27, 6),
    "characteristic:eq": (48, 13),
    "characteristic:divides": (58, 19),
}


class FixtureMetricsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.table = build_table()
        cls.by_label = {row["label"]: row for row in cls.table}

    def test_all_fixtures_compile(self):
        for row in self.table:
            with self.subTest(fixture=row["label"]):
                self.assertTrue(
                    row["compile_ok"],
                    msg=f"{row['label']} did not compile: {row.get('notes')}",
                )

    def test_all_sample_checks_pass(self):
        for row in self.table:
            if row.get("sample_compute_ok") is None:
                continue
            with self.subTest(fixture=row["label"]):
                self.assertTrue(
                    row["sample_compute_ok"],
                    msg=f"{row['label']} sample mismatch: {row.get('sample_notes')}",
                )

    def test_calibration_matches_current_compiler(self):
        for label, (instr, jumps) in CALIBRATION.items():
            with self.subTest(fixture=label):
                row = self.by_label[label]
                self.assertEqual(row["instruction_count"], instr)
                self.assertEqual(row["jump_count"], jumps)

    def test_metrics_partition_jumps(self):
        """Sanity: forward+backward and conditional+unconditional both total J."""
        for row in self.table:
            with self.subTest(fixture=row["label"]):
                self.assertEqual(
                    row["forward_jump_count"] + row["backward_jump_count"],
                    row["jump_count"],
                )
                self.assertEqual(
                    row["conditional_jump_count"] + row["unconditional_jump_count"],
                    row["jump_count"],
                )
                self.assertEqual(row["diamond_count"], row["conditional_jump_count"])

    def test_program_metrics_directly(self):
        """program_metrics on a hand-written program produces expected counts."""
        # I0 S(0); I1 J(0,0,0) unconditional backward; I2 J(0,1,5) conditional forward
        program = [("S", 0), ("J", 0, 0, 0), ("J", 0, 1, 5)]
        metrics = program_metrics(program)
        self.assertEqual(metrics["jump_count"], 2)
        self.assertEqual(metrics["unconditional_jump_count"], 1)
        self.assertEqual(metrics["conditional_jump_count"], 1)
        self.assertEqual(metrics["backward_jump_count"], 1)
        self.assertEqual(metrics["forward_jump_count"], 1)
        self.assertEqual(metrics["max_register_index"], 1)


if __name__ == "__main__":
    unittest.main()
