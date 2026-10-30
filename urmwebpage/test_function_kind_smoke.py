"""Phase 0 Task A: in-process compile smoke test for public function kinds.

Guards against frontend/backend drift in both directions:
  * a menu kind (frontend FUNCTION_ORDER) the backend compiler does not support;
  * a backend canonical public kind missing from the frontend menu;
  * an alias that points to a missing/unsupported canonical kind.

The backend's GET /function-kinds contract is the backend-side source of truth.
Uses an in-process FastAPI ``TestClient`` -- note this canNOT catch a stale
running uvicorn process; that is what ``scripts/smoke_live.py`` is for.
"""

import unittest

from fastapi.testclient import TestClient

from fixture_kinds import (
    REPRESENTATIVE_SPECS,
    alias_spec,
    load_frontend_function_order,
)
from main import app

UNSUPPORTED_MARKER = "Unsupported function kind"


def _compile(client: TestClient, spec: dict):
    return client.post("/compile-function", json=spec)


def _error_detail(response) -> str:
    try:
        return str(response.json().get("detail", ""))
    except Exception:
        return response.text


class FunctionKindSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.menu_kinds = load_frontend_function_order()
        contract_response = cls.client.get("/function-kinds")
        assert contract_response.status_code == 200, "GET /function-kinds failed"
        cls.contract = contract_response.json()

    # --- contract endpoint ----------------------------------------------

    def test_function_kinds_endpoint_shape(self):
        self.assertEqual(set(self.contract), {
            "canonical_kinds", "aliases", "characteristic_relations",
        })
        self.assertIsInstance(self.contract["canonical_kinds"], list)
        self.assertTrue(self.contract["canonical_kinds"])
        self.assertIsInstance(self.contract["aliases"], dict)
        self.assertIsInstance(self.contract["characteristic_relations"], list)

    # --- bidirectional source-of-truth agreement ------------------------

    def test_frontend_menu_backend_contract_and_specs_agree(self):
        """frontend FUNCTION_ORDER == backend canonical kinds == representative specs."""
        menu = set(self.menu_kinds)
        backend = set(self.contract["canonical_kinds"])
        specs = set(REPRESENTATIVE_SPECS)

        self.assertEqual(
            menu, backend,
            msg=(
                "frontend menu vs backend /function-kinds disagree. "
                f"menu-only={sorted(menu - backend)} backend-only={sorted(backend - menu)}"
            ),
        )
        self.assertEqual(
            backend, specs,
            msg=(
                "backend canonical kinds vs representative specs disagree. "
                f"backend-only={sorted(backend - specs)} specs-only={sorted(specs - backend)}"
            ),
        )

    # --- core drift guard: everything the contract names compiles -------

    def test_every_canonical_kind_compiles(self):
        for kind in self.contract["canonical_kinds"]:
            with self.subTest(kind=kind):
                self.assertIn(kind, REPRESENTATIVE_SPECS,
                              msg=f"no representative spec for backend kind '{kind}'")
                response = _compile(self.client, REPRESENTATIVE_SPECS[kind])
                self.assertEqual(
                    response.status_code, 200,
                    msg=f"{kind} failed to compile: {_error_detail(response)}",
                )
                program = response.json().get("program")
                self.assertIsInstance(program, list)
                self.assertGreaterEqual(len(program), 1,
                                        msg=f"{kind} compiled to an empty program")

    def test_no_menu_kind_is_unsupported(self):
        """Bare ``{kind}`` may 400 on a missing parameter, but never 'Unsupported'."""
        for kind in self.menu_kinds:
            with self.subTest(kind=kind):
                response = _compile(self.client, {"kind": kind})
                self.assertNotIn(
                    UNSUPPORTED_MARKER, _error_detail(response),
                    msg=f"menu kind '{kind}' is not recognized by the compiler",
                )

    def test_unknown_kind_is_reported_unsupported(self):
        """Negative control: a bogus kind must trip the drift detector."""
        response = _compile(self.client, {"kind": "definitely_not_a_real_kind"})
        self.assertEqual(response.status_code, 400)
        self.assertIn(UNSUPPORTED_MARKER, _error_detail(response))

    # --- characteristic relations (from the contract) -------------------

    def test_all_characteristic_relations_compile(self):
        for relation in self.contract["characteristic_relations"]:
            with self.subTest(relation=relation):
                response = _compile(
                    self.client, {"kind": "characteristic", "relation": relation}
                )
                self.assertEqual(
                    response.status_code, 200,
                    msg=f"characteristic:{relation} failed: {_error_detail(response)}",
                )
                self.assertGreaterEqual(len(response.json()["program"]), 1)

    # --- alias / canonical consistency (driven by the contract) ---------

    def test_aliases_resolve_to_supported_canonical_kinds(self):
        canonical_kinds = set(self.contract["canonical_kinds"])
        for alias, canonical in self.contract["aliases"].items():
            with self.subTest(alias=alias):
                # alias must point at a real canonical kind...
                self.assertIn(canonical, canonical_kinds,
                              msg=f"alias '{alias}' targets unknown canonical '{canonical}'")
                # ...and compile identically to that canonical kind.
                canonical_spec = REPRESENTATIVE_SPECS[canonical]
                alias_response = _compile(self.client, alias_spec(canonical_spec, alias))
                canonical_response = _compile(self.client, canonical_spec)
                self.assertEqual(
                    alias_response.status_code, 200,
                    msg=f"alias {alias} failed: {_error_detail(alias_response)}",
                )
                self.assertEqual(canonical_response.status_code, 200)
                self.assertEqual(
                    alias_response.json()["program"],
                    canonical_response.json()["program"],
                    msg=f"alias {alias} compiled differently from {canonical}",
                )


if __name__ == "__main__":
    unittest.main()
