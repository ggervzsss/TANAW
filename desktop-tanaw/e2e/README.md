# Desktop browser fixtures

`support/preload.ts` installs the current typed renderer-facing ML bridge before
application initialization. Configure request responses by operation path with
`mockMlRequest`; later registrations override earlier defaults. These are bridge
responses, not renderer HTTP routes. Context initialization must succeed before
a test intentionally fails metrics/history or another operation.

`mockCameraSetup` supplies camera profile persistence and credential metadata for
the add/configure UI. It does not run inference or simulate a full sidecar.
`mockRememberedSession` models preload save/load/clear across a browser reload;
its browser storage is test-only, not a production credential-storage design.

`npm run test:electron` remains authoritative for real renderer/preload/IPC/main
integration, token isolation, authenticated sidecar events, and lifecycle cleanup.
Do not enable direct renderer-side sidecar networking to make browser tests pass.
