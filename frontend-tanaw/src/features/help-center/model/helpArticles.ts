import type { UserRole } from "@/shared/types/role.types";

export type HelpArticleSection = {
  heading: string;
  paragraphs?: string[];
  steps?: string[];
};

export type HelpArticle = {
  id: string;
  title: string;
  summary: string;
  roles: UserRole[];
  category: string;
  keywords: string[];
  sections: HelpArticleSection[];
  relatedArticleIds: string[];
  recommended?: boolean;
  commonIssue?: boolean;
  supportPath?: string;
};

export type HelpSearchResult = { article: HelpArticle; score: number; snippet: string };

export function articlesForRole(articles: HelpArticle[], role: UserRole) {
  return articles.filter((article) => article.roles.includes(role));
}

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
      const score = terms.reduce((total, term) => {
        if (fields.title === term) return total + 140;
        if (fields.title.includes(term)) return total + 100;
        if (fields.keywords.includes(term)) return total + 65;
        if (fields.summary.includes(term)) return total + 35;
        if (fields.category.includes(term)) return total + 20;
        if (fields.body.includes(term)) return total + 10;
        return total;
      }, 0);
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
