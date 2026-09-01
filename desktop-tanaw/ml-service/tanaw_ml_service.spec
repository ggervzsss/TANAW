from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

service_root = Path(SPEC).resolve().parent

datas = [
    (
        str(service_root / "app" / "detection" / "tracker_configs"),
        "app/detection/tracker_configs",
    )
]
binaries = collect_dynamic_libs("openvino")
hiddenimports = collect_submodules("uvicorn") + collect_submodules("websockets")
datas += collect_data_files("openvino", include_py_files=False)

analysis = Analysis(
    [str(service_root / "main.py")],
    pathex=[str(service_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "gdown",
        "mypy",
        "onnx",
        "onnxscript",
        "pytest",
        "tensorboard",
        "torchreid",
    ],
    noarchive=False,
)


def keep_production_runtime_entry(entry):
    destination = entry[0].replace("\\", "/")
    return not (
        destination.startswith("mypy/")
        or destination.startswith("torch/test/")
        or "/__pycache__/" in destination
        or destination.endswith((".pyc", ".pyo"))
    )


analysis.binaries = TOC(entry for entry in analysis.binaries if keep_production_runtime_entry(entry))
analysis.datas = TOC(entry for entry in analysis.datas if keep_production_runtime_entry(entry))
python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="tanaw-ml-service",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

bundle = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name="tanaw-ml-service",
)
