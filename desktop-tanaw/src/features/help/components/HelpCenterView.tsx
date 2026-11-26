import { ArrowLeft, BookOpen, Camera, ChevronRight, Compass, FileText, KeyRound, LifeBuoy, Search, Wrench, X, type LucideIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { routePaths } from "../../../app/router/routePaths";
import { Button } from "../../../ui-kit";
import { helpArticles } from "../data/articles";
import { searchHelpArticles, type HelpArticle } from "../model/help-articles";
import "../help-center.css";

const categoryIcons: Record<string, LucideIcon> = {
  "Account & Access": KeyRound,
  "Cameras & Monitoring": Camera,
  "Getting Started": Compass,
  Reports: FileText,
  Troubleshooting: Wrench,
};

const articleCount = (count: number) => `${count} ${count === 1 ? "article" : "articles"}`;

export function HelpCenterView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const articleId = searchParams.get("article");
  const article = articleId ? helpArticles.find((candidate) => candidate.id === articleId) : undefined;
  if (articleId) return <ArticleView article={article} onBack={() => setSearchParams({})} onOpen={(id) => setSearchParams({ article: id })} />;
  return <HelpHome onOpen={(id) => setSearchParams({ article: id })} />;
}

function HelpHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const searchTitleId = useId();
  const categories = useMemo(() => [...new Set(helpArticles.map((article) => article.category))].sort(), []);
  const results = useMemo(() => searchHelpArticles(helpArticles, query).filter((result) => !category || result.article.category === category), [category, query]);
  const filtering = Boolean(query.trim() || category);
  const reset = () => {
    setQuery("");
    setCategory(null);
  };

  const topics = (
    <CategoryList
      categories={categories}
      current={category}
      onSelect={(item) => {
        setQuery("");
        setCategory(item);
      }}
    />
  );

  return (
    <div className="help-page tanaw-enter">
      <header className="help-header">
        <p className="help-kicker">Enterprise support</p>
        <h2 className="help-title">Help Center</h2>
        <p className="help-lede">Find clear guidance for Enterprise Desktop workflows.</p>
      </header>

      <section className="help-search" aria-labelledby={searchTitleId}>
        <h2 id={searchTitleId} className="help-search-title">
          How can we help?
        </h2>
        <div className="help-search-field">
          <Search className="help-search-icon" size={19} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCategory(null);
            }}
            type="search"
            aria-label="Search help articles"
            placeholder="Search help articles..."
            className="help-search-input"
          />
          {query && (
            <button type="button" aria-label="Clear help search" onClick={() => setQuery("")} className="help-search-clear">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      <div className="help-layout">
        {filtering ? (
          <>
            {topics}
            <section className="help-main tanaw-enter" key={category ?? "search"}>
              <div className="help-section-header">
                <div className="help-section-heading">
                  <h2 className="help-section-title">{category ?? `Results for “${query.trim()}”`}</h2>
                  <span className="help-section-count">{articleCount(results.length)}</span>
                </div>
                <Button variant="link" onClick={reset}>
                  Reset
                </Button>
              </div>
              {results.length > 0 ? (
                <ArticleList>
                  {results.map(({ article, snippet }) => (
                    <ArticleRow key={article.id} article={article} snippet={snippet} showCategory={!category} onOpen={onOpen} />
                  ))}
                </ArticleList>
              ) : (
                <EmptyHelp />
              )}
            </section>
          </>
        ) : (
          <>
            {topics}
            <ArticleCollection title="Recommended for you" articles={helpArticles.filter((article) => article.recommended)} onOpen={onOpen} />
            <ArticleCollection title="Common issues" articles={helpArticles.filter((article) => article.commonIssue)} onOpen={onOpen} />
          </>
        )}
      </div>
    </div>
  );
}

function CategoryList({ categories, current, onSelect }: { categories: string[]; current: string | null; onSelect: (category: string) => void }) {
  const titleId = useId();
  return (
    <section className="help-aside" aria-labelledby={titleId}>
      <div className="help-section-header">
        <h2 id={titleId} className="help-section-title">
          Categories
        </h2>
      </div>
      <ul className="help-topics" role="list">
        {categories.map((item) => {
          const Icon = categoryIcons[item] ?? BookOpen;
          const count = helpArticles.filter((article) => article.category === item).length;
          const active = item === current;
          return (
            <li key={item}>
              <button type="button" onClick={() => onSelect(item)} aria-current={active ? "true" : undefined} className="help-topic">
                <span className="help-topic-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="help-topic-label">{item}</span>
                <span className="help-topic-count" aria-hidden="true">
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ArticleCollection({ title, articles, onOpen }: { title: string; articles: HelpArticle[]; onOpen: (id: string) => void }) {
  return (
    <section className="help-main">
      <div className="help-section-header">
        <h2 className="help-section-title">{title}</h2>
      </div>
      <ArticleList>
        {articles.map((article) => (
          <ArticleRow key={article.id} article={article} snippet={article.summary} onOpen={onOpen} />
        ))}
      </ArticleList>
    </section>
  );
}

function ArticleList({ children }: { children: ReactNode }) {
  return (
    <ul className="help-list tanaw-stagger" role="list">
      {children}
    </ul>
  );
}

function ArticleRow({ article, snippet, showCategory = true, onOpen }: { article: HelpArticle; snippet: string; showCategory?: boolean; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(article.id)} className="help-row">
        <span className="help-row-text">
          {showCategory && <span className="help-row-category">{article.category}</span>}
          <span className="help-row-title">{article.title}</span>
          <span className="help-row-snippet">{snippet}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="help-row-arrow" />
      </button>
    </li>
  );
}

function EmptyHelp() {
  return (
    <div className="help-empty">
      <span className="help-empty-icon">
        <Search size={22} aria-hidden="true" />
      </span>
      <h3 className="help-empty-title">No help articles found</h3>
      <p className="help-empty-text">Try a workflow name, feature label, or shorter search.</p>
    </div>
  );
}

function ArticleView({ article, onBack, onOpen }: { article?: HelpArticle; onBack: () => void; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  if (!article) {
    return (
      <div className="help-page help-page--article tanaw-enter">
        <div className="help-empty help-empty--page">
          <span className="help-empty-icon">
            <BookOpen size={22} aria-hidden="true" />
          </span>
          <h2 className="help-empty-title help-empty-title--page">Article not available</h2>
          <p className="help-empty-text">It may have moved. Search the Help Center for the topic instead.</p>
          <Button className="mt-6" onClick={onBack}>
            Back to Help Center
          </Button>
        </div>
      </div>
    );
  }
  const related = article.relatedArticleIds.map((id) => helpArticles.find((candidate) => candidate.id === id)).filter((candidate): candidate is HelpArticle => Boolean(candidate));
  return (
    <div className="help-page help-page--article tanaw-enter" key={article.id}>
      <button type="button" onClick={onBack} className="help-back">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Help Center
      </button>
      <article>
        <header className="help-article-header">
          <p className="help-kicker">{article.category}</p>
          <h1 className="help-title">{article.title}</h1>
          <p className="help-lede help-lede--article">{article.summary}</p>
        </header>
        <div className="help-article-body">
          {article.sections.map((section) => (
            <section key={section.heading} className="help-article-section">
              <h2 className="help-article-heading">{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="help-article-paragraph">
                  {paragraph}
                </p>
              ))}
              {section.steps && (
                <ol className="help-steps">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
        {article.supportView && (
          <div className="help-support">
            <span className="help-support-icon">
              <LifeBuoy size={20} aria-hidden="true" />
            </span>
            <div className="help-support-text">
              <h2 className="help-support-title">Still need help?</h2>
              <p>Send IT a request, or continue one you already sent.</p>
            </div>
            <Button onClick={() => navigate(routePaths.enterpriseTickets, { state: { returnTo: pathname + search + hash } })}>
              Open Requests
            </Button>
          </div>
        )}
      </article>
      {related.length > 0 && (
        <section className="help-related">
          <div className="help-section-header">
            <h2 className="help-section-title">Related articles</h2>
          </div>
          <ArticleList>
            {related.map((item) => (
              <ArticleRow key={item.id} article={item} snippet={item.summary} onOpen={onOpen} />
            ))}
          </ArticleList>
        </section>
      )}
    </div>
  );
}
