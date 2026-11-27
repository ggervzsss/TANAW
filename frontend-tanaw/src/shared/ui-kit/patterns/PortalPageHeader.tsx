import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../lib/cn";

export type PortalPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** A link back to the parent screen, shown above the title on sub-pages. */
  back?: { to: string; label: string; ariaLabel?: string };
  /** Controls on the right of the title, such as a reporting month or an unread count. */
  actions?: ReactNode;
  /** Something shown before the title block, such as an enterprise photo. */
  leading?: ReactNode;
  /** Tags or status lines under the description. */
  children?: ReactNode;
  titleId?: string;
  className?: string;
};

/**
 * The page title used by the Admin and Staff portals: a Bai Jamjuree heading signed by the civic
 * line (a short green, Seal Gold, green bar that draws in once), then an Inter lede. It sits on the
 * page's green wash, with no box around it.
 */
export function PortalPageHeader({ title, description, back, actions, leading, children, titleId, className }: PortalPageHeaderProps) {
  return (
    <header className={cn("tanaw-portal-header mb-8 max-sm:mb-6", className)}>
      {back && (
        <Link
          to={back.to}
          aria-label={back.ariaLabel}
          className="group mb-4 -ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-tanaw-sm px-1 text-sm font-semibold text-(--tanaw-text-secondary) no-underline transition-colors duration-150 hover:text-(--tanaw-accent-ink)"
        >
          <ArrowLeft size={16} aria-hidden="true" className="transition-transform duration-150 ease-tanaw-out group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-5">
          {leading}
          <div className="min-w-0">
            <h1 id={titleId} className="tanaw-page-title">
              {title}
            </h1>
            <span className="tanaw-civic-line tanaw-signature-line mt-3" aria-hidden="true" />
            {description && <p className="tanaw-page-lede mt-3">{description}</p>}
            {children}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
