/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/cn.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 19626843dd4bb7b907e05107baa8023297c617ac65918c318db36071e5095191
 */
/** Joins class names, skipping empty values. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
