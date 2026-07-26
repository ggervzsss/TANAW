from __future__ import annotations

import os
from collections.abc import MutableMapping
from pathlib import Path
from tempfile import gettempdir

_CONFIG_DIRECTORY_NAMES = {
    "MPLCONFIGDIR": "matplotlib",
    "YOLO_CONFIG_DIR": "ultralytics",
}


def configure_third_party_directories(
    environ: MutableMapping[str, str] | None = None,
    *,
    temp_root: Path | None = None,
) -> None:
    environment = os.environ if environ is None else environ
    fallback_root = (temp_root or Path(gettempdir())) / "tanaw-ml-service"
    app_data_dir = environment.get("TANAW_APP_DATA_DIR")
    preferred_root = (
        Path(app_data_dir) / "ml-service" / "third-party" if app_data_dir else fallback_root
    )

    for variable, directory_name in _CONFIG_DIRECTORY_NAMES.items():
        if environment.get(variable):
            continue

        directory = _create_directory(preferred_root / directory_name)
        if directory is None and preferred_root != fallback_root:
            directory = _create_directory(fallback_root / directory_name)
        if directory is not None:
            environment[variable] = str(directory)


def _create_directory(directory: Path) -> Path | None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return directory
