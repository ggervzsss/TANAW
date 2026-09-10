export type HelpArticleSection = { heading: string; paragraphs?: string[]; steps?: string[] };

export type HelpArticle = {
  id: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  sections: HelpArticleSection[];
  relatedArticleIds: string[];
  recommended?: boolean;
  commonIssue?: boolean;
  supportView?: "tickets";
};

export type HelpSearchResult = { article: HelpArticle; score: number; snippet: string };

export function searchHelpArticles(articles: HelpArticle[], query: string): HelpSearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return articles.map((article) => ({ article, score: 0, snippet: article.summary }));
  return articles
    .map((article) => {
      const fields = {
        title: normalize(article.title),
        keywords: normalize(article.keywords.join(" ")),
        summary: normalize(article.summary),
        category: normalize(article.category),
        body: normalize(article.sections.flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.steps ?? [])]).join(" ")),
      };
      const score = terms.reduce((total, term) => total + (fields.title.includes(term) ? 100 : fields.keywords.includes(term) ? 65 : fields.summary.includes(term) ? 35 : fields.category.includes(term) ? 20 : fields.body.includes(term) ? 10 : 0), 0);
      const matchesAllTerms = terms.every((term) => Object.values(fields).some((field) => field.includes(term)));
      return { article, score: matchesAllTerms ? score : 0, snippet: findSnippet(article, terms) };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title));
}

function findSnippet(article: HelpArticle, terms: string[]) {
  const candidates = [article.summary, ...article.sections.flatMap((section) => [...(section.paragraphs ?? []), ...(section.steps ?? [])])];
  return candidates.find((candidate) => terms.some((term) => normalize(candidate).includes(term))) ?? article.summary;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD");
}
