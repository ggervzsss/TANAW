import { useEffect, useId, useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useIsPresent } from "motion/react";
import { X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";

const dialogs: string[] = [];
let originalOverflow = "";
let rootWasInert = false;

/** Camera dialogs own their focus and dismissal, including nested confirmations. */
export function CameraDialog({
  title,
  description,
  children,
  footer,
  onClose,
  className = "",
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  busy?: boolean;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const present = useIsPresent();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  close.current = onClose;
  locked.current = busy || !present;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById("root");
    if (dialogs.length === 0) {
      originalOverflow = document.body.style.overflow;
      rootWasInert = appRoot?.inert ?? false;
      if (appRoot) appRoot.inert = true;
    }
    dialogs.push(id);
    const frame = requestAnimationFrame(() => dialog.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (dialogs[dialogs.length - 1] !== id || event.defaultPrevented) return;
      // Portalled dropdowns handle Escape and their own keyboard navigation first.
      if (document.querySelector('[role="listbox"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!locked.current) close.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter(
        (node) => node.getClientRects().length > 0 && !node.closest("[inert]"),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      dialogs.splice(dialogs.indexOf(id), 1);
      document.removeEventListener("keydown", keydown);
      if (dialogs.length === 0) {
        if (appRoot) appRoot.inert = rootWasInert;
        // Nested portals can restore overflow in parent-first cleanup order.
        // Restore once after all portal cleanups have completed.
        queueMicrotask(() => {
          if (dialogs.length === 0) document.body.style.overflow = originalOverflow;
        });
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [id]);
  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: reduceMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
        style={{ pointerEvents: present ? "auto" : "none" }}
        className="camera-dialog-backdrop"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
          transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.3, 1] }}
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          aria-busy={busy}
          className={`camera-dialog ${className}`}
        >
          <header>
            <div>
              <h2 id={`${id}-title`}>{title}</h2>
              {description && <p id={`${id}-description`}>{description}</p>}
            </div>
            <button type="button" className="design-icon-button" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}>
              <X size={30} />
            </button>
          </header>
          <div className="camera-dialog-content">{children}</div>
          {footer && <footer>{footer}</footer>}
        </motion.div>
      </motion.div>
    </ModalPortal>
  );
}
