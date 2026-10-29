"""Run the corrected regression scenarios from the ML-service review.

From desktop-tanaw/ml-service:
    .venv/bin/python ../../docs/reviews/reproduce_ml_service_review.py

These tests use temporary databases and fake detections. The RTSP timeout test
connects only to a temporary local test server, never to the user's cameras.
"""

import sys
from pathlib import Path

import pytest

if __name__ == "__main__":
    service = Path(__file__).resolve().parents[2] / "desktop-tanaw" / "ml-service"
    sys.path.insert(0, str(service))
    raise SystemExit(pytest.main(["-q", str(service / "tests" / "test_review_regressions.py")]))
