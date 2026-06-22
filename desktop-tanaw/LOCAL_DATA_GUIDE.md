# TANAW Desktop Local Data Guide

TANAW Enterprise Desktop stores count events, report drafts, submitted local reports, visitor identity metadata, camera settings, and application preferences on the device.

Run all commands below from the `desktop-tanaw` directory. Close the TANAW desktop application before running a clear command.

## Inspect Local Data

Inspect every local ledger:

```bash
npm run local-data -- inspect
```

Inspect one enterprise:

```bash
npm run local-data -- inspect \
  --enterprise "archies_001@tanaw.sanpedro"
```

Show more recent events and reports:

```bash
npm run local-data -- inspect \
  --enterprise "archies_001@tanaw.sanpedro" \
  --limit 25
```

Produce JSON for scripts or troubleshooting:

```bash
npm run local-data -- inspect --json
```

The inspection output includes:

- the application-data and SQLite ledger paths;
- row counts for events, snapshots, reports, and visitor identity tables;
- real, generated, and hybrid provenance totals;
- current unsubmitted draft event count;
- first and last event timestamps;
- recent events and reports;
- the size and location of Chromium local storage.

Sensitive embedding blobs and full event payloads are not printed.

For raw camera-setting and preference keys in a development build, open Electron Developer Tools and select **Application > Local Storage**. The CLI intentionally reports only that storage area's location and size because Chromium stores it as LevelDB rather than SQLite.

## Clear One Enterprise Ledger

```bash
npm run local-data -- clear \
  --enterprise "archies_001@tanaw.sanpedro" \
  --yes
```

This deletes only that enterprise's local:

- count events and snapshots;
- report submissions and current draft;
- visitor identity metadata;
- active ML camera session and raw event log.

It preserves other enterprise ledgers, saved camera definitions, device IDs, theme settings, authentication storage, and the backend database.

## Clear Every Local Ledger

```bash
npm run local-data -- clear --all-ledgers --yes
```

This deletes all enterprise-scoped ledgers and the older legacy unscoped ledger. Chromium local storage and camera definitions remain.

## Full Device Reset

```bash
npm run local-data -- clear --full-device --yes
```

This deletes the complete Electron user-data directory. It removes every local ledger plus:

- saved CCTV/IP camera definitions;
- desktop device IDs;
- authentication and notification storage;
- theme and application preferences;
- Electron caches and browser local storage.

The next desktop launch behaves like a new installation on that device.

## Important Boundaries

These commands affect only the desktop computer. They do not delete backend accounts, backend reports, final LGU audit reports, or other cloud records.

Run `mock-data off` before clearing local data when a generated backend run is still active. Otherwise, signing the target enterprise back in can prepare that active run in a newly created local ledger again.

If a path differs from the detected Electron directory, add:

```bash
npm run local-data -- \
  --app-data-dir "/path/to/electron/user-data" \
  inspect
```

On this Linux development installation, the default path is:

```text
~/.config/desktop-tanaw
```
