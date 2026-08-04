import json
from typing import Any

from app.storage.local_data_serialization import _report_draft_row, _utc_now
from app.storage.local_database import LocalDatabase


class ReportDraftRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self._database = database

    def get(self, draft_key: str) -> dict[str, Any] | None:
        with self._database.connection() as connection:
            row = connection.execute(
                """select draft_key, period, report_id, payload_json, updated_at
                   from report_drafts where draft_key = ?""",
                (draft_key,),
            ).fetchone()
        return _report_draft_row(row) if row is not None else None

    def save(
        self,
        draft_key: str,
        period: str,
        payload: dict[str, Any],
        report_id: str | None = None,
    ) -> dict[str, Any]:
        updated_at = _utc_now()
        with self._database.connection() as connection:
            connection.execute(
                """insert into report_drafts (
                       draft_key, period, report_id, payload_json, updated_at
                   ) values (?, ?, ?, ?, ?)
                   on conflict(draft_key) do update set
                       period = excluded.period, report_id = excluded.report_id,
                       payload_json = excluded.payload_json, updated_at = excluded.updated_at""",
                (
                    draft_key,
                    period,
                    report_id,
                    json.dumps(payload, sort_keys=True),
                    updated_at,
                ),
            )
        return {
            "draft_key": draft_key,
            "period": period,
            "report_id": report_id,
            "payload": payload,
            "updated_at": updated_at,
        }

    def delete(self, draft_key: str) -> bool:
        with self._database.connection() as connection:
            cursor = connection.execute(
                "delete from report_drafts where draft_key = ?", (draft_key,)
            )
        return cursor.rowcount > 0
