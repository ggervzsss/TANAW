import { ArrowLeft, ArrowRight, BookOpen, LifeBuoy, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../../../components/Card";
import { routePaths } from "../../../app/router/routePaths";
import { Button } from "../../../ui-kit";
import { helpArticles } from "../data/articles";
import { searchHelpArticles, type HelpArticle } from "../model/help-articles";

const sectionTitle = "mb-4 font-display text-lg leading-tight font-bold text-(--tanaw-text)";
const eyebrow = "text-xs font-semibold tracking-label uppercase";
const tile =
  "rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface) text-left shadow-tanaw-resting transition-[border-color,box-shadow,translate,scale] duration-200 ease-tanaw-out hover:-translate-y-px hover:border-(--tanaw-interactive-hover-border) hover:shadow-tanaw-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

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
  const categories = [...new Set(helpArticles.map((article) => article.category))].sort();
  const results = useMemo(() => searchHelpArticles(helpArticles, query).filter((result) => !category || result.article.category === category), [category, query]);
  const filtering = Boolean(query.trim() || category);
  return (
    <div className="animate-in fade-in mx-auto w-full max-w-300 space-y-8 pt-1 font-sans">
      <header>
        <p className={`mb-2 ${eyebrow} text-(--tanaw-gold-ink)`}>Enterprise support</p>
        <h2 className="font-display text-2xl leading-tight font-bold text-(--tanaw-text)">Help Center</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-(--tanaw-text-secondary)">Find clear guidance for Enterprise Desktop workflows.</p>
      </header>

      <Card className="help-center-hero overflow-hidden rounded-tanaw-2xl p-7 max-sm:p-5">
        <p className={`${eyebrow} text-(--tanaw-accent-ink)`}>Self-service support</p>
        <h2 className="mt-2 font-display text-2xl leading-tight font-bold text-(--tanaw-text)">How can we help?</h2>
        <div className="relative mt-5 max-w-3xl">
          <Search className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-(--tanaw-text-muted)" size={19} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCategory(null);
            }}
            type="search"
            aria-label="Search help articles"
            placeholder="Search help articles..."
            className="h-12 w-full rounded-tanaw-lg border border-(--tanaw-control-border) bg-(--tanaw-control-bg) pr-12 pl-12 text-base text-(--tanaw-text) shadow-tanaw-resting transition-[border-color,box-shadow] duration-150 ease-tanaw-out outline-none placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear help search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-colors duration-150 hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </Card>

      {filtering ? (
        <section className="tanaw-enter">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg leading-tight font-bold text-(--tanaw-text)">{category ?? `Results for “${query.trim()}”`}</h2>
            <Button
              variant="link"
              onClick={() => {
                setQuery("");
                setCategory(null);
              }}
            >
              Reset
            </Button>
          </div>
          {results.length > 0 ? (
            <div className="tanaw-stagger grid gap-3">
              {results.map(({ article, snippet }) => (
                <ArticleCard key={article.id} article={article} snippet={snippet} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <EmptyHelp />
          )}
        </section>
      ) : (
        <>
          <ArticleCollection title="Recommended for you" articles={helpArticles.filter((article) => article.recommended)} onOpen={onOpen} />
          <section>
            <h2 className={sectionTitle}>Categories</h2>
            <div className="tanaw-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((item) => (
                <button key={item} type="button" onClick={() => setCategory(item)} className={`group flex min-h-20 items-center justify-between gap-3 p-5 text-[0.9375rem] font-semibold text-(--tanaw-text) ${tile}`}>
                  <span>{item}</span>
                  <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-(--tanaw-accent-ink) transition-transform duration-200 ease-tanaw-out group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </button>
              ))}
            </div>
          </section>
          <ArticleCollection title="Common issues" articles={helpArticles.filter((article) => article.commonIssue)} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

function ArticleCollection({ title, articles, onOpen }: { title: string; articles: HelpArticle[]; onOpen: (id: string) => void }) {
  return (
    <section>
      <h2 className={sectionTitle}>{title}</h2>
      <div className="tanaw-stagger grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} snippet={article.summary} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function ArticleCard({ article, snippet, onOpen }: { article: HelpArticle; snippet: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(article.id)} className={`group p-5 ${tile}`}>
      <span className={`${eyebrow} text-(--tanaw-accent-ink)`}>{article.category}</span>
      <h3 className="mt-2 text-base leading-snug font-semibold text-(--tanaw-text) transition-colors duration-150 group-hover:text-(--tanaw-accent-ink)">{article.title}</h3>
      <p className="mt-2 text-sm leading-6 text-(--tanaw-text-secondary)">{snippet}</p>
    </button>
  );
}

function EmptyHelp() {
  return (
    <div className="flex min-h-55 flex-col items-center justify-center rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-tanaw-lg bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">
        <Search size={22} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-(--tanaw-text)">No help articles found</h3>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Try a workflow name, feature label, or shorter search.</p>
    </div>
  );
}

function ArticleView({ article, onBack, onOpen }: { article?: HelpArticle; onBack: () => void; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  if (!article) {
    return (
      <div className="tanaw-enter mx-auto max-w-3xl py-12 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-tanaw-lg bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">
          <BookOpen size={22} aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-xl font-bold text-(--tanaw-text)">Article not available</h2>
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">It may have moved. Search the Help Center for the topic instead.</p>
        <Button className="mt-5" onClick={onBack}>
          Back to Help Center
        </Button>
      </div>
    );
  }
  const related = article.relatedArticleIds.map((id) => helpArticles.find((candidate) => candidate.id === id)).filter((candidate): candidate is HelpArticle => Boolean(candidate));
  return (
    <div className="animate-in fade-in mx-auto w-full max-w-240 space-y-6 pt-1 font-sans">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center gap-2 rounded-tanaw-sm px-1 py-1 text-sm font-semibold text-(--tanaw-accent-ink) hover:underline focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
      >
        <ArrowLeft size={16} aria-hidden="true" className="transition-transform duration-150 ease-tanaw-out group-hover:-translate-x-0.5 motion-reduce:transition-none" /> Back to Help Center
      </button>
      <Card className="overflow-hidden rounded-tanaw-xl">
        <header className="border-b border-(--tanaw-border-soft) p-8 max-sm:p-6">
          <span className={`${eyebrow} text-(--tanaw-accent-ink)`}>{article.category}</span>
          <h1 className="mt-2 font-display text-2xl leading-tight font-bold text-(--tanaw-text)">{article.title}</h1>
          <p className="mt-3 text-base leading-7 text-(--tanaw-text-secondary)">{article.summary}</p>
        </header>
        <div className="space-y-8 p-8 max-sm:p-6">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-lg font-bold text-(--tanaw-text)">{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-2 text-[0.9375rem] leading-7 text-(--tanaw-text-secondary)">
                  {paragraph}
                </p>
              ))}
              {section.steps && (
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-[0.9375rem] text-(--tanaw-text-secondary) marker:font-semibold marker:text-(--tanaw-accent-ink)">
                  {section.steps.map((step) => (
                    <li key={step} className="pl-1 leading-7">
                      {step}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
          {article.supportView && (
            <div className="rounded-tanaw-lg border border-(--tanaw-success-line) bg-(--tanaw-success-surface) p-5">
              <LifeBuoy size={20} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
              <h2 className="mt-2 font-display text-base font-bold text-(--tanaw-text)">Still need help?</h2>
              <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Send IT a request, or continue one you already sent.</p>
              <Button className="mt-4" onClick={() => navigate(routePaths.enterpriseTickets, { state: { returnTo: pathname + search + hash } })}>
                Open Requests
              </Button>
            </div>
          )}
        </div>
      </Card>
      {related.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold text-(--tanaw-text)">Related articles</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((item) => (
              <ArticleCard key={item.id} article={item} snippet={item.summary} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
