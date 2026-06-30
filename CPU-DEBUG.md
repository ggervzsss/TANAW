**RTX GPU Debug Guide**

Use this when a machine has an NVIDIA RTX card but TANAW still shows `CPU`.

**1. Confirm the OS sees the GPU**

Run:

```bash
nvidia-smi
```

Expected:

```text
NVIDIA GeForce RTX 3050
Driver Version: ...
```

If this fails, TANAW cannot use the GPU yet. Fix the NVIDIA driver first, then reboot.

On Windows, if `nvidia-smi` is not found, try:

```powershell
& "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
```

**2. Confirm TANAW’s Python environment sees CUDA**

From the repo:

Linux/macOS:

```bash
cd desktop-tanaw/ml-service
UV_CACHE_DIR=/tmp/uv-cache uv run python -c "import torch; print('torch:', torch.__version__); print('cuda:', torch.cuda.is_available()); print('device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
```

Windows PowerShell:

```powershell
cd desktop-tanaw/ml-service
$env:UV_CACHE_DIR="$env:TEMP\uv-cache"
uv run python -c "import torch; print('torch:', torch.__version__); print('cuda:', torch.cuda.is_available()); print('device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
```

Expected:

```text
cuda: True
device: NVIDIA GeForce RTX 3050
```

If `nvidia-smi` works but this says `cuda: False`, the issue is PyTorch/CUDA visibility, not TANAW’s UI.

**3. Confirm the detector models exist**

From `desktop-tanaw`:

```bash
npm run models:setup
```

For RTX/CUDA, this is the important setup. `models:setup:openvino` is not required for NVIDIA CUDA.

Expected model files:

```text
desktop-tanaw/ml-service/models/yolo11n.pt
desktop-tanaw/ml-service/models/yolo11s.pt
desktop-tanaw/ml-service/models/yolo11m.pt
```

**4. Start TANAW and check the runtime capability endpoint**

With the desktop app or ML service running, open:

```text
http://127.0.0.1:8765/runtime/capabilities
```

Look for:

```json
"cuda_available": true,
"cuda_device_name": "NVIDIA GeForce RTX ..."
```

If this endpoint says `cuda_available: false`, TANAW will not choose CUDA.

**5. Start camera processing and check actual selected runtime**

After pressing Start on the camera page, open:

```text
http://127.0.0.1:8765/health
```

Look for:

```json
"selected_runtime": "cuda",
"runtime_device": "cuda:0",
"effective_processing_profile": "balanced"
```

The UI should then show something like:

```text
Balanced / YOLO11S / CUDA / BoT-SORT
```

**6. Interpret failures**

If `nvidia-smi` fails: driver/device problem.

If `nvidia-smi` works but `torch.cuda.is_available()` is `False`: PyTorch/CUDA environment problem.

If PyTorch says CUDA is true but `/runtime/capabilities` says false: TANAW is launching a different Python environment.

If `/runtime/capabilities` says CUDA true but `/health` still says CPU after starting camera: check `fallback_reason` in `/health`; the detector likely fell back during model startup.

If the device is WSL/container-based: confirm `nvidia-smi` works inside that same WSL/container environment, not only on the host OS.

Sources: PyTorch CUDA install/check guidance: https://pytorch.org/get-started/locally/
NVIDIA WSL CUDA guide: https://docs.nvidia.com/cuda/wsl-user-guide/index.html
