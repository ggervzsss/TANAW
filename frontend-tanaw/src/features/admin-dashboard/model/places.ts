import type { MapEnterprise } from "@/shared/types";

/* The places Peak Occupancy can show: all of San Pedro, or one enterprise. */

export type PlaceOption = { enterpriseId: string; name: string; barangay: string };

/** Enterprises A–Z. */
export function placeOptions(enterprises: readonly Pick<MapEnterprise, "id" | "name" | "barangay">[]): PlaceOption[] {
  return enterprises
    .map((enterprise) => ({ enterpriseId: enterprise.id, name: enterprise.name, barangay: enterprise.barangay || "Unassigned" }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Places whose name or barangay contains every word of the search. */
export function filterPlaces(places: readonly PlaceOption[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...places];
  return places.filter((place) => {
    const haystack = `${place.name} ${place.barangay} barangay`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
