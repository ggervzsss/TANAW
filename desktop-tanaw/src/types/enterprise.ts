export type SystemLogPeriod = string;

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

export type AuditEntry = {
  time: string;
  action: string;
  actor: string;
};

export type ReportRecord = {
  id: string;
  date: string;
  status: string;
  entries: number;
  exits?: number;
  peak?: number;
  unique: number;
  period?: SystemLogPeriod;
  deadline?: string;
  dueDate?: string;
  submissionDeadline?: string;
  submittedAt?: string;
  syncStatus?: string;
  demo?: DemoBreakdown;
  notes?: string;
  auditTrail?: AuditEntry[];
  remarks?: string | null;
};

export type ProcessingProfile = "auto" | "compatibility" | "balanced" | "high_accuracy" | "emergency";
export type ReIdMode = "auto" | "off" | "fast" | "quality";
export type UniqueCountingMode = "entry_only" | "estimated_reid";
export type CameraStatus = "untested" | "online" | "offline" | "starting" | "connecting" | "running" | "degraded" | "reconnecting" | "stopped" | "failed" | "error";
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
  rtsp: string;
  cameraHost?: string;
  rtspStream?: "stream1" | "stream2";
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
export type EnterpriseView = "dashboard" | "cameras" | "reports" | "profile" | "security" | "notifications" | "tickets";

export type EnterpriseNotification = {
  id: number;
  backendId?: string;
  type: string;
  message: string;
  time: string;
  sortTime?: number;
  read: boolean;
  target: EnterpriseView;
};
