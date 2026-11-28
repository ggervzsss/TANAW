import { X } from "lucide-react";
import { motion } from "motion/react";
import { useId, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useDialogFocus } from "../lib/focus-trap";
import { dialogIn, easeOut } from "../lib/motion";
import { ModalPortal } from "./ModalPortal";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

export type DialogProps = {
  title: ReactNode;
  /** Used as the accessible name when the title is not plain text. */
  ariaLabel?: string;
  /** A small uppercase label above the title, such as a record number. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Actions, right-aligned: secondary before primary. */
  footer?: ReactNode;
  onClose: () => void;
  /** sm 28rem, md 36rem (default), lg 48rem, xl 64rem, full 90rem. */
  size?: DialogSize;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Whether a click on the backdrop closes it (on by default). */
  closeOnBackdrop?: boolean;
  /**
   * False while the dialog must stay open, for example while it sends something: Escape, the
   * backdrop and the close button do nothing, and the close button shows as unavailable.
   */
  dismissible?: boolean;
  /** A selector for the control that takes focus first, such as the safe choice; else the panel. */
  initialFocus?: string;
  /** A thin accent line at the top: "thread" is the forest, gold, leaf metric thread; "danger" for destructive confirmations. */
  accent?: "none" | "thread" | "danger";
  /** Classes for the panel, for example a custom max width. */
  className?: string;
  /** Classes for the scrolling body. */
  bodyClassName?: string;
};

const sizes: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-360",
};

/**
 * A modal dialog: a Raised white panel with 16px corners, a display-font title, scrolling content and
 * actions at the bottom right. Focus stays inside while it is open; Escape and the close button close it.
 */
export function Dialog({
  title,
  ariaLabel,
  eyebrow,
  description,
  children,
  footer,
  onClose,
  size = "md",
  closeLabel = "Close dialog",
  closeOnBackdrop = true,
  dismissible = true,
  initialFocus,
  accent = "none",
  className,
  bodyClassName,
}: DialogProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => {
    if (dismissible) onClose();
  };
  useDialogFocus(panelRef, close, true, initialFocus);

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="tanaw-dialog-backdrop fixed inset-0 z-1300 flex min-h-dvh items-center justify-center overflow-y-auto bg-[rgb(3_20_12/0.6)] p-4 backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: easeOut }}
        onPointerDown={(event) => {
          if (closeOnBackdrop && event.target === event.currentTarget) close();
        }}
      >
        <motion.section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabel ? undefined : titleId}
          aria-label={ariaLabel}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          {...dialogIn}
          data-dialog
          className={cn(
            "tanaw-dialog relative my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-tanaw-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) shadow-tanaw-raised outline-none",
            sizes[size],
            className,
          )}
        >
          {accent !== "none" && <div aria-hidden="true" data-dialog-accent={accent} className={cn("h-1 shrink-0", accent === "thread" ? "bg-(image:--tanaw-metric-thread)" : "bg-(--tanaw-danger)")} />}
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-6 pt-5 pb-4 max-sm:px-5">
            <div className="min-w-0">
              {eyebrow && <p className="mb-1 text-xs font-bold tracking-label text-(--tanaw-gold-ink) uppercase">{eyebrow}</p>}
              <h2 id={titleId} className="font-display text-xl leading-tight font-bold wrap-break-word text-(--tanaw-text)">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-(--tanaw-text-muted)">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={close}
              disabled={!dismissible}
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:active:scale-100 motion-reduce:transition-none"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div data-dialog-body className={cn("min-h-0 flex-1 overflow-y-auto p-6 max-sm:p-5", bodyClassName)}>
            {children}
          </div>
          {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-6 py-4 max-sm:px-5">{footer}</footer>}
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
