# TANAW Frontend

This repository contains the browser-based LGU portal for TANAW, a tourism
monitoring and reporting system for the City of San Pedro, Laguna.

## Purpose

The portal gives LGU personnel role-specific workspaces for managing participating
enterprises, following operational issues, and reviewing tourism reports.
It connects to the TANAW backend for shared records and account access.

## Main Features

| Workspace    | What users can do                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| IT Personnel | Manage LGU and enterprise accounts, investigate technical issues, review support requests and email delivery, and adjust system settings. |
| Admin        | Locate enterprises on the city map, inspect monitoring status, and follow operational issues and activity.                                |
| LGU Staff    | Review enterprise submissions, analyze visitor activity, consolidate reports, and audit final-report sources.                             |

All workspaces include account and security settings, notifications, display
preferences, and a Help Center.

## How It Works

Users sign in with an activated TANAW account. Their role determines the
available pages and actions. The portal loads records from the backend and
refreshes affected information when live change notifications arrive.

A new account activates through an email link and chooses its own password.
Password recovery also uses email. Account activation, deactivation, and
reactivation use dedicated actions; ordinary profile editing does not change
account status.

The portal presents supported updates received from enterprise desktops.
It does not process camera video. Delayed or unavailable monitoring data
should not be interpreted as an establishment having no visitors.
Open-space analytics currently remain on the enterprise device and are
excluded from the central entrance/exit monitoring and reporting flow.

## Tech Stack

| Technology                 | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| React 19 and TypeScript 6  | Build the pages and keep application data types consistent.     |
| Vite 8                     | Run the local development server and build the web application. |
| Tailwind CSS 4             | Style layouts and components.                                   |
| React Router               | Navigate between role-specific pages.                           |
| TanStack Query and Zustand | Manage backend records and local interface state.               |
| Axios                      | Communicate with the backend API.                               |
| Leaflet and CARTO tiles    | Display enterprise locations and barangay boundaries.           |
| Recharts                   | Present visitor analytics and reporting figures.                |
| Motion and Lucide          | Provide interface animation and icons.                          |

## Code Organization

- **src/app:** navigation, layouts, providers, and application state.
- **src/features:** account, monitoring, reporting, support, and other workflows.
- **src/shared:** reusable interface elements, API helpers, and shared types.
- **src/contracts:** generated types that describe the backend's API.
- **e2e:** browser workflow tests.

The portal needs a reachable TANAW API and a CARTO browser key for map tiles.
The API address comes from VITE_API_BASE_URL, and the map key comes from
VITE_CARTO_BASEMAP_API_KEY. Browser configuration must contain public values only.
