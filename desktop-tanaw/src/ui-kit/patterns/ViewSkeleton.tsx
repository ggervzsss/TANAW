import { Card } from "../components/Card";
import { Skeleton, SkeletonLine } from "../components/Spinner";
import { cn } from "../lib/cn";

/**
 * "list" is a page of rows in one card under a heading with actions (Notifications); "settings" is
 * the General Settings workspace. Pages with a layout of their own (Dashboard, Camera Setup,
 * Reports, Help Center) keep their skeleton beside their components.
 */
export type ViewSkeletonVariant = "list" | "settings";

export type ViewSkeletonProps = {
  /** Which page shape to sketch while its code or data loads. */
  variant?: ViewSkeletonVariant;
  /** Announced to screen readers, for example "Loading notifications". */
  label?: string;
  className?: string;
};

/**
 * A whole-page loading placeholder in the shape of the page that is on its way. It waits a beat
 * before showing, so fast loads never flash it.
 */
export function ViewSkeleton({ variant = "list", label = "Loading view", className }: ViewSkeletonProps) {
  if (variant === "settings") return <SettingsSkeleton label={label} className={className} />;
  return <ListSkeleton label={label} className={className} />;
}

function ListSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("tanaw-skeleton-screen mx-auto w-full max-w-290 space-y-6 pt-1", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4" aria-hidden="true">
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs">
            <SkeletonLine width="8rem" />
          </div>
          <div className="text-2xl leading-tight">
            <SkeletonLine width="11rem" />
          </div>
          <div className="mt-1.5 text-sm leading-relaxed">
            <SkeletonLine width="28rem" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-8.5 w-32" />
        </div>
      </div>
      <Card className="overflow-hidden rounded-tanaw-xl shadow-tanaw-soft">
        <div className="divide-y divide-(--tanaw-border-soft)" aria-hidden="true">
          {[72, 63, 54, 45, 36].map((width, row) => (
            <div key={row} className="flex items-start gap-4 px-5 py-4">
              <Skeleton className="h-10 w-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-relaxed">
                  <SkeletonLine width={`${width}%`} />
                </div>
                <div className="mt-1.5 text-xs">
                  <SkeletonLine width="6rem" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SettingsSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("tanaw-skeleton-screen tanaw-settings-workspace pointer-events-none", className)}>
      <div className="tanaw-settings-header" aria-hidden="true">
        <span className="tanaw-settings-return">
          <Skeleton className="h-3.5 w-14" />
        </span>
        <div className="tanaw-settings-heading">
          <SkeletonLine width="20rem" />
        </div>
        <div className="tanaw-settings-lede">
          <SkeletonLine width="22rem" />
        </div>
      </div>
      <div className="tanaw-settings-grid" aria-hidden="true">
        <div className="tanaw-settings-rail">
          {[70, 64, 46, 40, 62].map((width, index) => (
            <div key={index} className="tanaw-settings-link">
              <Skeleton className="h-4.25 w-4.25 shrink-0" />
              <SkeletonLine width={`${width}%`} />
            </div>
          ))}
        </div>
        <div className="tanaw-settings-panel">
          <div className="tanaw-settings-panel-header">
            <div className="text-[1.375rem] leading-7">
              <SkeletonLine width="14rem" />
            </div>
            <div className="mt-[0.3rem] text-sm leading-normal">
              <SkeletonLine width="26rem" />
            </div>
          </div>
          <div className="tanaw-settings-body">
            <div className="tanaw-settings-upload">
              <Skeleton className="h-14 w-14" shape="circle" />
              <div className="tanaw-settings-identity">
                <div className="text-lg leading-[1.35]">
                  <SkeletonLine width="10rem" />
                </div>
                <div className="mt-[0.1rem] text-[0.8125rem]">
                  <SkeletonLine width="8rem" />
                </div>
                <div className="mt-[0.15rem] flex min-h-8 items-center text-sm">
                  <SkeletonLine width="13rem" />
                </div>
              </div>
              <div className="tanaw-settings-upload-tools">
                <div className="tanaw-settings-upload-actions">
                  <Skeleton className="h-9 w-52 max-w-full" shape="pill" />
                </div>
                <div className="mt-[0.3rem] text-[0.75rem]">
                  <SkeletonLine width="12rem" />
                </div>
              </div>
            </div>
            {/* Profile Information, the section Settings opens on: two groups of fields side by side. */}
            <div className="tanaw-profile-layout">
              {[4, 3].map((fields, group) => (
                <div key={group} className="tanaw-settings-group">
                  <div className="mb-4">
                    <div className="text-[0.9375rem] leading-[1.4]">
                      <SkeletonLine width="11rem" />
                    </div>
                    <div className="mt-1 text-[0.8125rem] leading-normal">
                      <SkeletonLine width="80%" />
                    </div>
                  </div>
                  <div className="tanaw-settings-fields">
                    {Array.from({ length: fields }, (_, field) => (
                      <div key={field} className="tanaw-settings-field">
                        <div className="min-w-0 flex-1">
                          <div className="text-[0.8125rem]">
                            <SkeletonLine width="7rem" />
                          </div>
                          <div className="mt-[0.15rem] text-[0.9375rem]">
                            <SkeletonLine width="9rem" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
