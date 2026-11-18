/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/dropdown.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: bedb249202f8d4bd99421d59d62a7a5fa5b77b7be1269cd55f3ac7c566646395
 */
/** Lists shorter than this never show a search field, even when searchable. */
export const DROPDOWN_SEARCH_MIN_OPTIONS = 8;

export type DropdownKey = "ArrowDown" | "ArrowUp" | "End" | "Home";

export function getNextDropdownIndex(currentIndex: number, optionCount: number, key: DropdownKey): number {
  if (optionCount <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, optionCount - 1);
  return Math.max(currentIndex - 1, 0);
}

export function shouldShowDropdownSearch(searchable: boolean, optionCount: number, minimumOptions = DROPDOWN_SEARCH_MIN_OPTIONS): boolean {
  return searchable && optionCount >= minimumOptions;
}
