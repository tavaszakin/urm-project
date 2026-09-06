"""Shared registry of public function kinds and representative specs.

Phase 0 fixture tooling. This module is the single Python-side source of truth
for *which* public function kinds exist and *how* to build a minimal spec that
compiles for each one. The authoritative menu list itself lives in the shared
frontend file ``frontend/src/functionMetadata.js`` (``FUNCTION_ORDER``); we parse
that array here rather than duplicating it, so menu/backend drift surfaces as a
test failure instead of silent divergence.

Nothing in this module touches layout, routing, or rendering. It only describes
URM function specs and how to compile/run them.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

_FRONTEND_FUNCTION_METADATA = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "frontend",
    "src",
    "functionMetadata.js",
)


def load_frontend_function_order(path: Optional[str] = None) -> List[str]:
    """Parse ``FUNCTION_ORDER`` out of the shared frontend metadata file.

    Returns the ordered list of canonical public kinds shown in the chooser.
    Raises ``FileNotFoundError`` with a clear message if the frontend file is
    missing so the smoke test fails loudly rather than silently skipping.
    """

    target = path or _FRONTEND_FUNCTION_METADATA
    if not os.path.exists(target):
        raise FileNotFoundError(
            "Cannot locate shared frontend function metadata at "
            f"{target}; FUNCTION_ORDER is the source of truth for public kinds."
        )

    with open(target, "r", encoding="utf-8") as handle:
        source = handle.read()

    match = re.search(r"FUNCTION_ORDER\s*=\s*\[(.*?)\]", source, re.DOTALL)
    if match is None:
        raise ValueError(
            f"Could not find a FUNCTION_ORDER array in {target}."
        )

    kinds = re.findall(r"""["']([A-Za-z0-9_]+)["']""", match.group(1))
    if not kinds:
        raise ValueError(f"FUNCTION_ORDER in {target} parsed to an empty list.")

    return kinds


# Minimal spec per public menu kind that is expected to compile successfully.
# Parameterized kinds (constant/projection/characteristic/compose/primrec/
# minimization) need representative arguments; bare arithmetic kinds do not.
# The keys MUST stay in sync with FUNCTION_ORDER (the smoke test asserts this).
REPRESENTATIVE_SPECS: Dict[str, Dict[str, Any]] = {
    "zero": {"kind": "zero"},
    "successor": {"kind": "successor"},
    "predecessor": {"kind": "predecessor"},
    "constant": {"kind": "constant", "value": 3},
    "projection": {"kind": "projection", "index": 1, "arity": 2},
    "add": {"kind": "add"},
    "multiplication": {"kind": "multiplication"},
    "exponentiation": {"kind": "exponentiation"},
    "factorial": {"kind": "factorial"},
    "geometric_sum": {"kind": "geometric_sum"},
    "divisor_count": {"kind": "divisor_count"},
    "bounded_sub": {"kind": "bounded_sub"},
    "characteristic": {"kind": "characteristic", "relation": "leq"},
    "compose": {
        "kind": "compose",
        "inner": {"kind": "successor"},
        "outer": {"kind": "successor"},
    },
    "primrec": {
        "kind": "primrec",
        "base": {"kind": "zero"},
        "step": {"kind": "successor"},
    },
    "minimization": {"kind": "minimization", "inner": {"kind": "add"}},
}

# Frontend-side fallback for the characteristic relations. The backend's
# GET /function-kinds contract is the authoritative source for these; this
# constant is kept so the metrics harness and live script work without a
# running server.
CHARACTERISTIC_RELATIONS: List[str] = ["leq", "lt", "eq", "divides"]


def alias_spec(canonical_spec: Dict[str, Any], alias: str) -> Dict[str, Any]:
    """Return a copy of a representative spec with its kind swapped for an alias.

    Used to verify (against the backend contract) that an alias compiles to the
    same program as its canonical kind, reusing the canonical's parameters.
    """
    swapped = dict(canonical_spec)
    swapped["kind"] = alias
    return swapped


# Concrete fixtures to measure for the static-metrics baseline. Each entry pairs
# a human label with a compiling spec and optional small sample-compute checks
# ``(inputs, expected_output)``. Inputs are kept tiny to avoid long traces.
METRIC_FIXTURES: List[Dict[str, Any]] = [
    {"label": "zero", "spec": {"kind": "zero"},
     "samples": [([0], 0), ([5], 0)]},
    {"label": "successor", "spec": {"kind": "successor"},
     "samples": [([0], 1), ([4], 5)]},
    {"label": "predecessor", "spec": {"kind": "predecessor"},
     "samples": [([0], 0), ([5], 4)]},
    {"label": "constant(3)", "spec": {"kind": "constant", "value": 3},
     "samples": [([0], 3), ([9], 3)]},
    {"label": "projection(1,2)", "spec": {"kind": "projection", "index": 1, "arity": 2},
     "samples": [([7, 9], 7)]},
    {"label": "add", "spec": {"kind": "add"},
     "samples": [([3, 4], 7), ([0, 0], 0)]},
    {"label": "bounded_sub", "spec": {"kind": "bounded_sub"},
     "samples": [([5, 3], 2), ([3, 5], 0)]},
    {"label": "multiplication", "spec": {"kind": "multiplication"},
     "samples": [([0, 0], 0), ([0, 5], 0), ([3, 0], 0), ([2, 4], 8), ([3, 3], 9)]},
    {"label": "exponentiation", "spec": {"kind": "exponentiation"},
     "samples": [([0, 0], 1), ([0, 3], 0), ([1, 5], 1), ([2, 0], 1), ([2, 3], 8), ([3, 2], 9)]},
    {"label": "factorial", "spec": {"kind": "factorial"},
     "samples": [([0], 1), ([1], 1), ([2], 2), ([3], 6), ([4], 24), ([5], 120)]},
    {"label": "geometric_sum", "spec": {"kind": "geometric_sum"},
     "samples": [([0, 0], 1), ([0, 1], 1), ([1, 4], 5), ([2, 0], 1), ([2, 1], 3),
                 ([2, 2], 7), ([2, 3], 15), ([3, 2], 13)]},
    {"label": "divisor_count", "spec": {"kind": "divisor_count"},
     "samples": [([0], 0), ([1], 1), ([2], 2), ([3], 2), ([4], 3), ([5], 2), ([6], 4)]},
    {"label": "characteristic:leq", "spec": {"kind": "characteristic", "relation": "leq"},
     "samples": [([2, 3], 1), ([3, 3], 1), ([3, 2], 0)]},
    {"label": "characteristic:lt", "spec": {"kind": "characteristic", "relation": "lt"},
     "samples": [([2, 3], 1), ([3, 3], 0), ([3, 2], 0)]},
    {"label": "characteristic:eq", "spec": {"kind": "characteristic", "relation": "eq"},
     "samples": [([2, 2], 1), ([2, 3], 0)]},
    {"label": "characteristic:divides", "spec": {"kind": "characteristic", "relation": "divides"},
     "samples": [([2, 4], 1), ([3, 4], 0), ([1, 5], 1), ([0, 0], 1), ([0, 5], 0)]},
    {"label": "compose(succ,succ)",
     "spec": {"kind": "compose", "inner": {"kind": "successor"}, "outer": {"kind": "successor"}},
     "samples": [([5], 7)]},
    {"label": "primrec(zero,succ)",
     "spec": {"kind": "primrec", "base": {"kind": "zero"}, "step": {"kind": "successor"}},
     "samples": [([3, 9], 3), ([0, 4], 0)]},
    {"label": "minimization(add)",
     "spec": {"kind": "minimization", "inner": {"kind": "add"}},
     "samples": [([0], 0)]},
    # Internal `substitution` kind (compiler-only; intentionally NOT in the public
    # menu / REPRESENTATIVE_SPECS, so the menu==contract==specs invariant holds).
    # Measured here so the metrics baseline covers generalized composition.
    {"label": "subst:double",
     "spec": {"kind": "substitution", "outer": {"kind": "add"},
              "inners": [{"kind": "projection", "index": 1, "arity": 1},
                         {"kind": "projection", "index": 1, "arity": 1}]},
     "samples": [([5], 10), ([0], 0)]},
    {"label": "subst:square",
     "spec": {"kind": "substitution", "outer": {"kind": "multiplication"},
              "inners": [{"kind": "projection", "index": 1, "arity": 1},
                         {"kind": "projection", "index": 1, "arity": 1}]},
     "samples": [([5], 25), ([0], 0)]},
    {"label": "subst:diagonal_divides",
     "spec": {"kind": "substitution",
              "outer": {"kind": "characteristic", "relation": "divides"},
              "inners": [{"kind": "projection", "index": 1, "arity": 1},
                         {"kind": "projection", "index": 1, "arity": 1}]},
     "samples": [([1], 1), ([5], 1)]},
    {"label": "subst:add_succ",
     "spec": {"kind": "substitution", "outer": {"kind": "add"},
              "inners": [{"kind": "substitution", "outer": {"kind": "successor"},
                          "inners": [{"kind": "projection", "index": 1, "arity": 2}]},
                         {"kind": "projection", "index": 2, "arity": 2}]},
     "samples": [([3, 4], 8)]},
    {"label": "subst:succ_add",
     "spec": {"kind": "substitution", "outer": {"kind": "successor"},
              "inners": [{"kind": "add"}]},
     "samples": [([3, 4], 8)]},
]
