import type { UserRole } from "@/shared/types/role.types";

export const rolePortalLabel: Record<UserRole, string> = {
  admin: "Admin Portal",
  enterprise: "Enterprise Portal",
  it: "IT Portal",
  staff: "Staff Portal",
};

export const roleAccessLabel: Record<UserRole, string> = {
  admin: "Administrator Account",
  enterprise: "Enterprise Account",
  it: "IT Personnel Account",
  staff: "LGU Staff Account",
};
