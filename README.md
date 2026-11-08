# TANAW

TANAW is a tourism monitoring and reporting system for the City of San Pedro,
Laguna. It helps participating enterprises record visitor activity and gives
LGU personnel a shared place to monitor establishments and review tourism reports.

## Purpose

TANAW connects local visitor monitoring with city reporting. Enterprise operators
use a desktop app at their establishment, while LGU personnel use a web portal
for account management, operational follow-up, analytics, and report review.
A central backend connects the two applications and stores shared records.

## Main Features

- **Camera monitoring:** connect compatible cameras and monitor visitor activity.
- **Visitor counts:** estimate entry, exit, occupancy, and unique-visitor figures.
- **Open-space monitoring:** observe people within a selected area of the camera image.
- **Enterprise reports:** prepare submissions locally and send them for LGU review.
- **LGU workspaces:** manage accounts, investigate issues, and review activity by role.
- **Final reports:** consolidate eligible submissions and inspect their sources.
- **Support and notifications:** follow requests, replies, and operational updates.

## Intended Users

| User                | Main responsibilities                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Enterprise operator | Configure cameras, monitor visitors, prepare reports, and request support.      |
| IT Personnel        | Manage accounts, investigate technical issues, and maintain system settings.    |
| Admin               | Monitor enterprises on the city map and review operational issues and activity. |
| LGU Staff           | Review submissions, analyze visitor activity, and prepare final reports.        |

## System Components

- [Frontend](frontend-tanaw/README.md): the LGU web portal.
- [Backend](backend-tanaw/README.md): shared accounts, monitoring, reporting, and support.
- [Desktop](desktop-tanaw/README.md): enterprise cameras, local records, and reports.

### How information moves

1. The desktop app processes camera video on the enterprise computer.
2. It saves local visitor records and sends supported updates and submitted reports.
3. The backend stores shared information and makes it available to authorized users.
4. The web portal presents that information for monitoring and reporting.

Pending report submissions stay on the device through temporary connection
interruptions and retry while the app is open, signed in, and connected.
Signing in and using cloud features require an internet connection.

### Privacy and measurement limits

Camera video is processed locally and is not uploaded to the central database.
Camera passwords and account tokens use operating-system-protected storage.
Appearance matching estimates unique visitors without facial recognition.

Visitor figures depend on lighting, camera placement, visibility, and configuration.
They need validation against representative footage before operational use.
Open-space analytics currently stay on the device and are excluded from
central entrance/exit telemetry and official reports. An open-space-only device
may therefore appear delayed or offline in the LGU monitoring views.

## Tech Stack

| Part                    | Main technologies                                                              |
| ----------------------- | ------------------------------------------------------------------------------ |
| Web portal              | React 19, TypeScript 6, Vite 8, Tailwind CSS 4, Leaflet, and Recharts.         |
| Desktop app             | Electron 42, React 18, TypeScript, Vite 7, and Tailwind CSS 4.                 |
| Local camera processing | Python, FastAPI, OpenCV, YOLO11, tracking and appearance matching, and SQLite. |
| Central backend         | Python 3.14, FastAPI, SQLAlchemy, asyncpg, and Alembic.                        |
| Shared data             | PostgreSQL, authenticated APIs, and live change notifications.                 |
| Local development       | Docker Compose, npm, uv, and Git.                                              |

## Getting Started

Use [SETUP.md](SETUP.md) for first-time installation, local configuration,
running the applications, and everyday development commands.
