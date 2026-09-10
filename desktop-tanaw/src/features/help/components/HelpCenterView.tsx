import { ArrowLeft, ArrowRight, BookOpen, LifeBuoy, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../../../components/Card";
import { routePaths } from "../../../app/router/routePaths";
import { helpArticles } from "../data/articles";
import { searchHelpArticles, type HelpArticle } from "../model/help-articles";

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
    <div className="animate-in fade-in mx-auto w-full max-w-300 space-y-7 pt-2 font-sans duration-500">
      <header><p className="mb-2 text-[11px] font-black tracking-[0.24em] text-[#b7952b] uppercase">Enterprise support</p><h2 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">Help Center</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-slate-300">Find clear guidance for Enterprise Desktop workflows.</p></header>
      <Card className="overflow-hidden rounded-[28px] border-emerald-800 bg-linear-to-br from-emerald-950 to-emerald-800 p-7 text-white dark:border-emerald-300/15 dark:from-[#071713] dark:to-[#0d3b2d]">
        <p className="text-xs font-black tracking-[0.2em] text-emerald-200 uppercase">Self-service support</p><h2 className="mt-2 text-2xl font-bold">How can we help?</h2>
        <div className="relative mt-5 max-w-3xl"><Search className="absolute top-1/2 left-4 -translate-y-1/2 text-emerald-700" size={20} /><input value={query} onChange={(event) => { setQuery(event.target.value); setCategory(null); }} type="search" aria-label="Search help articles" placeholder="Search help articles..." className="h-13 w-full rounded-2xl border border-white/30 bg-white pr-12 pl-12 text-base text-slate-950 shadow-lg outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-emerald-300/35" />{query && <button type="button" aria-label="Clear help search" onClick={() => setQuery("")} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={17} /></button>}</div>
      </Card>
      {filtering ? <section><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-bold text-slate-950 dark:text-white">{category ?? `Results for “${query.trim()}”`}</h2><button type="button" onClick={() => { setQuery(""); setCategory(null); }} className="text-sm font-bold text-emerald-700 underline underline-offset-4 dark:text-emerald-300">Reset</button></div>{results.length > 0 ? <div className="grid gap-3">{results.map(({ article, snippet }) => <ArticleCard key={article.id} article={article} snippet={snippet} onOpen={onOpen} />)}</div> : <EmptyHelp />}</section> : <><ArticleCollection title="Recommended for you" articles={helpArticles.filter((article) => article.recommended)} onOpen={onOpen} /><section><h2 className="mb-4 text-xl font-bold text-slate-950 dark:text-white">Categories</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className="flex min-h-24 items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left font-bold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 dark:border-white/10 dark:bg-white/5 dark:text-white"><span>{item}</span><ArrowRight size={17} className="text-emerald-700 dark:text-emerald-300" /></button>)}</div></section><ArticleCollection title="Common issues" articles={helpArticles.filter((article) => article.commonIssue)} onOpen={onOpen} /></>}
    </div>
  );
}

function ArticleCollection({ title, articles, onOpen }: { title: string; articles: HelpArticle[]; onOpen: (id: string) => void }) {
  return <section><h2 className="mb-4 text-xl font-bold text-slate-950 dark:text-white">{title}</h2><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{articles.map((article) => <ArticleCard key={article.id} article={article} snippet={article.summary} onOpen={onOpen} />)}</div></section>;
}

function ArticleCard({ article, snippet, onOpen }: { article: HelpArticle; snippet: string; onOpen: (id: string) => void }) {
  return <button type="button" onClick={() => onOpen(article.id)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:border-white/10 dark:bg-white/5"><span className="text-xs font-black tracking-wide text-emerald-700 uppercase dark:text-emerald-300">{article.category}</span><h3 className="mt-2 font-bold text-slate-950 group-hover:text-emerald-800 dark:text-white">{article.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">{snippet}</p></button>;
}

function EmptyHelp() {
  return <div className="flex min-h-55 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-white/10 dark:bg-white/5"><Search size={24} className="text-emerald-700 dark:text-emerald-300" /><h3 className="mt-3 font-bold text-slate-950 dark:text-white">No help articles found</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Try a workflow name, feature label, or shorter search.</p></div>;
}

function ArticleView({ article, onBack, onOpen }: { article?: HelpArticle; onBack: () => void; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  if (!article) return <div className="mx-auto max-w-3xl py-10 text-center"><BookOpen className="mx-auto text-emerald-700" /><h2 className="mt-3 text-xl font-bold text-slate-950 dark:text-white">Article not available</h2><button type="button" onClick={onBack} className="mt-5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">Back to Help Center</button></div>;
  const related = article.relatedArticleIds.map((id) => helpArticles.find((candidate) => candidate.id === id)).filter((candidate): candidate is HelpArticle => Boolean(candidate));
  return <div className="animate-in fade-in mx-auto w-full max-w-240 space-y-6 pt-2 font-sans duration-500"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:underline dark:text-emerald-300"><ArrowLeft size={16} /> Back to Help Center</button><Card className="overflow-hidden rounded-[28px] dark:border-white/10"><header className="border-b border-slate-200 p-6 sm:p-8 dark:border-white/10"><span className="text-xs font-black tracking-wide text-emerald-700 uppercase dark:text-emerald-300">{article.category}</span><h1 className="mt-2 text-2xl font-bold text-slate-950 dark:text-white">{article.title}</h1><p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">{article.summary}</p></header><div className="space-y-7 p-6 sm:p-8">{article.sections.map((section) => <section key={section.heading}><h2 className="text-lg font-bold text-slate-950 dark:text-white">{section.heading}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-2 leading-7 text-slate-600 dark:text-slate-300">{paragraph}</p>)}{section.steps && <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-600 marker:font-bold marker:text-emerald-700 dark:text-slate-300">{section.steps.map((step) => <li key={step} className="pl-1 leading-7">{step}</li>)}</ol>}</section>)}{article.supportView && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-300/20 dark:bg-emerald-400/10"><LifeBuoy size={20} className="text-emerald-700 dark:text-emerald-300" /><h2 className="mt-2 font-bold text-slate-950 dark:text-white">Still need help?</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create a Support Ticket or continue an existing conversation.</p><button type="button" onClick={() => navigate(routePaths.enterpriseTickets)} className="mt-4 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Open Support Tickets</button></div>}</div></Card>{related.length > 0 && <section><h2 className="mb-3 text-lg font-bold text-slate-950 dark:text-white">Related articles</h2><div className="grid gap-3 sm:grid-cols-2">{related.map((item) => <ArticleCard key={item.id} article={item} snippet={item.summary} onOpen={onOpen} />)}</div></section>}</div>;
}
