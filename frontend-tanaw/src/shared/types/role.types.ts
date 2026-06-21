export type UserRole = "it" | "admin" | "staff" | "enterprise";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  title: string;
  mustChangePassword: boolean;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  category: string | null;
  managerName: string | null;
  barangay: string | null;
  address: string | null;
};
