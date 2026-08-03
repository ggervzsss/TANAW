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

## Staging And Commit Preparation

- After any implementation is complete and the required checks have been run, add the completed changes to the git staging area.
- Stage only files that belong to the completed implementation. Do not stage unrelated user changes or generated artifacts that are not part of the requested work.
- If a newly created file is moved into a folder whose name ends with `-docs`, do not stage or commit that file. Leave it untracked.
- Prepare an appropriate commit message based on the staged changes, but do not create the commit yet unless this workflow requires committing previously staged work before starting a new implementation.
- Include the prepared commit message at the end of the response so the user can copy and paste it if they want to create the commit themselves.
- Before starting any new implementation or unrelated set of changes, check for staged changes that are waiting to be committed. If staged changes exist and a prepared commit message is available for them, commit those staged changes first using that message. Then complete the new implementation, stage the new changes, and prepare a new commit message for them.
- If the user reports an issue or bug in a recently implemented feature, use judgment before committing the staged changes. If the issue should be fixed as part of the same work, fix it before committing. If the report is unrelated or the staged work is already complete, commit the staged changes first using the prepared message.

## Dev Servers And Ports

- If a project port is already running, assume it is probably the current app for that codebase and do not start a duplicate server.
- Reuse the existing running server when possible for browser or API verification.
- If a separate temporary server is truly necessary for testing, use a different port, clearly note it, and shut it down after the test is complete.
