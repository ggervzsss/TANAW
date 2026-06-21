import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { UserRole } from "@/shared/types/role.types";
import { useAuthStore } from "../store/authStore";
import { routes } from "./routes";

type ProtectedRouteProps = {
  allowedRoles: UserRole[];
  children: ReactNode;
};

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const user = useAuthStore((state) => state.user);

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={routes.login} replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to={routes.changePassword} replace />;
  }

  return children;
}
