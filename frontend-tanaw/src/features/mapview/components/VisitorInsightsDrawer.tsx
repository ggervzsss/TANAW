import { Activity, BarChart3, Building2, CalendarDays, ChevronRight, Clock3, RefreshCw, TrendingDown, TrendingUp, Users, X } from "lucide-react";
import { motion } from "motion/react";
import type { KeyboardEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useVisitorInsights } from "@/app/hooks/useOperationalSync";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { VisitorInsightRange } from "@/shared/types";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

type VisitorInsightsDrawerProps = {
  range: VisitorInsightRange;
  enterpriseId?: string;
  barangay?: string;
  onRangeChange: (range: VisitorInsightRange) => void;
  onShowArea: () => void;
  onClose: () => void;
};

const rangeOptions: { value: VisitorInsightRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
];

export function VisitorInsightsDrawer({ range, enterpriseId, barangay, onRangeChange, onShowArea, onClose }: VisitorInsightsDrawerProps) {
  const { timeFormat } = useSystemDisplayPreferences();
  const insightsQuery = useVisitorInsights({ range, enterpriseId, barangay });
  const insights = insightsQuery.data;
  const comparisonTone = comparisonToneFor(insights?.differencePercent ?? null);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="tanaw-visitor-insights absolute top-4 right-4 bottom-4 z-430 flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden"
      aria-label="Visitor insights"
    >
      <header className="tanaw-visitor-insights__header flex shrink-0 items-start justify-between gap-4 px-5 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="tanaw-visitor-insights__title-icon grid size-10 shrink-0 place-items-center rounded-xl" aria-hidden="true">
            <BarChart3 size={19} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="tanaw-visitor-insights__eyebrow text-[11px] leading-tight font-bold tracking-[0.12em] uppercase">Visitor Insights</p>
            <h2 className="tanaw-visitor-insights__title mt-1 text-lg leading-tight font-black">{insights?.scopeName ?? "Loading visitor activity"}</h2>
            <p className="tanaw-visitor-insights__description mt-1.5 text-xs leading-relaxed font-semibold">Live levels compared with similar days and times</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close visitor insights"
          title="Close visitor insights"
          className="tanaw-visitor-insights__close grid size-10 shrink-0 place-items-center rounded-xl"
        >
          <X size={16} />
        </button>
      </header>

      <div className="tanaw-visitor-insights__scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <div className="tanaw-visitor-insights__segments grid grid-cols-3 gap-1.5 rounded-2xl p-1.5" role="tablist" aria-label="Visitor insight time range">
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={range === option.value}
              tabIndex={range === option.value ? 0 : -1}
              onClick={() => onRangeChange(option.value)}
              onKeyDown={(event) => handleRangeKeyDown(event, option.value, onRangeChange)}
              className="tanaw-visitor-insights__segment min-h-10 rounded-xl px-2 py-2 text-[11px] font-black tracking-[0.04em] uppercase"
            >
              {option.label}
            </button>
          ))}
        </div>

        {enterpriseId && (
          <button
            type="button"
            onClick={onShowArea}
            className="tanaw-visitor-insights__area-link mt-3 inline-flex min-h-10 items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-bold"
          >
            View the surrounding area instead
            <ChevronRight size={14} />
          </button>
        )}

        {insightsQuery.isLoading ? (
          <InsightsMessage icon={<RefreshCw size={18} className="animate-spin" />} title="Preparing visitor insights" message="Comparing the latest visitor levels with recent activity." />
        ) : insightsQuery.isError || !insights ? (
          <InsightsMessage
            icon={<BarChart3 size={18} />}
            title="Visitor insights are unavailable"
            message="The latest comparison could not be loaded."
            action={
              <button type="button" onClick={() => void insightsQuery.refetch()} className="mt-3 rounded-full bg-emerald-500 px-4 py-2 text-xs font-black text-emerald-950">
                Try Again
              </button>
            }
          />
        ) : (
          <>
            <section className="tanaw-visitor-insights__summary mt-4 grid grid-cols-2 gap-3" aria-label="Current visitor summary">
              <InsightMetric icon={<Users size={15} />} label="Visitors Right Now" value={insights.currentVisitors.toLocaleString()} />
              <InsightMetric icon={<Activity size={15} />} label="Usual Around This Time" value={insights.typicalVisitors === null ? "Learning" : insights.typicalVisitors.toLocaleString()} />
            </section>

            <section className={`tanaw-visitor-insights__comparison mt-3 rounded-2xl border p-4 ${comparisonTone.classes}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5">{comparisonTone.icon}</span>
                <div>
                  <p className="text-xs font-black tracking-[0.04em] uppercase">{comparisonHeading(insights.differencePercent)}</p>
                  <p className="mt-1.5 text-sm leading-relaxed font-semibold">{insights.comparisonMessage}</p>
                </div>
              </div>
            </section>

            <section className="tanaw-visitor-insights__section mt-4 rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="tanaw-visitor-insights__section-title flex items-center gap-2 text-[11px] font-black tracking-[0.08em] uppercase">
                    <CalendarDays size={15} /> Activity Pattern
                  </p>
                  <p className="tanaw-visitor-insights__muted mt-1 text-xs font-semibold">Average number of people present</p>
                </div>
                {insights.busiestPeriodLabel && (
                  <span className="tanaw-visitor-insights__peak rounded-full border px-2.5 py-1 text-[10px] font-black uppercase">Peak: {insights.busiestPeriodLabel}</span>
                )}
              </div>
              {insights.series.length > 0 ? (
                <div className="mt-4 h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insights.series} margin={{ top: 4, right: 2, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--tanaw-insights-grid)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--tanaw-insights-axis)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: "var(--tanaw-insights-axis)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "var(--tanaw-insights-chart-hover)" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid var(--tanaw-border-subtle)", background: "var(--tanaw-insights-tooltip)", color: "var(--tanaw-text)", fontSize: 12 }}
                        formatter={(value) => [Number(value).toLocaleString(), "Average visitors"]}
                      />
                      <Bar dataKey="averageVisitors" fill="#34d399" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="tanaw-visitor-insights__empty mt-4 rounded-xl border border-dashed p-5 text-center text-xs font-semibold">No visitor history is available for this period yet.</p>
              )}
            </section>

            <section className="mt-4 grid gap-3 sm:grid-cols-2">
              <InsightDetail
                icon={<Building2 size={14} />}
                label="Busiest Right Now"
                value={insights.busiestEnterprise?.enterpriseName ?? "No live data"}
                detail={insights.busiestEnterprise ? `${insights.busiestEnterprise.currentVisitors.toLocaleString()} visitors` : undefined}
              />
              <InsightDetail icon={<Clock3 size={14} />} label="Busiest Period" value={insights.busiestPeriodLabel ?? "Not available yet"} />
            </section>

            <section className="tanaw-visitor-insights__section mt-4 rounded-2xl border p-4">
              <p className="tanaw-visitor-insights__section-title text-[11px] font-black tracking-[0.08em] uppercase">Establishments Busier Than Usual</p>
              {insights.unusuallyBusy.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {insights.unusuallyBusy.map((enterprise) => (
                    <div key={enterprise.enterpriseId} className="tanaw-visitor-insights__busy-row rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="tanaw-visitor-insights__value text-sm font-black">{enterprise.enterpriseName}</p>
                          <p className="tanaw-visitor-insights__muted mt-1 text-[10px] font-bold tracking-wide uppercase">Barangay {enterprise.barangay}</p>
                        </div>
                        <span className="rounded-full bg-amber-300 px-2.5 py-1 text-[9px] font-black text-amber-950">+{enterprise.differencePercent ?? 0}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tanaw-visitor-insights__muted mt-3 text-xs leading-relaxed font-semibold">No establishment in this view is currently much busier than its usual level.</p>
              )}
            </section>

            <p className="tanaw-visitor-insights__updated mt-4 text-center text-[10px] font-semibold">
              {insights.lastUpdatedAt ? `Updated ${formatPhilippineDateTime(insights.lastUpdatedAt, timeFormat)}` : "Waiting for the first live update"}
            </p>
          </>
        )}
      </div>
    </motion.aside>
  );
}

function InsightMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="tanaw-visitor-insights__metric rounded-2xl border p-4">
      <div className="tanaw-visitor-insights__metric-label flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-black tracking-[0.08em] uppercase">{label}</p>
      </div>
      <p className="tanaw-visitor-insights__value mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function InsightDetail({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="tanaw-visitor-insights__metric rounded-2xl border p-4">
      <p className="tanaw-visitor-insights__metric-label flex items-center gap-2 text-[10px] font-black tracking-[0.08em] uppercase">
        <span>{icon}</span>
        {label}
      </p>
      <p className="tanaw-visitor-insights__value mt-2 text-sm font-black">{value}</p>
      {detail && <p className="tanaw-visitor-insights__muted mt-1 text-xs font-semibold">{detail}</p>}
    </div>
  );
}

function InsightsMessage({ icon, title, message, action }: { icon: React.ReactNode; title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="tanaw-visitor-insights__empty mt-4 flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center">
      <span className="tanaw-visitor-insights__accent">{icon}</span>
      <p className="tanaw-visitor-insights__value mt-3 text-sm font-black">{title}</p>
      <p className="tanaw-visitor-insights__muted mt-1 max-w-xs text-xs leading-relaxed font-semibold">{message}</p>
      {action}
    </div>
  );
}

function comparisonHeading(value: number | null) {
  if (value === null) return "Building a reliable comparison";
  if (value >= 20) return `${value}% busier than usual`;
  if (value <= -20) return `${Math.abs(value)}% quieter than usual`;
  return "Within the usual range";
}

function comparisonToneFor(value: number | null) {
  if (value !== null && value >= 20) return { classes: "tanaw-visitor-insights__comparison--busy", icon: <TrendingUp size={18} /> };
  if (value !== null && value <= -20) return { classes: "tanaw-visitor-insights__comparison--quiet", icon: <TrendingDown size={18} /> };
  return { classes: "tanaw-visitor-insights__comparison--learning", icon: <Activity size={18} /> };
}

function handleRangeKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentRange: VisitorInsightRange, onRangeChange: (range: VisitorInsightRange) => void) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();

  const currentIndex = rangeOptions.findIndex((option) => option.value === currentRange);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rangeOptions.length - 1 : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + rangeOptions.length) % rangeOptions.length;
  const nextRange = rangeOptions[nextIndex];
  if (!nextRange) return;

  onRangeChange(nextRange.value);
  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs?.[nextIndex]?.focus();
}
