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

Open-space analytics currently stay on the device. They are excluded from
official entrance/exit reports and central monitoring updates. A desktop with
only open-space cameras may therefore appear delayed or offline in LGU views.

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
- **e2e and e2e-electron:** browser and desktop integration tests.

## Credits

- `public/images/san-pedro-seal.png` is the City of San Pedro seal published by the City Government of San Pedro and listed by Wikimedia Commons as a Philippine government public-domain work: <https://commons.wikimedia.org/wiki/File:Seal_of_San_Pedro,_Laguna.png>.
- `public/images/camera-placeholder-city-hall.jpg` is the San Pedro City Hall photograph by Wikimedia Commons user Judgefloro, dedicated to the public domain under CC0 1.0: <https://commons.wikimedia.org/wiki/File:6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg>.
- `public/fonts/` contains the Latin webfont files used by the desktop renderer: Inter, Montserrat, and Bai Jamjuree from Google Fonts. They are bundled so typography remains unchanged when the desktop app is offline. Each family retains its SIL Open Font License file in the same directory: <https://fonts.google.com/>.
