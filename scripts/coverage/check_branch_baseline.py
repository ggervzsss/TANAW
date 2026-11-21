#!/usr/bin/env python3
"""Check branch coverage per critical workflow against a committed baseline.

    python3 scripts/coverage/check_branch_baseline.py <coverage.json> <baseline.json> [--update]

coverage.json comes from `pytest --cov --cov-report=json`. baseline.json maps each workflow to the
source paths it covers and the minimum share of branches its tests must take, for example
{"report intake": {"paths": ["app/features/reporting/"], "min_branch_percent": 70.0}}.
The check fails when a workflow drops below its minimum. With --update it prints the measured
percentages so a deliberate improvement can raise the baseline. Standard library only.
"""

import json
import sys
from pathlib import Path


def measure(coverage: dict, paths: list[str]) -> tuple[int, int]:
    total = covered = 0
    for filename, data in coverage["files"].items():
        normalized = filename.replace("\\", "/")
        if any(normalized.startswith(path) or f"/{path}" in normalized for path in paths):
            summary = data["summary"]
            total += summary["num_branches"]
            covered += summary["covered_branches"]
    return covered, total


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    coverage = json.loads(Path(argv[0]).read_text())
    if not coverage.get("meta", {}).get("branch_coverage"):
        print("Branch coverage was not measured; set branch = true under [tool.coverage.run].")
        return 2
    baseline = json.loads(Path(argv[1]).read_text())
    failures = []
    for workflow, rule in baseline.items():
        covered, total = measure(coverage, rule["paths"])
        if total == 0:
            print(f"{workflow:<32} no branches measured under {rule['paths']}")
            failures.append(f"{workflow}: no branches measured under {rule['paths']}")
            continue
        percent = 100 * covered / total
        minimum = rule["min_branch_percent"]
        status = "ok" if percent >= minimum else "BELOW BASELINE"
        print(f"{workflow:<32} {covered:>5}/{total:<5} branches  {percent:5.1f}%  (baseline {minimum:.1f}%)  {status}")
        if percent < minimum:
            failures.append(f"{workflow}: {percent:.1f}% < {minimum:.1f}%")
    if failures and "--update" not in argv:
        print("\nBranch coverage fell below the baseline:\n  " + "\n  ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
