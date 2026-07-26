import { type CSSProperties, type FocusEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type InfoTooltipProps = {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
  content: string;
  focusable?: boolean;
};

const HOVER_DELAY_MS = 500;
const FOCUS_DELAY_MS = 450;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type TooltipPosition = {
  left: number;
  placement: "bottom" | "top";
  top: number;
  width: number;
};

export function InfoTooltip({ align = "right", children, className = "", content, focusable = true }: InfoTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, placement: "top", top: 0, width: 224 });

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
    let placement: TooltipPosition["placement"] = "top";
    let top = triggerRect.top - tooltipHeight - gap;

    if (top < viewportPadding) {
      placement = "bottom";
      top = Math.min(triggerRect.bottom + gap, window.innerHeight - tooltipHeight - viewportPadding);
    }

    setPosition({
      left,
      placement,
      top: Math.max(viewportPadding, top),
      width: maxWidth,
    });
    setIsPositioned(true);
  }, [align]);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const scheduleOpen = useCallback(
    (delayMs: number) => {
      if (typeof window === "undefined") return;
      clearOpenTimer();
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setIsOpen(true);
      }, delayMs);
    },
    [clearOpenTimer],
  );

  const closeTooltip = useCallback(() => {
    clearOpenTimer();
    setIsOpen(false);
    setIsPositioned(false);
  }, [clearOpenTimer]);

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) return undefined;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => clearOpenTimer, [clearOpenTimer]);

  const tooltipStyle = {
    "--tooltip-enter-y": position.placement === "top" ? "4px" : "-4px",
    left: position.left,
    top: position.top,
    transformOrigin: position.placement === "top" ? "bottom center" : "top center",
    visibility: isPositioned ? "visible" : "hidden",
    width: position.width,
  } as CSSProperties;

  const tooltip =
    isOpen && typeof document !== "undefined"
      ? createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={tooltipStyle}
            className="tanaw-info-tooltip pointer-events-none fixed z-1300 rounded-lg border border-emerald-100/90 bg-white/95 px-3 py-2 text-left text-[11px] leading-relaxed font-semibold text-slate-700 shadow-[0_16px_36px_rgba(15,23,42,0.16)] ring-1 ring-emerald-950/5 backdrop-blur-md dark:border-(--enterprise-border) dark:bg-(--enterprise-card-elevated-bg) dark:text-(--enterprise-text) dark:ring-white/6"
          >
            {content}
          </span>,
          document.body,
        )
      : null;

  const sharedHandlers = {
    onBlur: handleBlur,
    onFocus: () => scheduleOpen(FOCUS_DELAY_MS),
    onPointerEnter: () => scheduleOpen(HOVER_DELAY_MS),
    onPointerLeave: closeTooltip,
  };

  if (focusable) {
    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
        }}
        type="button"
        className={`group inline-flex border-0 bg-transparent p-0 text-inherit ${className}`}
        aria-label="More information"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onClick={() => {
          clearOpenTimer();
          setIsOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeTooltip();
        }}
        {...sharedHandlers}
      >
        {children}
        {tooltip}
      </button>
    );
  }

  return (
    <div
      ref={(node) => {
        triggerRef.current = node;
      }}
      className={`group ${className}`}
      {...sharedHandlers}
    >
      {children}
      {tooltip}
    </div>
  );

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    closeTooltip();
  }
}
