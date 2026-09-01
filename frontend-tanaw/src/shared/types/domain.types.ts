export type MonitoringStatus = "Fully Monitoring" | "Partially Monitoring" | "Stopped" | "Fault" | "Offline" | "Not Configured" | "Updates Delayed";
export type OccupancyStatus = "Normal" | "Warning" | "High Occupancy" | "No Data";
export type GatewayStatus = "Connected" | "Sync Delayed" | "Offline" | "Not Linked" | "Closed";
export type AlertSeverity = "Info" | "Warning" | "Critical";
export type LogSeverity = AlertSeverity | "Success";

export type CameraMonitoringSummary = {
  status: "not_configured" | "stopped" | "partial" | "running" | "error";
  configuredCameraCount: number;
  activeCameraCount: number;
  healthyCameraCount: number;
  startingCameraCount: number;
  stoppedCameraCount: number;
  errorCameraCount: number;
};

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
  monitoringStatus: MonitoringStatus;
  occupancyStatus: OccupancyStatus;
  cameraMonitoring: CameraMonitoringSummary | null;
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

export type OperationalSummary = ApiSchemas["OperationalSummary"];

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
export type ReportDemographics = ApiSchemas["ReportDemographicsSummary"];

export type ReportPayload = Record<string, unknown> & {
  demo?: Partial<Record<keyof ReportDemographics, number | string>>;
};

export type IntakeReport = Omit<ApiIntakeReport, "demographics" | "metrics" | "payload" | "status" | "submittedAt"> & {
  demographics?: ReportDemographics | null;
  status: Exclude<ReportStatus, "Missing">;
  metrics: {
    entry: number;
    exit: number;
    unique: number;
    peak: string;
  };
  payload?: ReportPayload | null;
  submittedAt?: string;
};

export type ReportEnterprise = {
  id: string;
  name: string;
  category: string;
  barangay: string;
  complianceOwner: string;
};

export type FinalReportSource = ApiSchemas["FinalReportSourceSummary"];
export type FinalReport = ApiFinalReport;
import type { ApiFinalReport, ApiIntakeReport, ApiSchemas } from "@/contracts/api";
