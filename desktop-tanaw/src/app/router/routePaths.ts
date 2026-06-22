export const routePaths = {
  home: "/",
  login: "/login",
  changePassword: "/change-password",
  enterprise: "/enterprise",
  enterpriseDashboard: "/enterprise/dashboard",
  enterpriseCameras: "/enterprise/cameras",
  enterpriseReports: "/enterprise/reports",
  enterpriseSimulation: "/enterprise/simulation",
  enterpriseProfile: "/enterprise/profile",
  enterpriseSecurity: "/enterprise/security",
} as const;

export type AppRoute = (typeof routePaths)[keyof typeof routePaths];
