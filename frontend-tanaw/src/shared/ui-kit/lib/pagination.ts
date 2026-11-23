/** Page numbers to show: all of them up to seven, otherwise the ends and a window around the current page. */
export function visiblePages(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...pages].sort((left, right) => left - right);
  return sorted.flatMap((value, index) => (index > 0 && value - sorted[index - 1] > 1 ? (["gap", value] as const) : [value]));
}
