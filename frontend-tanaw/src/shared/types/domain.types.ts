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
  /** Each configured camera as the enterprise desktop last reported it. */
  cameras?: CameraMonitoringCamera[];
};

export type CameraMonitoringCamera = {
  cameraId: number;
  cameraName: string;
  status: "stopped" | "starting" | "running" | "error";
  running: boolean;
  error: string | null;
};

export type MapEnterprise = {
  id: string;
  name: string;
  barangay: string;
  category: string;
  fullAddress: string;
  lat: number;
  lng: number;
  totalLiveOccupancy: number | null;
  estimatedUniqueCount: number | null;
  monitoringStatus: MonitoringStatus;
  occupancyStatus: OccupancyStatus;
  cameraMonitoring: CameraMonitoringSummary | null;
  contact?: string;
  trend?: "Up" | "Stable" | "Down";
  lastSync?: string | null;
  gatewayStatus?: GatewayStatus;
  /** What the pin shows: normal, busy (yellow), camera (red), offline (gray) or closed (faded). */
  pinState?: MapPinStatus;
  openNow?: boolean;
  offlineSince?: string | null;
  closedReason?: string | null;
  alerts?: MapEnterpriseAlert[];
};

export type MapPinStatus = ApiSchemas["MapEnterpriseSummary"]["pinState"];
export type MapEnterpriseAlert = ApiSchemas["MapEnterpriseAlert"];

export type VisitorInsightRange = "today" | "7d" | "30d";
export type VisitorActivityLevel = "Usual" | "Busier Than Usual" | "No Recent Baseline";

export type VisitorInsightPoint = {
  startAt: string;
  label: string;
  averageVisitors: number | null;
  peakVisitors: number | null;
  estimatedUniqueCount?: number | null;
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
  /** The preset range, or null when the request chose its days with start and end. */
  range: VisitorInsightRange | null;
  /** The days asked for (ISO, Philippine time) when chosen by date. */
  start?: string | null;
  end?: string | null;
  scopeType: "city" | "barangay" | "enterprise";
  scopeId: string | null;
  scopeName: string;
  currentVisitors: number | null;
  typicalVisitors: number | null;
  differencePercent: number | null;
  comparisonMessage: string;
  busiestEnterprise: VisitorInsightEnterprise | null;
  busiestPeriodLabel: string | null;
  series: VisitorInsightPoint[];
  unusuallyBusy: VisitorInsightEnterprise[];
  lastUpdatedAt: string | null;
};

/** A live alert: a place busier than usual, or a camera that is not counting. */
export type LiveAlert = ApiSchemas["OperationalAlertSummary"];
export type LiveAlertType = LiveAlert["type"];

export type OperationalSummary = ApiSchemas["OperationalSummary"];

/** The six groups Activity is filtered by, the same for the Admin and IT. */
export type ActivityGroup = ApiSchemas["ActivityLogSummary"]["group"];
export type SystemLogActorRole = "Admin" | "IT Personnel" | "LGU Staff" | "Enterprise Account" | "System";

export type SystemLog = {
  id: string;
  timestamp: string;
  group: ActivityGroup;
  severity: LogSeverity;
  actor: string;
  actorRole: SystemLogActorRole;
  action: string;
  target: string;
  summary: string;
  /** Technical details for IT, such as the camera or the error. Never sent to the Admin. */
  itDetail?: string | null;
  sourceId?: string | null;
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
    entry: number | null;
    exit: number | null;
    unique: number;
    peak: string | null;
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
