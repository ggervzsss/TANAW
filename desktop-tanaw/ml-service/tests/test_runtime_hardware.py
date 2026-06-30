import builtins
import unittest
from typing import Any, cast
from unittest.mock import patch

from app.runtime.hardware import _system_memory_mb, get_runtime_capabilities


class RuntimeHardwareTest(unittest.TestCase):
    def test_capabilities_include_runtime_availability_map(self) -> None:
        capabilities = get_runtime_capabilities()

        runtime_available = capabilities.get("runtime_available")
        self.assertIsInstance(runtime_available, dict)
        runtimes = cast(dict[str, object], runtime_available)

        for runtime in ("auto", "cuda", "openvino", "cpu"):
            self.assertIn(runtime, runtimes)
        self.assertNotIn("tensorrt", runtimes)
        self.assertNotIn("directml", runtimes)
        self.assertTrue(runtimes["auto"])
        self.assertTrue(runtimes["cpu"])

        experimental = capabilities.get("experimental_runtime_available")
        self.assertIsInstance(experimental, dict)
        self.assertIn("tensorrt_provider", cast(dict[str, object], experimental))
        self.assertIn("directml_provider", cast(dict[str, object], experimental))

    def test_system_memory_probe_handles_sysconf_errors(self) -> None:
        with patch("app.runtime.hardware.os.sysconf", side_effect=OSError):
            self.assertIsNone(_system_memory_mb())

        with patch("app.runtime.hardware.os.sysconf", side_effect=ValueError):
            self.assertIsNone(_system_memory_mb())

    def test_missing_optional_runtime_imports_do_not_crash_capability_probe(self) -> None:
        original_import = builtins.__import__

        def blocked_import(name: str, *args: Any, **kwargs: Any) -> Any:
            if name.split(".", 1)[0] in {"torch", "openvino", "onnxruntime"}:
                raise ImportError(f"{name} intentionally unavailable")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=blocked_import):
            capabilities = get_runtime_capabilities()

        self.assertFalse(capabilities["cuda_available"])
        self.assertFalse(capabilities["openvino_available"])
        self.assertFalse(capabilities["onnxruntime_available"])
        runtime_available = cast(dict[str, object], capabilities["runtime_available"])
        self.assertTrue(runtime_available["auto"])
        self.assertTrue(runtime_available["cpu"])


if __name__ == "__main__":
    unittest.main()
