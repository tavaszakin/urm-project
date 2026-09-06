#!/usr/bin/env python3
"""Phase 0 Task D: live-backend compile smoke check.

Posts every public function kind to a *running* backend and reports the result.
This is the only check that catches a stale uvicorn process -- the situation
where the source is correct and in-process tests pass, but the live server still
has an old compiler loaded. It is meant for manual / pre-demo use, NOT CI.

Usage::

    python3 scripts/smoke_live.py
    python3 scripts/smoke_live.py --base-url http://127.0.0.1:8000

Exit code is 0 when every kind compiles, 1 otherwise (including when the backend
is not reachable).
"""

import argparse
import json
import os
import sys
from urllib import error, request

# Allow running from anywhere: make the backend package importable so we can
# reuse the single source of truth for kinds instead of duplicating the list.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from fixture_kinds import (  # noqa: E402  (import after sys.path setup)
    CHARACTERISTIC_RELATIONS,
    REPRESENTATIVE_SPECS,
    load_frontend_function_order,
)

DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def _post(base_url: str, spec: dict, timeout: float = 10.0):
    payload = json.dumps(spec).encode("utf-8")
    req = request.Request(
        f"{base_url}/compile-function",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
        return response.status, body


def _get(base_url: str, path: str, timeout: float = 10.0):
    req = request.Request(f"{base_url}{path}", method="GET")
    with request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
        return response.status, body


def _build_specs():
    """One representative spec per menu kind, expanding characteristic relations."""
    kinds = load_frontend_function_order()
    specs = []
    for kind in kinds:
        if kind == "characteristic":
            for relation in CHARACTERISTIC_RELATIONS:
                specs.append(
                    (f"characteristic:{relation}",
                     {"kind": "characteristic", "relation": relation})
                )
        else:
            specs.append((kind, REPRESENTATIVE_SPECS[kind]))
    return specs


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args(argv)

    try:
        specs = _build_specs()
    except (FileNotFoundError, ValueError) as exc:
        print(f"Could not determine public kinds: {exc}", file=sys.stderr)
        return 1

    # Probe the backend contract first. A live server that 404s here is almost
    # certainly stale (running an old compiler without /function-kinds).
    try:
        _status, contract = _get(args.base_url, "/function-kinds")
    except error.URLError as exc:
        print(
            "Live backend smoke test requires uvicorn running at "
            f"{args.base_url}.\n  ({exc})",
            file=sys.stderr,
        )
        return 1
    except error.HTTPError as exc:
        if exc.code == 404:
            print(
                f"Live backend at {args.base_url} has no GET /function-kinds. "
                "It is likely STALE -- restart uvicorn to load the current compiler.",
                file=sys.stderr,
            )
        else:
            print(f"GET /function-kinds failed: HTTP {exc.code}", file=sys.stderr)
        return 1

    menu = set(load_frontend_function_order())
    backend = set(contract.get("canonical_kinds", []))
    if menu == backend:
        print(f"contract: {len(backend)} canonical kinds, agree with frontend menu")
    else:
        print(
            "contract DRIFT vs frontend menu: "
            f"menu-only={sorted(menu - backend)} backend-only={sorted(backend - menu)}"
        )
    print()

    failures = []
    for label, spec in specs:
        try:
            status, body = _post(args.base_url, spec)
        except error.URLError as exc:
            print(
                "Live backend smoke test requires uvicorn running at "
                f"{args.base_url}.\n  ({exc})",
                file=sys.stderr,
            )
            return 1
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            print(f"FAIL  {label:28s} HTTP {exc.code}  {detail}")
            failures.append(label)
            continue

        program = body.get("program") if isinstance(body, dict) else None
        if status == 200 and isinstance(program, list) and program:
            print(f"ok    {label:28s} {len(program)} instructions")
        else:
            print(f"FAIL  {label:28s} status={status} body={body}")
            failures.append(label)

    print()
    if failures:
        print(f"{len(failures)} kind(s) failed: {', '.join(failures)}")
        return 1
    print(f"All {len(specs)} public kinds compiled against {args.base_url}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
