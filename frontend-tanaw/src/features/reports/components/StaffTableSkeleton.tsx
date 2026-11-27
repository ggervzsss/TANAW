import { Skeleton } from "@/shared/ui-kit";

type StaffTableSkeletonProps = {
  /** Read by screen readers while the table loads. */
  label: string;
  /** Column widths of the table that is loading, as fractions of a cell ("w-3/4"). */
  cells: readonly string[];
  rows?: number;
};

/** A report table's rows in their own shape, with the shared calm shimmer, while the reports load. */
export function StaffTableSkeleton({ label, cells, rows = 5 }: StaffTableSkeletonProps) {
  return (
    <div className="tanaw-staff-rise">
      <p role="status" className="sr-only">
        {label}
      </p>
      <table className="tanaw-staff-table" aria-hidden="true">
        <thead>
          <tr>
            {cells.map((_, index) => (
              <th key={index} scope="col">
                {" "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} data-skeleton="">
              {cells.map((width, index) => (
                <td key={index}>
                  <Skeleton className={`h-4 ${width} ${index === cells.length - 1 ? "ml-auto" : ""}`} />
                  {index === 0 && <Skeleton className="mt-2 h-3 w-1/3" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
