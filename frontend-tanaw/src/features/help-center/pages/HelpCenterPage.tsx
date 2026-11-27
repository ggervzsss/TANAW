import {
  ArrowLeft,
  BookOpen,
  Building2,
  ChevronRight,
  Compass,
  FileText,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MapPinned,
  Search,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getRoleHelpPath } from "@/app/routers/roleRoutes";
import { Button } from "@/shared/ui-kit";
import type { UserRole } from "@/shared/types/role.types";
import { helpArticles } from "../data/articles";
import { articlesForRole, searchHelpArticles, type HelpArticle } from "../model/helpArticles";
import "../help-center.css";

const categoryIcons: Record<string, LucideIcon> = {
  "Account & Access": KeyRound,
  "Getting Started": Compass,
  "Map & Enterprises": MapPinned,
  Requests: LifeBuoy,
  Reports: FileText,
  Overview: LayoutDashboard,
  Enterprises: Building2,
  "LGU Personnel": Users,
  System: SlidersHorizontal,
};

const articleCount = (count: number) => `${count} ${count === 1 ? "article" : "articles"}`;

export function HelpCenterPage({ role }: { role: UserRole }) {
  const { articleId } = useParams();
  const roleArticles = useMemo(() => articlesForRole(helpArticles, role), [role]);
  const article = articleId ? roleArticles.find((candidate) => candidate.id === articleId) : undefined;
  if (articleId) return <HelpArticleView key={articleId} article={article} role={role} roleArticles={roleArticles} />;
  return <HelpCenterHome role={role} articles={roleArticles} />;
}

function HelpCenterHome({ role, articles }: { role: UserRole; articles: HelpArticle[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const searchTitleId = useId();
  const resultsTitleId = useId();
  const categories = useMemo(() => [...new Set(articles.map((article) => article.category))].sort(), [articles]);
  const results = useMemo(() => searchHelpArticles(articles, query).filter((result) => !category || result.article.category === category), [articles, category, query]);
  const isFiltering = Boolean(query.trim() || category);

  return (
    <div className="help-page">
      <header>
        <p className="help-kicker">Self-service support</p>
        <h1 className="help-title">Help Center</h1>
        <p className="help-lede">Find clear guidance for the TANAW workflows available to your account.</p>
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
        <CategoryList
          categories={categories}
          articles={articles}
          current={category}
          onSelect={(item) => {
            setQuery("");
            setCategory(item);
          }}
        />
        {isFiltering ? (
          <section className="help-main" aria-labelledby={resultsTitleId}>
            <div className="help-section-header">
              <div className="help-section-heading">
                <h2 id={resultsTitleId} className="help-section-title">
                  {category ? category : `Results for “${query.trim()}”`}
                </h2>
                <span className="help-section-count">{articleCount(results.length)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory(null);
                }}
                className="help-reset"
              >
                Reset
              </button>
            </div>
            {results.length > 0 ? (
              <ArticleList key={category ?? query.trim()}>
                {results.map(({ article, snippet }, index) => (
                  <ArticleRow key={article.id} index={index} article={article} snippet={snippet} role={role} showCategory={!category} />
                ))}
              </ArticleList>
            ) : (
              <div className="help-empty">
                <span className="help-empty-icon" aria-hidden="true">
                  <Search size={22} />
                </span>
                <h3 className="help-empty-title">No help articles found</h3>
                <p className="help-empty-text">Try a workflow name, feature label, or a shorter search.</p>
              </div>
            )}
          </section>
        ) : (
          <>
            <ArticleCollection title="Recommended for you" articles={articles.filter((article) => article.recommended).slice(0, 3)} role={role} />
            <ArticleCollection title="Common issues" articles={articles.filter((article) => article.commonIssue)} role={role} />
          </>
        )}
      </div>
    </div>
  );
}

function CategoryList({
  categories,
  articles,
  current,
  onSelect,
}: {
  categories: string[];
  articles: HelpArticle[];
  current: string | null;
  onSelect: (category: string) => void;
}) {
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
          const count = articles.filter((article) => article.category === item).length;
          return (
            <li key={item}>
              <button type="button" onClick={() => onSelect(item)} aria-current={item === current ? "true" : undefined} className="help-topic">
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

function ArticleCollection({ title, articles, role }: { title: string; articles: HelpArticle[]; role: UserRole }) {
  const titleId = useId();
  if (articles.length === 0) return null;
  return (
    <section className="help-main" aria-labelledby={titleId}>
      <div className="help-section-header">
        <h2 id={titleId} className="help-section-title">
          {title}
        </h2>
      </div>
      <ArticleList>
        {articles.map((article, index) => (
          <ArticleRow key={article.id} index={index} article={article} snippet={article.summary} role={role} />
        ))}
      </ArticleList>
    </section>
  );
}

function ArticleList({ children }: { children: ReactNode }) {
  return (
    <ul className="help-list" role="list">
      {children}
    </ul>
  );
}

function ArticleRow({ article, snippet, role, index, showCategory = true }: { article: HelpArticle; snippet: string; role: UserRole; index: number; showCategory?: boolean }) {
  return (
    <li style={{ "--help-row": index } as CSSProperties}>
      <Link to={`${getRoleHelpPath(role)}/${article.id}`} className="help-row">
        <span className="help-row-text">
          {showCategory && <span className="help-row-category">{article.category}</span>}
          <span className="help-row-title">{article.title}</span>
          <span className="help-row-snippet">{snippet}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="help-row-arrow" />
      </Link>
    </li>
  );
}

function HelpArticleView({ article, role, roleArticles }: { article?: HelpArticle; role: UserRole; roleArticles: HelpArticle[] }) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const basePath = getRoleHelpPath(role);

  if (!article) {
    return (
      <div className="help-page help-page--article">
        <header>
          <h1 className="help-title">Help Center</h1>
          <p className="help-lede">This article is not available for your account.</p>
        </header>
        <div className="help-empty help-empty--page">
          <span className="help-empty-icon" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          <h2 className="help-empty-title help-empty-title--page">Article not available</h2>
          <p className="help-empty-text">Return to Help Center to browse guidance for your role.</p>
          <Button className="help-empty-action" onClick={() => navigate(basePath)}>
            Back to Help Center
          </Button>
        </div>
      </div>
    );
  }

  const related = article.relatedArticleIds
    .map((id) => roleArticles.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is HelpArticle => Boolean(candidate));

  return (
    <div className="help-page help-page--article">
      <button type="button" onClick={() => navigate(basePath)} className="help-back">
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
            <section key={section.heading}>
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
        {article.supportPath && (
          <div className="help-support">
            <span className="help-support-icon" aria-hidden="true">
              <LifeBuoy size={20} />
            </span>
            <div className="help-support-text">
              <h2 className="help-support-title">Still need help?</h2>
              <p>Send a request to IT, or follow the ones already sent.</p>
            </div>
            <Link to={article.supportPath} state={{ returnTo: pathname + search + hash }} className="help-action">
              Open Requests
            </Link>
          </div>
        )}
      </article>
      {related.length > 0 && (
        <section className="help-related">
          <div className="help-section-header">
            <h2 className="help-section-title">Related articles</h2>
          </div>
          <ArticleList>
            {related.map((item, index) => (
              <ArticleRow key={item.id} index={index} article={item} snippet={item.summary} role={role} />
            ))}
          </ArticleList>
        </section>
      )}
    </div>
  );
}
