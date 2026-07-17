CREATE SEQUENCE operational_alert_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE

-- TANAW SCHEMA STATEMENT --

CREATE SEQUENCE report_finalization_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE

-- TANAW SCHEMA STATEMENT --

CREATE SEQUENCE support_ticket_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_enforce_report_acceptance_unblocked()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF NEW.workflow_state IN ('accepted', 'consolidated')
               AND NEW.acceptance_blocked = true THEN
                RAISE EXCEPTION 'Blocked report cannot enter accepted or consolidated state';
            END IF;
            IF NEW.acceptance_blocked = false
               OR NEW.workflow_state IN ('accepted', 'consolidated') THEN
                IF EXISTS (
                    SELECT 1 FROM reporting_obligations obligation
                    WHERE obligation.id = NEW.reporting_obligation_id
                      AND obligation.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.current_revision_id
                      AND revision.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.accepted_revision_id
                      AND revision.acceptance_blocked = true
                ) THEN
                    RAISE EXCEPTION
                        'Report acceptance remains blocked by incomplete evidence';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_device_telemetry_epoch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        DECLARE
            latest device_telemetry_epochs%ROWTYPE;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Device telemetry epochs cannot be deleted';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF OLD.status != 'active' OR NEW.status != 'retired'
                   OR NEW.retired_at IS NULL
                   OR NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.edge_device_id IS DISTINCT FROM OLD.edge_device_id
                   OR NEW.site_id IS DISTINCT FROM OLD.site_id
                   OR NEW.classification IS DISTINCT FROM OLD.classification
                   OR NEW.counter_epoch IS DISTINCT FROM OLD.counter_epoch
                   OR NEW.generation IS DISTINCT FROM OLD.generation
                   OR NEW.previous_epoch_id IS DISTINCT FROM OLD.previous_epoch_id
                   OR NEW.command_id IS DISTINCT FROM OLD.command_id
                   OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
                   OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
                   OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'Epoch updates may only retire the active epoch';
                END IF;
                RETURN NEW;
            END IF;

            SELECT * INTO latest
            FROM device_telemetry_epochs
            WHERE edge_device_id = NEW.edge_device_id
            ORDER BY generation DESC
            LIMIT 1;
            IF NOT FOUND THEN
                IF NEW.generation != 1 OR NEW.previous_epoch_id IS NOT NULL THEN
                    RAISE EXCEPTION 'First telemetry epoch must use generation 1';
                END IF;
            ELSIF NEW.generation != latest.generation + 1
               OR NEW.previous_epoch_id IS DISTINCT FROM latest.id
               OR latest.status != 'retired' THEN
                RAISE EXCEPTION 'Telemetry epoch generation must follow the retired latest epoch';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_domain_event_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF NEW.domain_event_id IS DISTINCT FROM OLD.domain_event_id
               OR NEW.destination IS DISTINCT FROM OLD.destination
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Domain-event delivery identity cannot change';
            END IF;
            IF NEW.attempt_count < OLD.attempt_count THEN
                RAISE EXCEPTION 'Domain-event delivery attempts cannot decrease';
            END IF;
            IF OLD.status IN ('delivered', 'dead_letter') AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION 'Terminal domain-event delivery cannot change';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_final_report_artifact_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'final_report_artifacts cannot be deleted';
            END IF;
            IF NEW.id != OLD.id
               OR NEW.final_report_version_id != OLD.final_report_version_id
               OR NEW.classification != OLD.classification
               OR NEW.template_version != OLD.template_version
               OR NEW.mime_type != OLD.mime_type
               OR NEW.created_at != OLD.created_at THEN
                RAISE EXCEPTION 'Final report artifact identity is immutable';
            END IF;
            IF NOT (
                (OLD.status = 'pending' AND NEW.status IN ('ready', 'failed')) OR
                (OLD.status = 'failed' AND NEW.status = 'pending')
            ) THEN
                RAISE EXCEPTION 'Invalid final report artifact state transition';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_final_report_version_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'final_report_versions are immutable';
            END IF;
            IF OLD.disposition = 'current' AND NEW.disposition = 'superseded'
               AND (to_jsonb(NEW) - 'disposition') = (to_jsonb(OLD) - 'disposition') THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'Final report version facts are immutable; create a new version';
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_report_finalization_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'report_finalizations cannot be deleted';
            END IF;
            IF NEW.id != OLD.id
               OR NEW.reporting_period_id != OLD.reporting_period_id
               OR NEW.classification != OLD.classification
               OR NEW.report_code != OLD.report_code
               OR NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id
               OR NEW.created_at != OLD.created_at
               OR NEW.logical_version != OLD.logical_version + 1
               OR NEW.current_version_id = OLD.current_version_id THEN
                RAISE EXCEPTION 'Logical finalization updates must advance exactly one version';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_reporting_obligation_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF NEW.enterprise_official_code IS DISTINCT FROM OLD.enterprise_official_code
               OR NEW.enterprise_name IS DISTINCT FROM OLD.enterprise_name
               OR NEW.site_code IS DISTINCT FROM OLD.site_code
               OR NEW.site_name IS DISTINCT FROM OLD.site_name THEN
                RAISE EXCEPTION
                    'Frozen reporting-obligation identity cannot be changed';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_reporting_period_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF current_setting('tanaw.mockdata_cleanup', true) = 'on' THEN
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION
                    'reporting_periods is immutable; deletion is forbidden';
            END IF;
            IF (to_jsonb(OLD) - 'status' - 'obligations_frozen_at')
               IS DISTINCT FROM
               (to_jsonb(NEW) - 'status' - 'obligations_frozen_at') THEN
                RAISE EXCEPTION
                    'Canonical reporting-period identity and windows are immutable';
            END IF;
            IF NOT (
                NEW.status = OLD.status
                OR (OLD.status = 'scheduled' AND NEW.status IN ('open', 'closed'))
                OR (OLD.status = 'open' AND NEW.status = 'closed')
            ) THEN
                RAISE EXCEPTION 'Reporting-period status cannot move backwards';
            END IF;
            IF OLD.obligations_frozen_at IS NOT NULL
               AND NEW.obligations_frozen_at IS DISTINCT FROM
                    OLD.obligations_frozen_at THEN
                RAISE EXCEPTION
                    'Reporting-period obligation freeze time is immutable';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_site_live_state_monotonic()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        DECLARE
            old_freshness_rank INTEGER;
            new_freshness_rank INTEGER;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Site live state cannot be deleted';
            END IF;
            IF TG_OP = 'INSERT' THEN
                IF NEW.live_state_version != 1 OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Initial site live state must be fresh version 1';
                END IF;
                RETURN NEW;
            END IF;
            IF NEW.live_state_version != OLD.live_state_version + 1 THEN
                RAISE EXCEPTION 'Live-state version must increment exactly once';
            END IF;
            IF NEW.site_id IS DISTINCT FROM OLD.site_id
               OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
               OR NEW.classification IS DISTINCT FROM OLD.classification THEN
                RAISE EXCEPTION 'Live-state topology identity cannot change';
            END IF;

            IF NEW.edge_device_id IS DISTINCT FROM OLD.edge_device_id THEN
                IF NEW.received_at < OLD.received_at OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Replacement aggregator evidence must be later and fresh';
                END IF;
                RETURN NEW;
            END IF;

            IF (NEW.epoch_generation, NEW.sequence) < (OLD.epoch_generation, OLD.sequence) THEN
                RAISE EXCEPTION 'Older telemetry cannot replace current site state';
            END IF;
            IF (NEW.epoch_generation, NEW.sequence) > (OLD.epoch_generation, OLD.sequence) THEN
                IF NEW.received_at < OLD.received_at OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Newer telemetry must be received later and become fresh';
                END IF;
                RETURN NEW;
            END IF;
            IF NEW.telemetry_epoch_id IS DISTINCT FROM OLD.telemetry_epoch_id
               OR NEW.telemetry_observation_id IS DISTINCT FROM OLD.telemetry_observation_id
               OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
               OR NEW.received_at IS DISTINCT FROM OLD.received_at
               OR NEW.freshness_expires_at IS DISTINCT FROM OLD.freshness_expires_at
               OR NEW.offline_after_at IS DISTINCT FROM OLD.offline_after_at
               OR NEW.metric_window_start IS DISTINCT FROM OLD.metric_window_start
               OR NEW.metric_window_end IS DISTINCT FROM OLD.metric_window_end
               OR NEW.metric_provenance IS DISTINCT FROM OLD.metric_provenance
               OR NEW.coverage_evidence_status IS DISTINCT FROM OLD.coverage_evidence_status
               OR NEW.monitored_seconds IS DISTINCT FROM OLD.monitored_seconds
               OR NEW.expected_seconds IS DISTINCT FROM OLD.expected_seconds
               OR NEW.coverage_gap_count IS DISTINCT FROM OLD.coverage_gap_count
               OR NEW.service_state IS DISTINCT FROM OLD.service_state
               OR NEW.pending_count IS DISTINCT FROM OLD.pending_count
               OR NEW.oldest_pending_at IS DISTINCT FROM OLD.oldest_pending_at
               OR NEW.last_acknowledged_at IS DISTINCT FROM OLD.last_acknowledged_at
               OR NEW.last_failure_at IS DISTINCT FROM OLD.last_failure_at
               OR NEW.last_failure_class IS DISTINCT FROM OLD.last_failure_class THEN
                RAISE EXCEPTION 'Equal telemetry ordering may only advance freshness';
            END IF;
            old_freshness_rank := CASE OLD.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            new_freshness_rank := CASE NEW.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            IF NEW.last_freshness_evaluated_at < OLD.last_freshness_evaluated_at
               OR new_freshness_rank < old_freshness_rank THEN
                RAISE EXCEPTION 'Freshness may only age without newer telemetry';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_site_location_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF current_setting('tanaw.mockdata_cleanup', true) = 'on' THEN
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Site location history cannot be deleted';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF OLD.effective_to IS NOT NULL
                   OR NEW.effective_to IS NULL
                   OR NEW.effective_to <= OLD.effective_from
                   OR NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.site_id IS DISTINCT FROM OLD.site_id
                   OR NEW.classification IS DISTINCT FROM OLD.classification
                   OR NEW.version IS DISTINCT FROM OLD.version
                   OR NEW.barangay IS DISTINCT FROM OLD.barangay
                   OR NEW.address IS DISTINCT FROM OLD.address
                   OR NEW.timezone_name IS DISTINCT FROM OLD.timezone_name
                   OR NEW.building_capacity IS DISTINCT FROM OLD.building_capacity
                   OR NEW.latitude IS DISTINCT FROM OLD.latitude
                   OR NEW.longitude IS DISTINCT FROM OLD.longitude
                   OR NEW.location_source IS DISTINCT FROM OLD.location_source
                   OR NEW.location_confidence IS DISTINCT FROM OLD.location_confidence
                   OR NEW.geocoded_address IS DISTINCT FROM OLD.geocoded_address
                   OR NEW.coordinates_confirmed_at IS DISTINCT FROM OLD.coordinates_confirmed_at
                   OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
                   OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'Site location versions are immutable except for one closure';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_telemetry_observation_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF OLD.downsampled_at IS NULL THEN
                RAISE EXCEPTION 'Telemetry observation must be downsampled before deletion';
            END IF;
            IF EXISTS (
                SELECT 1 FROM telemetry_metric_facts
                WHERE telemetry_observation_id = OLD.id
            ) OR EXISTS (
                SELECT 1 FROM device_health_samples
                WHERE telemetry_observation_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Telemetry observation detail must expire before deletion';
            END IF;
            RETURN OLD;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_guard_telemetry_observation_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF OLD.downsampled_at IS NULL
               AND NEW.downsampled_at IS NOT NULL
               AND (to_jsonb(OLD) - 'downsampled_at') =
                   (to_jsonb(NEW) - 'downsampled_at') THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION '% is append-only; updates are forbidden', TG_TABLE_NAME;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_reject_append_only_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            RAISE EXCEPTION '% is append-only; updates are forbidden', TG_TABLE_NAME;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_reject_immutable_reporting_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF current_setting('tanaw.mockdata_cleanup', true) = 'on' THEN
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;
            RAISE EXCEPTION '% is immutable; create a new reporting record instead', TG_TABLE_NAME;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_validate_canonical_reporting_period()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        DECLARE
            period_year INTEGER;
            period_month INTEGER;
            expected_local_start DATE;
            expected_local_end DATE;
            expected_start TIMESTAMP WITH TIME ZONE;
            expected_end TIMESTAMP WITH TIME ZONE;
        BEGIN
            IF NEW.natural_key !~ (
                '^month' || chr(58) || 'Asia/Manila' || chr(58)
                || '[0-9]{4}-(0[1-9]|1[0-2])$'
            ) THEN
                RAISE EXCEPTION
                    'Reporting-period key is not a canonical Asia/Manila month key';
            END IF;

            period_year := substring(NEW.natural_key FROM 19 FOR 4)::INTEGER;
            period_month := substring(NEW.natural_key FROM 24 FOR 2)::INTEGER;
            IF period_year = 9999 AND period_month = 12 THEN
                RAISE EXCEPTION
                    'Canonical period has no representable exclusive end boundary';
            END IF;
            expected_local_start := make_date(period_year, period_month, 1);
            expected_local_end :=
                (expected_local_start + INTERVAL '1 month')::DATE;
            expected_start :=
                expected_local_start::TIMESTAMP AT TIME ZONE 'Asia/Manila';
            expected_end :=
                expected_local_end::TIMESTAMP AT TIME ZONE 'Asia/Manila';

            IF NEW.cadence IS DISTINCT FROM 'month'
               OR NEW.timezone_name IS DISTINCT FROM 'Asia/Manila'
               OR NEW.local_start_date IS DISTINCT FROM expected_local_start
               OR NEW.local_end_date IS DISTINCT FROM expected_local_end
               OR NEW.starts_at IS DISTINCT FROM expected_start
               OR NEW.ends_at IS DISTINCT FROM expected_end
               OR NEW.submission_opens_at IS DISTINCT FROM expected_end
               OR NEW.submission_closes_at IS DISTINCT FROM
                    expected_end + INTERVAL '15 days' THEN
                RAISE EXCEPTION
                    'Reporting period must equal its canonical Asia/Manila month window';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE OR REPLACE FUNCTION public.tanaw_validate_domain_event_consumer_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM domain_events event
                WHERE event.id = NEW.domain_event_id
                  AND event.payload_hash = NEW.event_payload_hash
            ) THEN
                RAISE EXCEPTION 'Consumer receipt payload hash does not match its domain event';
            END IF;
            RETURN NEW;
        END;
        $function$

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_device_health_samples_append_only BEFORE UPDATE ON device_health_samples FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_device_telemetry_epochs_guard BEFORE INSERT OR DELETE OR UPDATE ON device_telemetry_epochs FOR EACH ROW EXECUTE FUNCTION tanaw_guard_device_telemetry_epoch()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_domain_event_consumer_receipts_append_only BEFORE UPDATE ON domain_event_consumer_receipts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_domain_event_consumer_receipts_hash BEFORE INSERT ON domain_event_consumer_receipts FOR EACH ROW EXECUTE FUNCTION tanaw_validate_domain_event_consumer_receipt()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_domain_event_deliveries_guard BEFORE UPDATE ON domain_event_deliveries FOR EACH ROW EXECUTE FUNCTION tanaw_guard_domain_event_delivery()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_domain_event_delivery_attempts_append_only BEFORE UPDATE ON domain_event_delivery_attempts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_domain_events_append_only BEFORE UPDATE ON domain_events FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_enterprise_reports_acceptance_guard BEFORE INSERT OR UPDATE OF acceptance_blocked, current_revision_id, workflow_state, accepted_revision_id ON enterprise_reports FOR EACH ROW EXECUTE FUNCTION tanaw_enforce_report_acceptance_unblocked()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_artifacts_lifecycle_guard BEFORE DELETE OR UPDATE ON final_report_artifacts FOR EACH ROW EXECUTE FUNCTION tanaw_guard_final_report_artifact_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_command_receipts_immutable BEFORE DELETE OR UPDATE ON final_report_command_receipts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_demographic_facts_immutable BEFORE DELETE OR UPDATE ON final_report_demographic_facts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_events_immutable BEFORE DELETE OR UPDATE ON final_report_events FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_items_immutable BEFORE DELETE OR UPDATE ON final_report_items FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_metric_facts_immutable BEFORE DELETE OR UPDATE ON final_report_metric_facts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_scope_members_immutable BEFORE DELETE OR UPDATE ON final_report_scope_members FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_source_claims_immutable BEFORE DELETE OR UPDATE ON final_report_source_claims FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_final_report_versions_immutable BEFORE DELETE OR UPDATE ON final_report_versions FOR EACH ROW EXECUTE FUNCTION tanaw_guard_final_report_version_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_demographic_facts_immutable BEFORE DELETE OR UPDATE ON report_demographic_facts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_finalizations_version_guard BEFORE DELETE OR UPDATE ON report_finalizations FOR EACH ROW EXECUTE FUNCTION tanaw_guard_report_finalization_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_intake_receipts_immutable BEFORE DELETE OR UPDATE ON report_intake_receipts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_metric_facts_immutable BEFORE DELETE OR UPDATE ON report_metric_facts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_review_events_immutable BEFORE DELETE OR UPDATE ON report_review_events FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_revisions_immutable BEFORE DELETE OR UPDATE ON report_revisions FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_report_source_batches_immutable BEFORE DELETE OR UPDATE ON report_source_batches FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_reporting_obligations_identity_immutable BEFORE UPDATE ON reporting_obligations FOR EACH ROW EXECUTE FUNCTION tanaw_guard_reporting_obligation_identity()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_reporting_periods_canonical BEFORE INSERT OR UPDATE ON reporting_periods FOR EACH ROW EXECUTE FUNCTION tanaw_validate_canonical_reporting_period()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_reporting_periods_immutable BEFORE DELETE OR UPDATE ON reporting_periods FOR EACH ROW EXECUTE FUNCTION tanaw_guard_reporting_period_mutation()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_site_live_state_monotonic BEFORE INSERT OR DELETE OR UPDATE ON site_live_state FOR EACH ROW EXECUTE FUNCTION tanaw_guard_site_live_state_monotonic()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_site_location_versions_immutable BEFORE DELETE OR UPDATE ON site_location_versions FOR EACH ROW EXECUTE FUNCTION tanaw_guard_site_location_version()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_telemetry_metric_facts_append_only BEFORE UPDATE ON telemetry_metric_facts FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_telemetry_observations_append_only BEFORE UPDATE ON telemetry_observations FOR EACH ROW EXECUTE FUNCTION tanaw_guard_telemetry_observation_update()

-- TANAW SCHEMA STATEMENT --

CREATE TRIGGER trg_telemetry_observations_retention_delete BEFORE DELETE ON telemetry_observations FOR EACH ROW EXECUTE FUNCTION tanaw_guard_telemetry_observation_delete()

-- TANAW SCHEMA STATEMENT --

DO $partition_setup$
DECLARE
    month_start_utc TIMESTAMP WITHOUT TIME ZONE;
    month_end_utc TIMESTAMP WITHOUT TIME ZONE;
    month_start_bound TEXT;
    month_end_bound TEXT;
    partition_table_name TEXT;
    offset_month INTEGER;
BEGIN
    FOR offset_month IN -1..1 LOOP
        month_start_utc := date_trunc(
            'month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        ) + make_interval(months => offset_month);
        month_end_utc := month_start_utc + INTERVAL '1 month';
        month_start_bound := to_char(
            month_start_utc, 'YYYY-MM-DD"T"HH24:MI:SS'
        ) || 'Z';
        month_end_bound := to_char(
            month_end_utc, 'YYYY-MM-DD"T"HH24:MI:SS'
        ) || 'Z';
        partition_table_name := 'site_telemetry_hourly_rollups_'
            || to_char(month_start_utc, 'YYYYMM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF '
            'site_telemetry_hourly_rollups FOR VALUES FROM (%L) TO (%L)',
            partition_table_name,
            month_start_bound,
            month_end_bound
        );
        INSERT INTO site_telemetry_rollup_partitions (
            partition_name, range_start, range_end
        ) VALUES (
            partition_table_name,
            month_start_utc AT TIME ZONE 'UTC',
            month_end_utc AT TIME ZONE 'UTC'
        )
        ON CONFLICT (partition_name) DO NOTHING;
    END LOOP;
END
$partition_setup$
