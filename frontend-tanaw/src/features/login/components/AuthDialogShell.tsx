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
      <div className="tanaw-auth-dialog-backdrop" role="presentation" onMouseDown={onClose} onPointerMove={(event) => event.stopPropagation()}>
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="tanaw-auth-dialog"
          initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="tanaw-auth-dialog__header">
            <div className="min-w-0">
              <p className="tanaw-auth-dialog__eyebrow">{isRecovery ? "Account Recovery" : "Support Desk"}</p>
              <h2 id={titleId} className="tanaw-auth-dialog__title">
                {isRecovery ? "Forgot password" : "Contact support"}
              </h2>
              <span className="tanaw-civic-line tanaw-civic-line--short tanaw-auth-civic-line tanaw-auth-civic-line--short" aria-hidden="true" />
            </div>
            <button type="button" onClick={onClose} className="tanaw-auth-dialog__close" aria-label={isRecovery ? "Close password recovery" : "Close contact support"}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="tanaw-auth-dialog__body">{children}</div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}
