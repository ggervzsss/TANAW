import { useId, useState } from "react";

type ExpandableTableTextProps = {
  primary: string;
  secondary?: string;
  ariaLabel: string;
  className?: string;
  secondaryClassName?: string;
  threshold?: number;
  twoLines?: boolean;
};

export function ExpandableTableText({ primary, secondary, ariaLabel, className = "", secondaryClassName = "", threshold = 52, twoLines = false }: ExpandableTableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const fullText = [primary, secondary].filter(Boolean).join(" ");
  const canExpand = fullText.length > threshold;
  const collapsedClassName = twoLines ? "line-clamp-2" : "truncate";

  return (
    <div id={contentId} className="min-w-0 max-w-full">
      <div title={!isExpanded && canExpand ? fullText : undefined} className={`${className} ${isExpanded ? "wrap-break-word whitespace-normal" : collapsedClassName}`}>
        {primary}
      </div>
      {secondary && <div className={`mt-1 ${secondaryClassName} ${isExpanded ? "wrap-break-word whitespace-normal" : "truncate"}`}>{secondary}</div>}
      {canExpand && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          aria-label={`${isExpanded ? "Hide" : "View"} full ${ariaLabel}`}
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded((current) => !current);
          }}
          className="mt-1.5 inline-flex rounded text-[10px] font-black tracking-wide text-emerald-700 uppercase underline decoration-emerald-300 underline-offset-2 transition hover:text-emerald-900 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none dark:text-emerald-300 dark:hover:text-emerald-100"
        >
          {isExpanded ? "Hide" : "View"}
        </button>
      )}
    </div>
  );
}
