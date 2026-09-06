"""Static metrics harness for generated/built-in URM fixtures (Phase 0).

Compiles each registered public built-in to its actual URM program and records
instruction-level structural metrics, plus optional small sample-compute checks.
This is the measured baseline that future fixture decisions are made against.

Scope is deliberately narrow: it measures *static URM program structure* and
basic compute correctness only. It does NOT measure layout/route/crossing
metrics; those belong to a later frontend/Playwright visual probe.

Run directly to print a table and write a (gitignored) JSON artifact::

    python3 fixture_metrics.py
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from compiler import FunctionSpec, compile_function_to_program, infer_function_arity
from fixture_kinds import METRIC_FIXTURES
from urm import execute

ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fixture-metrics")
ARTIFACT_PATH = os.path.join(ARTIFACT_DIR, "fixtures_metrics.json")

# Safety cap for sample-compute checks. Inputs in METRIC_FIXTURES are tiny, so a
# halting program finishes well under this; a non-halting spec is reported as a
# sample failure rather than hanging the harness.
SAMPLE_MAX_STEPS = 100_000


def _max_register_index(program: List[tuple]) -> int:
    max_index = -1
    for instr in program:
        op = instr[0]
        if op in ("Z", "S"):
            max_index = max(max_index, instr[1])
        elif op == "T":
            max_index = max(max_index, instr[1], instr[2])
        elif op == "J":
            max_index = max(max_index, instr[1], instr[2])
    return max_index


def program_metrics(program: List[tuple]) -> Dict[str, int]:
    """Structural metrics derived from a compiled URM program.

    - jump_count: number of ``J(m, n, q)`` instructions.
    - conditional_jump_count / diamond_count: ``J`` with distinct compared
      registers (``m != n``) -- a real branch decision (flow-diagram diamond).
    - unconditional_jump_count: ``J(r, r, q)`` (always taken; a goto/loop return).
    - backward_jump_count: target ``q <= index`` (loop returns / back-edges).
    - forward_jump_count: target ``q > index``.
    """

    jump_count = 0
    conditional = 0
    unconditional = 0
    backward = 0
    forward = 0
    for index, instr in enumerate(program):
        if instr[0] != "J":
            continue
        jump_count += 1
        _, m, n, q = instr
        if m == n:
            unconditional += 1
        else:
            conditional += 1
        if q <= index:
            backward += 1
        else:
            forward += 1

    return {
        "instruction_count": len(program),
        "jump_count": jump_count,
        "conditional_jump_count": conditional,
        "unconditional_jump_count": unconditional,
        "backward_jump_count": backward,
        "forward_jump_count": forward,
        "diamond_count": conditional,
        "max_register_index": _max_register_index(program),
    }


def _run_samples(program: List[tuple], samples: List) -> Dict[str, Any]:
    inputs: List[List[int]] = []
    expected: List[int] = []
    actual: List[Optional[int]] = []
    ok = True
    notes: List[str] = []

    for args, want in samples:
        inputs.append(list(args))
        expected.append(want)
        try:
            result = execute(
                program, list(args), max_steps=SAMPLE_MAX_STEPS, record_trace=False
            )
        except Exception as exc:  # pragma: no cover - defensive
            actual.append(None)
            ok = False
            notes.append(f"{args}: execution error {exc!r}")
            continue
        if not result.halted:
            actual.append(None)
            ok = False
            notes.append(f"{args}: did not halt within {SAMPLE_MAX_STEPS} steps")
            continue
        actual.append(result.output_value)
        if result.output_value != want:
            ok = False
            notes.append(f"{args}: expected {want}, got {result.output_value}")

    return {
        "sample_inputs": inputs,
        "sample_expected": expected,
        "sample_actual": actual,
        "sample_compute_ok": ok if samples else None,
        "sample_notes": notes,
    }


def evaluate_fixture(fixture: Dict[str, Any]) -> Dict[str, Any]:
    label = fixture["label"]
    raw_spec = fixture["spec"]
    canonical = str(raw_spec.get("kind", "")).strip().lower().replace("-", "_")

    record: Dict[str, Any] = {
        "label": label,
        "function_kind": raw_spec.get("kind"),
        "canonical_kind": canonical,
        "spec": raw_spec,
        "compile_ok": False,
        "arity": None,
        "notes": [],
    }

    try:
        spec = FunctionSpec(**raw_spec)
        program = compile_function_to_program(spec)
        record["compile_ok"] = True
        record["arity"] = infer_function_arity(spec)
        record.update(program_metrics(program))
        record.update(_run_samples(program, fixture.get("samples", [])))
    except Exception as exc:
        record["notes"].append(f"compile error: {exc!r}")
        record["sample_compute_ok"] = None

    return record


def build_table() -> List[Dict[str, Any]]:
    return [evaluate_fixture(fixture) for fixture in METRIC_FIXTURES]


def write_artifact(table: List[Dict[str, Any]], path: str = ARTIFACT_PATH) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(table, handle, indent=2)
    return path


_COLUMNS = [
    ("label", "fixture", 24),
    ("arity", "ar", 3),
    ("instruction_count", "instr", 6),
    ("jump_count", "J", 4),
    ("conditional_jump_count", "condJ", 6),
    ("unconditional_jump_count", "uncJ", 5),
    ("backward_jump_count", "back", 5),
    ("forward_jump_count", "fwd", 4),
    ("diamond_count", "diam", 5),
    ("max_register_index", "maxR", 5),
    ("compile_ok", "cc", 3),
    ("sample_compute_ok", "smpl", 5),
]


def format_table(table: List[Dict[str, Any]]) -> str:
    header = "  ".join(title.ljust(width) for _, title, width in _COLUMNS)
    lines = [header, "-" * len(header)]
    for row in table:
        cells = []
        for key, _, width in _COLUMNS:
            value = row.get(key)
            if value is None:
                text = "-"
            elif isinstance(value, bool):
                text = "ok" if value else "FAIL"
            else:
                text = str(value)
            cells.append(text.ljust(width))
        lines.append("  ".join(cells))
    return "\n".join(lines)


def main() -> None:
    table = build_table()
    print(format_table(table))
    path = write_artifact(table)
    print(f"\nWrote metrics artifact: {path}")


if __name__ == "__main__":
    main()
