#!/usr/bin/env python3
"""Read-only provenance and conservative backend deployment classification."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def backend_input(path):
    name = Path(path).name
    if name in {"requirements.txt", "pyproject.toml", "poetry.lock", "uv.lock",
                "Pipfile", "Pipfile.lock", ".python-version", "runtime.txt",
                "render.yaml", "render.yml", "Dockerfile", "Procfile"}:
        return True
    return (path.startswith("urmwebpage/") and "/frontend/" not in path
            and "/verification/" not in path and "/.claude/" not in path
            and name.endswith(".py") and not name.startswith("test")
            and "/scripts/" not in path)


def changed(base):
    # Retain both sides of moves so moving runtime code cannot evade the check.
    return set(git("diff", "--name-only", "--no-renames", base, "--").splitlines())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Verified production frontend/base SHA")
    parser.add_argument("--backend-base", help="Verified live Render SHA")
    parser.add_argument("--source", help="Intended source ref for provenance")
    args = parser.parse_args()
    os.chdir(git("rev-parse", "--show-toplevel"))
    base = git("rev-parse", "--verify", f"{args.base}^{{commit}}")
    untracked = set(git("ls-files", "--others", "--exclude-standard").splitlines())
    backend_base = (git("rev-parse", "--verify", f"{args.backend_base}^{{commit}}")
                    if args.backend_base else None)
    backend_changes = (sorted(p for p in changed(backend_base) | untracked if backend_input(p))
                       if backend_base else None)
    print(json.dumps({
        "repository": git("remote", "get-url", "origin"),
        "branch": git("branch", "--show-current"),
        "candidate_sha": git("rev-parse", "HEAD"),
        "production_base_sha": base,
        "source_sha": git("rev-parse", f"{args.source}^{{commit}}") if args.source else None,
        "working_tree_clean": not bool(git("status", "--porcelain")),
        "changed_files": sorted(changed(base) | untracked),
        "untracked_files": sorted(untracked),
        "render_live_sha": backend_base,
        "backend_changed_inputs": backend_changes,
        "backend_redeploy": "unknown" if backend_changes is None else bool(backend_changes),
        "note": "Heuristic; inspect API, imports and provider settings before skipping Render.",
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"Git inventory failed (exit {exc.returncode}).", file=sys.stderr)
        raise SystemExit(1)
