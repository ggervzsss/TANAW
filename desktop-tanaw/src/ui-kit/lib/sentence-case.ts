const ACRONYM_OR_MIXED_CASE = /[A-Z].*[A-Z]|[a-z].*[A-Z]/;

/**
 * Turns a status label into sentence case for badges: "In Review" becomes
 * "In review" and "running" becomes "Running". Acronyms and mixed-case words
 * ("ML", "LGU", "TANAW", "iOS") keep their capitals, and underscores in machine
 * values become spaces. Use it only on fixed labels, never on names people typed.
 */
export function toSentenceCase(label: string): string {
  const words = label.replace(/_/g, " ").trim().split(/(\s+)/);
  return words
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return ACRONYM_OR_MIXED_CASE.test(word) ? word : word.toLowerCase();
    })
    .join("");
}
