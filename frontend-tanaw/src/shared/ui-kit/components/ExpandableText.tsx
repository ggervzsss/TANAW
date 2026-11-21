import { useCallback, useEffect, useId, useRef, useState } from "react";
import { hasVisualOverflow } from "../lib/overflow";

export type ExpandableTextProps = {
  /** Text that is truncated to one line (or two with twoLines) until expanded. */
  primary: string;
  secondary?: string;
  ariaLabel: string;
  className?: string;
  secondaryClassName?: string;
  twoLines?: boolean;
};

/** Text that truncates in tables and lists; when it overflows, an ellipsis button shows the rest in place. */
export function ExpandableText({ primary, secondary, ariaLabel, className = "", secondaryClassName = "", twoLines = false }: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryMeasureRef = useRef<HTMLDivElement>(null);
  const secondaryMeasureRef = useRef<HTMLDivElement>(null);
  const fullText = [primary, secondary].filter(Boolean).join(" ");
  const collapsedPrimaryClassName = twoLines ? "line-clamp-2" : "truncate";

  const measureOverflow = useCallback(() => {
    const primaryOverflows = primaryMeasureRef.current ? hasVisualOverflow(primaryMeasureRef.current, twoLines) : false;
    const secondaryOverflows = secondaryMeasureRef.current ? hasVisualOverflow(secondaryMeasureRef.current) : false;
    setCanExpand(primaryOverflows || secondaryOverflows);
  }, [twoLines]);

  useEffect(() => {
    let disposed = false;
    const remeasure = () => {
      if (!disposed) measureOverflow();
    };

    remeasure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    [containerRef.current, primaryMeasureRef.current, secondaryMeasureRef.current].forEach((element) => {
      if (element) observer?.observe(element);
    });
    window.addEventListener("resize", remeasure);
    if (document.fonts?.ready) void document.fonts.ready.then(remeasure);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [measureOverflow, primary, secondary]);

  return (
    <div ref={containerRef} className="relative min-w-0 max-w-full">
      <div id={contentId} title={!isExpanded && canExpand ? fullText : undefined}>
        <div className={`${className} ${isExpanded ? "wrap-break-word whitespace-normal" : collapsedPrimaryClassName}`}>{primary}</div>
        {secondary && <div className={`mt-1 ${secondaryClassName} ${isExpanded ? "wrap-break-word whitespace-normal" : "truncate"}`}>{secondary}</div>}
      </div>

      <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10">
        <div ref={primaryMeasureRef} className={`${className} ${collapsedPrimaryClassName}`}>
          {primary}
        </div>
        {secondary && (
          <div ref={secondaryMeasureRef} className={`mt-1 truncate ${secondaryClassName}`}>
            {secondary}
          </div>
        )}
      </div>

      {canExpand && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={isExpanded ? `Collapse full ${ariaLabel}` : `Show full ${ariaLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded((current) => !current);
          }}
          className="mt-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded text-sm leading-none font-black text-(--tanaw-accent-ink) transition-colors hover:opacity-80 focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
        >
          &hellip;
        </button>
      )}
    </div>
  );
}
