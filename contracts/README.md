# TANAW transport contracts

FastAPI/Pydantic is authoritative for TANAW's REST and realtime transport contracts.
This directory contains developer-only generation tooling; it is not a runtime shared
package and does not share React code between the web and desktop applications.

Run `npm run generate` after changing a backend transport schema. Run `npm run check`
to regenerate in memory and fail when either client's committed output is stale.
Generated files live under each client's `src/contracts/generated` directory and must
not contain manually maintained business logic.
