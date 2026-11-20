# TANAW

## Testing Policy

### After every change

Run the fast checks for each area the change touches:

- desktop-tanaw or frontend-tanaw: `npm run type`, `npm run lint`, `npm test`
- backend-tanaw: `uv run ruff check .`, `uv run ruff format --check .`,
  `uv run mypy .`, `uv run pyright`, `uv run pytest`
- desktop-tanaw/ml-service: the same Python commands from that directory
- design-system: `node design-system/scripts/sync.mjs` (then the fast checks
  of both apps, which type-check, lint and drift-test the copies), and
  `npm run type` from `design-system/`. When a component or token changes,
  also run `npm run a11y` there with Storybook running.

Never edit `src/design-system/` or `src/styles/tanaw-tokens.css` in an app:
they are generated from `design-system/`.

Put logic checks in unit tests (Vitest or pytest), not in Playwright.

### Playwright end-to-end tests

Run Playwright browser and Electron tests only when the user explicitly asks
to run end-to-end tests. This applies during implementation and when opening or
reviewing a pull request. Run the relevant specs unless the user asks for a
full suite. For a targeted desktop browser test, use a command such as the
following.

```shell
npx playwright test tests/e2e/browser/unified-reporting.spec.ts
```

For a requested full suite, use the commands for the relevant client.

- desktop-tanaw: `npm run test:e2e`, then `npm run test:electron`
- frontend-tanaw: `npm run test:e2e`

`npm run test:electron` performs the full build it needs. Running the
Electron config directly after the browser suite reuses a renderer-only build
and stalls at login.

When asked to investigate a Playwright failure, compare the same spec on the
base branch to see whether the failure predates the change. Treat flaky tests
as defects to investigate and fix.

### Pull request testing summary

Summarize the checks that ran and their results in the pull request
description. Say when Playwright was skipped. Skipping Playwright does not
block filing. Fix known test failures before filing. If a failure remains,
report it to the user.

## Commit Messages

When an implementation is done, always provide a ready-to-use commit message
for it at the end of the response.

- Base the message on the actual uncommitted changes (`git status` and
  `git diff`), not only on the most recent task.
- If several changes are still uncommitted, write one message that covers all
  of them; the subject summarizes the whole set and the body lists each change.
- Follow the repository's existing style: a Conventional Commits subject with a
  scope (for example `fix(desktop): ...`), and a body that explains what changed
  and why.
- Only generate the message. Do not commit unless the user asks.

## Database Schema And Migration Policy

TANAW is currently in a pre-production stage. There is no production or
user data that must be preserved yet.

### Current Pre-Production Policy

Until the user explicitly states that TANAW has entered a data-preservation
or production stage:

- Treat PostgreSQL and desktop SQLite development databases as disposable.
- Do not create incremental database migrations solely to preserve development
  data.
- Do not add data backfills, legacy-schema compatibility logic, or upgrade paths
  for disposable development databases.
- Prefer the clean final schema required by the current codebase rather than
  transitional schema designs.
- Existing development databases may be reset and recreated when schemas change.

For PostgreSQL:

- Keep Alembic available as TANAW's database migration infrastructure.
- Keep the current canonical initial baseline as the authoritative fresh
  PostgreSQL schema.
- While this pre-production policy remains active, update the canonical baseline
  directly when PostgreSQL schema changes are required.
- Do not create `0002`, `0003`, or later incremental migrations unless the user
  explicitly changes this policy.

For desktop SQLite:

- Keep SQLite migration infrastructure available and migration-ready.
- The current SQLite schema is the canonical initial migration baseline.
- While this pre-production policy remains active, update that baseline directly
  when SQLite schema changes are required.
- Do not create `002`, `003`, or later SQLite migration revisions unless the
  user explicitly changes this policy.
- Development SQLite databases may be recreated rather than migrated while this
  policy is active.

The presence of migration infrastructure does not mean migration history is
currently frozen or that incremental migrations should automatically be
created.

### Future Data-Preservation Policy

Do not infer that TANAW has entered this stage. The user must explicitly state
that existing database data now needs to be preserved.

Once that transition is explicitly declared:

- Freeze all existing PostgreSQL and SQLite migration baselines and previously
  applied migration revisions.
- Never rewrite an already released or applied migration.
- Create new ordered migrations for subsequent schema changes.
- Preserve existing database contents.
- Add data transformations, backfills, and compatibility handling when genuinely
  required by a migration.
- Test upgrades from supported existing database revisions to the new revision.

Until that explicit transition occurs, continue following the pre-production
policy above.
