function time(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Sorts timestamps newest first; unreadable ones go last. */
export function compareDesc(left: string | null | undefined, right: string | null | undefined) {
  return time(right) - time(left);
}
