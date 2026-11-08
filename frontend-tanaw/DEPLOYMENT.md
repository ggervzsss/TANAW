# Vercel demo deployment

This directory contains the monorepo's frontend source. The hosted portal uses
the standalone `ggervzsss/frontend-tanaw` repository, whose root matches this
directory. Reuse the Vercel project `tanaw-sanpedro`, with its root directory set
to that standalone repository's root. For a direct monorepo deployment, select
`frontend-tanaw` as the Vercel root directory instead.

The tracked `vercel.json` declares Vite, `npm ci`, `npm run build`, `dist`, SPA
routing, and security headers. Node 24 is configured on the existing project.

Set these build values in Vercel's production environment:

- `VITE_API_BASE_URL`: the assigned Render API HTTPS URL.
- `VITE_CARTO_BASEMAP_API_KEY`: the CARTO browser key.

The current backend URL is `https://tanaw-api-yked.onrender.com`.

Both are public browser settings. Database, Brevo, JWT, and email derivation
secrets belong only in Render. The build validates both values and derives
HTTPS/WSS Content Security Policy destinations from the API URL.

Coordinate the backend's `FRONTEND_PUBLIC_URL` and `CORS_ORIGINS` with
`https://tanaw-sanpedro.vercel.app`. Rebuild the frontend after an API URL change.
Run `npm run deployment:validate` with all coordinated public settings before
deploying. Preview origins require explicit backend CORS authorization.

Verify login, refresh, logout, account activation, recovery email, map tiles,
and realtime updates. Browser privacy settings can block cross-site session
cookies between Vercel and Render; test the intended browsers. If needed, use
frontend/API subdomains of a domain you own and update the coordinated URLs.

Vercel Hobby private-repository deployments require an authorized commit author.
The contract-generation helper scripts reference a sibling backend checkout;
run those during development and commit the resulting contracts. The production
build uses the committed source and does not need the backend repository.
