import pytest
from pydantic import ValidationError

from app.features.accounts.attractions import ATTRACTION_CLASSIFICATIONS, AttractionSelection


def test_annex_b_preserves_attraction_codes_types_and_shared_portfolio_codes() -> None:
    catalog = ATTRACTION_CLASSIFICATIONS
    assert len(catalog) == 61
    assert {row.typeCode for row in catalog.values()} == set("123456789")
    assert catalog["401"].category == "Golf"
    assert catalog["401"].ntdpCode == "TD404"
    assert catalog["704"].type == "Special Event"
    assert catalog["105"].ntdpCode == catalog["110"].ntdpCode == "TD801"
    assert catalog["105"].portfolioCategory != catalog["110"].portfolioCategory
    assert catalog["106"].ntdpCode == catalog["407"].ntdpCode == "TD114"


@pytest.mark.parametrize("code", ["TD404", "4040", "999", "Tourism"])
def test_selecting_requires_an_official_attraction_code(code: str) -> None:
    with pytest.raises(ValidationError, match="Choose an official DOT attraction category"):
        AttractionSelection(attractionCode=code)


def test_others_requires_a_description() -> None:
    with pytest.raises(ValidationError, match="Specify the attraction"):
        AttractionSelection(attractionCode="901", attractionDescription="  ")

    assert (
        AttractionSelection(
            attractionCode="901", attractionDescription="  Heritage   well  "
        ).attractionDescription
        == "Heritage well"
    )
    with pytest.raises(ValidationError, match="only used with code 901"):
        AttractionSelection(attractionCode="202", attractionDescription="Wrong field")
