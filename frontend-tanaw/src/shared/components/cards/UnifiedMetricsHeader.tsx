import { Fragment, useId } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { fadeInDown } from "../ui/motionVariants";

export type UnifiedMetricTone = "danger" | "info" | "neutral" | "purple" | "success" | "teal" | "warning";

export type UnifiedMetric = {
  id: string;
  title: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  tone?: UnifiedMetricTone;
  badge?: ReactNode;
  isLoading?: boolean;
  showPulse?: boolean;
  showStatusDot?: boolean;
  emphasizeValue?: boolean;
  valueTitle?: string;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  testId?: string;
};

export type UnifiedMetricsControlSegment = {
  id: string;
  title: string;
  description?: ReactNode;
  content: ReactNode;
};

type UnifiedMetricsHeaderProps = {
  metrics: UnifiedMetric[];
  ariaLabel?: string;
  controlSegment?: UnifiedMetricsControlSegment;
  className?: string;
};

const toneClasses: Record<
  UnifiedMetricTone,
  {
    description: string;
    dot: string;
    icon: string;
    value: string;
  }
> = {
  danger: {
    description: "text-red-600 dark:text-red-300",
    dot: "bg-red-500 dark:bg-red-400",
    icon: "text-red-600 dark:text-red-300",
    value: "text-red-700 dark:text-red-200",
  },
  info: {
    description: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500 dark:bg-blue-400",
    icon: "text-blue-600 dark:text-blue-300",
    value: "text-blue-700 dark:text-blue-200",
  },
  neutral: {
    description: "text-slate-500 dark:text-slate-400",
    dot: "bg-slate-400 dark:bg-slate-500",
    icon: "text-slate-500 dark:text-slate-300",
    value: "text-slate-800 dark:text-slate-100",
  },
  purple: {
    description: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500 dark:bg-violet-400",
    icon: "text-violet-600 dark:text-violet-300",
    value: "text-violet-700 dark:text-violet-200",
  },
  success: {
    description: "tanaw-unified-metrics__success-detail text-emerald-700",
    dot: "tanaw-unified-metrics__success-dot bg-emerald-500",
    icon: "tanaw-unified-metrics__success-detail text-emerald-700",
    value: "tanaw-unified-metrics__success-value text-emerald-800",
  },
  teal: {
    description: "text-teal-700 dark:text-teal-300",
    dot: "bg-teal-500 dark:bg-teal-400",
    icon: "text-teal-700 dark:text-teal-300",
    value: "text-teal-800 dark:text-teal-200",
  },
  warning: {
    description: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-400",
    icon: "text-amber-700 dark:text-amber-300",
    value: "text-amber-800 dark:text-amber-200",
  },
};

export function UnifiedMetricsHeader({ metrics, ariaLabel = "Summary metrics", controlSegment, className = "" }: UnifiedMetricsHeaderProps) {
  const instanceId = useId();

  return (
    <motion.section
      aria-label={ariaLabel}
      className={`tanaw-unified-metrics relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-[background-color,border-color,box-shadow] duration-200 dark:border-(--tanaw-border-subtle) dark:bg-(--tanaw-surface) dark:shadow-(--tanaw-shadow-soft) ${className}`}
      variants={fadeInDown}
      data-unified-metrics-header
    >
      <div className="tanaw-unified-metrics__accent absolute inset-x-0 top-0 z-20 h-1.25" aria-hidden="true" data-metrics-accent />
      <div
        className="tanaw-unified-metrics__scroller overflow-x-auto pt-1.25 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-(--tanaw-focus-ring)"
        tabIndex={0}
        aria-label={`${ariaLabel}; scroll horizontally for additional metrics when needed`}
      >
        <ul className="flex min-w-max items-stretch" role="list">
          {metrics.map((metric, index) => (
            <Fragment key={metric.id}>
              {index > 0 && <MetricDivider />}
              <MetricSegment metric={metric} labelId={`${instanceId}-${metric.id}-label`} />
            </Fragment>
          ))}
          {controlSegment && (
            <>
              {metrics.length > 0 && <MetricDivider />}
              <li className="flex min-w-60 flex-1 basis-60">
                <div className="tanaw-unified-metrics__segment group relative flex min-h-40 w-full flex-col justify-between overflow-hidden px-6 py-6 sm:px-7 sm:py-7">
                  <span className="tanaw-unified-metrics__hover pointer-events-none absolute inset-0" aria-hidden="true" />
                  <div className="relative z-10">
                    <p className="text-[11px] leading-4 font-bold tracking-[0.14em] text-[#1b4332] uppercase sm:text-xs dark:text-emerald-200">{controlSegment.title}</p>
                    {controlSegment.description && <div className="mt-3 text-[13px] leading-relaxed font-medium text-slate-500 dark:text-slate-400">{controlSegment.description}</div>}
                  </div>
                  <div className="relative z-10 mt-5">{controlSegment.content}</div>
                </div>
              </li>
            </>
          )}
        </ul>
      </div>
    </motion.section>
  );
}

function MetricDivider() {
  return (
    <li
      className="my-5 w-px shrink-0 self-stretch bg-linear-to-b from-transparent via-slate-200 to-transparent opacity-80 dark:via-slate-600/65"
      aria-hidden="true"
      role="presentation"
      data-metric-divider
    />
  );
}

function MetricSegment({ metric, labelId }: { metric: UnifiedMetric; labelId: string }) {
  const tone = toneClasses[metric.tone ?? "neutral"];
  const Icon = metric.icon;
  const value = normalizedMetricValue(metric.value);
  const interactiveClassName = metric.href || metric.onClick ? "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-(--tanaw-focus-ring)" : "";
  const content = (
    <>
      <span className="tanaw-unified-metrics__hover pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative z-10 flex w-full items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-start gap-2.5">
            <p id={labelId} className="min-w-0 text-[11px] leading-4 font-bold tracking-[0.14em] text-[#1b4332] uppercase sm:text-xs dark:text-emerald-200">
              {metric.title}
            </p>
            {metric.badge && <span className="shrink-0">{metric.badge}</span>}
          </div>
          {metric.isLoading ? (
            <div className="mt-4" role="status" aria-label={`Loading ${metric.title}`}>
              <span className="block h-10 w-24 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
            </div>
          ) : (
            <p
              className={`tanaw-unified-metrics__value mt-3 max-w-full text-4xl leading-none font-semibold tracking-tight text-slate-900 tabular-nums sm:text-[2.5rem] dark:text-slate-50 ${metric.emphasizeValue ? tone.value : ""}`}
              aria-labelledby={labelId}
              title={metric.valueTitle}
            >
              {value}
            </p>
          )}
          {metric.description && (
            <div className={`mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed font-medium ${tone.description}`}>
              {metric.showStatusDot !== false && (
                <span className={`mt-[0.42em] h-2 w-2 shrink-0 rounded-full ${tone.dot} ${metric.showPulse ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden="true" />
              )}
              <span className="min-w-0">{metric.description}</span>
            </div>
          )}
        </div>
        {Icon && <Icon className={`tanaw-unified-metrics__icon h-5 w-5 shrink-0 ${tone.icon}`} aria-hidden="true" />}
      </div>
    </>
  );
  const segmentClassName = `tanaw-unified-metrics__segment group relative flex min-h-40 w-full min-w-52 flex-1 basis-52 overflow-hidden px-6 py-6 text-left sm:min-w-56 sm:basis-56 sm:px-7 sm:py-7 ${interactiveClassName}`;

  return (
    <li className="flex min-w-52 flex-1 basis-52 sm:min-w-56 sm:basis-56" data-metric-segment={metric.id} data-testid={metric.testId}>
      {metric.href ? (
        <a href={metric.href} className={segmentClassName} aria-label={metric.ariaLabel}>
          {content}
        </a>
      ) : metric.onClick ? (
        <button type="button" onClick={metric.onClick} className={segmentClassName} aria-label={metric.ariaLabel}>
          {content}
        </button>
      ) : (
        <div className={segmentClassName}>{content}</div>
      )}
    </li>
  );
}

function normalizedMetricValue(value: ReactNode) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" && Number.isNaN(value)) return "—";
  return value;
}
