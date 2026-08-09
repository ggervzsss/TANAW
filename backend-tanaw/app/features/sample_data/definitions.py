from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.features.accounts.models import Account, AccountRole
from app.features.monitoring.models import EnterpriseTelemetrySnapshot

TEST_ACCOUNT_PASSWORD = "Visitor sample access phrase 2026"
DEFAULT_SCENARIO = "full-workflow"
DEFAULT_SEED = "tanaw-sample-v2"
REPORTING_STAFF_NAME = "Carla Mendoza"
SAMPLE_UUID_NAMESPACE = UUID("b8df7e73-013f-4d10-8554-e8d54f90086f")
DEMOGRAPHIC_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)


@dataclass(frozen=True)
class SampleEnterprise:
    name: str
    category: str
    manager: str
    barangay: str
    address: str
    latitude: float
    longitude: float
    email: str
    phone: str


@dataclass(frozen=True)
class AdminVisitorScenario:
    enterprise: Account
    current_visitors: int
    typical_visitors: int
    captured_at: datetime
    telemetry: list[EnterpriseTelemetrySnapshot]


ENTERPRISES = (
    SampleEnterprise(
        "Balon ni Lolo Uweng",
        "tourism",
        "Ma Regine Javier",
        "Landayan",
        "Barangay Landayan, San Pedro, Laguna 4023",
        14.352361,
        121.067985,
        "balon.lolo.uweng@tanaw.test",
        "+639171110001",
    ),
    SampleEnterprise(
        "San Pedro Apostol Parish",
        "tourism",
        "Irish May Arabaca",
        "Nueva",
        "Barangay Nueva, San Pedro, Laguna 4023",
        14.363881,
        121.056564,
        "sanpedro.apostol@tanaw.test",
        "+639171110002",
    ),
    SampleEnterprise(
        "Lolo Uweng Pilgrim Church",
        "tourism",
        "David Kristian Vallejera",
        "Landayan",
        "Barangay Landayan, San Pedro, Laguna 4023",
        14.350951,
        121.066450,
        "lolo.uweng.church@tanaw.test",
        "+639171110003",
    ),
    SampleEnterprise(
        "Tricia's Bar & Lounge",
        "business",
        "Kenneth Delicano",
        "Nueva",
        "Barangay Nueva, San Pedro, Laguna 4023",
        14.348207,
        121.064359,
        "tricias.bar@tanaw.test",
        "+639171110004",
    ),
    SampleEnterprise(
        "Hallow Ridge Filipinas Golf Inc.",
        "tourism",
        "Sebastien Bercasio",
        "San Antonio",
        "Barangay San Antonio, San Pedro, Laguna 4023",
        14.357021,
        121.028243,
        "hallowridge.golf@tanaw.test",
        "+639171110005",
    ),
)


LGU_ACCOUNTS = (
    (
        "it.operations@tanaw.test",
        AccountRole.IT,
        "Coco Martin",
        "IT Personnel",
        "Coco",
        "Martin",
    ),
    (
        "system.admin@tanaw.test",
        AccountRole.ADMIN,
        "Marissa Delgado",
        "Admin",
        "Marissa",
        "Delgado",
    ),
    (
        "reports.staff@tanaw.test",
        AccountRole.STAFF,
        REPORTING_STAFF_NAME,
        "LGU Staff",
        "Carla",
        "Mendoza",
    ),
)
