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

Dashboard Recent Reports lists up to five complete rows before scrolling. Smaller
lists stay compact; every row retains its preview action and View All opens the
Reports workspace. The Dashboard date menu supports arrows, Home/End,
Enter, Escape, and Tab. Green keyboard-focus indicators, chart tooltips, and the
assistant's rounded composer share the Dashboard theme. Assistant transitions
respect reduced-motion preferences, preserve conversations across collapse,
and scroll new messages inside the conversation panel.

Dashboard charts retain Recharts' keyboard-accessible SVG surface. Their internal
`tabindex="-1"` SVG portal groups have a scoped focus reset, preventing Electron's
native orange rectangles on pointer clicks. Keyboard focus uses the rounded green
chart-container indicator instead. Surface fades, chart transitions, and value
updates respect reduced motion without changing card geometry or typography.

After building, run `npx playwright test --config=playwright.electron.config.ts
dashboard-interactions` to exercise actual Electron clicks on bars, points, lines,
and empty plot areas in both themes, plus tooltips, keyboard focus, and assistant
controls. It uses a temporary desktop profile and a test sidecar, leaving local
records and camera services untouched.

## How It Works

### Camera monitoring

The computer connects to an RTSP camera using the camera's own credentials.
Presets support Tapo, Tenda, Dahua, and custom RTSP connections. Camera access
requires a working local network connection and valid device credentials.

In Entrance / Exit mode, operators position counting lines across the intended
passage. The app tracks people crossing those lines and uses the events for
entry, exit, and occupancy figures.

In Open Space mode, operators draw a monitored area on the preview.
The dashboard can show that area's current occupancy, peak occupancy,
estimated daily unique visitors when available, and activity history.
Unavailable measurements are shown as unavailable rather than as zero.

Counts depend on camera placement, lighting, visibility, and configuration.
Unique visitors are estimates based on appearance matching, not facial recognition.
Camera accuracy and sustained workloads need validation with representative footage.
Combined occupancy assumes separate, non-overlapping monitored areas and does
not deduplicate people between camera views.

### Reports and synchronization

Operators sign in with an activated enterprise account, review visitor figures,
and complete the required report fields before submitting.

Reports and detailed records are saved locally. Pending submissions retry while
the app is open, signed in, and connected to the central API. Temporary internet
interruptions do not discard saved local records. Sign-in and cloud features
require access to the central service.

Both camera modes contribute to the same establishment occupancy and estimated
visitor totals. These totals appear on the desktop and in LGU monitoring,
visitor history, and submitted reports. Open Space cameras measure presence.
Only Entrance / Exit cameras at a configured boundary measure arrivals and departures.

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
