import { type ReactNode, useRef } from "react";
import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ModalPortal, useDialogFocus } from "@/shared/ui-kit";

type AuthDialogKind = "recovery" | "support";

export function AuthDialogShell({ children, kind, onClose }: { children: ReactNode; kind: AuthDialogKind; onClose: () => void }) {
  const isRecovery = kind === "recovery";
  const titleId = isRecovery ? "forgot-password-title" : "contact-support-title";
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useDialogFocus(dialogRef, onClose, true, 'input:not([type="hidden"], :disabled), textarea:not(:disabled)');

  return (
    <ModalPortal lockScroll>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(3,20,12,0.54)] px-5 py-6 backdrop-blur-md"
        role="presentation"
        onMouseDown={onClose}
        onPointerMove={(event) => event.stopPropagation()}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="max-h-[calc(100svh-3rem)] w-full max-w-md overflow-y-auto rounded-[36px] border border-white/80 bg-white p-6 text-(--tanaw-text) shadow-[0_34px_100px_rgba(0,0,0,0.28)] ring-1 ring-black/3 sm:p-8 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100 dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8"
          initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.24em] text-(--tanaw-gold) uppercase">{isRecovery ? "Account Recovery" : "Support Desk"}</p>
              <h2 id={titleId} className="mt-2 text-xl font-bold text-(--tanaw-text)">
                {isRecovery ? "Forgot password" : "Contact support"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-(--tanaw-muted) transition hover:bg-emerald-50 hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 dark:focus-visible:ring-emerald-300 dark:focus-visible:ring-offset-[#121c31]"
              aria-label={isRecovery ? "Close password recovery" : "Close contact support"}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    </ModalPortal>
  );
}
