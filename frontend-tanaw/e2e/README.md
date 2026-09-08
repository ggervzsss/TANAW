# Browser E2E environments

`npx playwright test` runs the browser suite against a production preview.
The Dev Log test verifies that its shortcut and route are unavailable there.

`TANAW_E2E_DEV_LOG=true npx playwright test` runs only the Dev Log scenario
against Vite development mode on port 5177, verifying unlock and link copying.
It uses the same Playwright configuration and fixtures, not a second test stack.

`account-activation.spec.ts` intentionally skips without
`TANAW_E2E_REAL_BACKEND=true`. It belongs to backend-integrated E2E: it needs
the configured real API, disposable PostgreSQL database, development delivery
endpoint, and IT credentials documented in that test. Browser mocks cannot
verify activation-token delivery/consumption or persisted account transitions.
