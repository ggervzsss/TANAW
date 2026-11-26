export const routes = {
  home: "/",
  login: "/login",
  activateAccount: "/activate-account",
  verifyEmailChange: "/verify-email-change",
  enterpriseAccess: "/enterprise-access",
  it: {
    root: "/it",
    generalSettings: "/it/settings",
    dashboard: "/it/dashboard",
    requests: "/it/requests",
    enterprises: "/it/enterprises",
    enterpriseManage: "/it/enterprises/:enterpriseId",
    personnel: "/it/personnel",
    system: "/it/system",
    notifications: "/it/notifications",
    devLog: "/it/dev-log",
    profile: "/it/settings/profile",
    security: "/it/settings/security",
    displayPreferences: "/it/settings/appearance",
    help: "/it/help",
  },
  admin: {
    root: "/admin",
    generalSettings: "/admin/settings",
    dashboard: "/admin/dashboard",
    enterprises: "/admin/enterprises",
    enterpriseDetails: "/admin/enterprises/:enterpriseId",
    reports: "/admin/reports",
    activity: "/admin/activity",
    requests: "/admin/requests",
    profile: "/admin/settings/profile",
    security: "/admin/settings/security",
    displayPreferences: "/admin/settings/appearance",
    help: "/admin/help",
  },
  staff: {
    root: "/staff",
    generalSettings: "/staff/settings",
    reports: "/staff/reports",
    consolidatedReports: "/staff/consolidated-reports",
    notifications: "/staff/notifications",
    profile: "/staff/settings/profile",
    security: "/staff/settings/security",
    displayPreferences: "/staff/settings/appearance",
    help: "/staff/help",
  },
} as const;

/** The Enterprise Details page for one enterprise, by its enterprise ID (as on the map and in reports). */
export function adminEnterpriseDetailsPath(enterpriseId: string) {
  return `${routes.admin.enterprises}/${encodeURIComponent(enterpriseId)}`;
}

/** The IT Manage an enterprise page for one enterprise, optionally on one tab. */
export function itEnterprisePath(enterpriseId: string, tab?: "connection" | "details" | "hours") {
  const path = `${routes.it.enterprises}/${encodeURIComponent(enterpriseId)}`;
  return tab ? `${path}?tab=${tab}` : path;
}

/** An IT System tab: activity, email log or settings. */
export function itSystemPath(tab: "activity" | "email" | "settings") {
  return `${routes.it.system}?tab=${tab}`;
}

/** Old portal addresses kept as redirects, so bookmarks and notification links still land on the new screens. */
export const legacyPortalRedirects = {
  it: [
    ["work-center", routes.it.requests],
    ["enterprise-accounts", routes.it.enterprises],
    ["lgu-accounts", routes.it.personnel],
    ["system-logs", "/it/system?tab=activity"],
    ["system-settings", "/it/system?tab=settings"],
    ["settings/system", "/it/system?tab=settings"],
  ],
  admin: [
    ["mapview", routes.admin.dashboard],
    ["visitor-insights", routes.admin.dashboard],
    ["activity-history", routes.admin.activity],
    ["operations", routes.admin.requests],
  ],
  staff: [
    ["analytics", routes.staff.reports],
    ["batch-reports", routes.staff.reports],
    ["generated-reports", routes.staff.consolidatedReports],
    ["final-reports-audit", routes.staff.consolidatedReports],
  ],
} as const;
