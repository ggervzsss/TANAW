import { PortalPageHeader } from "@/shared/ui-kit";
import { OverviewFigures } from "../components/OverviewFigures";
import { AccountsSection, ConnectionsSection, EmailsSection, RequestsSection } from "../components/OverviewSections";
import { useBalancedColumns } from "../hooks/useBalancedColumns";
import { useItOverview } from "../hooks/useItOverview";
import "../itOverview.css";

/**
 * The IT Overview (/it/dashboard): a greeting, four figures for what needs IT now, and four short
 * work lists (requests, connection problems, accounts waiting, emails that did not arrive), each
 * linking to its full screen. Requests and connection problems sit side by side; accounts and
 * emails go under whichever column keeps the two close to level, and the connection problems list
 * scrolls inside itself, stretching to make up the rest.
 */
export function ITOverviewPage() {
  const overview = useItOverview();
  const { ref: columnsRef, lower } = useBalancedColumns();
  const accountsFirst = lower === "accounts" || lower === "both";
  const emailsFirst = lower === "emails" || lower === "both";
  return (
    <div className="it-overview w-full pb-4">
      <PortalPageHeader
        title={overview.greeting}
        description="What needs IT today: requests to handle, places not sending data, and accounts waiting on you."
        actions={
          <p role="status" className="m-0 text-[13px] text-(--tanaw-text-secondary)">
            {overview.status}
          </p>
        }
      />
      <OverviewFigures overview={overview} />
      <div ref={columnsRef} className="it-overview__sections">
        <div className="it-overview__column">
          <RequestsSection overview={overview} />
          {accountsFirst && <AccountsSection overview={overview} />}
          {emailsFirst && <EmailsSection overview={overview} />}
        </div>
        <div className="it-overview__column">
          <ConnectionsSection overview={overview} />
          {!accountsFirst && <AccountsSection overview={overview} />}
          {!emailsFirst && <EmailsSection overview={overview} />}
        </div>
      </div>
    </div>
  );
}
