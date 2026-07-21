import { Activity, BarChart3, Building2, CalendarDays, ChevronRight, Clock3, RefreshCw, TrendingDown, TrendingUp, Users, X } from "lucide-react";
import { motion } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useVisitorInsights } from "@/shared/hooks/useOperationalSync";
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
      className="absolute top-4 right-4 bottom-4 z-430 flex w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-400/35 bg-[#0b1527]/94 text-white shadow-[0_28px_80px_rgba(0,0,0,0.54)] ring-1 ring-white/8 backdrop-blur-xl"
      aria-label="Visitor insights"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-500/35 bg-[#111f34]/92 px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black tracking-[0.18em] text-emerald-300 uppercase">
            <BarChart3 size={15} /> Visitor Insights
          </p>
          <h2 className="mt-1 text-lg font-black text-white">{insights?.scopeName ?? "Loading visitor activity"}</h2>
          <p className="mt-1 text-xs font-semibold text-white/60">Live levels compared with similar days and times</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close visitor insights"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/12 bg-black/20 p-1.5">
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onRangeChange(option.value)}
              className={`rounded-lg px-2 py-2 text-[10px] font-black tracking-wide uppercase transition ${range === option.value ? "bg-emerald-500 text-emerald-950 shadow-sm" : "text-white/65 hover:bg-white/8 hover:text-white"}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {enterpriseId && (
          <button
            type="button"
            onClick={onShowArea}
            className="mt-3 inline-flex items-center justify-between rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-left text-xs font-bold text-white/75 transition hover:bg-white/10 hover:text-white"
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
            <section className="mt-4 grid grid-cols-2 gap-3">
              <InsightMetric icon={<Users size={15} />} label="Visitors Right Now" value={insights.currentVisitors.toLocaleString()} />
              <InsightMetric icon={<Activity size={15} />} label="Usual Around This Time" value={insights.typicalVisitors === null ? "Learning" : insights.typicalVisitors.toLocaleString()} />
            </section>

            <section className={`mt-3 rounded-2xl border p-4 ${comparisonTone.classes}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5">{comparisonTone.icon}</span>
                <div>
                  <p className="text-xs font-black tracking-wide uppercase">{comparisonHeading(insights.differencePercent)}</p>
                  <p className="mt-1 text-sm leading-relaxed font-semibold">{insights.comparisonMessage}</p>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-white/12 bg-[#111e32]/88 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-black tracking-[0.16em] text-white/70 uppercase">
                    <CalendarDays size={14} className="text-emerald-300" /> Activity Pattern
                  </p>
                  <p className="mt-1 text-xs font-semibold text-white/55">Average number of people present</p>
                </div>
                {insights.busiestPeriodLabel && (
                  <span className="rounded-full border border-amber-300/25 bg-amber-400/12 px-2.5 py-1 text-[9px] font-black text-amber-100 uppercase">Peak: {insights.busiestPeriodLabel}</span>
                )}
              </div>
              {insights.series.length > 0 ? (
                <div className="mt-4 h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insights.series} margin={{ top: 4, right: 2, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,.1)" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "rgba(255,255,255,.58)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,.58)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(52,211,153,.08)" }}
                        contentStyle={{ borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "#101d31", color: "white", fontSize: 12 }}
                        formatter={(value) => [Number(value).toLocaleString(), "Average visitors"]}
                      />
                      <Bar dataKey="averageVisitors" fill="#34d399" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-white/12 bg-black/15 p-5 text-center text-xs font-semibold text-white/55">
                  No visitor history is available for this period yet.
                </p>
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

            <section className="mt-4 rounded-2xl border border-white/12 bg-[#111e32]/88 p-4">
              <p className="text-[10px] font-black tracking-[0.16em] text-white/70 uppercase">Establishments Busier Than Usual</p>
              {insights.unusuallyBusy.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {insights.unusuallyBusy.map((enterprise) => (
                    <div key={enterprise.enterpriseId} className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-white">{enterprise.enterpriseName}</p>
                          <p className="mt-1 text-[10px] font-bold tracking-wide text-white/55 uppercase">Barangay {enterprise.barangay}</p>
                        </div>
                        <span className="rounded-full bg-amber-300 px-2.5 py-1 text-[9px] font-black text-amber-950">+{enterprise.differencePercent ?? 0}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed font-semibold text-white/55">No establishment in this view is currently much busier than its usual level.</p>
              )}
            </section>

            <p className="mt-4 text-center text-[10px] font-semibold text-white/45">
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
    <div className="rounded-2xl border border-white/12 bg-[#111e32]/88 p-4">
      <div className="flex items-center gap-2 text-emerald-300">
        {icon}
        <p className="text-[9px] font-black tracking-[0.14em] text-white/55 uppercase">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function InsightDetail({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-[#111e32]/88 p-4">
      <p className="flex items-center gap-2 text-[9px] font-black tracking-[0.14em] text-white/55 uppercase">
        <span className="text-emerald-300">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-sm font-black text-white">{value}</p>
      {detail && <p className="mt-1 text-xs font-semibold text-white/55">{detail}</p>}
    </div>
  );
}

function InsightsMessage({ icon, title, message, action }: { icon: React.ReactNode; title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="mt-4 flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/15 p-8 text-center">
      <span className="text-emerald-300">{icon}</span>
      <p className="mt-3 text-sm font-black text-white">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed font-semibold text-white/55">{message}</p>
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
  if (value !== null && value >= 20) return { classes: "border-amber-300/25 bg-amber-400/12 text-amber-50", icon: <TrendingUp size={18} /> };
  if (value !== null && value <= -20) return { classes: "border-sky-300/25 bg-sky-400/12 text-sky-50", icon: <TrendingDown size={18} /> };
  return { classes: "border-emerald-300/20 bg-emerald-400/10 text-emerald-50", icon: <Activity size={18} /> };
}
