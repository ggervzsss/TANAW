import { Skeleton, cn } from "@/shared/ui-kit";
import type { ItOverview } from "../hooks/useItOverview";

type FigureTone = "danger" | "warning" | "plain";

const toneClasses: Record<FigureTone, string> = {
  danger: "text-(--tanaw-danger)",
  warning: "text-(--tanaw-warn-ink)",
  plain: "text-(--tanaw-text)",
};

function Figure({ title, value, note, tone, isLoading }: { title: string; value: number; note: string; tone: FigureTone; isLoading: boolean }) {
  return (
    <div className="it-overview__figure">
      <dt className="text-sm font-bold text-(--tanaw-text)">{title}</dt>
      <dd className="m-0 mt-1.5">
        {isLoading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <span className={cn("font-display block text-4xl leading-none font-bold tabular-nums", value > 0 ? toneClasses[tone] : toneClasses.plain)}>{value.toLocaleString("en-US")}</span>
        )}
        <span className="mt-1.5 block text-[13px] text-(--tanaw-text-muted)">{isLoading ? "Loading" : note}</span>
      </dd>
    </div>
  );
}

/** Requests not picked up, places not sending data, cameras not counting and accounts waiting. */
export function OverviewFigures({ overview }: { overview: ItOverview }) {
  const { figures } = overview;
  return (
    <dl className="it-overview__figures" aria-label="What needs IT now">
      <Figure title="Requests not picked up" value={figures.requests.value} note={figures.requests.note} tone="plain" isLoading={overview.requests.isLoading} />
      <Figure title="Places not sending data" value={figures.places.value} note={figures.places.note} tone="danger" isLoading={overview.connections.isLoading} />
      <Figure title="Cameras not counting" value={figures.cameras.value} note={figures.cameras.note} tone="warning" isLoading={overview.connections.isLoading} />
      <Figure title="Accounts waiting" value={figures.accounts.value} note={figures.accounts.note} tone="plain" isLoading={overview.accounts.isLoading} />
    </dl>
  );
}
