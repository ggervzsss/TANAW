/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/overflow.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: f7b5c99e2783054cb11494b99a0aab6b4bd48415033d3686aea0cfc43a50f26c
 */
type OverflowMetrics = Pick<HTMLElement, "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth">;

export function hasVisualOverflow(metrics: OverflowMetrics, multiline = false) {
  const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
  const verticalOverflow = multiline && metrics.scrollHeight > metrics.clientHeight + 1;
  return horizontalOverflow || verticalOverflow;
}
