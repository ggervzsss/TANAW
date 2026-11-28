import { SettingsGroup } from "@/shared/ui-kit/patterns/GeneralSettings";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { AuthUser, UserRole } from "@/shared/types/role.types";
import { formatPhilippineDateAndTime } from "@/shared/utils/dateTime";
import { accountStanding, systemRoleLabel } from "../model";

type GovernanceDetailsProps = {
  role: UserRole;
  user: Pick<AuthUser, "title" | "status" | "isActivated" | "lastSignInAt"> | null;
};

/** Read-only facts about the account's place in the municipality, from the signed-in account. */
export function GovernanceDetails({ role, user }: GovernanceDetailsProps) {
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const standing = accountStanding(user);
  const office = user?.title?.trim();
  return (
    <SettingsGroup title="Governance & Account Details" description="Read-only municipal oversight details.">
      <dl className="tanaw-account-facts">
        <div>
          <dt>System Role</dt>
          <dd>{systemRoleLabel(role)}</dd>
        </div>
        <div>
          <dt>Office / Unit</dt>
          <dd>{office || "Not set"}</dd>
        </div>
        <div>
          <dt>Account Status</dt>
          <dd>
            <span className="tanaw-account-standing" data-tone={standing.tone}>
              {standing.label}
            </span>
          </dd>
        </div>
        <div>
          <dt>Last Sign-In</dt>
          <dd className="tabular-nums">{user?.lastSignInAt ? formatPhilippineDateAndTime(user.lastSignInAt, dateFormat, timeFormat) : "Not recorded"}</dd>
        </div>
      </dl>
    </SettingsGroup>
  );
}
