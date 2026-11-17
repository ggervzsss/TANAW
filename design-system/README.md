# TANAW design system

The reference for how TANAW looks and behaves, shared by the web app
(`frontend-tanaw`) and the desktop app (`desktop-tanaw`).

**This folder is a reference library.** Neither app imports from it, so each app
still builds on its own. Code moves from here into an app by copying, and the token
file is copied by a script with a test that catches drift.

## What is decided

- **Look:** the desktop app's original visual design (before the neth merge): civic
  green, seal gold, Bai Jamjuree and Inter, white record cards on a pale green page.
- **Layout and UX:** the neth branch's page structure and workflows.
- **Guiding idea:** "The Town Hall Ledger": official, exact and calm, with the counts
  as the content.

These were chosen on the TANAW Identity Board on November 17, 2026. The full
specification is [DESIGN.md](DESIGN.md).

## Contents

| Path                      | What it is                                                            | Status                    |
| ------------------------- | --------------------------------------------------------------------- | ------------------------- |
| `DESIGN.md`               | Identity, tokens (YAML frontmatter), rules, component specs           | Done                      |
| `tokens/tanaw.css`        | Tailwind v4 tokens, light and dark; the source of truth               | Done                      |
| `scripts/sync-tokens.mjs` | Copies the tokens into each app and checks for drift                  | Done                      |
| `components/`             | Reference React + TypeScript components with stories and docs         | Built screen by screen    |
| `patterns/`               | Composites made only from components (metric strip, camera list item) | Built screen by screen    |
| `screens/`                | Annotated screenshots of the main screens                             | Later                     |
| `.storybook/`             | Live preview of every component, variant and state                    | With the first components |

## Changing tokens

1. Edit `tokens/tanaw.css` (and the matching value in `DESIGN.md`'s frontmatter).
2. Copy it into both apps, from the repository root:

   ```bash
   node design-system/scripts/sync-tokens.mjs
   ```

3. Commit the source and both copies together.

Each app keeps its copy at `src/styles/tanaw-tokens.css`. The copy records the
SHA-256 of the source it came from, and a unit test in each app
(`tests/unit/configuration/design-tokens.test.ts`) fails when the copy was edited by
hand or no longer matches this folder. `node design-system/scripts/sync-tokens.mjs
--check` reports the same without writing anything. Both apps list the copy in
`.prettierignore` so formatting cannot change it.

Both apps import their copy right after `@import "tailwindcss";` in `src/index.css`.
The web app's `styles/foundation.css` keeps only its own extra palettes and older
variable names mapped onto the tokens.

## Migration status

- **Desktop app: migrated.** Dashboard, Camera Setup (monitoring, settings, dialogs),
  Reports (create, history, review) and the account pages use the tokens, in light
  and dark. neth's stylesheets keep their layout rules; their colors, type, corners,
  shadows and control sizes come from the tokens. The neth dark palette
  (`theme-tokens.css`) and the shell variables (`--enterprise-*`, `--design-*`) now
  map onto the tokens. The official DOT form preview keeps its own Arial styling.
- **Web app: migrated** after the [web audit](audits/web-app.md). Inter body text with
  Bai Jamjuree headings (Inter is bundled in `public/fonts`), ink page titles, the pale
  green page wash, one 12px button style in sentence case, sentence-case segmented
  filters, and the shared state, surface and chart tokens. Map artwork keeps its navy.
  Screenshots: `TANAW_DESIGN_CAPTURE=<folder> npx playwright test design-screens`
  from `frontend-tanaw`.
- **Both apps:** `npm run lint:tailwind` reports any arbitrary class that equals a
  token, and `lint:tailwind:fix` rewrites it.

To review the desktop screens, save screenshots of Dashboard, Camera Setup, Camera
Settings, Developer Settings and Reports in light and dark:

```bash
TANAW_DESIGN_CAPTURE=<folder> npx playwright test open-space unified-reporting -g "design review"
```

## Rules

1. **Change tokens here, never in an app.** The app copies are generated.
2. **Components are written in React + TypeScript with Tailwind** and must work on
   React 18 (desktop) and React 19 (web): no ref-as-prop and no `use()`.
3. **Every component documents its states:** default, hover, focus, active,
   disabled, loading, error, and dark mode.
4. **No new greens.** Map any green to a token in `DESIGN.md`.

## Migrating existing code

When writing or changing code, use the tokens instead of these older values:

| Found in the apps                            | Use instead                                       |
| -------------------------------------------- | ------------------------------------------------- |
| `bg-tanaw-green`, `#055b25`                  | `bg-tanaw-civic` (the old name stays as an alias) |
| `#065f46`, `text-emerald-800` for green text | `text-tanaw-ledger`                               |
| `#1b4332` labels                             | `text-tanaw-forest`                               |
| `--tanaw-green` (#064e2f)                    | `--tanaw-action` or `--tanaw-accent-ink`, by role |
| neth's `#335d43`, `#325d40`, `#14571f`       | `--tanaw-action` / `text-tanaw-ledger`            |
| `#b7952b` gold text                          | `text-tanaw-gold-ink`                             |
| 28px card corners, 54px buttons              | `rounded-tanaw-lg`, 42px buttons                  |
