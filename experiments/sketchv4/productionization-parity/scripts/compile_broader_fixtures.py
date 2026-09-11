"""Emit the maintained 24-fixture regression set with freshly compiled programs."""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[4]
APP = ROOT / "urmwebpage"
sys.path.insert(0, str(APP))

from compiler import FunctionSpec, compile_function_to_program  # noqa: E402
from fixture_kinds import METRIC_FIXTURES  # noqa: E402


def main() -> None:
    rows = []
    for fixture in METRIC_FIXTURES:
        program = compile_function_to_program(FunctionSpec(**fixture["spec"]))
        rows.append({
            "label": fixture["label"],
            "program": [list(instruction) for instruction in program],
        })
    print(json.dumps(rows, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
