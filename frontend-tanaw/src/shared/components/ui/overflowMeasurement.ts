type OverflowMetrics = Pick<HTMLElement, "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth">;

export function hasVisualOverflow(metrics: OverflowMetrics, multiline = false) {
  const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
  const verticalOverflow = multiline && metrics.scrollHeight > metrics.clientHeight + 1;
  return horizontalOverflow || verticalOverflow;
}
