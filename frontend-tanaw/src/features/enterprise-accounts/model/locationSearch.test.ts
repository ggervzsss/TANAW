import { describe, expect, it } from "vitest";
import type { EnterpriseLocationSuggestion } from "../types";
import { filterRelatedLocationSuggestions } from "./locationSearch";

const shrine: EnterpriseLocationSuggestion = {
  placeId: "shrine",
  name: "Lolo Uweng Shrine",
  formattedAddress: "Lolo Uweng Shrine, Hernandez Street, San Pedro, Laguna",
  addressLine: "Lolo Uweng Shrine",
  latitude: 14.3504393,
  longitude: 121.0663555,
  barangay: "Landayan",
};

describe("filterRelatedLocationSuggestions", () => {
  it("keeps useful suggestions visible while the user continues a partial word", () => {
    expect(filterRelatedLocationSuggestions([shrine], "lolo u")).toEqual([shrine]);
    expect(filterRelatedLocationSuggestions([shrine], "lolo uw")).toEqual([shrine]);
  });

  it("removes stale suggestions when the query changes to an unrelated place", () => {
    expect(filterRelatedLocationSuggestions([shrine], "archie's event")).toEqual([]);
  });
});
