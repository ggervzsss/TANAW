import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { motion } from "motion/react";
import { ModalPortal } from "@/shared/components/ui";

type ReportActionTone = "amber" | "emerald" | "red";

type ReportActionConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  details?: Array<{ label: string; value: ReactNode }>;
  eyebrow?: string;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  pendingLabel?: string;
  tone?: ReportActionTone;
};

const toneClasses: Record<
  ReportActionTone,
  {
    accent: string;
    badge: string;
    button: string;
    icon: string;
    panel: string;
  }
> = {
  amber: {
    accent: "from-amber-600 via-amber-400 to-emerald-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    button: "bg-amber-600 hover:bg-amber-700 disabled:bg-amber-200",
    icon: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    panel: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100",
  },
  emerald: {
    accent: "from-emerald-700 via-emerald-500 to-lime-400",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    button: "bg-tanaw-green hover:bg-tanaw-green/90 disabled:bg-emerald-200",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
    panel: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:text-emerald-100",
  },
  red: {
    accent: "from-red-700 via-red-500 to-amber-400",
    badge: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    button: "bg-red-600 hover:bg-red-700 disabled:bg-red-200",
    icon: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    panel: "border-red-200 bg-red-50 text-red-900 dark:border-red-300/25 dark:bg-red-500/10 dark:text-red-100",
  },
};

export function ReportActionConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  cancelLabel = "Cancel",
  details = [],
  eyebrow = "Confirm action",
  isConfirmDisabled = false,
  isPending = false,
  pendingLabel = "Working...",
  tone = "amber",
}: ReportActionConfirmDialogProps) {
  const styles = toneClasses[tone];
  const Icon = tone === "emerald" ? CheckCircle2 : AlertTriangle;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape" || isPending) return;
      onCancel();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isPending, onCancel]);

  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1500 flex min-h-dvh items-center justify-center overflow-y-auto bg-[rgba(3,20,12,0.72)] p-4 backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={() => {
          if (!isPending) onCancel();
        }}
      >
        <motion.section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="report-action-confirm-title"
          aria-describedby="report-action-confirm-message"
          className="relative z-1501 my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-white/85 bg-white text-slate-950 shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/5 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100 dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className={`h-1.5 bg-linear-to-r ${styles.accent}`} />
          <div className="p-6">
            <div className="flex items-start gap-4">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${styles.icon}`}>
                <Icon size={22} />
              </span>
              <div className="min-w-0">
                <p className={`mb-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] uppercase ring-1 ${styles.badge}`}>{eyebrow}</p>
                <h2 id="report-action-confirm-title" className="text-tanaw-navy text-xl leading-tight font-bold dark:text-white">
                  {title}
                </h2>
                <p id="report-action-confirm-message" className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {message}
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                aria-label="Close confirmation dialog"
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {details.length > 0 && (
              <dl className={`mt-5 grid gap-3 rounded-xl border p-4 text-sm ${styles.panel}`}>
                {details.map((detail) => (
                  <div key={detail.label} className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-3">
                    <dt className="text-xs font-bold tracking-[0.12em] text-current/70 uppercase">{detail.label}</dt>
                    <dd className="min-w-0 font-semibold wrap-break-word">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-700">
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending || isConfirmDisabled}
                className={`rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed ${styles.button}`}
              >
                {isPending ? pendingLabel : confirmLabel}
              </button>
            </div>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
