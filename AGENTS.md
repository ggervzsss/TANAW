# TANAW Agent Instructions

## Code Quality Gate

After any implementation, run the linting, formatting checks, and type checks for every affected project before reporting completion. If a change touches multiple projects or shared behavior, run the full relevant set.

### Backend Python API

From `backend-tanaw`:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
```

### Desktop ML Service

From `desktop-tanaw/ml-service`:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
```

### Frontend Web App

From `frontend-tanaw`:

```bash
npm run lint
npm run type
```

### Desktop App

From `desktop-tanaw`:

```bash
npm run lint
npm run type
```

## Cleanup Expectations

- Fix unused imports, unused variables, dead code, and avoid leaving temporary debugging artifacts.
- Keep formatting clean with project tooling rather than manual style changes.
- Treat VSCode/Pylance diagnostics as useful static-analysis signals; verify whether they indicate real issues, especially in the Python ML service.
- If a required check cannot run because of an environment issue, report the exact command and failure reason.

## Dev Servers And Ports

- If a project port is already running, assume it is probably the current app for that codebase and do not start a duplicate server.
- Reuse the existing running server when possible for browser or API verification.
- If a separate temporary server is truly necessary for testing, use a different port, clearly note it, and shut it down after the test is complete.
