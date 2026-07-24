# TANAW Camera Stress-Test Guide

This guide works on Linux and Windows. It explains how to:

1. Record clean footage from an RTSP camera.
2. Prepare TANAW's local model files.
3. Run the same detections with ReID off, fast ReID, and quality ReID.
4. locate the generated videos and reports.

A desktop screen recording is **not required** for these tests. Use a clean
recording from the camera whenever possible.

## 1. What the raw clip should contain

The recording should show only the camera image. It should not contain:

- TANAW bounding boxes
- the desktop application interface
- camera status messages
- timestamps or overlays added by screen-recording software

A timestamp permanently added by the camera itself is acceptable when it
cannot be disabled.

Keep each clip short, preferably 30 to 90 seconds. Three people are enough.
Record separate clips for:

- normal walking
- fast walking or running
- one person briefly hidden behind an object
- two people crossing and briefly covering each other
- a person leaving the view and returning
- a person moving quickly across the center tripwire
- poor lighting, blur, or partial people near the edge

## 2. Install or verify FFmpeg

FFmpeg is used to save the RTSP stream without adding TANAW overlays.

Open a terminal and run:

```text
ffmpeg -version
```

If the command is not found, install FFmpeg for your operating system, reopen
the terminal, and run the command again.

You can skip FFmpeg when your camera or NVR already has an export/download
feature. Export the original camera stream as MP4 or MKV and continue at
[Step 4](#4-check-the-recorded-clip).

## 3. Record an RTSP clip

The examples below record 60 seconds. Replace the sample RTSP address with the
camera's actual RTSP URL.

Use MKV when you are unsure whether the camera sends H.264 or H.265. MKV accepts
both reliably without re-encoding the video.

### Linux

From the TANAW repository:

```bash
cd /path/to/TANAW/desktop-tanaw/ml-service
mkdir -p evaluation/clips

ffmpeg \
  -rtsp_transport tcp \
  -i "rtsp://USERNAME:PASSWORD@192.168.1.218:554/stream2" \
  -t 60 \
  -map 0:v:0 \
  -c:v copy \
  -an \
  "evaluation/clips/stress-01.mkv"
```

### Windows PowerShell

From the TANAW repository:

```powershell
Set-Location "C:\Path\To\TANAW\desktop-tanaw\ml-service"
New-Item -ItemType Directory -Force "evaluation\clips"

ffmpeg `
  -rtsp_transport tcp `
  -i "rtsp://USERNAME:PASSWORD@192.168.1.218:554/stream2" `
  -t 60 `
  -map 0:v:0 `
  -c:v copy `
  -an `
  "evaluation\clips\stress-01.mkv"
```

The RTSP URL may contain a password. Do not post that URL in screenshots,
reports, chat messages, or Git. Clear it from terminal history when necessary.

To record another scenario, change the output name:

```text
stress-normal-walk.mkv
stress-fast-crossing.mkv
stress-short-occlusion.mkv
stress-two-person-crossing.mkv
stress-reentry.mkv
```

## 4. Check the recorded clip

Play the clip in VLC or another local video player. Confirm that:

- the entire camera view is visible
- the video contains no TANAW interface or bounding boxes
- people and crossings are visible
- the clip plays from beginning to end

You can also inspect it with:

```text
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,avg_frame_rate "PATH_TO_CLIP"
```

Example on Linux:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,avg_frame_rate "evaluation/clips/stress-01.mkv"
```

Example on Windows PowerShell:

```powershell
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,avg_frame_rate "evaluation\clips\stress-01.mkv"
```

## 5. Prepare TANAW

Run these commands once after cloning or updating TANAW.

### Linux

```bash
cd /path/to/TANAW/desktop-tanaw
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
npm run models:setup:reid
npm run models:verify -- --profile balanced --reid quality
```

### Windows PowerShell

```powershell
Set-Location "C:\Path\To\TANAW\desktop-tanaw"
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
npm run models:setup:reid
npm run models:verify -- --profile balanced --reid quality
```

The final command should report:

```json
"ready": true
```

Do not proceed with ReID comparisons when it reports `"ready": false`.

## 6. Run the baseline and create the shared cache

Run the following from `desktop-tanaw`. Change `stress-01.mkv` when your clip
uses a different name.

### Linux

```bash
uv run --directory ml-service python -m scripts.replay_tracking \
  --video "evaluation/clips/stress-01.mkv" \
  --profile balanced \
  --runtime auto \
  --tracker botsort \
  --reid off \
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" \
  --rebuild-cache \
  --output "evaluation/results/stress-01-off.jsonl" \
  --summary-output "evaluation/results/stress-01-off-summary.json" \
  --annotated-output "evaluation/results/stress-01-off.mp4"
```

### Windows PowerShell

```powershell
uv run --directory ml-service python -m scripts.replay_tracking `
  --video "evaluation/clips/stress-01.mkv" `
  --profile balanced `
  --runtime auto `
  --tracker botsort `
  --reid off `
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" `
  --rebuild-cache `
  --output "evaluation/results/stress-01-off.jsonl" `
  --summary-output "evaluation/results/stress-01-off-summary.json" `
  --annotated-output "evaluation/results/stress-01-off.mp4"
```

This is the only run that should use `--rebuild-cache`.

## 7. Run fast ReID with the identical detections

### Linux

```bash
uv run --directory ml-service python -m scripts.replay_tracking \
  --video "evaluation/clips/stress-01.mkv" \
  --profile balanced \
  --runtime auto \
  --tracker botsort \
  --reid fast \
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" \
  --output "evaluation/results/stress-01-fast.jsonl" \
  --summary-output "evaluation/results/stress-01-fast-summary.json" \
  --annotated-output "evaluation/results/stress-01-fast.mp4"
```

### Windows PowerShell

```powershell
uv run --directory ml-service python -m scripts.replay_tracking `
  --video "evaluation/clips/stress-01.mkv" `
  --profile balanced `
  --runtime auto `
  --tracker botsort `
  --reid fast `
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" `
  --output "evaluation/results/stress-01-fast.jsonl" `
  --summary-output "evaluation/results/stress-01-fast-summary.json" `
  --annotated-output "evaluation/results/stress-01-fast.mp4"
```

## 8. Run the quality ReID workload

### Linux

```bash
uv run --directory ml-service python -m scripts.replay_tracking \
  --video "evaluation/clips/stress-01.mkv" \
  --profile balanced \
  --runtime auto \
  --tracker botsort \
  --reid quality \
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" \
  --output "evaluation/results/stress-01-quality.jsonl" \
  --summary-output "evaluation/results/stress-01-quality-summary.json" \
  --annotated-output "evaluation/results/stress-01-quality.mp4"
```

### Windows PowerShell

```powershell
uv run --directory ml-service python -m scripts.replay_tracking `
  --video "evaluation/clips/stress-01.mkv" `
  --profile balanced `
  --runtime auto `
  --tracker botsort `
  --reid quality `
  --detections-cache "evaluation/cache/stress-01-balanced-botsort.jsonl" `
  --output "evaluation/results/stress-01-quality.jsonl" `
  --summary-output "evaluation/results/stress-01-quality-summary.json" `
  --annotated-output "evaluation/results/stress-01-quality.mp4"
```

## 9. Find and review the results

The outputs are stored under:

```text
desktop-tanaw/ml-service/evaluation/results/
```

Compare these annotated videos:

```text
stress-01-off.mp4
stress-01-fast.mp4
stress-01-quality.mp4
```

Look for:

- a person receiving a new ID after an occlusion
- IDs switching when two people cross
- a bounding box falling behind fast movement
- a person disappearing for several frames
- a missed entry or exit after crossing the tripwire
- duplicate counts after a person returns

Also retain the JSONL and summary JSON files. They contain the information
needed for detailed analysis.

## 10. Optional labeled evaluation

Formal IDF1, ID-switch, fragmentation, and crossing metrics require a
ground-truth JSONL file. This labeling can be done after the first visual
review. See [README.md](README.md) for the ground-truth format and evaluation
command.

You may provide the raw clips and generated files to the development machine.
The same cached replay and evaluation can then be run and analyzed there.
