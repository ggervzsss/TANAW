import { useCallback, useEffect, useId, useRef, useState } from "react";
import { hasVisualOverflow } from "./overflowMeasurement";

type ExpandableTableTextProps = {
  primary: string;
  secondary?: string;
  ariaLabel: string;
  className?: string;
  secondaryClassName?: string;
  twoLines?: boolean;
};

export function ExpandableTableText({
  primary,
  secondary,
  ariaLabel,
  className = "",
  secondaryClassName = "",
  twoLines = false,
}: ExpandableTableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryMeasureRef = useRef<HTMLDivElement>(null);
  const secondaryMeasureRef = useRef<HTMLDivElement>(null);
  const fullText = [primary, secondary].filter(Boolean).join(" ");
  const collapsedClassName = twoLines ? "line-clamp-2" : "truncate";

  const measureOverflow = useCallback(() => {
    const primaryOverflows = primaryMeasureRef.current ? hasVisualOverflow(primaryMeasureRef.current, twoLines) : false;
    const secondaryOverflows = secondaryMeasureRef.current ? hasVisualOverflow(secondaryMeasureRef.current) : false;
    setCanExpand(primaryOverflows || secondaryOverflows);
  }, [twoLines]);

  useEffect(() => {
    let isDisposed = false;
    const remeasure = () => {
      if (!isDisposed) measureOverflow();
    };
    remeasure();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    [containerRef.current, primaryMeasureRef.current, secondaryMeasureRef.current].forEach((element) => {
      if (element) resizeObserver?.observe(element);
    });
    window.addEventListener("resize", remeasure);

    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(remeasure);

    return () => {
      isDisposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [measureOverflow, primary, secondary]);

  return (
    <div ref={containerRef} className="relative max-w-full min-w-0">
      <div id={contentId} title={!isExpanded && canExpand ? fullText : undefined}>
        <div className={`${className} ${isExpanded ? "wrap-break-word whitespace-normal" : collapsedClassName}`}>{primary}</div>
        {secondary && <div className={`mt-1 ${secondaryClassName} ${isExpanded ? "wrap-break-word whitespace-normal" : "truncate"}`}>{secondary}</div>}
      </div>

      <div aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10">
        <div ref={primaryMeasureRef} className={`${className} ${collapsedClassName}`}>
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
          className="mt-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded text-sm font-black leading-none text-emerald-700 transition-colors hover:text-emerald-900 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none dark:text-emerald-300 dark:hover:text-emerald-100"
        >
          &hellip;
        </button>
      )}
    </div>
  );
}
