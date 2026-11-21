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
