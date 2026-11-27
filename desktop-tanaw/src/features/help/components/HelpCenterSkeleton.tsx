import { Skeleton, SkeletonLine } from "../../../ui-kit/components/Spinner";

const TOPICS = ["68%", "80%", "60%", "44%", "72%"];

/** Article rows: category, title and a one-line summary, split by the list's own hairlines. */
function ArticleRows({ widths }: { widths: number[] }) {
  return (
    <ul className="help-list">
      {widths.map((width, row) => (
        <li key={row}>
          <div className="help-row">
            <span className="help-row-text">
              <span className="help-row-category">
                <SkeletonLine width="7rem" />
              </span>
              <span className="help-row-title">
                <SkeletonLine width={`${width - 22}%`} />
              </span>
              <span className="help-row-snippet">
                <SkeletonLine width={`${width}%`} />
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Help Center home in outline while its code loads: the heading, the search field, then the
 * categories on the left and the recommended and common articles on the right, built from the
 * page's own classes so each part keeps its size and place.
 */
export function HelpCenterSkeleton({ label = "Loading Help Center" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="help-page tanaw-skeleton-screen pointer-events-none">
      <div aria-hidden="true">
        <div className="help-header">
          <div className="help-kicker">
            <SkeletonLine width="8rem" />
          </div>
          <div className="help-title">
            <SkeletonLine width="13rem" />
          </div>
          <div className="help-lede">
            <SkeletonLine width="24rem" />
          </div>
        </div>
        <div className="help-search">
          <div className="help-search-title">
            <SkeletonLine width="10rem" />
          </div>
          <div className="help-search-field">
            <Skeleton className="h-13 w-full rounded-[12px]" />
          </div>
        </div>
        <div className="help-layout">
          <div className="help-aside">
            <div className="help-section-header">
              <div className="help-section-title">
                <SkeletonLine width="6rem" />
              </div>
            </div>
            <ul className="help-topics">
              {TOPICS.map((width, topic) => (
                <li key={topic}>
                  <div className="help-topic">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                    <span className="help-topic-label">
                      <SkeletonLine width={width} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="help-main">
            <div className="help-section-header">
              <div className="help-section-title">
                <SkeletonLine width="11rem" />
              </div>
            </div>
            <ArticleRows widths={[64, 74]} />
          </div>
          <div className="help-main">
            <div className="help-section-header">
              <div className="help-section-title">
                <SkeletonLine width="8rem" />
              </div>
            </div>
            <ArticleRows widths={[70, 78, 60]} />
          </div>
        </div>
      </div>
    </div>
  );
}
