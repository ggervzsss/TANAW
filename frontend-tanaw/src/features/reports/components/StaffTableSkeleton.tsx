import type { ReactNode } from "react";
import { Skeleton, cn } from "@/shared/ui-kit";

/** One column of the table that is loading, as its header declares it. */
export type StaffTableSkeletonColumn = {
  /** The column's real header, shown while the rows load. */
  header: ReactNode;
  /** The header and cell class of the real column ("tanaw-num", "tanaw-hide-sm"). */
  className?: string;
  /** The placeholder's width ("w-24"); ignored for a status pill. */
  width?: string;
  /** The cell holds a StatusPill. */
  pill?: boolean;
  /**
   * Where the cell goes when a phone stacks the row (reports.css): "meta" joins the secondary line,
   * "stat" is a labelled figure under the pills. Without it a middle column keeps its table place.
   */
  cell?: "meta" | "stat";
  /** The figure's label on a phone, for a "stat" cell. */
  label?: string;
};

type StaffTableSkeletonProps = {
  /** Read by screen readers while the table loads. */
  label: string;
  columns: readonly StaffTableSkeletonColumn[];
  /** The first cell has a second, 13px line under its name (an enterprise's barangay). */
  subline?: boolean;
  rows?: number;
};

function cellRole(column: StaffTableSkeletonColumn, index: number, count: number) {
  if (index === 0) return "name";
  if (index === count - 1) return "action";
  if (column.pill) return "pill";
  return column.cell;
}

/**
 * A report table's rows in their own shape, with the shared calm shimmer, while the reports load:
 * the real column headers, the same columns hidden on narrow screens, and each bar in a box of its
 * line's height so the rows that replace it keep their place. On a phone the rows stack like the
 * real ones.
 */
export function StaffTableSkeleton({ label, columns, subline = false, rows = 5 }: StaffTableSkeletonProps) {
  return (
    <div className="tanaw-staff-rise overflow-x-auto">
      <p role="status" className="sr-only">
        {label}
      </p>
      <table className="tanaw-staff-table tanaw-staff-table--stack" aria-hidden="true">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} data-skeleton="">
              {columns.map((column, index) => {
                const end = column.className?.includes("tanaw-num") || index === columns.length - 1;
                return (
                  <td key={index} className={column.className} data-cell={cellRole(column, index, columns.length)} data-label={column.cell === "stat" ? column.label : undefined}>
                    {column.pill ? (
                      <Skeleton shape="pill" className="h-6.5 w-24" />
                    ) : (
                      <span className={cn("flex h-[1.5em] items-center", end && "justify-end")}>
                        <Skeleton className={cn("h-4", column.width ?? "w-20")} />
                      </span>
                    )}
                    {index === 0 && subline && (
                      <span className="mt-0.5 flex h-[1.21875rem] items-center">
                        <Skeleton className="h-3 w-1/3" />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
