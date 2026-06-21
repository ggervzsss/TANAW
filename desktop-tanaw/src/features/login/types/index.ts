export type AuthRole = "enterprise";

export type AuthUser = {
  id: string;
  name: string;
  displayName?: string;
  email: string;
  role: AuthRole;
  title?: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enterpriseId?: string | null;
  enterpriseName?: string | null;
  category?: string | null;
  managerName?: string | null;
  barangay?: string | null;
  address?: string | null;
  mustChangePassword?: boolean;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  token: string;
  user: AuthUser;
};
