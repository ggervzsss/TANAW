import type { ComponentType } from "react";
import { motion } from "motion/react";
import { fadeInDown } from "../ui/motionVariants";

type MetricCardProps = {
  label: string;
  value: string | number;
  foot: string;
  color: string;
  footClassName?: string;
  icon?: ComponentType<{ className?: string }>;
};

export function MetricCard({ label, value, foot, color, footClassName = "text-gray-500", icon: Icon }: MetricCardProps) {
  return (
    <motion.div
      className="tanaw-metric-card rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)] transition-[background-color,border-color,box-shadow] hover:shadow-[0_12px_30px_rgba(15,23,42,0.1)] dark:border-slate-700 dark:bg-(--tanaw-surface)"
      style={{ borderLeft: `5px solid ${color}` }}
      variants={fadeInDown}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-bold tracking-wide text-gray-500 uppercase dark:text-slate-300">{label}</p>
          <p className="mt-2 text-4xl leading-none font-bold text-gray-900 dark:text-white">{value}</p>
          <p className={`mt-2 text-sm font-medium ${footClassName}`}>{foot}</p>
        </div>
        {Icon && (
          <div className="tanaw-metric-card__icon rounded-xl bg-gray-50 p-3 text-gray-500 dark:bg-slate-800 dark:text-slate-300">
            <Icon className="h-6 w-6" />
          </div>
        )}
      </div>
    </motion.div>
  );
}
