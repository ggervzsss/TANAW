/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Table.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: f546ad29a661fef476dca135c097a1c6289eca1d7e94348724aec308a65f6ad7
 */
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type TableProps = HTMLAttributes<HTMLTableElement> & {
  /** Names the table for screen readers. */
  ariaLabel?: string;
  /** Classes for the scrolling wrapper; wide tables scroll inside it, never the page. */
  wrapperClassName?: string;
};

/** A data table: Inset header with uppercase labels, Border Soft row dividers, tabular figures. */
export function Table({ ariaLabel, wrapperClassName, className, children, ...props }: TableProps) {
  return (
    <div className={cn("tanaw-table-scroll min-w-0 overflow-x-auto", wrapperClassName)}>
      <table aria-label={ariaLabel} className={cn("tanaw-table w-full border-collapse text-sm text-(--tanaw-text)", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return <thead className={cn("bg-(--tanaw-surface-inset)", className)}>{children}</thead>;
}

export function TableBody({ children, className }: { children: ReactNode; className?: string }) {
  return <tbody className={cn("divide-y divide-(--tanaw-border-soft)", className)}>{children}</tbody>;
}

export type TableRowProps = HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean };

export function TableRow({ selected = false, interactive = false, className, children, ...props }: TableRowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn("transition-colors", interactive && "cursor-pointer hover:bg-(--tanaw-interactive-hover-bg)", selected && "bg-(--tanaw-interactive-selected-bg)", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export type TableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean };

/** A column header: uppercase tracked Forest Label. Numeric columns align right. */
export function TableHeaderCell({ numeric = false, className, children, scope = "col", ...props }: TableHeaderCellProps) {
  return (
    <th scope={scope} className={cn("px-3 py-2.5 text-xs font-bold tracking-label whitespace-nowrap text-(--tanaw-label) uppercase", numeric ? "text-right" : "text-left", className)} {...props}>
      {children}
    </th>
  );
}

export type TableCellProps = TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; emphasis?: boolean };

/** A body cell. Counts use numeric: right-aligned tabular figures. emphasis is for totals. */
export function TableCell({ numeric = false, emphasis = false, className, children, ...props }: TableCellProps) {
  return (
    <td className={cn("px-3 py-2.5 align-middle", numeric && "text-right tabular-nums", emphasis && "font-bold", className)} {...props}>
      {children}
    </td>
  );
}
