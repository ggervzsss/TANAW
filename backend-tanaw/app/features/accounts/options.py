ENTERPRISE_CATEGORY_LABELS = {
    "events venue": "Events Venue",
    "tourism": "Tourism",
    "business": "Business",
}

ENTERPRISE_CATEGORIES = tuple(ENTERPRISE_CATEGORY_LABELS.keys())


def format_enterprise_category(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip().lower()
    if not normalized:
        return None

    return ENTERPRISE_CATEGORY_LABELS.get(normalized, value.strip())


SAN_PEDRO_BARANGAYS = (
    "Bagong Silang",
    "Calendola",
    "Chrysanthemum",
    "Cuyab",
    "Estrella",
    "Fatima",
    "GSIS",
    "Landayan",
    "Langgam",
    "Laram",
    "Magsaysay",
    "Maharlika",
    "Narra",
    "Nueva",
    "Pacita I",
    "Pacita II",
    "Poblacion",
    "Riverside",
    "Rosario",
    "Sampaguita",
    "San Antonio",
    "San Lorenzo Ruiz",
    "San Roque",
    "San Vicente",
    "Santo Niño",
    "United Bayanihan",
    "United Better Living",
)

SAN_PEDRO_ADDRESS_SUFFIX = "San Pedro, Laguna 4023"
