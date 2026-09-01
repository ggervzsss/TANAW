import type { ApiAuthUser } from "@/contracts/api";

export type UserRole = "it" | "admin" | "staff" | "enterprise";

export type AuthUser = Omit<ApiAuthUser, "role"> & {
  role: UserRole;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  category: string | null;
  managerName: string | null;
  barangay: string | null;
  address: string | null;
  buildingCapacity: number;
};
