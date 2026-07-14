import unittest

from fastapi.routing import APIRoute

from app.main import app


class TargetLocalApiTest(unittest.TestCase):
    def test_local_reports_use_one_target_collection_without_legacy_alias(self) -> None:
        methods_by_path: dict[str, set[str]] = {}
        for route in app.routes:
            if isinstance(route, APIRoute):
                methods_by_path.setdefault(route.path, set()).update(route.methods or set())

        self.assertEqual(methods_by_path["/reports/local"], {"GET", "POST"})
        self.assertNotIn("/reports/local-submit", methods_by_path)

        schema_names = set(app.openapi()["components"]["schemas"])
        self.assertIn("LocalReportRevisionRequest", schema_names)
        self.assertIn("LocalReportRevisionResponse", schema_names)
        self.assertIn("LocalReportRecordResponse", schema_names)
        self.assertNotIn("ReportSubmissionRequest", schema_names)
        self.assertNotIn("ReportSubmissionResponse", schema_names)
        self.assertNotIn("ReportSubmissionRecordResponse", schema_names)


if __name__ == "__main__":
    unittest.main()
