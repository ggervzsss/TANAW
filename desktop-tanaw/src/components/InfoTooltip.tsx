import { type FocusEvent, type ReactNode, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type InfoTooltipProps = {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
  content: string;
  focusable?: boolean;
};

export function InfoTooltip({ align = "right", children, className = "", content, focusable = true }: InfoTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 224 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const viewportPadding = 10;
    const gap = 8;
    const maxWidth = Math.min(240, window.innerWidth - viewportPadding * 2);
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipHeight = tooltipRef.current?.offsetHeight ?? 56;
    const preferredLeft = align === "left" ? triggerRect.left : triggerRect.right - maxWidth;
    const left = Math.min(Math.max(viewportPadding, preferredLeft), window.innerWidth - maxWidth - viewportPadding);
    let top = triggerRect.top - tooltipHeight - gap;

    if (top < viewportPadding) {
      top = Math.min(triggerRect.bottom + gap, window.innerHeight - tooltipHeight - viewportPadding);
    }

    setPosition({
      left,
      top: Math.max(viewportPadding, top),
      width: maxWidth,
    });
  }, [align]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <div
      ref={triggerRef}
      className={`group ${className}`}
      aria-describedby={tooltipId}
      tabIndex={focusable ? 0 : undefined}
      onBlur={handleBlur}
      onFocus={() => setIsOpen(true)}
      onPointerEnter={() => setIsOpen(true)}
      onPointerLeave={() => setIsOpen(false)}
    >
      {children}
      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              style={{ left: position.left, top: position.top, width: position.width }}
              className="animate-in fade-in zoom-in-95 pointer-events-none fixed z-1300 rounded-lg border border-emerald-100/90 bg-white/95 px-3 py-2 text-left text-[11px] leading-relaxed font-semibold text-slate-700 shadow-[0_16px_36px_rgba(15,23,42,0.16)] ring-1 ring-emerald-950/5 backdrop-blur-md duration-150 dark:border-emerald-300/20 dark:bg-[#172033]/95 dark:text-slate-100 dark:ring-white/10"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </div>
  );

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsOpen(false);
  }
}
