/**
 * Lays the Overview's four work lists out in two columns that end close to level.
 *
 * Requests waiting for IT always opens the first column and Connection problems the second, so the
 * two lists that need IT now sit side by side. Accounts waiting and Emails that did not arrive go
 * under whichever column leaves the two closest in height. The connection problems list scrolls
 * inside itself, so its height stretches between a floor and its full length to take up what
 * difference is left.
 */

/** Which of the two lower lists sit under Requests; the rest sit under Connection problems. */
export type LowerPlacement = "none" | "accounts" | "emails" | "both";

export const LOWER_PLACEMENTS: readonly LowerPlacement[] = ["none", "accounts", "emails", "both"];

/** The four lists' heights in pixels, each with the air below it. */
export type SectionHeights = { requests: number; connections: number; accounts: number; emails: number };

/** The connection problems list when it scrolls: the heights it can take. */
export type FitList = {
  /** The section's height without the list: heading, description, air below. */
  chrome: number;
  /** The shortest the list may be: a few rows, or all of it when it is shorter. */
  min: number;
  /** The list at full length. */
  max: number;
};

export type ColumnPlan = {
  lower: LowerPlacement;
  /** The height to give the connection problems list, or null when it shows no list. */
  fit: number | null;
  /** How far apart the two columns end, in pixels. */
  gap: number;
};

/** A list cut shorter than its full length by less than this (under half a row) shows in full. */
export const FIT_SNAP = 64;

/** A new layout must beat the current one by this much, so lists do not hop between columns. */
export const COLUMN_STICKINESS = 24;

function planFor(heights: SectionHeights, list: FitList | null, lower: LowerPlacement) {
  const accountsLeft = lower === "accounts" || lower === "both";
  const emailsLeft = lower === "emails" || lower === "both";
  const left = heights.requests + (accountsLeft ? heights.accounts : 0) + (emailsLeft ? heights.emails : 0);
  const below = (accountsLeft ? 0 : heights.accounts) + (emailsLeft ? 0 : heights.emails);
  if (!list) {
    const right = heights.connections + below;
    return { lower, fit: null, gap: Math.abs(left - right), tallest: Math.max(left, right) };
  }
  const clamped = Math.min(Math.max(left - below - list.chrome, list.min), list.max);
  const fit = Math.round(list.max - clamped < FIT_SNAP ? list.max : clamped);
  const right = list.chrome + fit + below;
  return { lower, fit, gap: Math.abs(left - right), tallest: Math.max(left, right) };
}

/**
 * The layout that leaves the two columns closest to level; on a tie, the shorter page. `current`
 * is the layout in use: it stays unless another is clearly better.
 */
export function planColumns(heights: SectionHeights, list: FitList | null, current: LowerPlacement | null = null): ColumnPlan {
  const plans = LOWER_PLACEMENTS.map((lower) => planFor(heights, list, lower));
  const best = plans.reduce((winner, plan) => (plan.gap < winner.gap - 1 || (Math.abs(plan.gap - winner.gap) <= 1 && plan.tallest < winner.tallest) ? plan : winner));
  const kept = plans.find((plan) => plan.lower === current);
  const chosen = kept && kept.gap <= best.gap + COLUMN_STICKINESS ? kept : best;
  return { lower: chosen.lower, fit: chosen.fit, gap: chosen.gap };
}
