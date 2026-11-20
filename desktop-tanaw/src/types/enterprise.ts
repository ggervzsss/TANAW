export type SystemLogPeriod = string;
import type { EstablishmentSummary } from "../features/camera/services/establishment.types";

export type Metrics = {
  entries: number | null;
  exits: number | null;
  peak: number | null;
  unique: number;
  counting?: EstablishmentSummary;
};

export type DemoBreakdown = {
  /** Optional city subset of thisProv totals; absent on province-only reports. */
  thisCityMale?: string;
  thisCityFemale?: string;
  /** City subset of thisProvUnspecified. */
  thisCityUnspecified?: string;
  thisProvMale: string;
  thisProvFemale: string;
  /** This Province visitors whose sex was not recorded (TANAW does not detect sex yet). */
  thisProvUnspecified?: string;
  otherProvMale: string;
  otherProvFemale: string;
  foreignMale: string;
  foreignFemale: string;
};

/** Visitors from origins TANAW cannot detect, entered for one day. */
export type OriginSexCounts = { male: number; female: number };
export type DayOrigins = { otherCity: OriginSexCounts; otherProvince: OriginSexCounts; foreign: OriginSexCounts };
/** Keyed by business date (YYYY-MM-DD). A day present here has been confirmed by the user. */
export type DailyOrigins = Record<string, DayOrigins>;

export type AuditEntry = {
  time: string;
  action: string;
  actor: string;
};

export type ReportRecord = {
  id: string;
  date: string;
  status: string;
  entries: number | null;
  exits?: number | null;
  peak?: number | null;
  counting?: EstablishmentSummary;
  unique: number;
  period?: SystemLogPeriod;
  deadline?: string;
  dueDate?: string;
  submissionDeadline?: string;
  submittedAt?: string;
  syncStatus?: string;
  demo?: DemoBreakdown;
  /** Visitor origins entered for each day; absent on reports made before daily entry. */
  origins?: DailyOrigins;
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

export type CameraBrand = "tapo" | "tenda" | "dahua" | "custom";

export type AnalysisMode = "entrance_exit" | "open_space";
export type OpenSpaceSettings = {
  zone_id: string;
  zone_name: string;
  polygon: Array<{ x: number; y: number }>;
  entry_confirmation_seconds?: number;
  exit_confirmation_seconds?: number;
  minimum_visit_seconds?: number;
  gap_grace_seconds?: number;
  boundary_tolerance?: number;
};

type CameraConnectionAndProcessing = {
  id: number;
  name: string;
  status: CameraStatus;
  zone: string;
  rtsp: string;
  cameraHost?: string;
  cameraBrand?: CameraBrand;
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
// Existing entrance profiles may omit the discriminator at the construction boundary.
// Public-area profiles always declare their mode and setup/zone state explicitly.
export type Camera = CameraConnectionAndProcessing & ({ analysisMode?: "entrance_exit"; openSpace?: null } | { analysisMode: "open_space"; openSpace: OpenSpaceSettings | null });

export type ThemePreference = "light" | "dark" | "system";
export type EnterpriseView = "dashboard" | "cameras" | "reports" | "profile" | "security" | "notifications" | "tickets" | "settings" | "help";

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
