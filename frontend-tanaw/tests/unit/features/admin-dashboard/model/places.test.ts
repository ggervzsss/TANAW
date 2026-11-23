import { describe, expect, it } from "vitest";
import { filterPlaces, placeOptions } from "@/features/admin-dashboard/model/places";

const places = placeOptions([
  { id: "b", name: "San Pedro Plaza", barangay: "Poblacion" },
  { id: "a", name: "Lolo Uweng Church", barangay: "Landayan" },
]);

describe("peak occupancy places", () => {
  it("sorts enterprises A–Z and matches name or barangay", () => {
    expect(places.map(({ enterpriseId }) => enterpriseId)).toEqual(["a", "b"]);
    expect(filterPlaces(places, "landayan").map(({ name }) => name)).toEqual(["Lolo Uweng Church"]);
    expect(filterPlaces(places, "plaza pob")).toHaveLength(1);
    expect(filterPlaces(places, "  ")).toHaveLength(2);
    expect(filterPlaces(places, "zzz")).toEqual([]);
  });
});
