import { AlertTriangle, CircleAlert } from "lucide-react";
import {
  type PropsWithChildren,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  PersistentIssueContext,
  type PersistentIssue,
} from "../services/persistent-issue";

export function PersistentIssueProvider({ children }: PropsWithChildren) {
  const [issues, setIssues] = useState<PersistentIssue[]>([]);

  const upsertIssue = useCallback((issue: PersistentIssue) => {
    setIssues((current) => {
      const existingIndex = current.findIndex((candidate) => candidate.id === issue.id);
      if (existingIndex === -1) return [...current, issue];
      if (sameIssue(current[existingIndex], issue)) return current;

      const next = [...current];
      next[existingIndex] = issue;
      return next;
    });
  }, []);

  const removeIssue = useCallback((id: string) => {
    setIssues((current) => {
      const next = current.filter((issue) => issue.id !== id);
      return next.length === current.length ? current : next;
    });
  }, []);

  const value = useMemo(() => ({ removeIssue, upsertIssue }), [removeIssue, upsertIssue]);

  return (
    <PersistentIssueContext.Provider value={value}>
      {children}
      <PersistentIssueViewport issues={issues} />
    </PersistentIssueContext.Provider>
  );
}

export function PersistentIssueViewport({ issues }: { issues: PersistentIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-3000 flex max-h-[calc(100vh-var(--tanaw-topbar-height)-2rem)] w-[min(360px,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto"
      aria-label="Current system issues"
    >
      {issues.map((issue) => (
        <PersistentIssueNotice key={issue.id} issue={issue} />
      ))}
    </div>
  );
}

export function PersistentIssueNotice({ issue }: { issue: PersistentIssue }) {
  const isError = issue.tone === "error";
  const Icon = isError ? CircleAlert : AlertTriangle;

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`animate-in slide-in-from-right-5 fade-in flex items-start gap-3 rounded-xl border border-l-4 bg-white/97 px-3.5 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.22)] backdrop-blur dark:bg-slate-900/97 ${
        isError
          ? "border-red-200 border-l-red-600 text-red-950 dark:border-red-400/25 dark:border-l-red-400 dark:text-red-100"
          : "border-amber-200 border-l-amber-500 text-amber-950 dark:border-amber-300/25 dark:border-l-amber-300 dark:text-amber-100"
      }`}
    >
      <Icon
        size={18}
        className={`mt-0.5 shrink-0 ${isError ? "text-red-600 dark:text-red-300" : "text-amber-600 dark:text-amber-300"}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-[11px] leading-tight font-black tracking-wide uppercase">{issue.title}</p>
        <p className="mt-1 text-xs leading-relaxed font-semibold opacity-85">{issue.message}</p>
      </div>
    </div>
  );
}

function sameIssue(left: PersistentIssue, right: PersistentIssue) {
  return (
    left.id === right.id &&
    left.message === right.message &&
    left.title === right.title &&
    left.tone === right.tone
  );
}
