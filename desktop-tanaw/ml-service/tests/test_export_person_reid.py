import hashlib
from pathlib import Path

import numpy as np
import pytest

from app.attributes import write_sex_head
from scripts import export_person_reid_onnx as export

ONNX_BYTES = b"committed reid export"


def _service(tmp_path: Path, *, head_digest: str | None) -> Path:
    models = tmp_path / "models"
    models.mkdir()
    (models / "person_reid.onnx").write_bytes(ONNX_BYTES)
    if head_digest is not None:
        write_sex_head(
            models / "sex_head_quality.npz",
            embedding_space=f"torchreid_osnet_ain_x1_0_msmt17_onnx@{head_digest}:128x256:head_mask=0",
            weights=np.ones(4, dtype=np.float32),
            bias=0.0,
            temperature=1.0,
        )
    return models / "person_reid.onnx"


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_expected_digest_reads_the_trained_head(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=_digest(ONNX_BYTES))

    assert export.expected_digest("quality", target.parent) == _digest(ONNX_BYTES)
    assert export.expected_digest("fast", target.parent) is None


def test_skips_a_file_that_matches_its_head(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=_digest(ONNX_BYTES))

    decision, message = export.decide_export(target, "quality", force=False)

    assert decision == "skip"
    assert "matches the trained male/female head" in message


def test_keeps_a_mismatched_file_and_warns(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=_digest(b"another export"))

    decision, message = export.decide_export(target, "quality", force=False)

    assert decision == "skip"
    assert message.startswith("WARNING")
    assert "git checkout" in message
    assert target.read_bytes() == ONNX_BYTES


def test_keeps_an_existing_file_without_a_head(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=None)

    assert export.decide_export(target, "quality", force=False) == (
        "skip",
        "person_reid.onnx already exists; skipping export.",
    )


def test_exports_a_missing_file(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=_digest(ONNX_BYTES))
    target.unlink()

    decision, message = export.decide_export(target, "quality", force=False)

    assert decision == "export"
    assert "missing" in message


def test_force_exports_and_warns_that_the_head_must_be_retrained(tmp_path: Path) -> None:
    target = _service(tmp_path, head_digest=_digest(ONNX_BYTES))

    decision, message = export.decide_export(target, "quality", force=True)

    assert decision == "export"
    assert "WARNING" in message
    assert "retrain" in message
    assert "sex_head_quality.npz" in message


@pytest.mark.parametrize(("force", "exported"), [(False, False), (True, True)])
def test_export_profile_only_runs_the_export_when_decided(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    force: bool,
    exported: bool,
) -> None:
    target = _service(tmp_path, head_digest=_digest(ONNX_BYTES))
    calls: list[Path] = []
    monkeypatch.setattr(export, "_export_onnx", lambda _profile, path: calls.append(path))

    export._export_profile(export.MODEL_PROFILES["quality"], target.parent, force=force)

    assert calls == ([target] if exported else [])
    assert target.read_bytes() == ONNX_BYTES
    assert capsys.readouterr().out.strip()
