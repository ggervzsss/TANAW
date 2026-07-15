from __future__ import annotations

import json
import sqlite3
from datetime import timedelta
from typing import Any
from uuid import uuid4

from app.storage.report_contract import canonical_json
from app.storage.reporting_periods import parse_captured_at


def list_ready_items(
    connection: sqlite3.Connection, *, limit: int, now: str
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        select * from sync_outbox_items
        where status in ('ready', 'retry') and next_attempt_at <= ?
        order by next_attempt_at, created_at, outbox_item_id
        limit ?
        """,
        (now, max(1, min(limit, 500))),
    ).fetchall()
    return [_item_row(row) for row in rows]


def health(connection: sqlite3.Connection) -> dict[str, int | str | None]:
    backlog = connection.execute(
        """
        select count(*) as pending_count, min(outbox.created_at) as oldest_pending_at
        from sync_outbox_items as outbox
        join local_report_revisions as revision
          on revision.revision_id = outbox.report_revision_id
        where outbox.status != 'acknowledged' and revision.source_kind = 'real'
        """
    ).fetchone()
    last_acknowledgement = connection.execute(
        """
        select max(outbox.acknowledged_at) as acknowledged_at
        from sync_outbox_items as outbox
        join local_report_revisions as revision
          on revision.revision_id = outbox.report_revision_id
        where outbox.status = 'acknowledged' and revision.source_kind = 'real'
        """
    ).fetchone()
    last_failure = connection.execute(
        """
        select failed_at, error_class from (
            select attempt.completed_at as failed_at, attempt.error_class
            from sync_attempts as attempt
            join sync_outbox_items as outbox on outbox.outbox_item_id = attempt.outbox_item_id
            join local_report_revisions as revision
              on revision.revision_id = outbox.report_revision_id
            where attempt.outcome in ('retry', 'dead_letter')
              and attempt.error_class is not null and revision.source_kind = 'real'
            union all
            select coalesce(outbox.last_attempt_at, outbox.created_at) as failed_at,
                   outbox.last_error_class as error_class
            from sync_outbox_items as outbox
            join local_report_revisions as revision
              on revision.revision_id = outbox.report_revision_id
            where outbox.last_error_class is not null and revision.source_kind = 'real'
        )
        order by julianday(failed_at) desc, failed_at desc
        limit 1
        """
    ).fetchone()
    return {
        "pending_count": _safe_int(backlog["pending_count"]),
        "oldest_pending_at": backlog["oldest_pending_at"],
        "last_acknowledged_at": last_acknowledgement["acknowledged_at"],
        "last_failure_at": last_failure["failed_at"] if last_failure is not None else None,
        "last_failure_class": last_failure["error_class"] if last_failure is not None else None,
    }


def acknowledge(
    connection: sqlite3.Connection,
    *,
    outbox_item_id: str,
    acknowledgement: dict[str, Any],
    acknowledged_at: str,
) -> bool:
    row = connection.execute(
        "select * from sync_outbox_items where outbox_item_id = ?",
        (outbox_item_id,),
    ).fetchone()
    if row is None:
        return False
    command_id = acknowledgement.get("commandId")
    if command_id is not None and str(command_id) != str(row["command_id"]):
        raise ValueError("Acknowledgement command ID does not match the outbox item.")
    payload_hash = acknowledgement.get("payloadHash")
    if payload_hash is not None and str(payload_hash) != str(row["payload_hash"]):
        raise ValueError("Acknowledgement payload hash does not match the outbox item.")
    if row["status"] == "acknowledged":
        return True

    normalized_at = parse_captured_at(acknowledged_at).isoformat()
    attempt_number = int(row["attempt_count"]) + 1
    response_json = canonical_json(acknowledgement)
    connection.execute(
        """
        update sync_outbox_items
        set status = 'acknowledged', attempt_count = ?, last_attempt_at = ?,
            last_error_class = null, last_error_message = null,
            acknowledged_at = ?, acknowledgement_json = ?
        where outbox_item_id = ?
        """,
        (attempt_number, normalized_at, normalized_at, response_json, outbox_item_id),
    )
    resource = acknowledgement.get("resource")
    logical_version = resource.get("logicalVersion") if isinstance(resource, dict) else None
    if isinstance(logical_version, int) and logical_version >= 1:
        connection.execute(
            """
            update local_reports
            set last_acknowledged_logical_version = max(last_acknowledged_logical_version, ?),
                updated_at = ?
            where report_id = (
                select report_id from local_report_revisions where revision_id = ?
            )
            """,
            (logical_version, normalized_at, row["report_revision_id"]),
        )
    connection.execute(
        """
        insert into sync_attempts (
            attempt_id, outbox_item_id, attempt_number, attempted_at,
            completed_at, outcome, response_json
        ) values (?, ?, ?, ?, ?, 'acknowledged', ?)
        """,
        (str(uuid4()), outbox_item_id, attempt_number, normalized_at, normalized_at, response_json),
    )
    return True


def record_failure(
    connection: sqlite3.Connection,
    *,
    outbox_item_id: str,
    error_class: str,
    error_message: str,
    retryable: bool,
    http_status: int | None,
    failed_at: str,
) -> dict[str, Any]:
    failed_datetime = parse_captured_at(failed_at)
    row = connection.execute(
        "select * from sync_outbox_items where outbox_item_id = ?",
        (outbox_item_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"Unknown sync outbox item: {outbox_item_id}")
    if row["status"] == "acknowledged":
        raise ValueError("An acknowledged sync outbox item cannot be failed.")

    attempt_number = int(row["attempt_count"]) + 1
    if retryable:
        delay_seconds = min(3_600, 2 ** min(attempt_number, 11))
        next_attempt_at = (failed_datetime + timedelta(seconds=delay_seconds)).isoformat()
        status = outcome = "retry"
    else:
        next_attempt_at = failed_datetime.isoformat()
        status = outcome = "dead_letter"
    connection.execute(
        """
        update sync_outbox_items
        set status = ?, next_attempt_at = ?, attempt_count = ?, last_attempt_at = ?,
            last_error_class = ?, last_error_message = ?
        where outbox_item_id = ?
        """,
        (
            status,
            next_attempt_at,
            attempt_number,
            failed_datetime.isoformat(),
            error_class,
            error_message,
            outbox_item_id,
        ),
    )
    connection.execute(
        """
        insert into sync_attempts (
            attempt_id, outbox_item_id, attempt_number, attempted_at, completed_at,
            outcome, error_class, error_message, http_status, next_attempt_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            outbox_item_id,
            attempt_number,
            failed_datetime.isoformat(),
            failed_datetime.isoformat(),
            outcome,
            error_class,
            error_message,
            http_status,
            next_attempt_at if retryable else None,
        ),
    )
    updated = connection.execute(
        "select * from sync_outbox_items where outbox_item_id = ?",
        (outbox_item_id,),
    ).fetchone()
    return _item_row(updated)


def _item_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "outbox_item_id": row["outbox_item_id"],
        "report_revision_id": row["report_revision_id"],
        "command_id": row["command_id"],
        "idempotency_key": row["idempotency_key"],
        "endpoint": row["endpoint"],
        "contract_version": row["contract_version"],
        "payload": _json_dict(row["payload_json"]),
        "payload_hash": row["payload_hash"],
        "status": row["status"],
        "created_at": row["created_at"],
        "next_attempt_at": row["next_attempt_at"],
        "attempt_count": _safe_int(row["attempt_count"]),
        "last_attempt_at": row["last_attempt_at"],
        "last_error_class": row["last_error_class"],
        "last_error_message": row["last_error_message"],
        "acknowledged_at": row["acknowledged_at"],
        "acknowledgement": _json_dict(row["acknowledgement_json"]),
    }


def _json_dict(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value)) if value else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0
