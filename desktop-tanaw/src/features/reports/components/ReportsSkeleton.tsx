import { Skeleton, SkeletonLine } from "../../../ui-kit/components/Spinner";

const ORIGIN_ROWS = [0, 1, 2, 3];
const STEPS = [0, 1, 2];

/**
 * Reports in outline while its code loads: the heading, the tabs and Create Reports (report
 * details, TANAW's count, Visitor Details, Next Steps and the notes disclosure), built from the
 * page's own classes so each part keeps its size and place.
 */
export function ReportsSkeleton({ label = "Loading reports" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="tanaw-reports-workspace tanaw-skeleton-screen pointer-events-none">
      <div aria-hidden="true">
        <div className="reports-heading">
          <div>
            <h1>
              <SkeletonLine width="9rem" />
            </h1>
            <p>
              <SkeletonLine width="24rem" />
            </p>
          </div>
        </div>
        <div className="reports-tabs">
          <Skeleton className="h-12.5 w-54 rounded-[14px]" />
          <Skeleton className="h-12.5 w-54 rounded-[14px]" />
        </div>
        <section className="report-create-card">
          <div className="report-information">
            <div className="report-information-left">
              <header>
                <h2>
                  <SkeletonLine width="16rem" />
                </h2>
                <p>
                  <SkeletonLine width="20rem" />
                </p>
              </header>
              <dl className="report-information-fields">
                {["9rem", "8rem", "7rem"].map((width, field) => (
                  <div key={field}>
                    <dt>
                      <SkeletonLine width={width} />
                    </dt>
                    <dd>
                      {field < 2 ? (
                        <>
                          <Skeleton className="h-8.5 w-8.5 shrink-0" />
                          <SkeletonLine width="7rem" />
                        </>
                      ) : (
                        <Skeleton className="h-8.5 w-52 max-w-full rounded-xl" />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="report-system-count">
              <div>
                <h3>
                  <SkeletonLine width="11rem" />
                </h3>
                <output>
                  <Skeleton className="report-count-skeleton" />
                </output>
                <p>
                  <SkeletonLine width="6rem" />
                </p>
              </div>
              <div className="report-readonly">
                <strong>
                  <SkeletonLine width="6rem" />
                </strong>
                <p>
                  <SkeletonLine width="8rem" />
                  <SkeletonLine width="6rem" />
                </p>
              </div>
            </div>
          </div>
          <div className="report-create-body">
            <section className="report-visitor-card">
              <header className="report-visitor-heading">
                <h3>
                  <SkeletonLine width="10rem" />
                </h3>
                <p>
                  <SkeletonLine width="26rem" />
                </p>
              </header>
              <div className="report-origin-table-scroll">
                <table className="report-origin-table">
                  <thead>
                    <tr>
                      {["7rem", "3rem", "4rem", "3rem"].map((width, column) => (
                        <th key={column} scope="col">
                          <Skeleton className={`h-3 ${column ? "mx-auto" : ""}`} style={{ width }} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ORIGIN_ROWS.map((row) => (
                      <tr key={row}>
                        <th scope="row">
                          <Skeleton className="h-3.5" style={{ width: `${[52, 48, 64, 40][row]}%` }} />
                        </th>
                        {[0, 1, 2].map((cell) => (
                          <td key={cell}>
                            <Skeleton className="report-cell-skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">
                        <Skeleton className="h-3.5 w-24" />
                      </th>
                      {[0, 1, 2].map((cell) => (
                        <td key={cell}>
                          <Skeleton className="report-cell-skeleton" />
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* The optional notes field that sits open under the table. */}
              <div className="report-supporting">
                <div className="report-notes">
                  <div className="report-notes-skeleton-label">
                    <SkeletonLine width="4.5rem" />
                  </div>
                  <Skeleton className="report-notes-skeleton" />
                </div>
              </div>
            </section>
            <aside className="report-next-steps">
              <h3>
                <SkeletonLine width="9rem" />
              </h3>
              <ol>
                {STEPS.map((step) => (
                  <li key={step}>
                    <Skeleton className="h-7 w-7 shrink-0" shape="circle" />
                    <SkeletonLine width={["11rem", "10rem", "7rem"][step]} />
                  </li>
                ))}
              </ol>
              <div className="report-workflow-actions">
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
