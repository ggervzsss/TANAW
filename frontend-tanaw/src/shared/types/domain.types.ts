export type EnterpriseStatus = "Normal" | "Warning" | "High Occupancy" | "Issue" | "Offline" | "Inactive";
export type GatewayStatus = "Connected" | "Sync Delayed" | "Offline" | "Not Linked" | "Closed";
export type AlertSeverity = "Info" | "Warning" | "Critical";
export type LogSeverity = AlertSeverity | "Success";

export type MapEnterprise = {
  id: string;
  name: string;
  barangay: string;
  category: string;
  fullAddress: string;
  lat: number;
  lng: number;
  totalLiveOccupancy: number;
  estimatedUniqueCount: number;
  status: EnterpriseStatus;
  operatingHours?: string;
  contact?: string;
  trend?: "Up" | "Stable" | "Down";
  lastSync?: string;
  gatewayStatus?: GatewayStatus;
};

export type VisitorInsightRange = "today" | "7d" | "30d";
export type VisitorActivityLevel = "Usual" | "Busier Than Usual" | "No Recent Baseline";

export type VisitorInsightPoint = {
  startAt: string;
  label: string;
  averageVisitors: number;
  peakVisitors: number;
};

export type VisitorInsightEnterprise = {
  enterpriseId: string;
  enterpriseName: string;
  barangay: string;
  currentVisitors: number;
  typicalVisitors: number | null;
  differencePercent: number | null;
  activityLevel: VisitorActivityLevel;
};

export type VisitorInsights = {
  range: VisitorInsightRange;
  scopeType: "city" | "barangay" | "enterprise";
  scopeId: string | null;
  scopeName: string;
  currentVisitors: number;
  typicalVisitors: number | null;
  differencePercent: number | null;
  comparisonMessage: string;
  busiestEnterprise: VisitorInsightEnterprise | null;
  busiestPeriodLabel: string | null;
  series: VisitorInsightPoint[];
  unusuallyBusy: VisitorInsightEnterprise[];
  lastUpdatedAt: string | null;
};

export type PriorityAlertType = "Maintenance Request" | "Password Reset Request" | "Submission Delay" | "Foot Traffic Alert" | "Occupancy Spike" | "Failed Login Threshold";
export type PriorityAlertResolutionMode = "On-site Visit Required" | "In-system Action" | "Staff Follow-up" | "Remote Review" | "Admin Monitoring";
export type PriorityAlertStatus = "New" | "In Review" | "Resolved";
export type PriorityAlertOwner = "IT" | "Admin" | "System";
export type TechnicalIssueUrgency = "Normal" | "Important" | "Urgent";

export type PriorityAlert = {
  id: string;
  type: PriorityAlertType;
  severity: AlertSeverity;
  urgency: TechnicalIssueUrgency;
  enterprise?: string;
  requester: string;
  summary: string;
  requiredAction: string;
  resolutionMode: PriorityAlertResolutionMode;
  status: PriorityAlertStatus;
  owner: PriorityAlertOwner;
  time: string;
};

export type OperationalSummary = {
  enterpriseCount: number;
  onlineGateways: number;
  delayedGateways: number;
  offlineGateways: number;
  totalCurrentOccupancy: number;
  totalEntries: number;
  totalExits: number;
  totalUniqueCount: number;
  activeReports: number;
  pendingReports: number;
  lastSyncAt?: string | null;
};

export type SystemLogCategory = "IT Activity" | "Staff Submission" | "Staff Operation" | "Admin Operation" | "Enterprise Activity" | "System";
export type SystemLogActorRole = "Admin" | "IT Personnel" | "LGU Staff" | "Enterprise Account" | "System";

export type SystemLog = {
  id: string;
  timestamp: string;
  category: SystemLogCategory;
  severity: LogSeverity;
  actor: string;
  actorRole: SystemLogActorRole;
  action: string;
  target: string;
  summary: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ReportStatus = "Pending Review" | "Ready to Consolidate" | "Returned" | "Consolidated" | "Missing";
export type FinalReportArchivedFromStatus = "Draft" | "Finalized" | "Returned for Revision";
export type FinalReportStatus = FinalReportArchivedFromStatus | "Archived";
export type ReportDemographics = {
  thisProvMale: number;
  thisProvFemale: number;
  otherProvMale: number;
  otherProvFemale: number;
  foreignMale: number;
  foreignFemale: number;
};

export type ReportPayload = Record<string, unknown> & {
  demo?: Partial<Record<keyof ReportDemographics, number | string>>;
};

export type IntakeReport = {
  id: string;
  enterpriseId: string;
  enterprise: string;
  category: string;
  barangay: string;
  month: string;
  period: string;
  submitted: string;
  submittedAt?: string;
  status: ReportStatus;
  code: string;
  remarks?: string;
  notes?: string;
  metrics: {
    entry: number;
    exit: number;
    unique: number;
    peak: string;
  };
  payload?: ReportPayload | null;
  demographics?: ReportDemographics | null;
};

export type ReportEnterprise = {
  id: string;
  name: string;
  category: string;
  barangay: string;
  complianceOwner: string;
};

export type FinalReportSource = {
  id: string;
  enterprise: string;
  code: string;
  unique: number;
  entry: number;
  exit: number;
  demographics?: ReportDemographics | null;
};

export type FinalReport = {
  id: string;
  title: string;
  period: string;
  generatedOn: string;
  preparedBy: string;
  preparedRole: string;
  status: FinalReportStatus;
  archivedFromStatus?: FinalReportArchivedFromStatus | null;
  totalEntry: number;
  totalExit: number;
  totalUnique: number;
  enterpriseCount: number;
  sources: FinalReportSource[];
};
