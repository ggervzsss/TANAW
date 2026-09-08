# TANAW transport contract tooling

FastAPI/Pydantic is authoritative for TANAW's REST and realtime transport contracts.
This directory contains developer-only generation tooling; it is not a runtime shared
package and does not share React code between the web and desktop applications.

From this directory, run `npm run generate` after changing a backend transport schema,
or `npm run check` to generate in memory and fail when either client's committed output
is stale. From the repository root, the equivalent direct commands are:

```bash
npm --prefix backend-tanaw/scripts/contracts run generate
npm --prefix backend-tanaw/scripts/contracts run check
```

The web and desktop projects also expose `npm run contracts:generate` and
`npm run contracts:check`. Generated files are committed under each client's
`src/contracts/generated` directory and must not contain manually maintained business
logic. Deployed backend, web, and desktop runtimes do not require this tooling.
