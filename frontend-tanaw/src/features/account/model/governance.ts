import { roleAccessLabel } from "@/shared/constants/roleLabels";
import type { AuthUser, UserRole } from "@/shared/types/role.types";

/** What each LGU role does in TANAW, as shown under Governance & Account Details. */
export const governanceRoleLabel: Record<Exclude<UserRole, "enterprise">, string> = {
  admin: "Municipal Admin (Executive Oversight)",
  it: "IT Personnel (System Administration)",
  staff: "LGU Staff (Report Review)",
};

export function systemRoleLabel(role: UserRole): string {
  return role === "enterprise" ? roleAccessLabel.enterprise : governanceRoleLabel[role];
}

export type AccountStanding = { label: string; tone: "success" | "warning" | "neutral" };

/** The account's standing from its status and activation, never assumed. */
export function accountStanding(user: Pick<AuthUser, "status" | "isActivated"> | null | undefined): AccountStanding {
  if (!user?.status) return { label: "Status unavailable", tone: "neutral" };
  if (user.status !== "active") return { label: "Inactive", tone: "neutral" };
  return user.isActivated ? { label: "Active · Verified", tone: "success" } : { label: "Active · Not verified", tone: "warning" };
}
