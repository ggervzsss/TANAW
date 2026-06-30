from __future__ import annotations

import os
import platform
from typing import Any


def get_runtime_capabilities() -> dict[str, Any]:
    torch_version: str | None = None
    cuda_available = False
    cuda_device_name: str | None = None
    cuda_memory_total_mb: int | None = None
    cuda_error: str | None = None

    try:
        import torch

        torch_version = str(getattr(torch, "__version__", "unknown"))
        cuda_available = bool(torch.cuda.is_available())
        if cuda_available:
            cuda_device_name = str(torch.cuda.get_device_name(0))
            properties = torch.cuda.get_device_properties(0)
            cuda_memory_total_mb = int(properties.total_memory / (1024 * 1024))
    except Exception as exc:
        cuda_error = str(exc)

    openvino_available = False
    openvino_version: str | None = None
    openvino_error: str | None = None
    try:
        import openvino

        openvino_available = True
        openvino_version = str(getattr(openvino, "__version__", "unknown"))
    except Exception as exc:
        openvino_error = str(exc)

    onnxruntime_available = False
    onnxruntime_version: str | None = None
    onnxruntime_providers: list[str] = []
    onnxruntime_error: str | None = None
    try:
        import onnxruntime as ort

        onnxruntime_available = True
        onnxruntime_version = str(getattr(ort, "__version__", "unknown"))
        onnxruntime_providers = [str(provider) for provider in ort.get_available_providers()]
    except Exception as exc:
        onnxruntime_error = str(exc)

    directml_provider_available = "DmlExecutionProvider" in onnxruntime_providers
    tensorrt_provider_available = "TensorrtExecutionProvider" in onnxruntime_providers

    return {
        "cuda_available": cuda_available,
        "cuda_device_name": cuda_device_name,
        "cuda_memory_total_mb": cuda_memory_total_mb,
        "cuda_error": cuda_error,
        "torch_version": torch_version,
        "openvino_available": openvino_available,
        "openvino_version": openvino_version,
        "openvino_error": openvino_error,
        "onnxruntime_available": onnxruntime_available,
        "onnxruntime_version": onnxruntime_version,
        "onnxruntime_providers": onnxruntime_providers,
        "onnxruntime_error": onnxruntime_error,
        "cpu_core_count": os.cpu_count(),
        "system_memory_mb": _system_memory_mb(),
        "operating_system": platform.system(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "runtime_available": {
            "auto": True,
            "cuda": cuda_available,
            "openvino": openvino_available,
            "cpu": True,
        },
        "experimental_runtime_available": {
            "tensorrt_provider": tensorrt_provider_available,
            "directml_provider": directml_provider_available,
        },
    }


def _system_memory_mb() -> int | None:
    if not hasattr(os, "sysconf"):
        return None

    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        page_count = int(os.sysconf("SC_PHYS_PAGES"))
    except (OSError, ValueError):
        return None

    return int((page_size * page_count) / (1024 * 1024))
