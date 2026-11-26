import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, type ReactNode } from "react";
import { ModalPortal, useDialogFocus } from "@/shared/ui-kit";

type SideSheetProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Actions pinned to the bottom of the sheet. */
  footer?: ReactNode;
  onClose: () => void;
};

/**
 * A panel that slides in from the right over a scrim, for a form that belongs to the page behind it.
 * Focus stays inside; Escape, the close button and the scrim close it, and focus returns.
 */
export function SideSheet({ title, description, children, footer, onClose }: SideSheetProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduceMotion = useReducedMotion();
  useDialogFocus(panelRef, onClose);

  return (
    <ModalPortal lockScroll>
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 z-1300 bg-[rgb(3_20_12/0.45)] backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={onClose}
      />
      <motion.section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="shadow-tanaw-raised fixed inset-y-0 right-0 z-1301 flex w-[min(38rem,100%)] flex-col border-l border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 px-7 pt-7 pb-4 max-sm:px-4 max-sm:pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-2xl leading-tight font-bold text-(--tanaw-text)">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-(--tanaw-text-secondary)">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-tanaw-md flex h-10 w-10 shrink-0 items-center justify-center border border-(--tanaw-control-border) text-(--tanaw-text) transition-colors hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div data-modal-scroll-container className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-6 max-sm:px-4">
          {children}
        </div>
        {footer && <footer className="shrink-0 border-t border-(--tanaw-border-soft) px-7 py-4 max-sm:px-4">{footer}</footer>}
      </motion.section>
    </ModalPortal>
  );
}
