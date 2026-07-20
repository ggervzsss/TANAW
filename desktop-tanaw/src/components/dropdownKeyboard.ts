export function getNextDropdownIndex(currentIndex: number, optionCount: number, key: "ArrowDown" | "ArrowUp" | "End" | "Home") {
  if (optionCount <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, optionCount - 1);
  return Math.max(currentIndex - 1, 0);
}
