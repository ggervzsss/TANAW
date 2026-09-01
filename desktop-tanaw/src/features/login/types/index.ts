import type { ApiAuthUser, ApiLoginResponse } from "../../../contracts/api";

export type AuthRole = "enterprise";

export type AuthUser = Omit<ApiAuthUser, "buildingCapacity" | "displayName" | "role" | "title"> & {
  buildingCapacity?: number;
  displayName?: string;
  name: string;
  role: AuthRole;
  title?: string;
};

export type LoginResponse = Omit<ApiLoginResponse, "user"> & {
  user: AuthUser;
};
