import unittest

from fastapi.routing import APIRoute

from app.main import app


class TargetLocalApiTest(unittest.TestCase):
    def test_local_service_advertises_the_release_version(self) -> None:
        self.assertEqual(app.version, "2.0.0")

    def test_local_reports_use_the_canonical_collection(self) -> None:
        methods_by_path: dict[str, set[str]] = {}
        for route in app.routes:
            if isinstance(route, APIRoute):
                methods_by_path.setdefault(route.path, set()).update(route.methods or set())

        self.assertEqual(methods_by_path["/reports/local"], {"GET", "POST"})
        self.assertEqual(methods_by_path["/diagnostics/operations"], {"GET"})
        self.assertEqual(methods_by_path["/sync/outbox/recovery"], {"GET"})
        self.assertEqual(methods_by_path["/sync/outbox/{outbox_item_id}/recovery"], {"GET"})
        self.assertEqual(methods_by_path["/sync/outbox/{outbox_item_id}/retry"], {"POST"})
        self.assertNotIn("/reports/local-submit", methods_by_path)

        schemas = app.openapi()["components"]["schemas"]
        schema_names = set(schemas)
        self.assertIn("LocalReportRevisionRequest", schema_names)
        self.assertIn("LocalReportRevisionResponse", schema_names)
        self.assertIn("LocalReportRecordResponse", schema_names)
        self.assertNotIn("ReportSubmissionRequest", schema_names)
        self.assertNotIn("ReportSubmissionResponse", schema_names)
        self.assertNotIn("ReportSubmissionRecordResponse", schema_names)
        report_properties = schemas["LocalReportRecordResponse"]["properties"]
        self.assertIn("acknowledged_at", report_properties)
        self.assertNotIn("synced_at", report_properties)
        self.assertIn("LocalOperationalDiagnosticsResponse", schema_names)
        recovery_properties = schemas["SyncOutboxRecoveryItemResponse"]["properties"]
        self.assertNotIn("payload", recovery_properties)
        self.assertNotIn("idempotency_key", recovery_properties)


if __name__ == "__main__":
    unittest.main()
