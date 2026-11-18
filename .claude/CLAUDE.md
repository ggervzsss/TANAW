# TANAW

Shared project rules, including the database schema and migration policy,
live in the repository root AGENTS.md:

@../AGENTS.md

## Testing Policy

Fast checks protect everyday work; Playwright end-to-end suites run at specific
points instead of after every change.

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

### During implementation: targeted Playwright only

Do not run the full Playwright suites while implementing. Run only the specs
for the affected area, and only when the change touches a screen, a user
workflow, or a request or response that a spec mocks or asserts on, for example:

```shell
npx playwright test tests/e2e/browser/unified-reporting.spec.ts
```

Skip Playwright entirely for backend-only, ML-service-internal, script, and
documentation changes.

### Before filing a pull request: full suites

Before opening any pull request, run the complete end-to-end suites for each
client the branch changes:

- desktop-tanaw: `npm run test:e2e`, then `npm run test:electron`
- frontend-tanaw: `npm run test:e2e`

`npm run test:electron` performs the full build it needs. Running the
Electron config directly after the browser suite reuses a renderer-only build
and stalls at login.

Compare failures against the known baseline below. Report a new failure
instead of filing the pull request; do not label it pre-existing without
running the same spec on the base branch.

### Known pre-existing failures

Remove an entry here once it is fixed.

- desktop browser and Electron `dark-mode` specs fail at
  `theme-and-filters.ts:216` (theme-switch commit takes about 155-175ms
  against a 150ms limit on the Linux Mint laptop).
- desktop Electron `camera-setup` spec fails on Linux without a Secret
  Service keyring ("Operating-system protected storage is unavailable").
- desktop Electron `reports-layout` spec fails a rounding check
  (49.99998 vs 50).
- desktop browser `enterprise-interactions` tests at lines 279 and 598 are
  flaky; rerun once before treating them as failures.
