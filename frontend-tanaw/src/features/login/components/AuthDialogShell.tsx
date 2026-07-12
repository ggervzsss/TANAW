import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion } from "motion/react";

type AuthDialogKind = "recovery" | "support";

export function AuthDialogShell({ children, kind, onClose }: { children: ReactNode; kind: AuthDialogKind; onClose: () => void }) {
  const isRecovery = kind === "recovery";
  const titleId = isRecovery ? "forgot-password-title" : "contact-support-title";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(3,20,12,0.54)] px-5 py-6 backdrop-blur-md sm:items-center sm:py-8"
      role="presentation"
      onMouseDown={onClose}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="my-auto max-h-[calc(100svh-3rem)] w-full max-w-md overflow-y-auto rounded-[36px] border border-white/80 bg-white p-6 shadow-[0_34px_100px_rgba(0,0,0,0.28)] ring-1 ring-black/3 sm:p-8"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
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
            className="rounded-full p-2 text-(--tanaw-muted) transition hover:bg-emerald-50 hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}
