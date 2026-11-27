# TANAW

## User Interface Design

Read `DESIGN.md` at the repository root before changing the web portal or the
desktop app UI. It sets the identity both apps share: Bai Jamjuree and Inter,
Civic Green, Seal Gold, and the light and dark palettes. Layout, navigation,
spacing and workflows are each app's own choice.

Each app owns its UI components and styles: `frontend-tanaw/src/shared/ui-kit/`
and `desktop-tanaw/src/ui-kit/`, with tokens in each app's
`src/styles/tokens.css`. Change one app's UI kit without editing the other's,
and keep the brand values in step with `DESIGN.md`.

## Testing Policy

### After every change

Run the fast checks for each area the change touches:

- desktop-tanaw or frontend-tanaw: `npm run type`, `npm run lint`, `npm test`
- backend-tanaw: `uv run ruff check .`, `uv run ruff format --check .`,
  `uv run mypy .`, `uv run pyright`, `uv run pytest`
- desktop-tanaw/ml-service: the same Python commands from that directory

Put logic checks in unit tests (Vitest or pytest), not in Playwright.

### Playwright only when the user asks

Do not run Playwright (single specs or full suites, browser or Electron)
unless the user explicitly asks for it in that request. This includes the
pre-pull-request suites below.

After every change that affects a screen, a user workflow, or a request or
response that a spec mocks or asserts on, end the response with a reminder
that Playwright has not been run for it. Name the specs or suites that cover
the change and the commands to run them, so the user can ask for a run.
Keep reminding in later responses while those changes stay unverified by
Playwright. Skip the reminder for changes that leave screens and tested
workflows unaffected, such as documentation or internal service work.

When the user asks for a run, update the specs the change affects, and review
visual changes on the affected screens in light and dark mode where
supported.

For a targeted desktop browser test, use a command such as the following.

```shell
npx playwright test tests/e2e/browser/unified-reporting.spec.ts
```

### Before filing a pull request

These are the full end-to-end suites for each affected client. Before opening a
pull request, remind the user if they have not been run on the final changes,
and run them only when the user asks.

- desktop-tanaw: `npm run test:e2e`, then `npm run test:electron`
- frontend-tanaw: `npm run test:e2e`

`npm run test:electron` performs the full build it needs. Running the
Electron config directly after the browser suite reuses a renderer-only build
and stalls at login.

Run a failing spec on the base branch to see whether the failure predates the
change. Treat flaky tests as defects to investigate and fix. Report unresolved
failures to the user.

### Pull request testing summary

Summarize the checks that ran and their results in the pull request
description. If Playwright was not run, say so and why (not requested, or
not applicable).

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
