/*
 * Where the Overview links to. These are the IT screens' addresses; once `routes.it.*` and
 * `itEnterprisePath` are wired in the router, this helper can read from them instead.
 */
export const itOverviewPaths = {
  requests: "/it/requests",
  enterprises: "/it/enterprises",
  personnel: "/it/personnel",
  emailLog: "/it/system?tab=email",
  request: (requestId: string) => `/it/requests?${new URLSearchParams({ request: requestId })}`,
  enterprise: (enterpriseId: string) => `/it/enterprises/${encodeURIComponent(enterpriseId)}`,
} as const;
