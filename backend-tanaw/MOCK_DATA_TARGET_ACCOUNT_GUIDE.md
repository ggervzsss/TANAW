# TANAW Target Enterprise Testing Guide

This guide explains how to prepare TANAW for a focused end-to-end reporting test using one enterprise account as the final expected submitter.

The standard TANAW acceptance target is the persistent, manually created
enterprise:

```text
Enterprise:    Archie's Event Place
Login email:   archies@email.com
Enterprise ID: archies_001@tanaw.sanpedro
```

Archie's uses the password selected during its temporary-password onboarding.
It is not one of the generated accounts and does not use `TanawTest123`.

## What The Scenario Creates

For the selected reporting range, TANAW includes every active enterprise account in the test scenario.

For a six-month range:

- The previous five months contain submitted and consolidated reports for every active enterprise.
- Final LGU reports already exist for those previous months.
- The selected target enterprise receives the same historical report coverage as the supporting enterprises.
- The current month contains ready submissions from every supporting enterprise.
- The selected target enterprise is the only enterprise without a current-month submission.
- The target desktop receives prepared current-month counts but no automatically generated report.

This supports the following acceptance test:

1. Review historical reports from the target enterprise desktop.
2. Create the target enterprise's current report from prepared counts.
3. Submit it to the backend.
4. Review and accept it from the Staff account.
5. Generate the current final consolidated report.
6. Open the final report in Final Reports Audit.
7. Return to the enterprise desktop and begin a clean new draft.

## Prerequisites

Before running the command:

1. Start the Docker services:

   ```bash
   docker compose up --build -d
   ```

2. Restart the desktop application so it is using the latest ML-service code.
3. Log into the exact enterprise account that will be the target.

Starting CCTV/IP camera monitoring is optional:

- Without a running camera, TANAW loads the finite prepared count package into the target enterprise's current draft.
- With a running camera, TANAW loads the same prepared package and then continues adding real camera events.

TANAW never replaces the camera stream with a fake video stream.

The ML service remains bound to `127.0.0.1` by default. The authenticated target desktop polls the backend for its pending prepared package and applies it automatically, so Docker does not need direct access to the local ML service.

## Find The Enterprise ID

The recommended target value is the account's Enterprise ID, visible in the desktop Profile page.

An Enterprise ID normally looks like:

```text
archies_001@tanaw.sanpedro
```

You can also list active enterprise accounts from PostgreSQL:

```bash
docker compose exec db psql -U postgres -d tanaw_local -P pager=off \
  -c "select enterprise_id, enterprise_name, email from accounts where role = 'ENTERPRISE' and status = 'ACTIVE' order by enterprise_name;"
```

Adjust the PostgreSQL username or database name if your `.env` uses different values.

The `--target-enterprise` option accepts any one of these exact identifiers:

- Enterprise ID
- enterprise email
- backend account UUID
- exact enterprise name

Enterprise ID is preferred because it is stable and unambiguous.

## Prepare The Scenario

From the TANAW project root, run:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend \
  uv run mock-data reset \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

Replace the example Enterprise ID with your target account.

Use `reset` when an older test run already exists. It removes records belonging to the active generated run, creates the new deterministic scenario, and prepares the target desktop ledger.

For the first run in an empty environment, `on` is also valid:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend \
  uv run mock-data on \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

## Expected Command Output

The JSON output includes:

- `target.enterpriseId`
- `target.enterpriseName`
- `counts.participatingEnterprises`
- `counts.targetPreparedCounts`

The desktop does not need to be reachable from the backend container. Keep the target account logged in; the desktop retrieves the package through its authenticated backend connection.

## Verify Desktop Preparation

Check the desktop state directly from the host:

```bash
curl http://127.0.0.1:8765/mock/status
```

The desktop status should show:

- `mode: "prepared"`
- the target Enterprise ID
- a nonzero entry count
- a nonzero unsubmitted event count
- the active generated run ID

In the desktop application:

1. Open Dashboard.
2. Confirm that prepared entries, exits, occupancy, and unique counts are visible.
3. Open Reports & Submissions.
4. Confirm that previous-month reports appear from the backend.
5. Confirm that no current report has been submitted automatically.

## Submit The Target Report

In the target enterprise desktop:

1. Open Reports & Submissions.
2. Select `New Draft`.
3. Review the locked system metrics.
4. Complete any supplementary report fields.
5. Preview the report if needed.
6. Submit it.

The report is first committed to the target enterprise's local SQLite ledger. The desktop then synchronizes it to the backend and marks the local copy as synced.

After submission, the prepared events are assigned to that report. A new draft starts with only events recorded after the submission, so it should be empty or contain newly observed camera activity.

## Complete The Staff Workflow

Log into the web platform using a Staff account.

For generated Staff testing credentials:

```text
Username: reports.staff@tanaw.test
Password: TanawTest123
```

Then:

1. Open Batch Reports.
2. Select the current month and year.
3. Confirm that the target enterprise now has a submitted report.
4. Open the target report.
5. Accept it as `Ready to Consolidate`.
6. Confirm that all participating enterprises are now ready.
7. Generate the final report.
8. Open Final Reports Audit.
9. Review the generated current-month artifact and its enterprise source rows.

## Enterprise Isolation

The desktop ML service now stores each enterprise in a separate directory and SQLite database. Camera sessions, metrics, visitor identities, prepared counts, and local reports are scoped by Enterprise ID.

Switching to another enterprise:

- stops the previous enterprise's active camera session;
- selects a different local ledger;
- prevents the previous enterprise's metrics and reports from being uploaded under the new account;
- uses a separate cloud gateway/device identifier.

Older installation-wide data created before enterprise scoping remains in the legacy ML-service directory. It is not automatically assigned to a new enterprise because ownership cannot be determined safely.

## Cleanup

Log into the target enterprise desktop before running cleanup so the correct scoped local ledger is active:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend \
  uv run mock-data off
```

Cleanup removes:

- generated backend accounts;
- generated telemetry;
- generated and manually submitted test reports carrying the run ID;
- generated final reports and audit rows;
- prepared desktop count events for the active target run;
- locally submitted reports associated with that run.

Real camera events without generated-run provenance are preserved.

If real camera events were submitted together with prepared counts in a hybrid test report, cleanup removes that test report but keeps the real events. TANAW returns those real events to the target enterprise's current unsubmitted draft so they can be reviewed and submitted again as a real report.

The target desktop observes the removed run through the authenticated backend API and cleans its scoped local ledger automatically.

This local cleanup happens while the target desktop account is signed in and the desktop app can reach the backend. If the app is closed or offline when `mock-data off` runs, cleanup occurs after that target account next signs in and reconnects. Camera configuration, authentication state, application preferences, and unrelated browser or desktop local storage are not cleared.

## Troubleshooting

### Desktop is bound to another enterprise

Log out, sign in as the target enterprise, wait for the desktop camera page to load, start its camera, and rerun the command.

### Prepared counts remain empty

Restart the desktop application so it loads the latest ML-service implementation, then log into the target enterprise. A camera session is not required.

### The active run targets another enterprise

Use `mock-data reset` with the desired `--target-enterprise`.

### Historical reports do not appear on the desktop

Confirm that:

- the desktop is online;
- the target account is authenticated;
- the backend API is reachable;
- the active run's target Enterprise ID matches the desktop Profile Enterprise ID.

### Staff still sees more than one missing enterprise

An enterprise account may have been created or activated after the scenario was generated. Run `mock-data reset` again so every currently active enterprise is included.
