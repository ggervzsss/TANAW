# Handoff: continue TANAW work on Linux Mint

For Claude (Claude Code) picking this work up on the Linux Mint machine. Written
November 17, 2026 at the end of a session on the Windows machine. Branch: `gerv`.

Start by reading, in this order:

1. `AGENTS.md`: database policy. TANAW is pre-production: no incremental migrations,
   edit the baselines directly.
2. `.claude/CLAUDE.md`: testing policy (fast checks after every change, targeted
   Playwright while working, full suites before a pull request) and known failures.
3. `design-system/README.md`, `design-system/DESIGN.md` and
   `design-system/audits/web-app.md`: the design system this session built.

Working style the user expects: explain in plain language, recommend one option when
there is a choice, ask before committing or pushing unless told to, and keep
`gerv` as the working branch.

## What this machine has to do with it

The Linux Mint laptop is where the ReID models were exported and the male/female heads
were trained (commit `ee44c72` committed those exact files). Do not re-export
`desktop-tanaw/ml-service/models/person_reid*.onnx`; the heads only accept those exact
bytes. `npm run models:verify -- --reid quality --require-sex-heads` should report
`matches_reid_model: true` for both heads.

## Commits on `gerv` from this session

| Commit | What |
|---|---|
| `969da35` (Gerv) | Male/female estimation from ReID embeddings |
| `ee44c72` (Gerv, from Linux Mint) | ReID models committed to match the heads |
| `c9aca01` | Male/female and counting fixes, performance profile, Developer Settings |
| this commit | Design system, desktop and web migration, this handoff |

### `c9aca01`: estimation and counting fixes

- **All-female reports:** the day's male/female mix used plain EM, which runs to 0% or
  100% on small days that lean one way. Now a MAP estimate with an even prior worth 20
  visitors (`ml-service/app/analytics/visitor_sex.py`). A real 10-visitor day went from
  0 male / 10 female to 3 / 7.
- **Camera vs report mismatch:** an Open Space camera's "Unique Visitors" used its own
  per-zone gallery; it now counts establishment visitors seen on that camera
  (`camera_unique_count`), so it matches Reports.
- **Performance profile:** per computer (Auto, Emergency, Compatibility, Balanced, High
  Accuracy), set in Developer Settings; High Accuracy uses the quality ReID model and
  the 86% head. `POST /cameras/performance-profile` restarts running cameras with
  their own start request. Camera Monitoring shows "Performance: … (AI FPS) Change".
- **Developer Settings** (account menu): detection details and each person's live
  male/female estimate drawn on that person's box. The live estimate is never stored.
- **ML service startup:** a leftover service from this workspace is recognised through
  its parent process (the Windows venv launcher) and replaced.

### This commit: design system

Decisions, all made by the user on November 17:

- **Look:** the desktop's original (pre-neth) UI, picked on every row of the TANAW
  Identity Board. **Layout:** neth's page structure and flows stay.
- **North star:** "The Town Hall Ledger".
- **Both apps:** Inter for body text, Bai Jamjuree for the wordmark, page titles and
  section headings; ink page titles (navy only for the seal and map artwork); the pale
  green page wash; one 12px button style in sentence case (pills only for badges,
  counters and segmented filters).
- Gold text uses Gold Ink #8a6a12 (the old #b7952b fails contrast).

What exists now:

- `design-system/`: `DESIGN.md` (normative YAML tokens plus rules and component
  specs), `tokens/tanaw.css` (single source of truth, light and dark),
  `scripts/sync-tokens.mjs` (copies tokens into both apps; `--check` for drift),
  `audits/web-app.md`, `README.md`.
- Both apps import their generated copy `src/styles/tanaw-tokens.css`. A unit test in
  each app (`tests/unit/configuration/design-tokens.test.ts`) fails if the copy is
  edited or stale. Change tokens only in `design-system/tokens/tanaw.css`, then run
  `node design-system/scripts/sync-tokens.mjs`.
- `npm run lint:tailwind` in either app flags any arbitrary class equal to a token;
  `lint:tailwind:fix` rewrites it. (The desktop lint script now resolves CSS imports
  from the stylesheet's folder.)
- **Desktop:** neth's `design.css`, `camera-setup.css` and `reports.css` keep their
  layout but take colors, type, corners, shadows and control sizes from the tokens;
  `theme-tokens.css` maps the dark roles onto the tokens; the dashboard metrics are the
  old metric strip. The DOT form preview keeps its official Arial styling.
- **Web:** `foundation.css` no longer overrides shared tokens; Inter is bundled in
  `public/fonts` (copied from the desktop, with its OFL licence); navy titles are ink;
  uppercase pill actions are 12px sentence-case buttons.

Screenshot captures for design review (skipped unless the variable is set):

```bash
cd desktop-tanaw && TANAW_DESIGN_CAPTURE=/tmp/tanaw-desktop npx playwright test open-space unified-reporting -g "design review"
```

```bash
cd frontend-tanaw && TANAW_DESIGN_CAPTURE=/tmp/tanaw-web npx playwright test design-screens
```

## Open items, in suggested order

1. **Status badge case (decision pending).** Both apps still have uppercase badges
   ("RUNNING", "5 UNAVAILABLE", ticket and activity badges). Buttons were decided;
   badges were asked about and not answered yet. Ask the user.
2. **Before any pull request:** run the full suites. Desktop: `npm run test:e2e`, then
   `npm run test:electron`. Web: `npm run test:e2e`. Desktop Playwright was not re-run
   after the last small changes (toast font, identical-value class swaps).
3. **Web stylesheets** still hold web-only hard-coded colors (map styling, older
   palettes `tgreen-*`, `charcoal-*`, `tblue-*`, `tred`, `tyellow`). Map them to tokens
   or retire them. Montserrat font files in `frontend-tanaw/public/fonts` are now unused.
4. **Reference components and Storybook** in `design-system/components` and
   `design-system/.storybook` (React 18 and 19 compatible), built screen by screen.
5. **Live camera check** of the male/female split and the per-camera unique count with
   a known number of men and women; try High Accuracy versus Balanced for speed.

## Test status at handoff

- Desktop: type, lint and 333 unit tests pass. ML service: ruff and 388 pytest pass;
  mypy (88) and pyright (11) errors are pre-existing and in untouched files;
  `test_reid_components.py::...same_filename_changes_the_feature_space` is flaky.
- Web: type, lint and 152 unit tests pass. Full web Playwright: 52 passed, 5 skipped,
  8 failed on the first run; all 8 passed when re-run, and the 3 that failed twice
  also pass on the previous commit, so they are load-sensitive rather than broken.
- Desktop Playwright for Camera Setup, Open Space, Reporting, Unified Metrics, Dark
  Mode, Display Preferences and Settings & Help passed after the dark-mode helper was
  changed to read expected colors from the tokens.
