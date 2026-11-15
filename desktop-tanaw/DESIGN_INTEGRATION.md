# Desktop design integration

Reference file: [TANAW Figma design](https://www.figma.com/design/MG3g5ehfoVNNro0KgJj5UJ/Untitled?node-id=0-1).

## Reference coverage

The Figma plugin was confirmed installed, but no Figma reading tools were exposed. The implementation uses the supplied Dashboard, Camera Settings, and three Reports screenshots. Figma pages, layer measurements, component definitions, font metadata, and the separate 20-principles image could not be inspected. The Reports update additionally uses the supplied `VAR1_Blank.xlsx` and `VAR1_Blank.xlsx - VAR 1 Blank.pdf`, inspected directly as form references rather than agent instructions.

## Implemented surfaces

- Shared 72px desktop navigation, white page surface, forest-green controls, rounded cards, focus feedback, dark-theme support, and responsive layouts.
- Dashboard: four metric cards in the reference order; side-by-side traffic and occupancy charts; demographics and peak activity; recent report preview and navigation; date-range selection; assistant panel and launcher.
- Camera Settings: selected-camera header, identity/status strip, five vertical tabs, fixed action footer, connection fields, counting methods, polygon/tripwire editor modal, per-camera display switches, reconnect, diagnostics, defaults, and removal through the existing confirmation flow. Advanced camera controls and counting relationships remain available.
- Reports: Create Reports / Reports History pill tabs; a full-width Monthly DOT Visitor Report with horizontal site/period/type information and read-only count; four visitor-origin rows beside Next Steps; seven-column history with automatic period/status filters. Assisted allocation, province-only editing, notes, camera evidence, and audit history remain available in compact expandable controls. Existing submission, revision, persistence, and offline upload logic stays connected to its services.

## Data and service constraints

- Camera runtime data is never replaced with reference-screen numbers. Dashboard and Reports always use the real reporting services; development sample data comes from the repository `scripts/mockdata-*` backend scripts. Empty and unavailable real-data states remain explicit.
- The establishment API provides daily summaries. The occupancy chart shows daily observed peaks; it does not fabricate hourly occupancy. Busiest hour is marked unavailable. Entries and exits remain unavailable for configurations without measured boundary movement.
- The existing demographic schema has male/female counts by province and foreign residence. The dashboard uses those categories instead of inventing city or other-gender data.
- The assistant interface works with grounded local summaries and saved reports. There is no AI chat endpoint in the existing application. Its disclosure identifies this limitation; it does not present local summaries as model-generated analysis.
- Camera counting enable/disable is applied with Save Changes; reconnect is an immediate runtime action. Configuration changes and display preferences use Save Changes; Cancel discards configuration/display drafts. Display preferences are scoped to the enterprise and camera and contain no credentials.
- The desktop design work does not change database schemas, migration baselines, or counting calculations. The camera service now honors the optional per-camera reconnect preference and accepts an optional location, as documented in `CAMERA_SETUP.md`. Optional city subsets are saved under `payload.var1` in the already-supported JSON payload, alongside the existing six canonical demographic fields. Older province-only records stay unspecified rather than being relabeled as city data.

## Official VAR 1 form

The workbook has one sheet, `VAR 1 Blank`, with the official table in B10:R46. Its cells contain no formulas. The seventeen columns are day, weekday, four residence groups with Male/Female/Total, and grand Male/Female/Total. The yellow headings, green monthly total, and optional-sex/residence footnote are retained. The supplied PDF has two content pages and two pages of stray overflow borders; the exporter retains the two content-page structure without those overflow pages, and uses the template's unlabeled day row for day 31 when needed. February and 30-day months contain only valid dates.

Daily grand totals come only from available frozen daily establishment observations. Missing daily rows remain blank; observed zero stays zero. Monthly demographic allocations are never fabricated into daily sex/residence records. The official grid reports saved monthly allocations and preserves an unspecified city split. Supporting notes and counting evidence remain outside the official grid on clearly separate appendix pages when present.

The Review Report Form modal supports zoom, fit, contained scrolling, print, and PDF download. The native Electron regression uses an isolated profile and HTTP test sidecar through the real preload/IPC bridge, intercepts the native download destination, exercises the print engine, and checks that existing report fixtures are unchanged after a new submission. Source templates are not modified.

## Verification

Browser coverage exercises navigation, date ranges, assistant expansion/collapse and messages, both counting editors, camera save/cancel and display persistence, brand-specific RTSP configurations, report search/filter/preview/export/submission/revision, and responsive views down to 430px. Screenshots are written under `test-results/` by the Playwright tests. These tests use isolated service fixtures; physical camera connectivity and packaged-device inference still require hardware validation.

Run `npm run type`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` from `desktop-tanaw`.

Reports-specific desktop verification: build the application, then run `node scripts/with-electron-env.cjs npx playwright test --config=playwright.electron.config.ts reports-layout --output=test-results/electron-reports`. Captures include the 1440 × 1024 Create Reports page, History, and Review modal, plus exported and native-print PDFs. Browser reporting regression tests exercise all camera modes, immutable submitted snapshots, explicit revision refresh, upload retries, search, filters, and responsive layout.

Verified on November 14, 2026: type checks, lint, production build, 292 unit tests, 23 browser regression tests, and the native Electron Reports workflow passed. The Electron test checks the Create card and tabs against the reference geometry, five 64px history rows, filter application, 30/31-day previews, zoom, native download/printing, focus restoration, and an isolated submission preserving existing records. All exported and native-print PDF pages were rendered and visually reviewed. Live reporting services were not mutated by verification.

## Reports interaction polish (November 15, 2026)

The official form stays centered whenever it fits; oversized zoom levels scroll in
both directions. Ctrl+wheel inside the preview prevents page zoom and anchors the
report near the pointer. Zoom uses a continuous eased target (instant with reduced motion).
Allocation Tools and search use fixed viewport-aware portals with internal scroll,
upward placement, shared outside-click/Escape dismissal and retained form state.
Closing a popup consumes the outside action unless switching to another popup.
Next Steps checks use validated allocation, completed review of the current draft,
and saved submission status; edits invalidate review credit.

For native verification, build the application and run the Electron `reports-layout`
test. It uses an isolated profile and controlled service endpoints.

Verification on November 15: type checks, lint, production build, 294 unit tests
(`npm test -- --maxWorkers=2`), all five mock browser tests, and the focused real
Reports regression checks passed. Both real and mock Electron workflows passed.
The mock desktop run checks 1920px preview centering, Ctrl+wheel and unchanged
Electron page zoom, two-axis overflow, popup bounds at 1440/1100/850px, retained
allocation settings, safe dismissal, progress invalidation, sample history,
native PDF download, and absence of report writes. The sample PDF's three pages
were rendered and visually reviewed; daily and monthly totals reconcile.

## Final Reports polish

Report preview defaults to actual size (100%) and stays within 50–200%, including
Fit to Page. Zoom buttons and Ctrl+wheel use 10 percentage-point increments;
wheel/trackpad input is accumulated and rate limited, and one eased animation
follows the target without restarting on every event. Actual Size (100%) cancels
pending animation and restores 100% immediately. Narrow zoom-control groups scroll
without changing the existing button dimensions or moving the export controls.

History row clicks, Enter, Space and View open the matching preview directly.
They queue that record for the existing Create Reports tab; opening that tab
selects the editor, preserving drafts and the editing/revision workflow without
starting draft persistence merely to preview history. Download and ID expansion remain independent actions.
Already-selected drafts retain their unsaved values. Submitted status/ID text
uses the reserved action space below Review with wrapping and contained scrolling,
while Review and the main containers keep their existing geometry. Font families,
font sizes, official form content and reporting calculations remain unchanged.

Final verification: type checks, lint, 294 unit tests, the six focused real Reports
browser checks, the mock browser interaction check, and both real/mock Electron
workflows passed. Native checks assert identical Review button bounds before/after
submission, readable status text below it, correct report identity for row click,
Enter, Space and View, independent native row downloads, animated zoom, the
50/200% limits, immediate actual-size reset, burst limiting and unchanged Electron
page zoom. The real submitted records remain unchanged. Final screenshots are in
`test-results/reports-final-electron-mock`; official and native-print PDFs were
rendered and checked for landscape orientation, expected content and text bounds.
