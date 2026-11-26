import { Button } from "@/shared/ui-kit";
import type { EmailChangeCallout } from "../model";

type Props = {
  callouts: EmailChangeCallout[];
  resolvingAccountId: string | null;
  onResolve: (accountId: string, action: "approve" | "decline") => void;
};

/** A pale gold notice for each sign-in email change waiting on IT. */
export function EmailChangeCallouts({ callouts, resolvingAccountId, onResolve }: Props) {
  if (!callouts.length) return null;
  return (
    <div className="mt-5 grid gap-3">
      {callouts.map((callout) => {
        const titleId = `email-change-${callout.accountId}`;
        const busy = resolvingAccountId === callout.accountId;
        return (
          <section
            key={callout.accountId}
            aria-labelledby={titleId}
            className="rounded-tanaw-lg flex flex-wrap items-center justify-between gap-x-6 gap-y-3.5 border border-(--tanaw-warning-line) bg-(--tanaw-warning-surface) px-5 py-4"
          >
            <div className="min-w-0 flex-1 basis-80">
              <h2 id={titleId} className="text-base font-bold text-(--tanaw-text)">
                {callout.title}
              </h2>
              <p className="mt-1 text-sm wrap-anywhere text-(--tanaw-text-secondary)">
                From {callout.from} to {callout.to}. {callout.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {callout.canApprove && (
                <Button onClick={() => onResolve(callout.accountId, "approve")} disabled={busy} aria-label={`Approve the new email ${callout.to}`}>
                  Approve
                </Button>
              )}
              <Button variant="danger" onClick={() => onResolve(callout.accountId, "decline")} disabled={busy} aria-label={`Decline the new email ${callout.to}`}>
                Decline
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
