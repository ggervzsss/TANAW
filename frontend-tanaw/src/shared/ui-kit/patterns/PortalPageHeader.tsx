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
 * The page title used by the Admin and Staff portals: Bai Jamjuree heading, the Seal Gold signature
 * line under it (TANAW's thin gold accent, used once per screen), and a short description.
 */
export function PortalPageHeader({ title, description, back, actions, leading, children, titleId, className }: PortalPageHeaderProps) {
  return (
    <header className={cn("tanaw-portal-header mb-5", className)}>
      {back && (
        <Link
          to={back.to}
          aria-label={back.ariaLabel}
          className="mb-3 inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-semibold text-(--tanaw-text-secondary) no-underline transition-colors hover:text-(--tanaw-text)"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-5">
          {leading}
          <div className="min-w-0">
            <h1 id={titleId} className="font-display text-[2rem] leading-[1.15] font-bold tracking-[-0.01em] text-(--tanaw-text) max-sm:text-2xl">
              {title}
            </h1>
            <span className="tanaw-signature-line mt-2 block h-0.75 w-14 rounded-full bg-(--tanaw-gold-line)" aria-hidden="true" />
            {description && <p className="mt-2.5 max-w-[72ch] text-[0.9375rem] text-(--tanaw-text-secondary)">{description}</p>}
            {children}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}
