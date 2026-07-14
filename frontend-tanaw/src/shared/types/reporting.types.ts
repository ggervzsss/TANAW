export type DecimalString = string;

export type ReportWorkflowState = "submitted" | "returned" | "accepted" | "consolidated";
export type ReportTransitionAction = "return_for_correction" | "accept_revision" | "reopen_before_finalization";
export type FinalReportScopeType = "citywide" | "barangay" | "enterprise_selection";
export type EvidenceStatus = "complete" | "incomplete";
export type CoverageEvidenceStatus = "recorded" | "not_recorded";
export type MetricQuality = "confirmed" | "degraded" | "estimated" | "unknown";
export type ReportingPeriodStatus = "scheduled" | "open" | "closed";

export type CursorPageInfo = {
  limit: number;
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type ReportingPeriodResource = {
  reportingPeriodId: string;
  naturalKey: string;
  label: string;
  cadence: "month";
  timezone: "Asia/Manila";
  startsAt: string;
  endsAt: string;
  submissionOpensAt: string;
  submissionClosesAt: string;
  status: ReportingPeriodStatus;
  obligationsFrozenAt: string | null;
};

export type ReportingPeriodDiscoveryResource = ReportingPeriodResource & {
  contractVersion: 2;
  complianceClassification: "official";
  localStartDate: string;
  localEndDate: string;
  compliance: ObligationSummary;
};

export type ReportingPeriodPage = {
  items: ReportingPeriodDiscoveryResource[];
  page: CursorPageInfo;
};

export type ReportingPeriodLifecycleResult = {
  contractVersion: 2;
  evaluatedAt: string;
  ensuredPeriodCount: number;
  createdCount: number;
  transitionedCount: number;
  frozenCount: number;
  periods: ReportingPeriodDiscoveryResource[];
};

export type ReportEnterpriseResource = {
  enterpriseId: string;
  enterpriseCode: string;
  enterpriseName: string;
  category: string | null;
};

export type ReportSiteResource = {
  siteId: string;
  siteCode: string;
  siteName: string;
  frozenBarangay: string | null;
};

export type ReportObligationResource = {
  reportingObligationId: string;
  eligibilityStatus: "eligible" | "exempt" | "ineligible" | "unknown";
  eligibilityBasis: "registry_snapshot" | "migration_evidence" | "manual_resolution";
  exemptionReason: string | null;
  registrationEffectiveAt: string | null;
  acceptanceBlocked: boolean;
};

export type ReportCoverageGapResource = {
  reason: string;
  durationSeconds: number;
};

export type ReportCoverageResource = {
  evidenceStatus: CoverageEvidenceStatus;
  monitoredSeconds: number | null;
  expectedSeconds: number | null;
  coverageRatio: number | null;
  gapCount: number | null;
  gaps: ReportCoverageGapResource[];
};

export type MetricCoverageResource = Omit<ReportCoverageResource, "gaps">;

export type ReportMetricFactResource = {
  metricFactId: string;
  definition: string;
  definitionVersion: number;
  value: DecimalString | null;
  unit: string;
  grain: "camera" | "site" | "enterprise";
  windowStart: string;
  windowEnd: string;
  timezone: "Asia/Manila";
  provenance: "camera_derived" | "operator_entered" | "system_derived";
  quality: MetricQuality;
  coverage: MetricCoverageResource;
};

export type ReportDemographicFactResource = {
  demographicFactId: string;
  dimension: string;
  value: string;
  count: number;
  percentage: DecimalString | null;
  provenance: "operator_entered" | "system_derived";
  quality: Exclude<MetricQuality, "unknown">;
};

export type ReportSourceBatchResource = {
  batchId: string;
  cameraId: string;
  eventCount: number;
  eventSequenceStart: number;
  eventSequenceEndExclusive: number;
  aggregateHash: string;
};

export type ReportRevisionSummaryResource = {
  reportRevisionId: string;
  localRevisionId: string;
  revisionNumber: number;
  isCurrent: boolean;
  isAccepted: boolean;
  submittedAt: string;
  receivedAt: string;
  payloadHash: string;
  evidenceStatus: EvidenceStatus;
  acceptanceBlocked: boolean;
  coverage: ReportCoverageResource;
  metrics: ReportMetricFactResource[];
};

export type ReportRevisionResource = ReportRevisionSummaryResource & {
  idempotencyKey: string;
  sourceWindowStart: string;
  sourceWindowEnd: string;
  submittedByAccountId: string;
  notes: string | null;
  demographics: ReportDemographicFactResource[];
  sourceBatches: ReportSourceBatchResource[];
};

export type ReportReviewEventResource = {
  reviewEventId: string;
  reportRevisionId: string;
  eventType: "revision_submitted" | "returned" | "accepted" | "reopened" | "consolidated" | "migration_state_imported";
  fromState: ReportWorkflowState | null;
  toState: ReportWorkflowState;
  actor: {
    accountId: string | null;
    displayName: string | null;
    role: string | null;
  };
  reason: string | null;
  commandId: string;
  expectedVersion: number;
  resultingVersion: number;
  occurredAt: string;
};

export type EnterpriseReportListItem = {
  enterpriseReportId: string;
  classification: "official";
  workflowState: ReportWorkflowState;
  logicalVersion: number;
  currentRevisionId: string;
  acceptedRevisionId: string | null;
  includedInOfficialTotals: boolean;
  acceptanceBlocked: boolean;
  reportingPeriod: ReportingPeriodResource;
  obligation: ReportObligationResource;
  enterprise: ReportEnterpriseResource;
  site: ReportSiteResource;
  currentRevision: ReportRevisionSummaryResource;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseReportPage = {
  contractVersion: 2;
  classification: "official";
  items: EnterpriseReportListItem[];
  page: CursorPageInfo;
};

export type EnterpriseReportDetail = EnterpriseReportListItem & {
  contractVersion: 2;
  revisions: ReportRevisionResource[];
  reviewEvents: ReportReviewEventResource[];
};

export type ReportTransitionCommand = {
  contractVersion: 2;
  commandId: string;
  expectedVersion: number;
  action: ReportTransitionAction;
  reason: string | null;
};

export type ReportTransitionAcknowledgement = {
  contractVersion: 2;
  commandId: string;
  disposition: "applied" | "replayed";
  acknowledgedAt: string;
  resource: {
    enterpriseReportId: string;
    reportRevisionId: string;
    workflowState: "returned" | "accepted";
    logicalVersion: number;
  };
};

export type ComplianceStatus = "not_submitted" | "submitted" | "returned" | "accepted" | "consolidated";

export type ObligationResource = {
  obligationId: string;
  enterpriseId: string;
  enterpriseOfficialCode: string;
  enterpriseName: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  classification: "official" | "simulation";
  eligibilityStatus: "eligible" | "exempt" | "ineligible" | "unknown";
  eligibilityBasis: "registry_snapshot" | "migration_evidence" | "manual_resolution";
  eligibilityReason: string | null;
  frozenBarangay: string | null;
  timezone: "Asia/Manila";
  registrationEffectiveAt: string | null;
  acceptanceBlocked: boolean;
  complianceStatus: ComplianceStatus | null;
  enterpriseReportId: string | null;
  logicalVersion: number | null;
};

export type ObligationSummary = {
  totalFrozen: number;
  eligibleExpected: number;
  exempt: number;
  ineligible: number;
  unresolved: number;
  notSubmitted: number;
  submitted: number;
  returned: number;
  accepted: number;
  consolidated: number;
  complete: boolean;
};

export type PeriodComplianceResource = {
  reportingPeriodId: string;
  periodKey: string;
  periodLabel: string;
  timezone: "Asia/Manila";
  startsAt: string;
  endsAt: string;
  submissionOpensAt: string;
  submissionClosesAt: string;
  status: ReportingPeriodStatus;
  frozen: true;
  frozenAt: string;
  summary: ObligationSummary;
  obligations: ObligationResource[];
};

export type ObligationResolutionCommand = {
  siteId: string;
  eligibilityStatus: "eligible" | "exempt" | "ineligible";
  reason: string | null;
  frozenBarangay: string | null;
};

export type ObligationFreezeCommand = {
  contractVersion: 2;
  commandId: string;
  resolutions: ObligationResolutionCommand[];
};

export type ObligationFreezeAcknowledgement = {
  contractVersion: 2;
  commandId: string;
  disposition: "created" | "reconciled" | "replayed";
  acknowledgedAt: string;
  resource: PeriodComplianceResource;
};

export type ReminderIntentAcknowledgement = {
  contractVersion: 2;
  commandId: string;
  disposition: "created" | "replayed";
  acknowledgedAt: string;
  reportingPeriodId: string;
  periodKey: string;
  phase: "pre_window" | "current_period" | "overdue";
  createdCount: number;
  existingCount: number;
  skippedCount: number;
  eventIds: string[];
};

export type FinalReportScopeResource = {
  type: FinalReportScopeType;
  barangay: string | null;
  label: string;
  memberCount: number;
};

export type FinalReportArtifactResource = {
  artifactId: string;
  status: "pending" | "ready" | "failed";
  templateVersion: string;
  mimeType: string;
  contentHash: string | null;
  generationAttempts: number;
  lastErrorCode: string | null;
  generatedAt: string | null;
  generatedByAccountId: string | null;
  downloadAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FinalReportArtifactDetail = FinalReportArtifactResource & {
  contractVersion: 2;
  reportFinalizationId: string;
  finalReportVersionId: string;
  sizeBytes: number | null;
};

export type FinalReportVersionSummaryResource = {
  finalReportVersionId: string;
  versionNumber: number;
  disposition: "current" | "superseded";
  scope: FinalReportScopeResource;
  sourceCount: number;
  contentHash: string;
  preparedBy: {
    accountId: string | null;
    name: string;
    role: string;
  };
  finalizedAt: string;
  artifacts: FinalReportArtifactResource[];
  createdAt: string;
};

export type FinalReportScopeMemberResource = {
  scopeMemberId: string;
  reportingObligationId: string;
  enterpriseId: string;
  enterpriseOfficialCode: string;
  enterpriseName: string;
  enterpriseCategory: string | null;
  siteId: string;
  siteCode: string;
  siteName: string;
  frozenBarangay: string | null;
};

export type FinalReportItemResource = {
  finalReportItemId: string;
  reportingObligationId: string;
  reportRevisionId: string;
  sourcePayloadHash: string;
};

export type FinalReportMetricFactResource = {
  metricFactId: string;
  definition: string;
  definitionVersion: number;
  value: DecimalString | null;
  unit: string;
  aggregationMethod: "sum" | "maximum" | "summed_site_estimate";
  quality: MetricQuality;
  sourceFactCount: number;
};

export type FinalReportDemographicFactResource = {
  demographicFactId: string;
  dimension: string;
  value: string;
  count: number;
  percentage: DecimalString | null;
  quality: Exclude<MetricQuality, "unknown">;
  sourceFactCount: number;
};

export type FinalReportEventResource = {
  finalReportEventId: string;
  finalReportVersionId: string;
  eventType: "version_finalized" | "migration_final_imported";
  actorAccountId: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  commandId: string | null;
  expectedVersion: number;
  resultingVersion: number;
  reason: string | null;
  occurredAt: string;
};

export type FinalReportVersionResource = FinalReportVersionSummaryResource & {
  scopeMembers: FinalReportScopeMemberResource[];
  items: FinalReportItemResource[];
  metrics: FinalReportMetricFactResource[];
  demographics: FinalReportDemographicFactResource[];
};

export type FinalReportListItem = {
  reportFinalizationId: string;
  reportCode: string;
  reportingPeriod: ReportingPeriodResource;
  classification: "official";
  logicalVersion: number;
  currentVersionId: string;
  currentVersion: FinalReportVersionSummaryResource;
  createdByAccountId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinalReportPage = {
  contractVersion: 2;
  classification: "official";
  items: FinalReportListItem[];
  page: CursorPageInfo;
};

export type FinalReportDetail = FinalReportListItem & {
  contractVersion: 2;
  selectedVersionId: string;
  selectedVersionIsCurrent: boolean;
  versions: FinalReportVersionSummaryResource[];
  selectedVersion: FinalReportVersionResource;
  events: FinalReportEventResource[];
};

export type FinalizeReportsCommand = {
  contractVersion: 2;
  commandId: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedVersion: number;
  payload: {
    targetFinalizationId: string | null;
    reportingPeriodId: string;
    scope: {
      type: FinalReportScopeType;
      barangay: string | null;
    };
    reportRevisionIds: string[];
    reason: string | null;
  };
};

export type FinalizationAcknowledgement = {
  contractVersion: 2;
  commandId: string;
  disposition: "created" | "replayed";
  payloadHash: string;
  acknowledgedAt: string;
  resource: {
    reportFinalizationId: string;
    finalReportVersionId: string;
    reportCode: string;
    reportingPeriodId: string;
    classification: "official";
    versionNumber: number;
    logicalVersion: number;
    scopeType: FinalReportScopeType;
    scopeLabel: string;
    sourceCount: number;
    artifactStatus: "pending";
  };
};
