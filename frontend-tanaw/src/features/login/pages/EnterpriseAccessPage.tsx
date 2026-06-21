import { Navigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/shared/utils/routeUtils";

export function EnterpriseAccessPage() {
  const user = useAuthStore((state) => state.user);

  if (!user || user.role === "enterprise") {
    return <Navigate to={routes.login} replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to={routes.changePassword} replace />;
  }

  return <Navigate to={getRoleDashboardPath(user.role)} replace />;
}
