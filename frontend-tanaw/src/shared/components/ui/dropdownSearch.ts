export const DROPDOWN_SEARCH_MIN_OPTIONS = 8;

export function shouldShowDropdownSearch(searchable: boolean, optionCount: number) {
  return searchable && optionCount >= DROPDOWN_SEARCH_MIN_OPTIONS;
}
