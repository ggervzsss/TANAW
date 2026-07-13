import type { EnterpriseReportDetail, EnterpriseReportListItem, FinalReportDetail, FinalReportListItem, PeriodComplianceResource, ReportingPeriodDiscoveryResource } from "@/shared/types";

export const periodFixture: ReportingPeriodDiscoveryResource = {
  contractVersion: 2,
  complianceClassification: "official",
  reportingPeriodId: "00000000-0000-0000-0000-000000000101",
  naturalKey: "month:Asia/Manila:2026-07",
  label: "July 2026",
  cadence: "month",
  timezone: "Asia/Manila",
  localStartDate: "2026-07-01",
  localEndDate: "2026-08-01",
  startsAt: "2026-06-30T16:00:00Z",
  endsAt: "2026-07-31T16:00:00Z",
  submissionOpensAt: "2026-07-31T16:00:00Z",
  submissionClosesAt: "2026-08-15T16:00:00Z",
  status: "closed",
  obligationsFrozenAt: "2026-06-24T00:00:00Z",
  compliance: { totalFrozen: 2, eligibleExpected: 2, exempt: 0, ineligible: 0, unresolved: 0, notSubmitted: 1, submitted: 0, returned: 0, accepted: 1, consolidated: 0, complete: false },
};

export function enterpriseReportFixture(overrides: Partial<EnterpriseReportListItem> = {}): EnterpriseReportListItem {
  return {
    enterpriseReportId: "00000000-0000-0000-0000-000000000201",
    classification: "official",
    workflowState: "accepted",
    logicalVersion: 2,
    currentRevisionId: "00000000-0000-0000-0000-000000000301",
    acceptedRevisionId: "00000000-0000-0000-0000-000000000301",
    includedInOfficialTotals: true,
    acceptanceBlocked: false,
    reportingPeriod: periodFixture,
    obligation: {
      reportingObligationId: "00000000-0000-0000-0000-000000000401",
      eligibilityStatus: "eligible",
      eligibilityBasis: "registry_snapshot",
      exemptionReason: null,
      registrationEffectiveAt: "2026-01-01T00:00:00Z",
      acceptanceBlocked: false,
    },
    enterprise: { enterpriseId: "00000000-0000-0000-0000-000000000501", enterpriseCode: "ENT-001", enterpriseName: "Frozen Enterprise", category: "Attraction" },
    site: { siteId: "00000000-0000-0000-0000-000000000601", siteCode: "SITE-001", siteName: "Frozen Site", frozenBarangay: "Poblacion" },
    currentRevision: {
      reportRevisionId: "00000000-0000-0000-0000-000000000301",
      revisionNumber: 1,
      isCurrent: true,
      isAccepted: true,
      submittedAt: "2026-08-01T01:00:00Z",
      receivedAt: "2026-08-01T01:00:01Z",
      payloadHash: `sha256:${"1".repeat(64)}`,
      evidenceStatus: "complete",
      acceptanceBlocked: false,
      coverage: { evidenceStatus: "recorded", monitoredSeconds: 2678390, expectedSeconds: 2678400, coverageRatio: 0.999996, gapCount: 1, gaps: [{ reason: "stream_unavailable", durationSeconds: 10 }] },
      metrics: [
        metric("entries", "0.100000", "events", "confirmed"),
        metric("exits", "4.000000", "events", "confirmed", "00000000-0000-0000-0000-000000000702"),
        metric("unique_visitor_estimate", "7.250000", "visitor-estimate", "estimated", "00000000-0000-0000-0000-000000000703"),
      ],
    },
    createdAt: "2026-08-01T01:00:01Z",
    updatedAt: "2026-08-01T02:00:00Z",
    ...overrides,
  };
}

export function enterpriseReportDetailFixture(overrides: Partial<EnterpriseReportDetail> = {}): EnterpriseReportDetail {
  const summary = enterpriseReportFixture(overrides);
  return {
    ...summary,
    contractVersion: 2,
    revisions: [
      {
        ...summary.currentRevision,
        localRevisionId: "local-revision-1",
        idempotencyKey: "report:test:1",
        sourceWindowStart: periodFixture.startsAt,
        sourceWindowEnd: periodFixture.endsAt,
        submittedByAccountId: "00000000-0000-0000-0000-000000000801",
        notes: "Recorded operator note.",
        demographics: [{ demographicFactId: "00000000-0000-0000-0000-000000000901", dimension: "residence", value: "local", count: 12, percentage: "0.1000", provenance: "operator_entered", quality: "confirmed" }],
        sourceBatches: [{ batchId: "00000000-0000-0000-0000-000000001001", cameraId: "00000000-0000-0000-0000-000000001101", eventCount: 10, eventSequenceStart: 100, eventSequenceEndExclusive: 110, aggregateHash: `sha256:${"2".repeat(64)}` }],
      },
    ],
    reviewEvents: [{ reviewEventId: "00000000-0000-0000-0000-000000001201", reportRevisionId: summary.currentRevisionId, eventType: "accepted", fromState: "submitted", toState: "accepted", actor: { accountId: "00000000-0000-0000-0000-000000001301", displayName: "Recorded Staff", role: "staff" }, reason: "Evidence verified.", commandId: "00000000-0000-0000-0000-000000001401", expectedVersion: 1, resultingVersion: 2, occurredAt: "2026-08-01T02:00:00Z" }],
    ...overrides,
  };
}

export function finalReportListFixture(overrides: Partial<FinalReportListItem> = {}): FinalReportListItem {
  return {
    reportFinalizationId: "00000000-0000-0000-0000-000000001501",
    reportCode: "FINAL-2026-07-001",
    reportingPeriod: periodFixture,
    classification: "official",
    logicalVersion: 1,
    currentVersionId: "00000000-0000-0000-0000-000000001601",
    currentVersion: {
      finalReportVersionId: "00000000-0000-0000-0000-000000001601",
      versionNumber: 1,
      disposition: "current",
      scope: { type: "barangay", barangay: "Poblacion", label: "Poblacion", memberCount: 1 },
      sourceCount: 1,
      contentHash: `sha256:${"3".repeat(64)}`,
      preparedBy: { accountId: "00000000-0000-0000-0000-000000001301", name: "Recorded Staff", role: "staff" },
      finalizedAt: "2026-08-02T01:00:00Z",
      artifacts: [{ artifactId: "00000000-0000-0000-0000-000000001701", status: "ready", templateVersion: "dot-v2", mimeType: "application/pdf", contentHash: `sha256:${"4".repeat(64)}`, generationAttempts: 1, lastErrorCode: null, generatedAt: "2026-08-02T01:01:00Z", generatedByAccountId: null, downloadAvailable: true, createdAt: "2026-08-02T01:00:00Z", updatedAt: "2026-08-02T01:01:00Z" }],
      createdAt: "2026-08-02T01:00:00Z",
    },
    createdByAccountId: "00000000-0000-0000-0000-000000001301",
    createdAt: "2026-08-02T01:00:00Z",
    updatedAt: "2026-08-02T01:00:00Z",
    ...overrides,
  };
}

export function finalReportDetailFixture(overrides: Partial<FinalReportDetail> = {}): FinalReportDetail {
  const summary = finalReportListFixture(overrides);
  return {
    ...summary,
    contractVersion: 2,
    selectedVersionId: summary.currentVersionId,
    selectedVersionIsCurrent: true,
    versions: [summary.currentVersion],
    selectedVersion: {
      ...summary.currentVersion,
      scopeMembers: [{ scopeMemberId: "00000000-0000-0000-0000-000000001801", reportingObligationId: "00000000-0000-0000-0000-000000000401", enterpriseId: "00000000-0000-0000-0000-000000000501", enterpriseOfficialCode: "ENT-001", enterpriseName: "Frozen Enterprise", enterpriseCategory: "Attraction", siteId: "00000000-0000-0000-0000-000000000601", siteCode: "SITE-001", siteName: "Frozen Site", frozenBarangay: "Poblacion" }],
      items: [{ finalReportItemId: "00000000-0000-0000-0000-000000001901", reportingObligationId: "00000000-0000-0000-0000-000000000401", reportRevisionId: "00000000-0000-0000-0000-000000000301", sourcePayloadHash: `sha256:${"1".repeat(64)}` }],
      metrics: [{ metricFactId: "00000000-0000-0000-0000-000000002001", definition: "entries", definitionVersion: 1, value: "0.100000", unit: "events", aggregationMethod: "sum", quality: "confirmed", sourceFactCount: 1 }],
      demographics: [{ demographicFactId: "00000000-0000-0000-0000-000000002101", dimension: "residence", value: "local", count: 12, percentage: "0.1000", quality: "confirmed", sourceFactCount: 1 }],
    },
    events: [{ finalReportEventId: "00000000-0000-0000-0000-000000002201", finalReportVersionId: summary.currentVersionId, eventType: "version_finalized", actorAccountId: "00000000-0000-0000-0000-000000001301", actorDisplayName: "Recorded Staff", actorRole: "staff", commandId: "00000000-0000-0000-0000-000000002301", expectedVersion: 0, resultingVersion: 1, reason: null, occurredAt: "2026-08-02T01:00:00Z" }],
    ...overrides,
  };
}

export function complianceFixture(overrides: Partial<PeriodComplianceResource> = {}): PeriodComplianceResource {
  return {
    reportingPeriodId: periodFixture.reportingPeriodId,
    periodKey: periodFixture.naturalKey,
    periodLabel: periodFixture.label,
    timezone: "Asia/Manila",
    startsAt: periodFixture.startsAt,
    endsAt: periodFixture.endsAt,
    submissionOpensAt: periodFixture.submissionOpensAt,
    submissionClosesAt: periodFixture.submissionClosesAt,
    status: periodFixture.status,
    frozen: true,
    frozenAt: periodFixture.obligationsFrozenAt!,
    summary: { totalFrozen: 2, eligibleExpected: 2, exempt: 0, ineligible: 0, unresolved: 0, notSubmitted: 1, submitted: 0, returned: 0, accepted: 1, consolidated: 0, complete: false },
    obligations: [
      { obligationId: "00000000-0000-0000-0000-000000000401", enterpriseId: "00000000-0000-0000-0000-000000000501", enterpriseOfficialCode: "ENT-001", enterpriseName: "Frozen Enterprise", siteId: "00000000-0000-0000-0000-000000000601", siteCode: "SITE-001", siteName: "Frozen Site", classification: "official", eligibilityStatus: "eligible", eligibilityBasis: "registry_snapshot", eligibilityReason: null, frozenBarangay: "Poblacion", timezone: "Asia/Manila", registrationEffectiveAt: "2026-01-01T00:00:00Z", acceptanceBlocked: false, complianceStatus: "accepted", enterpriseReportId: "00000000-0000-0000-0000-000000000201", logicalVersion: 2 },
      { obligationId: "00000000-0000-0000-0000-000000000402", enterpriseId: "00000000-0000-0000-0000-000000000502", enterpriseOfficialCode: "ENT-002", enterpriseName: "Missing Enterprise", siteId: "00000000-0000-0000-0000-000000000602", siteCode: "SITE-002", siteName: "Missing Site", classification: "official", eligibilityStatus: "eligible", eligibilityBasis: "registry_snapshot", eligibilityReason: null, frozenBarangay: "San Jose", timezone: "Asia/Manila", registrationEffectiveAt: "2026-01-01T00:00:00Z", acceptanceBlocked: false, complianceStatus: "not_submitted", enterpriseReportId: null, logicalVersion: null },
    ],
    ...overrides,
  };
}

function metric(definition: string, value: string, unit: string, quality: "confirmed" | "estimated", metricFactId = "00000000-0000-0000-0000-000000000701") {
  return { metricFactId, definition, definitionVersion: 1, value, unit, grain: "site" as const, windowStart: periodFixture.startsAt, windowEnd: periodFixture.endsAt, timezone: "Asia/Manila" as const, provenance: "camera_derived" as const, quality, coverage: { evidenceStatus: "recorded" as const, monitoredSeconds: 2678390, expectedSeconds: 2678400, coverageRatio: 0.999996, gapCount: 1 } };
}
