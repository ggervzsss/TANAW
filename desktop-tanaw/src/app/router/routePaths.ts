export const routePaths = {
  home: "/",
  login: "/login",
  enterprise: "/enterprise",
  enterpriseDashboard: "/enterprise/dashboard",
  enterpriseCameras: "/enterprise/cameras",
  enterpriseReports: "/enterprise/reports",
  enterpriseSimulation: "/enterprise/simulation",
  enterpriseProfile: "/enterprise/profile",
  enterpriseSecurity: "/enterprise/security",
  enterpriseNotifications: "/enterprise/notifications",
  enterpriseTickets: "/enterprise/tickets",
} as const;

export type AppRoute = (typeof routePaths)[keyof typeof routePaths];
