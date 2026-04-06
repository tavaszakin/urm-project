import json
from urllib import error, request

BASE_URL = "http://127.0.0.1:8000/run-function"
TEST_RESULTS = []


def post_json(url, payload):
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req) as response:
            return response.status, response.read().decode("utf-8")
    except error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def summarize_eval(evaluation):
    if not evaluation:
        return "no evaluation metadata"

    kind = evaluation.get("kind", "unknown")

    if kind == "compose":
        inner = evaluation.get("inner", {})
        outer = evaluation.get("outer", {})
        return (
            f"compose | inner_output={inner.get('output_value')} "
            f"-> outer_output={outer.get('output_value')} "
            f"| final={evaluation.get('final_output')}"
        )

    if kind in {"primrec", "primitive_recursion"}:
        iterations = evaluation.get("iterations", [])
        return (
            f"primrec | n={evaluation.get('recursion_input')} "
            f"| base={evaluation.get('base', {}).get('output_value')} "
            f"| iterations={len(iterations)} "
            f"| final={evaluation.get('final_output')}"
        )

    return f"evaluation kind={kind}"


def find_evaluation(data):
    return (
        data.get("evaluation")
        or data.get("function_evaluation")
        or data.get("nested_evaluation")
    )


def check_metadata(name, data, expected_kind=None):
    evaluation = find_evaluation(data)

    if expected_kind is None:
        if evaluation is not None:
            print(f"⚠️  {name}: metadata present unexpectedly -> {summarize_eval(evaluation)}")
            return True, None
        print(f"✅ {name}: no metadata expected, none found")
        return True, None

    if evaluation is None:
        print(f"❌ {name}: expected metadata of kind '{expected_kind}', but none found")
        return False, "missing metadata"

    actual_kind = evaluation.get("kind")
    if actual_kind != expected_kind:
        print(f"❌ {name}: expected metadata kind '{expected_kind}', got '{actual_kind}'")
        print("Metadata summary:", summarize_eval(evaluation))
        return False, f"expected metadata kind {expected_kind}, got {actual_kind}"

    print(f"✅ {name}: metadata present -> {summarize_eval(evaluation)}")
    return True, None


def run_test(
    name,
    payload,
    expected_output=None,
    should_fail=False,
    expected_status=None,
    expected_metadata_kind=None,
):
    print(f"\n=== {name} ===")

    try:
        status, response_text = post_json(BASE_URL, payload)

        try:
            data = json.loads(response_text)
        except Exception:
            data = {"raw_text": response_text}

        print("Status:", status)
        print("Response:")
        print(json.dumps(data, indent=2))

        if expected_status is not None and status != expected_status:
            print(f"❌ Expected status {expected_status}, got {status}")
            TEST_RESULTS.append((name, False, f"expected status {expected_status}, got {status}"))
            return

        if should_fail:
            if status >= 400:
                print("✅ Correctly failed")
                TEST_RESULTS.append((name, True, None))
            else:
                print("❌ Expected failure but succeeded")
                TEST_RESULTS.append((name, False, "expected failure but succeeded"))
            return

        if status != 200:
            print("❌ Unexpected non-200 status")
            TEST_RESULTS.append((name, False, f"unexpected status {status}"))
            return

        output = data.get("output_value", data.get("output"))
        passed = True
        failure_reason = None

        if output == expected_output:
            print(f"✅ Output correct ({output})")
        else:
            print(f"❌ Output mismatch: expected {expected_output}, got {output}")
            passed = False
            failure_reason = f"expected {expected_output}, got {output}"

        if "program" in data:
            print(f"✅ program present ({len(data['program'])} instructions)")
        else:
            print("❌ program missing")
            if passed:
                passed = False
                failure_reason = "program missing"

        if "steps" in data:
            print(f"✅ steps present ({len(data['steps'])} step records)")
        else:
            print("❌ steps missing")
            if passed:
                passed = False
                failure_reason = "steps missing"

        if "trace" in data:
            print(f"✅ trace present ({len(data['trace'])} rows)")
        else:
            print("⚠️  trace missing")

        metadata_ok, metadata_reason = check_metadata(
            name, data, expected_kind=expected_metadata_kind
        )
        if not metadata_ok and passed:
            passed = False
            failure_reason = metadata_reason

        TEST_RESULTS.append((name, passed, failure_reason))

    except Exception as e:
        print("❌ Exception:", str(e))
        TEST_RESULTS.append((name, False, f"exception: {e}"))


# ============================================================
# Step 8: basic function tests
# ============================================================

run_test(
    "Zero",
    {
        "function": {"kind": "zero"},
        "initial_registers": [5],
    },
    expected_output=0,
    expected_metadata_kind=None,
)

run_test(
    "Successor",
    {
        "function": {"kind": "successor"},
        "initial_registers": [4],
    },
    expected_output=5,
    expected_metadata_kind=None,
)

run_test(
    "Constant",
    {
        "function": {"kind": "constant", "value": 3},
        "initial_registers": [999],
    },
    expected_output=3,
    expected_metadata_kind=None,
)

run_test(
    "Add",
    {
        "function": {"kind": "add"},
        "initial_registers": [2, 3],
    },
    expected_output=5,
    expected_metadata_kind=None,
)

# ============================================================
# Step 9: composition tests
# ============================================================

run_test(
    "Compose: succ(add(2,3))",
    {
        "function": {
            "kind": "compose",
            "outer": {"kind": "successor"},
            "inner": {"kind": "add"},
        },
        "initial_registers": [2, 3],
    },
    expected_output=6,
    expected_metadata_kind="compose",
)

run_test(
    "Compose: succ(constant(3))",
    {
        "function": {
            "kind": "compose",
            "outer": {"kind": "successor"},
            "inner": {"kind": "constant", "value": 3},
        },
        "initial_registers": [99],
    },
    expected_output=4,
    expected_metadata_kind="compose",
)

run_test(
    "Compose missing inner (should fail)",
    {
        "function": {
            "kind": "compose",
            "outer": {"kind": "successor"},
        },
        "initial_registers": [2, 3],
    },
    should_fail=True,
)

run_test(
    "Compose missing outer (should fail)",
    {
        "function": {
            "kind": "compose",
            "inner": {"kind": "add"},
        },
        "initial_registers": [2, 3],
    },
    should_fail=True,
)

# ============================================================
# Step 10: primitive recursion correctness tests
# ============================================================

run_test(
    "PrimRec constant(3) + successor, n=0",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [0],
    },
    expected_output=3,
    expected_metadata_kind="primrec",
)

run_test(
    "PrimRec constant(3) + successor, n=1",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [1],
    },
    expected_output=4,
    expected_metadata_kind="primrec",
)

run_test(
    "PrimRec constant(3) + successor, n=2",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [2],
    },
    expected_output=5,
    expected_metadata_kind="primrec",
)

run_test(
    "PrimRec constant(3) + successor, n=5",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [5],
    },
    expected_output=8,
    expected_metadata_kind="primrec",
)

run_test(
    "PrimRec with extra inputs",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [2, 99, 100],
    },
    expected_output=5,
    expected_metadata_kind="primrec",
)

run_test(
    "PrimRec missing base (should fail)",
    {
        "function": {
            "kind": "primrec",
            "step": {"kind": "successor"},
        },
        "initial_registers": [2],
    },
    should_fail=True,
)

run_test(
    "PrimRec missing step (should fail)",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
        },
        "initial_registers": [2],
    },
    should_fail=True,
)

run_test(
    "PrimRec missing recursion input (should fail)",
    {
        "function": {
            "kind": "primrec",
            "base": {"kind": "constant", "value": 3},
            "step": {"kind": "successor"},
        },
        "initial_registers": [],
    },
    should_fail=True,
)

# ============================================================
# Optional stronger test: addition via primitive recursion
# Uncomment if your implementation supports it.
# ============================================================

# run_test(
#     "PrimRec addition via projection+successor",
#     {
#         "function": {
#             "kind": "primrec",
#             "base": {"kind": "projection", "index": 0, "arity": 1},
#             "step": {"kind": "successor"},
#         },
#         "initial_registers": [2, 3],
#     },
#     expected_output=5,
#     expected_metadata_kind="primrec",
# )

print("\n🎉 All Step 8–11 tests completed.")

print("\n==================== TEST SUMMARY ====================\n")

passed_count = 0
failed_count = 0

for name, passed, reason in TEST_RESULTS:
    if passed:
        passed_count += 1
        print(f"{name}: ✅")
    else:
        failed_count += 1
        print(f"{name}: ❌ ({reason})")

print(f"\nPassed: {passed_count}")
print(f"Failed: {failed_count}")

print("\n=====================================================\n")
