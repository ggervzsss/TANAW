# TANAW Email and Account Activation Review Checklist

Review date: 2026-07-11

Review baseline: `6458dab feat: replace temporary passwords with secure account activation`

Scope: backend API, TANAW web portal, Enterprise desktop application, deployment configuration, tests, and relevant repository cleanup.

## Purpose

This document tracks the risks and follow-up work identified during the review of TANAW's outbound email, account activation, password recovery, and related authentication flows. Complete the work from highest to lowest priority and keep the activation safeguards in the regression checklist intact.

Status legend:

- [ ] Not started
- [~] In progress
- [x] Completed and verified

## Recommended implementation order

1. Secure startup-seeded accounts and rotate exposed credentials.
2. Upgrade dependencies with known security advisories.
3. Make email delivery transactionally reliable through an outbox.
4. Harden password recovery against enumeration, abuse, and concurrent reuse.
5. Implement actual business-email ownership verification.
6. Add fail-fast production email configuration validation.
7. Strengthen the password policy.
8. Improve delivery observability, migration safety, retention, and deployment configuration.
9. Remove dead artifacts and refactor duplicated client authentication code.
10. Close the automated-testing gaps and run the full regression checklist.

## P0 — Critical security work

### SEC-001 — Stop startup accounts from resetting passwords

- [x] Change startup account seeding so it creates a bootstrap account only when required.
- [x] Never overwrite an existing account's password during a normal backend restart.
- [x] Do not automatically reactivate or restore privileges to an account that administrators intentionally disabled.
- [x] Remove the three unnecessary temporary startup accounts from production, or gate all development-only accounts behind an explicit development setting.
- [x] Reject production startup when any placeholder username, password, or JWT secret is still configured.
- [x] Persist the protected bootstrap identity so removing one-time environment credentials cannot make the backup account editable or deactivatable.
- [x] Add tests proving that a password changed through TANAW remains valid after `seed_default_accounts` runs again.
- [x] Add tests proving that a disabled startup account is not silently re-enabled.

Affected areas:

- `backend-tanaw/app/features/accounts/seed.py`
- `backend-tanaw/app/features/accounts/defaults.py`
- `backend-tanaw/app/core/config.py`
- `backend-tanaw/tests/test_default_account_seed.py`
- Root and backend environment templates

Acceptance criteria:

- Restarting the backend never changes an existing user's password, activation state, role, or status.
- Production cannot start with known development credentials.
- There is a documented, auditable bootstrap/recovery procedure for the initial IT account.

## P1 — High-priority reliability and security work

### MAIL-001 — Introduce a transactional email outbox

Current risk: TANAW calls Resend before committing the account, activation token, password-reset challenge, or email-change request. Resend can accept a message whose database transaction later fails, producing a broken activation link or duplicated message on retry.

- [x] Add an outbox table that stores the message purpose, recipient, template payload, stable idempotency key, attempt count, next-attempt time, provider ID, and final status.
- [x] Commit the business record, activation/reset record, and outbox record in one database transaction.
- [x] Send queued mail only after that transaction commits.
- [x] Retry transient failures with exponential backoff and the same stable Resend idempotency key.
- [x] Distinguish retryable provider/network failures from permanent validation failures.
- [x] Persist failed attempts without rolling back the account or other committed business operation.
- [x] Prevent concurrent workers from sending the same outbox item twice.
- [x] Define a terminal failure state and an IT-visible retry action.
- [x] Keep activation and OTP bodies redacted from production logs.

Affected flows:

- Account activation and activation resend
- Password-reset OTP
- Business-email change request
- Support-ticket reply notification

Acceptance criteria:

- A committed activation token always exists before its email can be sent.
- A database failure cannot leave a newly sent link pointing to rolled-back data.
- A network timeout after Resend accepts a request can be retried without sending a duplicate.
- Failed email attempts remain visible and actionable.

### DEP-001 — Upgrade dependencies with known advisories

Backend audit findings from 2026-07-11:

- [x] Upgrade `pydantic-settings 2.14.1` to at least `2.14.2`.
- [x] Upgrade `python-multipart 0.0.29` to at least `0.0.31`.
- [x] Upgrade the FastAPI/Starlette dependency set so Starlette is at least `1.3.1`.
- [x] Regenerate `backend-tanaw/uv.lock` and run the complete backend test and type-check suite.
- [x] Pin the Desktop ML service to Starlette `1.3.1` or newer and verify its Python quality gates and dependency audit.

Web audit findings:

- [x] Upgrade the dependency tree containing `form-data 4.0.5` to a patched release.
- [x] Upgrade Vite beyond the versions affected by the reported Windows development-server advisories.
- [x] Upgrade patched transitive build dependencies, including Babel, and leave the complete npm audit clean.
- [x] Regenerate `frontend-tanaw/package-lock.json` and retest development and production builds.

Desktop audit findings:

- [x] Upgrade the dependency tree containing `form-data 4.0.5` to a patched release.
- [x] Upgrade the Vite/esbuild dependency set beyond the affected esbuild range.
- [x] Upgrade patched transitive build dependencies, including Babel, js-yaml, and undici, and leave the complete npm audit clean.
- [x] Regenerate `desktop-tanaw/package-lock.json` and rebuild the Electron application.

Verification:

```bash
cd backend-tanaw
UV_CACHE_DIR=/tmp/uv-cache uv run --with pip-audit pip-audit

cd ../frontend-tanaw
npm audit --omit=dev

cd ../desktop-tanaw
npm audit --omit=dev
```

Acceptance criteria:

- Audits report no known vulnerability that remains unaccepted without a written risk decision.
- All application checks and builds still pass after upgrading.

### AUTH-001 — Prevent password-reset account enumeration and abuse

- [x] Ensure password-reset requests return the same public status, response shape, and approximately equivalent behavior for existing, pending, inactive, and unknown accounts.
- [x] Do not expose provider/configuration failures in a way that reveals whether the requested account exists.
- [x] Add per-IP and per-identifier rate limits with bounded windows.
- [x] Add a global abuse ceiling so arbitrary unique email addresses cannot create unlimited database rows.
- [x] Expire or consolidate older active challenges when a new challenge is issued.
- [x] Record security telemetry without logging OTP values.
- [x] Define a user-friendly resend cooldown response rather than silently returning an old challenge with no new email.

Acceptance criteria:

- An unauthenticated caller cannot determine whether an account exists from status codes, response bodies, or obvious timing differences.
- Repeated or distributed requests cannot create unbounded challenge data or excessive email volume.

### AUTH-002 — Make OTP verification and reset consumption concurrency-safe

- [x] Lock the password-reset challenge row during OTP verification.
- [x] Lock the challenge and account in a consistent order during password reset.
- [x] Atomically consume the verification code and reset token.
- [x] Add PostgreSQL concurrency tests proving only one verification/reset attempt can succeed.
- [x] Verify that failed concurrent attempts do not overwrite the valid reset token or password.

Acceptance criteria:

- A verification code and reset token are each usable exactly once, including under concurrent requests.
- Attempt limits cannot be bypassed through parallel requests.

### AUTH-003 — Verify ownership of a requested business email

- [x] Replace the informational email-change message with a single-use verification token sent to the proposed new address.
- [x] Store only a hash of the verification token.
- [x] Give the token an explicit expiration and invalidate earlier requests when a new request is submitted.
- [x] Notify the current/old address that a change was requested.
- [x] Require successful ownership verification before IT can approve or apply the new address.
- [x] Notify both old and new addresses after approval.
- [x] Invalidate active sessions and password-reset challenges when the address changes.
- [x] Handle typo correction, rejection, expiration, and cancellation explicitly.

Acceptance criteria:

- IT approval alone cannot assign an email address that its owner never confirmed.
- A compromised session cannot silently redirect account recovery to an attacker's address.

### CFG-001 — Fail fast on invalid production email settings

- [x] Require `EMAIL_DELIVERY_MODE=resend` in production.
- [x] Require a non-empty Resend API key in production.
- [x] Validate `EMAIL_FROM_ADDRESS` as an email address.
- [x] Reject `onboarding@resend.dev` for general production delivery.
- [x] Reject placeholder API keys and sender domains.
- [x] Warn or fail when `EMAIL_TEST_RECIPIENT` remains set with a verified custom domain.
- [x] Validate positive, bounded provider timeout values.
- [x] Add an email-readiness check that is separate from basic database/API health.
- [x] Change environment documentation from “full-access Resend key” to a domain-restricted `sending_access` key.

Acceptance criteria:

- A deployment with incomplete email configuration fails during startup or readiness, not during the first account creation.
- The normal health endpoint and email readiness state clearly distinguish API health from outbound-email readiness.

## P2 — Important hardening and operational work

### AUTH-004 — Replace the six-character composition password policy

- [x] Choose and document the final TANAW password policy.
- [x] For password-only authentication, use a substantially longer minimum; current NIST guidance specifies 15 characters.
- [x] Permit long passphrases and a maximum length of at least 64 characters.
- [x] Remove mandatory uppercase/lowercase/number/symbol composition rules.
- [x] Add a compromised/common-password blocklist check.
- [x] Keep backend, web, and desktop validation behavior and messages synchronized.
- [x] Add boundary, Unicode, whitespace, and common-password tests.

Acceptance criteria:

- The backend remains the authoritative validator.
- Web and desktop provide matching guidance without accepting passwords the backend rejects.

### MAIL-002 — Represent provider status accurately

Current limitation: `SENT` currently means Resend accepted the API request, not that the recipient's mail server delivered it.

- [x] Rename or map the immediate provider state to `accepted`/`queued` rather than `sent` if no delivery confirmation is available.
- [x] Decide how TANAW will observe bounces and delivery failures without reintroducing inbound support email.
- [x] If keeping the outbound-only architecture, document that detailed delivery confirmation is checked in the Resend dashboard or through a narrowly scoped status-reconciliation mechanism.
- [x] Expose provider IDs and safe failure reasons to authorized IT users.
- [x] Ensure UI toasts do not promise inbox delivery when only provider acceptance is known.

Acceptance criteria:

- Operators and users can distinguish “queued by TANAW,” “accepted by Resend,” “delivered,” and “failed” whenever those states are available.
- No inbound support-email workflow or unnecessary webhook tooling is reintroduced accidentally.

### DB-001 — Move runtime schema mutation to Alembic

- [x] Stop running destructive or compatibility DDL on every application startup.
- [x] Move remaining startup schema changes into versioned Alembic migrations.
- [x] Keep startup limited to migration-state validation and safe application initialization.
- [x] Define deployment ordering: migrate first, then start the application.
- [x] Verify that migration rollback is not immediately undone by application startup.

Acceptance criteria:

- Schema history is reproducible from Alembic alone.
- Application startup does not drop tables, columns, or enum types.

### DB-002 — Define a truthful activation-migration rollback strategy

Current limitation: the downgrade recreates temporary-password fields but cannot restore the original temporary passwords, because those secrets no longer exist.

- [x] Mark the activation migration as operationally irreversible, or implement a safe rollback process that leaves pending accounts recoverable.
- [x] Document what happens to pending and activated users during rollback.
- [x] Add a rollback test that checks user behavior, not only schema shape.
- [x] Prevent deployment tooling from treating a structurally successful but functionally broken downgrade as safe.

Acceptance criteria:

- Operators cannot accidentally roll back into a state where pending users have unknowable passwords and no usable activation path.

### DB-003 — Add retention and cleanup policies

- [x] Define retention periods for consumed, invalidated, and expired activation tokens.
- [x] Define retention periods for password-reset challenges.
- [x] Define retention periods for development and production delivery records.
- [x] Schedule batched cleanup that avoids long locks.
- [x] Preserve only the audit metadata required by policy; never retain production OTPs or raw activation links.
- [x] Add cleanup metrics and tests.

Acceptance criteria:

- Public unauthenticated workflows cannot cause indefinite table growth.
- Required audit records remain available for the documented period.

### DEPLOY-001 — Remove hard-coded deployment origins

- [x] Make the web Content Security Policy API and WebSocket origins derive from the selected deployment environment or generated deployment configuration.
- [x] Remove the unnecessary static-site `Access-Control-Allow-Origin` header unless a specific consumer requires it.
- [x] Document coordinated changes for `VITE_API_BASE_URL`, backend CORS, `FRONTEND_PUBLIC_URL`, CSP `connect-src`, and WebSocket origins.
- [x] Test the future custom TANAW domain and current Vercel domain configurations.

Acceptance criteria:

- Changing the backend or frontend hostname does not leave a hard-coded CSP rule that silently blocks activation or login requests.

### MAIL-003 — Reuse the Resend HTTP client safely

- [x] Reuse a lifespan-managed `httpx.AsyncClient` rather than creating a new client for every email.
- [x] Close the client during application shutdown.
- [x] Configure connection, read, write, and pool timeouts explicitly.
- [x] Keep API keys out of exception messages and request logging.

Acceptance criteria:

- Email bursts reuse connections without leaking clients or secrets.

## P3 — Cleanup and maintainability

### CLEAN-001 — Remove stale tracked review output

- [x] Remove `last-respone.md` or move still-useful guidance into maintained documentation.
- [x] Confirm no documentation references the deleted forced-password-change pages.

### CLEAN-002 — Remove the unused Electron timestamp IPC debug path

- [x] Remove the `main-process-message` send in `desktop-tanaw/electron/main.ts`.
- [x] Remove `tanawAppEvents` from the Electron preload bridge and type declarations.
- [x] Remove the renderer `console.log` subscription in `desktop-tanaw/src/main.tsx`.
- [x] Confirm no other feature consumes this event.

### CLEAN-003 — Split and share authentication UI logic

- [x] Break the web `LoginForm.tsx` into focused login, recovery, support, and dialog components/hooks.
- [x] Break the desktop `LoginPage.tsx` into equivalent focused modules.
- [x] Centralize each client's password-recovery API calls in a typed service.
- [x] Share behavior or generated contracts where practical so web and desktop recovery do not drift.
- [x] Keep desktop-specific presentation and routing independent from the web activation page.

Acceptance criteria:

- Login components no longer contain the entire login, OTP recovery, password reset, and support workflows in one file.
- Web and desktop use the same endpoint contracts and display consistent security behavior.

### CLEAN-004 — Address existing build warnings

- [x] Resolve the desktop `loading-page-poster.jpg` runtime-resolution warning.
- [x] Add route-level code splitting for the web and desktop bundles.
- [x] Recheck bundle sizes after authentication modules are separated.

## Automated test work

### TEST-001 — Backend integration and failure-injection tests

- [x] Test account creation, activation validation, activation completion, resend, email change, and password recovery against disposable PostgreSQL rather than only mocked sessions.
- [x] Test two concurrent activation completions and prove only one succeeds.
- [x] Test two concurrent OTP verifications and resets.
- [x] Simulate provider acceptance followed by database commit failure.
- [x] Simulate provider timeout before and after acceptance.
- [x] Test outbox retry, backoff, dead-letter handling, and stable idempotency.
- [x] Test production configuration startup failures.
- [x] Test expired-record cleanup.

### TEST-002 — Web activation tests

- [x] Test reading the token from the URL fragment and immediately removing it from browser history.
- [x] Test missing, invalid, expired, invalidated, used, and valid links.
- [x] Test password-policy feedback and backend error handling.
- [x] Test successful LGU activation and navigation to web sign-in.
- [x] Test successful Enterprise activation instructions for returning to the desktop app.
- [x] Add an end-to-end test using a real backend and disposable database.

### TEST-003 — Desktop authentication and recovery tests

- [x] Test that pending Enterprise accounts cannot sign in.
- [x] Test sign-in using both Enterprise ID and registered email.
- [x] Test OTP request, verification, reset, expiration, cooldown, and error handling.
- [x] Test that activation remains browser-based and no activation token is passed into Electron.
- [x] Test session invalidation after password or email changes.

## Activation security regression checklist

These behaviors were reviewed as correct and must remain true after refactoring:

- [x] TANAW never emails temporary or permanent passwords.
- [x] Activation tokens contain at least 256 bits of cryptographically secure randomness.
- [x] Only an HMAC/hash of each activation token is stored.
- [x] Activation links are single-use and expire within the configured lifetime.
- [x] Resending invalidates every older unused link for that account.
- [x] Deactivating a pending account invalidates its activation links.
- [x] Changing a pending account's email sends a new link only to the new address.
- [x] Activation completion uses database locking and atomically consumes the token.
- [x] Pending, inactive, and unactivated accounts cannot authenticate through HTTP or WebSockets.
- [x] Opening the activation page does not consume the token; explicit password submission does.
- [x] The raw token stays in the URL fragment, is removed immediately, and is not included in referrers.
- [x] The activation page uses no-store caching and a no-referrer policy.
- [x] Production delivery records never retain OTP values or raw activation links.
- [x] Email HTML escapes account names, ticket content, and other user-controlled values.
- [x] API responses use generic invalid/expired messages and never return stored token hashes.
- [x] Enterprise activation remains browser-based; the desktop application receives no activation secret.
- [x] Password changes, password resets, role changes, email changes, and account deactivation invalidate relevant sessions and recovery challenges.
- [x] Phone numbers remain ordinary account/contact information and are never used for OTP or SMS delivery.
- [x] Support requests continue to be stored in TANAW's backend and displayed through TANAW pages rather than requiring inbound email.

## Required quality gates after each implementation batch

Backend changes:

```bash
cd backend-tanaw
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
UV_CACHE_DIR=/tmp/uv-cache uv run pytest
```

Web changes:

```bash
cd frontend-tanaw
npm run lint
npm run type
npm run build
```

Desktop changes:

```bash
cd desktop-tanaw
npm run lint
npm run type
npm run build
```

Database changes:

- [x] Test upgrade from the current production revision.
- [x] Test a fresh database upgrade to the latest revision.
- [x] Test the documented rollback or explicitly verify that the migration is intentionally irreversible.
- [x] Start the backend against the migrated database and verify clean startup.

Final security checks:

- [x] Run backend and Node dependency audits.
- [x] Scan tracked files and staged changes for secrets.
- [ ] Confirm the production activation URL uses the expected public HTTPS domain.
- [ ] Confirm Resend uses the verified TANAW domain and a restricted sending key.
- [ ] Perform one real LGU activation, one real Enterprise activation, one password reset, and one failed-delivery recovery test.

The final three production checks are intentionally left open while TANAW uses
Resend's development sender and a test-recipient restriction. They are deployment
acceptance work, not unfinished application code. The TANAW deployment operator
and LGU domain administrator own them, and they must be completed before the
production launch is approved.

## Completion definition

This checklist is complete only when:

- [x] Every P0 and P1 item is implemented before production launch.
- [x] Every deferred P2 or P3 item has an owner, target date, and documented risk acceptance.
- [x] All dependency audits and quality gates pass.
- [x] Real PostgreSQL concurrency and failure-path tests pass.
- [x] Web and desktop end-to-end authentication tests pass.
- [ ] Deployment documentation matches the final domain, Resend, CORS, CSP, and secret configuration.
- [x] A final security review confirms that no resolved risk was reintroduced.
