import type { EnterpriseLocationSuggestion } from "../types";

export function filterRelatedLocationSuggestions(suggestions: readonly EnterpriseLocationSuggestion[], query: string) {
  const queryTokens = searchTokens(query);
  if (queryTokens.length === 0) return [];

  return suggestions.filter((suggestion) => {
    const candidateTokens = searchTokens(`${suggestion.name} ${suggestion.formattedAddress}`);
    return queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)));
  });
}

function searchTokens(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/['’]s\b/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}
