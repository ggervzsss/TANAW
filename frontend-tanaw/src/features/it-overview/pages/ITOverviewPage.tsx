import { PortalPageHeader } from "@/shared/ui-kit";
import { OverviewFigures } from "../components/OverviewFigures";
import { AccountsSection, ConnectionsSection, EmailsSection, RequestsSection } from "../components/OverviewSections";
import { useItOverview } from "../hooks/useItOverview";
import "../itOverview.css";

/**
 * The IT Overview (/it/dashboard): a greeting, four figures for what needs IT now, and four short
 * work lists (requests, connection problems, accounts waiting, emails that did not arrive), each
 * linking to its full screen.
 */
export function ITOverviewPage() {
  const overview = useItOverview();
  return (
    <div className="it-overview mx-auto w-full max-w-360 pb-14">
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
      <div className="it-overview__sections">
        <RequestsSection overview={overview} />
        <ConnectionsSection overview={overview} />
        <AccountsSection overview={overview} />
        <EmailsSection overview={overview} />
      </div>
    </div>
  );
}
