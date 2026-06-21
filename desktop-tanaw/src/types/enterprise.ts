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

export type CameraType = "IP_WEBCAM" | "RTSP_CCTV" | "USB_WEBCAM" | "ONVIF_CCTV";
export type ProcessingProfile = "auto" | "cpu" | "accelerated";
export type CameraStatus = "untested" | "online" | "offline" | "running" | "stopped" | "error";
export type TripwirePoint = { x: number; y: number };
export type TripwireLine = { start: TripwirePoint; end: TripwirePoint };

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
export type EnterpriseView = "dashboard" | "cameras" | "reports" | "profile" | "security";

export type EnterpriseNotification = {
  id: number;
  type: string;
  message: string;
  time: string;
  read: boolean;
  target: EnterpriseView;
};
