"""DOT–DILG LGPMS–LTSS Annex B, April 23, 2021 update."""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

OTHER_ATTRACTION_CODE = "901"


class AttractionClassification(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str
    typeCode: str
    type: str
    category: str
    portfolioCategory: str
    ntdpCode: str


_TYPES = {
    "1": "Nature",
    "2": "History and Culture",
    "3": "Industrial Tourism",
    "4": "Sports and Recreational Facilities",
    "5": "Shopping",
    "6": "Customs and Traditions",
    "7": "Special Event",
    "8": "Health and Wellness",
    "9": "Others",
}
_NATURE = "Nature Tourism"
_CULTURE = "Cultural Tourism"
_LEISURE = "Leisure and Entertainment Tourism"
_BEACH = "Sun and Beach Tourism"
_EVENTS = "MICE and Events Tourism"
_WELLNESS = "Health, Wellness and Retirement Tourism"
_OTHER = "Others"

# Preserve the printed portfolio and NTDP entries independently, including shared NTDP codes.
_ROWS = (
    ("101", "Mountains/hills/highlands", _NATURE, "TD107"),
    ("102", "Falls", _NATURE, "TD103"),
    ("103", "Lakes and Pond", _NATURE, "TD106"),
    ("104", "River and Landscape (includes subterranean rivers)", _NATURE, "TD109"),
    ("105", "Coastal Landscape and Seascape", _NATURE, "TD801"),
    ("106", "Marine Park (e.g. aquarium, open parks)", _NATURE, "TD114"),
    ("107", "Caves (inland)", _NATURE, "TD102"),
    ("108", "Unique Natural Landscape / Seascape", _NATURE, "TD110"),
    ("109", "Volcanoes", _NATURE, "TD111"),
    ("110", "Dive sites", "Diving and Marine Sports Tourism", "TD801"),
    (
        "199",
        "Other Natural Attractions (e.g. century old trees/forest, endemic species)",
        _NATURE,
        "TD108",
    ),
    ("201", "Fort", _CULTURE, "TD205"),
    ("202", "Church, Mosque, temples or other religious sites", _CULTURE, "TD203"),
    ("203", "Historical Road/Trails", _CULTURE, "TD207"),
    ("204", "Historic Monuments", _CULTURE, "TD206"),
    ("205", "Museum", _CULTURE, "TD213"),
    ("206", "Structures and Buildings", _CULTURE, "TD218"),
    ("207", "Unique Cultural Heritage", _CULTURE, "TD219"),
    ("208", "Archaeological/Historic Sites", _CULTURE, "TD201"),
    ("299", "Other Historical or cultural attractions", _CULTURE, "TD215"),
    ("301", "Agro-Forestry", _NATURE, "TD101"),
    ("302", "Farm / Ranch", _NATURE, "TD104"),
    ("303", "Fishery", _NATURE, "TD105"),
    ("304", "Arts and Craft", _CULTURE, "TD202"),
    (
        "305",
        "Industrial Facilities (e.g. Gov't flagship facilities like model recycling centers or "
        "private sector model systems)",
        _OTHER,
        "TD002",
    ),
    ("401", "Golf", _LEISURE, "TD404"),
    ("402", "Tennis", _LEISURE, "TD413"),
    ("403", "Cycling Road and Area", _LEISURE, "TD403"),
    ("404", "Zoo and Botanical Garden", _NATURE, "TD115"),
    ("405", "Sports Complex", _LEISURE, "TD412"),
    ("406", "Camping Ground", _NATURE, "TD112"),
    ("407", "Nature Trail and Path", _NATURE, "TD114"),
    ("408", "Beach for Sea Bathing", _BEACH, "TD301"),
    ("409", "Pools and Springs", _LEISURE, "TD410"),
    ("410", "Marina and Harbor", _LEISURE, "TD406"),
    ("411", "Parks", _LEISURE, "TD409"),
    ("412", "Leisure-land, Theme Park", _LEISURE, "TD405"),
    ("413", "Resort Complex", _LEISURE, "TD411"),
    ("414", "Other Sports and Recreational Activities", _LEISURE, "TD408"),
    ("415", "Casino", _LEISURE, "TD402"),
    ("416", "Water Sports (Excludes Diving, see Nature Category)", _BEACH, "TD302"),
    ("501", "Malls, Department Stores", _LEISURE, "TD414"),
    ("502", "Open Air Market, Traditional Market Area", _CULTURE, "TD214"),
    ("503", "Souvenirs And Delicacies", _CULTURE, "TD217"),
    ("601", "Local Specialty Restaurant", _CULTURE, "TD210"),
    (
        "602",
        "Festivals (e.g. official or de facto cultural heritage/community related)",
        _CULTURE,
        "TD204",
    ),
    ("603", "Performing Arts (e.g. Folk Music and Dance)", _CULTURE, "TD216"),
    (
        "604",
        "Local Culture and Traditions (includes social practices and rituals)",
        _CULTURE,
        "TD209",
    ),
    ("701", "Exposition", _EVENTS, "TD502"),
    ("702", "Convention", _EVENTS, "TD501"),
    ("703", "Sports Event", _EVENTS, "TD504"),
    (
        "704",
        "Entertainment (e.g. musical concerts that are not necessarily related to cultural or "
        "community festivals)",
        _EVENTS,
        "TD505",
    ),
    ("799", "Other Events", _EVENTS, "TD503"),
    ("801", "Hot Spring", _WELLNESS, "TD603"),
    ("802", "Cold Spring", _WELLNESS, "TD601"),
    ("803", "Spa", _WELLNESS, "TD605"),
    ("804", "Hospital/Clinics/Medical Tourism Facilities", _WELLNESS, "TD602"),
    ("805", "Retirement Villages", _WELLNESS, "TD604"),
    (OTHER_ATTRACTION_CODE, "Others (Please specify)", _OTHER, "TD001"),
    ("902", "Education Tourism", "Education Tourism", "TD901"),
    ("903", "Cruise and Nautical Tourism", "Cruise and Nautical Tourism", "TD701"),
)
ATTRACTION_CLASSIFICATIONS = {
    code: AttractionClassification(
        code=code,
        typeCode=code[0],
        type=_TYPES[code[0]],
        category=category,
        portfolioCategory=portfolio,
        ntdpCode=ntdp,
    )
    for code, category, portfolio, ntdp in _ROWS
}


def attraction_category(code: str, description: str | None) -> str:
    return description or ATTRACTION_CLASSIFICATIONS[code].category


class AttractionSelection(BaseModel):
    attractionCode: str = Field(
        description="Three-digit DOT attraction code from the April 2021 Annex B catalog."
    )
    attractionDescription: str | None = Field(default=None, max_length=120)

    @field_validator("attractionCode")
    @classmethod
    def validate_attraction_code(cls, value: str) -> str:
        code = value.strip()
        if code not in ATTRACTION_CLASSIFICATIONS:
            raise ValueError("Choose an official DOT attraction category.")
        return code

    @field_validator("attractionDescription", mode="before")
    @classmethod
    def normalize_attraction_description(cls, value: object) -> object:
        return " ".join(value.split()) or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_description(self) -> AttractionSelection:
        if self.attractionCode == OTHER_ATTRACTION_CODE and not self.attractionDescription:
            raise ValueError("Specify the attraction when choosing code 901 (Others).")
        if self.attractionCode != OTHER_ATTRACTION_CODE and self.attractionDescription:
            raise ValueError("An attraction description is only used with code 901 (Others).")
        return self
