export type SystemLogPeriod = string;

export type CanonicalReportingPeriod = {
  periodId: string;
  label: string;
  startsAtUtc: string;
  endsAtUtc: string;
};

export type Metrics = {
  entries: number;
  exits: number;
  peak: number;
  unique: number;
};

export type DemoBreakdown = {
  thisProvMale: string;
  thisProvFemale: string;
  otherProvMale: string;
  otherProvFemale: string;
  foreignMale: string;
  foreignFemale: string;
};

export type DemographicEvidence = {
  provenance: "operator_entered";
  quality: "confirmed" | "degraded" | "estimated";
};

export type AuditEntry = {
  time: string;
  action: string;
  actor: string;
};

export type ReportRecord = {
  id: string;
  centralReportId?: string;
  centralDetailLoaded?: boolean;
  localRevisionId?: string;
  metricsUnavailable?: string[];
  date: string;
  status: string;
  entries: number;
  exits?: number;
  peak?: number;
  unique: number;
  period?: SystemLogPeriod;
  reportingPeriod?: CanonicalReportingPeriod;
  deadline?: string;
  dueDate?: string;
  submissionDeadline?: string;
  submittedAt?: string;
  syncStatus?: string;
  demo?: DemoBreakdown;
  demographicEvidence?: DemographicEvidence;
  notes?: string;
  auditTrail?: AuditEntry[];
  remarks?: string | null;
};

export type CameraType = "IP_WEBCAM" | "RTSP_CCTV" | "USB_WEBCAM" | "ONVIF_CCTV";
export type ProcessingProfile = "auto" | "compatibility" | "balanced" | "high_accuracy" | "emergency";
export type RuntimeBackend = "auto" | "cuda" | "openvino" | "cpu";
export type TrackerProfile = "auto" | "bytetrack" | "botsort";
export type ReIdMode = "auto" | "off" | "fast" | "quality";
export type UniqueCountingMode = "entry_only" | "estimated_reid";
export type CameraStatus = "untested" | "online" | "offline" | "running" | "stopped" | "error";
export type TripwirePoint = { x: number; y: number };
export type TripwireCurveMode = "linear" | "smooth";
export type TripwireLine = {
  start: TripwirePoint;
  end: TripwirePoint;
  points?: TripwirePoint[];
  curve?: TripwireCurveMode;
  sampledPoints?: TripwirePoint[];
};

export type Camera = {
  id: number;
  name: string;
  status: CameraStatus;
  zone: string;
  fps: number;
  resolution: string;
  type: string;
  rtsp: string;
  cameraType: CameraType;
  processingProfile: ProcessingProfile;
  confidence: number;
  trackingConfidence?: number;
  reidMode?: ReIdMode;
  uniqueCountingMode?: UniqueCountingMode;
  username?: string;
  password?: string;
  config: {
    tripwire: number;
    tripwires: {
      entry: TripwireLine;
      exit: TripwireLine;
    };
    roi: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
    reverse: boolean;
  };
};
export type ThemePreference = "light" | "dark" | "system";
export type EnterpriseView = "dashboard" | "cameras" | "reports" | "simulation" | "profile" | "security" | "notifications" | "tickets";

export type EnterpriseNotification = {
  id: number;
  backendId?: string;
  type: string;
  message: string;
  time: string;
  read: boolean;
  target: EnterpriseView;
};
