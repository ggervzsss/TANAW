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
  const status = useAuthStore((state) => state.status);

  if (status === "checking") {
    return <div className="grid min-h-svh place-items-center bg-[#f4f8f5] text-sm font-semibold text-emerald-700 dark:bg-(--tanaw-page-bg) dark:text-emerald-200">Restoring your TANAW session...</div>;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={routes.login} replace />;
  }

  return children;
}
