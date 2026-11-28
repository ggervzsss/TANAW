import { X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useDialogFocus } from "../lib/focus-trap";
import { useIsPhone } from "../lib/media";
import { dialogIn, easeOut, sheetIn } from "../lib/motion";
import { ModalPortal } from "./ModalPortal";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";

export type DialogProps = {
  title: ReactNode;
  /** Used as the accessible name when the title is not plain text. */
  ariaLabel?: string;
  /** A small label above the title, such as a record number. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Actions, right-aligned: secondary before primary. */
  footer?: ReactNode;
  onClose: () => void;
  /** sm 28rem, md 36rem (default), lg 48rem, xl 64rem, 2xl 75rem, full 90rem. */
  size?: DialogSize;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Whether a click on the backdrop closes it (on by default). */
  closeOnBackdrop?: boolean;
  /** "thread" signs the title with the short civic line (green, Seal Gold, green); "danger" draws a thin red line across the top for destructive confirmations. */
  accent?: "none" | "thread" | "danger";
  /** Extra classes for the panel. Set the width with size: a max width here would clash with it. */
  className?: string;
  /** Classes for the scrolling body. */
  bodyClassName?: string;
  /** A selector for the element to focus when it opens, such as the first input; the panel otherwise. */
  initialFocus?: string;
};

const sizes: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  "2xl": "max-w-300",
  full: "max-w-360",
};

type ScrollEdges = { top: boolean; bottom: boolean };

/**
 * Tracks whether the body is scrolled away from its top and whether more content waits below, so the
 * header and footer draw their hairline only when content actually passes under them.
 */
function useScrollEdges(body: { readonly current: HTMLElement | null }): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ top: false, bottom: false });
  useEffect(() => {
    const node = body.current;
    if (!node) return undefined;
    const update = () => {
      const top = node.scrollTop > 2;
      const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
      setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(node);
    for (const child of Array.from(node.children)) resize?.observe(child);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mutations?.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("scroll", update);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [body]);
  return edges;
}

/**
 * A modal dialog: a raised panel with 24px corners floating over a softly blurred, green-tinted scrim.
 * The title is set in the display font; the body scrolls between a header and a footer whose hairlines
 * appear only when content passes under them. It rises into place with a soft spring and leaves faster.
 * Focus stays inside while it is open; Escape and the close button close it.
 *
 * On phones (under 640px) it becomes a bottom sheet: full width with 24px top corners, as tall as
 * its content up to the screen below the status bar, rising from the bottom edge. The footer stays
 * pinned with its buttons stacked full width, primary on top, clear of the home indicator.
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
  accent = "none",
  className,
  bodyClassName,
  initialFocus,
}: DialogProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(panelRef, onClose, true, initialFocus);
  const edges = useScrollEdges(bodyRef);
  const asSheet = useIsPhone();

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="tanaw-dialog-backdrop fixed inset-0 z-1300 flex min-h-dvh items-center justify-center overflow-y-auto overscroll-contain p-4 max-sm:items-end max-sm:px-0 max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] max-sm:pb-0 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: easeOut }}
        onPointerDown={(event) => {
          if (closeOnBackdrop && event.target === event.currentTarget) onClose();
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
          {...(asSheet ? sheetIn : dialogIn)}
          data-dialog
          data-sheet={asSheet || undefined}
          className={cn(
            "tanaw-dialog relative my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-tanaw-2xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) shadow-tanaw-dialog outline-none sm:max-h-[calc(100dvh-3rem)]",
            sizes[size],
            "max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[calc(100dvh-max(0.75rem,env(safe-area-inset-top)))] max-sm:max-w-none max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
            className,
          )}
        >
          {accent === "danger" && <div aria-hidden="true" data-dialog-accent="danger" className="h-1 shrink-0 bg-(--tanaw-danger)" />}
          <header
            data-scrolled={edges.top || undefined}
            className="relative flex shrink-0 items-start justify-between gap-5 border-b border-transparent px-7 pt-6 pb-5 transition-colors duration-200 ease-tanaw-out data-scrolled:border-(--tanaw-border-soft) max-sm:px-5 max-sm:pt-5 max-sm:pb-4"
          >
            <div className="min-w-0">
              {eyebrow && <p className="mb-1.5 text-[0.8125rem] font-semibold text-(--tanaw-gold-ink) tabular-nums">{eyebrow}</p>}
              <h2 id={titleId} className="font-display text-2xl leading-tight font-bold tracking-[-0.015em] wrap-break-word text-(--tanaw-text) max-sm:text-xl">
                {title}
              </h2>
              {accent === "thread" && <span aria-hidden="true" data-dialog-accent="thread" className="tanaw-civic-line tanaw-civic-line--short mt-3" />}
              {description && (
                <p id={descriptionId} className="mt-2.5 max-w-[62ch] text-sm leading-relaxed text-(--tanaw-text-muted)">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="tanaw-dialog-close -mt-0.5 -mr-2 flex h-9 w-9 shrink-0 pointer-coarse:-mt-1.5 pointer-coarse:size-11 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,rotate,scale] duration-200 ease-tanaw-out hover:rotate-90 hover:bg-(--tanaw-control-bg-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-90 motion-reduce:transition-none motion-reduce:hover:rotate-0"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          {/* The scrolling body: form validation scrolls the first invalid field into view inside it. */}
          <div
            ref={bodyRef}
            data-dialog-body
            data-modal-scroll-container
            className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pt-1 pb-7 max-sm:px-5 max-sm:pb-5", !footer && "max-sm:pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))]", bodyClassName)}
          >
            {children}
          </div>
          {footer && (
            <footer
              data-overflow={edges.bottom || undefined}
              className="tanaw-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-(--tanaw-border-soft) px-7 py-5 transition-[border-color,background-color] duration-200 ease-tanaw-out max-sm:flex-col-reverse max-sm:flex-nowrap max-sm:items-stretch max-sm:gap-2 max-sm:px-5 max-sm:pt-4 max-sm:pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] max-sm:*:w-full"
            >
              {footer}
            </footer>
          )}
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
