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
- **Account tools:** manage profile and security settings, notifications, display preferences, and help.

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
seen by several cameras on the same day counts once. Camera accuracy and
sustained workloads need validation with representative footage.

### Reports and synchronization

Operators sign in with an activated enterprise account, review visitor figures,
and complete the required report fields before submitting.

Reports and detailed records are saved locally. Pending submissions retry while
the app is open, signed in, and connected to the central API. Temporary internet
interruptions do not discard saved local records. Sign-in and cloud features
require access to the central service.

Both camera modes contribute to the same establishment occupancy and estimated
visitor totals. These totals appear on the desktop and in LGU monitoring,
visitor history, and submitted reports. Open Space cameras measure presence;
Entry / Exit cameras measure arrivals and departures.

### Privacy and local storage

Raw camera video is processed on the device and is not uploaded to the central
database. Account tokens and camera passwords use operating-system-protected
storage and are excluded from the local SQLite database.

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
- `public/fonts/` contains the Latin webfont files used by the desktop renderer: Inter, Montserrat, and Bai Jamjuree from Google Fonts. They are bundled so typography remains unchanged when the desktop app is offline. Each family retains its SIL Open Font License file in the same directory: <https://fonts.google.com/>.
