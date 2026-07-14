export type EnterpriseStatus = "Normal" | "Warning" | "Critical" | "No Data";
export type CameraStatus = "Online" | "Offline" | "Unstable";
export type GatewayStatus = "Connected" | "Sync Delayed" | "Offline" | "Not Linked" | "Closed";
export type AlertSeverity = "Info" | "Warning" | "Critical";
export type LogSeverity = AlertSeverity | "Success";

export type MapEnterprise = {
  id: string;
  enterpriseId: string;
  name: string;
  barangay: string;
  category: string;
  fullAddress: string;
  lat: number;
  lng: number;
  totalLiveOccupancy: number | null;
  estimatedUniqueCount: number | null;
  status: EnterpriseStatus;
  operatingHours?: string;
  contact?: string;
  trend?: "Up" | "Stable" | "Down";
  lastSync?: string;
  gatewayStatus?: GatewayStatus;
  freshnessState?: "fresh" | "stale" | "offline";
  topologyStatus?: "ready" | "unlinked" | "ambiguous";
};

export type MapSite = Omit<MapEnterprise, "lat" | "lng"> & {
  lat: number | null;
  lng: number | null;
};

export type Enterprise = {
  id: string;
  enterpriseName: string;
  barangay: string;
  status: "Active" | "Archived";
  category: string;
  gatewayStatus: GatewayStatus;
};

export type SystemActivityType = "LOGIN" | "CONNECTION" | "ACCOUNT CONFIG" | "ENTERPRISE CONFIG" | "IT ACTION" | "SYSTEM";
export type SystemActivityTimePeriod = "Today" | "Earlier";
export type SystemActivityDeviceState = "Offline" | "Delayed" | "Healthy";

export type SystemActivity = {
  id: string;
  severity: AlertSeverity;
  type: SystemActivityType;
  time: string;
  initiatedBy: string;
  enterprise?: string;
  device?: string;
  accountName?: string;
  summary: string;
  recommendedAction: string;
  timePeriod: SystemActivityTimePeriod;
  actorType: "LGU Account" | "Enterprise Account" | "IT Personnel" | "System";
  target?: string;
  deviceState?: SystemActivityDeviceState;
  requiresEnterpriseAttention?: boolean;
};

export type PriorityAlertType = "Maintenance Request" | "Password Reset Request" | "Submission Delay" | "Threshold Breach" | "Foot Traffic Alert" | "Occupancy Spike" | "Failed Login Threshold" | "Sync Delay";
export type PriorityAlertResolutionMode = "On-site Visit Required" | "In-system Action" | "Staff Follow-up" | "Remote Review" | "Admin Monitoring" | "Automatic Health Recovery";
export type PriorityAlertStatus = "New" | "In Review" | "Resolved";
export type PriorityAlertOwner = "IT" | "Admin" | "System";

export type PriorityAlert = {
  id: string;
  type: PriorityAlertType;
  severity: AlertSeverity;
  enterprise?: string;
  requester: string;
  summary: string;
  requiredAction: string;
  resolutionMode: PriorityAlertResolutionMode;
  status: PriorityAlertStatus;
  owner: PriorityAlertOwner;
  time: string;
};

export type PipelineAlert = {
  id: string;
  severity: AlertSeverity;
  device: string;
  msg: string;
  status: "New" | "Acknowledged" | "Resolved";
  time: string;
};

export type PipelineHealth = {
  enterpriseId: string;
  name: string;
  barangay: string;
  gatewayStatus: GatewayStatus;
  warnings: PipelineAlert[];
};

export type TelemetrySnapshot = {
  id: string;
  enterpriseId: string;
  enterpriseName: string;
  category?: string | null;
  barangay?: string | null;
  cameraId?: string | null;
  cameraName?: string | null;
  capturedAt: string;
  receivedAt: string;
  entries: number;
  exits: number;
  currentOccupancy: number;
  peakOccupancy: number;
  uniqueCount: number;
  confirmedUniqueCount: number;
  degradedUniqueCount: number;
  totalEvents: number;
  unsubmittedEvents: number;
  unsyncedEvents: number;
  running: boolean;
  status: string;
  error?: string | null;
  analyticsFps?: number | null;
  gatewayStatus: GatewayStatus;
  sourceKind: "real" | "mock" | "hybrid";
  mockRunId?: string | null;
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

export type LguAccountRoleLabel = "Admin" | "IT Personnel" | "LGU Staff";
export type LguAccountStatus = "Active" | "Inactive";
export type EnterpriseAccountStatus = "Active" | "Archived" | "Suspended";

export type LguAccount = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: LguAccountRoleLabel;
  status: LguAccountStatus;
  phone: string;
  lastLogin: string;
  createdAt: string;
};

export type EnterpriseCamera = {
  id: string;
  name: string;
  location: string;
  rtspStatus: string;
  onvifStatus: string;
  status: CameraStatus;
  lastChecked: string;
};

export type EnterpriseAccount = {
  id: string;
  enterpriseName: string;
  category: string;
  managerName: string;
  email: string;
  contactNumber: string;
  barangay: string;
  address: string;
  gatewayStatus: GatewayStatus;
  gatewayId?: string;
  accountStatus: EnterpriseAccountStatus;
  lastSync: string;
  cameras: EnterpriseCamera[];
};
