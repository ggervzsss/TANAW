import os
from pathlib import Path


def model_directory() -> Path:
    """Return the external model directory for source and bundled runtimes."""
    configured = os.environ.get("TANAW_ML_MODEL_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "models"
