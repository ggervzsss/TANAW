import { ArrowLeft, ArrowRight, BookOpen, LifeBuoy, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getRoleHelpPath } from "@/app/routers/roleRoutes";
import { PageHeader } from "@/shared/components/layout";
import { Panel } from "@/shared/components/panel";
import { EmptyState, PageMotion } from "@/shared/components/ui";
import type { UserRole } from "@/shared/types/role.types";
import { helpArticles } from "../data/articles";
import { articlesForRole, searchHelpArticles, type HelpArticle } from "../model/helpArticles";

export function HelpCenterPage({ role }: { role: UserRole }) {
  const { articleId } = useParams();
  const roleArticles = useMemo(() => articlesForRole(helpArticles, role), [role]);
  const article = articleId ? roleArticles.find((candidate) => candidate.id === articleId) : undefined;
  if (articleId) return <HelpArticleView article={article} role={role} roleArticles={roleArticles} />;
  return <HelpCenterHome role={role} articles={roleArticles} />;
}

function HelpCenterHome({ role, articles }: { role: UserRole; articles: HelpArticle[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = [...new Set(articles.map((article) => article.category))].sort();
  const results = useMemo(() => searchHelpArticles(articles, query).filter((result) => !category || result.article.category === category), [articles, category, query]);
  const isFiltering = Boolean(query.trim() || category);

  return (
    <PageMotion>
      <PageHeader title="Help Center" description="Find clear guidance for the TANAW workflows available to your account." />
      <div className="mx-auto max-w-6xl space-y-7">
        <Panel className="overflow-hidden bg-linear-to-br from-emerald-950 to-emerald-800 p-7 text-white dark:from-[#071713] dark:to-[#0d3b2d]">
          <p className="text-xs font-black tracking-[0.2em] text-emerald-200 uppercase">Self-service support</p>
          <h2 className="mt-2 text-2xl font-bold">How can we help?</h2>
          <div className="relative mt-5 max-w-3xl">
            <Search className="absolute top-1/2 left-4 -translate-y-1/2 text-emerald-700" size={20} aria-hidden="true" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setCategory(null); }} type="search" aria-label="Search help articles" placeholder="Search help articles..." className="h-13 w-full rounded-2xl border border-white/30 bg-white pr-12 pl-12 text-base text-slate-950 shadow-lg outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-emerald-300/35" />
            {query && <button type="button" aria-label="Clear help search" onClick={() => setQuery("")} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={17} /></button>}
          </div>
        </Panel>

        {isFiltering ? (
          <section aria-labelledby="help-results-heading">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="help-results-heading" className="text-xl font-bold text-slate-950 dark:text-white">{category ? category : `Results for “${query.trim()}”`}</h2><button type="button" onClick={() => { setQuery(""); setCategory(null); }} className="text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300">Reset</button></div>
            {results.length > 0 ? <div className="grid gap-3">{results.map(({ article, snippet }) => <ArticleResult key={article.id} article={article} snippet={snippet} role={role} />)}</div> : <EmptyState icon={Search} title="No help articles found" description="Try a workflow name, feature label, or a shorter search." />}
          </section>
        ) : (
          <>
            <ArticleCollection title="Recommended for you" articles={articles.filter((article) => article.recommended).slice(0, 3)} role={role} />
            <section aria-labelledby="help-categories-heading"><h2 id="help-categories-heading" className="mb-4 text-xl font-bold text-slate-950 dark:text-white">Categories</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className="flex min-h-24 items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left font-bold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:text-white"><span>{item}</span><ArrowRight size={17} className="text-emerald-700 dark:text-emerald-300" /></button>)}</div></section>
            <ArticleCollection title="Common issues" articles={articles.filter((article) => article.commonIssue)} role={role} />
          </>
        )}
      </div>
    </PageMotion>
  );
}

function ArticleCollection({ title, articles, role }: { title: string; articles: HelpArticle[]; role: UserRole }) {
  if (articles.length === 0) return null;
  return <section><h2 className="mb-4 text-xl font-bold text-slate-950 dark:text-white">{title}</h2><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{articles.map((article) => <ArticleResult key={article.id} article={article} snippet={article.summary} role={role} />)}</div></section>;
}

function ArticleResult({ article, snippet, role }: { article: HelpArticle; snippet: string; role: UserRole }) {
  return <Link to={`${getRoleHelpPath(role)}/${article.id}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:border-white/10 dark:bg-white/5"><span className="text-xs font-black tracking-wide text-emerald-700 uppercase dark:text-emerald-300">{article.category}</span><h3 className="mt-2 font-bold text-slate-950 group-hover:text-emerald-800 dark:text-white dark:group-hover:text-emerald-200">{article.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">{snippet}</p></Link>;
}

function HelpArticleView({ article, role, roleArticles }: { article?: HelpArticle; role: UserRole; roleArticles: HelpArticle[] }) {
  const navigate = useNavigate();
  const basePath = getRoleHelpPath(role);
  if (!article) return <PageMotion><PageHeader title="Help Center" description="This article is not available for your account." /><EmptyState icon={BookOpen} title="Article not available" description="Return to Help Center to browse guidance for your role." action={<button type="button" onClick={() => navigate(basePath)} className="bg-tanaw-green rounded-xl px-4 py-2.5 text-sm font-bold text-white">Back to Help Center</button>} /></PageMotion>;
  const related = article.relatedArticleIds.map((id) => roleArticles.find((candidate) => candidate.id === id)).filter((candidate): candidate is HelpArticle => Boolean(candidate));
  return <PageMotion><PageHeader title="Help Center" description={article.category} /><article className="mx-auto max-w-4xl"><button type="button" onClick={() => navigate(basePath)} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:underline dark:text-emerald-300"><ArrowLeft size={16} /> Back to Help Center</button><Panel className="overflow-hidden"><header className="border-b border-slate-200 p-6 sm:p-8 dark:border-white/10"><span className="text-xs font-black tracking-wide text-emerald-700 uppercase dark:text-emerald-300">{article.category}</span><h2 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{article.title}</h2><p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{article.summary}</p></header><div className="space-y-7 p-6 sm:p-8">{article.sections.map((section) => <section key={section.heading}><h2 className="text-lg font-bold text-slate-950 dark:text-white">{section.heading}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-2 leading-7 text-slate-600 dark:text-slate-300">{paragraph}</p>)}{section.steps && <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-600 marker:font-bold marker:text-emerald-700 dark:text-slate-300 dark:marker:text-emerald-300">{section.steps.map((step) => <li key={step} className="pl-1 leading-7">{step}</li>)}</ol>}</section>)}{article.supportPath && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-300/20 dark:bg-emerald-400/10"><LifeBuoy size={20} className="text-emerald-700 dark:text-emerald-300" /><h2 className="mt-2 font-bold text-slate-950 dark:text-white">Still need help?</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Open Support Tickets to continue with the current TANAW support workflow.</p><Link to={article.supportPath} className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Open Support Tickets</Link></div>}</div></Panel>{related.length > 0 && <div className="mt-7"><h2 className="mb-3 text-lg font-bold text-slate-950 dark:text-white">Related articles</h2><div className="grid gap-3 sm:grid-cols-2">{related.map((item) => <ArticleResult key={item.id} article={item} snippet={item.summary} role={role} />)}</div></div>}</article></PageMotion>;
}
