import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { EnterpriseNotification } from "../../../types/enterprise";

type CriticalAlertToastsProps = {
  toasts: EnterpriseNotification[];
  onReview: (toast: EnterpriseNotification) => void;
  onDismiss: (toastId: number) => void;
};

export function CriticalAlertToasts({ toasts, onReview, onDismiss }: CriticalAlertToastsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-100 flex flex-col gap-2.5">
      <AnimatePresence>
        {toasts.slice(0, 3).map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="tanaw-toast tanaw-toast--error"
            // motion runs this toast in and out, so the stylesheet entrance stays off.
            style={{ animation: "none" }}
          >
            <span className="tanaw-toast__icon self-start" aria-hidden="true">
              <AlertTriangle strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <div role="alert" className="wrap-break-word">
                <p className="font-bold">Critical alert</p>
                <p>{toast.message}</p>
              </div>
              <button type="button" className="pointer-events-auto mt-1 text-sm font-semibold underline underline-offset-2" onClick={() => onReview(toast)}>
                Review issue
              </button>
            </div>
            <button type="button" className="tanaw-toast__dismiss" aria-label="Dismiss critical alert" onClick={() => onDismiss(toast.id)}>
              <X size={16} aria-hidden="true" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
