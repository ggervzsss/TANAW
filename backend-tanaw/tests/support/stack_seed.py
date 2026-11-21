"""Seed the synthetic Enterprise account for the disposable-stack report scenario.

Run by scripts/e2e-stack/run.mjs against a freshly migrated, disposable database:

    TANAW_STACK_DISPOSABLE_DATABASE=true TANAW_STACK_PASSWORD=... \\
        uv run python -m tests.support.stack_seed

The backend's own development seeding creates the Staff account. This adds one active Enterprise
in its own barangay, so the Staff portal can consolidate its report alone, and prints the
enterprise's identity as JSON. It refuses to run without the disposable-database flag.
"""

import asyncio
import json
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.service import generate_enterprise_id

ENTERPRISE_EMAIL = "stack-park@example.test"
ENTERPRISE_NAME = "Stack Scenario Park"
ENTERPRISE_BARANGAY = "Poblacion"


async def seed(password: str) -> dict[str, str]:
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(Account).where(Account.email == ENTERPRISE_EMAIL))
        if existing is not None:
            raise SystemExit(f"{ENTERPRISE_EMAIL} already exists; use a fresh disposable database.")
        enterprise_id = await generate_enterprise_id(db, ENTERPRISE_NAME)
        now = datetime.now(UTC)
        account = Account(
            email=ENTERPRISE_EMAIL,
            password_hash=hash_password(validate_password_policy(password)),
            role=AccountRole.ENTERPRISE,
            display_name=ENTERPRISE_NAME,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=now,
            enterprise_profile=EnterpriseProfile(
                enterprise_id=enterprise_id,
                enterprise_name=ENTERPRISE_NAME,
                attraction_code="411",
                attraction_description="Synthetic park for the disposable-stack scenario",
                manager_name="Stack Scenario Manager",
                barangay=ENTERPRISE_BARANGAY,
                address=f"Barangay {ENTERPRISE_BARANGAY}, San Pedro, Laguna 4023",
                latitude=14.3595,
                longitude=121.0473,
                location_updated_at=now,
                building_capacity=100,
            ),
        )
        db.add(account)
        await db.commit()
        return {
            "enterpriseEmail": ENTERPRISE_EMAIL,
            "enterpriseId": enterprise_id,
            "enterpriseName": ENTERPRISE_NAME,
            "barangay": ENTERPRISE_BARANGAY,
        }


def main() -> None:
    if os.environ.get("TANAW_STACK_DISPOSABLE_DATABASE") != "true":
        sys.exit(
            "Refusing to seed: set TANAW_STACK_DISPOSABLE_DATABASE=true for a throwaway database."
        )
    password = os.environ.get("TANAW_STACK_PASSWORD")
    if not password:
        sys.exit("Set TANAW_STACK_PASSWORD to the synthetic accounts' password.")
    print(json.dumps(asyncio.run(seed(password))))


if __name__ == "__main__":
    main()
