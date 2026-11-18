# TANAW Enterprise Desktop

This repository contains the enterprise desktop application for TANAW, a tourism
monitoring and reporting system for the City of San Pedro, Laguna.
It includes the desktop interface and the local camera-processing service.

## Purpose

Enterprise operators use the app to connect cameras, view visitor activity,
keep local records, and prepare reports for LGU review. Camera processing takes
place on the enterprise computer.

## Main Features

- **Camera setup:** save compatible camera connections, test access, and control processing.
- **Entrance / Exit monitoring:** count crossings over configured entry and exit lines.
- **Open-space monitoring:** observe people inside a selected area of the camera image.
- **Dashboard:** view occupancy, estimated visitor figures, and activity history.
- **Reports:** prepare submissions, follow their status, and retry pending synchronization.
- **Support:** create tickets and follow replies.
- **Account tools:** manage profile and security settings, notifications, display preferences, developer settings, and help.

## Dashboard and Reports data

Dashboard and Reports always read real data from the local camera service and
the central API. To populate them for development or demonstrations, generate
backend sample data with the repository scripts (`scripts/mockdata-on`,
`scripts/mockdata-status`, `scripts/mockdata-reset`, `scripts/mockdata-off`, or
their `.ps1` equivalents).

## How It Works

### Camera monitoring

To add a camera, operators enter its name, an optional location, the brand
(Tapo, Tenda, Dahua, or Custom RTSP), its IP address, its own username and
password, and the camera mode. TANAW finds a working video stream for the brand
when the connection is tested, preferring a stream that is light enough for
steady counting and large enough for reliable detection. Only Custom RTSP asks
for a stream address. The computer must be able to reach the camera on the
local network.

Each camera uses one of two modes:

- **Entry / Exit:** operators place the counting lines across a doorway. The
  red side is outside and the green side is inside. Crossing from red to green
  is an entry; crossing from green to red is an exit.
- **Open Space:** operators draw the monitored area on the preview. Everyone
  inside the area counts as present.

All Entry / Exit cameras share one balance for the establishment, so a visitor
may enter through one door and leave through another. The balance starts from
zero each day. Live occupancy is that balance plus the people inside every Open
Space area. A camera that is offline is left out, and the other cameras still
count.

Counts depend on camera placement, lighting, and visibility. Unique visitors are
estimates based on appearance matching, not facial recognition, and a visitor
seen by several cameras on the same day counts once. There is one gallery of
visitors per establishment: a camera's **Unique Visitors** figure counts the
establishment's visitors seen on that camera today, so with one camera it equals
the report. Camera accuracy and sustained workloads need validation with
representative footage.

### Performance profile

**Developer Settings** (account menu) sets how hard this computer works on every
camera. It is saved on the computer, not with a camera or an account, and
changing it restarts running cameras with their own settings. Camera Monitoring
shows the profile in use and its AI frame rate, with a link to change it.

| Profile               | Detector         | Appearance matching    | Use on                                    |
| --------------------- | ---------------- | ---------------------- | ----------------------------------------- |
| Auto (recommended)    | Chosen by TANAW  | Chosen by TANAW        | Any computer; the selector shows the pick |
| Emergency / Low Power | YOLO11n at 480px | Off (Open Space: fast) | Very old computers                        |
| Compatibility         | YOLO11n at 640px | Off (Open Space: fast) | Older laptops and CPU-only computers      |
| Balanced              | YOLO11s at 640px | Fast                   | Capable computers                         |
| High Accuracy         | YOLO11m at 640px | Quality                | Strong computers, ideally with a GPU      |

Auto picks Balanced with an NVIDIA GPU (CUDA), Compatibility with OpenVINO, and
Emergency otherwise. Only High Accuracy uses the quality appearance model, which
matches visitors more reliably and runs the more accurate male/female head.

### Reports and synchronization

Operators sign in with an activated enterprise account and prepare one report
per month. TANAW fills each day's unique visitors under **This City**. The
cameras cannot tell where visitors live, so for each day the operator enters the
visitors from another city, another province, or abroad; those are deducted
from This City. A day with only local visitors is confirmed with **All from This
City**. The date picker marks days that still need this with a red badge, and
the report can be submitted once none remain. TANAW also estimates how many of
the day's unique visitors are male and female and splits This City accordingly;
visitors entered for other origins are deducted from it sex by sex. Days without
an estimate show This City as a total only.

Reports and detailed records are saved locally. Pending submissions retry while
the app is open, signed in, and connected to the central API. Temporary internet
interruptions do not discard saved local records. Sign-in and cloud features
require access to the central service.

Both camera modes contribute to the same establishment occupancy and estimated
visitor totals. These totals appear on the desktop and in LGU monitoring,
visitor history, and submitted reports. Open Space cameras measure presence;
Entry / Exit cameras measure arrivals and departures.

### Male and female estimates

TANAW estimates whether each **unique visitor** is male or female from their
whole appearance (build, hair, clothing), so faces are not needed. Every unique
visitor counts once, as male or female, and the two always add up to the unique
visitors. Entries, exits, occupancy and Open Space presence are not split, and no
screen shows a live male/female count; the split appears in Reports and the DOT
form.

For testing, **Developer Settings** (account menu) has two switches saved on
this computer only. **Detection details** labels each person's box with its
tracker number, state and detection confidence; **Male/female estimate** adds
that person's live estimate and the evidence behind it. Without them, people get
a plain box. The live estimate is never stored.

- A small classifier (a "sex head") reads the appearance embedding TANAW
  already computes for re-identification. Every good view of a visitor, on any
  camera, adds evidence.
- The day's female count is the sum of the visitors' probabilities. Each
  visitor is judged only on their own appearance: one the head cannot tell
  apart counts as half male and half female, and one never seen clearly enough
  counts as exactly half of each, so there is no "unknown" group. The rest of
  the day never pulls an unsure visitor toward the majority.
- Because the head's mistakes are not corrected, a day far from an even mix is
  reported a few points closer to half than it really was.
- The fast head (82%) runs with Balanced and lower profiles and the quality head
  (86%) with High Accuracy (see Performance profile).
- Estimates need people's bodies in view: mount cameras angled toward people,
  not pointing straight down.
- The heads live in `ml-service/models/sex_head_fast.npz` and
  `sex_head_quality.npz`, each with a JSON model card of its measured accuracy.
  Each head accepts only the exact ReID file it was trained on
  (`person_reid_cpu.onnx` and `person_reid.onnx`), checked by SHA-256. Without a
  matching pair, reports fall back to a This City total.
  `npm run models:verify -- --reid quality --require-sex-heads` checks the
  pair, and `ml:bundle` runs that check before building an installer.

The heads are trained on PA-100K, a public dataset of 100,000 labelled
surveillance images released under CC BY 4.0 (see Credits). It is downloaded
outside the repository and never bundled. RAP v2 and PETA readers also exist,
but those datasets are licensed for research only. To retrain, from
`ml-service`, with PA-100K unpacked under `~/Datasets/PA-100K`:

```bash
uv run --with scipy python -m scripts.build_sex_dataset_cache --dataset pa100k --root ~/Datasets/PA-100K/images/release_data/release_data --annotation ~/Datasets/PA-100K/annotation/annotation.mat --reid quality --output-dir ~/Datasets/PA-100K/cache --workers 4 --train-limit 30000
```

```bash
uv run python -m scripts.train_sex_head --reid quality --train ~/Datasets/PA-100K/cache/pa100k_quality_train.npz --calibration ~/Datasets/PA-100K/cache/pa100k_quality_val.npz --test ~/Datasets/PA-100K/cache/pa100k_quality_test.npz
```

Repeat both with `--reid fast` (without `--train-limit`) for the fast head.

The trained heads, their model cards and the two ReID ONNX files they were
trained on are kept in git, so a fresh clone has a matching set; the YOLO
weights in `models/` still come from `npm run models:setup`.
`npm run models:setup:reid` keeps existing ReID files and only exports one that
is missing, because a re-export differs byte for byte. Replacing a ReID file
(`models:setup:reid -- --force`, or a different model) means retraining its
head with the commands above. To undo an accidental change, restore the
committed file with `git checkout -- ml-service/models/person_reid.onnx`. On
PA-100K's test split the quality head reaches 86% balanced accuracy and the
fast head 82%, so prefer the quality model where male and female figures
matter.

`scripts.evaluate_sex_estimator` re-measures a head on any cache, or compares a
replayed recording (`scripts.replay_tracking --summary-output`) with the known
number of men and women in it, so estimates can be tested without mounted
cameras.

### Privacy and local storage

Raw camera video is processed on the device and is not uploaded to the central
database. Account tokens and camera passwords use operating-system-protected
storage and are excluded from the local SQLite database. Male/female estimation
keeps two numbers of evidence per sighting and daily totals, never images or a
per-person label.

Clearing local app data can remove saved cameras and unsynchronized records.
Central records and local device records have separate lifecycles.

## Tech Stack

| Technology                                   | Purpose                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron 42                                  | Provide desktop windows, native integration, and protected credential storage. |
| React 18, TypeScript, and Vite 7             | Build and run the desktop interface.                                           |
| Tailwind CSS 4                               | Style interface components.                                                    |
| TanStack Query, Zustand, and Axios           | Manage application state and communicate with the central API.                 |
| Recharts, Motion, and Lucide                 | Provide charts, animation, and icons.                                          |
| Python 3.12+ and FastAPI                     | Run the local camera-processing service.                                       |
| OpenCV and YOLO11                            | Read camera frames and detect people.                                          |
| ByteTrack, BoT-SORT, and appearance matching | Track movement and estimate repeat visitors.                                   |
| PyTorch, ONNX Runtime, and OpenVINO          | Run supported detection and identity models.                                   |
| SQLite                                       | Store enterprise-scoped camera profiles, visitor records, and reports.         |

## Code Organization

- **electron:** desktop lifecycle, secure storage, and communication with the local service.
- **src:** the enterprise interface and workflows.
- **ml-service/app:** camera processing, visitor counting, and local storage.
- **ml-service/scripts:** model setup and camera evaluation tools.
- **tests:** JavaScript/Electron unit tests, browser workflows, and desktop integration tests.
- **ml-service/tests:** Python camera-processing and local-storage tests.

## Local storage and camera service

On Windows the installed app stores its database, camera credentials, and sign-in
state under `%APPDATA%\TANAW Enterprise Desktop` and starts its camera service on
`127.0.0.1:8766`. Development uses `%APPDATA%\desktop-tanaw` and port `8765`.

Diagnostic logs are written to the `logs` folder inside that profile:
`main.log` for the desktop app (the previous file is kept as `main.previous.log`)
and `ml-service.log` for the camera service. Camera passwords and tokens are
redacted from both.

A Windows uninstall removes the installed app's profile and cached installer
payload for the current Windows account. Unsynced reports are lost. Installing
an update over an existing installation keeps the profile. The development
profile and records already synced to the server are separate.

## Building installers

Run these commands from `desktop-tanaw` after installing npm dependencies and
preparing the model assets. Distribution builds require a production
`VITE_API_BASE_URL`, for example in `.env.production.local`.

- `npm run dist`: build the Windows x64 offline installer on Windows.
- `npm run dist:linux`: build an Ubuntu/Debian x64 `.deb`. On Windows this uses
  Docker Desktop's Linux engine and an Ubuntu 22.04 builder. On Linux it uses
  the local Node.js 22.12+ and uv toolchain; use Ubuntu 22.04 for the same
  compatibility baseline.

The Linux command bundles a native Python service and every supported model,
checks CPU inference, and writes the package and `SHA256SUMS.txt` under
`release/<version>/linux-deb/`. The Linux runtime uses CPU inference. Windows
and Linux native dependencies and outputs remain separate. Build commands do
not publish artifacts.

Install the `.deb` with `sudo apt install ./TANAW-Enterprise-Desktop-<version>-linux-amd64.deb`.
APT installs required system libraries and GNOME Keyring if missing. A desktop
session with an unlocked supported keyring is required for protected credential
storage; Python, Node.js, and model downloads are not required on the target PC.

## Credits

- `public/images/san-pedro-seal.png` is the City of San Pedro seal published by the City Government of San Pedro and listed by Wikimedia Commons as a Philippine government public-domain work: <https://commons.wikimedia.org/wiki/File:Seal_of_San_Pedro,_Laguna.png>.
- `public/images/camera-placeholder-city-hall.jpg` is the San Pedro City Hall photograph by Wikimedia Commons user Judgefloro, dedicated to the public domain under CC0 1.0: <https://commons.wikimedia.org/wiki/File:6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg>.
- The male/female estimation heads in `ml-service/models/sex_head_*.npz` are trained on the PA-100K dataset by Xihui Liu, Haiyu Zhao, Maoqing Tian, Lu Sheng, Jing Shao, Junjie Yan and Xiaogang Wang ("HydraPlus-Net: Attentive Deep Features for Pedestrian Analysis", ICCV 2017), used under CC BY 4.0: <https://github.com/xh-liu/HydraPlus-Net>.
- `public/fonts/` contains the Latin webfont files used by the desktop renderer: Inter and Bai Jamjuree from Google Fonts. They are bundled so typography remains unchanged when the desktop app is offline. Each family retains its SIL Open Font License file in the same directory: <https://fonts.google.com/>.
