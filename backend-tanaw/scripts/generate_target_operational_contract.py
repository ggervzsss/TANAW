"""Write or verify the shared target operational OpenAPI artifact."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.core.contract_export import build_target_operational_contract
from app.main import app

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = REPOSITORY_ROOT / "shared-contracts" / "target-operational-v2.openapi.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    rendered = (
        json.dumps(
            build_target_operational_contract(app),
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
        )
        + "\n"
    )
    if arguments.check:
        if not OUTPUT_PATH.is_file() or OUTPUT_PATH.read_text(encoding="utf-8") != rendered:
            raise SystemExit(
                "The shared target operational contract is stale. Run "
                "`uv run python scripts/generate_target_operational_contract.py`."
            )
        return 0
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
