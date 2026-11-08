# Render and Supabase demo deployment

This guide applies both to `backend-tanaw/` in the TANAW monorepo and to the
root of the standalone `ggervzsss/backend-tanaw` repository. The monorepo app
directory is the source of truth; keep its source files, configuration, and
documentation identical in the standalone repository. Preserve the standalone
repository's `.git` directory and keep private environment values separate
from source-file replacement.

The hosted API deploys from the standalone repository. Its `render.yaml` uses
paths relative to that standalone root and creates a Free Docker service in
the TANAW Render workspace.

The API is `https://tanaw-api-yked.onrender.com`; the frontend is the separate
Vercel project at `https://tanaw-sanpedro.vercel.app`. If deploying the monorepo
directly, select Blueprint path `backend-tanaw/render.yaml` and add
`rootDir: backend-tanaw` to the service definition first.

Store environment values in Render, never in Git. `.env.example` lists the
application settings. Use the exact Supabase **Session pooler** host and port
5432, with the username `postgres.PROJECT_REF` and the database password:

```text
postgresql+asyncpg://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@POOLER_HOST:5432/postgres?ssl=require
```

Use session mode because TANAW's realtime connection uses PostgreSQL LISTEN.
Disable Supabase's Data API: the portal uses FastAPI and does not configure
Supabase API access policies. Supabase Auth and browser API keys are not used.

Render Free has no pre-deploy command, so `scripts/start-production.sh` runs
`alembic upgrade head` before starting Uvicorn. Both the production Docker image
and the Render configuration use this script. Use one instance
and one process; the API hosts its email, maintenance, and realtime workers.
Revision `0001` remains the canonical initial schema under the pre-production
policy. Applying `upgrade head` does not update edits to an already-applied
baseline; recreate the dedicated disposable database when that baseline changes.

Provide an initial IT email and password of at least 12 characters for a fresh
database. After the account is created, remove both `BOOTSTRAP_IT_*` environment
values and redeploy. Preserve JWT and email derivation secrets on later deploys.

Verify HTTP 200 from `/health`, `/ready/email`, `/ready/maintenance`, and
`/ready/realtime`. Also test actual mail delivery, login, and a realtime update.
UptimeRobot can monitor the API's `/health` every five minutes; this does not
guarantee availability or bypass provider limits. Render Free can restart and
idle, and Supabase Free has storage, egress, and inactivity limits.
