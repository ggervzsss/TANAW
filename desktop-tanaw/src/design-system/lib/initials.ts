/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/initials.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: ac257ea4665a26240f60227ce805d9bc1a29e8c378d42af6fc54e2c7d769a44d
 */
/** The first letters of up to two words, upper-cased: "LGU Staff" becomes "LS". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}
