import pytest

from app.runtime import verify_models


def test_missing_bundled_detector_fails_before_ultralytics_can_download(tmp_path, monkeypatch):
    monkeypatch.setattr(verify_models, "model_directory", lambda: tmp_path)

    def unexpected_download(*args, **kwargs):
        pytest.fail("Missing packaged assets must never trigger a YOLO download")

    monkeypatch.setattr("ultralytics.YOLO", unexpected_download)
    with pytest.raises(FileNotFoundError, match="Required bundled model is missing"):
        verify_models.verify_models()
